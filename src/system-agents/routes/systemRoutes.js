/**
 * System Monitoring API Routes
 * AI Lead Strategies LLC
 *
 * Endpoints for monitoring dashboard and system health
 */

const express = require('express');
const router = express.Router();

// Import system components
const { getSystem } = require('../index');
const { metricsStore } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const { eventBus } = require('../shared/EventBus');
const { getQueryStats, getSlowQueries, getQueryHealthSummary } = require('../middleware/queryLogger');
const { getTraceStats, getActiveTraces } = require('../middleware/requestTracer');

/**
 * GET /api/v1/system/health
 * Complete system health overview
 */
router.get('/health', async (req, res) => {
  try {
    const system = getSystem();
    const summary = system.getHealthSummary();

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/health/detailed
 * Detailed health check with all components
 */
router.get('/health/detailed', async (req, res) => {
  try {
    const system = getSystem();
    const monitorAgent = system.getAgent('Monitor');

    const health = {
      timestamp: new Date().toISOString(),
      overall: 'healthy',
      components: {}
    };

    // Get health status from Monitor Agent
    if (monitorAgent) {
      const monitorHealth = monitorAgent.getHealthStatus();
      health.overall = monitorHealth.overall;
      health.components = monitorHealth.checks;
    }

    // Add metrics summary
    health.metrics = metricsStore.getHealthSummary();

    // Add alert summary
    health.alerts = alertManager.getStats();

    // Add query health
    health.database = getQueryHealthSummary();

    // Add trace stats
    health.traces = getTraceStats();

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/agents
 * Get status of all agents
 */
router.get('/agents', async (req, res) => {
  try {
    const system = getSystem();

    const agents = {};
    const agentNames = ['Monitor', 'Diagnostic', 'Repair', 'Learning', 'Predictive', 'Security', 'Performance'];

    for (const name of agentNames) {
      const agent = system.getAgent(name);
      if (agent) {
        agents[name] = {
          running: agent.running,
          stats: agent.getStats ? agent.getStats() : null
        };
      }
    }

    res.json({
      success: true,
      data: {
        systemRunning: system.running,
        uptime: system.startTime ? Date.now() - system.startTime.getTime() : 0,
        agents
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/system/agents/:name/restart
 * Restart a specific agent
 */
router.post('/agents/:name/restart', async (req, res) => {
  try {
    const { name } = req.params;
    const system = getSystem();

    await system.restartAgent(name);

    res.json({
      success: true,
      message: `Agent ${name} restarted successfully`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/alerts
 * Get active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const { severity, component, limit = 50 } = req.query;

    const alerts = alertManager.getActiveAlerts({
      severity,
      component,
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: {
        alerts,
        stats: alertManager.getStats()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/system/alerts/:id/acknowledge
 * Acknowledge an alert
 */
router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;

    const alert = await alertManager.acknowledge(id, userId);

    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/system/alerts/:id/resolve
 * Resolve an alert
 */
router.post('/alerts/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body;

    const alert = await alertManager.resolve(id, {
      autoResolved: false,
      resolution
    });

    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/metrics
 * Get system metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const { name, limit = 100 } = req.query;

    if (name) {
      const stats = metricsStore.getStats(name, { limit: parseInt(limit) });
      res.json({
        success: true,
        data: { [name]: stats }
      });
    } else {
      // Return all metric names with their stats
      const metricNames = metricsStore.getMetricNames();
      const metrics = {};

      for (const metricName of metricNames) {
        metrics[metricName] = metricsStore.getStats(metricName, { limit: 50 });
      }

      res.json({
        success: true,
        data: metrics
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/repairs
 * Get repair history
 */
router.get('/repairs', async (req, res) => {
  try {
    const system = getSystem();
    const repairAgent = system.getAgent('Repair');

    res.json({
      success: true,
      data: repairAgent ? repairAgent.getStats() : { total: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/patterns
 * Get learned patterns
 */
router.get('/patterns', async (req, res) => {
  try {
    const system = getSystem();
    const learningAgent = system.getAgent('Learning');

    res.json({
      success: true,
      data: {
        stats: learningAgent?.getStats() || {},
        playbook: learningAgent?.getPlaybook() || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/predictions
 * Get active predictions
 */
router.get('/predictions', async (req, res) => {
  try {
    const system = getSystem();
    const predictiveAgent = system.getAgent('Predictive');

    res.json({
      success: true,
      data: predictiveAgent?.getStats() || { totalPredictions: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/security
 * Get security status
 */
router.get('/security', async (req, res) => {
  try {
    const system = getSystem();
    const securityAgent = system.getAgent('Security');

    res.json({
      success: true,
      data: securityAgent?.getStats() || { blockedIPs: 0 }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/performance
 * Get performance optimizations
 */
router.get('/performance', async (req, res) => {
  try {
    const system = getSystem();
    const performanceAgent = system.getAgent('Performance');

    res.json({
      success: true,
      data: {
        stats: performanceAgent?.getStats() || {},
        pending: performanceAgent?.getPendingOptimizations() || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/queries
 * Get database query statistics
 */
router.get('/queries', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        summary: getQueryHealthSummary(),
        stats: getQueryStats(),
        slowQueries: getSlowQueries()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/traces
 * Get active request traces
 */
router.get('/traces', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        stats: getTraceStats(),
        active: getActiveTraces().slice(0, 50)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/events
 * Get recent event bus events
 */
router.get('/events', async (req, res) => {
  try {
    const { channel, limit = 50 } = req.query;

    res.json({
      success: true,
      data: {
        events: eventBus.getHistory(channel, parseInt(limit)),
        stats: eventBus.getStats()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/system/dashboard
 * Aggregated dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const system = getSystem();

    const dashboard = {
      timestamp: new Date().toISOString(),
      system: {
        status: system.running ? 'running' : 'stopped',
        uptime: system.startTime ? Date.now() - system.startTime.getTime() : 0,
        version: require('../config').system.version
      },
      health: system.getHealthSummary(),
      alerts: {
        active: alertManager.getActiveAlerts({ limit: 10 }),
        stats: alertManager.getStats()
      },
      metrics: metricsStore.getHealthSummary(),
      queries: getQueryHealthSummary(),
      agents: {}
    };

    // Get agent stats
    for (const name of ['Monitor', 'Diagnostic', 'Repair', 'Learning', 'Predictive', 'Security', 'Performance']) {
      const agent = system.getAgent(name);
      if (agent?.getStats) {
        dashboard.agents[name] = {
          running: agent.running,
          ...agent.getStats()
        };
      }
    }

    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
