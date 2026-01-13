/**
 * Self-Healing System Metrics Store
 * AI Lead Strategies LLC
 *
 * Collects, stores, and queries metrics for all agents
 * Supports time-series data for predictions and analysis
 */

const { createLogger } = require('../utils/logger');
const { generateId, average, percentile, standardDeviation } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('./EventBus');
const config = require('../config');

const logger = createLogger('System');

class MetricsStore {
  constructor() {
    this.metrics = new Map();
    this.redis = null;
    this.db = null;
    this.maxInMemoryPoints = 10000;
    this.aggregationInterval = null;
  }

  /**
   * Initialize with optional Redis and database connections
   */
  async initialize(options = {}) {
    const { redis, db } = options;

    this.redis = redis;
    this.db = db;

    // Start periodic aggregation
    this.startAggregation();

    logger.info('MetricsStore initialized', {
      hasRedis: !!redis,
      hasDb: !!db
    });
  }

  /**
   * Record a metric
   */
  async record(name, value, options = {}) {
    const {
      unit = '',
      component = 'system',
      tags = {},
      severity = 'normal'
    } = options;

    const metric = {
      id: generateId(),
      name,
      value,
      unit,
      component,
      tags,
      severity,
      timestamp: new Date()
    };

    // Store in memory
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricArray = this.metrics.get(name);
    metricArray.push(metric);

    // Keep memory usage bounded
    if (metricArray.length > this.maxInMemoryPoints) {
      metricArray.shift();
    }

    // Store in Redis for distributed access
    if (this.redis) {
      try {
        const key = `metrics:${name}:${Date.now()}`;
        await this.redis.set(key, JSON.stringify(metric), 'EX', 86400); // 24h TTL

        // Add to sorted set for time-series queries
        await this.redis.zadd(`metrics:${name}:series`, Date.now(), JSON.stringify(metric));

        // Trim old entries
        const cutoff = Date.now() - (config.database.metricsRetentionDays * 24 * 60 * 60 * 1000);
        await this.redis.zremrangebyscore(`metrics:${name}:series`, '-inf', cutoff);
      } catch (error) {
        logger.warn('Failed to store metric in Redis', { error: error.message, metric: name });
      }
    }

    // Publish metric event
    await eventBus.publish(CHANNELS.METRIC, {
      source: 'MetricsStore',
      metric
    });

    return metric;
  }

  /**
   * Get metrics for a specific name
   */
  get(name, options = {}) {
    const {
      startTime = null,
      endTime = null,
      limit = 100
    } = options;

    let metrics = this.metrics.get(name) || [];

    // Filter by time range
    if (startTime) {
      metrics = metrics.filter(m => m.timestamp >= startTime);
    }
    if (endTime) {
      metrics = metrics.filter(m => m.timestamp <= endTime);
    }

    // Apply limit
    return metrics.slice(-limit);
  }

  /**
   * Get aggregated statistics for a metric
   */
  getStats(name, options = {}) {
    const metrics = this.get(name, options);
    const values = metrics.map(m => m.value);

    if (values.length === 0) {
      return null;
    }

    return {
      name,
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: average(values),
      stdDev: standardDeviation(values),
      p50: percentile(values, 50),
      p90: percentile(values, 90),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      latest: values[values.length - 1],
      latestTimestamp: metrics[metrics.length - 1]?.timestamp
    };
  }

  /**
   * Get all metric names
   */
  getMetricNames() {
    return Array.from(this.metrics.keys());
  }

  /**
   * Get metrics by component
   */
  getByComponent(component, options = {}) {
    const result = {};

    for (const [name, metrics] of this.metrics) {
      const filtered = metrics.filter(m => m.component === component);
      if (filtered.length > 0) {
        result[name] = this.getStats(name, options);
      }
    }

    return result;
  }

  /**
   * Get metrics exceeding thresholds
   */
  getAnomalies(name, threshold) {
    const metrics = this.get(name, { limit: 1000 });

    return metrics.filter(m => {
      if (typeof threshold === 'number') {
        return m.value > threshold;
      }
      if (threshold.min !== undefined && m.value < threshold.min) {
        return true;
      }
      if (threshold.max !== undefined && m.value > threshold.max) {
        return true;
      }
      return false;
    });
  }

