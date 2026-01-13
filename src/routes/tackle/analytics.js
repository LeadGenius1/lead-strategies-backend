/**
 * Analytics API Routes
 * Tackle.IO - Sales Analytics & Reporting
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/analytics/overview - Dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where = { userId };
    if (startDate || endDate) where.createdAt = dateFilter;

    const [
      totalDeals,
      wonDeals,
      lostDeals,
      totalValue,
      wonValue,
      totalContacts,
      totalCompanies,
      totalActivities,
      totalCalls
    ] = await Promise.all([
      prisma.deal.count({ where }),
      prisma.deal.count({ where: { ...where, stage: 'closed_won' } }),
      prisma.deal.count({ where: { ...where, stage: 'closed_lost' } }),
      prisma.deal.aggregate({ where, _sum: { value: true } }),
      prisma.deal.aggregate({ where: { ...where, stage: 'closed_won' }, _sum: { value: true } }),
      prisma.contact.count({ where }),
      prisma.company.count({ where }),
      prisma.activity.count({ where }),
      prisma.call.count({ where })
    ]);

    const winRate = totalDeals > 0 ? ((wonDeals / (wonDeals + lostDeals)) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        deals: {
          total: totalDeals,
          won: wonDeals,
          lost: lostDeals,
          open: totalDeals - wonDeals - lostDeals,
          winRate: parseFloat(winRate)
        },
        revenue: {
          pipeline: totalValue._sum.value || 0,
          won: wonValue._sum.value || 0
        },
        contacts: totalContacts,
        companies: totalCompanies,
        activities: totalActivities,
        calls: totalCalls
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/analytics/pipeline - Pipeline analytics
router.get('/pipeline', async (req, res) => {
  try {
    const userId = req.user.id;

    const stages = ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
    const pipelineData = [];

    for (const stage of stages) {
      const data = await prisma.deal.aggregate({
        where: { userId, stage },
        _count: true,
        _sum: { value: true },
        _avg: { probability: true }
      });

      pipelineData.push({
        stage,
        count: data._count,
        value: data._sum.value || 0,
        avgProbability: data._avg.probability || 0
      });
    }

    // Calculate weighted pipeline
    const weightedValue = pipelineData
      .filter(s => !['closed_won', 'closed_lost'].includes(s.stage))
      .reduce((sum, s) => sum + (parseFloat(s.value) * (s.avgProbability / 100)), 0);

    res.json({
      success: true,
      data: {
        stages: pipelineData,
        weightedPipeline: weightedValue.toFixed(2)
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/analytics/trends - Deal trends over time
router.get('/trends', async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30' } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Get deals by date
    const deals = await prisma.deal.findMany({
      where: {
        userId,
        createdAt: { gte: startDate }
      },
      select: {
        createdAt: true,
        value: true,
        stage: true
      },
      orderBy: { createdAt: 'asc' }
    });

    // Group by date
    const dailyData = {};
    deals.forEach(deal => {
      const date = deal.createdAt.toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = { created: 0, value: 0, won: 0, lost: 0 };
      }
      dailyData[date].created++;
      dailyData[date].value += parseFloat(deal.value);
      if (deal.stage === 'closed_won') dailyData[date].won++;
      if (deal.stage === 'closed_lost') dailyData[date].lost++;
    });

    res.json({
      success: true,
      data: Object.entries(dailyData).map(([date, data]) => ({ date, ...data }))
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/analytics/forecast - Revenue forecast
router.get('/forecast', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get open deals with expected close dates
    const openDeals = await prisma.deal.findMany({
      where: {
        userId,
        stage: { notIn: ['closed_won', 'closed_lost'] },
        expectedClose: { gte: new Date() }
      },
      select: {
        value: true,
        probability: true,
        expectedClose: true,
        stage: true
      }
    });

    // Group by month
    const forecast = {};
    openDeals.forEach(deal => {
      if (!deal.expectedClose) return;
      const month = deal.expectedClose.toISOString().slice(0, 7);
      if (!forecast[month]) {
        forecast[month] = { total: 0, weighted: 0, count: 0 };
      }
      forecast[month].total += parseFloat(deal.value);
      forecast[month].weighted += parseFloat(deal.value) * ((deal.probability || 0) / 100);
      forecast[month].count++;
    });

    res.json({
      success: true,
      data: Object.entries(forecast).map(([month, data]) => ({
        month,
        totalValue: data.total.toFixed(2),
        weightedValue: data.weighted.toFixed(2),
        dealCount: data.count
      })).sort((a, b) => a.month.localeCompare(b.month))
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/analytics/activity - Activity analytics
router.get('/activity', async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30' } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const [byType, byOutcome, completionRate] = await Promise.all([
      prisma.activity.groupBy({
        by: ['type'],
        where: { userId, createdAt: { gte: startDate } },
        _count: true
      }),
      prisma.activity.groupBy({
        by: ['outcome'],
        where: { userId, createdAt: { gte: startDate } },
        _count: true
      }),
      prisma.activity.aggregate({
        where: { userId, createdAt: { gte: startDate } },
        _count: { isCompleted: true }
      })
    ]);

    const totalActivities = byType.reduce((sum, t) => sum + t._count, 0);
    const completed = await prisma.activity.count({
      where: { userId, createdAt: { gte: startDate }, isCompleted: true }
    });

    res.json({
      success: true,
      data: {
        total: totalActivities,
        completed,
        completionRate: totalActivities > 0 ? ((completed / totalActivities) * 100).toFixed(1) : 0,
        byType: byType.reduce((acc, t) => ({ ...acc, [t.type]: t._count }), {}),
        byOutcome: byOutcome.reduce((acc, o) => ({ ...acc, [o.outcome || 'pending']: o._count }), {})
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/analytics/leaderboard - Team leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30' } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Get team members
    const teamMemberships = await prisma.teamMember.findMany({
      where: { userId },
      include: { team: true }
    });

    if (teamMemberships.length === 0) {
      return res.json({
        success: true,
        data: { message: 'No team data available', leaderboard: [] }
      });
    }

    const teamId = teamMemberships[0].teamId;

    // Get all team members
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { id: true, name: true, email: true } } }
    });

    // Get stats for each member
    const leaderboard = await Promise.all(members.map(async (member) => {
      const [wonDeals, wonValue, activities, calls] = await Promise.all([
        prisma.deal.count({
          where: { ownerId: member.userId, stage: 'closed_won', actualClose: { gte: startDate } }
        }),
        prisma.deal.aggregate({
          where: { ownerId: member.userId, stage: 'closed_won', actualClose: { gte: startDate } },
          _sum: { value: true }
        }),
        prisma.activity.count({
          where: { userId: member.userId, createdAt: { gte: startDate }, isCompleted: true }
        }),
        prisma.call.count({
          where: { userId: member.userId, createdAt: { gte: startDate }, status: 'completed' }
        })
      ]);

      return {
        userId: member.userId,
        name: member.user.name || member.user.email,
        role: member.role,
        quota: member.quota,
        dealsWon: wonDeals,
        revenue: wonValue._sum.value || 0,
        activities,
        calls,
        quotaAttainment: member.quota ? ((wonValue._sum.value || 0) / parseFloat(member.quota) * 100).toFixed(1) : null
      };
    }));

    // Sort by revenue
    leaderboard.sort((a, b) => parseFloat(b.revenue) - parseFloat(a.revenue));

    res.json({ success: true, data: { leaderboard } });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
