/**
 * Self-Healing System Alert Manager
 * AI Lead Strategies LLC
 *
 * Manages alerts, notifications, and escalations
 */

const { createLogger } = require('../utils/logger');
const { generateId } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('./EventBus');
const config = require('../config');

const logger = createLogger('System');

class AlertManager {
  constructor() {
    this.alerts = new Map();
    this.db = null;
    this.notificationQueue = [];
    this.processingInterval = null;
  }

  /**
   * Initialize with database connection
   */
  async initialize(options = {}) {
    const { db } = options;
    this.db = db;

    // Start notification processor
    this.startProcessor();

    // Subscribe to alert events
    await eventBus.subscribe(CHANNELS.ALERT, this.handleIncomingAlert.bind(this), 'AlertManager');

    logger.info('AlertManager initialized');
  }

  /**
   * Handle incoming alert from EventBus
   */
  async handleIncomingAlert(event) {
    const alert = event.data;
    await this.processAlert(alert);
  }

  /**
   * Create a new alert
   */
  async create(alertType, data) {
    const alert = {
      id: generateId(),
      type: alertType,
      component: data.component || 'system',
      message: data.message || `Alert: ${alertType}`,
      severity: data.severity || this.determineSeverity(alertType, data),
      thresholdValue: data.threshold,
      actualValue: data.value,
      metadata: data.metadata || {},
      acknowledged: false,
      resolved: false,
      autoResolved: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store in memory
    this.alerts.set(alert.id, alert);

    // Store in database
    if (this.db) {
      try {
        await this.db.systemAlert.create({
          data: {
            id: alert.id,
            alertType: alert.type,
            component: alert.component,
            message: alert.message,
            severity: alert.severity,
            thresholdValue: alert.thresholdValue,
            actualValue: alert.actualValue,
            acknowledged: false,
            resolved: false,
            autoResolved: false
          }
        });
      } catch (error) {
        logger.error('Failed to store alert in database', { error: error.message });
      }
    }

    // Publish to EventBus
    await eventBus.publish(CHANNELS.ALERT, {
      source: 'AlertManager',
      alert
    });

    // Queue notifications
    await this.queueNotification(alert);

    logger.alert(alert.type, alert.severity, alert.message, {
      alertId: alert.id,
      component: alert.component
    });

    return alert;
  }

  /**
   * Process an alert
   */
  async processAlert(alertData) {
    // Check for duplicate/related alerts
    const existingAlert = this.findRelatedAlert(alertData);

    if (existingAlert && !existingAlert.resolved) {
      // Update existing alert
      existingAlert.count = (existingAlert.count || 1) + 1;
      existingAlert.lastOccurrence = new Date();
      existingAlert.updatedAt = new Date();

      logger.debug(`Alert occurrence count increased`, {
        alertId: existingAlert.id,
        count: existingAlert.count
      });

      return existingAlert;
    }

    return alertData;
  }

  /**
   * Find related unresolved alert
   */
  findRelatedAlert(alertData) {
    for (const [, alert] of this.alerts) {
      if (
        alert.type === alertData.type &&
        alert.component === alertData.component &&
        !alert.resolved
      ) {
        return alert;
      }
    }
    return null;
  }

  /**
   * Determine severity based on alert type and values
   */
  determineSeverity(alertType, data) {
    const { severity } = config;

    // Critical alerts
    const criticalTypes = [
      config.alertTypes.API_DOWN,
      config.alertTypes.DB_CONNECTION_ERROR,
      config.alertTypes.SECURITY_THREAT,
      config.alertTypes.SQL_INJECTION
    ];

    if (criticalTypes.includes(alertType)) {
      return severity.CRITICAL;
    }

    // High severity
    const highTypes = [
      config.alertTypes.API_ERROR_RATE,
      config.alertTypes.DB_POOL_EXHAUSTED,
      config.alertTypes.BRUTE_FORCE,
      config.alertTypes.EMAIL_PROVIDER_DOWN
    ];

    if (highTypes.includes(alertType)) {
      return severity.HIGH;
    }

    // Check threshold exceedance
    if (data.value && data.threshold) {
      const ratio = data.value / data.threshold;
      if (ratio > 2) return severity.CRITICAL;
      if (ratio > 1.5) return severity.HIGH;
      if (ratio > 1) return severity.MEDIUM;
    }

    return severity.LOW;
  }

  /**
   * Acknowledge an alert
   */
  async acknowledge(alertId, userId = null) {
    const alert = this.alerts.get(alertId);

    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    alert.updatedAt = new Date();

    // Update in database
    if (this.db) {
      try {
        await this.db.systemAlert.update({
          where: { id: alertId },
          data: {
            acknowledged: true,
            acknowledgedBy: userId
          }
        });
      } catch (error) {
        logger.error('Failed to update alert in database', { error: error.message });
      }
    }

    logger.info(`Alert acknowledged`, { alertId, userId });

    return alert;
  }

  /**
   * Resolve an alert
   */
  async resolve(alertId, options = {}) {
    const { autoResolved = false, resolution = '' } = options;

    const alert = this.alerts.get(alertId);

    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.resolved = true;
    alert.autoResolved = autoResolved;
    alert.resolution = resolution;
    alert.resolvedAt = new Date();
    alert.updatedAt = new Date();

    // Update in database
    if (this.db) {
      try {
        await this.db.systemAlert.update({
          where: { id: alertId },
          data: {
            resolved: true,
            autoResolved,
            resolvedAt: new Date()
          }
        });
      } catch (error) {
        logger.error('Failed to update alert in database', { error: error.message });
      }
    }

    logger.info(`Alert resolved`, { alertId, autoResolved, resolution });

    return alert;
  }

  /**
   * Get active (unresolved) alerts
   */
  getActiveAlerts(options = {}) {
    const { severity = null, component = null, limit = 100 } = options;

    let alerts = Array.from(this.alerts.values())
      .filter(alert => !alert.resolved);

    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    if (component) {
      alerts = alerts.filter(alert => alert.component === component);
    }

    // Sort by severity and creation time
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    alerts.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.createdAt - a.createdAt;
    });

