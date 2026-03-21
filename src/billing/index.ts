import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { query, queryOne } from '../db';
import { authenticate } from '../auth';
import { env } from '../config';
import { z } from 'zod';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    }
    stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }
  return stripe;
}

const PLANS = {
  free: { name: 'Free', templates: 1, setups: 3 },
  starter: { name: 'Starter', templates: 5, setups: 50, priceId: process.env.STRIPE_STARTER_PRICE_ID },
  pro: { name: 'Pro', templates: -1, setups: -1, priceId: process.env.STRIPE_PRO_PRICE_ID },
} as const;

export async function billingPlugin(app: FastifyInstance) {
  // Create checkout session
  app.post('/api/billing/checkout', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { plan } = z.object({ plan: z.enum(['starter', 'pro']) }).parse(req.body);
    const userId = (req as any).userId;

    const user = await queryOne('SELECT id, email, stripe_customer_id FROM users WHERE id = $1', [userId]);
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const s = getStripe();

    // Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({ email: user.email, metadata: { userId } });
      customerId = customer.id;
      await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
    }

    const priceId = PLANS[plan].priceId;
    if (!priceId) return reply.status(400).send({ error: 'Plan not available' });

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.APP_URL}/dashboard?checkout=success`,
      cancel_url: `${env.APP_URL}/dashboard?checkout=cancel`,
      metadata: { userId, plan },
    });

    return reply.send({ url: session.url });
  });

  // Get billing status
  app.get('/api/billing/status', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as any).userId;
    const user = await queryOne(
      'SELECT plan, stripe_customer_id, subscription_status, subscription_ends_at FROM users WHERE id = $1',
      [userId]
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });

    return reply.send({
      plan: user.plan,
      status: user.subscription_status || 'none',
      endsAt: user.subscription_ends_at,
      limits: PLANS[user.plan as keyof typeof PLANS] || PLANS.free,
    });
  });

  // Stripe webhook
  app.post('/api/billing/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
      return reply.status(400).send({ error: 'Missing signature or webhook secret' });
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(
        JSON.stringify(req.body),
        sig,
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err: any) {
      console.error('[Billing] Webhook signature verification failed:', err.message);
      return reply.status(400).send({ error: 'Invalid signature' });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (userId && plan) {
          await query(
            `UPDATE users SET plan = $1, subscription_status = 'active',
             stripe_subscription_id = $2 WHERE id = $3`,
            [plan, session.subscription, userId]
          );
          console.log(`[Billing] User ${userId} upgraded to ${plan}`);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = await queryOne(
          'SELECT id FROM users WHERE stripe_customer_id = $1',
          [sub.customer as string]
        );
        if (customer) {
          await query(
            `UPDATE users SET subscription_status = $1,
             subscription_ends_at = to_timestamp($2) WHERE id = $3`,
            [sub.status, sub.current_period_end, customer.id]
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customer = await queryOne(
          'SELECT id FROM users WHERE stripe_customer_id = $1',
          [sub.customer as string]
        );
        if (customer) {
          await query(
            `UPDATE users SET plan = 'free', subscription_status = 'cancelled',
             stripe_subscription_id = NULL WHERE id = $1`,
            [customer.id]
          );
          console.log(`[Billing] User ${customer.id} subscription cancelled`);
        }
        break;
      }
    }

    return reply.send({ received: true });
  });
}
