// Authentication & Authorization Middleware
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-dev-secret-change-in-production';

// Tier limits configuration
const TIER_LIMITS = {
  1: { leads: 50, name: 'LeadSite.AI', price: 79 },
  2: { leads: 100, name: 'LeadSite.IO', price: 149 },
  3: { leads: 500, name: 'ClientContact.IO', price: 249 },
  4: { leads: 1000, name: 'VideoSite.IO', price: 99 },
  5: { leads: 10000, name: 'Tackle.AI', price: 599 }
};

// Tier feature access
const TIER_FEATURES = {
  1: ['email_campaigns', 'leads', 'basic_analytics'],
  2: ['email_campaigns', 'leads', 'basic_analytics', 'website_builder'],
  3: ['email_campaigns', 'leads', 'basic_analytics', 'website_builder', 'unified_inbox', 'sms', 'social_channels'],
  4: ['email_campaigns', 'leads', 'basic_analytics', 'website_builder', 'unified_inbox', 'sms', 'social_channels', 'video'],
  5: ['email_campaigns', 'leads', 'basic_analytics', 'website_builder', 'unified_inbox', 'sms', 'social_channels', 'video', 'api_access', 'white_label']
};

/**
 * Authenticate JWT Token
 * Extracts user from token and attaches to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'No token provided. Please login.'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        tier: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'User not found. Please login again.'
      });
    }

    // Check subscription status
    const isTrialActive = user.trialEndsAt && new Date(user.trialEndsAt) > new Date();
    const isSubscribed = user.subscriptionStatus === 'active';
    
    if (!isTrialActive && !isSubscribed) {
      // Allow read-only access but flag for upgrade prompts
      user.requiresUpgrade = true;
    }

    // Attach user and tier info to request
    req.user = user;
    req.tierLimits = TIER_LIMITS[user.tier];
    req.tierFeatures = TIER_FEATURES[user.tier];
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Invalid token. Please login again.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Token expired. Please login again.'
      });
    }
    
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      message: 'Authentication failed.'
    });
  }
};

/**
 * Require minimum tier level
 * Use: requireTier(2) for features that need Tier 2+
 */
const requireTier = (minTier) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Please login first.'
      });
    }

    if (req.user.tier < minTier) {
      const requiredTierInfo = TIER_LIMITS[minTier];
      return res.status(403).json({ 
        error: 'Upgrade Required',
        message: `This feature requires ${requiredTierInfo.name} (Tier ${minTier}) or higher.`,
        currentTier: req.user.tier,
        requiredTier: minTier,
        upgradeTo: requiredTierInfo.name,
        upgradePrice: requiredTierInfo.price
      });
    }

    next();
  };
};

/**
 * Require specific feature access
 * Use: requireFeature('video') for video features
 */
const requireFeature = (feature) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Please login first.'
      });
    }

    const userFeatures = TIER_FEATURES[req.user.tier];
    
    if (!userFeatures.includes(feature)) {
      // Find which tier has this feature
      let requiredTier = 5;
      for (let tier = 1; tier <= 5; tier++) {
        if (TIER_FEATURES[tier].includes(feature)) {
          requiredTier = tier;
          break;
        }
      }
      
      return res.status(403).json({ 
        error: 'Feature Not Available',
        message: `The "${feature}" feature requires an upgrade.`,
        currentTier: req.user.tier,
        requiredTier: requiredTier,
        upgradeTo: TIER_LIMITS[requiredTier].name
      });
    }

    next();
  };
};

/**
 * Check lead limit for user's tier
 * Call this before creating new leads
 */
const checkLeadLimit = async (req, res, next) => {
  try {
    const leadCount = await prisma.lead.count({
      where: { userId: req.user.id }
    });

    const limit = TIER_LIMITS[req.user.tier].leads;

    if (leadCount >= limit) {
      return res.status(403).json({
        error: 'Lead Limit Reached',
        message: `You've reached your limit of ${limit} leads. Upgrade to add more.`,
        currentCount: leadCount,
        limit: limit,
        currentTier: req.user.tier
      });
    }

    req.leadCount = leadCount;
    req.leadLimit = limit;
    next();
  } catch (error) {
    console.error('Check lead limit error:', error);
    next(error);
  }
};

// Generate JWT token
const generateToken = (userId, tier) => {
  return jwt.sign(
    { userId, tier },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = {
  authenticate,
  requireTier,
  requireFeature,
  checkLeadLimit,
  generateToken,
  TIER_LIMITS,
  TIER_FEATURES
};

