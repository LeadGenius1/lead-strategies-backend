/**
 * Calls API Routes
 * Tackle.IO - Voice Call Management with Twilio
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Twilio client (initialize if credentials exist)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// GET /api/v1/tackle/calls - List calls
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 50,
      contactId,
      direction,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };

    if (contactId) where.contactId = contactId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          contact: { select: { id: true, firstName: true, lastName: true, email: true } }
        }
      }),
      prisma.call.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        calls,
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

// GET /api/v1/tackle/calls/:id - Get call details
router.get('/:id', async (req, res) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { contact: true }
    });

    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    res.json({ success: true, data: call });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/calls/initiate - Initiate outbound call
router.post('/initiate', async (req, res) => {
  try {
    const { toNumber, contactId, fromNumber } = req.body;

    if (!toNumber) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    if (!twilioClient) {
      return res.status(503).json({
        success: false,
        error: 'Voice calling not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.'
      });
    }

    const userFromNumber = fromNumber || process.env.TWILIO_PHONE_NUMBER;

    // Create call record
    const call = await prisma.call.create({
      data: {
        userId: req.user.id,
        contactId,
        direction: 'outbound',
        status: 'initiated',
        fromNumber: userFromNumber,
        toNumber,
        startedAt: new Date()
      }
    });

    // Initiate Twilio call
    try {
      const twilioCall = await twilioClient.calls.create({
        url: `${process.env.APP_URL}/api/v1/webhooks/twilio/voice`,
        to: toNumber,
        from: userFromNumber,
        record: true,
        statusCallback: `${process.env.APP_URL}/api/v1/webhooks/twilio/status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
      });

      // Update with Twilio SID
      await prisma.call.update({
        where: { id: call.id },
        data: {
          twilioSid: twilioCall.sid,
          status: 'ringing'
        }
      });

      res.json({
        success: true,
        data: {
          callId: call.id,
          twilioSid: twilioCall.sid,
          status: 'ringing'
        }
      });

    } catch (twilioError) {
      // Update call as failed
      await prisma.call.update({
        where: { id: call.id },
        data: { status: 'failed' }
      });

      throw twilioError;
    }

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tackle/calls/:id/end - End active call
router.post('/:id/end', async (req, res) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    if (twilioClient && call.twilioSid) {
      await twilioClient.calls(call.twilioSid).update({ status: 'completed' });
    }

    const endedAt = new Date();
    const duration = call.startedAt ? Math.round((endedAt - call.startedAt) / 1000) : 0;

    const updatedCall = await prisma.call.update({
      where: { id: call.id },
      data: {
        status: 'completed',
        endedAt,
        duration
      }
    });

    res.json({ success: true, data: updatedCall });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/v1/tackle/calls/:id - Update call (notes, outcome, etc.)
router.put('/:id', async (req, res) => {
  try {
    const { notes, outcome, sentiment, keywords, summary, actionItems } = req.body;

    const existing = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    const call = await prisma.call.update({
      where: { id: req.params.id },
      data: {
        notes,
        outcome,
        sentiment,
        keywords: keywords || existing.keywords,
        summary,
        actionItems: actionItems || existing.actionItems
      }
    });

    res.json({ success: true, data: call });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/calls/:id/recording - Get call recording
router.get('/:id/recording', async (req, res) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    if (!call.recordingUrl) {
      return res.status(404).json({ success: false, error: 'No recording available' });
    }

    res.json({
      success: true,
      data: {
        recordingUrl: call.recordingUrl,
        transcription: call.transcription,
        transcriptionStatus: call.transcriptionStatus
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tackle/calls/stats - Get call statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const where = { userId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [
      totalCalls,
      completedCalls,
      totalDuration,
      callsByDirection,
      callsByOutcome
    ] = await Promise.all([
      prisma.call.count({ where }),
      prisma.call.count({ where: { ...where, status: 'completed' } }),
      prisma.call.aggregate({ where, _sum: { duration: true } }),
      prisma.call.groupBy({ by: ['direction'], where, _count: true }),
      prisma.call.groupBy({ by: ['outcome'], where, _count: true })
    ]);

    res.json({
      success: true,
      data: {
        totalCalls,
        completedCalls,
        totalDuration: totalDuration._sum.duration || 0,
        avgDuration: completedCalls > 0 ? Math.round((totalDuration._sum.duration || 0) / completedCalls) : 0,
        byDirection: callsByDirection.reduce((acc, c) => ({ ...acc, [c.direction]: c._count }), {}),
        byOutcome: callsByOutcome.reduce((acc, c) => ({ ...acc, [c.outcome || 'unknown']: c._count }), {})
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
