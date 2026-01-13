// Authentication Routes
const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { generateToken, TIER_LIMITS, TIER_FEATURES } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Map tier names to tier numbers
const TIER_MAP = {
  'leadsite-ai': 1,
  'leadsite-io': 2,
  'clientcontact-io': 3,
  'videosite-io': 4,
  'tackle-io': 5,
  'tackleai.ai': 5,
};

// Signup
router.post('/signup', async (req, res) => {
  try {
    // Support both formats: { name, company } or { firstName, lastName, companyName }
    const { 
      email, 
      password, 
      name, 
      company, 
      firstName,
      lastName,
      companyName,
      tier = 1 
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Map tier name to tier number if needed
    let tierNumber = parseInt(tier);
    if (isNaN(tierNumber) && typeof tier === 'string') {
      tierNumber = TIER_MAP[tier.toLowerCase()] || 1;
    }
    if (!tierNumber || tierNumber < 1 || tierNumber > 5) {
      tierNumber = 1; // Default to tier 1
    }

    // Build name and company from available fields
    const userName = name || (firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || email.split('@')[0]);
    const userCompany = company || companyName || '';

    if (!userName) {
      return res.status(400).json({ error: 'Name is required (provide name or firstName/lastName)' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: userName,
        company: userCompany,
        tier: tierNumber,
        subscriptionStatus: 'trial',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days
      },
      select: {
        id: true,
        email: true,
        name: true,
        company: true,
        tier: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true
      }
    });

    // Generate token
    const token = generateToken(user.id, user.tier);

    // Return response with token at top level for easier access
    res.status(201).json({
      success: true,
      token, // Token at top level for cookie setting
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          tier: user.tier,
          subscriptionStatus: user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt,
          createdAt: user.createdAt
        },
        subscription: {
          tier: TIER_LIMITS[user.tier]?.name?.toLowerCase().replace(/\./g, '-') || 'leadsite-ai',
          features: TIER_FEATURES[user.tier] || []
        }
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Generate token
    const token = generateToken(user.id, user.tier);

    res.json({
      success: true,
      token, // Token at top level for cookie setting
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          tier: user.tier,
          subscriptionStatus: user.subscriptionStatus,
          trialEndsAt: user.trialEndsAt
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get current user
const { authenticate } = require('../middleware/auth');
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user,
        tierLimits: req.tierLimits,
        tierFeatures: req.tierFeatures
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
