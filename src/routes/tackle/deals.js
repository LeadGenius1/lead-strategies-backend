/**
 * Deals API Routes
 * Tackle.IO - Sales Pipeline Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/deals - List deals
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      search,
      stage,
      companyId,
      ownerId,
      priority,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (stage) where.stage = stage;
    if (companyId) where.companyId = companyId;
    if (ownerId) where.ownerId = ownerId;
    if (priority) where.priority = priority;

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          company: { select: { id: true, name: true } },
          contacts: { select: { id: true, firstName: true, lastName: true, email: true } },
          _count: { select: { activities: true, documents: true } }
        }
      }),
      prisma.deal.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        deals,
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
  }
});

// GET /api/v1/tackle/deals/pipeline - Get deals by pipeline stage
router.get('/pipeline', async (req, res) => {
  try {
    const userId = req.user.id;

    const stages = ['lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

    const pipeline = {};

    for (const stage of stages) {
      const deals = await prisma.deal.findMany({
        where: { userId, stage },
        orderBy: { updatedAt: 'desc' },
        include: {
          company: { select: { id: true, name: true } },
          contacts: { select: { id: true, firstName: true, lastName: true } }
        }
      });

      const total = await prisma.deal.aggregate({
        where: { userId, stage },
        _sum: { value: true },
        _count: true
      });

      pipeline[stage] = {
        deals,
        count: total._count,
        totalValue: total._sum.value || 0
      };
    }

    res.json({ success: true, data: pipeline });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/deals/:id - Get deal details
router.get('/:id', async (req, res) => {
  try {
    const deal = await prisma.deal.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        company: true,
        contacts: true,
        activities: { take: 20, orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    res.json({ success: true, data: deal });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/deals - Create deal
router.post('/', async (req, res) => {
  try {
    const {
      name,
      value,
      currency,
      stage,
      probability,
      priority,
      companyId,
      contactIds,
      description,
      nextStep,
      expectedClose,
      competitor,
      ownerId,
      teamId,
      tags,
      customFields
    } = req.body;

    if (!name || value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Deal name and value are required'
      });
    }

    const deal = await prisma.deal.create({
      data: {
        userId: req.user.id,
        name,
        value,
        currency: currency || 'USD',
        stage: stage || 'lead',
        probability: probability || 0,
        priority: priority || 'medium',
        companyId,
        description,
        nextStep,
        expectedClose: expectedClose ? new Date(expectedClose) : null,
        competitor,
        ownerId: ownerId || req.user.id,
        teamId,
        tags: tags || [],
        customFields,
        contacts: contactIds ? { connect: contactIds.map(id => ({ id })) } : undefined
      },
      include: {
        company: { select: { id: true, name: true } },
        contacts: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.status(201).json({ success: true, data: deal });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/deals/:id - Update deal
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.deal.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    const { contactIds, ...updateData } = req.body;

    // Handle stage changes
    if (updateData.stage) {
      if (updateData.stage === 'closed_won' && existing.stage !== 'closed_won') {
        updateData.actualClose = new Date();
      }
      if (updateData.stage === 'closed_lost' && existing.stage !== 'closed_lost') {
        updateData.actualClose = new Date();
      }
    }

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data: {
        ...updateData,
        contacts: contactIds ? { set: contactIds.map(id => ({ id })) } : undefined
      },
      include: {
        company: { select: { id: true, name: true } },
        contacts: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.json({ success: true, data: deal });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/deals/:id/stage - Move deal to new stage
router.put('/:id/stage', async (req, res) => {
  try {
    const { stage, lostReason, wonReason } = req.body;

    const existing = await prisma.deal.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    const updateData = { stage };

    if (stage === 'closed_won') {
      updateData.actualClose = new Date();
      updateData.wonReason = wonReason;
    } else if (stage === 'closed_lost') {
      updateData.actualClose = new Date();
      updateData.lostReason = lostReason;
    }

    // Update probability based on stage
    const stageProbabilities = {
      lead: 10,
      qualified: 25,
      proposal: 50,
      negotiation: 75,
      closed_won: 100,
      closed_lost: 0
    };
    updateData.probability = stageProbabilities[stage] || existing.probability;

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data: updateData
    });

    // Log activity
    await prisma.activity.create({
      data: {
        userId: req.user.id,
        dealId: deal.id,
        type: 'note',
        subject: `Deal moved to ${stage}`,
        description: `Deal stage changed from ${existing.stage} to ${stage}`,
        isCompleted: true,
        completedAt: new Date()
      }
    });

    res.json({ success: true, data: deal });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/deals/:id - Delete deal
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.deal.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    await prisma.deal.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Deal deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
