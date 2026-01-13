/**
 * Tackle.IO API Routes
 * AI Lead Strategies LLC
 *
 * Enterprise CRM & Sales Automation Platform
 * Tier 5 - $599/mo - All features + API access
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');

// Import sub-routes
const companiesRoutes = require('./companies');
const contactsRoutes = require('./contacts');
const dealsRoutes = require('./deals');
const activitiesRoutes = require('./activities');
const callsRoutes = require('./calls');
const documentsRoutes = require('./documents');
const pipelinesRoutes = require('./pipelines');
const sequencesRoutes = require('./sequences');
const teamsRoutes = require('./teams');
const analyticsRoutes = require('./analytics');

// Apply authentication first
router.use(authenticate);

// Middleware to check Tier 5 access
const requireTier5 = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  // Tier 5 is Tackle.IO - full enterprise access
  if (req.user.tier < 5) {
    return res.status(403).json({
      success: false,
      error: 'Tackle.IO features require Tier 5 subscription',
      upgrade: {
        currentTier: req.user.tier,
        requiredTier: 5,
        upgradeUrl: '/upgrade?plan=tackle'
      }
    });
  }

  next();
};

// Apply tier check to all Tackle routes
router.use(requireTier5);

// Mount routes
router.use('/companies', companiesRoutes);
router.use('/contacts', contactsRoutes);
router.use('/deals', dealsRoutes);
router.use('/activities', activitiesRoutes);
router.use('/calls', callsRoutes);
router.use('/documents', documentsRoutes);
router.use('/pipelines', pipelinesRoutes);
router.use('/sequences', sequencesRoutes);
router.use('/teams', teamsRoutes);
router.use('/analytics', analyticsRoutes);

// Dashboard overview endpoint
router.get('/dashboard', async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const userId = req.user.id;

    // Get counts and metrics
    const [
      totalCompanies,
      totalContacts,
      totalDeals,
      openDeals,
      wonDeals,
      lostDeals,
      totalActivities,
      pendingActivities,
      totalCalls,
      pipelineValue
    ] = await Promise.all([
      prisma.company.count({ where: { userId } }),
      prisma.contact.count({ where: { userId } }),
      prisma.deal.count({ where: { userId } }),
      prisma.deal.count({ where: { userId, stage: { notIn: ['closed_won', 'closed_lost'] } } }),
      prisma.deal.count({ where: { userId, stage: 'closed_won' } }),
      prisma.deal.count({ where: { userId, stage: 'closed_lost' } }),
      prisma.activity.count({ where: { userId } }),
      prisma.activity.count({ where: { userId, isCompleted: false } }),
      prisma.call.count({ where: { userId } }),
      prisma.deal.aggregate({
        where: { userId, stage: { notIn: ['closed_won', 'closed_lost'] } },
        _sum: { value: true }
      })
    ]);

    // Recent activities
    const recentActivities = await prisma.activity.findMany({
      where: { userId },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true } },
        deal: { select: { name: true, value: true } }
      }
    });

    // Deals by stage
    const dealsByStage = await prisma.deal.groupBy({
      by: ['stage'],
      where: { userId },
      _count: true,
      _sum: { value: true }
    });

    // Upcoming tasks
    const upcomingTasks = await prisma.activity.findMany({
      where: {
        userId,
        isCompleted: false,
        dueDate: { gte: new Date() }
      },
      take: 5,
      orderBy: { dueDate: 'asc' },
      include: {
        contact: { select: { firstName: true, lastName: true } }
      }
    });

    res.json({
      success: true,
      data: {
        overview: {
          companies: totalCompanies,
          contacts: totalContacts,
          deals: {
            total: totalDeals,
            open: openDeals,
            won: wonDeals,
            lost: lostDeals,
            pipelineValue: pipelineValue._sum.value || 0
          },
          activities: {
            total: totalActivities,
            pending: pendingActivities
          },
          calls: totalCalls
        },
        dealsByStage: dealsByStage.map(s => ({
          stage: s.stage,
          count: s._count,
          value: s._sum.value || 0
        })),
        recentActivities,
        upcomingTasks
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await prisma.$disconnect();
  }
});

module.exports = router;
