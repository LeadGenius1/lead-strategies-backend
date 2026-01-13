/**
 * Self-Healing System Orchestrator
 * AI Lead Strategies LLC
 *
 * Main entry point for the 7 autonomous agents
 */

const { systemLogger: logger } = require('./utils/logger');
const { eventBus, CHANNELS } = require('./shared/EventBus');
const { metricsStore } = require('./shared/MetricsStore');
const { alertManager } = require('./shared/AlertManager');
const config = require('./config');

// Import all agents
const { MonitorAgent } = require('./agents/MonitorAgent');
const { DiagnosticAgent } = require('./agents/DiagnosticAgent');
const { RepairAgent } = require('./agents/RepairAgent');
const { LearningAgent } = require('./agents/LearningAgent');
const { PredictiveAgent } = require('./agents/PredictiveAgent');
const { SecurityAgent } = require('./agents/SecurityAgent');
const { PerformanceAgent } = require('./agents/PerformanceAgent');

class SelfHealingSystem {
  constructor() {
    this.agents = new Map();
    this.running = false;
    this.startTime = null;
    this.db = null;
    this.redis = null;
  }

  /**
   * Initialize the self-healing system
   */
  async initialize(options = {}) {
    const { db, redis } = options;
    this.db = db;
    this.redis = redis;

    logger.info('🚀 Initializing Self-Healing System...');
    logger.info(`   Version: ${config.system.version}`);
    logger.info(`   Platforms: ${config.system.platforms.join(', ')}`);

    // Initialize EventBus with Redis if available
    await eventBus.initialize(redis);

    // Initialize MetricsStore
    await metricsStore.initialize({ db, redis });

    // Initialize AlertManager
    await alertManager.initialize({ db });

    // Create agent instances
    this.agents.set('Monitor', new MonitorAgent());
    this.agents.set('Diagnostic', new DiagnosticAgent());
    this.agents.set('Repair', new RepairAgent());
    this.agents.set('Learning', new LearningAgent());
    this.agents.set('Predictive', new PredictiveAgent());
    this.agents.set('Security', new SecurityAgent());
    this.agents.set('Performance', new PerformanceAgent());

    // Initialize each agent
    for (const [name, agent] of this.agents) {
      try {
        await agent.initialize({ db, redis });
        logger.info(`   ✓ ${name} Agent initialized`);
      } catch (error) {
        logger.error(`   ✗ ${name} Agent initialization failed`, { error: error.message });
      }
    }

    logger.info('✅ Self-Healing System initialized');
  }

  /**
   * Start all agents
   */
  async start() {
    if (this.running) {
      logger.warn('Self-Healing System already running');
      return;
    }

    this.running = true;
    this.startTime = new Date();

    logger.info('🔄 Starting all agents...');

    // Start agents in order (dependencies first)
    const startOrder = [
      'Monitor',      // First - starts collecting metrics
      'Security',     // Second - protect the system
      'Diagnostic',   // Third - analyzes alerts from Monitor
      'Repair',       // Fourth - fixes issues from Diagnostic
      'Learning',     // Fifth - learns from repairs
      'Predictive',   // Sixth - predicts future issues
      'Performance'   // Last - optimizes based on all data
    ];

    for (const name of startOrder) {
      const agent = this.agents.get(name);
      if (agent && config.agents[name.toLowerCase()]?.enabled !== false) {
        try {
          await agent.start();
          logger.info(`   ✓ ${name} Agent started`);
        } catch (error) {
          logger.error(`   ✗ ${name} Agent start failed`, { error: error.message });
        }
      } else {
        logger.info(`   ⊘ ${name} Agent disabled`);
      }
    }

    // Publish system status
    await eventBus.publish(CHANNELS.SYSTEM_STATUS, {
      source: 'Orchestrator',
      status: 'running',
      agents: this.getAgentStatus(),
      startTime: this.startTime.toISOString()
    });

    logger.info('✅ All agents started');
    logger.info('');
    logger.info('📊 Self-Healing System Status:');
    logger.info(`   Uptime: Running`);
    logger.info(`   Agents: ${this.agents.size}`);
    logger.info(`   Health Check Interval: ${config.intervals.healthCheck}ms`);
    logger.info('');
  }

