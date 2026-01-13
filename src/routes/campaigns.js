// Campaign Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// Get all campaigns
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    const where = { userId: req.user.id };
    if (status && status !== 'all') {
      where.status = status;
    }

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        campaignLeads: {
          include: {
            lead: true
          }
        }
      }
    });

    // Format campaigns for frontend
    const formattedCampaigns = campaigns.map(campaign => ({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      subject: campaign.subject,
      subject_line: campaign.subject, // Alias for frontend compatibility
      email_body: campaign.htmlContent, // Alias for frontend compatibility
      htmlContent: campaign.htmlContent,
      textContent: campaign.textContent,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      scheduledAt: campaign.scheduledAt,
      startedAt: campaign.startedAt,
      completedAt: campaign.completedAt,
      recipientCount: campaign.totalLeads,
      sentCount: campaign.sentCount,
      openedCount: campaign.openCount,
      clickedCount: campaign.clickCount,
      replyCount: campaign.replyCount,
      bounceCount: campaign.bounceCount,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt
    }));

    res.json({
      success: true,
      data: {
        campaigns: formattedCampaigns
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get single campaign
router.get('/:id', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        campaignLeads: {
          include: {
            lead: true
          }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json({
      success: true,
      data: {
        ...campaign,
        subject_line: campaign.subject,
        email_body: campaign.htmlContent
      }
    });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Create campaign
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      type = 'email',
      status = 'draft',
      subject,
      subject_line, // Accept both field names
      email_body, // Accept both field names
      template, // Frontend uses 'template' for email body
      htmlContent,
      textContent,
      fromName,
      fromEmail,
      replyTo,
      scheduledAt,
      leadIds = [] // Array of lead IDs to add to campaign
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required' });
    }

    // Use subject_line if provided, otherwise subject
    const finalSubject = subject_line || subject;
    // Use email_body if provided, otherwise template, otherwise htmlContent
    const finalHtmlContent = email_body || template || htmlContent;

    const campaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: name.includes('-') ? name : `${name} - ${new Date().toISOString().split('T')[0]}`,
        description,
        type,
        status,
        subject: finalSubject,
        htmlContent: finalHtmlContent,
        textContent: textContent || (finalHtmlContent ? finalHtmlContent.replace(/<[^>]*>/g, '') : null),
        fromName,
        fromEmail,
        replyTo,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        totalLeads: leadIds.length
      }
    });

    // Add leads to campaign if provided
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      // Verify leads belong to user
      const userLeads = await prisma.lead.findMany({
        where: {
          id: { in: leadIds },
          userId: req.user.id
        }
      });

      if (userLeads.length > 0) {
        await prisma.campaignLead.createMany({
          data: userLeads.map(lead => ({
            campaignId: campaign.id,
            leadId: lead.id,
            status: 'pending'
          }))
        });

        // Update campaign totalLeads
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { totalLeads: userLeads.length }
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Campaign created successfully',
      data: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          createdAt: campaign.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Update campaign
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      description,
      status,
      subject,
      subject_line,
      email_body,
      htmlContent,
      textContent,
      fromName,
      fromEmail,
      replyTo,
      scheduledAt
    } = req.body;

    // Check campaign exists and belongs to user
    const existingCampaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!existingCampaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (subject_line !== undefined || subject !== undefined) {
      updateData.subject = subject_line || subject;
    }
    if (email_body !== undefined || htmlContent !== undefined) {
      updateData.htmlContent = email_body || htmlContent;
      if (updateData.htmlContent) {
        updateData.textContent = updateData.htmlContent.replace(/<[^>]*>/g, '');
      }
    }
    if (textContent !== undefined) updateData.textContent = textContent;
    if (fromName !== undefined) updateData.fromName = fromName;
    if (fromEmail !== undefined) updateData.fromEmail = fromEmail;
    if (replyTo !== undefined) updateData.replyTo = replyTo;
    if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Campaign updated successfully',
      data: {
        ...campaign,
        subject_line: campaign.subject,
        email_body: campaign.htmlContent
      }
    });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Delete campaign
router.delete('/:id', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await prisma.campaign.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Send campaign
router.post('/:id/send', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        campaignLeads: {
          include: {
            lead: true
          }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status === 'sent') {
      return res.status(400).json({ error: 'Campaign already sent' });
    }

    if (campaign.campaignLeads.length === 0) {
      return res.status(400).json({ error: 'No recipients added to campaign' });
    }

    // TODO: Integrate with email service (SendGrid/AWS SES)
    // For now, simulate sending
    const emailService = process.env.EMAIL_SERVICE || 'mock'; // 'sendgrid', 'ses', 'mock'

    if (emailService === 'mock') {
      // Mock email sending
      const sentCount = campaign.campaignLeads.length;
      
      // Update campaign status
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'sent',
          startedAt: new Date(),
          sentCount: sentCount
        }
      });

      // Create email events for tracking
      for (const campaignLead of campaign.campaignLeads) {
        await prisma.emailEvent.create({
          data: {
            campaignId: campaign.id,
            leadId: campaignLead.leadId,
            eventType: 'sent',
            eventData: { timestamp: new Date().toISOString() }
          }
        });

        await prisma.campaignLead.update({
          where: { id: campaignLead.id },
          data: {
            status: 'sent',
            sentAt: new Date()
          }
        });
      }

      res.json({
        success: true,
        message: `Campaign sent successfully to ${sentCount} recipients`,
        data: {
          campaignId: campaign.id,
          sentCount,
          status: 'sent'
        }
      });
    } else {
      // TODO: Implement actual email service integration
      res.status(501).json({ error: 'Email service not configured' });
    }
  } catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get campaign analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      include: {
        emailEvents: {
          include: {
            lead: true
          }
        },
        campaignLeads: true
      }
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Calculate analytics
    const totalSent = campaign.sentCount || campaign.campaignLeads.filter(cl => cl.status === 'sent').length;
    const totalOpens = campaign.openCount || campaign.emailEvents.filter(e => e.eventType === 'opened').length;
    const totalClicks = campaign.clickCount || campaign.emailEvents.filter(e => e.eventType === 'clicked').length;
    const totalReplies = campaign.replyCount || campaign.emailEvents.filter(e => e.eventType === 'replied').length;
    const totalBounces = campaign.bounceCount || campaign.emailEvents.filter(e => e.eventType === 'bounced').length;

    const openRate = totalSent > 0 ? (totalOpens / totalSent) * 100 : 0;
    const clickRate = totalSent > 0 ? (totalClicks / totalSent) * 100 : 0;
    const replyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
    const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;

    res.json({
      success: true,
      data: {
        campaignId: campaign.id,
        campaignName: campaign.name,
        totalSent,
        totalOpens,
        totalClicks,
        totalReplies,
        totalBounces,
        openRate: Math.round(openRate * 100) / 100,
        clickRate: Math.round(clickRate * 100) / 100,
        replyRate: Math.round(replyRate * 100) / 100,
        bounceRate: Math.round(bounceRate * 100) / 100,
        status: campaign.status,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt
      }
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
