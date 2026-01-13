// Email Webhook Handler
// Handles inbound emails from SendGrid, AWS SES, etc.

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// SendGrid webhook (POST /webhooks/email/sendgrid)
// Note: SendGrid Inbound Parse sends multipart/form-data, but we accept JSON for testing
router.post('/sendgrid', async (req, res) => {
  try {
    let events = [];
    
    // Handle both raw buffer (from SendGrid) and JSON (from tests)
    if (Buffer.isBuffer(req.body)) {
      try {
        events = JSON.parse(req.body.toString());
        events = Array.isArray(events) ? events : [events];
      } catch (parseError) {
        console.error('Failed to parse webhook body:', parseError);
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }
    } else if (typeof req.body === 'object') {
      // Already parsed JSON
      events = Array.isArray(req.body) ? req.body : [req.body];
    } else {
      return res.status(400).json({ error: 'Invalid webhook format' });
    }
    
    for (const event of events) {
      // Handle both SendGrid event format and direct inbound email format
      if (event.event === 'inbound' || event.from) {
        await processInboundEmail({
          from: event.from || event.headers?.from,
          to: event.to || event.headers?.to,
          subject: event.subject || event.headers?.subject,
          text: event.text || event.plain || event['text/plain'],
          html: event.html || event['text/html'],
          messageId: event['message-id'] || event['Message-Id'] || event.messageId,
          inReplyTo: event['In-Reply-To'] || event['in-reply-to'] || event.inReplyTo,
          references: event.References || event.references,
          timestamp: event.timestamp ? new Date(event.timestamp * 1000) : new Date(),
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('SendGrid webhook error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Webhook processing failed', message: error.message });
  }
});

// AWS SES webhook (POST /webhooks/email/ses)
router.post('/ses', express.json(), async (req, res) => {
  try {
    // AWS SES sends notifications via SNS
    // For inbound emails, you typically use SES Receipt Rules with S3/Lambda
    // This is a simplified handler - adjust based on your SES setup
    
    const { Type, Message } = req.body;
    
    if (Type === 'Notification' && Message) {
      const message = JSON.parse(Message);
      
      if (message.notificationType === 'Received') {
        await processInboundEmail({
          from: message.mail.commonHeaders.from?.[0],
          to: message.mail.commonHeaders.to?.[0],
          subject: message.mail.commonHeaders.subject,
          text: message.content, // May need to fetch from S3
          html: null,
          messageId: message.mail.messageId,
          inReplyTo: message.mail.commonHeaders['in-reply-to']?.[0],
          references: message.mail.commonHeaders.references?.[0],
          timestamp: new Date(message.mail.timestamp),
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('AWS SES webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Generic inbound email processor
async function processInboundEmail({
  from,
  to,
  subject,
  text,
  html,
  messageId,
  inReplyTo,
  references,
  timestamp,
}) {
  try {
    if (!from || !to) {
      throw new Error('Missing required fields: from and to');
    }

    // Extract email address from "Name <email@domain.com>" format
    const extractEmail = (str) => {
      if (!str) return null;
      const match = str.match(/<(.+?)>/);
      return match ? match[1].trim() : str.trim();
    };

    const fromEmail = extractEmail(from);
    const toEmail = extractEmail(to);

    if (!fromEmail || !toEmail) {
      throw new Error('Invalid email addresses');
    }

    // Find or create conversation
    // Check if this is a reply to an existing conversation
    let conversation = null;
    
    if (inReplyTo || references) {
      // Try to find conversation by message ID
      try {
        const existingMessage = await prisma.message.findFirst({
          where: {
            externalMessageId: inReplyTo || references,
          },
          include: {
            conversation: true,
          },
        });

        if (existingMessage) {
          conversation = existingMessage.conversation;
        }
      } catch (dbError) {
        console.error('Error finding existing message:', dbError);
        // Continue to create new conversation
      }
    }

    // If no conversation found, create new one
    if (!conversation) {
      // Try to find existing conversation by email
      try {
        conversation = await prisma.conversation.findFirst({
          where: {
            contactEmail: fromEmail,
            channel: 'email',
          },
          orderBy: { createdAt: 'desc' },
        });
      } catch (dbError) {
        console.error('Error finding existing conversation:', dbError);
      }

      // Create new conversation if none exists
      if (!conversation) {
        // For now, assign to first user (in production, use routing logic)
        try {
          const firstUser = await prisma.user.findFirst({
            orderBy: { createdAt: 'asc' },
          });
          
          if (!firstUser) {
            console.warn('No users found in database - cannot create conversation');
            return; // Skip processing if no users exist
          }

          conversation = await prisma.conversation.create({
            data: {
              userId: firstUser.id,
              contactEmail: fromEmail,
              contactName: from?.replace(/<.+>/, '').trim() || fromEmail.split('@')[0],
              channel: 'email',
              subject: subject || 'No Subject',
              status: 'open',
              priority: 'normal',
              unreadCount: 1,
              messageCount: 0,
            },
          });
        } catch (createError) {
          console.error('Error creating conversation:', createError);
          throw createError;
        }
      }
    }

    if (!conversation) {
      throw new Error('Failed to create or find conversation');
    }

    // Create inbound message
    const messageContent = text || (html ? html.replace(/<[^>]*>/g, '') : '') || 'No content';
    
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: conversation.userId,
        content: messageContent.substring(0, 10000), // Limit content length
        htmlContent: html ? html.substring(0, 50000) : null, // Limit HTML length
        subject: subject || conversation.subject || 'No Subject',
        channel: 'email',
        direction: 'inbound',
        status: 'received',
        externalMessageId: messageId || `inbound-${Date.now()}`,
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

    console.log(`Inbound email processed: ${messageId || 'no-id'} -> Conversation ${conversation.id}`);
    return { conversation, message };
  } catch (error) {
    console.error('Process inbound email error:', error);
    console.error('Error details:', {
      from,
      to,
      subject,
      message: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = router;
