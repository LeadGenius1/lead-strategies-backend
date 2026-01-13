// ClientContact.IO - Conversation Notes Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireFeature } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication and unified_inbox feature (Tier 3+)
router.use(authenticate);
router.use(requireFeature('unified_inbox'));

// Get all notes for a conversation
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Verify conversation belongs to user
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const notes = await prisma.conversationNote.findMany({
      where: {
        conversationId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: { notes },
    });
  } catch (error) {
    console.error('Get conversation notes error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversation notes',
    });
  }
});

// Get single note
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const note = await prisma.conversationNote.findFirst({
      where: {
        id,
        conversation: {
          userId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        conversation: {
          select: {
            id: true,
            contactName: true,
            contactEmail: true,
            channel: true,
          },
        },
      },
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'Note not found',
      });
    }

    res.json({
      success: true,
      data: { note },
    });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch note',
    });
  }
});

// Create note
router.post('/', async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    const userId = req.user.id;

    if (!conversationId || !content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Conversation ID and content are required',
      });
    }

    // Verify conversation belongs to user
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const note = await prisma.conversationNote.create({
      data: {
        conversationId,
        userId,
        content: content.trim(),
        isInternal: true, // Always internal
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: { note },
    });
  } catch (error) {
    console.error('Create note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create note',
    });
  }
});

// Update note
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Content is required',
      });
    }

    // Verify ownership
    const existing = await prisma.conversationNote.findFirst({
      where: {
        id,
        userId, // Only owner can update
        conversation: {
          userId, // And conversation must belong to user
        },
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Note not found or you do not have permission',
      });
    }

    const note = await prisma.conversationNote.update({
      where: { id },
      data: {
        content: content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: { note },
    });
  } catch (error) {
    console.error('Update note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update note',
    });
  }
});

// Delete note
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const existing = await prisma.conversationNote.findFirst({
      where: {
        id,
        userId, // Only owner can delete
        conversation: {
          userId, // And conversation must belong to user
        },
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Note not found or you do not have permission',
      });
    }

    await prisma.conversationNote.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Note deleted',
    });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete note',
    });
  }
});

module.exports = router;
