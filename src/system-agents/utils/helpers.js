/**
 * Self-Healing System Helpers
 * AI Lead Strategies LLC
 *
 * Utility functions for all agents
 */

const crypto = require('crypto');
const os = require('os');

/**
 * Generate a unique ID
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Generate a hash from data (for pattern matching)
 */
function generateHash(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
    onRetry = () => {}
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        onRetry(error, attempt);
        await sleep(Math.min(delay, maxDelay));
        delay *= factor;
      }
    }
  }

  throw lastError;
}

/**
 * Timeout wrapper for async functions
 */
async function withTimeout(promise, ms, errorMessage = 'Operation timed out') {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), ms);
  });

  return Promise.race([promise, timeout]);
}

/**
 * Get system metrics
 */
function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  // Calculate CPU usage
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(2);

  return {
    cpu: {
      usage: parseFloat(cpuUsage),
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown'
    },
    memory: {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      usagePercent: ((usedMemory / totalMemory) * 100).toFixed(2)
    },
    uptime: os.uptime(),
    loadAverage: os.loadavg(),
    platform: os.platform(),
    hostname: os.hostname()
  };
}

/**
 * Get Node.js process metrics
 */
function getProcessMetrics() {
  const memoryUsage = process.memoryUsage();

  return {
    pid: process.pid,
    uptime: process.uptime(),
    memory: {
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      rss: memoryUsage.rss,
      heapUsagePercent: ((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100).toFixed(2)
    },
    version: process.version
  };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Calculate percentile from an array of numbers
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0;

  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate average from an array of numbers
 */
function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(arr) {
  if (arr.length === 0) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(average(squareDiffs));
}

/**
 * Detect anomalies using z-score
 */
function detectAnomalies(arr, threshold = 2) {
  const avg = average(arr);
  const std = standardDeviation(arr);

  if (std === 0) return [];

  return arr
    .map((value, index) => ({ value, index, zScore: Math.abs((value - avg) / std) }))
    .filter(item => item.zScore > threshold);
}

/**
 * Simple linear regression for predictions
 */
function linearRegression(data) {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, predict: () => 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

  data.forEach((point, i) => {
    const x = i;
    const y = point;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return {
    slope,
    intercept,
    predict: (x) => slope * x + intercept
  };
}

/**
 * Throttle function execution
 */
function throttle(fn, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Debounce function execution
 */
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Safe JSON parse with default value
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Truncate string with ellipsis
 */
function truncate(str, maxLength = 100) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Group array by key
 */
function groupBy(arr, key) {
  return arr.reduce((groups, item) => {
    const value = typeof key === 'function' ? key(item) : item[key];
    (groups[value] = groups[value] || []).push(item);
    return groups;
  }, {});
}

/**
 * Rate limiter class
 */
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing requests for this key
    let keyRequests = this.requests.get(key) || [];

    // Filter out old requests
    keyRequests = keyRequests.filter(time => time > windowStart);

    // Check if under limit
    if (keyRequests.length >= this.maxRequests) {
      return false;
    }

    // Add new request
    keyRequests.push(now);
    this.requests.set(key, keyRequests);

    return true;
  }

  reset(key) {
    this.requests.delete(key);
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => time > windowStart);
      if (validRequests.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validRequests);
      }
    }
  }
}

/**
 * Circuit breaker class
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailure = null;
    this.successCount = 0;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();

      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= 3) {
          this.reset();
        }
      }

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successCount = 0;
    this.lastFailure = null;
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure
    };
  }
}

module.exports = {
  generateId,
  generateHash,
  sleep,
  retry,
  withTimeout,
  getSystemMetrics,
  getProcessMetrics,
  formatBytes,
  formatDuration,
  percentile,
  average,
  standardDeviation,
  detectAnomalies,
  linearRegression,
  throttle,
  debounce,
  deepClone,
  safeJsonParse,
  truncate,
  groupBy,
  RateLimiter,
  CircuitBreaker
};
