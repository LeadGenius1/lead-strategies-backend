// ClientContact.IO - Unified Inbox Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireFeature } = require('../middleware/auth');
const channelService = require('../services/channelService');
const emailService = require('../services/emailService');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication and unified_inbox feature (Tier 3+)
router.use(authenticate);
router.use(requireFeature('unified_inbox'));

// Get all conversations (unified inbox)
router.get('/', async (req, res) => {
  try {
    const { status, channel, search, limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    const where = {
      userId,
      ...(status && { status }),
      ...(channel && { channel }),
      ...(search && {
        OR: [
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactEmail: { contains: search, mode: 'insensitive' } },
          { subject: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Get latest message for preview
          },
          _count: {
            select: { messages: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.conversation.count({ where }),
    ]);

    // Format response
    const formatted = conversations.map((conv) => ({
      id: conv.id,
      contactName: conv.contactName,
      contactEmail: conv.contactEmail,
      contactPhone: conv.contactPhone,
      channel: conv.channel,
      subject: conv.subject,
      status: conv.status,
      priority: conv.priority,
      unreadCount: conv.unreadCount,
      messageCount: conv._count.messages,
      lastMessage: conv.messages[0] ? {
        content: conv.messages[0].content.substring(0, 100),
        direction: conv.messages[0].direction,
        createdAt: conv.messages[0].createdAt,
      } : null,
      lastMessageAt: conv.lastMessageAt,
      tags: conv.tags,
      labels: conv.labels,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));

    res.json({
      success: true,
      data: {
        conversations: formatted,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations',
    });
  }
});

// Get single conversation with messages
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        notes: {
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
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    // Mark messages as read
    await prisma.message.updateMany({
      where: {
        conversationId: id,
        isRead: false,
        direction: 'inbound',
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Update conversation unread count
    await prisma.conversation.update({
      where: { id },
      data: {
        unreadCount: 0,
      },
    });

    res.json({
      success: true,
      data: { conversation },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversation',
    });
  }
});

// Send message (create outbound message)
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, htmlContent, subject } = req.body;
    const userId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }

    // Verify conversation belongs to user
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    // Create outbound message
    const message = await prisma.message.create({
      data: {
        conversationId: id,
        userId,
        content: content.trim(),
        htmlContent,
        subject,
        channel: conversation.channel,
        direction: 'outbound',
        status: 'sent',
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Send message via appropriate channel
    try {
      // Get previous message for threading (email only)
      let inReplyTo = null;
      let references = null;
      if (conversation.channel === 'email') {
        const previousMessage = await prisma.message.findFirst({
          where: {
            conversationId: id,
            direction: 'outbound',
          },
          orderBy: { createdAt: 'desc' },
        });
        
        if (previousMessage && previousMessage.externalMessageId) {
          const threadHeaders = emailService.generateThreadHeaders(
            id,
            message.id,
            previousMessage.externalMessageId
          );
          inReplyTo = threadHeaders.inReplyTo;
          references = threadHeaders.references;
        }
      }

      // Send via channel service
      const sendResult = await channelService.sendMessage({
        channel: conversation.channel,
        to: conversation.channel === 'email' ? conversation.contactEmail : conversation.contactPhone,
        content: content.trim(),
        htmlContent,
        subject: subject || conversation.subject || 'Re: ' + (conversation.subject || 'Message'),
        from: conversation.channel === 'email' ? (req.user.email || process.env.FROM_EMAIL) : undefined,
        fromName: req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : undefined,
        replyTo: conversation.channel === 'email' ? conversation.contactEmail : undefined,
        inReplyTo,
        references,
      });

      // Update message with external message ID
      await prisma.message.update({
        where: { id: message.id },
        data: {
          externalMessageId: sendResult.messageId,
          status: sendResult.status || 'sent',
          sentAt: new Date(),
        },
      });

      console.log(`Message sent via ${conversation.channel}:`, sendResult.messageId);
    } catch (sendError) {
      console.error('Failed to send message via channel:', sendError);
      
      // Update message status to failed
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: 'failed',
          errorMessage: sendError.message,
        },
      });

      // Still return success to user, but log the error
      // In production, you might want to return an error or queue for retry
    }

    res.json({
      success: true,
      data: { message },
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
    });
  }
});

// Update conversation (status, tags, labels, etc.)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, tags, labels, assignedTo } = req.body;
    const userId = req.user.id;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
      });
    }

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (tags !== undefined) updateData.tags = tags;
    if (labels !== undefined) updateData.labels = labels;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
    if (status === 'closed') updateData.closedAt = new Date();

    const updated = await prisma.conversation.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      data: { conversation: updated },
    });
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update conversation',
    });
  }
});

// Get inbox stats
router.get('/stats/inbox', async (req, res) => {
  try {
    const userId = req.user.id;

    const [total, unread, open, closed, byChannel] = await Promise.all([
      prisma.conversation.count({ where: { userId } }),
      prisma.conversation.count({ where: { userId, unreadCount: { gt: 0 } } }),
      prisma.conversation.count({ where: { userId, status: 'open' } }),
      prisma.conversation.count({ where: { userId, status: 'closed' } }),
      prisma.conversation.groupBy({
        by: ['channel'],
        where: { userId },
        _count: true,
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        unread,
        open,
        closed,
        byChannel: byChannel.map((item) => ({
          channel: item.channel,
          count: item._count,
        })),
      },
    });
  } catch (error) {
    console.error('Get inbox stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inbox stats',
    });
  }
});

module.exports = router;
