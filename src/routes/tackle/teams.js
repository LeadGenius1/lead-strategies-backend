/**
 * Teams API Routes
 * Tackle.IO - Team Management
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET /api/v1/tackle/teams - List teams
router.get('/', async (req, res) => {
  try {
    const teams = await prisma.team.findMany({
      where: {
        members: { some: { userId: req.user.id } }
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    res.json({ success: true, data: teams });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/teams/:id - Get team details
router.get('/:id', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: {
        id: req.params.id,
        members: { some: { userId: req.user.id } }
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    res.json({ success: true, data: team });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/teams - Create team
router.post('/', async (req, res) => {
  try {
    const { name, description, settings } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Team name is required' });
    }

    const team = await prisma.team.create({
      data: {
        name,
        description,
        ownerId: req.user.id,
        settings,
        members: {
          create: {
            userId: req.user.id,
            role: 'owner'
          }
        }
      },
      include: { members: true }
    });

    res.status(201).json({ success: true, data: team });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/teams/:id - Update team
router.put('/:id', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, ownerId: req.user.id }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found or not owner' });
    }

    const { name, description, settings } = req.body;

    const updated = await prisma.team.update({
      where: { id: req.params.id },
      data: { name, description, settings }
    });

    res.json({ success: true, data: updated });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/teams/:id/members - Add team member
router.post('/:id/members', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, ownerId: req.user.id }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found or not owner' });
    }

    const { userId, role, quota, quotaPeriod } = req.body;

    const member = await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId,
        role: role || 'member',
        quota,
        quotaPeriod
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json({ success: true, data: member });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/teams/:id/members/:memberId - Update member
router.put('/:id/members/:memberId', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, ownerId: req.user.id }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found or not owner' });
    }

    const { role, quota, quotaPeriod, isActive } = req.body;

    const member = await prisma.teamMember.update({
      where: { id: req.params.memberId },
      data: { role, quota, quotaPeriod, isActive }
    });

    res.json({ success: true, data: member });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/teams/:id/members/:memberId - Remove member
router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, ownerId: req.user.id }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found or not owner' });
    }

    await prisma.teamMember.delete({ where: { id: req.params.memberId } });

    res.json({ success: true, message: 'Member removed' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/v1/tackle/teams/:id - Delete team
router.delete('/:id', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, ownerId: req.user.id }
    });

    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found or not owner' });
    }

    await prisma.team.delete({ where: { id: req.params.id } });

    res.json({ success: true, message: 'Team deleted' });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
