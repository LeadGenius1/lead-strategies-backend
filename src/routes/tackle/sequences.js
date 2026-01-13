/**
 * Sequences API Routes
 * Tackle.IO - Automated Outreach Sequences
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/sequences - List sequences
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const sequences = await prisma.sequence.findMany({
      where,
      include: { steps: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: sequences });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/sequences/:id - Get sequence details
router.get('/:id', async (req, res) => {
  try {
    const sequence = await prisma.sequence.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { steps: { orderBy: { position: 'asc' } } }
    });

    if (!sequence) {
      return res.status(404).json({ success: false, error: 'Sequence not found' });
    }

    res.json({ success: true, data: sequence });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/sequences - Create sequence
router.post('/', async (req, res) => {
  try {
    const { name, description, channels, timezone, sendingDays, sendingStart, sendingEnd, steps } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Sequence name is required' });
    }

    const sequence = await prisma.sequence.create({
      data: {
        userId: req.user.id,
        name,
        description,
        channels: channels || [],
        timezone,
        sendingDays: sendingDays || ['mon', 'tue', 'wed', 'thu', 'fri'],
        sendingStart,
        sendingEnd,
        steps: steps ? {
          create: steps.map((step, index) => ({
            position: index,
            channel: step.channel,
            delayDays: step.delayDays || 1,
            delayHours: step.delayHours || 0,
            subject: step.subject,
            body: step.body,
            template: step.template
          }))
        } : undefined
      },
      include: { steps: { orderBy: { position: 'asc' } } }
    });

    res.status(201).json({ success: true, data: sequence });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/sequences/:id - Update sequence
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.sequence.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Sequence not found' });
    }

    const { steps, ...updateData } = req.body;

    const sequence = await prisma.sequence.update({
      where: { id: req.params.id },
      data: updateData,
      include: { steps: { orderBy: { position: 'asc' } } }
    });

    res.json({ success: true, data: sequence });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/sequences/:id/activate - Activate sequence
router.put('/:id/activate', async (req, res) => {
  try {
    const sequence = await prisma.sequence.update({
      where: { id: req.params.id },
      data: { status: 'active' }
    });

    res.json({ success: true, data: sequence });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/sequences/:id/pause - Pause sequence
router.put('/:id/pause', async (req, res) => {
  try {
    const sequence = await prisma.sequence.update({
      where: { id: req.params.id },
      data: { status: 'paused' }
    });

    res.json({ success: true, data: sequence });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/sequences/:id/steps - Add step
router.post('/:id/steps', async (req, res) => {
  try {
    const sequence = await prisma.sequence.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { steps: true }
    });

    if (!sequence) {
      return res.status(404).json({ success: false, error: 'Sequence not found' });
    }

    const { channel, delayDays, delayHours, subject, body, template } = req.body;

    const step = await prisma.sequenceStep.create({
      data: {
        sequenceId: sequence.id,
        position: sequence.steps.length,
        channel,
        delayDays: delayDays || 1,
        delayHours: delayHours || 0,
        subject,
        body,
        template
      }
    });

    res.status(201).json({ success: true, data: step });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/sequences/:id - Delete sequence
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.sequence.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Sequence not found' });
    }

    await prisma.sequence.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Sequence deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
