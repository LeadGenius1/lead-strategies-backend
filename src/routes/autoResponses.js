// ClientContact.IO - Auto-Response Rules Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireFeature } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication and unified_inbox feature (Tier 3+)
router.use(authenticate);
router.use(requireFeature('unified_inbox'));

// Get all auto-response rules
router.get('/', async (req, res) => {
  try {
    const { enabled } = req.query;
    const userId = req.user.id;

    const where = {
      userId,
      ...(enabled !== undefined && { enabled: enabled === 'true' }),
    };

    const rules = await prisma.autoResponse.findMany({
      where,
      include: {
        cannedResponse: true,
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: { rules },
    });
  } catch (error) {
    console.error('Get auto-responses error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch auto-response rules',
    });
  }
});

// Get single auto-response rule
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const rule = await prisma.autoResponse.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        cannedResponse: true,
      },
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        error: 'Auto-response rule not found',
      });
    }

    res.json({
      success: true,
      data: { rule },
    });
  } catch (error) {
    console.error('Get auto-response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch auto-response rule',
    });
  }
});

// Create auto-response rule
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      enabled = true,
      triggerType,
      conditions,
      cannedResponseId,
      responseContent,
      responseSubject,
      channels,
      priority = 0,
      delaySeconds = 0,
      maxPerDay,
      maxPerContact,
    } = req.body;
    const userId = req.user.id;

    if (!name || !triggerType || !conditions) {
      return res.status(400).json({
        success: false,
        error: 'Name, triggerType, and conditions are required',
      });
    }

    if (!cannedResponseId && !responseContent) {
      return res.status(400).json({
        success: false,
        error: 'Either cannedResponseId or responseContent is required',
      });
    }

    // Verify canned response exists if provided
    if (cannedResponseId) {
      const cannedResponse = await prisma.cannedResponse.findFirst({
        where: {
          id: cannedResponseId,
          userId,
        },
      });

      if (!cannedResponse) {
        return res.status(404).json({
          success: false,
          error: 'Canned response not found',
        });
      }
    }

    const rule = await prisma.autoResponse.create({
      data: {
        userId,
        name: name.trim(),
        description: description?.trim(),
        enabled,
        triggerType,
        conditions: conditions || {},
        cannedResponseId: cannedResponseId || null,
        responseContent: responseContent?.trim() || null,
        responseSubject: responseSubject?.trim() || null,
        channels: channels || [],
        priority,
        delaySeconds,
        maxPerDay,
        maxPerContact,
      },
      include: {
        cannedResponse: true,
      },
    });

    res.json({
      success: true,
      data: { rule },
    });
  } catch (error) {
    console.error('Create auto-response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create auto-response rule',
    });
  }
});

// Update auto-response rule
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      enabled,
      triggerType,
      conditions,
      cannedResponseId,
      responseContent,
      responseSubject,
      channels,
      priority,
      delaySeconds,
      maxPerDay,
      maxPerContact,
    } = req.body;
    const userId = req.user.id;

    // Verify ownership
    const existing = await prisma.autoResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Auto-response rule not found',
      });
    }

    // Verify canned response if provided
    if (cannedResponseId && cannedResponseId !== existing.cannedResponseId) {
      const cannedResponse = await prisma.cannedResponse.findFirst({
        where: {
          id: cannedResponseId,
          userId,
        },
      });

      if (!cannedResponse) {
        return res.status(404).json({
          success: false,
          error: 'Canned response not found',
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (enabled !== undefined) updateData.enabled = enabled;
    if (triggerType !== undefined) updateData.triggerType = triggerType;
    if (conditions !== undefined) updateData.conditions = conditions;
    if (cannedResponseId !== undefined) updateData.cannedResponseId = cannedResponseId || null;
    if (responseContent !== undefined) updateData.responseContent = responseContent?.trim() || null;
    if (responseSubject !== undefined) updateData.responseSubject = responseSubject?.trim() || null;
    if (channels !== undefined) updateData.channels = channels;
    if (priority !== undefined) updateData.priority = priority;
    if (delaySeconds !== undefined) updateData.delaySeconds = delaySeconds;
    if (maxPerDay !== undefined) updateData.maxPerDay = maxPerDay;
    if (maxPerContact !== undefined) updateData.maxPerContact = maxPerContact;

    const rule = await prisma.autoResponse.update({
      where: { id },
      data: updateData,
      include: {
        cannedResponse: true,
      },
    });

    res.json({
      success: true,
      data: { rule },
    });
  } catch (error) {
    console.error('Update auto-response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update auto-response rule',
    });
  }
});

// Delete auto-response rule
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const existing = await prisma.autoResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Auto-response rule not found',
      });
    }

    await prisma.autoResponse.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Auto-response rule deleted',
    });
  } catch (error) {
    console.error('Delete auto-response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete auto-response rule',
    });
  }
});

module.exports = router;
