# Self-Healing System Integration Guide

## Quick Start

Add these lines to your main backend server (`src/index.js`):

```javascript
// At the top with other imports
const { startAgents, getSystem } = require('./system-agents');
const { createRequestTracer } = require('./system-agents/middleware/requestTracer');
const { createQueryLogger } = require('./system-agents/middleware/queryLogger');
const systemRoutes = require('./system-agents/routes/systemRoutes');

// After creating Express app, before routes
app.use(createRequestTracer({
  sampleRate: 1.0,        // 100% in production, lower for high traffic
  slowThreshold: 500,      // Log requests slower than 500ms
  excludePaths: ['/health', '/api/v1/health']
}));

// Add Prisma query logging middleware
prisma.$use(createQueryLogger({
  slowThreshold: 100,      // Log queries slower than 100ms
  logAllQueries: process.env.NODE_ENV !== 'production'
}));

// Add system monitoring routes (protect with admin auth in production)
app.use('/api/v1/system', systemRoutes);

// After server starts
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Start self-healing system
  if (process.env.ENABLE_SELF_HEALING === 'true') {
    await startAgents({ db: prisma, redis });
    console.log('Self-healing system started');
  }
});
```

---

## Environment Variables

```env
# Required
ENABLE_SELF_HEALING=true
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Optional - AI Diagnosis
ANTHROPIC_API_KEY=sk-ant-...

# Optional - Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
PAGERDUTY_API_KEY=...
ALERT_EMAIL_TO=admin@yourcompany.com

# Optional - Tuning
MONITOR_INTERVAL_MS=5000
API_RESPONSE_THRESHOLD_MS=500
DB_QUERY_THRESHOLD_MS=100
MEMORY_THRESHOLD_PERCENT=85
```

---

## API Endpoints

### System Health
```
GET /api/v1/system/health           # Quick health check
GET /api/v1/system/health/detailed  # Full health report
GET /api/v1/system/dashboard        # Aggregated dashboard data
```

### Agents
```
GET  /api/v1/system/agents                  # All agent status
POST /api/v1/system/agents/:name/restart    # Restart specific agent
```

### Alerts
```
GET  /api/v1/system/alerts                 # Active alerts
POST /api/v1/system/alerts/:id/acknowledge # Acknowledge alert
POST /api/v1/system/alerts/:id/resolve     # Resolve alert
```

### Metrics & Performance
```
GET /api/v1/system/metrics       # System metrics
GET /api/v1/system/queries       # Database query stats
GET /api/v1/system/traces        # Active request traces
GET /api/v1/system/performance   # Performance optimizations
```

### Learning & Predictions
```
GET /api/v1/system/patterns      # Learned patterns
GET /api/v1/system/predictions   # Active predictions
GET /api/v1/system/repairs       # Repair history
```

### Security
```
GET /api/v1/system/security      # Security status
```

---

## Example: Dashboard Widget Data

```javascript
// Fetch dashboard summary
const response = await fetch('/api/v1/system/dashboard');
const { data } = await response.json();

// data contains:
// - system.status, system.uptime
// - health.overall (healthy/degraded/critical)
// - alerts.active, alerts.stats
// - metrics (API response times, etc.)
// - agents (each agent's stats)
```

---

## Security: Protect System Routes

In production, protect system routes with admin authentication:

```javascript
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

app.use('/api/v1/system', adminOnly, systemRoutes);
```

---

## Testing Standalone

Run the system without the main server:

```bash
cd backend
node src/system-agents/index.js
```

This starts all agents in standalone mode for testing.

---

## Architecture Overview

```
Request → RequestTracer → Your Routes → QueryLogger → Database
              ↓                              ↓
         MetricsStore ←─────────────────────┘
              ↓
         MonitorAgent (every 5s)
              ↓
         AlertManager → Slack/PagerDuty
              ↓
         DiagnosticAgent (Claude AI)
              ↓
         RepairAgent (auto-fix)
              ↓
         LearningAgent (patterns)
              ↓
         PredictiveAgent (forecasts)
```

---

## What Gets Monitored

| Component | Metrics | Thresholds |
|-----------|---------|------------|
| API | Response time, error rate | 500ms, 1% |
| Database | Query time, pool usage | 100ms, 80% |
| Memory | Usage, heap | 85%, 90% |
| CPU | Usage | 80% |
| Redis | Response time, memory | 50ms, 80% |
| External APIs | OpenAI, SendGrid, etc. | 5000ms |

---

## Auto-Fix Capabilities

| Issue | Auto-Fix |
|-------|----------|
| Slow DB queries | ANALYZE, suggest indexes |
| High memory | Garbage collection, cache clear |
| Service crash | Restart service |
| Email provider down | Failover to backup |
| Cache issues | Clear cache |
| Rate limiting | Temporarily increase limits |

---

## Files Reference

```
backend/src/system-agents/
├── index.js                      # Main orchestrator
├── config.js                     # All configuration
├── INTEGRATION_GUIDE.md          # This file
├── utils/
│   ├── logger.js                 # Color-coded logging
│   └── helpers.js                # Utilities
├── shared/
│   ├── EventBus.js               # Agent communication
│   ├── MetricsStore.js           # Time-series metrics
│   └── AlertManager.js           # Alert handling
├── middleware/
│   ├── requestTracer.js          # Request tracing
│   └── queryLogger.js            # DB query logging
├── routes/
│   └── systemRoutes.js           # API endpoints
└── agents/
    ├── MonitorAgent.js           # Health monitoring
    ├── DiagnosticAgent.js        # AI diagnosis
    ├── RepairAgent.js            # Auto-fixing
    ├── LearningAgent.js          # Pattern learning
    ├── PredictiveAgent.js        # Forecasting
    ├── SecurityAgent.js          # Threat detection
    └── PerformanceAgent.js       # Optimization
```
