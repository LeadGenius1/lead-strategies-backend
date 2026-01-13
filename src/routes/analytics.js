// Analytics Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// Get overall analytics
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const where = {
      campaign: { userId }
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Get all email events
    const events = await prisma.emailEvent.findMany({
      where,
      include: {
        campaign: true,
        lead: true
      }
    });

    // Calculate metrics
    const totalSent = events.filter(e => e.eventType === 'sent').length;
    const totalOpens = events.filter(e => e.eventType === 'opened').length;
    const totalClicks = events.filter(e => e.eventType === 'clicked').length;
    const totalReplies = events.filter(e => e.eventType === 'replied').length;
    const totalBounces = events.filter(e => e.eventType === 'bounced').length;

    const openRate = totalSent > 0 ? (totalOpens / totalSent) * 100 : 0;
    const clickRate = totalSent > 0 ? (totalClicks / totalSent) * 100 : 0;
    const replyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
    const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;

    // Campaign performance
    const campaignStats = {};
    events.forEach(event => {
      if (!campaignStats[event.campaignId]) {
        campaignStats[event.campaignId] = {
          campaignId: event.campaignId,
          campaignName: event.campaign.name,
          sent: 0,
          opened: 0,
          clicked: 0,
          replied: 0,
          bounced: 0
        };
      }
      const stats = campaignStats[event.campaignId];
      if (event.eventType === 'sent') stats.sent++;
      if (event.eventType === 'opened') stats.opened++;
      if (event.eventType === 'clicked') stats.clicked++;
      if (event.eventType === 'replied') stats.replied++;
      if (event.eventType === 'bounced') stats.bounced++;
    });

    Object.values(campaignStats).forEach(stats => {
      stats.openRate = stats.sent > 0 ? (stats.opened / stats.sent) * 100 : 0;
      stats.clickRate = stats.sent > 0 ? (stats.clicked / stats.sent) * 100 : 0;
      stats.replyRate = stats.sent > 0 ? (stats.replied / stats.sent) * 100 : 0;
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalSent,
          totalOpens,
          totalClicks,
          totalReplies,
          totalBounces,
          openRate: Math.round(openRate * 100) / 100,
          clickRate: Math.round(clickRate * 100) / 100,
          replyRate: Math.round(replyRate * 100) / 100,
          bounceRate: Math.round(bounceRate * 100) / 100
        },
        campaigns: Object.values(campaignStats)
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
