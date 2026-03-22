import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { env } from '../config';
import { query, queryOne, withTransaction } from '../db';
import { authenticate } from '../auth';
import { getAuthorizationUrl, exchangeCodeForTokens, storeTokens } from '../zoho/oauth';
import { enqueueSetupJob } from '../queue/setup';
import { getTemplate, resolveTemplate, generateIdempotencyKeys, listTemplates } from '../templates/loader';
import { ZOHO_SCOPES } from '../config';

// ── Validation schemas ──────────────────────────────
const setupStartSchema = z.object({
  customer_id: z.string().uuid(),
  template_id: z.string().min(1).max(255),
});

const customerCreateSchema = z.object({
  email: z.string().email(),
  site_name: z.string().min(1).max(255),
  site_url: z.string().url().optional(),
  business_type: z.string().max(100).optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // ── Health check (public) ─────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // ── OAuth: Start connection (authenticated) ───────
  app.get('/api/auth/zoho', { preHandler: [authenticate] }, async (request, reply) => {
    const { customer_id, dc } = request.query as { customer_id: string; dc?: string };

    if (!customer_id) {
      return reply.status(400).send({ error: 'customer_id required' });
    }

    const state = Buffer.from(JSON.stringify({
      customer_id,
      user_id: (request as any).userId,
      ts: Date.now(),
    })).toString('base64url');

    const authUrl = getAuthorizationUrl(state, (dc as any) || 'com');
    return reply.send({ url: authUrl });
  });

  // ── OAuth: Callback from Zoho (public — redirect) ─
  app.get('/api/auth/zoho/callback', async (request, reply) => {
    const { code, state, error } = request.query as {
      code?: string; state?: string; error?: string;
    };

    if (error) {
      request.log.error({ error }, 'OAuth authorization denied');
      return reply.redirect(`${env.APP_URL}/?error=auth_denied`);
    }

    if (!code || !state) {
      return reply.redirect(`${env.APP_URL}/?error=invalid_callback`);
    }

    try {
      const { customer_id } = JSON.parse(Buffer.from(state, 'base64url').toString());

      const customer = await queryOne('SELECT * FROM customers WHERE id = $1', [customer_id]);
      if (!customer) {
        return reply.redirect(`${env.APP_URL}/?error=invalid_customer`);
      }

      const tokens = await exchangeCodeForTokens(code);

      const orgResponse = await fetch(
        `https://www.zohoapis.${tokens.dc}/crm/v6/org`,
        { headers: { Authorization: `Zoho-oauthtoken ${tokens.accessToken}` } }
      );
      const orgData = await orgResponse.json() as any;
      const orgId = orgData.org?.[0]?.id || orgData.data?.[0]?.id || 'unknown';

      await storeTokens(
        customer_id,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.dc,
        orgId,
        tokens.expiresIn,
        [...ZOHO_SCOPES]
      );

      return reply.redirect(`${env.APP_URL}/?connected=true`);
    } catch (err: any) {
      request.log.error({ err: err.message }, 'Token exchange failed');
      return reply.redirect(`${env.APP_URL}/?error=token_exchange_failed`);
    }
  });

  // ── Templates: List (authenticated) ───────────────
  app.get('/api/templates', { preHandler: [authenticate] }, async () => {
    const templates = listTemplates();
    return templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      business_type: t.business_type,
      step_count: t.steps.length,
    }));
  });

  // ── Setup: Trigger a setup job (authenticated) ────
  app.post('/api/setup/start', { preHandler: [authenticate] }, async (request, reply) => {
    const { customer_id, template_id } = setupStartSchema.parse(request.body);

    const tokens = await queryOne(
      'SELECT * FROM zoho_tokens WHERE customer_id = $1 AND is_valid = TRUE',
      [customer_id]
    );
    if (!tokens) {
      return reply.status(400).send({ error: 'No valid Zoho connection. Please connect first.' });
    }

    const template = getTemplate(template_id);
    if (!template) {
      return reply.status(404).send({ error: `Template ${template_id} not found` });
    }

    const customer = await queryOne('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (!customer) {
      return reply.status(404).send({ error: 'Customer not found' });
    }

    const resolved = resolveTemplate(template, {
      site_name: customer.site_name || 'My App',
      site_url: customer.site_url,
      email: customer.email,
      business_type: customer.business_type || 'saas',
    });

    const stepsWithKeys = generateIdempotencyKeys(resolved, customer_id);

    const jobId = await withTransaction(async (client) => {
      const jobId = randomUUID();

      await client.query(
        `INSERT INTO setup_jobs (id, customer_id, template_id, total_steps, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [jobId, customer_id, template_id, stepsWithKeys.length]
      );

      for (const step of stepsWithKeys) {
        await client.query(
          `INSERT INTO setup_steps
             (job_id, customer_id, step_id, step_order, action, target_app,
              config, idempotency_key, depends_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            jobId, customer_id, step.id, step.order, step.action,
            step.target_app, JSON.stringify(step.config), step.idempotencyKey,
            step.depends_on || null,
          ]
        );
      }
      return jobId;
    });

    await enqueueSetupJob(
      jobId, customer_id,
      stepsWithKeys.map(s => ({
        stepId: s.id, action: s.action, targetApp: s.target_app,
        config: s.config, dependsOn: s.depends_on, idempotencyKey: s.idempotencyKey,
      }))
    );

    await query(
      `UPDATE setup_jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );

    return { job_id: jobId, steps: stepsWithKeys.length, status: 'running' };
  });

  // ── Setup: Get job status (authenticated) ─────────
  app.get('/api/setup/status/:jobId', { preHandler: [authenticate] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const job = await queryOne('SELECT * FROM setup_jobs WHERE id = $1', [jobId]);
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const steps = await query(
      `SELECT step_id, action, target_app, status, error, completed_at
       FROM setup_steps WHERE job_id = $1 ORDER BY step_order`,
      [jobId]
    );

    return {
      job_id: job.id,
      status: job.status,
      total_steps: job.total_steps,
      completed_steps: job.completed_steps,
      failed_steps: job.failed_steps,
      progress: Math.round((job.completed_steps / job.total_steps) * 100),
      started_at: job.started_at,
      completed_at: job.completed_at,
      steps,
    };
  });

  // ── Customer: Create (authenticated) ──────────────
  app.post('/api/customers', { preHandler: [authenticate] }, async (request, reply) => {
    const body = customerCreateSchema.parse(request.body);

    const existing = await queryOne('SELECT * FROM customers WHERE email = $1', [body.email]);
    if (existing) {
      return existing;
    }

    const [customer] = await query(
      `INSERT INTO customers (email, site_name, site_url, business_type, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.email, body.site_name, body.site_url || null, body.business_type || 'saas', (request as any).userId]
    );

    return reply.status(201).send(customer);
  });

  // ── Connection: Check Zoho status (authenticated) ─
  app.get('/api/connection/:customerId', { preHandler: [authenticate] }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };

    const tokens = await queryOne(
      `SELECT zoho_dc, zoho_org_id, connected_at, last_refreshed_at, is_valid, scopes
       FROM zoho_tokens WHERE customer_id = $1`,
      [customerId]
    );

    if (!tokens) {
      return { connected: false };
    }

    return {
      connected: tokens.is_valid,
      dc: tokens.zoho_dc,
      org_id: tokens.zoho_org_id,
      connected_at: tokens.connected_at,
      scopes: tokens.scopes,
    };
  });
}
