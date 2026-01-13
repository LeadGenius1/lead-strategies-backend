/**
 * Self-Healing System Event Bus
 * AI Lead Strategies LLC
 *
 * Pub/Sub system for inter-agent communication
 * Supports both in-memory and Redis-backed modes
 */

const EventEmitter = require('events');
const { createLogger } = require('../utils/logger');
const { generateId } = require('../utils/helpers');

const logger = createLogger('System');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.redis = null;
    this.isRedisMode = false;
    this.subscriptions = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 1000;

    // Increase max listeners for agents
    this.setMaxListeners(50);
  }

  /**
   * Initialize with optional Redis connection
   */
  async initialize(redisClient = null) {
    if (redisClient) {
      try {
        this.redis = redisClient;
        this.isRedisMode = true;

        // Create subscriber connection
        this.subscriber = redisClient.duplicate();
        await this.subscriber.connect();

        logger.info('EventBus initialized with Redis pub/sub');
      } catch (error) {
        logger.warn('Failed to initialize Redis pub/sub, falling back to in-memory', { error: error.message });
        this.isRedisMode = false;
      }
    } else {
      logger.info('EventBus initialized in memory-only mode');
    }
  }

  /**
   * Publish an event
   */
  async publish(channel, data) {
    const event = {
      id: generateId(),
      channel,
      data,
      timestamp: new Date().toISOString(),
      source: data.source || 'unknown'
    };

    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Publish to Redis if available
    if (this.isRedisMode && this.redis) {
      try {
        await this.redis.publish(`self-healing:${channel}`, JSON.stringify(event));
      } catch (error) {
        logger.warn(`Redis publish failed for ${channel}, using in-memory`, { error: error.message });
      }
    }

    // Always emit locally for in-process subscribers
    this.emit(channel, event);

    logger.debug(`Event published to ${channel}`, { eventId: event.id });

    return event;
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel, handler, agentName = 'unknown') {
    const subscriptionId = generateId();

    // Store subscription info
    this.subscriptions.set(subscriptionId, {
      channel,
      handler,
      agentName,
      createdAt: new Date().toISOString()
    });

    // Subscribe to Redis channel if available
    if (this.isRedisMode && this.subscriber) {
      try {
        await this.subscriber.subscribe(`self-healing:${channel}`, (message) => {
          try {
            const event = JSON.parse(message);
            handler(event);
          } catch (error) {
            logger.error(`Error processing Redis message on ${channel}`, { error: error.message });
          }
        });
      } catch (error) {
        logger.warn(`Redis subscribe failed for ${channel}, using in-memory only`, { error: error.message });
      }
    }

    // Always subscribe locally
    this.on(channel, handler);

    logger.debug(`${agentName} subscribed to ${channel}`, { subscriptionId });

    return subscriptionId;
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      logger.warn(`Subscription ${subscriptionId} not found`);
      return false;
    }

    const { channel, handler } = subscription;

    // Unsubscribe from Redis if available
    if (this.isRedisMode && this.subscriber) {
      try {
        await this.subscriber.unsubscribe(`self-healing:${channel}`);
      } catch (error) {
        logger.warn(`Redis unsubscribe failed for ${channel}`, { error: error.message });
      }
    }

    // Remove local listener
    this.off(channel, handler);

    // Remove from subscriptions map
    this.subscriptions.delete(subscriptionId);

    logger.debug(`Unsubscribed from ${channel}`, { subscriptionId });

    return true;
  }

  /**
   * Get event history
   */
  getHistory(channel = null, limit = 100) {
    let history = this.eventHistory;

    if (channel) {
      history = history.filter(event => event.channel === channel);
    }

    return history.slice(-limit);
  }

  /**
   * Get subscription stats
   */
  getStats() {
    const channelCounts = {};

    for (const [, subscription] of this.subscriptions) {
      const { channel, agentName } = subscription;
      if (!channelCounts[channel]) {
        channelCounts[channel] = [];
      }
      channelCounts[channel].push(agentName);
    }

    return {
      totalSubscriptions: this.subscriptions.size,
      channels: channelCounts,
      historySize: this.eventHistory.length,
      isRedisMode: this.isRedisMode
    };
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
    logger.info('Event history cleared');
  }

  /**
   * Shutdown the event bus
   */
  async shutdown() {
    logger.info('Shutting down EventBus...');

    // Unsubscribe all
    for (const [subscriptionId] of this.subscriptions) {
      await this.unsubscribe(subscriptionId);
    }

    // Close Redis connections
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch (error) {
        logger.warn('Error closing Redis subscriber', { error: error.message });
      }
    }

    // Remove all listeners
    this.removeAllListeners();

    logger.info('EventBus shutdown complete');
  }
}

// Channel names used by agents
const CHANNELS = {
  // Monitor Agent publishes
  ALERT: 'alert',
  METRIC: 'metric',
  HEALTH_CHECK: 'health-check',

  // Diagnostic Agent publishes
  DIAGNOSIS: 'diagnosis',
  EVIDENCE: 'evidence',

  // Repair Agent publishes
  REPAIR_REQUEST: 'repair-request',
  REPAIR_COMPLETE: 'repair-complete',
  ROLLBACK: 'rollback',

  // Learning Agent publishes
  PATTERN_LEARNED: 'pattern-learned',
  PLAYBOOK_UPDATE: 'playbook-update',

  // Predictive Agent publishes
  PREDICTION: 'prediction',
  PROACTIVE_ACTION: 'proactive-action',

  // Security Agent publishes
  THREAT_DETECTED: 'threat-detected',
  MITIGATION: 'mitigation',

  // Performance Agent publishes
  OPTIMIZATION: 'optimization',
  PERFORMANCE_REPORT: 'performance-report',

  // System events
  AGENT_STARTED: 'agent-started',
  AGENT_STOPPED: 'agent-stopped',
  AGENT_ERROR: 'agent-error',
  SYSTEM_STATUS: 'system-status'
};

// Singleton instance
const eventBus = new EventBus();

module.exports = {
  eventBus,
  EventBus,
  CHANNELS
};
