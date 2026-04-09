import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { env, ZOHO_SCOPES, ZOHO_SERVICE_SCOPES, ZOHO_STUDIO_SERVICES, type ZohoApp } from '../config';
import { query, queryOne, withTransaction } from '../db';
import { authenticate } from '../auth';
import {
  exchangeCodeForTokens,
  getAuthorizationUrl,
  getServiceAuthorizationUrl,
  revokeServiceTokens,
  storeServiceTokens,
  storeTokens,
} from '../zoho/oauth';
import { enqueueSetupJob } from '../queue/setup';
import { getTemplate, resolveTemplate, generateIdempotencyKeys, listTemplates } from '../templates/loader';

// ── Validation schemas ──────────────────────────────
const setupStartSchema = z.object({
  app_id: z.string().uuid(),
  template_id: z.string().min(1).max(255),
});

function popupCallbackPage(status: string, service: string | null, orgId: string | null): string {
  const data = JSON.stringify({ type: 'zoho-oauth-result', status, service, orgId });
  return `<!DOCTYPE html><html><head><title>Connecting...</title></head><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${data}, '${env.APP_URL}');
    window.close();
  } else {
    window.location.href = '${env.APP_URL}/app?connected=' + (${JSON.stringify(status)} === 'success' ? 'true' : 'false');
  }
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40px;">Connected! This window will close automatically.</p>
</body></html>`;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // ── Health check (public) ─────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    version: process.env.npm_package_version || '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // ── OAuth: Start connection (authenticated) ───────
  // Now accepts app_id instead of customer_id
  app.get('/api/auth/zoho', { preHandler: [authenticate] }, async (request, reply) => {
    const { app_id, dc, service } = request.query as { app_id?: string; customer_id?: string; dc?: string; service?: ZohoApp };

    // Support both app_id and customer_id for backward compat
    const appId = app_id || (request.query as any).customer_id;

    if (!appId) {
      return reply.status(400).send({ error: 'app_id required' });
    }
    if (!(await ensureOwnedApp(appId, (request as any).userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    if (service) {
      const selectedService = z.enum(ZOHO_STUDIO_SERVICES).parse(service);
      const state = Buffer.from(JSON.stringify({
        app_id: appId,
        customer_id: appId,
        user_id: (request as any).userId,
        service: selectedService,
        ts: Date.now(),
      })).toString('base64url');

      return reply.send({
        service: selectedService,
        scopes: [...ZOHO_SERVICE_SCOPES[selectedService]],
        url: getServiceAuthorizationUrl(state, selectedService, (dc as any) || 'com'),
      });
    }

    const state = Buffer.from(JSON.stringify({
      app_id: appId,
      customer_id: appId,  // backward compat
      user_id: (request as any).userId,
      ts: Date.now(),
    })).toString('base64url');

    const authUrl = getAuthorizationUrl(state, (dc as any) || 'com');
    return reply.send({ url: authUrl });
  });

  app.get('/api/auth/zoho/service', { preHandler: [authenticate] }, async (request, reply) => {
    const queryParams = z.object({
      app_id: z.string().uuid(),
      service: z.enum(ZOHO_STUDIO_SERVICES),
      dc: z.string().optional(),
      popup: z.string().optional(),
    }).parse(request.query);

    if (!(await ensureOwnedApp(queryParams.app_id, (request as any).userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    const state = Buffer.from(JSON.stringify({
      app_id: queryParams.app_id,
      customer_id: queryParams.app_id,
      user_id: (request as any).userId,
      service: queryParams.service,
      popup: queryParams.popup === '1',
      ts: Date.now(),
    })).toString('base64url');

    return reply.send({
      service: queryParams.service,
      scopes: [...ZOHO_SERVICE_SCOPES[queryParams.service]],
      url: getServiceAuthorizationUrl(state, queryParams.service, (queryParams.dc as any) || 'com'),
    });
  });

  // ── OAuth: Callback from Zoho (public — redirect) ─
  app.get('/api/auth/zoho/callback', async (request, reply) => {
    const { code, state, error } = request.query as {
      code?: string; state?: string; error?: string;
    };

    if (error) {
      request.log.error({ error }, 'OAuth authorization denied');
      return reply.redirect(`${env.APP_URL}/app?error=auth_denied`);
    }

    if (!code || !state) {
      return reply.redirect(`${env.APP_URL}/app?error=invalid_callback`);
    }

    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      // Support both app_id and customer_id from state
      const appId = stateData.app_id || stateData.customer_id;
      const service = stateData.service as ZohoApp | undefined;

      // Verify the app exists
      const appRecord = await queryOne('SELECT * FROM apps WHERE id = $1', [appId]);
      if (!appRecord) {
        // Fall back to customers table for backward compat
        const customer = await queryOne('SELECT * FROM customers WHERE id = $1', [appId]);
        if (!customer) {
          return reply.redirect(`${env.APP_URL}/app?error=invalid_app`);
        }
      }

      const tokens = await exchangeCodeForTokens(code);

      let orgId: string | null = null;
      if (!service || service === 'crm') {
        try {
          const orgResponse = await fetch(
            `https://www.zohoapis.${tokens.dc}/crm/v6/org`,
            { headers: { Authorization: `Zoho-oauthtoken ${tokens.accessToken}` } }
          );
          const orgData = await orgResponse.json() as any;
          orgId = orgData.org?.[0]?.id || orgData.data?.[0]?.id || null;
        } catch {
          orgId = null;
        }
      }

      if (service) {
        await storeServiceTokens(
          appId,
          service,
          tokens.accessToken,
          tokens.refreshToken,
          tokens.dc,
          orgId,
          tokens.expiresIn,
          [...ZOHO_SERVICE_SCOPES[service]]
        );
        if (stateData.popup) {
          return reply.type('text/html').send(popupCallbackPage('success', service, orgId));
        }
        return reply.redirect(`${env.APP_URL}/app?connected=true&service=${service}`);
      }

      await storeTokens(
        appId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.dc,
        orgId || 'unknown',
        tokens.expiresIn,
        [...ZOHO_SCOPES]
      );

      if (stateData.popup) {
        return reply.type('text/html').send(popupCallbackPage('success', null, orgId));
      }
      return reply.redirect(`${env.APP_URL}/app?connected=true`);
    } catch (err: any) {
      request.log.error({ err: err.message }, 'Token exchange failed');
      if (state) {
        try {
          const sd = JSON.parse(Buffer.from(state, 'base64url').toString());
          if (sd.popup) {
            return reply.type('text/html').send(popupCallbackPage('error', null, null));
          }
        } catch { /* ignore parse errors */ }
      }
      return reply.redirect(`${env.APP_URL}/app?error=token_exchange_failed`);
    }
  });

  app.delete('/api/auth/zoho/service', { preHandler: [authenticate] }, async (request, reply) => {
    const queryParams = z.object({
      app_id: z.string().uuid(),
      service: z.enum(ZOHO_STUDIO_SERVICES),
    }).parse(request.query);

    if (!(await ensureOwnedApp(queryParams.app_id, (request as any).userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    await revokeServiceTokens(queryParams.app_id, queryParams.service);
    return { success: true, service: queryParams.service };
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
    const body = request.body as any;
    // Support both app_id and customer_id
    const appId = body.app_id || body.customer_id;
    const templateId = body.template_id;

    if (!appId || !templateId) {
      return reply.status(400).send({ error: 'app_id and template_id are required' });
    }

    const tokens = await queryOne(
      'SELECT * FROM zoho_tokens WHERE (app_id = $1 OR customer_id = $1) AND is_valid = TRUE',
      [appId]
    );
    if (!tokens) {
      return reply.status(400).send({ error: 'No valid Zoho connection. Please connect first.' });
    }

    const template = getTemplate(templateId);
    if (!template) {
      return reply.status(404).send({ error: `Template ${templateId} not found` });
    }

    // Try apps table first, fall back to customers
    let appData = await queryOne('SELECT * FROM apps WHERE id = $1', [appId]);
    if (!appData) {
      appData = await queryOne('SELECT * FROM customers WHERE id = $1', [appId]);
    }
    if (!appData) {
      return reply.status(404).send({ error: 'App not found' });
    }

    const resolved = resolveTemplate(template, {
      site_name: appData.name || appData.site_name || 'My App',
      site_url: appData.domain || appData.site_url,
      email: appData.email || '',
      business_type: appData.business_type || 'saas',
    });

    const stepsWithKeys = generateIdempotencyKeys(resolved, appId);

    const jobId = await withTransaction(async (client) => {
      const jobId = randomUUID();

      await client.query(
        `INSERT INTO setup_jobs (id, app_id, customer_id, template_id, total_steps, status)
         VALUES ($1, $2, $2, $3, $4, 'pending')`,
        [jobId, appId, templateId, stepsWithKeys.length]
      );

      for (const step of stepsWithKeys) {
        await client.query(
          `INSERT INTO setup_steps
             (job_id, customer_id, step_id, step_order, action, target_app,
              config, idempotency_key, depends_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            jobId, appId, step.id, step.order, step.action,
            step.target_app, JSON.stringify(step.config), step.idempotencyKey,
            step.depends_on || null,
          ]
        );
      }
      return jobId;
    });

    await enqueueSetupJob(
      jobId, appId,
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

  // ── Backward compat: Customer create → now creates an App ──
  app.post('/api/customers', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as any;

    // Create app from customer data
    const slug = (body.site_name || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) + '-' + Math.random().toString(36).slice(2, 8);

    const userId = (request as any).userId;

    const [appRecord] = await query(
      `INSERT INTO apps (user_id, name, slug, domain, business_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, body.site_name, slug, body.site_url || null, body.business_type || 'saas']
    );

    // Also insert into customers for backward compat
    await query(
      `INSERT INTO customers (id, email, site_name, site_url, business_type, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [appRecord.id, body.email || null, body.site_name, body.site_url || null, body.business_type || 'saas', userId]
    );

    // Return in legacy format with id for backward compat
    return reply.status(201).send({
      ...appRecord,
      site_name: appRecord.name,
      email: body.email,
    });
  });

  // ── Connection: Check Zoho status (authenticated) ─
  // Supports both /api/connection/:appId and legacy :customerId
  app.get('/api/connection/:customerId', { preHandler: [authenticate] }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };

    const tokens = await queryOne(
      `SELECT zoho_dc, zoho_org_id, connected_at, last_refreshed_at, is_valid, scopes
       FROM zoho_tokens WHERE app_id = $1 OR customer_id = $1`,
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

async function ensureOwnedApp(appId: string, userId: string): Promise<boolean> {
  const appRecord = await queryOne('SELECT id FROM apps WHERE id = $1 AND user_id = $2', [appId, userId]);
  if (appRecord) return true;
  const customer = await queryOne('SELECT id FROM customers WHERE id = $1 AND user_id = $2', [appId, userId]);
  return Boolean(customer);
}
