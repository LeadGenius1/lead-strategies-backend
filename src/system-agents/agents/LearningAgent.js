/**
 * Learning Agent - The Brain
 * AI Lead Strategies LLC
 *
 * Pattern recognition and playbook updates
 */

const { createLogger } = require('../utils/logger');
const { generateId, generateHash } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const config = require('../config');

const logger = createLogger('Learning');

class LearningAgent {
  constructor() {
    this.name = 'Learning';
    this.running = false;
    this.db = null;
    this.redis = null;
    this.subscriptionIds = [];
    this.patterns = new Map();
    this.learningQueue = [];
    this.consolidationInterval = null;
  }

  /**
   * Initialize the agent
   */
  async initialize(options = {}) {
    const { db, redis } = options;
    this.db = db;
    this.redis = redis;

    // Load existing patterns
    await this.loadPatterns();

    logger.lifecycle('starting');
  }

  /**
   * Load patterns from database/Redis
   */
  async loadPatterns() {
    // Load from Redis first (faster)
    if (this.redis) {
      try {
        const keys = await this.redis.keys('pattern:*');
        for (const key of keys) {
          const data = await this.redis.get(key);
          if (data) {
            const pattern = JSON.parse(data);
            this.patterns.set(pattern.patternHash, pattern);
          }
        }
        logger.info(`Loaded ${this.patterns.size} patterns from Redis`);
      } catch (error) {
        logger.warn('Failed to load patterns from Redis', { error: error.message });
      }
    }

    // Load from database
    if (this.db) {
      try {
        const dbPatterns = await this.db.learningPattern.findMany({
          where: { successRate: { gte: 0.5 } },
          orderBy: { successCount: 'desc' },
          take: 1000
        });

        for (const pattern of dbPatterns) {
          if (!this.patterns.has(pattern.patternHash)) {
            this.patterns.set(pattern.patternHash, {
              ...pattern,
              symptoms: pattern.symptoms,
              successRate: parseFloat(pattern.successRate)
            });
          }
        }

        logger.info(`Loaded ${dbPatterns.length} patterns from database`);
      } catch (error) {
        logger.warn('Failed to load patterns from database', { error: error.message });
      }
    }
  }