  /**
   * Stop all agents
   */
  async stop() {
    if (!this.running) {
      return;
    }

    logger.info('🛑 Stopping Self-Healing System...');

    // Stop agents in reverse order
    const stopOrder = [
      'Performance',
      'Predictive',
      'Learning',
      'Repair',
      'Diagnostic',
      'Security',
      'Monitor'
    ];

    for (const name of stopOrder) {
      const agent = this.agents.get(name);
      if (agent) {
        try {
          await agent.stop();
          logger.info(`   ✓ ${name} Agent stopped`);
        } catch (error) {
          logger.error(`   ✗ ${name} Agent stop failed`, { error: error.message });
        }
      }
    }

    // Shutdown shared services
    await metricsStore.shutdown();
    await alertManager.shutdown();
    await eventBus.shutdown();

    this.running = false;

    logger.info('✅ Self-Healing System stopped');
  }

  /**
   * Get status of all agents
   */
  getAgentStatus() {
    const status = {};

    for (const [name, agent] of this.agents) {
      status[name] = {
        running: agent.running,
        enabled: config.agents[name.toLowerCase()]?.enabled !== false
      };
    }

    return status;
  }

  /**
   * Get system health summary
   */
  getHealthSummary() {
    const monitorAgent = this.agents.get('Monitor');
    const alertStats = alertManager.getStats();
    const learningStats = this.agents.get('Learning')?.getStats() || {};
    const repairStats = this.agents.get('Repair')?.getStats() || {};
    const securityStats = this.agents.get('Security')?.getStats() || {};
    const performanceStats = this.agents.get('Performance')?.getStats() || {};
    const predictiveStats = this.agents.get('Predictive')?.getStats() || {};

    return {
      system: {
        status: this.running ? 'running' : 'stopped',
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        version: config.system.version
      },
      agents: this.getAgentStatus(),
      health: monitorAgent?.getHealthStatus() || { overall: 'unknown' },
      alerts: {
        active: alertStats.active,
        total: alertStats.total,
        autoResolved: alertStats.autoResolved
      },
      repairs: {
        total: repairStats.total || 0,
        successRate: repairStats.successRate || '0%',
        active: repairStats.activeRepairs || 0
      },
      learning: {
        patterns: learningStats.totalPatterns || 0,
        autoFixEnabled: learningStats.autoFixEnabled || 0
      },
      predictions: {
        total: predictiveStats.totalPredictions || 0,
        actionsTaken: predictiveStats.actionsTaken || 0
      },
      security: {
        blockedIPs: securityStats.blockedIPs || 0,
        recentIncidents: securityStats.recentFailedLogins || 0
      },
      performance: {
        optimizations: performanceStats.pendingOptimizations || 0,
        highImpact: performanceStats.byImpact?.high || 0
      }
    };
  }

  /**
   * Get specific agent
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Restart a specific agent
   */
  async restartAgent(name) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent ${name} not found`);
    }

    logger.info(`Restarting ${name} Agent...`);

    await agent.stop();
    await agent.initialize({ db: this.db, redis: this.redis });
    await agent.start();

    logger.info(`${name} Agent restarted`);
  }
}

// Create singleton instance
const selfHealingSystem = new SelfHealingSystem();

/**
 * Start the self-healing system
 * Call this from your main server after it's ready
 */
async function startAgents(options = {}) {
  await selfHealingSystem.initialize(options);
  await selfHealingSystem.start();
  return selfHealingSystem;
}

/**
 * Stop the self-healing system
 */
async function stopAgents() {
  await selfHealingSystem.stop();
}

/**
 * Get the self-healing system instance
 */
function getSystem() {
  return selfHealingSystem;
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  await stopAgents();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down...');
  await stopAgents();
  process.exit(0);
});

// Export for use in main server
module.exports = {
  startAgents,
  stopAgents,
  getSystem,
  SelfHealingSystem,

  // Re-export shared services for direct access
  eventBus,
  metricsStore,
  alertManager,
  config,
  CHANNELS
};

// Allow running standalone for testing
if (require.main === module) {
  (async () => {
    logger.info('Starting Self-Healing System in standalone mode...');

    try {
      // In standalone mode, no DB or Redis
      await startAgents();

      logger.info('');
      logger.info('Self-Healing System running in standalone mode');
      logger.info('Press Ctrl+C to stop');
      logger.info('');

      // Keep running
      setInterval(() => {
        const summary = selfHealingSystem.getHealthSummary();
        logger.info('📊 Health Summary:', summary.health);
      }, 60000);

    } catch (error) {
      logger.error('Failed to start Self-Healing System', { error: error.message });
      process.exit(1);
    }
  })();
}
