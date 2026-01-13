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

module.exports = router;
