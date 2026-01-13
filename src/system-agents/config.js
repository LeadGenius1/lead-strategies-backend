/**
 * Self-Healing System Configuration
 * AI Lead Strategies LLC
 *
 * Centralized configuration for all 7 autonomous agents
 */

module.exports = {
  // System identification
  system: {
    name: 'AI Lead Strategies Self-Healing System',
    version: '1.0.0',
    platforms: ['leadsite.ai', 'leadsite.io', 'clientcontact.io', 'tackleai.ai', 'videosite.io']
  },

  // Monitor Agent thresholds
  thresholds: {
    api: {
      responseTime: parseInt(process.env.API_RESPONSE_THRESHOLD_MS) || 500,      // ms
      errorRate: parseFloat(process.env.API_ERROR_RATE_THRESHOLD) || 1,          // percent
      timeout: parseInt(process.env.API_TIMEOUT_MS) || 10000                      // ms
    },
    database: {
      queryTime: parseInt(process.env.DB_QUERY_THRESHOLD_MS) || 100,             // ms
      connectionPoolUsage: parseInt(process.env.DB_POOL_THRESHOLD) || 80,        // percent
      slowQueryThreshold: parseInt(process.env.DB_SLOW_QUERY_MS) || 500          // ms
    },
    memory: {
      usage: parseInt(process.env.MEMORY_THRESHOLD_PERCENT) || 85,               // percent
      heapUsage: parseInt(process.env.HEAP_THRESHOLD_PERCENT) || 90              // percent
    },
    cpu: {
      usage: parseInt(process.env.CPU_THRESHOLD_PERCENT) || 80                   // percent
    },
    disk: {
      usage: parseInt(process.env.DISK_THRESHOLD_PERCENT) || 90                  // percent
    },
    email: {
      bounceRate: parseFloat(process.env.EMAIL_BOUNCE_THRESHOLD) || 5,           // percent
      deliveryRate: parseFloat(process.env.EMAIL_DELIVERY_THRESHOLD) || 95       // percent
    },
    queue: {
      depth: parseInt(process.env.QUEUE_DEPTH_THRESHOLD) || 1000,                // jobs
      processingTime: parseInt(process.env.QUEUE_PROCESSING_MS) || 30000         // ms
    },
    redis: {
      responseTime: parseInt(process.env.REDIS_RESPONSE_THRESHOLD_MS) || 50,     // ms
      memoryUsage: parseInt(process.env.REDIS_MEMORY_THRESHOLD) || 80            // percent
    }
  },

  // Monitoring intervals
  intervals: {
    healthCheck: parseInt(process.env.MONITOR_INTERVAL_MS) || 5000,              // 5 seconds
    metricsCollection: parseInt(process.env.METRICS_INTERVAL_MS) || 10000,       // 10 seconds
    predictiveAnalysis: parseInt(process.env.PREDICTIVE_INTERVAL_MS) || 300000,  // 5 minutes
    learningConsolidation: parseInt(process.env.LEARNING_INTERVAL_MS) || 86400000, // 24 hours
    securityScan: parseInt(process.env.SECURITY_SCAN_INTERVAL_MS) || 60000,      // 1 minute
    performanceAnalysis: parseInt(process.env.PERF_ANALYSIS_INTERVAL_MS) || 60000 // 1 minute
  },

  // Agent-specific settings
  agents: {
    monitor: {
      enabled: process.env.MONITOR_AGENT_ENABLED !== 'false',
      endpoints: [
        '/health',
        '/api/v1/health'
        // Removed /api/v1/campaigns and /api/v1/leads - they require authentication
      ],
      externalServices: [
        { name: 'OpenAI', url: 'https://api.openai.com/v1/models', timeout: 5000 },
        { name: 'Anthropic', url: 'https://api.anthropic.com/v1/messages', timeout: 5000 },
        { name: 'SendGrid', url: 'https://api.sendgrid.com/v3/user/webhooks/parse/stats', timeout: 5000 }
      ]
    },

    diagnostic: {
      enabled: process.env.DIAGNOSTIC_AGENT_ENABLED !== 'false',
      aiModel: process.env.DIAGNOSTIC_AI_MODEL || 'claude-sonnet-4-20250514',
      maxLogLines: parseInt(process.env.DIAGNOSTIC_MAX_LOGS) || 1000,
      confidenceThreshold: parseFloat(process.env.DIAGNOSTIC_CONFIDENCE_THRESHOLD) || 0.8,
      maxTokens: parseInt(process.env.DIAGNOSTIC_MAX_TOKENS) || 2000
    },

    repair: {
      enabled: process.env.REPAIR_AGENT_ENABLED !== 'false',
      maxRetries: parseInt(process.env.REPAIR_MAX_RETRIES) || 3,
      verificationTimeout: parseInt(process.env.REPAIR_VERIFY_TIMEOUT_MS) || 60000,
      autoFixEnabled: process.env.REPAIR_AUTO_FIX_ENABLED !== 'false',
      allowedFixes: [
        'DATABASE_INDEX',
        'SERVICE_RESTART',
        'CACHE_CLEAR',
        'EMAIL_FAILOVER',
        'MEMORY_CLEANUP',
        'CONNECTION_POOL_EXPAND',
        'RATE_LIMIT_ADJUST'
      ]
    },

    learning: {
      enabled: process.env.LEARNING_AGENT_ENABLED !== 'false',
      minSuccessRate: parseFloat(process.env.LEARNING_MIN_SUCCESS_RATE) || 0.95,
      minOccurrences: parseInt(process.env.LEARNING_MIN_OCCURRENCES) || 3,
      patternExpiry: parseInt(process.env.LEARNING_PATTERN_EXPIRY_DAYS) || 90
    },

    predictive: {
      enabled: process.env.PREDICTIVE_AGENT_ENABLED !== 'false',
      forecastHorizon: parseInt(process.env.PREDICTIVE_HORIZON_HOURS) || 72,
      minDataPoints: parseInt(process.env.PREDICTIVE_MIN_DATA_POINTS) || 24,
      confidenceThreshold: parseFloat(process.env.PREDICTIVE_CONFIDENCE) || 0.7
    },

    security: {
      enabled: process.env.SECURITY_AGENT_ENABLED !== 'false',
      maxFailedLogins: parseInt(process.env.SECURITY_MAX_FAILED_LOGINS) || 5,
      lockoutDuration: parseInt(process.env.SECURITY_LOCKOUT_MS) || 3600000,     // 1 hour
      ipBlockDuration: parseInt(process.env.SECURITY_IP_BLOCK_MS) || 86400000,   // 24 hours
      rateLimitRequests: parseInt(process.env.SECURITY_RATE_LIMIT) || 100,
      rateLimitWindow: parseInt(process.env.SECURITY_RATE_WINDOW_MS) || 60000    // 1 minute
    },

    performance: {
      enabled: process.env.PERFORMANCE_AGENT_ENABLED !== 'false',
      cacheHitRateTarget: parseFloat(process.env.PERF_CACHE_HIT_TARGET) || 0.8,
      queryAnalysisEnabled: process.env.PERF_QUERY_ANALYSIS !== 'false',
      autoOptimizeEnabled: process.env.PERF_AUTO_OPTIMIZE !== 'false'
    }
  },

  // Notification settings
  notifications: {
    slack: {
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || '#system-alerts',
      mentionOnCritical: process.env.SLACK_MENTION || '@channel'
    },
    pagerDuty: {
      enabled: !!process.env.PAGERDUTY_API_KEY,
      apiKey: process.env.PAGERDUTY_API_KEY,
      serviceId: process.env.PAGERDUTY_SERVICE_ID
    },
    email: {
      enabled: !!process.env.ALERT_EMAIL_TO,
      to: process.env.ALERT_EMAIL_TO,
      from: process.env.ALERT_EMAIL_FROM || 'alerts@leadsite.ai'
    }
  },

  // Database settings for self-healing tables
  database: {
    metricsRetentionDays: parseInt(process.env.METRICS_RETENTION_DAYS) || 30,
    alertsRetentionDays: parseInt(process.env.ALERTS_RETENTION_DAYS) || 90,
    patternsRetentionDays: parseInt(process.env.PATTERNS_RETENTION_DAYS) || 365
  },

  // Severity levels
  severity: {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    INFO: 'info'
  },

  // Alert types
  alertTypes: {
    API_SLOW: 'API_SLOW',
    API_DOWN: 'API_DOWN',
    API_ERROR_RATE: 'API_ERROR_RATE',
    DB_SLOW: 'DB_SLOW',
    DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
    DB_POOL_EXHAUSTED: 'DB_POOL_EXHAUSTED',
    MEMORY_HIGH: 'MEMORY_HIGH',
    CPU_HIGH: 'CPU_HIGH',
    DISK_HIGH: 'DISK_HIGH',
    REDIS_SLOW: 'REDIS_SLOW',
    REDIS_DOWN: 'REDIS_DOWN',
    EMAIL_BOUNCE_HIGH: 'EMAIL_BOUNCE_HIGH',
    EMAIL_PROVIDER_DOWN: 'EMAIL_PROVIDER_DOWN',
    QUEUE_BACKLOG: 'QUEUE_BACKLOG',
    EXTERNAL_API_DOWN: 'EXTERNAL_API_DOWN',
    SSL_EXPIRING: 'SSL_EXPIRING',
    SECURITY_THREAT: 'SECURITY_THREAT',
    BRUTE_FORCE: 'BRUTE_FORCE',
    SQL_INJECTION: 'SQL_INJECTION',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
  },

  // Fix types for Repair Agent
  fixTypes: {
    DATABASE_INDEX: 'DATABASE_INDEX',
    SERVICE_RESTART: 'SERVICE_RESTART',
    CACHE_CLEAR: 'CACHE_CLEAR',
    EMAIL_FAILOVER: 'EMAIL_FAILOVER',
    MEMORY_CLEANUP: 'MEMORY_CLEANUP',
    CONNECTION_POOL_EXPAND: 'CONNECTION_POOL_EXPAND',
    RATE_LIMIT_ADJUST: 'RATE_LIMIT_ADJUST',
    IP_BLOCK: 'IP_BLOCK',
    ACCOUNT_LOCK: 'ACCOUNT_LOCK',
    CIRCUIT_BREAKER: 'CIRCUIT_BREAKER'
  },

  // Email provider failover order
  emailProviders: ['sendgrid', 'mailgun', 'ses'],

  // API URLs (for monitoring)
  apiUrls: {
    // Always use localhost for internal monitoring (same server)
    internal: `http://localhost:${process.env.PORT || 3001}`,
    platforms: {
      'leadsite.ai': process.env.LEADSITE_AI_URL || 'https://api.leadsite.ai',
      'leadsite.io': process.env.LEADSITE_IO_URL || 'https://api.leadsite.io',
      'clientcontact.io': process.env.CLIENTCONTACT_URL || 'https://api.clientcontact.io',
      'tackleai.ai': process.env.TACKLEAI_URL || 'https://api.tackleai.ai',
      'videosite.io': process.env.VIDEOSITE_URL || 'https://api.videosite.io'
    }
  }
};
