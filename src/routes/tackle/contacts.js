/**
 * Contacts API Routes
 * Tackle.IO - Contact Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/contacts - List contacts
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      search,
      companyId,
      lifecycle,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (companyId) where.companyId = companyId;
    if (lifecycle) where.lifecycle = lifecycle;
    if (status) where.status = status;

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          company: { select: { id: true, name: true } },
          _count: { select: { deals: true, activities: true, calls: true } }
        }
      }),
      prisma.contact.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        contacts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/contacts/:id - Get contact details
router.get('/:id', async (req, res) => {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        company: true,
        deals: { take: 10, orderBy: { createdAt: 'desc' } },
        activities: { take: 20, orderBy: { createdAt: 'desc' } },
        calls: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });

    if (!contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({ success: true, data: contact });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/contacts - Create contact
router.post('/', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      mobile,
      jobTitle,
      department,
      companyId,
      linkedinUrl,
      twitterUrl,
      status,
      leadScore,
      lifecycle,
      source,
      tags,
      customFields,
      emailOptIn,
      phoneOptIn,
      smsOptIn,
      timezone,
      preferredTime
    } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        success: false,
        error: 'First name, last name, and email are required'
      });
    }

    // Check for duplicate email
    const existing = await prisma.contact.findFirst({
      where: { userId: req.user.id, email }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Contact with this email already exists'
      });
    }

    const contact = await prisma.contact.create({
      data: {
        userId: req.user.id,
        firstName,
        lastName,
        email,
        phone,
        mobile,
        jobTitle,
        department,
        companyId,
        linkedinUrl,
        twitterUrl,
        status: status || 'active',
        leadScore: leadScore || 0,
        lifecycle: lifecycle || 'lead',
        source,
        tags: tags || [],
        customFields,
        emailOptIn: emailOptIn !== false,
        phoneOptIn: phoneOptIn !== false,
        smsOptIn: smsOptIn || false,
        timezone,
        preferredTime
      },
      include: {
        company: { select: { id: true, name: true } }
      }
    });

    res.status(201).json({ success: true, data: contact });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/contacts/:id - Update contact
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        company: { select: { id: true, name: true } }
      }
    });

    res.json({ success: true, data: contact });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/contacts/:id - Delete contact
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.contact.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    await prisma.contact.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Contact deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/contacts/import - Bulk import contacts
router.post('/import', async (req, res) => {
  try {
    const { contacts } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ success: false, error: 'Contacts array is required' });
    }

    const results = { created: 0, skipped: 0, errors: [] };

    for (const contact of contacts) {
      try {
        if (!contact.firstName || !contact.lastName || !contact.email) {
          results.skipped++;
          results.errors.push({ email: contact.email, error: 'Missing required fields' });
          continue;
        }

        const existing = await prisma.contact.findFirst({
          where: { userId: req.user.id, email: contact.email }
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        await prisma.contact.create({
          data: {
            userId: req.user.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            jobTitle: contact.jobTitle,
            companyId: contact.companyId,
            source: contact.source || 'import',
            tags: contact.tags || []
          }
        });

        results.created++;

      } catch (err) {
        results.errors.push({ email: contact.email, error: err.message });
      }
    }

    res.json({ success: true, data: results });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
