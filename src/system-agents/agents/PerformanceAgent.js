/**
 * Performance Agent - The Optimizer
 * AI Lead Strategies LLC
 *
 * Continuous performance optimization
 */

const { createLogger } = require('../utils/logger');
const { generateId, average, percentile } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const config = require('../config');

const logger = createLogger('Performance');

class PerformanceAgent {
  constructor() {
    this.name = 'Performance';
    this.running = false;
    this.db = null;
    this.redis = null;
    this.analysisInterval = null;
    this.optimizations = [];
    this.slowQueries = new Map();
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
   * Start the agent
   */
  async start() {
    if (this.running) {
      logger.warn('Performance Agent already running');
      return;
    }

    this.running = true;

    // Start performance analysis loop
    this.startAnalysis();

    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Start periodic analysis
   */
  startAnalysis() {
    this.analysisInterval = setInterval(async () => {
      if (!this.running) return;

      await this.runAnalysis();
    }, config.intervals.performanceAnalysis);

    // Run initial analysis after 30 seconds
    setTimeout(() => this.runAnalysis(), 30000);
  }

  /**
   * Run performance analysis
   */
  async runAnalysis() {
    logger.debug('Running performance analysis');

    try {
      await Promise.all([
        this.analyzeQueryPerformance(),
        this.analyzeCacheEfficiency(),
        this.analyzeAPIPerformance(),
        this.analyzeMemoryUsage()
      ]);

      // Generate performance report
      await this.generateReport();

    } catch (error) {
      logger.error('Performance analysis failed', { error: error.message });
    }
  }

  /**
   * Analyze database query performance
   */
  async analyzeQueryPerformance() {
    if (!this.db) return;

    const queryMetrics = metricsStore.get(METRIC_NAMES.DB_QUERY_TIME, { limit: 500 });

    if (queryMetrics.length < 10) return;

    const values = queryMetrics.map(m => m.value);
    const stats = {
      avg: average(values),
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
      max: Math.max(...values)
    };

    // Identify slow queries (above threshold)
    const slowThreshold = config.thresholds.database.slowQueryThreshold;
    const slowQueries = queryMetrics.filter(m => m.value > slowThreshold);

    if (slowQueries.length > 0) {
      logger.info(`Found ${slowQueries.length} slow queries (>${slowThreshold}ms)`);

      // Check if we can analyze PostgreSQL slow queries
      if (config.agents.performance.queryAnalysisEnabled) {
        await this.analyzeSlowQueries();
      }
    }

    // Record optimization suggestion if needed
    if (stats.p95 > slowThreshold) {
      await this.recordOptimization({
        type: 'DATABASE',
        issue: `P95 query time (${stats.p95.toFixed(0)}ms) exceeds threshold (${slowThreshold}ms)`,
        suggestion: 'Review slow query log and add missing indexes',
        impact: 'high',
        stats
      });
    }
  }

  /**
   * Analyze slow queries from PostgreSQL
   */
  async analyzeSlowQueries() {
    if (!this.db) return;

    try {
      // Check if pg_stat_statements is available
      const result = await this.db.$queryRaw`
        SELECT
          query,
          calls,
          total_exec_time / calls as avg_time_ms,
          rows / calls as avg_rows
        FROM pg_stat_statements
        WHERE calls > 10
        ORDER BY total_exec_time / calls DESC
        LIMIT 10
      `;

      for (const row of result) {
        const queryHash = row.query.substring(0, 50);

        if (row.avg_time_ms > config.thresholds.database.slowQueryThreshold) {
          if (!this.slowQueries.has(queryHash)) {
            this.slowQueries.set(queryHash, {
              query: row.query,
              avgTime: row.avg_time_ms,
              calls: row.calls,
              firstSeen: new Date()
            });

            await this.recordOptimization({
              type: 'SLOW_QUERY',
              issue: `Slow query detected: ${row.avg_time_ms.toFixed(0)}ms avg`,
              suggestion: 'Add index or optimize query structure',
              impact: 'high',
              query: row.query.substring(0, 200)
            });
          }
        }
      }
    } catch (error) {
      // pg_stat_statements may not be available
      logger.debug('Could not analyze pg_stat_statements', { error: error.message });
    }
  }

  /**
   * Analyze cache efficiency
   */
  async analyzeCacheEfficiency() {
    if (!this.redis) return;

    try {
      const info = await this.redis.info('stats');

      // Parse hit/miss stats
      const hitsMatch = info.match(/keyspace_hits:(\d+)/);
      const missesMatch = info.match(/keyspace_misses:(\d+)/);

      if (hitsMatch && missesMatch) {
        const hits = parseInt(hitsMatch[1]);
        const misses = parseInt(missesMatch[1]);
        const total = hits + misses;

        if (total > 0) {
          const hitRate = hits / total;

          // Record metric
          await metricsStore.record('cache_hit_rate', hitRate * 100, {
            unit: '%',
            component: 'redis'
          });

          // Check if below target
          if (hitRate < config.agents.performance.cacheHitRateTarget) {
            await this.recordOptimization({
              type: 'CACHE',
              issue: `Cache hit rate (${(hitRate * 100).toFixed(1)}%) below target (${config.agents.performance.cacheHitRateTarget * 100}%)`,
              suggestion: 'Review cache TTLs and caching strategy',
              impact: 'medium',
              stats: { hitRate: hitRate * 100, hits, misses }
            });
          }
        }
      }

      // Check memory usage
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const maxMemoryMatch = info.match(/maxmemory:(\d+)/);

      if (memoryMatch && maxMemoryMatch) {
        const used = parseInt(memoryMatch[1]);
        const max = parseInt(maxMemoryMatch[1]);

        if (max > 0) {
          const usagePercent = (used / max) * 100;

          if (usagePercent > config.thresholds.redis.memoryUsage) {
            await this.recordOptimization({
              type: 'CACHE_MEMORY',
              issue: `Redis memory usage (${usagePercent.toFixed(1)}%) is high`,
              suggestion: 'Consider increasing Redis memory or reducing TTLs',
              impact: 'medium'
            });
          }
        }
      }

    } catch (error) {
      logger.debug('Could not analyze cache efficiency', { error: error.message });
    }
  }

  /**
   * Analyze API performance
   */
  async analyzeAPIPerformance() {
    const apiMetrics = metricsStore.get(METRIC_NAMES.API_RESPONSE_TIME, { limit: 500 });

    if (apiMetrics.length < 10) return;

    // Group by endpoint
    const byEndpoint = {};
    for (const metric of apiMetrics) {
      const endpoint = metric.tags?.endpoint || 'unknown';
      if (!byEndpoint[endpoint]) {
        byEndpoint[endpoint] = [];
      }
      byEndpoint[endpoint].push(metric.value);
    }

    // Find slow endpoints
    for (const [endpoint, values] of Object.entries(byEndpoint)) {
      const p95 = percentile(values, 95);

      if (p95 > config.thresholds.api.responseTime * 1.5) {
        await this.recordOptimization({
          type: 'API_ENDPOINT',
          issue: `Endpoint ${endpoint} has high P95 latency (${p95.toFixed(0)}ms)`,
          suggestion: 'Profile endpoint, optimize queries, add caching',
          impact: 'high',
          endpoint,
          stats: {
            p95,
            avg: average(values),
            samples: values.length
          }
        });
      }
    }
  }

  /**
   * Analyze memory usage patterns
   */
  async analyzeMemoryUsage() {
    const memoryMetrics = metricsStore.get(METRIC_NAMES.MEMORY_USAGE, { limit: 100 });
    const heapMetrics = metricsStore.get(METRIC_NAMES.HEAP_USAGE, { limit: 100 });

    if (memoryMetrics.length < 10) return;

    const memoryValues = memoryMetrics.map(m => m.value);
    const memoryAvg = average(memoryValues);
    const memoryMax = Math.max(...memoryValues);

    // Check for memory pressure
    if (memoryAvg > config.thresholds.memory.usage * 0.8) {
      await this.recordOptimization({
        type: 'MEMORY',
        issue: `Average memory usage (${memoryAvg.toFixed(1)}%) is high`,
        suggestion: 'Consider scaling up or optimizing memory usage',
        impact: 'medium',
        stats: { avg: memoryAvg, max: memoryMax }
      });
    }

    // Check heap usage if available
    if (heapMetrics.length > 10) {
      const heapValues = heapMetrics.map(m => m.value);
      const heapAvg = average(heapValues);

      if (heapAvg > config.thresholds.memory.heapUsage * 0.8) {
        await this.recordOptimization({
          type: 'HEAP',
          issue: `Average heap usage (${heapAvg.toFixed(1)}%) is high`,
          suggestion: 'Check for memory leaks, optimize object creation',
          impact: 'high',
          stats: { avg: heapAvg }
        });
      }
    }
  }

  /**
   * Record an optimization suggestion
   */
  async recordOptimization(optimization) {
    const opt = {
      id: generateId(),
      ...optimization,
      timestamp: new Date(),
      implemented: false
    };

    // Avoid duplicates
    const existingIndex = this.optimizations.findIndex(
      o => o.type === optimization.type && o.issue === optimization.issue
    );

    if (existingIndex >= 0) {
      // Update existing
      this.optimizations[existingIndex] = {
        ...this.optimizations[existingIndex],
        lastSeen: new Date(),
        occurrences: (this.optimizations[existingIndex].occurrences || 1) + 1
      };
    } else {
      this.optimizations.push(opt);

      // Keep list bounded
      if (this.optimizations.length > 100) {
        this.optimizations.shift();
      }

      // Publish optimization event
      await eventBus.publish(CHANNELS.OPTIMIZATION, {
        source: this.name,
        optimization: opt
      });

      logger.info(`Optimization identified: ${optimization.type}`, {
        issue: optimization.issue,
        impact: optimization.impact
      });
    }

    // Store in database
    if (this.db && existingIndex < 0) {
      try {
        await this.db.performanceMetric.create({
          data: {
            metricType: optimization.type,
            endpoint: optimization.endpoint || null,
            valueMs: optimization.stats?.avg || null,
            percentile95: optimization.stats?.p95 || null,
            optimizationApplied: optimization.suggestion,
            improvementPercent: null
          }
        });
      } catch (error) {
        logger.warn('Failed to store optimization', { error: error.message });
      }
    }

    return opt;
  }

  /**
   * Generate and publish performance report
   */
  async generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        optimizationsIdentified: this.optimizations.filter(o => !o.implemented).length,
        highImpact: this.optimizations.filter(o => o.impact === 'high' && !o.implemented).length,
        slowQueries: this.slowQueries.size
      },
      metrics: {},
      recommendations: []
    };