  /**
   * Start the agent
   */
  async start() {
    if (this.running) {
      logger.warn('Learning Agent already running');
      return;
    }

    this.running = true;

    // Subscribe to repair completions
    const repairSubId = await eventBus.subscribe(
      CHANNELS.REPAIR_COMPLETE,
      this.handleRepairComplete.bind(this),
      this.name
    );
    this.subscriptionIds.push(repairSubId);

    // Subscribe to diagnoses
    const diagnosisSubId = await eventBus.subscribe(
      CHANNELS.DIAGNOSIS,
      this.handleDiagnosis.bind(this),
      this.name
    );
    this.subscriptionIds.push(diagnosisSubId);

    // Start consolidation interval
    this.startConsolidation();

    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Handle repair completion - learn from it
   */
  async handleRepairComplete(event) {
    if (!this.running) return;

    const { alertId, diagnosis, result } = event.data;

    // Queue for learning
    this.learningQueue.push({
      alertId,
      diagnosis,
      result,
      timestamp: new Date()
    });

    // Process immediately if successful
    if (result.success) {
      await this.learnFromRepair(alertId, diagnosis, result);
    }
  }

  /**
   * Handle diagnosis - check for known patterns
   */
  async handleDiagnosis(event) {
    if (!this.running) return;

    const { alertId, diagnosis } = event.data;

    // Check if we have a known pattern
    const knownPattern = this.findMatchingPattern(diagnosis);

    if (knownPattern && knownPattern.autoFixEnabled) {
      logger.info('Found matching pattern with auto-fix enabled', {
        patternId: knownPattern.patternHash,
        successRate: knownPattern.successRate
      });

      // Publish pattern match
      await eventBus.publish(CHANNELS.PATTERN_LEARNED, {
        source: this.name,
        alertId,
        pattern: knownPattern,
        action: 'PATTERN_MATCHED'
      });
    }
  }

  /**
   * Learn from a successful repair
   */
  async learnFromRepair(alertId, diagnosis, result) {
    // Create pattern signature
    const symptoms = {
      alertType: diagnosis.alertType || 'unknown',
      component: diagnosis.component || 'unknown',
      fixType: diagnosis.fixType,
      severity: diagnosis.severity
    };

    const patternHash = generateHash(symptoms);

    // Get or create pattern
    let pattern = this.patterns.get(patternHash);

    if (pattern) {
      // Update existing pattern
      if (result.success) {
        pattern.successCount++;
      } else {
        pattern.failureCount++;
      }

      pattern.successRate = pattern.successCount / (pattern.successCount + pattern.failureCount);
      pattern.lastAppliedAt = new Date();
      pattern.updatedAt = new Date();

      // Calculate average fix time
      const newFixTime = result.duration || 60000;
      pattern.avgFixTimeSeconds = Math.round(
        (pattern.avgFixTimeSeconds * (pattern.successCount - 1) + newFixTime / 1000) / pattern.successCount
      );

      // Enable auto-fix if success rate is high enough
      if (
        pattern.successRate >= config.agents.learning.minSuccessRate &&
        pattern.successCount >= config.agents.learning.minOccurrences
      ) {
        if (!pattern.autoFixEnabled) {
          pattern.autoFixEnabled = true;
          logger.info('Auto-fix enabled for pattern', {
            patternHash,
            successRate: pattern.successRate,
            occurrences: pattern.successCount
          });
        }
      }

    } else {
      // Create new pattern
      pattern = {
        id: generateId(),
        patternHash,
        symptoms,
        rootCause: diagnosis.rootCause,
        solution: diagnosis.suggestedFix,
        successCount: result.success ? 1 : 0,
        failureCount: result.success ? 0 : 1,
        successRate: result.success ? 1 : 0,
        avgFixTimeSeconds: Math.round((result.duration || 60000) / 1000),
        autoFixEnabled: false,
        lastAppliedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.patterns.set(patternHash, pattern);

      logger.info('New pattern learned', {
        patternHash,
        alertType: symptoms.alertType,
        fixType: symptoms.fixType
      });
    }

    // Save to Redis for fast access
    if (this.redis) {
      try {
        await this.redis.set(
          `pattern:${patternHash}`,
          JSON.stringify(pattern),
          'EX',
          config.agents.learning.patternExpiry * 24 * 60 * 60
        );
      } catch (error) {
        logger.warn('Failed to save pattern to Redis', { error: error.message });
      }
    }

    // Publish pattern update
    await eventBus.publish(CHANNELS.PATTERN_LEARNED, {
      source: this.name,
      pattern,
      action: result.success ? 'PATTERN_REINFORCED' : 'PATTERN_WEAKENED'
    });

    return pattern;
  }

  /**
   * Find matching pattern for a diagnosis
   */
  findMatchingPattern(diagnosis) {
    const symptoms = {
      alertType: diagnosis.alertType || 'unknown',
      component: diagnosis.component || 'unknown',
      fixType: diagnosis.fixType,
      severity: diagnosis.severity
    };

    const patternHash = generateHash(symptoms);
    let pattern = this.patterns.get(patternHash);

    if (pattern) return pattern;

    // Try fuzzy matching (same alert type and fix type)
    for (const [, p] of this.patterns) {
      if (
        p.symptoms.alertType === symptoms.alertType &&
        p.symptoms.fixType === symptoms.fixType &&
        p.successRate >= config.agents.learning.minSuccessRate
      ) {
        return p;
      }
    }

    return null;
  }

  /**
   * Start periodic consolidation
   */
  startConsolidation() {
    this.consolidationInterval = setInterval(async () => {
      await this.consolidatePatterns();
    }, config.intervals.learningConsolidation);
  }

  /**
   * Consolidate patterns - save to database, cleanup
   */
  async consolidatePatterns() {
    logger.info('Starting pattern consolidation');

    // Save patterns to database
    if (this.db) {
      for (const [hash, pattern] of this.patterns) {
        try {
          await this.db.learningPattern.upsert({
            where: { patternHash: hash },
            create: {
              patternHash: hash,
              symptoms: pattern.symptoms,
              rootCause: pattern.rootCause,
              solution: pattern.solution,
              successCount: pattern.successCount,
              failureCount: pattern.failureCount,
              avgFixTimeSeconds: pattern.avgFixTimeSeconds,
              autoFixEnabled: pattern.autoFixEnabled,
              lastAppliedAt: pattern.lastAppliedAt
            },
            update: {
              successCount: pattern.successCount,
              failureCount: pattern.failureCount,
              avgFixTimeSeconds: pattern.avgFixTimeSeconds,
              autoFixEnabled: pattern.autoFixEnabled,
              lastAppliedAt: pattern.lastAppliedAt,
              updatedAt: new Date()
            }
          });
        } catch (error) {
          logger.warn('Failed to save pattern to database', { hash, error: error.message });
        }
      }
    }

    // Cleanup old/weak patterns
    const now = Date.now();
    const expiryMs = config.agents.learning.patternExpiry * 24 * 60 * 60 * 1000;

    for (const [hash, pattern] of this.patterns) {
      const age = now - new Date(pattern.lastAppliedAt).getTime();

      // Remove if old and weak
      if (age > expiryMs && pattern.successRate < 0.5) {
        this.patterns.delete(hash);
        logger.debug('Removed weak pattern', { hash });

        if (this.redis) {
          await this.redis.del(`pattern:${hash}`).catch(() => {});
        }
      }
    }

    // Publish consolidation report
    await eventBus.publish(CHANNELS.PLAYBOOK_UPDATE, {
      source: this.name,
      totalPatterns: this.patterns.size,
      autoFixPatterns: Array.from(this.patterns.values()).filter(p => p.autoFixEnabled).length,
      timestamp: new Date().toISOString()
    });

    logger.info('Pattern consolidation complete', {
      totalPatterns: this.patterns.size
    });
  }

  /**
   * Get pattern statistics
   */
  getStats() {
    const patterns = Array.from(this.patterns.values());

    return {
      totalPatterns: patterns.length,
      autoFixEnabled: patterns.filter(p => p.autoFixEnabled).length,
      avgSuccessRate: patterns.length > 0
        ? (patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length * 100).toFixed(1) + '%'
        : '0%',
      byAlertType: this.groupByAlertType(patterns),
      topPatterns: patterns
        .sort((a, b) => b.successCount - a.successCount)
        .slice(0, 5)
        .map(p => ({
          alertType: p.symptoms.alertType,
          fixType: p.symptoms.fixType,
          successRate: (p.successRate * 100).toFixed(1) + '%',
          occurrences: p.successCount
        }))
    };
  }

  /**
   * Group patterns by alert type
   */
  groupByAlertType(patterns) {
    const groups = {};

    for (const pattern of patterns) {
      const type = pattern.symptoms.alertType;
      if (!groups[type]) {
        groups[type] = { count: 0, autoFix: 0 };
      }
      groups[type].count++;
      if (pattern.autoFixEnabled) {
        groups[type].autoFix++;
      }
    }

    return groups;
  }

  /**
   * Get playbook (all patterns with auto-fix)
   */
  getPlaybook() {
    return Array.from(this.patterns.values())
      .filter(p => p.autoFixEnabled)
      .map(p => ({
        patternHash: p.patternHash,
        symptoms: p.symptoms,
        solution: p.solution,
        successRate: p.successRate,
        avgFixTime: p.avgFixTimeSeconds
      }));
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    // Final consolidation
    await this.consolidatePatterns();

    // Clear interval
    if (this.consolidationInterval) {
      clearInterval(this.consolidationInterval);
    }

    // Unsubscribe
    for (const subId of this.subscriptionIds) {
      await eventBus.unsubscribe(subId);
    }

    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { LearningAgent };
