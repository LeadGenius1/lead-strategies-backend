/**
 * Admin Routes
 * AI Lead Strategies LLC
 *
 * Completely separate routes for internal admin access
 * These routes are NOT accessible to regular users/subscribers
 */

const express = require('express');
const router = express.Router();
const {
  requireAdmin,
  requireRole,
  requirePermission,
  adminLogin,
  adminLogout,
  hashAdminPassword,
  logAdminAction
} = require('../middleware/adminAuth');

// Import system routes for admin access
const systemRoutes = require('../system-agents/routes/systemRoutes');

// ==================== AUTH ROUTES ====================

/**
 * POST /admin/login
 * Admin login - completely separate from user login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
    }

    const result = await adminLogin(
      email,
      password,
      req.ip,
      req.headers['user-agent']
    );

    // Set HTTP-only cookie for security
    res.cookie('admin_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.aileadstrategies.com' : undefined,
      maxAge: 4 * 60 * 60 * 1000 // 4 hours
    });

    res.json({
      success: true,
      data: {
        token: result.accessToken,
        admin: result.admin
      }
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /admin/logout
 */
router.post('/logout', requireAdmin, async (req, res) => {
  try {
    const token = req.headers.authorization?.slice(7) || req.cookies?.admin_token;

    await adminLogout(token, req.admin.id);

    res.clearCookie('admin_token');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /admin/me
 * Get current admin user info
 */
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    data: req.admin
  });
});

// ==================== SYSTEM DASHBOARD ROUTES ====================

// Mount all system routes under /admin/system
// These are protected by requireAdmin middleware
router.use('/system', requireAdmin, systemRoutes);

// ==================== USER MANAGEMENT (SUPER ADMIN ONLY) ====================

/**
 * GET /admin/users
 * List all platform users (subscribers)
 */
router.get('/users', requireAdmin, requireRole('super_admin', 'admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const { page = 1, limit = 50, tier, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (tier) where.tier = parseInt(tier);
    if (status) where.subscriptionStatus = status;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          email: true,
          name: true,
          company: true,
          tier: true,
          subscriptionStatus: true,
          createdAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              leads: true,
              campaigns: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    await logAdminAction(req.admin.id, 'view_users', 'users', null, { page, limit }, req);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * GET /admin/users/:id
 * Get specific user details
 */
router.get('/users/:id', requireAdmin, requireRole('super_admin', 'admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            leads: true,
            campaigns: true,
            websites: true,
            videos: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Remove sensitive data
    delete user.passwordHash;

    await logAdminAction(req.admin.id, 'view_user', 'users', req.params.id, null, req);

    res.json({ success: true, data: user });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

// ==================== ADMIN USER MANAGEMENT (SUPER ADMIN ONLY) ====================

/**
 * GET /admin/admins
 * List all admin users
 */
router.get('/admins', requireAdmin, requireRole('super_admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const admins = await prisma.adminUser.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: admins });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * POST /admin/admins
 * Create new admin user (SUPER ADMIN ONLY)
 */
router.post('/admins', requireAdmin, requireRole('super_admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const { email, password, name, role = 'admin', permissions = [] } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and name required'
      });
    }

    // Check if admin already exists
    const existing = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Admin user already exists with this email'
      });
    }

    const passwordHash = await hashAdminPassword(password);

    const admin = await prisma.adminUser.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        role,
        permissions,
        createdBy: req.admin.id
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        permissions: true,
        createdAt: true
      }
    });

    await logAdminAction(req.admin.id, 'create_admin', 'admin_users', admin.id, { email, role }, req);

    res.status(201).json({ success: true, data: admin });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * DELETE /admin/admins/:id
 * Delete admin user (SUPER ADMIN ONLY, cannot delete self)
 */
