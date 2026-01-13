/**
 * Monitor Agent - The Watcher
 * AI Lead Strategies LLC
 *
 * Continuous health monitoring every 5 seconds
 * Detects issues and triggers alerts
 */

const { createLogger } = require('../utils/logger');
const { generateId, getSystemMetrics, getProcessMetrics, withTimeout, retry } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const config = require('../config');

const logger = createLogger('Monitor');

class MonitorAgent {
  constructor() {
    this.name = 'Monitor';
    this.running = false;
    this.intervals = [];
    this.db = null;
    this.redis = null;
    this.lastChecks = new Map();
  }

  /**
   * Initialize the agent
   */
  async initialize(options = {}) {
    const { db, redis } = options;
    this.db = db;
    this.redis = redis;

    logger.lifecycle('starting');
  }

  /**
   * Start monitoring
   */
  async start() {
    if (this.running) {
      logger.warn('Monitor Agent already running');
      return;
    }

    this.running = true;

    // Start all monitoring loops
    this.startAPIMonitoring();
    this.startDatabaseMonitoring();
    this.startRedisMonitoring();
    this.startSystemMonitoring();
    this.startProcessMonitoring();
    this.startExternalAPIMonitoring();

    // Publish started event
    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Monitor internal API endpoints
   */
  startAPIMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running) return;

      const { endpoints } = config.agents.monitor;
      // Always use localhost for internal monitoring (same server)
      const baseUrl = `http://localhost:${process.env.PORT || 3001}`;

