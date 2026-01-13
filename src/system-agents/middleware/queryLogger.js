/**
 * Database Query Logger & Analyzer
 * AI Lead Strategies LLC
 *
 * Logs all database queries, detects slow queries, and suggests optimizations
 */

const { createLogger } = require('../utils/logger');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { generateHash, average, percentile } = require('../utils/helpers');
const config = require('../config');

const logger = createLogger('QueryLog');

// Query statistics storage
const queryStats = new Map();
const slowQueries = [];
const MAX_SLOW_QUERIES = 100;

/**
 * Create Prisma middleware for query logging
 */
function createQueryLogger(options = {}) {
  const {
    slowThreshold = config.thresholds.database.slowQueryThreshold || 100,
    logAllQueries = process.env.NODE_ENV !== 'production',
    sampleRate = 1.0
  } = options;

  return async (params, next) => {
    // Sample rate check
    if (Math.random() > sampleRate) {
      return next(params);
    }

    const startTime = Date.now();
    const queryId = generateHash(`${params.model}:${params.action}`);

    try {
      const result = await next(params);
      const duration = Date.now() - startTime;

      // Record query metric
      await metricsStore.record(METRIC_NAMES.DB_QUERY_TIME, duration, {
        unit: 'ms',
        component: 'database',
        tags: {
          model: params.model,
          action: params.action
        }
      });

      // Update query statistics
      updateQueryStats(queryId, params, duration, true);

      // Log slow queries
      if (duration > slowThreshold) {
        await handleSlowQuery(queryId, params, duration);
      }

      // Log all queries in development
      if (logAllQueries) {
        logger.debug(`Query: ${params.model}.${params.action}`, {
          duration: `${duration}ms`,
          args: summarizeArgs(params.args)
        });
      }

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failed query
      updateQueryStats(queryId, params, duration, false);

      // Log error
      logger.error(`Query failed: ${params.model}.${params.action}`, {
        duration: `${duration}ms`,
        error: error.message
      });

      throw error;
    }
  };
}

/**
 * Update query statistics
 */
function updateQueryStats(queryId, params, duration, success) {
  if (!queryStats.has(queryId)) {
    queryStats.set(queryId, {
      model: params.model,
      action: params.action,
      count: 0,
      successCount: 0,
      failCount: 0,
      totalTime: 0,
      durations: [],
      firstSeen: Date.now(),
      lastSeen: Date.now()
    });
  }

  const stats = queryStats.get(queryId);
  stats.count++;
  stats.totalTime += duration;
  stats.lastSeen = Date.now();

  if (success) {
    stats.successCount++;
  } else {
    stats.failCount++;
  }

  // Keep last 100 durations for percentile calculation
  stats.durations.push(duration);
  if (stats.durations.length > 100) {
    stats.durations.shift();
  }
}

/**
 * Handle slow query detection
 */
async function handleSlowQuery(queryId, params, duration) {
  const slowQuery = {
    id: queryId,
    model: params.model,
    action: params.action,
    duration,
    args: summarizeArgs(params.args),
    timestamp: new Date(),
    suggestions: generateOptimizationSuggestions(params, duration)
  };

  // Add to slow queries list
  slowQueries.push(slowQuery);
  if (slowQueries.length > MAX_SLOW_QUERIES) {
    slowQueries.shift();
  }

  // Log warning
  logger.warn(`Slow query detected: ${params.model}.${params.action}`, {
    duration: `${duration}ms`,
    threshold: `${config.thresholds.database.slowQueryThreshold}ms`,
    suggestions: slowQuery.suggestions
  });

  // Publish for Performance Agent
  await eventBus.publish(CHANNELS.METRIC, {
    source: 'QueryLogger',
    type: 'SLOW_QUERY',
    query: slowQuery
  });
}

/**
 * Generate optimization suggestions for slow queries
 */