router.delete('/admins/:id', requireAdmin, requireRole('super_admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Cannot delete yourself
    if (req.params.id === req.admin.id) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own admin account'
      });
    }

    await prisma.adminUser.delete({
      where: { id: req.params.id }
    });

    await logAdminAction(req.admin.id, 'delete_admin', 'admin_users', req.params.id, null, req);

    res.json({ success: true, message: 'Admin user deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

// ==================== AUDIT LOGS ====================

/**
 * GET /admin/audit-logs
 * View admin audit logs
 */
router.get('/audit-logs', requireAdmin, requireRole('super_admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const { page = 1, limit = 100, action, adminId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (action) where.action = action;
    if (adminId) where.adminUserId = adminId;

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          adminUser: {
            select: { email: true, name: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.adminAuditLog.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

// ==================== PLATFORM STATS ====================

/**
 * GET /admin/stats
 * Platform-wide statistics for admin dashboard
 */
router.get('/stats', requireAdmin, async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const [
      totalUsers,
      activeUsers,
      totalLeads,
      totalCampaigns,
      usersByTier,
      usersByStatus,
      recentSignups
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { subscriptionStatus: 'active' } }),
      prisma.lead.count(),
      prisma.campaign.count(),
      prisma.user.groupBy({
        by: ['tier'],
        _count: true
      }),
      prisma.user.groupBy({
        by: ['subscriptionStatus'],
        _count: true
      }),
      prisma.user.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      })
    ]);

    await logAdminAction(req.admin.id, 'view_stats', 'dashboard', null, null, req);

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          totalLeads,
          totalCampaigns,
          recentSignups
        },
        usersByTier: usersByTier.reduce((acc, item) => {
          acc[`tier_${item.tier}`] = item._count;
          return acc;
        }, {}),
        usersByStatus: usersByStatus.reduce((acc, item) => {
          acc[item.subscriptionStatus || 'unknown'] = item._count;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

// ==================== DATABASE MANAGEMENT ====================

/**
 * POST /admin/clear-users
 * Clear all users and related data (SUPER ADMIN ONLY)
 * Admin users are preserved (separate table)
 */
router.post('/clear-users', requireAdmin, requirePermission('super_admin'), async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const { confirmPhrase } = req.body;
    
    // Require confirmation phrase for safety
    if (confirmPhrase !== 'CONFIRM_CLEAR_ALL_USERS') {
      return res.status(400).json({
        success: false,
        error: 'Safety check failed. Send { confirmPhrase: "CONFIRM_CLEAR_ALL_USERS" } to proceed.'
      });
    }

    console.log('🗑️ Admin requested database user cleanup');
    
    // Get count before deletion
    const userCount = await prisma.user.count();
    
    if (userCount === 0) {
      return res.json({
        success: true,
        message: 'No users to delete. Database is already clean.',
        deleted: { users: 0 }
      });
    }

    // Delete in order (cascade handles most, but being thorough)
    const deleted = {};
    
    // Delete related data first
    deleted.emailEvents = (await prisma.emailEvent.deleteMany({})).count;
    deleted.campaignLeads = (await prisma.campaignLead.deleteMany({})).count;
    deleted.campaigns = (await prisma.campaign.deleteMany({})).count;
    deleted.leads = (await prisma.lead.deleteMany({})).count;
    deleted.emailTemplates = (await prisma.emailTemplate.deleteMany({})).count;
    deleted.websites = (await prisma.website.deleteMany({})).count;
    deleted.videos = (await prisma.video.deleteMany({})).count;
    deleted.apiKeys = (await prisma.apiKey.deleteMany({})).count;
    deleted.messages = (await prisma.message.deleteMany({})).count;
    deleted.conversations = (await prisma.conversation.deleteMany({})).count;
    deleted.cannedResponses = (await prisma.cannedResponse.deleteMany({})).count;
    deleted.autoResponses = (await prisma.autoResponse.deleteMany({})).count;
    deleted.conversationNotes = (await prisma.conversationNote.deleteMany({})).count;
    
    // Try Tackle.IO tables
    try {
      deleted.activities = (await prisma.activity.deleteMany({})).count;
      deleted.calls = (await prisma.call.deleteMany({})).count;
      deleted.documents = (await prisma.document.deleteMany({})).count;
      deleted.deals = (await prisma.deal.deleteMany({})).count;
      deleted.contacts = (await prisma.contact.deleteMany({})).count;
      deleted.companies = (await prisma.company.deleteMany({})).count;
      deleted.teamMembers = (await prisma.teamMember.deleteMany({})).count;
    } catch (e) {
      // Tables may not exist
    }
    
    // Delete users
    deleted.users = (await prisma.user.deleteMany({})).count;
    
    // Log admin action
    await logAdminAction(req.admin.id, 'clear_all_users', 'users', null, { deleted }, req);
    
    console.log(`✅ Cleared ${deleted.users} users and related data`);
    
    res.json({
      success: true,
      message: `Successfully cleared ${deleted.users} users and all related data`,
      deleted
    });

  } catch (error) {
    console.error('❌ Error clearing users:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * GET /admin/system/health
 * Detailed system health status including monitoring agents
 */
router.get('/system/health', requireAdmin, async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Check database
    let dbStatus = 'healthy';
    let dbLatency = 0;
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
    } catch (e) {
      dbStatus = 'error';
    }

    // Get user stats
    const userCount = await prisma.user.count();
    const leadCount = await prisma.lead.count();
    const campaignCount = await prisma.campaign.count();

    // Memory usage
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    // Uptime
    const uptimeSeconds = process.uptime();
    const uptimeHours = Math.round(uptimeSeconds / 3600 * 100) / 100;

    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'leadsite-backend',
        version: '1.0.0',
        uptime: {
          seconds: Math.round(uptimeSeconds),
          hours: uptimeHours
        },
        database: {
          status: dbStatus,
          latencyMs: dbLatency
        },
        memory: {
          usedMB: memUsedMB,
          totalMB: memTotalMB,
          percentUsed: Math.round((memUsedMB / memTotalMB) * 100)
        },
        stats: {
          users: userCount,
          leads: leadCount,
          campaigns: campaignCount
        },
        monitoring: {
          selfHealingEnabled: true,
          agents: ['monitor', 'diagnostic', 'repair', 'learning', 'predictive', 'security', 'performance']
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

module.exports = router;
