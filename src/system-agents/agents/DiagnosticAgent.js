/**
 * Diagnostic Agent - The Detective
 * AI Lead Strategies LLC
 *
 * AI-powered root cause analysis using Claude
 */

const { createLogger } = require('../utils/logger');
const { generateId, generateHash, truncate } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { metricsStore } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const config = require('../config');

const logger = createLogger('Diagnostic');

class DiagnosticAgent {
  constructor() {
    this.name = 'Diagnostic';
    this.running = false;
    this.anthropic = null;
    this.db = null;
    this.subscriptionId = null;
    this.diagnosisCache = new Map();
    this.pendingDiagnoses = new Map();
  }

  /**
   * Initialize the agent
   */
  async initialize(options = {}) {
    const { db, anthropicClient } = options;
    this.db = db;
    this.anthropic = anthropicClient;

    // Initialize Anthropic client if API key available
    if (!this.anthropic && process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        });
        logger.info('Anthropic client initialized');
      } catch (error) {
        logger.warn('Failed to initialize Anthropic client', { error: error.message });
      }
    }

    logger.lifecycle('starting');
  }

  /**
   * Start the agent
   */
  async start() {
    if (this.running) {
      logger.warn('Diagnostic Agent already running');
      return;
    }

    this.running = true;

    // Subscribe to alerts
    this.subscriptionId = await eventBus.subscribe(
      CHANNELS.ALERT,
      this.handleAlert.bind(this),
      this.name
    );

    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Handle incoming alert
   */
  async handleAlert(event) {
    if (!this.running) return;

    const alert = event.data.alert || event.data;

    // Skip if already diagnosing this alert
    if (this.pendingDiagnoses.has(alert.id)) {
      return;
    }

    // Skip low severity alerts
    if (alert.severity === config.severity.INFO || alert.severity === config.severity.LOW) {
      return;
    }

    logger.info(`Received alert for diagnosis: ${alert.type}`, { alertId: alert.id });

    try {
      this.pendingDiagnoses.set(alert.id, true);

      const diagnosis = await this.diagnose(alert);

      // Publish diagnosis
      await eventBus.publish(CHANNELS.DIAGNOSIS, {
        source: this.name,
        alertId: alert.id,
        diagnosis
      });

      // If confident and auto-fixable, request repair
      if (diagnosis.confidence >= config.agents.diagnostic.confidenceThreshold && diagnosis.autoFixable) {
        await eventBus.publish(CHANNELS.REPAIR_REQUEST, {
          source: this.name,
          alertId: alert.id,
          diagnosis
        });
      } else if (diagnosis.confidence < 0.5) {
        // Escalate to humans if low confidence
        await this.escalate(alert, diagnosis);
      }

    } catch (error) {
      logger.error('Diagnosis failed', { error: error.message, alertId: alert.id });

      await eventBus.publish(CHANNELS.AGENT_ERROR, {
        source: this.name,
        agent: this.name,
        error: error.message,
        alertId: alert.id
      });
    } finally {
      this.pendingDiagnoses.delete(alert.id);
    }
  }

  /**
   * Diagnose an alert
   */
  async diagnose(alert) {
    const startTime = Date.now();

    // Collect evidence
    const evidence = await this.collectEvidence(alert);

    // Check for cached/known pattern first
    const cachedDiagnosis = this.checkCache(alert, evidence);
    if (cachedDiagnosis) {
      logger.info('Using cached diagnosis', { alertId: alert.id });
      return cachedDiagnosis;
    }

    // Use AI diagnosis if available
    let diagnosis;
    if (this.anthropic) {
      diagnosis = await this.aiDiagnose(alert, evidence);
    } else {
      diagnosis = await this.ruleDiagnose(alert, evidence);
    }

    // Store diagnosis
    await this.storeDiagnosis(alert, evidence, diagnosis);

    // Cache for future use
    const cacheKey = generateHash({ type: alert.type, component: alert.component });
    this.diagnosisCache.set(cacheKey, {
      diagnosis,
      timestamp: Date.now()
    });

    logger.info(`Diagnosis complete in ${Date.now() - startTime}ms`, {
      alertId: alert.id,
      rootCause: truncate(diagnosis.rootCause, 50),
      confidence: diagnosis.confidence
    });

    return diagnosis;
  }

  /**
   * Collect evidence for diagnosis
   */
  async collectEvidence(alert) {
    const evidence = {
      alert,
      timestamp: new Date().toISOString(),
      metrics: {},
      logs: [],
      dbStats: null,
      recentAlerts: []
    };

    try {
      // Get relevant metrics
      const metricNames = this.getRelevantMetrics(alert);
      for (const name of metricNames) {
        const stats = metricsStore.getStats(name, { limit: 100 });
        if (stats) {
          evidence.metrics[name] = stats;
        }
      }

      // Get recent alerts of same type
      const activeAlerts = alertManager.getActiveAlerts({ limit: 20 });
      evidence.recentAlerts = activeAlerts.filter(a =>
        a.type === alert.type || a.component === alert.component
      ).slice(0, 5);

      // Get database stats if applicable
      if (alert.component === 'database' && this.db) {
        try {
          const dbStats = await this.db.$queryRaw`
            SELECT
              numbackends as active_connections,
              xact_commit as transactions_committed,
              xact_rollback as transactions_rolled_back,
              blks_read as blocks_read,
              blks_hit as blocks_hit,
              tup_returned as tuples_returned,
              tup_fetched as tuples_fetched
            FROM pg_stat_database
            WHERE datname = current_database()
          `;
          evidence.dbStats = dbStats[0];
        } catch {
          // DB stats not available
        }
      }

    } catch (error) {
      logger.warn('Error collecting evidence', { error: error.message });
    }

    return evidence;
  }

  /**
   * Get relevant metric names for an alert type
   */
  getRelevantMetrics(alert) {
    const metricMap = {
      API_SLOW: ['api_response_time', 'cpu_usage', 'memory_usage'],
      API_DOWN: ['api_response_time', 'api_error_count'],
      DB_SLOW: ['db_query_time', 'db_pool_usage', 'cpu_usage'],
      DB_CONNECTION_ERROR: ['db_connection_count', 'db_pool_usage'],
      MEMORY_HIGH: ['memory_usage', 'heap_usage'],
      CPU_HIGH: ['cpu_usage', 'load_average'],
      REDIS_SLOW: ['redis_response_time', 'redis_memory_usage'],
      REDIS_DOWN: ['redis_response_time']
    };

    return metricMap[alert.type] || ['cpu_usage', 'memory_usage'];
  }

  /**
   * AI-powered diagnosis using Claude
   */
  async aiDiagnose(alert, evidence) {
    const prompt = `You are a system diagnostics expert. Analyze this alert and evidence to identify the root cause.

ALERT:
- Type: ${alert.type}
- Component: ${alert.component}
- Message: ${alert.message}
- Severity: ${alert.severity}
- Value: ${alert.actualValue}
- Threshold: ${alert.thresholdValue}

EVIDENCE:
- Metrics: ${JSON.stringify(evidence.metrics, null, 2)}
- Recent related alerts: ${evidence.recentAlerts.length}
${evidence.dbStats ? `- Database stats: ${JSON.stringify(evidence.dbStats)}` : ''}

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "rootCause": "description of the root cause",
  "severity": "low|medium|high|critical",
  "confidence": 0.0 to 1.0,
  "suggestedFix": "specific fix to apply",
  "fixType": "DATABASE_INDEX|SERVICE_RESTART|CACHE_CLEAR|EMAIL_FAILOVER|MEMORY_CLEANUP|CONNECTION_POOL_EXPAND|RATE_LIMIT_ADJUST|MANUAL",
  "autoFixable": true or false,
  "estimatedFixTime": "time in seconds",
  "affectedUsers": estimated number or 0,
  "preventionAdvice": "how to prevent this in the future"
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: config.agents.diagnostic.aiModel,
        max_tokens: config.agents.diagnostic.maxTokens,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0].text;

      // Parse JSON response
      const diagnosis = JSON.parse(content);

      return {
        ...diagnosis,
        diagnosedBy: 'ai',
        model: config.agents.diagnostic.aiModel,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('AI diagnosis failed, falling back to rules', { error: error.message });
      return this.ruleDiagnose(alert, evidence);
    }
  }

  /**
   * Rule-based diagnosis fallback
   */
  async ruleDiagnose(alert, evidence) {
    const rules = {
      API_SLOW: {
        rootCause: 'API response time exceeded threshold',
        suggestedFix: 'Check database queries, increase resources, or enable caching',
        fixType: 'CACHE_CLEAR',
        autoFixable: true,
        confidence: 0.7
      },
      API_DOWN: {
        rootCause: 'API endpoint not responding',
        suggestedFix: 'Restart the service',
        fixType: 'SERVICE_RESTART',
        autoFixable: true,
        confidence: 0.8
      },
      DB_SLOW: {
        rootCause: 'Database queries taking too long',
        suggestedFix: 'Add missing indexes or optimize queries',
        fixType: 'DATABASE_INDEX',
        autoFixable: true,
        confidence: 0.75
      },
      DB_CONNECTION_ERROR: {
        rootCause: 'Database connection failed',
        suggestedFix: 'Check database status and connection pool',
        fixType: 'CONNECTION_POOL_EXPAND',
        autoFixable: true,
        confidence: 0.8
      },
      MEMORY_HIGH: {
        rootCause: 'Memory usage exceeded threshold',
        suggestedFix: 'Clear caches and restart services if needed',
        fixType: 'MEMORY_CLEANUP',
        autoFixable: true,
        confidence: 0.85
      },
      CPU_HIGH: {
        rootCause: 'CPU usage exceeded threshold',
        suggestedFix: 'Scale resources or optimize heavy processes',
        fixType: 'MANUAL',
        autoFixable: false,
        confidence: 0.6
      },
      REDIS_SLOW: {
        rootCause: 'Redis response time exceeded threshold',
        suggestedFix: 'Clear Redis cache or check memory',
        fixType: 'CACHE_CLEAR',
        autoFixable: true,
        confidence: 0.7
      },
      REDIS_DOWN: {
        rootCause: 'Redis not responding',
        suggestedFix: 'Restart Redis service',
        fixType: 'SERVICE_RESTART',
        autoFixable: true,
        confidence: 0.8
      },
      SECURITY_THREAT: {
        rootCause: 'Security threat detected',
        suggestedFix: 'Block suspicious IP and review logs',
        fixType: 'MANUAL',
        autoFixable: false,
        confidence: 0.9
      }
    };

    const rule = rules[alert.type] || {
      rootCause: `Alert triggered: ${alert.type}`,
      suggestedFix: 'Manual investigation required',
      fixType: 'MANUAL',
      autoFixable: false,
      confidence: 0.5
    };

    return {
      ...rule,
      severity: alert.severity,
      estimatedFixTime: rule.autoFixable ? '60' : 'unknown',
      affectedUsers: 0,
      preventionAdvice: 'Monitor thresholds and set up proactive alerts',
      diagnosedBy: 'rules',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check cache for known diagnosis
   */
  checkCache(alert, evidence) {
    const cacheKey = generateHash({ type: alert.type, component: alert.component });
    const cached = this.diagnosisCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return {
        ...cached.diagnosis,
        fromCache: true
      };
    }

    return null;
  }

  /**
   * Store diagnosis in database
   */
  async storeDiagnosis(alert, evidence, diagnosis) {
    if (!this.db) return;

    try {
      await this.db.diagnosticReport.create({
        data: {
          alertId: alert.id,
          issueType: alert.type,
          rootCause: diagnosis.rootCause,
          evidence: evidence,
          aiAnalysis: diagnosis.diagnosedBy === 'ai' ? JSON.stringify(diagnosis) : null,
          aiModel: diagnosis.model || null,
          confidenceScore: diagnosis.confidence,
          suggestedFix: diagnosis.suggestedFix,
          severity: diagnosis.severity,
          affectedUsers: diagnosis.affectedUsers || 0
        }
      });
    } catch (error) {
      logger.error('Failed to store diagnosis', { error: error.message });
    }
  }

  /**
   * Escalate to human team
   */
  async escalate(alert, diagnosis) {
    logger.warn('Escalating alert to humans', {
      alertId: alert.id,
      confidence: diagnosis.confidence
    });

    // This would integrate with alertManager notifications
    await alertManager.create(config.alertTypes.ESCALATION || 'ESCALATION', {
      component: 'diagnostic',
      message: `Low confidence diagnosis for ${alert.type}: ${diagnosis.rootCause}`,
      severity: config.severity.HIGH,
      metadata: {
        originalAlert: alert,
        diagnosis,
        reason: 'Low confidence - requires human review'
      }
    });
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    // Unsubscribe from alerts
    if (this.subscriptionId) {
      await eventBus.unsubscribe(this.subscriptionId);
    }

    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { DiagnosticAgent };
