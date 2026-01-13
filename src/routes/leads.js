// Leads Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, checkLeadLimit } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// Get all leads
router.get('/', async (req, res) => {
  try {
    const { status, source, search, limit = 100, offset = 0 } = req.query;

    const where = { userId: req.user.id };
    
    if (status) where.status = status;
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.lead.count({ where })
    ]);

    // Format leads for frontend
    const formattedLeads = leads.map(lead => ({
      id: lead.id,
      email: lead.email,
      firstName: lead.name?.split(' ')[0] || '',
      lastName: lead.name?.split(' ').slice(1).join(' ') || '',
      name: lead.name,
      company: lead.company,
      phone: lead.phone,
      title: lead.title,
      website: lead.website,
      linkedinUrl: lead.linkedinUrl,
      source: lead.source,
      status: lead.status,
      score: lead.score,
      notes: lead.notes,
      tags: lead.tags,
      customFields: lead.customFields,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      lastContactedAt: lead.lastContactedAt
    }));

    res.json({
      success: true,
      data: {
        leads: formattedLeads,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Get single lead
router.get('/:id', async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({
      success: true,
      data: {
        ...lead,
        firstName: lead.name?.split(' ')[0] || '',
        lastName: lead.name?.split(' ').slice(1).join(' ') || ''
      }
    });
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Create lead
router.post('/', checkLeadLimit, async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      name,
      company,
      phone,
      title,
      website,
      linkedinUrl,
      source,
      status = 'new',
      score = 0,
      notes,
      tags = [],
      customFields
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if lead already exists
    const existingLead = await prisma.lead.findUnique({
      where: {
        userId_email: {
          userId: req.user.id,
          email
        }
      }
    });

    if (existingLead) {
      return res.status(400).json({ error: 'Lead with this email already exists' });
    }

    // Use name if provided, otherwise combine firstName and lastName
    const finalName = name || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || null);

    const lead = await prisma.lead.create({
      data: {
        userId: req.user.id,
        email,
        name: finalName,
        company,
        phone,
        title,
        website,
        linkedinUrl,
        source,
        status,
        score: parseInt(score) || 0,
        notes,
        tags: Array.isArray(tags) ? tags : [],
        customFields: customFields || {}
      }
    });

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: {
        ...lead,
        firstName: lead.name?.split(' ')[0] || '',
        lastName: lead.name?.split(' ').slice(1).join(' ') || ''
      }
    });
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Bulk create leads (for CSV import)
router.post('/bulk', checkLeadLimit, async (req, res) => {
  try {
    const { leads } = req.body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'Leads array is required' });
    }

    // Check lead limit
    const currentCount = await prisma.lead.count({
      where: { userId: req.user.id }
    });

    const limit = req.leadLimit;
    if (currentCount + leads.length > limit) {
      return res.status(403).json({
        error: 'Lead limit exceeded',
        message: `Cannot import ${leads.length} leads. You have ${limit - currentCount} slots remaining.`,
        currentCount,
        limit,
        requested: leads.length
      });
    }

    const createdLeads = [];
    const errors = [];

    for (const leadData of leads) {
      try {
        if (!leadData.email) {
          errors.push({ lead: leadData, error: 'Email is required' });
          continue;
        }

        // Check if lead exists
        const existing = await prisma.lead.findUnique({
          where: {
            userId_email: {
              userId: req.user.id,
              email: leadData.email
            }
          }
        });

        if (existing) {
          errors.push({ lead: leadData, error: 'Lead already exists' });
          continue;
        }

        const name = leadData.name || (leadData.firstName && leadData.lastName ? `${leadData.firstName} ${leadData.lastName}` : leadData.firstName || leadData.lastName || null);

        const lead = await prisma.lead.create({
          data: {
            userId: req.user.id,
            email: leadData.email,
            name,
            company: leadData.company,
            phone: leadData.phone,
            title: leadData.title,
            website: leadData.website,
            linkedinUrl: leadData.linkedinUrl,
            source: leadData.source || 'import',
            status: leadData.status || 'new',
            score: parseInt(leadData.score) || 0,
            notes: leadData.notes,
            tags: Array.isArray(leadData.tags) ? leadData.tags : [],
            customFields: leadData.customFields || {}
          }
        });

        createdLeads.push(lead);
      } catch (error) {
        errors.push({ lead: leadData, error: error.message });
      }
    }

    res.status(201).json({
      success: true,
      message: `Imported ${createdLeads.length} leads`,
      data: {
        created: createdLeads.length,
        failed: errors.length,
        leads: createdLeads,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('Bulk create leads error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const {
      email,
      firstName,
      lastName,
      name,
      company,
      phone,
      title,
      website,
      linkedinUrl,
      source,
      status,
      score,
      notes,
      tags,
      customFields
    } = req.body;

    const updateData = {};
    if (email !== undefined) updateData.email = email;
    if (name !== undefined) {
      updateData.name = name;
    } else if (firstName !== undefined || lastName !== undefined) {
      const currentName = lead.name || '';
      const currentParts = currentName.split(' ');
      const newFirstName = firstName !== undefined ? firstName : currentParts[0] || '';
      const newLastName = lastName !== undefined ? lastName : currentParts.slice(1).join(' ') || '';
      updateData.name = `${newFirstName} ${newLastName}`.trim() || null;
    }
    if (company !== undefined) updateData.company = company;
    if (phone !== undefined) updateData.phone = phone;
    if (title !== undefined) updateData.title = title;
    if (website !== undefined) updateData.website = website;
    if (linkedinUrl !== undefined) updateData.linkedinUrl = linkedinUrl;
    if (source !== undefined) updateData.source = source;
    if (status !== undefined) updateData.status = status;
    if (score !== undefined) updateData.score = parseInt(score);
    if (notes !== undefined) updateData.notes = notes;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];
    if (customFields !== undefined) updateData.customFields = customFields;
    if (status === 'contacted' || status === 'replied') {
      updateData.lastContactedAt = new Date();
    }

    const updatedLead = await prisma.lead.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Lead updated successfully',
      data: {
        ...updatedLead,
        firstName: updatedLead.name?.split(' ')[0] || '',
        lastName: updatedLead.name?.split(' ').slice(1).join(' ') || ''
      }
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await prisma.lead.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Export leads as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const { status, source } = req.query;

    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (source) where.source = source;

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Generate CSV
    const headers = ['Email', 'Name', 'Company', 'Phone', 'Title', 'Website', 'Source', 'Status', 'Score', 'Created At'];
    const rows = leads.map(lead => [
      lead.email,
      lead.name || '',
      lead.company || '',
      lead.phone || '',
      lead.title || '',
      lead.website || '',
      lead.source || '',
      lead.status,
      lead.score || 0,
      lead.createdAt.toISOString()
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=leads-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export leads error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
