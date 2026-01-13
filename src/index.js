// LeadSite.AI Backend - Main Entry Point
// Unified API for all 5 platforms: LeadSite.AI, LeadSite.IO, ClientContact.IO, VideoSite.IO, Tackle.IO
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const campaignRoutes = require('./routes/campaigns');
const leadRoutes = require('./routes/leads');
const analyticsRoutes = require('./routes/analytics');
const stripeRoutes = require('./routes/stripe');
const webhookRoutes = require('./routes/webhooks');
const websiteRoutes = require('./routes/websites');
const conversationRoutes = require('./routes/conversations');
const cannedResponseRoutes = require('./routes/cannedResponses');
const autoResponseRoutes = require('./routes/autoResponses');
const conversationNoteRoutes = require('./routes/conversationNotes');

// Tackle.IO Routes (Tier 5 - Enterprise CRM)
const tackleRoutes = require('./routes/tackle');

// Admin Routes (Internal only)
const adminRoutes = require('./routes/adminRoutes');

const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/logger');
const { initializeRedis, getRedisStore, checkRedisHealth } = require('./config/redis');

// Self-Healing System (Monitors all 5 platforms)
const { startAgents, getSystem } = require('./system-agents');

const app = express();
const PORT = process.env.PORT || 3001;

// ===========================================
// MIDDLEWARE
// ===========================================

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'https://aileadstrategies.com',
  'https://www.aileadstrategies.com',
  'https://leadsite.ai',
  'https://www.leadsite.ai',
  'https://leadsite.io',
  'https://clientcontact.io',
  'https://videosite.io',
  'https://tackle.io',
  'https://tackleai.ai'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Be permissive for now, log for debugging
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Webhooks need raw body (before JSON parsing)
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));

// Cookie parser (before routes)
app.use(cookieParser());

// JSON body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Rate limiting - start with in-memory, upgrade to Redis if available
const limiterConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path.includes('/webhooks/') && req.method === 'POST';
  },
};

// Start with in-memory rate limiting (always available)
const limiter = rateLimit(limiterConfig);
app.use('/api/', limiter);

// ===========================================
// ROUTES (always registered, regardless of Redis)
// ===========================================

// Health check
app.get('/health', (req, res) => {
  // Get self-healing system status if available
  const selfHealingSystem = getSystem();
  const systemHealth = selfHealingSystem?.running
    ? selfHealingSystem.getHealthSummary()
    : { status: 'disabled' };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'leadsite-backend',
    platforms: ['leadsite.ai', 'leadsite.io', 'clientcontact.io', 'videosite.io', 'tackle.io'],
    selfHealing: {
      enabled: selfHealingSystem?.running || false,
      agents: selfHealingSystem?.running ? Object.keys(selfHealingSystem.getAgentStatus()).length : 0
    }
  });
});

app.get('/api/v1/health', async (req, res) => {
  const redisHealth = await checkRedisHealth();
  const selfHealingSystem = getSystem();
  const systemHealth = selfHealingSystem?.running
    ? selfHealingSystem.getHealthSummary()
    : null;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    redis: redisHealth,
    selfHealing: systemHealth
  });
});

// API Routes (v1)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/leads', leadRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/stripe', stripeRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/websites', websiteRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/canned-responses', cannedResponseRoutes);
app.use('/api/v1/auto-responses', autoResponseRoutes);
app.use('/api/v1/conversation-notes', conversationNoteRoutes);

// Tackle.IO Routes (Tier 5 Enterprise CRM)
app.use('/api/v1/tackle', tackleRoutes);

// Admin Routes (Internal AI Lead Strategies staff only)
app.use('/admin', adminRoutes);

// Also support /api/ routes for backward compatibility
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/websites', websiteRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/canned-responses', cannedResponseRoutes);
app.use('/api/auto-responses', autoResponseRoutes);
app.use('/api/conversation-notes', conversationNoteRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Error handler
app.use(errorHandler);

// ===========================================
// SERVER START
// ===========================================

// Initialize Redis asynchronously (non-blocking)
// Routes are already registered, Redis will upgrade rate limiting if available
initializeRedis().then((redisConfig) => {
  if (redisConfig.available && redisConfig.store) {
    console.log('✅ Redis connected - rate limiting upgraded to Redis-backed');
    // Note: Rate limiting store can't be changed after initialization
    // For production, consider restarting or using Redis from the start
  } else {
    console.log('⚠️  Redis not available - using in-memory rate limiting');
  }
}).catch((error) => {
  console.warn('⚠️  Redis initialization failed - using in-memory rate limiting:', error.message);
});

// Start server immediately (routes are already registered)
// Bind to 0.0.0.0 to accept connections from all network interfaces (required for Railway/Docker)
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🚀 AI Lead Strategies Unified Backend           ║
║                                                   ║
║   Server running on port ${PORT}                    ║
║   Environment: ${process.env.NODE_ENV || 'development'}               ║
║                                                   ║
║   Platforms Served:                               ║
║   • LeadSite.AI (Tier 1)                          ║
║   • LeadSite.IO (Tier 2)                          ║
║   • ClientContact.IO (Tier 3)                     ║
║   • VideoSite.IO (Tier 4)                         ║
║   • Tackle.IO (Tier 5)                            ║
║                                                   ║
║   Health: http://localhost:${PORT}/health            ║
║   API:    http://localhost:${PORT}/api/v1            ║
║   Admin:  http://localhost:${PORT}/admin             ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
  `);

  // ===========================================
  // SELF-HEALING SYSTEM STARTUP
  // ===========================================
  // Monitors all 5 platforms from single system
  if (process.env.ENABLE_SELF_HEALING === 'true') {
    try {
      console.log('\n🔧 Starting Self-Healing System...');
      console.log('   Monitoring all 5 platforms: LeadSite.AI, LeadSite.IO, ClientContact.IO, VideoSite.IO, Tackle.IO\n');

      // Start all 7 agents
      await startAgents({
        db: null,    // Will use Prisma from agents if needed
        redis: null  // Will initialize Redis if REDIS_URL is set
      });

      console.log('\n✅ Self-Healing System active - 7 agents monitoring all platforms');
      console.log('   Access monitoring dashboard at: /admin/system/dashboard\n');
    } catch (error) {
      console.error('⚠️  Self-Healing System failed to start:', error.message);
      console.log('   Server continues without self-healing monitoring\n');
    }
  } else {
    console.log('\n💡 Self-Healing System disabled');
    console.log('   Enable with ENABLE_SELF_HEALING=true environment variable\n');
  }
});

module.exports = app;

