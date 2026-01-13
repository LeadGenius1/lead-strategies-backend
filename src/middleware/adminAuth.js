/**
 * Admin Authentication Middleware
 * AI Lead Strategies LLC
 *
 * Protects system dashboard and admin routes
 * Completely separate from user authentication
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Admin JWT settings - separate from user JWT
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'admin-super-secret-key-change-in-production';
const ADMIN_JWT_EXPIRY = '4h'; // Shorter expiry for security
const ADMIN_REFRESH_EXPIRY = '7d';

// Rate limiting for admin login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Verify admin token middleware
 */
async function requireAdmin(req, res, next) {
  try {
    // Get token from header or cookie
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies?.admin_token;

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookieToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
        code: 'ADMIN_AUTH_REQUIRED'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);

    // Check if it's an admin token (not a regular user token)
    if (!decoded.isAdmin || !decoded.adminId) {
      return res.status(403).json({
        success: false,
        error: 'Invalid admin token',
        code: 'INVALID_ADMIN_TOKEN'
      });
    }

    // Get admin user from database
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const adminUser = await prisma.adminUser.findUnique({
      where: { id: decoded.adminId }
    });

    if (!adminUser) {
      return res.status(403).json({
        success: false,
        error: 'Admin user not found',
        code: 'ADMIN_NOT_FOUND'
      });
    }

    // Check if account is locked
    if (adminUser.lockedUntil && new Date() < adminUser.lockedUntil) {
      return res.status(403).json({
        success: false,
        error: 'Account temporarily locked',
        code: 'ACCOUNT_LOCKED',
        lockedUntil: adminUser.lockedUntil
      });
    }

    // Verify session is still valid
    const session = await prisma.adminSession.findFirst({
      where: {
        adminUserId: adminUser.id,
        token: token,
        expiresAt: { gt: new Date() }
      }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }

    // Update session last active
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() }
    });

    // Attach admin to request
    req.admin = {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role,
      permissions: adminUser.permissions
    };

    await prisma.$disconnect();
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    console.error('Admin auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error'
    });
  }
}

/**
 * Require specific admin role
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required'
      });
    }

    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: `Requires role: ${roles.join(' or ')}`,
        code: 'INSUFFICIENT_ROLE'
      });
    }

    next();
  };
}

/**
 * Require specific permission
 */
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required'
      });
    }

    // Super admin has all permissions
    if (req.admin.role === 'super_admin') {
      return next();
    }

    const hasPermission = permissions.some(p => req.admin.permissions.includes(p));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: `Requires permission: ${permissions.join(' or ')}`,
        code: 'INSUFFICIENT_PERMISSION'
      });
    }

    next();
  };
}

/**
 * Admin login function
 */
async function adminLogin(email, password, ipAddress, userAgent) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Rate limiting check
    const attemptKey = `${email}:${ipAddress}`;
    const attempts = loginAttempts.get(attemptKey) || { count: 0, lockUntil: null };

    if (attempts.lockUntil && Date.now() < attempts.lockUntil) {
      const waitTime = Math.ceil((attempts.lockUntil - Date.now()) / 1000 / 60);
      throw new Error(`Too many login attempts. Try again in ${waitTime} minutes.`);
    }

    // Find admin user
    const adminUser = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!adminUser) {
      recordFailedAttempt(attemptKey);
      throw new Error('Invalid credentials');
    }

    // Check if account is locked
    if (adminUser.lockedUntil && new Date() < adminUser.lockedUntil) {
      throw new Error('Account temporarily locked');
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, adminUser.passwordHash);

    if (!validPassword) {
      // Record failed attempt
      await prisma.adminUser.update({
        where: { id: adminUser.id },
        data: { failedLogins: { increment: 1 } }
      });

      // Lock after too many failures
      if (adminUser.failedLogins + 1 >= MAX_LOGIN_ATTEMPTS) {
        await prisma.adminUser.update({
          where: { id: adminUser.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION) }
        });
      }

      recordFailedAttempt(attemptKey);
      throw new Error('Invalid credentials');
    }

    // Check MFA if enabled
    // TODO: Implement MFA verification

    // Generate tokens
    const accessToken = jwt.sign(
      {
        adminId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        isAdmin: true
      },
      ADMIN_JWT_SECRET,
      { expiresIn: ADMIN_JWT_EXPIRY }
    );

    const refreshToken = crypto.randomBytes(64).toString('hex');

    // Create session
    const session = await prisma.adminSession.create({
      data: {
        adminUserId: adminUser.id,
        token: accessToken,
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours
      }
    });

    // Update login info and reset failed attempts
    await prisma.adminUser.update({
      where: { id: adminUser.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
        failedLogins: 0,
        lockedUntil: null
      }
    });

    // Clear rate limiting
    loginAttempts.delete(attemptKey);

    // Audit log
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminUser.id,
        action: 'login',
        ipAddress,
        userAgent,
        details: { sessionId: session.id }
      }
    });

    return {
      accessToken,
      refreshToken,
      admin: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role
      }
    };

  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Admin logout function
 */
async function adminLogout(token, adminId) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Delete session
    await prisma.adminSession.deleteMany({
      where: {
        adminUserId: adminId,
        token: token
      }
    });

    // Audit log
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        action: 'logout'
      }
    });

  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Record failed login attempt for rate limiting
 */
function recordFailedAttempt(key) {
  const attempts = loginAttempts.get(key) || { count: 0, lockUntil: null };
  attempts.count++;

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockUntil = Date.now() + LOCKOUT_DURATION;
  }

  loginAttempts.set(key, attempts);
}

/**
 * Hash password for new admin users
 */
async function hashAdminPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Audit logging helper
 */
async function logAdminAction(adminId, action, resource = null, resourceId = null, details = null, req = null) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        action,
        resource,
        resourceId,
        details,
        ipAddress: req?.ip || null,
        userAgent: req?.headers?.['user-agent'] || null
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  requireAdmin,
  requireRole,
  requirePermission,
  adminLogin,
  adminLogout,
  hashAdminPassword,
  logAdminAction,
  ADMIN_JWT_SECRET,
  ADMIN_JWT_EXPIRY
};