    // Add key metrics
    const metricNames = [
      METRIC_NAMES.API_RESPONSE_TIME,
      METRIC_NAMES.DB_QUERY_TIME,
      METRIC_NAMES.MEMORY_USAGE,
      METRIC_NAMES.CPU_USAGE
    ];

    for (const name of metricNames) {
      const stats = metricsStore.getStats(name);
      if (stats) {
        report.metrics[name] = {
          avg: stats.avg?.toFixed(2),
          p95: stats.p95?.toFixed(2),
          latest: stats.latest?.toFixed(2)
        };
      }
    }

    // Add top recommendations
    report.recommendations = this.optimizations
      .filter(o => !o.implemented)
      .sort((a, b) => {
        const impactOrder = { high: 0, medium: 1, low: 2 };
        return impactOrder[a.impact] - impactOrder[b.impact];
      })
      .slice(0, 5)
      .map(o => ({
        type: o.type,
        issue: o.issue,
        suggestion: o.suggestion,
        impact: o.impact
      }));

    // Publish report
    await eventBus.publish(CHANNELS.PERFORMANCE_REPORT, {
      source: this.name,
      report
    });

    logger.debug('Performance report generated', {
      optimizations: report.summary.optimizationsIdentified
    });

    return report;
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      totalOptimizations: this.optimizations.length,
      pendingOptimizations: this.optimizations.filter(o => !o.implemented).length,
      byType: this.groupByType(this.optimizations),
      byImpact: {
        high: this.optimizations.filter(o => o.impact === 'high').length,
        medium: this.optimizations.filter(o => o.impact === 'medium').length,
        low: this.optimizations.filter(o => o.impact === 'low').length
      },
      slowQueriesTracked: this.slowQueries.size
    };
  }

  /**
   * Group optimizations by type
   */
  groupByType(optimizations) {
    const groups = {};

    for (const opt of optimizations) {
      if (!groups[opt.type]) {
        groups[opt.type] = 0;
      }
      groups[opt.type]++;
    }

    return groups;
  }

  /**
   * Get pending optimizations
   */
  getPendingOptimizations() {
    return this.optimizations
      .filter(o => !o.implemented)
      .map(o => ({
        id: o.id,
        type: o.type,
        issue: o.issue,
        suggestion: o.suggestion,
        impact: o.impact,
        timestamp: o.timestamp
      }));
  }

  /**
   * Mark optimization as implemented
   */
  markImplemented(optimizationId) {
    const opt = this.optimizations.find(o => o.id === optimizationId);
    if (opt) {
      opt.implemented = true;
      opt.implementedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }

    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { PerformanceAgent };
