import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { queryOne } from '../db';
import { authenticate } from '../auth';
import { mailApi } from '../zoho/client';

async function ensureOwnedApp(appId: string, userId: string): Promise<boolean> {
  const app = await queryOne('SELECT id FROM apps WHERE id = $1 AND user_id = $2', [appId, userId]);
  return !!app;
}

export async function mailRoutesPlugin(app: FastifyInstance) {

  // ── List mail accounts (authenticated) ──────────
  app.get('/api/mail/:appId/accounts', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    if (!(await ensureOwnedApp(appId, userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    try {
      const result = await mailApi.getAccounts(appId);
      const accounts = (result.data || []).map((acc: any) => ({
        accountId: acc.accountId,
        displayName: acc.displayName || acc.primaryEmailAddress,
        email: acc.primaryEmailAddress || acc.mailboxAddress || acc.emailAddress,
      }));
      return { accounts };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Failed to fetch mail accounts: ' + (error.message || '') });
    }
  });

  // ── Get mail org ID (needed for alias operations) ──
  app.get('/api/mail/:appId/org', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    if (!(await ensureOwnedApp(appId, userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    try {
      const result = await mailApi.getOrganization(appId) as any as any;
      const org = result.data || result;
      return {
        zoid: org.zoid || org.organizationId || org.id,
        orgName: org.organizationName || org.companyName || org.name,
      };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Failed to fetch mail org: ' + (error.message || '') });
    }
  });

  // ── List aliases for a mail account ─────────────
  app.get('/api/mail/:appId/accounts/:accountId/aliases', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId, accountId } = request.params as { appId: string; accountId: string };
    const userId = (request as any).userId;

    if (!(await ensureOwnedApp(appId, userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    try {
      // Get org ID first
      const orgResult = await mailApi.getOrganization(appId) as any;
      const zoid = orgResult.data?.zoid || orgResult.zoid || orgResult.data?.organizationId;
      if (!zoid) return reply.status(502).send({ error: 'Could not determine mail org ID' });

      const result = await mailApi.getAliases(appId, zoid, accountId) as any;
      return { aliases: result.data?.emailAlias || result.emailAlias || [] };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Failed to fetch aliases: ' + (error.message || '') });
    }
  });

  // ── Add alias to a mail account ──────────────────
  app.post('/api/mail/:appId/accounts/:accountId/aliases', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId, accountId } = request.params as { appId: string; accountId: string };
    const userId = (request as any).userId;
    const body = z.object({ alias: z.string().email() }).parse(request.body);

    if (!(await ensureOwnedApp(appId, userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    try {
      const orgResult = await mailApi.getOrganization(appId) as any;
      const zoid = orgResult.data?.zoid || orgResult.zoid || orgResult.data?.organizationId;
      if (!zoid) return reply.status(502).send({ error: 'Could not determine mail org ID' });

      const result = await mailApi.addAlias(appId, zoid, accountId, [body.alias]);
      return { success: true, alias: body.alias, result };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Failed to add alias: ' + (error.message || '') });
    }
  });

  // ── Remove alias from a mail account ─────────────
  app.delete('/api/mail/:appId/accounts/:accountId/aliases', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId, accountId } = request.params as { appId: string; accountId: string };
    const userId = (request as any).userId;
    const body = z.object({ alias: z.string().email() }).parse(request.body);

    if (!(await ensureOwnedApp(appId, userId))) {
      return reply.status(404).send({ error: 'App not found' });
    }

    try {
      const orgResult = await mailApi.getOrganization(appId) as any;
      const zoid = orgResult.data?.zoid || orgResult.zoid || orgResult.data?.organizationId;
      if (!zoid) return reply.status(502).send({ error: 'Could not determine mail org ID' });

      const result = await mailApi.deleteAlias(appId, zoid, accountId, [body.alias]);
      return { success: true, alias: body.alias, result };
    } catch (error: any) {
      return reply.status(502).send({ error: 'Failed to remove alias: ' + (error.message || '') });
    }
  });
}
