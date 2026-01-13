/**
 * Documents API Routes
 * Tackle.IO - Document & Proposal Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/documents - List documents
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 50, type, status, dealId, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { userId };

    if (type) where.type = type;
    if (status) where.status = status;
    if (dealId) where.dealId = dealId;

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          deal: { select: { id: true, name: true, value: true } }
        }
      }),
      prisma.document.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        documents,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/documents/:id - Get document details
router.get('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { deal: true }
    });

    if (!document) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    // Increment view count
    await prisma.document.update({
      where: { id: document.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() }
    });

    res.json({ success: true, data: document });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/documents - Create document
router.post('/', async (req, res) => {
  try {
    const { name, type, mimeType, size, url, storageKey, dealId, status } = req.body;

    if (!name || !type || !url) {
      return res.status(400).json({ success: false, error: 'Name, type, and URL are required' });
    }

    const document = await prisma.document.create({
      data: {
        userId: req.user.id,
        name,
        type,
        mimeType,
        size,
        url,
        storageKey,
        dealId,
        status: status || 'draft'
      }
    });

    res.status(201).json({ success: true, data: document });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/documents/:id - Update document
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const document = await prisma.document.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({ success: true, data: document });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/documents/:id - Delete document
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.document.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    await prisma.document.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Document deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
