// Webhook Routes
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Channel webhook routes
const emailWebhooks = require('./webhooks/email');
const smsWebhooks = require('./webhooks/sms');

// Mount channel webhooks
router.use('/email', emailWebhooks);
router.use('/sms', smsWebhooks);

// Stripe webhook handler
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const tier = parseInt(session.metadata?.tier) || 1;

        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
              subscriptionStatus: 'active',
              tier: tier
            }
          });
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeSubscriptionId: subscription.id }
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: subscription.status === 'active' ? 'active' : 'canceled'
            }
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer }
        });

        if (user) {
          // Extend subscription or update status
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'active'
            }
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const user = await prisma.user.findFirst({
          where: { stripeCustomerId: invoice.customer }
        });

        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'past_due'
            }
          });
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

module.exports = router;
