// SMS Webhook Handler
// Handles inbound SMS from Twilio

const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Twilio webhook (POST /webhooks/sms/twilio)
router.post('/twilio', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { From, To, Body, MessageSid } = req.body;

    if (!From || !To || !Body) {
      return res.status(400).send('Missing required fields');
    }

    await processInboundSMS({
      from: From,
      to: To,
      body: Body,
      messageId: MessageSid,
      timestamp: new Date(),
    });

    // Twilio expects TwiML response
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Twilio webhook error:', error);
    res.status(500).send('Error processing SMS');
  }
});

// Generic inbound SMS processor
async function processInboundSMS({
  from,
  to,
  body,
  messageId,
  timestamp,
}) {
  try {
    // Format phone number
    const formatPhone = (phone) => {
      return phone.replace(/\D/g, '');
    };

    const fromPhone = formatPhone(from);
    const toPhone = formatPhone(to);

    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: {
        contactPhone: fromPhone,
        channel: 'sms',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Create new conversation if none exists
    if (!conversation) {
      // For now, assign to first user (in production, use routing logic)
      const firstUser = await prisma.user.findFirst();
      if (!firstUser) {
        throw new Error('No users found in database');
      }

      conversation = await prisma.conversation.create({
        data: {
          userId: firstUser.id,
          contactPhone: fromPhone,
          contactName: `SMS: ${fromPhone}`,
          channel: 'sms',
          subject: 'SMS Conversation',
          status: 'open',
          priority: 'normal',
          unreadCount: 1,
          messageCount: 0,
        },
      });
    }

    // Create inbound message
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: conversation.userId,
        content: body,
        channel: 'sms',
        direction: 'inbound',
        status: 'received',
        externalMessageId: messageId,
        receivedAt: timestamp || new Date(),
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        unreadCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    console.log(`Inbound SMS processed: ${messageId} -> Conversation ${conversation.id}`);
  } catch (error) {
    console.error('Process inbound SMS error:', error);
    throw error;
  }
}

module.exports = router;
