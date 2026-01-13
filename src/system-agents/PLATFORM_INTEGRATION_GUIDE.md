# Platform Integration Guide: Database Monitoring for All 5 Platforms

## Overview

This guide explains how the Self-Healing System monitors all 5 AI Lead Strategies platforms from a **single centralized backend**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AI LEAD STRATEGIES ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│  │ LeadSite  │ │ LeadSite  │ │ Client    │ │ VideoSite │ │ Tackle.IO │     │
│  │ .AI       │ │ .IO       │ │ Contact   │ │ .IO       │ │           │     │
│  │ (Tier 1)  │ │ (Tier 2)  │ │ .IO (T3)  │ │ (Tier 4)  │ │ (Tier 5)  │     │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘     │
│        │             │             │             │             │            │
│        └─────────────┴─────────────┴─────────────┴─────────────┘            │
│                                    │                                         │
│                          ┌─────────▼─────────┐                              │
│                          │   SINGLE BACKEND   │                              │
│                          │   (Railway)        │                              │
│                          │                    │                              │
│                          │ • All API Routes   │                              │
│                          │ • User Auth        │                              │
│                          │ • Database         │                              │
│                          │ • Self-Healing     │                              │
│                          └─────────┬──────────┘                              │
│                                    │                                         │
│                          ┌─────────▼─────────┐                              │
│                          │  SELF-HEALING     │                              │
│                          │  MONITORING       │                              │
│                          │                   │                              │
│                          │ 7 Agents:         │                              │
│                          │ • Monitor         │                              │
│                          │ • Diagnostic      │                              │
│                          │ • Repair          │                              │
│                          │ • Learning        │                              │
│                          │ • Predictive      │                              │
│                          │ • Security        │                              │
│                          │ • Performance     │                              │
│                          └───────────────────┘                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works: Single Backend, Multiple Platforms

### Key Concept: One Database, One Monitoring System

All 5 platforms share the **same backend** on Railway:
- Same PostgreSQL database
- Same API endpoints
- Same Self-Healing System monitoring everything

Users are separated by their `tier` field:
- Tier 1: LeadSite.AI users
- Tier 2: LeadSite.IO users
- Tier 3: ClientContact.IO users
- Tier 4: VideoSite.IO users
- Tier 5: Tackle.IO users

The monitoring system sees **all** database queries, API calls, and system metrics regardless of which platform the user is on.

---

## Step 1: Enable Self-Healing in Main Server

Edit `backend/src/index.js` and add after the server starts:

```javascript
// At the top, add imports
const { startAgents, getSystem } = require('./system-agents');
const prisma = require('./config/prisma'); // Your Prisma client

// After app.listen(), add:
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Start Self-Healing System
  if (process.env.ENABLE_SELF_HEALING === 'true') {
    try {
      await startAgents({
        db: prisma,  // Pass Prisma client for database operations
        redis: null  // Optional: pass Redis client if available
      });
      console.log('✅ Self-Healing System active');
    } catch (error) {
      console.error('⚠️ Self-Healing System failed to start:', error.message);
    }
  }
});
```

---

## Step 2: Environment Variables

Add to your `.env` or Railway environment:

