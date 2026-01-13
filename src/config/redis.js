// Redis Configuration
// Supports both Redis (ioredis) and fallback to in-memory if not available

let redisClient = null;
let redisStore = null;
let isRedisAvailable = false;

const REDIS_URL = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_TLS = process.env.REDIS_TLS === 'true';

/**
 * Initialize Redis connection
 * Falls back gracefully if Redis is not available
 */
async function initializeRedis() {
  try {
    // Try to use Redis if URL or host is provided
    if (REDIS_URL || (REDIS_HOST && REDIS_HOST !== 'localhost')) {
      const Redis = require('ioredis');
      
      const redisConfig = REDIS_URL
        ? {
            // Use full URL (Railway, Redis Cloud, etc.)
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
              const delay = Math.min(times * 50, 2000);
              return delay;
            },
            ...(REDIS_TLS && { tls: {} }),
          }
        : {
            // Use host/port configuration
            host: REDIS_HOST,
            port: parseInt(REDIS_PORT),
            password: REDIS_PASSWORD,
            enableReadyCheck: true,
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
              const delay = Math.min(times * 50, 2000);
              return delay;
            },
            ...(REDIS_TLS && { tls: {} }),
          };

      redisClient = REDIS_URL 
        ? new Redis(REDIS_URL, redisConfig)
        : new Redis(redisConfig);

      // Test connection
      await redisClient.ping();
      
      isRedisAvailable = true;
      console.log('✅ Redis connected successfully');
      
      // Handle Redis errors gracefully
      redisClient.on('error', (err) => {
        console.error('Redis connection error:', err.message);
        isRedisAvailable = false;
      });

      redisClient.on('connect', () => {
        console.log('Redis connection established');
        isRedisAvailable = true;
      });

      redisClient.on('ready', () => {
        console.log('Redis client ready');
        isRedisAvailable = true;
      });

      redisClient.on('close', () => {
        console.log('Redis connection closed');
        isRedisAvailable = false;
      });

      // Create store for express-rate-limit
      const { RedisStore } = require('rate-limit-redis');
      redisStore = new RedisStore({
        client: redisClient,
        prefix: 'rl:',
      });

      return { client: redisClient, store: redisStore, available: true };
    } else {
      console.log('⚠️  Redis not configured, using in-memory rate limiting');
      return { client: null, store: undefined, available: false };
    }
  } catch (error) {
    console.warn('⚠️  Redis initialization failed, falling back to in-memory:', error.message);
    isRedisAvailable = false;
    return { client: null, store: undefined, available: false };
  }
}

/**
 * Get Redis client (returns null if not available)
 */
function getRedisClient() {
  return redisClient;
}

/**
 * Check if Redis is available
 */
function isRedisReady() {
  return isRedisAvailable && redisClient && redisClient.status === 'ready';
}

/**
 * Get Redis store for rate limiting
 */
function getRedisStore() {
  return redisStore;
}

/**
 * Health check for Redis
 */
async function checkRedisHealth() {
  if (!isRedisAvailable || !redisClient) {
    return {
      status: 'unavailable',
      message: 'Redis not configured or not connected',
    };
  }

  try {
    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;

    return {
      status: 'healthy',
      latency: `${latency}ms`,
      connected: redisClient.status === 'ready',
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
    };
  }
}

/**
 * Gracefully close Redis connection
 */
async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('Redis connection closed gracefully');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Handle process termination
process.on('SIGTERM', closeRedis);
process.on('SIGINT', closeRedis);

module.exports = {
  initializeRedis,
  getRedisClient,
  getRedisStore,
  isRedisReady,
  checkRedisHealth,
  closeRedis,
};