function generateOptimizationSuggestions(params, duration) {
  const suggestions = [];

  // Check for findMany without pagination
  if (params.action === 'findMany' && !params.args?.take) {
    suggestions.push({
      type: 'PAGINATION',
      message: 'Add pagination (take/skip) to limit result set',
      priority: 'high'
    });
  }

  // Check for missing select
  if (['findMany', 'findFirst', 'findUnique'].includes(params.action) && !params.args?.select) {
    suggestions.push({
      type: 'SELECT',
      message: 'Use select to fetch only needed fields',
      priority: 'medium'
    });
  }

  // Check for nested includes
  if (params.args?.include) {
    const includeDepth = getIncludeDepth(params.args.include);
    if (includeDepth > 2) {
      suggestions.push({
        type: 'INCLUDE_DEPTH',
        message: `Reduce include depth (currently ${includeDepth}). Consider separate queries`,
        priority: 'high'
      });
    }
  }

  // Check for orderBy without index hint
  if (params.args?.orderBy && duration > 200) {
    suggestions.push({
      type: 'INDEX',
      message: 'Consider adding an index on the orderBy field',
      priority: 'medium'
    });
  }

  // Check for complex where conditions
  if (params.args?.where) {
    const whereComplexity = getWhereComplexity(params.args.where);
    if (whereComplexity > 3) {
      suggestions.push({
        type: 'WHERE_COMPLEXITY',
        message: 'Complex WHERE clause detected. Consider simplifying or adding composite index',
        priority: 'medium'
      });
    }
  }

  return suggestions;
}

/**
 * Get depth of include statement
 */
function getIncludeDepth(include, depth = 1) {
  if (!include || typeof include !== 'object') return depth;

  let maxDepth = depth;
  for (const value of Object.values(include)) {
    if (value && typeof value === 'object' && value.include) {
      maxDepth = Math.max(maxDepth, getIncludeDepth(value.include, depth + 1));
    }
  }
  return maxDepth;
}

/**
 * Calculate complexity of WHERE clause
 */
function getWhereComplexity(where, complexity = 0) {
  if (!where || typeof where !== 'object') return complexity;

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      if (Array.isArray(value)) {
        complexity += value.length;
        for (const item of value) {
          complexity = getWhereComplexity(item, complexity);
        }
      }
    } else {
      complexity++;
    }
  }

  return complexity;
}

/**
 * Summarize query args for logging (remove sensitive data)
 */
function summarizeArgs(args) {
  if (!args) return null;

  const summary = {};

  if (args.where) {
    summary.where = Object.keys(args.where);
  }
  if (args.select) {
    summary.select = Object.keys(args.select);
  }
  if (args.include) {
    summary.include = Object.keys(args.include);
  }
  if (args.orderBy) {
    summary.orderBy = args.orderBy;
  }
  if (args.take) {
    summary.take = args.take;
  }
  if (args.skip) {
    summary.skip = args.skip;
  }

  return summary;
}

/**
 * Get query statistics
 */
function getQueryStats() {
  const stats = [];

  for (const [id, data] of queryStats) {
    stats.push({
      id,
      model: data.model,
      action: data.action,
      count: data.count,
      avgDuration: data.count > 0 ? Math.round(data.totalTime / data.count) : 0,
      p95Duration: percentile(data.durations, 95),
      p99Duration: percentile(data.durations, 99),
      successRate: data.count > 0 ? ((data.successCount / data.count) * 100).toFixed(1) + '%' : '0%',
      lastSeen: new Date(data.lastSeen).toISOString()
    });
  }

  // Sort by total time (most impactful queries first)
  stats.sort((a, b) => (b.avgDuration * b.count) - (a.avgDuration * a.count));

  return stats.slice(0, 50);
}

/**
 * Get slow queries
 */
function getSlowQueries() {
  return slowQueries.slice(-50).reverse();
}

/**
 * Get query health summary
 */
function getQueryHealthSummary() {
  const allDurations = [];

  for (const data of queryStats.values()) {
    allDurations.push(...data.durations);
  }

  return {
    totalQueries: Array.from(queryStats.values()).reduce((sum, s) => sum + s.count, 0),
    uniqueQueries: queryStats.size,
    avgDuration: allDurations.length > 0 ? Math.round(average(allDurations)) : 0,
    p95Duration: allDurations.length > 0 ? Math.round(percentile(allDurations, 95)) : 0,
    slowQueryCount: slowQueries.length,
    topSlowQueries: slowQueries.slice(-5).reverse().map(q => ({
      query: `${q.model}.${q.action}`,
      duration: q.duration
    }))
  };
}

/**
 * Clear statistics (for testing)
 */
function clearStats() {
  queryStats.clear();
  slowQueries.length = 0;
}

module.exports = {
  createQueryLogger,
  getQueryStats,
  getSlowQueries,
  getQueryHealthSummary,
  clearStats
};