    return alerts.slice(0, limit);
  }

  /**
   * Get alert by ID
   */
  getAlert(alertId) {
    return this.alerts.get(alertId);
  }

  /**
   * Get alert statistics
   */
  getStats() {
    const alerts = Array.from(this.alerts.values());

    const stats = {
      total: alerts.length,
      active: alerts.filter(a => !a.resolved).length,
      resolved: alerts.filter(a => a.resolved).length,
      autoResolved: alerts.filter(a => a.autoResolved).length,
      acknowledged: alerts.filter(a => a.acknowledged && !a.resolved).length,
      bySeverity: {},
      byType: {},
      byComponent: {}
    };

    // Count by severity
    for (const alert of alerts.filter(a => !a.resolved)) {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1;
      stats.byComponent[alert.component] = (stats.byComponent[alert.component] || 0) + 1;
    }

    return stats;
  }

  /**
   * Queue a notification
   */
  async queueNotification(alert) {
    this.notificationQueue.push({
      alert,
      attempts: 0,
      queuedAt: new Date()
    });
  }

  /**
   * Process notification queue
   */
  async processNotifications() {
    while (this.notificationQueue.length > 0) {
      const item = this.notificationQueue.shift();
      const { alert } = item;

      try {
        // Send to appropriate channels based on severity
        if (alert.severity === config.severity.CRITICAL) {
          await this.sendSlackNotification(alert);
          await this.sendPagerDutyNotification(alert);
        } else if (alert.severity === config.severity.HIGH) {
          await this.sendSlackNotification(alert);
        }

        // Email for all alerts if configured
        if (config.notifications.email.enabled) {
          await this.sendEmailNotification(alert);
        }
      } catch (error) {
        logger.error('Failed to send notification', {
          error: error.message,
          alertId: alert.id
        });

        // Retry up to 3 times
        if (item.attempts < 3) {
          item.attempts++;
          this.notificationQueue.push(item);
        }
      }
    }
  }

  /**
   * Send Slack notification
   */
  async sendSlackNotification(alert) {
    if (!config.notifications.slack.enabled) return;

    try {
      const color = {
        critical: '#ff0000',
        high: '#ff6600',
        medium: '#ffcc00',
        low: '#0066ff',
        info: '#cccccc'
      }[alert.severity] || '#cccccc';

      const payload = {
        channel: config.notifications.slack.channel,
        attachments: [{
          color,
          title: `🚨 ${alert.type}`,
          text: alert.message,
          fields: [
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Component', value: alert.component, short: true },
            { title: 'Value', value: String(alert.actualValue || 'N/A'), short: true },
            { title: 'Threshold', value: String(alert.thresholdValue || 'N/A'), short: true }
          ],
          footer: 'AI Lead Strategies Self-Healing System',
          ts: Math.floor(alert.createdAt.getTime() / 1000)
        }]
      };

      if (alert.severity === config.severity.CRITICAL) {
        payload.text = config.notifications.slack.mentionOnCritical;
      }

      const response = await fetch(config.notifications.slack.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }

      logger.debug('Slack notification sent', { alertId: alert.id });
    } catch (error) {
      logger.error('Failed to send Slack notification', { error: error.message });
      throw error;
    }
  }

  /**
   * Send PagerDuty notification
   */
  async sendPagerDutyNotification(alert) {
    if (!config.notifications.pagerDuty.enabled) return;

    try {
      const payload = {
        routing_key: config.notifications.pagerDuty.apiKey,
        event_action: 'trigger',
        dedup_key: alert.id,
        payload: {
          summary: `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`,
          source: 'AI Lead Strategies Self-Healing System',
          severity: alert.severity === 'critical' ? 'critical' : 'error',
          component: alert.component,
          custom_details: {
            alertId: alert.id,
            actualValue: alert.actualValue,
            thresholdValue: alert.thresholdValue
          }
        }
      };

      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.status}`);
      }

      logger.debug('PagerDuty notification sent', { alertId: alert.id });
    } catch (error) {
      logger.error('Failed to send PagerDuty notification', { error: error.message });
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(alert) {
    if (!config.notifications.email.enabled) return;

    // This would integrate with the existing emailService
    logger.debug('Email notification would be sent', { alertId: alert.id });
  }

  /**
   * Start notification processor
   */
  startProcessor() {
    this.processingInterval = setInterval(() => {
      this.processNotifications();
    }, 5000); // Process every 5 seconds
  }

  /**
   * Stop processor
   */
  stopProcessor() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Cleanup old resolved alerts
   */
  async cleanup(retentionDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    let cleaned = 0;

    for (const [id, alert] of this.alerts) {
      if (alert.resolved && alert.resolvedAt < cutoff) {
        this.alerts.delete(id);
        cleaned++;
      }
    }

    logger.info(`Cleaned up ${cleaned} old alerts`);

    return cleaned;
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.stopProcessor();

    // Process remaining notifications
    await this.processNotifications();

    logger.info('AlertManager shutdown complete');
  }
}

// Singleton instance
const alertManager = new AlertManager();

module.exports = {
  alertManager,
  AlertManager
};
