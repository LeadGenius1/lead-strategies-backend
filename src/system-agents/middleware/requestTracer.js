/**
 * Request Tracing Middleware
 * AI Lead Strategies LLC
 *
 * Tracks every request through the system for end-to-end monitoring
 * Enables distributed tracing and performance analysis
 */

const { generateId } = require('../utils/helpers');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { createLogger } = require('../utils/logger');
const config = require('../config');

const logger = createLogger('Tracer');

// Store for active traces
const activeTraces = new Map();

// Cleanup old traces every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [traceId, trace] of activeTraces) {
    if (now - trace.startTime > 300000) { // 5 minutes
      activeTraces.delete(traceId);
    }
  }
}, 300000);

/**
 * Create request tracing middleware
 */
function createRequestTracer(options = {}) {
  const {
    sampleRate = 1.0,           // Sample 100% of requests by default
    slowThreshold = 500,         // Log requests slower than 500ms
    excludePaths = ['/health', '/api/v1/health', '/favicon.ico'],
    captureBody = false,         // Don't capture body by default (privacy)
    captureHeaders = ['user-agent', 'content-type', 'authorization']
  } = options;

  return async function requestTracer(req, res, next) {
    // Skip excluded paths
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Sample rate check
    if (Math.random() > sampleRate) {
      return next();
    }

    // Generate trace ID
    const traceId = req.headers['x-trace-id'] || generateId();
    const spanId = generateId().substring(0, 8);

    // Attach to request
    req.traceId = traceId;
    req.spanId = spanId;

    // Set response header
    res.setHeader('X-Trace-Id', traceId);

    // Create trace context
    const trace = {
      traceId,
      spanId,
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent'],
      userId: null, // Will be set by auth middleware
      startTime: Date.now(),
      spans: [],
      metadata: {}
    };

    // Capture selected headers
    trace.headers = {};
    for (const header of captureHeaders) {
      if (req.headers[header]) {
        // Mask authorization header
        if (header === 'authorization') {
          trace.headers[header] = req.headers[header].substring(0, 20) + '...';
        } else {
          trace.headers[header] = req.headers[header];
        }
      }
    }

    // Store active trace
    activeTraces.set(traceId, trace);

    // Create span helper
    req.createSpan = (name, data = {}) => {
      const span = {
        id: generateId().substring(0, 8),
        name,
        startTime: Date.now(),
        endTime: null,
        duration: null,
        data
      };
      trace.spans.push(span);
      return {
        end: (result = {}) => {
          span.endTime = Date.now();
          span.duration = span.endTime - span.startTime;
          span.result = result;
        }
      };
    };

    // Override res.json to capture response
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      trace.responseBody = captureBody ? body : { captured: false };
      trace.responseSize = JSON.stringify(body).length;
      return originalJson(body);
    };

    // On response finish
    res.on('finish', async () => {
      trace.endTime = Date.now();
      trace.duration = trace.endTime - trace.startTime;
      trace.statusCode = res.statusCode;
      trace.userId = req.user?.id || null;

      // Record metrics
      await metricsStore.record(METRIC_NAMES.API_RESPONSE_TIME, trace.duration, {
        unit: 'ms',
        component: 'api',
        tags: {
          method: trace.method,
          path: trace.path,
          status: trace.statusCode
        }
      });

      // Count requests
      await metricsStore.record(METRIC_NAMES.API_REQUEST_COUNT, 1, {
        component: 'api',
        tags: {
          method: trace.method,
          path: trace.path,
          status: trace.statusCode
        }
      });

      // Track errors
      if (trace.statusCode >= 400) {
        await metricsStore.record(METRIC_NAMES.API_ERROR_COUNT, 1, {
          component: 'api',
          tags: {
            method: trace.method,
            path: trace.path,
            status: trace.statusCode
          }
        });
      }

      // Log slow requests
      if (trace.duration > slowThreshold) {
        logger.warn(`Slow request: ${trace.method} ${trace.path}`, {
          traceId,
          duration: `${trace.duration}ms`,
          status: trace.statusCode,
          spans: trace.spans.map(s => `${s.name}: ${s.duration}ms`)
        });

        // Publish for analysis
        await eventBus.publish(CHANNELS.METRIC, {
          source: 'RequestTracer',
          type: 'SLOW_REQUEST',
          trace: {
            traceId,
            method: trace.method,
            path: trace.path,
            duration: trace.duration,
            spans: trace.spans
          }
        });
      }

      // Remove from active traces
      activeTraces.delete(traceId);
    });

    next();
  };
}

/**
 * Database query tracing wrapper
 */
function traceQuery(req, queryName, queryFn) {
  return async (...args) => {
    const span = req?.createSpan?.(`db:${queryName}`) || null;

    try {
      const result = await queryFn(...args);

      if (span) {
        span.end({ success: true, rowCount: Array.isArray(result) ? result.length : 1 });
      }

      return result;
    } catch (error) {
      if (span) {
        span.end({ success: false, error: error.message });
      }
      throw error;
    }
  };
}

/**
 * External service call tracing wrapper
 */
async function traceExternalCall(req, serviceName, callFn) {
  const span = req?.createSpan?.(`external:${serviceName}`) || null;

  try {
    const result = await callFn();

    if (span) {
      span.end({ success: true });
    }

    return result;
  } catch (error) {
    if (span) {
      span.end({ success: false, error: error.message });
    }
    throw error;
  }
}

/**
 * Get active trace by ID
 */
function getTrace(traceId) {
  return activeTraces.get(traceId);
}

/**
 * Get all active traces
 */
function getActiveTraces() {
  return Array.from(activeTraces.values());
}

/**
 * Get trace statistics
 */
function getTraceStats() {
  const traces = Array.from(activeTraces.values());

  return {
    activeTraces: traces.length,
    byMethod: groupBy(traces, 'method'),
    byPath: groupBy(traces, 'path'),
    avgDuration: traces.length > 0
      ? traces.reduce((sum, t) => sum + (Date.now() - t.startTime), 0) / traces.length
      : 0
  };
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const value = item[key];
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

module.exports = {
  createRequestTracer,
  traceQuery,
  traceExternalCall,
  getTrace,
  getActiveTraces,
  getTraceStats
};