      for (const endpoint of endpoints) {
        try {
          const start = Date.now();

          const response = await withTimeout(
            fetch(`${baseUrl}${endpoint}`),
            config.thresholds.api.timeout,
            `API timeout: ${endpoint}`
          );

          const responseTime = Date.now() - start;

          // Record metric
          await metricsStore.record(METRIC_NAMES.API_RESPONSE_TIME, responseTime, {
            unit: 'ms',
            component: 'api',
            tags: { endpoint }
          });

          // Check threshold
          if (responseTime > config.thresholds.api.responseTime) {
            await alertManager.create(config.alertTypes.API_SLOW, {
              component: 'api',
              message: `API endpoint ${endpoint} slow: ${responseTime}ms (threshold: ${config.thresholds.api.responseTime}ms)`,
              value: responseTime,
              threshold: config.thresholds.api.responseTime,
              metadata: { endpoint }
            });
          }

          // Check for error status
          if (!response.ok) {
            await metricsStore.record(METRIC_NAMES.API_ERROR_COUNT, 1, {
              component: 'api',
              tags: { endpoint, status: response.status }
            });
          }

          this.lastChecks.set(`api:${endpoint}`, {
            status: 'healthy',
            responseTime,
            timestamp: new Date()
          });

        } catch (error) {
          logger.error(`API check failed: ${endpoint}`, { error: error.message });

          await alertManager.create(config.alertTypes.API_DOWN, {
            component: 'api',
            message: `API endpoint ${endpoint} is down: ${error.message}`,
            severity: config.severity.CRITICAL,
            metadata: { endpoint, error: error.message }
          });

          this.lastChecks.set(`api:${endpoint}`, {
            status: 'down',
            error: error.message,
            timestamp: new Date()
          });
        }
      }
    }, config.intervals.healthCheck);

    this.intervals.push(interval);
    logger.info('API monitoring started');
  }

  /**
   * Monitor database health
   */
  startDatabaseMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running || !this.db) return;

      try {
        const start = Date.now();

        // Simple query to test connection
        await this.db.$queryRaw`SELECT 1`;

        const queryTime = Date.now() - start;

        // Record metric
        await metricsStore.record(METRIC_NAMES.DB_QUERY_TIME, queryTime, {
          unit: 'ms',
          component: 'database',
          tags: { query: 'health_check' }
        });

        // Check threshold
        if (queryTime > config.thresholds.database.queryTime) {
          await alertManager.create(config.alertTypes.DB_SLOW, {
            component: 'database',
            message: `Database query slow: ${queryTime}ms (threshold: ${config.thresholds.database.queryTime}ms)`,
            value: queryTime,
            threshold: config.thresholds.database.queryTime
          });
        }

        // Check connection pool if available
        try {
          const poolInfo = await this.db.$metrics?.json();
          if (poolInfo?.gauges) {
            const poolUsage = poolInfo.gauges.find(g => g.key === 'prisma_pool_connections_busy');
            if (poolUsage) {
              await metricsStore.record(METRIC_NAMES.DB_POOL_USAGE, poolUsage.value, {
                unit: 'connections',
                component: 'database'
              });
            }
          }
        } catch {
          // Metrics not available
        }

        this.lastChecks.set('database', {
          status: 'healthy',
          queryTime,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Database check failed', { error: error.message });

        await alertManager.create(config.alertTypes.DB_CONNECTION_ERROR, {
          component: 'database',
          message: `Database connection error: ${error.message}`,
          severity: config.severity.CRITICAL,
          metadata: { error: error.message }
        });

        this.lastChecks.set('database', {
          status: 'down',
          error: error.message,
          timestamp: new Date()
        });
      }
    }, config.intervals.healthCheck);

    this.intervals.push(interval);
    logger.info('Database monitoring started');
  }

  /**
   * Monitor Redis health
   */
  startRedisMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running || !this.redis) return;

      try {
        const start = Date.now();

        // Ping Redis
        await this.redis.ping();

        const responseTime = Date.now() - start;

        // Record metric
        await metricsStore.record(METRIC_NAMES.REDIS_RESPONSE_TIME, responseTime, {
          unit: 'ms',
          component: 'redis'
        });

        // Check threshold
        if (responseTime > config.thresholds.redis.responseTime) {
          await alertManager.create(config.alertTypes.REDIS_SLOW, {
            component: 'redis',
            message: `Redis slow: ${responseTime}ms (threshold: ${config.thresholds.redis.responseTime}ms)`,
            value: responseTime,
            threshold: config.thresholds.redis.responseTime
          });
        }

        // Get Redis info
        try {
          const info = await this.redis.info('memory');
          const usedMemory = parseInt(info.match(/used_memory:(\d+)/)?.[1] || 0);
          const maxMemory = parseInt(info.match(/maxmemory:(\d+)/)?.[1] || 0);

          if (maxMemory > 0) {
            const memoryPercent = (usedMemory / maxMemory) * 100;
            await metricsStore.record(METRIC_NAMES.REDIS_MEMORY_USAGE, memoryPercent, {
              unit: '%',
              component: 'redis'
            });
          }
        } catch {
          // Info not available
        }

        this.lastChecks.set('redis', {
          status: 'healthy',
          responseTime,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Redis check failed', { error: error.message });

        await alertManager.create(config.alertTypes.REDIS_DOWN, {
          component: 'redis',
          message: `Redis connection error: ${error.message}`,
          severity: config.severity.HIGH,
          metadata: { error: error.message }
        });

        this.lastChecks.set('redis', {
          status: 'down',
          error: error.message,
          timestamp: new Date()
        });
      }
    }, config.intervals.healthCheck);

    this.intervals.push(interval);
    logger.info('Redis monitoring started');
  }

  /**
   * Monitor system resources (CPU, Memory, Disk)
   */
  startSystemMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running) return;

      try {
        const metrics = getSystemMetrics();

        // CPU
        await metricsStore.record(METRIC_NAMES.CPU_USAGE, metrics.cpu.usage, {
          unit: '%',
          component: 'system'
        });

        if (metrics.cpu.usage > config.thresholds.cpu.usage) {
          await alertManager.create(config.alertTypes.CPU_HIGH, {
            component: 'system',
            message: `CPU usage high: ${metrics.cpu.usage}% (threshold: ${config.thresholds.cpu.usage}%)`,
            value: metrics.cpu.usage,
            threshold: config.thresholds.cpu.usage
          });
        }

        // Memory
        const memoryPercent = parseFloat(metrics.memory.usagePercent);
        await metricsStore.record(METRIC_NAMES.MEMORY_USAGE, memoryPercent, {
          unit: '%',
          component: 'system'
        });

        if (memoryPercent > config.thresholds.memory.usage) {
          await alertManager.create(config.alertTypes.MEMORY_HIGH, {
            component: 'system',
            message: `Memory usage high: ${memoryPercent}% (threshold: ${config.thresholds.memory.usage}%)`,
            value: memoryPercent,
            threshold: config.thresholds.memory.usage
          });
        }

        // Load average
        await metricsStore.record(METRIC_NAMES.LOAD_AVERAGE, metrics.loadAverage[0], {
          unit: '',
          component: 'system'
        });

        this.lastChecks.set('system', {
          status: 'healthy',
          cpu: metrics.cpu.usage,
          memory: memoryPercent,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('System metrics collection failed', { error: error.message });
      }
    }, config.intervals.metricsCollection);

    this.intervals.push(interval);
    logger.info('System monitoring started');
  }

  /**
   * Monitor Node.js process
   */
  startProcessMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running) return;

      try {
        const metrics = getProcessMetrics();

        // Heap usage
        const heapPercent = parseFloat(metrics.memory.heapUsagePercent);
        await metricsStore.record(METRIC_NAMES.HEAP_USAGE, heapPercent, {
          unit: '%',
          component: 'process'
        });

        if (heapPercent > config.thresholds.memory.heapUsage) {
          await alertManager.create(config.alertTypes.MEMORY_HIGH, {
            component: 'process',
            message: `Heap usage high: ${heapPercent}% (threshold: ${config.thresholds.memory.heapUsage}%)`,
            value: heapPercent,
            threshold: config.thresholds.memory.heapUsage,
            metadata: { type: 'heap' }
          });
        }

        this.lastChecks.set('process', {
          status: 'healthy',
          heap: heapPercent,
          uptime: metrics.uptime,
          timestamp: new Date()
        });

      } catch (error) {
        logger.error('Process metrics collection failed', { error: error.message });
      }
    }, config.intervals.metricsCollection);

    this.intervals.push(interval);
    logger.info('Process monitoring started');
  }

  /**
   * Monitor external APIs (OpenAI, SendGrid, etc.)
   */
  startExternalAPIMonitoring() {
    const interval = setInterval(async () => {
      if (!this.running) return;

      const { externalServices } = config.agents.monitor;

      for (const service of externalServices) {
        try {
          const start = Date.now();

          // Just check connectivity, not full API call
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), service.timeout);

          const response = await fetch(service.url, {
            method: 'HEAD',
            signal: controller.signal
          }).catch(() => null);

          clearTimeout(timeout);

          const responseTime = Date.now() - start;

          await metricsStore.record(`external_api_${service.name.toLowerCase()}`, responseTime, {
            unit: 'ms',
            component: 'external',
            tags: { service: service.name }
          });

          this.lastChecks.set(`external:${service.name}`, {
            status: response ? 'healthy' : 'degraded',
            responseTime,
            timestamp: new Date()
          });

        } catch (error) {
          logger.warn(`External API check failed: ${service.name}`, { error: error.message });

          await alertManager.create(config.alertTypes.EXTERNAL_API_DOWN, {
            component: 'external',
            message: `External API ${service.name} may be unreachable`,
            severity: config.severity.MEDIUM,
            metadata: { service: service.name, error: error.message }
          });

          this.lastChecks.set(`external:${service.name}`, {
            status: 'down',
            error: error.message,
            timestamp: new Date()
          });
        }
      }
    }, config.intervals.healthCheck * 6); // Every 30 seconds

    this.intervals.push(interval);
    logger.info('External API monitoring started');
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const checks = Object.fromEntries(this.lastChecks);
    const unhealthy = Array.from(this.lastChecks.values()).filter(c => c.status !== 'healthy');

    return {
      overall: unhealthy.length === 0 ? 'healthy' : unhealthy.some(c => c.status === 'down') ? 'critical' : 'degraded',
      checks,
      unhealthyCount: unhealthy.length,
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Stop monitoring
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    // Publish stopped event
    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { MonitorAgent };
