/**
 * Security Agent - The Guardian
 * AI Lead Strategies LLC
 *
 * Real-time threat detection and mitigation
 */

const { createLogger } = require('../utils/logger');
const { generateId, RateLimiter } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const config = require('../config');

const logger = createLogger('Security');

// Threat detection patterns
const THREAT_PATTERNS = {
  SQL_INJECTION: /('|"|;|--|\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|EXECUTE)\b)/i,
  XSS_ATTEMPT: /(<script|javascript:|on\w+\s*=|<iframe|<object|<embed)/i,
  PATH_TRAVERSAL: /\.\.\//,
  COMMAND_INJECTION: /(\||;|`|\$\(|&&)/,
  LDAP_INJECTION: /(\*|\(|\)|\\)/,
  HEADER_INJECTION: /[\r\n]/
};

class SecurityAgent {
  constructor() {
    this.name = 'Security';
    this.running = false;
    this.db = null;
    this.redis = null;
    this.scanInterval = null;

    // Track suspicious activity
    this.failedLogins = new Map();
    this.blockedIPs = new Set();
    this.suspiciousPatterns = new Map();

    // Rate limiter for brute force detection
    this.loginLimiter = new RateLimiter(
      config.agents.security.maxFailedLogins,
      config.agents.security.lockoutDuration
    );
  }

  /**
   * Initialize the agent
   */
  async initialize(options = {}) {
    const { db, redis } = options;
    this.db = db;
    this.redis = redis;

    // Load blocked IPs from Redis
    await this.loadBlockedIPs();

    logger.lifecycle('starting');
  }

  /**
   * Load blocked IPs from Redis
   */
  async loadBlockedIPs() {
    if (!this.redis) return;

    try {
      const keys = await this.redis.keys('blocked:ip:*');
      for (const key of keys) {
        const ip = key.replace('blocked:ip:', '');
        this.blockedIPs.add(ip);
      }
      logger.info(`Loaded ${this.blockedIPs.size} blocked IPs`);
    } catch (error) {
      logger.warn('Failed to load blocked IPs', { error: error.message });
    }
  }

  /**
   * Start the agent
   */
  async start() {
    if (this.running) {
      logger.warn('Security Agent already running');
      return;
    }

    this.running = true;

    // Start security scanning loop
    this.startScanning();

    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Start periodic security scanning
   */
  startScanning() {
    this.scanInterval = setInterval(async () => {
      if (!this.running) return;

      await this.runSecurityScan();
    }, config.intervals.securityScan);
  }

  /**
   * Run security scan
   */
  async runSecurityScan() {
    try {
      // Check for brute force patterns
      await this.detectBruteForce();

      // Check for rate limit abuse
      await this.detectRateLimitAbuse();

      // Cleanup expired blocks
      await this.cleanupExpiredBlocks();

      // Record security metrics
      await metricsStore.record(METRIC_NAMES.BLOCKED_IPS, this.blockedIPs.size, {
        component: 'security'
      });

    } catch (error) {
      logger.error('Security scan failed', { error: error.message });
    }
  }

  /**
   * Analyze a request for threats
   * Call this from middleware to check incoming requests
   */
  async analyzeRequest(request) {
    const { ip, path, method, body, headers, userId } = request;

    // Check if IP is blocked
    if (this.blockedIPs.has(ip)) {
      return {
        blocked: true,
        reason: 'IP is blocked',
        threatType: 'BLOCKED_IP'
      };
    }

    // Check for SQL injection
    const sqlInjection = this.detectSQLInjection(path, body);
    if (sqlInjection) {
      await this.handleThreat({
        type: 'SQL_INJECTION',
        ip,
        path,
        payload: sqlInjection,
        userId,
        severity: config.severity.CRITICAL
      });
      return { blocked: true, reason: 'SQL injection detected', threatType: 'SQL_INJECTION' };
    }

    // Check for XSS
    const xssAttempt = this.detectXSS(path, body);
    if (xssAttempt) {
      await this.handleThreat({
        type: 'XSS_ATTEMPT',
        ip,
        path,
        payload: xssAttempt,
        userId,
        severity: config.severity.HIGH
      });
      return { blocked: true, reason: 'XSS attempt detected', threatType: 'XSS_ATTEMPT' };
    }

    // Check for path traversal
    if (THREAT_PATTERNS.PATH_TRAVERSAL.test(path)) {
      await this.handleThreat({
        type: 'PATH_TRAVERSAL',
        ip,
        path,
        userId,
        severity: config.severity.HIGH
      });
      return { blocked: true, reason: 'Path traversal detected', threatType: 'PATH_TRAVERSAL' };
    }

    // Check for command injection in body
    const cmdInjection = this.detectCommandInjection(body);
    if (cmdInjection) {
      await this.handleThreat({
        type: 'COMMAND_INJECTION',
        ip,
        path,
        payload: cmdInjection,
        userId,
        severity: config.severity.CRITICAL
      });
      return { blocked: true, reason: 'Command injection detected', threatType: 'COMMAND_INJECTION' };
    }

    return { blocked: false };
  }

  /**
   * Detect SQL injection patterns
   */
  detectSQLInjection(path, body) {
    const checkString = (str) => {
      if (typeof str !== 'string') return null;
      const match = str.match(THREAT_PATTERNS.SQL_INJECTION);
      return match ? match[0] : null;
    };

    // Check path
    const pathMatch = checkString(path);
    if (pathMatch) return pathMatch;

    // Check body recursively
    if (body && typeof body === 'object') {
      for (const value of Object.values(body)) {
        if (typeof value === 'string') {
          const match = checkString(value);
          if (match) return match;
        } else if (typeof value === 'object') {
          const match = this.detectSQLInjection('', value);
          if (match) return match;
        }
      }
    }

    return null;
  }

  /**
   * Detect XSS patterns
   */
  detectXSS(path, body) {
    const checkString = (str) => {
      if (typeof str !== 'string') return null;
      const match = str.match(THREAT_PATTERNS.XSS_ATTEMPT);
      return match ? match[0] : null;
    };

    const pathMatch = checkString(decodeURIComponent(path));
    if (pathMatch) return pathMatch;

    if (body && typeof body === 'object') {
      for (const value of Object.values(body)) {
        if (typeof value === 'string') {
          const match = checkString(value);
          if (match) return match;
        }
      }
    }

    return null;
  }

  /**
   * Detect command injection
   */
  detectCommandInjection(body) {
    if (!body || typeof body !== 'object') return null;

    const checkString = (str) => {
      if (typeof str !== 'string') return null;
      const match = str.match(THREAT_PATTERNS.COMMAND_INJECTION);
      return match ? match[0] : null;
    };

    for (const value of Object.values(body)) {
      if (typeof value === 'string') {
        const match = checkString(value);
        if (match) return match;
      }
    }

    return null;
  }

  /**
   * Record a failed login attempt
   */
  async recordFailedLogin(ip, userId, email) {
    // Track by IP
    const ipKey = `login:${ip}`;
    if (!this.failedLogins.has(ipKey)) {
      this.failedLogins.set(ipKey, []);
    }
    this.failedLogins.get(ipKey).push({
      timestamp: Date.now(),
      userId,
      email
    });

    // Check if should be blocked
    if (!this.loginLimiter.isAllowed(ip)) {
      await this.handleThreat({
        type: 'BRUTE_FORCE',
        ip,
        userId,
        email,
        severity: config.severity.HIGH
      });
    }

    // Record metric
    await metricsStore.record(METRIC_NAMES.FAILED_LOGINS, 1, {
      component: 'security',
      tags: { ip }
    });
  }

  /**
   * Detect brute force patterns
   */
  async detectBruteForce() {
    const now = Date.now();
    const window = config.agents.security.lockoutDuration;

    for (const [key, attempts] of this.failedLogins) {
      // Filter to recent attempts
      const recentAttempts = attempts.filter(a => now - a.timestamp < window);
      this.failedLogins.set(key, recentAttempts);

      if (recentAttempts.length >= config.agents.security.maxFailedLogins) {
        const ip = key.replace('login:', '');
        if (!this.blockedIPs.has(ip)) {
          await this.handleThreat({
            type: 'BRUTE_FORCE',
            ip,
            attemptCount: recentAttempts.length,
            severity: config.severity.HIGH
          });
        }
      }
    }
  }

  /**
   * Detect rate limit abuse
   */
  async detectRateLimitAbuse() {
    const metrics = metricsStore.get(METRIC_NAMES.API_REQUEST_COUNT, { limit: 100 });

    // This would analyze request patterns to detect abuse
    // Simplified implementation
  }

  /**
   * Handle detected threat
   */
  async handleThreat(threat) {
    const incident = {
      id: generateId(),
      ...threat,
      timestamp: new Date(),
      mitigationAction: null,
      blocked: false
    };

    // Determine mitigation action
    switch (threat.type) {
      case 'SQL_INJECTION':
      case 'COMMAND_INJECTION':
        incident.mitigationAction = 'BLOCK_IP_PERMANENT';
        await this.blockIP(threat.ip, 0); // Permanent block
        incident.blocked = true;
        break;

      case 'XSS_ATTEMPT':
      case 'PATH_TRAVERSAL':
        incident.mitigationAction = 'BLOCK_IP_24H';
        await this.blockIP(threat.ip, config.agents.security.ipBlockDuration);
        incident.blocked = true;
        break;

      case 'BRUTE_FORCE':
        incident.mitigationAction = 'BLOCK_IP_1H';
        await this.blockIP(threat.ip, config.agents.security.lockoutDuration);
        incident.blocked = true;

        // Also lock the account if userId known
        if (threat.userId) {
          await this.lockAccount(threat.userId);
        }
        break;

      case 'RATE_LIMIT_ABUSE':
        incident.mitigationAction = 'THROTTLE_IP';
        await this.throttleIP(threat.ip);
        break;
    }

    // Store incident
    await this.storeIncident(incident);

    // Publish threat event
    await eventBus.publish(CHANNELS.THREAT_DETECTED, {
      source: this.name,
      incident
    });

    // Create alert
    await alertManager.create(config.alertTypes.SECURITY_THREAT, {
      component: 'security',
      message: `Security threat detected: ${threat.type} from ${threat.ip}`,
      severity: threat.severity,
      metadata: incident
    });

    logger.alert('SECURITY_THREAT', threat.severity, `${threat.type} from ${threat.ip}`, {
      incidentId: incident.id,
      mitigation: incident.mitigationAction
    });

    // Record metric
    await metricsStore.record(METRIC_NAMES.SECURITY_INCIDENTS, 1, {
      component: 'security',
      tags: { type: threat.type }
    });

    return incident;
  }

  /**
   * Block an IP address
   */
  async blockIP(ip, duration = config.agents.security.ipBlockDuration) {
    this.blockedIPs.add(ip);

    // Store in Redis with TTL
    if (this.redis) {
      try {
        if (duration > 0) {
          await this.redis.set(`blocked:ip:${ip}`, '1', 'PX', duration);
        } else {
          await this.redis.set(`blocked:ip:${ip}`, '1'); // No expiry
        }
      } catch (error) {
        logger.warn('Failed to store blocked IP in Redis', { error: error.message });
      }
    }

    logger.info(`Blocked IP: ${ip}`, { duration: duration > 0 ? `${duration}ms` : 'permanent' });

    // Publish mitigation event
    await eventBus.publish(CHANNELS.MITIGATION, {
      source: this.name,
      action: 'BLOCK_IP',
      ip,
      duration
    });
  }

  /**
   * Unblock an IP address
   */
  async unblockIP(ip) {
    this.blockedIPs.delete(ip);

    if (this.redis) {
      await this.redis.del(`blocked:ip:${ip}`).catch(() => {});
    }

    logger.info(`Unblocked IP: ${ip}`);
  }

  /**
   * Throttle an IP address
   */
  async throttleIP(ip) {
    // Store throttle flag in Redis
    if (this.redis) {
      await this.redis.set(
        `throttle:ip:${ip}`,
        '1',
        'PX',
        config.agents.security.lockoutDuration
      ).catch(() => {});
    }

    logger.info(`Throttled IP: ${ip}`);
  }

  /**
   * Lock a user account
   */
  async lockAccount(userId) {
    if (!this.db) return;

    try {
      await this.db.user.update({
        where: { id: userId },
        data: {
          lockedAt: new Date(),
          lockedUntil: new Date(Date.now() + config.agents.security.lockoutDuration)
        }
      });
      logger.info(`Locked account: ${userId}`);
    } catch (error) {
      logger.warn('Failed to lock account', { error: error.message, userId });
    }
  }

  /**
   * Store security incident
   */
  async storeIncident(incident) {
    if (!this.db) return;

    try {
      await this.db.securityIncident.create({
        data: {
          threatType: incident.type,
          severity: incident.severity,
          sourceIp: incident.ip,
          targetEndpoint: incident.path || null,
          payload: incident.payload || null,
          userId: incident.userId || null,
          mitigationAction: incident.mitigationAction,
          blocked: incident.blocked
        }
      });
    } catch (error) {
      logger.warn('Failed to store security incident', { error: error.message });
    }
  }

  /**
   * Cleanup expired blocks
   */
  async cleanupExpiredBlocks() {
    if (!this.redis) return;

    // Redis handles TTL automatically, but we need to sync local Set
    const keys = await this.redis.keys('blocked:ip:*');
    const currentBlocked = new Set(keys.map(k => k.replace('blocked:ip:', '')));

    // Remove from local set if not in Redis
    for (const ip of this.blockedIPs) {
      if (!currentBlocked.has(ip)) {
        this.blockedIPs.delete(ip);
      }
    }

    // Also cleanup login limiter
    this.loginLimiter.cleanup();
  }

  /**
   * Check if IP is blocked
   */
  isIPBlocked(ip) {
    return this.blockedIPs.has(ip);
  }

  /**
   * Get security statistics
   */
  getStats() {
    return {
      blockedIPs: this.blockedIPs.size,
      recentFailedLogins: Array.from(this.failedLogins.values())
        .reduce((sum, attempts) => sum + attempts.length, 0),
      blockedIPsList: Array.from(this.blockedIPs).slice(0, 10)
    };
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { SecurityAgent };
