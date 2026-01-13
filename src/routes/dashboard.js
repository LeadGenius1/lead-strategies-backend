// Dashboard Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get counts
    const [totalLeads, totalCampaigns, totalWebsites, totalEmailsSent] = await Promise.all([
      prisma.lead.count({ where: { userId } }),
      prisma.campaign.count({ where: { userId } }),
      prisma.website.count({ where: { userId } }),
      prisma.emailEvent.count({
        where: {
          campaign: { userId },
          eventType: 'sent'
        }
      })
    ]);

    // Get recent activity
    const recentCampaigns = await prisma.campaign.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true
      }
    });

    const recentLeads = await prisma.lead.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: {
        stats: {
          leads: totalLeads,
          campaigns: totalCampaigns,
          websites: totalWebsites,
          emailsSent: totalEmailsSent
        },
        recentActivity: {
          campaigns: recentCampaigns,
          leads: recentLeads
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
