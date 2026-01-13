/**
 * Companies API Routes
 * Tackle.IO - B2B Company Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/companies - List companies
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      search,
      industry,
      accountTier,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (industry) where.industry = industry;
    if (accountTier) where.accountTier = accountTier;

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          _count: {
            select: { contacts: true, deals: true }
          }
        }
      }),
      prisma.company.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        companies,
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

// GET /api/v1/tackle/companies/:id - Get company details
router.get('/:id', async (req, res) => {
  try {
    const company = await prisma.company.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        contacts: { take: 10, orderBy: { createdAt: 'desc' } },
        deals: { take: 10, orderBy: { createdAt: 'desc' } },
        activities: { take: 10, orderBy: { createdAt: 'desc' } }
      }
    });

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    res.json({ success: true, data: company });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/companies - Create company
router.post('/', async (req, res) => {
  try {
    const {
      name,
      domain,
      industry,
      size,
      revenue,
      website,
      linkedinUrl,
      phone,
      address,
      city,
      state,
      country,
      postalCode,
      description,
      foundedYear,
      employeeCount,
      technologies,
      funding,
      accountOwner,
      accountTier,
      tags,
      customFields
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Company name is required' });
    }

    const company = await prisma.company.create({
      data: {
        userId: req.user.id,
        name,
        domain,
        industry,
        size,
        revenue,
        website,
        linkedinUrl,
        phone,
        address,
        city,
        state,
        country,
        postalCode,
        description,
        foundedYear,
        employeeCount,
        technologies: technologies || [],
        funding,
        accountOwner,
        accountTier: accountTier || 'prospect',
        tags: tags || [],
        customFields
      }
    });

    res.status(201).json({ success: true, data: company });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/companies/:id - Update company
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.company.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({ success: true, data: company });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/companies/:id - Delete company
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.company.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    await prisma.company.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Company deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