  /**
   * Get rate of change for a metric
   */
  getRateOfChange(name, windowMs = 60000) {
    const now = Date.now();
    const startTime = new Date(now - windowMs);

    const metrics = this.get(name, { startTime });

    if (metrics.length < 2) {
      return null;
    }

    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    const timeDiff = last.timestamp - first.timestamp;

    if (timeDiff === 0) return 0;

    return (last.value - first.value) / (timeDiff / 1000); // per second
  }

  /**
   * Get trend direction
   */
  getTrend(name, windowMs = 300000) {
    const rateOfChange = this.getRateOfChange(name, windowMs);

    if (rateOfChange === null) return 'unknown';
    if (rateOfChange > 0.1) return 'increasing';
    if (rateOfChange < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Persist metrics to database
   */
  async persistToDb() {
    if (!this.db) return;

    try {
      const batch = [];

      for (const [name, metrics] of this.metrics) {
        // Get metrics not yet persisted (last 100)
        const toPersist = metrics.slice(-100);

        for (const metric of toPersist) {
          batch.push({
            metricName: metric.name,
            metricValue: metric.value,
            metricUnit: metric.unit,
            component: metric.component,
            severity: metric.severity,
            createdAt: metric.timestamp
          });
        }
      }

      if (batch.length > 0) {
        await this.db.systemHealthMetric.createMany({
          data: batch,
          skipDuplicates: true
        });

        logger.debug(`Persisted ${batch.length} metrics to database`);
      }
    } catch (error) {
      logger.error('Failed to persist metrics to database', { error: error.message });
    }
  }

  /**
   * Start periodic aggregation and persistence
   */
  startAggregation() {
    // Aggregate and persist every minute
    this.aggregationInterval = setInterval(async () => {
      await this.persistToDb();
    }, 60000);

    logger.debug('Started metrics aggregation');
  }

  /**
   * Stop aggregation
   */
  stopAggregation() {
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
      this.aggregationInterval = null;
    }
  }

  /**
   * Get system health summary
   */
  getHealthSummary() {
    const summary = {
      timestamp: new Date().toISOString(),
      metrics: {}
    };

    const importantMetrics = [
      'api_response_time',
      'db_query_time',
      'memory_usage',
      'cpu_usage',
      'redis_response_time',
      'error_rate'
    ];

    for (const name of importantMetrics) {
      const stats = this.getStats(name);
      if (stats) {
        summary.metrics[name] = {
          current: stats.latest,
          avg: stats.avg,
          p95: stats.p95,
          trend: this.getTrend(name)
        };
      }
    }

    return summary;
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
    logger.info('All metrics cleared');
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.stopAggregation();

    // Final persistence
    await this.persistToDb();

    logger.info('MetricsStore shutdown complete');
  }
}

// Common metric names
const METRIC_NAMES = {
  // API metrics
  API_RESPONSE_TIME: 'api_response_time',
  API_ERROR_COUNT: 'api_error_count',
  API_REQUEST_COUNT: 'api_request_count',

  // Database metrics
  DB_QUERY_TIME: 'db_query_time',
  DB_CONNECTION_COUNT: 'db_connection_count',
  DB_POOL_USAGE: 'db_pool_usage',

  // Memory metrics
  MEMORY_USAGE: 'memory_usage',
  HEAP_USAGE: 'heap_usage',

  // CPU metrics
  CPU_USAGE: 'cpu_usage',
  LOAD_AVERAGE: 'load_average',

  // Disk metrics
  DISK_USAGE: 'disk_usage',

  // Redis metrics
  REDIS_RESPONSE_TIME: 'redis_response_time',
  REDIS_MEMORY_USAGE: 'redis_memory_usage',

  // Email metrics
  EMAIL_SENT: 'email_sent',
  EMAIL_DELIVERED: 'email_delivered',
  EMAIL_BOUNCED: 'email_bounced',
  EMAIL_BOUNCE_RATE: 'email_bounce_rate',

  // Queue metrics
  QUEUE_DEPTH: 'queue_depth',
  QUEUE_PROCESSING_TIME: 'queue_processing_time',

  // Security metrics
  FAILED_LOGINS: 'failed_logins',
  BLOCKED_IPS: 'blocked_ips',
  SECURITY_INCIDENTS: 'security_incidents',

  // Business metrics
  ACTIVE_USERS: 'active_users',
  LEADS_CREATED: 'leads_created',
  CAMPAIGNS_SENT: 'campaigns_sent'
};

// Singleton instance
const metricsStore = new MetricsStore();

module.exports = {
  metricsStore,
  MetricsStore,
  METRIC_NAMES
};
