/**
 * Pipelines API Routes
 * Tackle.IO - Custom Sales Pipeline Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/pipelines - List pipelines
router.get('/', async (req, res) => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      where: { userId: req.user.id },
      include: {
        stages: { orderBy: { position: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: pipelines });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/pipelines/:id - Get pipeline with stages
router.get('/:id', async (req, res) => {
  try {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        stages: { orderBy: { position: 'asc' } }
      }
    });

    if (!pipeline) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }

    res.json({ success: true, data: pipeline });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/pipelines - Create pipeline
router.post('/', async (req, res) => {
  try {
    const { name, description, isDefault, stages } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Pipeline name is required' });
    }

    // If this is default, unset other defaults
    if (isDefault) {
      await prisma.pipeline.updateMany({
        where: { userId: req.user.id, isDefault: true },
        data: { isDefault: false }
      });
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        userId: req.user.id,
        name,
        description,
        isDefault: isDefault || false,
        stages: stages ? {
          create: stages.map((stage, index) => ({
            name: stage.name,
            position: index,
            probability: stage.probability || 0,
            color: stage.color,
            rottingDays: stage.rottingDays
          }))
        } : undefined
      },
      include: {
        stages: { orderBy: { position: 'asc' } }
      }
    });

    res.status(201).json({ success: true, data: pipeline });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/pipelines/:id - Update pipeline
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }

    const { name, description, isDefault } = req.body;

    if (isDefault) {
      await prisma.pipeline.updateMany({
        where: { userId: req.user.id, isDefault: true },
        data: { isDefault: false }
      });
    }

    const pipeline = await prisma.pipeline.update({
      where: { id: req.params.id },
      data: { name, description, isDefault },
      include: { stages: { orderBy: { position: 'asc' } } }
    });

    res.json({ success: true, data: pipeline });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/pipelines/:id/stages - Add stage to pipeline
router.post('/:id/stages', async (req, res) => {
  try {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { stages: true }
    });

    if (!pipeline) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }

    const { name, probability, color, rottingDays } = req.body;

    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        name,
        position: pipeline.stages.length,
        probability: probability || 0,
        color,
        rottingDays
      }
    });

    res.status(201).json({ success: true, data: stage });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/pipelines/:id/stages/reorder - Reorder stages
router.put('/:id/stages/reorder', async (req, res) => {
  try {
    const { stageIds } = req.body;

    for (let i = 0; i < stageIds.length; i++) {
      await prisma.pipelineStage.update({
        where: { id: stageIds[i] },
        data: { position: i }
      });
    }

    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id },
      include: { stages: { orderBy: { position: 'asc' } } }
    });

    res.json({ success: true, data: pipeline });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/pipelines/:id - Delete pipeline
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }

    await prisma.pipeline.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Pipeline deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
