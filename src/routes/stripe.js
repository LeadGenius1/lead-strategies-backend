// Stripe Payment Routes
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

// Create checkout session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { tier, priceId } = req.body;

    if (!tier || !priceId) {
      return res.status(400).json({ error: 'Tier and priceId are required' });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: req.user.email,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/billing?success=true`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/billing?canceled=true`,
      metadata: {
        userId: req.user.id,
        tier: tier.toString()
      }
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url
      }
    });
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Create portal session (manage subscription)
router.post('/create-portal-session', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { stripeCustomerId: true }
    });

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/billing`
    });

    res.json({
      success: true,
      data: {
        url: session.url
      }
    });
  } catch (error) {
    console.error('Create portal session error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
