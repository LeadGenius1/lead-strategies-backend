// ClientContact.IO - Canned Responses/Templates Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireFeature } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication and unified_inbox feature (Tier 3+)
router.use(authenticate);
router.use(requireFeature('unified_inbox'));

// Get all canned responses
router.get('/', async (req, res) => {
  try {
    const { category, channel, search } = req.query;
    const userId = req.user.id;

    const where = {
      userId,
      ...(category && { category }),
      ...(channel && {
        OR: [
          { channels: { has: channel } },
          { channels: { equals: [] } }, // Empty array means all channels
        ],
      }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const responses = await prisma.cannedResponse.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: { responses },
    });
  } catch (error) {
    console.error('Get canned responses error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch canned responses',
    });
  }
});

// Get single canned response
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const response = await prisma.cannedResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!response) {
      return res.status(404).json({
        success: false,
        error: 'Canned response not found',
      });
    }

    res.json({
      success: true,
      data: { response },
    });
  } catch (error) {
    console.error('Get canned response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch canned response',
    });
  }
});

// Create canned response
router.post('/', async (req, res) => {
  try {
    const { name, content, htmlContent, subject, category, tags, channels, variables } = req.body;
    const userId = req.user.id;

    if (!name || !content) {
      return res.status(400).json({
        success: false,
        error: 'Name and content are required',
      });
    }

    // Extract variables from content (simple extraction for now)
    const extractedVariables = variables || [];
    const variableRegex = /\{\{(\w+)\}\}/g;
    let match;
    const foundVariables = new Set(extractedVariables);
    const fullContent = (htmlContent || content);
    while ((match = variableRegex.exec(fullContent)) !== null) {
      foundVariables.add(match[1]);
    }

    const response = await prisma.cannedResponse.create({
      data: {
        userId,
        name: name.trim(),
        content: content.trim(),
        htmlContent: htmlContent?.trim(),
        subject: subject?.trim(),
        category: category?.trim(),
        tags: tags || [],
        channels: channels || [],
        variables: Array.from(foundVariables),
      },
    });

    res.json({
      success: true,
      data: { response },
    });
  } catch (error) {
    console.error('Create canned response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create canned response',
    });
  }
});

// Update canned response
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, content, htmlContent, subject, category, tags, channels, variables } = req.body;
    const userId = req.user.id;

    // Verify ownership
    const existing = await prisma.cannedResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Canned response not found',
      });
    }

    // Extract variables if content changed
    let extractedVariables = variables || existing.variables;
    if (content || htmlContent) {
      const foundVariables = new Set(extractedVariables);
      const variableRegex = /\{\{(\w+)\}\}/g;
      let match;
      const fullContent = (htmlContent || content || existing.content || existing.htmlContent || '');
      while ((match = variableRegex.exec(fullContent)) !== null) {
        foundVariables.add(match[1]);
      }
      extractedVariables = Array.from(foundVariables);
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (htmlContent !== undefined) updateData.htmlContent = htmlContent?.trim();
    if (subject !== undefined) updateData.subject = subject?.trim();
    if (category !== undefined) updateData.category = category?.trim();
    if (tags !== undefined) updateData.tags = tags;
    if (channels !== undefined) updateData.channels = channels;
    if (variables !== undefined) updateData.variables = extractedVariables;

    const response = await prisma.cannedResponse.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      data: { response },
    });
  } catch (error) {
    console.error('Update canned response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update canned response',
    });
  }
});

// Delete canned response
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const existing = await prisma.cannedResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Canned response not found',
      });
    }

    await prisma.cannedResponse.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Canned response deleted',
    });
  } catch (error) {
    console.error('Delete canned response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete canned response',
    });
  }
});

// Use canned response (increment use count)
router.post('/:id/use', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const response = await prisma.cannedResponse.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!response) {
      return res.status(404).json({
        success: false,
        error: 'Canned response not found',
      });
    }

    const updated = await prisma.cannedResponse.update({
      where: { id },
      data: {
        useCount: { increment: 1 },
      },
    });

    res.json({
      success: true,
      data: { response: updated },
    });
  } catch (error) {
    console.error('Use canned response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update use count',
    });
  }
});

module.exports = router;
