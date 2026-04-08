import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { authenticate } from '../auth';
import { env } from '../config';
import { query, queryOne } from '../db';

type PlanCode = 'free' | 'starter' | 'pro' | 'agency';
type PaidPlanCode = Exclude<PlanCode, 'free'>;

type BillingUser = {
  id: string;
  email: string;
  plan: PlanCode;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  subscription_ends_at: string | null;
};

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    }
    stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  }
  return stripe;
}

const PLANS = {
  free: {
    code: 'free',
    name: 'Free',
    monthlyPriceEur: 0,
    templates: 1,
    setups: 3,
    features: ['1 workspace', '1 template', '3 guided setups'],
    priceId: null,
  },
  starter: {
    code: 'starter',
    name: 'Starter',
    monthlyPriceEur: 19,
    templates: 5,
    setups: 50,
    features: ['1 workspace', '5 templates', '50 guided setups'],
    priceId: env.STRIPE_STARTER_PRICE_ID ?? null,
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    monthlyPriceEur: 49,
    templates: -1,
    setups: -1,
    features: ['5 workspaces', 'Unlimited templates', 'Prompt generator'],
    priceId: env.STRIPE_PRO_PRICE_ID ?? null,
  },
  agency: {
    code: 'agency',
    name: 'Agency',
    monthlyPriceEur: 99,
    templates: -1,
    setups: -1,
    features: ['Unlimited workspaces', 'Reusable templates', 'Priority support'],
    priceId: env.STRIPE_AGENCY_PRICE_ID ?? null,
  },
} as const satisfies Record<PlanCode, {
  code: PlanCode;
  name: string;
  monthlyPriceEur: number;
  templates: number;
  setups: number;
  features: string[];
  priceId: string | null;
}>;

const paidPlanCodes = ['starter', 'pro', 'agency'] as const satisfies readonly PaidPlanCode[];
const activeSubscriptionStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid']);

function getPlanForPriceId(priceId: string | null | undefined): PaidPlanCode | null {
  if (!priceId) return null;
  const matched = paidPlanCodes.find((planCode) => PLANS[planCode].priceId === priceId);
  return matched ?? null;
}

function resolvePlanLimits(plan: string | null | undefined) {
  const planCode = plan && plan in PLANS ? (plan as PlanCode) : 'free';
  return PLANS[planCode];
}