```env
# Enable Self-Healing System
ENABLE_SELF_HEALING=true

# Platform URLs (for external health checks)
LEADSITE_AI_URL=https://leadsite.ai
LEADSITE_IO_URL=https://leadsite.io
CLIENTCONTACT_URL=https://clientcontact.io
TACKLEAI_URL=https://tackle.io
VIDEOSITE_URL=https://videosite.io

# Monitoring Thresholds (optional - has defaults)
API_RESPONSE_THRESHOLD_MS=500
DB_QUERY_THRESHOLD_MS=100
MEMORY_THRESHOLD_PERCENT=85
CPU_THRESHOLD_PERCENT=80

# Notifications (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_EMAIL_TO=admin@aileadstrategies.com

# AI for Diagnostics (optional but recommended)
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Step 3: What Gets Monitored Automatically

Once enabled, the Self-Healing System monitors:

### Database (All 5 Platforms Share One DB)
- Query execution times
- Connection pool usage
- Slow queries (auto-detected)
- Index usage and recommendations
- Connection errors

### API Endpoints (All Platforms)
```
/api/v1/auth/*        → User authentication
/api/v1/campaigns/*   → Campaign operations
/api/v1/leads/*       → Lead management
/api/v1/tackle/*      → Tackle.IO CRM (Tier 5 only)
/api/v1/websites/*    → Website builder
/api/v1/videos/*      → Video platform (Tier 4+)
/api/v1/conversations/* → ClientContact inbox
```

### System Resources
- Memory usage
- CPU usage
- Disk space
- Redis connection (if configured)

### External Services
- OpenAI API status
- Anthropic API status
- SendGrid email delivery

### Security (All Platforms)
- Failed login attempts
- Rate limit violations
- SQL injection attempts
- XSS attempts

---

## Step 4: Admin Access to Monitoring Dashboard

### URL Structure

| Access Type | URL | Who Can Access |
|-------------|-----|----------------|
| User Dashboard | `/dashboard` | All platform users (their own data) |
| Admin Dashboard | `/admin/dashboard` | AI Lead Strategies staff only |
| System Monitoring | `/admin/system/*` | AI Lead Strategies staff only |

### Admin Login

1. Go to `https://your-backend.railway.app/admin/login`
2. Login with admin credentials
3. Access full system monitoring

### API Endpoints for Monitoring

```
GET  /admin/system/health          → System health overview
GET  /admin/system/dashboard       → Full dashboard data
GET  /admin/system/agents          → All 7 agents status
GET  /admin/system/alerts          → Active alerts
GET  /admin/system/metrics         → All platform metrics
GET  /admin/system/repairs         → Auto-fix history
GET  /admin/system/patterns        → Learned patterns
GET  /admin/system/predictions     → 72-hour forecasts
GET  /admin/system/security        → Security incidents
POST /admin/system/agents/:name/restart  → Restart agent
```

---

## Step 5: Platform-Specific Monitoring

The monitoring system tracks metrics **per platform** using the user's tier:

```javascript
// Example: How metrics are tagged by platform
metricsStore.record({
  component: 'api',
  metric: 'response_time',
  value: 250,
  tags: {
    platform: 'tackle.io',    // Determined by user tier
    endpoint: '/api/v1/tackle/deals',
    method: 'POST'
  }
});
```

### View Metrics by Platform

```javascript
// Get metrics for specific platform
GET /admin/system/metrics?platform=tackle.io
GET /admin/system/metrics?platform=leadsite.ai
GET /admin/system/metrics?platform=clientcontact.io
```

---

## Step 6: Per-Platform Health Checks

The Monitor Agent checks each platform's frontend:

```javascript
// config.js - Platform URLs being monitored
apiUrls: {
  platforms: {
    'leadsite.ai': 'https://api.leadsite.ai',
    'leadsite.io': 'https://api.leadsite.io',
    'clientcontact.io': 'https://api.clientcontact.io',
    'tackleai.ai': 'https://api.tackleai.ai',
    'videosite.io': 'https://api.videosite.io'
  }
}
```

Every 5 seconds, Monitor Agent checks:
1. Backend health endpoint
2. Each platform's API endpoint
3. Database connectivity
4. Redis connectivity (if configured)

---

## Step 7: Alerts Flow

```
User Action (any platform)
    ↓
Backend API receives request
    ↓
RequestTracer captures timing
    ↓
Prisma executes query
    ↓
QueryLogger captures query timing
    ↓
MetricsStore stores metrics
    ↓
MonitorAgent checks every 5s
    ↓
If threshold exceeded:
    ↓
AlertManager creates alert
    ↓
DiagnosticAgent analyzes
    ↓
RepairAgent attempts auto-fix
    ↓
LearningAgent learns from outcome
    ↓
Admin Dashboard shows alert
```

---

## Step 8: Middleware Integration

Add these to capture all platform requests:

```javascript
// In backend/src/index.js

// Import middleware
const { requestTracer } = require('./system-agents/middleware/requestTracer');
const { queryLogger } = require('./system-agents/middleware/queryLogger');

// Add BEFORE your routes
app.use(requestTracer);  // Traces all HTTP requests
// queryLogger is integrated with Prisma automatically
```

---

## Step 9: Verify Integration

### Test Commands

```bash
# Check system health
curl https://your-backend.railway.app/health

# Check detailed health (requires admin token)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://your-backend.railway.app/admin/system/health/detailed

# Check all agents
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://your-backend.railway.app/admin/system/agents

# Check platform-specific metrics
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://your-backend.railway.app/admin/system/metrics?platform=tackle.io"
```

### Expected Response

```json
{
  "success": true,
  "data": {
    "system": {
      "status": "running",
      "uptime": 86400000,
      "version": "1.0.0"
    },
    "agents": {
      "Monitor": { "running": true, "enabled": true },
      "Diagnostic": { "running": true, "enabled": true },
      "Repair": { "running": true, "enabled": true },
      "Learning": { "running": true, "enabled": true },
      "Predictive": { "running": true, "enabled": true },
      "Security": { "running": true, "enabled": true },
      "Performance": { "running": true, "enabled": true }
    },
    "health": {
      "overall": "healthy",
      "platforms": {
        "leadsite.ai": "healthy",
        "leadsite.io": "healthy",
        "clientcontact.io": "healthy",
        "videosite.io": "healthy",
        "tackle.io": "healthy"
      }
    }
  }
}
```

---

## Summary: Single System Monitors All Platforms

| Component | Quantity | Shared? |
|-----------|----------|---------|
| Backend Server | 1 | Yes - all platforms |
| PostgreSQL Database | 1 | Yes - all platforms |
| Self-Healing System | 1 | Yes - monitors all |
| Admin Dashboard | 1 | Yes - sees all platforms |
| User Dashboards | 5 | No - each platform has own |
| API Routes | 1 set | Yes - tier determines access |

**Key Point:** You don't need separate monitoring for each platform. The single Self-Healing System monitors the entire backend, which serves all 5 platforms.

---

## Quick Start Checklist

- [ ] Add `ENABLE_SELF_HEALING=true` to Railway environment
- [ ] Update `backend/src/index.js` with agent startup code
- [ ] Add platform URLs to environment variables
- [ ] Create admin user: `node prisma/seed-admin.js`
- [ ] Push database schema: `npx prisma db push`
- [ ] Deploy to Railway
- [ ] Login at `/admin/login`
- [ ] Verify all 7 agents running at `/admin/system/agents`
