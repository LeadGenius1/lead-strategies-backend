/**
 * Activities API Routes
 * Tackle.IO - Activity & Task Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/activities - List activities
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      type,
      contactId,
      dealId,
      companyId,
      isCompleted,
      assignedTo,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };

    if (type) where.type = type;
    if (contactId) where.contactId = contactId;
    if (dealId) where.dealId = dealId;
    if (companyId) where.companyId = companyId;
    if (isCompleted !== undefined) where.isCompleted = isCompleted === 'true';
    if (assignedTo) where.assignedTo = assignedTo;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true } },
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true, value: true } }
        }
      }),
      prisma.activity.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        activities,
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

// GET /api/v1/tackle/activities/upcoming - Get upcoming tasks
router.get('/upcoming', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 7 } = req.query;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days));

    const activities = await prisma.activity.findMany({
      where: {
        userId,
        isCompleted: false,
        dueDate: {
          gte: new Date(),
          lte: endDate
        }
      },
      orderBy: { dueDate: 'asc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, name: true } }
      }
    });

    res.json({ success: true, data: activities });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/activities/overdue - Get overdue tasks
router.get('/overdue', async (req, res) => {
  try {
    const userId = req.user.id;

    const activities = await prisma.activity.findMany({
      where: {
        userId,
        isCompleted: false,
        dueDate: { lt: new Date() }
      },
      orderBy: { dueDate: 'asc' },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, name: true } }
      }
    });

    res.json({ success: true, data: activities });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/activities/:id - Get activity details
router.get('/:id', async (req, res) => {
  try {
    const activity = await prisma.activity.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        contact: true,
        company: true,
        deal: true
      }
    });

    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    res.json({ success: true, data: activity });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/activities - Create activity
router.post('/', async (req, res) => {
  try {
    const {
      type,
      subject,
      description,
      outcome,
      contactId,
      companyId,
      dealId,
      dueDate,
      duration,
      assignedTo,
      priority,
      reminderAt,
      metadata
    } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, error: 'Activity type is required' });
    }

    const activity = await prisma.activity.create({
      data: {
        userId: req.user.id,
        type,
        subject,
        description,
        outcome,
        contactId,
        companyId,
        dealId,
        dueDate: dueDate ? new Date(dueDate) : null,
        duration,
        assignedTo: assignedTo || req.user.id,
        priority: priority || 'normal',
        reminderAt: reminderAt ? new Date(reminderAt) : null,
        metadata
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, name: true } }
      }
    });

    // Update contact's lastContactedAt if contact is linked
    if (contactId) {
      await prisma.contact.update({
        where: { id: contactId },
        data: { lastContactedAt: new Date() }
      });
    }

    res.status(201).json({ success: true, data: activity });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/activities/:id - Update activity
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.activity.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    const activity = await prisma.activity.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, name: true } }
      }
    });

    res.json({ success: true, data: activity });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/activities/:id/complete - Mark activity as complete
router.put('/:id/complete', async (req, res) => {
  try {
    const { outcome } = req.body;

    const existing = await prisma.activity.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    const activity = await prisma.activity.update({
      where: { id: req.params.id },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        outcome: outcome || 'completed'
      }
    });

    res.json({ success: true, data: activity });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/activities/:id - Delete activity
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.activity.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }

    await prisma.activity.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Activity deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