function getCheckoutSuccessUrl() {
  return env.STRIPE_CHECKOUT_SUCCESS_URL ?? `${env.APP_URL}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
}

function getCheckoutCancelUrl(plan: PaidPlanCode) {
  const baseUrl = env.STRIPE_CHECKOUT_CANCEL_URL ?? `${env.APP_URL}/app?checkout=cancel`;
  const url = new URL(baseUrl);
  url.searchParams.set('plan', plan);
  return url.toString();
}

function getPortalReturnUrl() {
  return env.STRIPE_PORTAL_RETURN_URL ?? `${env.APP_URL}/app?billing=portal`;
}

async function ensureStripeCustomer(user: Pick<BillingUser, 'id' | 'email' | 'stripe_customer_id'>) {
  const s = getStripe();

  if (user.stripe_customer_id) {
    return user.stripe_customer_id;
  }

  const customer = await s.customers.create({
    email: user.email,
    metadata: { userId: user.id },
  });

  await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customer.id, user.id]);
  return customer.id;
}

async function createPortalSession(customerId: string) {
  const s = getStripe();
  const portalSession = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: getPortalReturnUrl(),
  });

  return portalSession.url;
}

async function syncSubscriptionState(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const user = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (!user) {
    return;
  }

  const primaryPriceId = subscription.items.data[0]?.price?.id ?? null;
  const derivedPlan =
    getPlanForPriceId(primaryPriceId) ??
    (paidPlanCodes.includes(subscription.metadata?.plan as PaidPlanCode)
      ? (subscription.metadata.plan as PaidPlanCode)
      : 'free');

  await query(
    `UPDATE users
        SET plan = $1,
            subscription_status = $2,
            subscription_ends_at = to_timestamp($3),
            stripe_subscription_id = $4
      WHERE id = $5`,
    [
      derivedPlan,
      subscription.status,
      subscription.current_period_end,
      subscription.id,
      user.id,
    ]
  );
}

export async function billingPlugin(app: FastifyInstance) {
  app.get('/api/billing/plans', async () => {
    return {
      plans: Object.values(PLANS).map((plan) => ({
        code: plan.code,
        name: plan.name,
        monthlyPriceEur: plan.monthlyPriceEur,
        templates: plan.templates,
        setups: plan.setups,
        features: plan.features,
        available: plan.code === 'free' ? true : Boolean(plan.priceId),
      })),
    };
  });

  app.post(
    '/api/billing/checkout',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { plan } = z.object({ plan: z.enum(paidPlanCodes) }).parse(req.body);
      const userId = (req as any).userId;

      const user = await queryOne<BillingUser>(
        `SELECT id, email, plan, stripe_customer_id, stripe_subscription_id,
                subscription_status, subscription_ends_at
           FROM users
          WHERE id = $1`,
        [userId]
      );

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const customerId = await ensureStripeCustomer(user);

      if (user.subscription_status && activeSubscriptionStatuses.has(user.subscription_status)) {
        const manageUrl = await createPortalSession(customerId);
        return reply.status(409).send({
          error: 'An active subscription already exists for this account',
          manageUrl,
        });
      }

      const priceId = PLANS[plan].priceId;
      if (!priceId) {
        return reply.status(400).send({ error: 'Plan not available' });
      }

      const session = await getStripe().checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: getCheckoutSuccessUrl(),
        cancel_url: getCheckoutCancelUrl(plan),
        metadata: { userId, plan },
        subscription_data: {
          metadata: { userId, plan },
        },
      });

      return reply.send({ url: session.url });
    }
  );

  app.post(
    '/api/billing/portal',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const user = await queryOne<BillingUser>(
        `SELECT id, email, plan, stripe_customer_id, stripe_subscription_id,
                subscription_status, subscription_ends_at
           FROM users
          WHERE id = $1`,
        [userId]
      );

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!user.stripe_customer_id) {
        return reply.status(400).send({ error: 'No Stripe customer is linked to this account yet' });
      }

      const url = await createPortalSession(user.stripe_customer_id);
      return reply.send({ url });
    }
  );

  app.get(
    '/api/billing/status',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const user = await queryOne<BillingUser>(
        `SELECT id, email, plan, stripe_customer_id, stripe_subscription_id,
                subscription_status, subscription_ends_at
           FROM users
          WHERE id = $1`,
        [userId]
      );

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send({
        plan: user.plan,
        status: user.subscription_status || 'none',
        endsAt: user.subscription_ends_at,
        customerId: user.stripe_customer_id,
        subscriptionId: user.stripe_subscription_id,
        manageBillingAvailable: Boolean(user.stripe_customer_id),
        limits: resolvePlanLimits(user.plan),
      });
    }
  );

  app.post(
    '/api/billing/webhook',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string' || !env.STRIPE_WEBHOOK_SECRET) {
        return reply.status(400).send({ error: 'Missing signature or webhook secret' });
      }

      const serializedBody =
        typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(
          serializedBody,
          signature,
          env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err: any) {
        req.log.error({ err: err.message }, 'Stripe webhook signature verification failed');
        return reply.status(400).send({ error: 'Invalid signature' });
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          if (userId) {
            await query(
              `UPDATE users
                  SET stripe_customer_id = COALESCE($1, stripe_customer_id),
                      stripe_subscription_id = COALESCE($2, stripe_subscription_id),
                      subscription_status = COALESCE(subscription_status, 'active')
                WHERE id = $3`,
              [
                typeof session.customer === 'string' ? session.customer : null,
                typeof session.subscription === 'string' ? session.subscription : null,
                userId,
              ]
            );
          }
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          await syncSubscriptionState(event.data.object as Stripe.Subscription);
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          if (typeof invoice.customer === 'string') {
            await query(
              `UPDATE users
                  SET subscription_status = 'active'
                WHERE stripe_customer_id = $1`,
              [invoice.customer]
            );
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          if (typeof invoice.customer === 'string') {
            await query(
              `UPDATE users
                  SET subscription_status = 'past_due'
                WHERE stripe_customer_id = $1`,
              [invoice.customer]
            );
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await query(
            `UPDATE users
                SET plan = 'free',
                    subscription_status = 'cancelled',
                    subscription_ends_at = NOW(),
                    stripe_subscription_id = NULL
              WHERE stripe_customer_id = $1`,
            [subscription.customer as string]
          );
          break;
        }

        default:
          req.log.debug({ eventType: event.type }, 'Ignoring unhandled Stripe event');
      }

      return reply.send({ received: true });
    }
  );
}
