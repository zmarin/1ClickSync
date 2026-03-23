import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate } from '../auth';
import { env } from '../config';
import {
  buildFormRouteExport,
  buildSalesIQExport,
  getFormFields,
  getIntegrationConfig,
  getToolSupportSummary,
} from './export-utils';

// ── Schemas ─────────────────────────────────────────
const createAppSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional(),
  business_type: z.string().max(100).default('saas'),
  zoho_tools: z.array(z.enum(['crm', 'desk', 'bookings', 'salesiq', 'books', 'projects'])).default(['crm']),
  settings: z.record(z.any()).optional(),
});

const updateAppSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).optional(),
  business_type: z.string().max(100).optional(),
  zoho_tools: z.array(z.enum(['crm', 'desk', 'bookings', 'salesiq', 'books', 'projects'])).optional(),
  is_active: z.boolean().optional(),
  settings: z.record(z.any()).optional(),
});

/**
 * Generate a URL-safe slug from a name + random suffix
 */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function appRoutesPlugin(app: FastifyInstance) {

  // ── Create app ───────────────────────────────────
  app.post('/api/apps', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createAppSchema.parse(request.body);
    const userId = (request as any).userId;

    const slug = generateSlug(body.name);

    const [created] = await query(
      `INSERT INTO apps (user_id, name, slug, domain, business_type, zoho_tools, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        userId,
        body.name,
        slug,
        body.domain || null,
        body.business_type,
        JSON.stringify(body.zoho_tools),
        JSON.stringify(body.settings || {}),
      ]
    );

    // Also create a corresponding customers record for backward compat
    await query(
      `INSERT INTO customers (id, user_id, site_name, site_url, business_type)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [created.id, userId, body.name, body.domain || null, body.business_type]
    );

    return reply.status(201).send(created);
  });

  // ── List apps ────────────────────────────────────
  app.get('/api/apps', { preHandler: [authenticate] }, async (request: FastifyRequest) => {
    const userId = (request as any).userId;

    const apps = await query(
      `SELECT a.*,
              CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected,
              zt.zoho_dc,
              zt.zoho_org_id,
              (SELECT COUNT(*) FROM form_configs WHERE app_id = a.id) as route_count
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [userId]
    );

    return apps;
  });

  // ── Get app detail ───────────────────────────────
  app.get('/api/apps/:appId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    const appRecord = await queryOne(
      `SELECT a.*,
              CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected,
              zt.zoho_dc,
              zt.zoho_org_id,
              zt.connected_at as zoho_connected_at,
              zt.scopes as zoho_scopes
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [appId, userId]
    );

    if (!appRecord) return reply.status(404).send({ error: 'App not found' });

    const routes = await query(
      `SELECT id, form_key, name, target_module, route_type, lead_source, is_active, submissions_count, created_at
       FROM form_configs WHERE app_id = $1 ORDER BY created_at DESC`,
      [appId]
    );

    return { ...appRecord, routes };
  });

  // ── Update app ───────────────────────────────────
  app.patch('/api/apps/:appId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;
    const body = updateAppSchema.parse(request.body);

    const existing = await queryOne(
      'SELECT id FROM apps WHERE id = $1 AND user_id = $2',
      [appId, userId]
    );
    if (!existing) return reply.status(404).send({ error: 'App not found' });

    const sets: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    if (body.name !== undefined) { sets.push(`name = $${idx}`); values.push(body.name); idx++; }
    if (body.domain !== undefined) { sets.push(`domain = $${idx}`); values.push(body.domain); idx++; }
    if (body.business_type !== undefined) { sets.push(`business_type = $${idx}`); values.push(body.business_type); idx++; }
    if (body.zoho_tools !== undefined) { sets.push(`zoho_tools = $${idx}`); values.push(JSON.stringify(body.zoho_tools)); idx++; }
    if (body.is_active !== undefined) { sets.push(`is_active = $${idx}`); values.push(body.is_active); idx++; }
    if (body.settings !== undefined) { sets.push(`settings = $${idx}`); values.push(JSON.stringify(body.settings)); idx++; }

    values.push(appId);
    const [updated] = await query(
      `UPDATE apps SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    return updated;
  });

  // ── Delete app ───────────────────────────────────
  app.delete('/api/apps/:appId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    const existing = await queryOne(
      'SELECT id FROM apps WHERE id = $1 AND user_id = $2',
      [appId, userId]
    );
    if (!existing) return reply.status(404).send({ error: 'App not found' });

    await query('DELETE FROM apps WHERE id = $1', [appId]);
    // Also clean up the backward-compat customers record
    await query('DELETE FROM customers WHERE id = $1', [appId]);

    return { success: true };
  });

  // ══════════════════════════════════════════════════
  //  MANIFEST — The core value prop
  //  Returns a JSON manifest describing all routes,
  //  schemas, and integration points for this app.
  // ══════════════════════════════════════════════════
  app.get('/api/apps/:appId/manifest', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    const appRecord = await queryOne(
      `SELECT a.*, zt.zoho_dc, zt.zoho_org_id,
              CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [appId, userId]
    );
    if (!appRecord) return reply.status(404).send({ error: 'App not found' });

    const routes = await query(
      `SELECT * FROM form_configs WHERE app_id = $1 AND is_active = TRUE ORDER BY created_at`,
      [appId]
    );

    const zohoTools = (appRecord.zoho_tools as string[]) || ['crm'];
    const routeManifest: Record<string, any> = {};
    const integrations: any[] = [];

    for (const route of routes) {
      const fields = getFormFields(route);
      const integrationConfig = getIntegrationConfig(route);
      const fieldMapping = route.field_mapping as Record<string, string>;
      const tool = route.route_type || 'crm';
      const support = getToolSupportSummary(tool);
      const manifestKey = route.name.toLowerCase().replace(/\s+/g, '_');

      const manifestEntry = {
        id: route.id,
        name: route.name,
        kind: 'form_route',
        status: support.status,
        tool,
        key: route.form_key,
        endpoint: `${env.APP_URL}/api/f/${route.form_key}`,
        method: 'POST',
        target: `${tool}.${route.target_module}`,
        lead_source: route.lead_source,
        generated_artifacts: support.generated_artifacts,
        export_url: `${env.APP_URL}/api/apps/${appRecord.id}/exports/${route.id}?target=html-js`,
        integration_config: integrationConfig,
        fields: fields.map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required || false,
          zoho_field: fieldMapping[f.name] || f.zoho_field,
        })),
        embed_url: `${env.APP_URL}/api/forms/${route.id}`,
      };

      routeManifest[manifestKey] = manifestEntry;
      integrations.push(manifestEntry);
    }

    if (zohoTools.includes('salesiq')) {
      const salesIqSupport = getToolSupportSummary('salesiq');
      integrations.push({
        id: 'salesiq-widget',
        name: 'SalesIQ Widget',
        kind: salesIqSupport.kind,
        status: salesIqSupport.status,
        tool: 'salesiq',
        target: 'salesiq.widget',
        generated_artifacts: salesIqSupport.generated_artifacts,
        export_url: `${env.APP_URL}/api/apps/${appRecord.id}/exports/salesiq-widget?target=html-js`,
        summary: salesIqSupport.summary,
      });
    }

    const manifest = {
      product: {
        name: '1ClickSync',
        positioning: 'Zoho integration generator for developer-owned apps and sites',
      },
      app: {
        id: appRecord.id,
        name: appRecord.name,
        slug: appRecord.slug,
        domain: appRecord.domain,
        business_type: appRecord.business_type,
      },
      project: {
        id: appRecord.id,
        name: appRecord.name,
        slug: appRecord.slug,
        domain: appRecord.domain,
        business_type: appRecord.business_type,
      },
      zoho: {
        connected: appRecord.zoho_connected || false,
        dc: appRecord.zoho_dc || null,
        org_id: appRecord.zoho_org_id || null,
        enabled_tools: zohoTools,
      },
      routes: routeManifest,
      integrations,
      tool_support: Object.fromEntries(zohoTools.map((tool) => [tool, getToolSupportSummary(tool)])),
      supported_integration_kinds: ['form_route', 'embed_widget'],
      generated_artifacts: ['manifest', 'llm-prompt', 'html-js exports'],
      exports: {
        manifest_url: `${env.APP_URL}/api/apps/${appRecord.id}/manifest`,
        prompt_url: `${env.APP_URL}/api/apps/${appRecord.id}/prompt`,
        integration_export_template: `${env.APP_URL}/api/apps/${appRecord.id}/exports/{integrationId}?target=html-js`,
      },
      available_modules: buildAvailableModules(zohoTools),
      generated_at: new Date().toISOString(),
      api_base: env.APP_URL,
    };

    return manifest;
  });

  // ══════════════════════════════════════════════════
  //  LLM PROMPT — Markdown guide for AI tools
  //  Paste this into Cursor, Claude, ChatGPT, etc.
  // ══════════════════════════════════════════════════
  app.get('/api/apps/:appId/prompt', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const userId = (request as any).userId;

    const appRecord = await queryOne(
      `SELECT a.*, zt.zoho_dc, zt.zoho_org_id,
              CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [appId, userId]
    );
    if (!appRecord) return reply.status(404).send({ error: 'App not found' });

    const routes = await query(
      `SELECT * FROM form_configs WHERE app_id = $1 AND is_active = TRUE ORDER BY created_at`,
      [appId]
    );

    const prompt = generateLLMPrompt(appRecord, routes, (appRecord.zoho_tools as string[]) || ['crm']);

    reply.type('text/markdown');
    return prompt;
  });

  app.get('/api/apps/:appId/exports/:integrationId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId, integrationId } = request.params as { appId: string; integrationId: string };
    const userId = (request as any).userId;
    const { target = 'html-js' } = request.query as { target?: string };

    if (target !== 'html-js') {
      return reply.status(400).send({ error: 'Only html-js exports are supported right now' });
    }

    const appRecord = await queryOne(
      `SELECT a.*, zt.zoho_dc, zt.zoho_org_id,
              CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [appId, userId]
    );
    if (!appRecord) return reply.status(404).send({ error: 'App not found' });

    if (integrationId === 'salesiq-widget') {
      const zohoTools = (appRecord.zoho_tools as string[]) || ['crm'];
      if (!zohoTools.includes('salesiq')) {
        return reply.status(404).send({ error: 'SalesIQ export is not enabled for this app' });
      }
      return buildSalesIQExport(appRecord);
    }

    const form = await queryOne(
      'SELECT * FROM form_configs WHERE id = $1 AND app_id = $2',
      [integrationId, appId]
    );
    if (!form) {
      return reply.status(404).send({ error: 'Integration export not found' });
    }

    return buildFormRouteExport(form);
  });
}

/**
 * Build list of available Zoho modules per enabled tool
 */
function buildAvailableModules(tools: string[]): Record<string, string[]> {
  const modules: Record<string, string[]> = {};

  if (tools.includes('crm')) {
    modules.crm = ['Leads', 'Contacts', 'Deals', 'Accounts', 'Tasks', 'Events'];
  }
  if (tools.includes('desk')) {
    modules.desk = ['Tickets', 'Contacts', 'Accounts'];
  }
  if (tools.includes('bookings')) {
    modules.bookings = ['Appointments', 'Services', 'Staff'];
  }
  if (tools.includes('salesiq')) {
    modules.salesiq = ['Widget', 'Visitors', 'Chats'];
  }
  if (tools.includes('books')) {
    modules.books = ['Contacts'];
  }
  if (tools.includes('projects')) {
    modules.projects = ['Tasks'];
  }

  return modules;
}

/**
 * Generate a markdown prompt for LLM consumption.
 * This is the text a developer pastes into their AI tool.
 */
function generateLLMPrompt(appRecord: any, routes: any[], zohoTools: string[]): string {
  const appName = appRecord.name;
  const baseUrl = env.APP_URL;
  const toolSupport = zohoTools.map((tool) => getToolSupportSummary(tool));

  let prompt = `# ${appName} — Zoho Integration Generator Prompt\n\n`;
  prompt += `> Generated by 1ClickSync. Use this in your AI coding tool to ship a Zoho integration faster.\n\n`;
  prompt += `## Project Intent\n\n`;
  prompt += `This project uses 1ClickSync as a developer-facing Zoho integration generator.\n`;
  prompt += `Prefer copy-paste HTML/JS, plain fetch examples, and minimal framework assumptions.\n\n`;

  if (appRecord.zoho_connected) {
    prompt += `**Status:** Connected to Zoho (${appRecord.zoho_dc?.toUpperCase() || 'COM'} datacenter)\n\n`;
  } else {
    prompt += `**Status:** Not connected to Zoho yet. Connect at ${baseUrl}/app before relying on live account data.\n\n`;
  }

  prompt += `## Supported Zoho Tools\n\n`;
  for (const tool of toolSupport) {
    prompt += `- **${tool.tool.toUpperCase()}** (${tool.status.toUpperCase()}, ${tool.kind}): ${tool.summary}\n`;
  }
  prompt += `\n`;
  prompt += `## Generated Exports\n\n`;
  prompt += `- Manifest: \`${baseUrl}/api/apps/${appRecord.id}/manifest\`\n`;
  prompt += `- Project prompt: \`${baseUrl}/api/apps/${appRecord.id}/prompt\`\n`;
  prompt += `- Integration export template: \`${baseUrl}/api/apps/${appRecord.id}/exports/{integrationId}?target=html-js\`\n\n`;
  prompt += `## Active Integration Routes\n\n`;

  if (routes.length === 0) {
    prompt += `No active form routes are configured yet. Create CRM, Desk, or Books contact routes at ${baseUrl}/app.\n\n`;
  } else {
    for (const route of routes) {
      const fields = getFormFields(route);
      const fieldMapping = route.field_mapping as Record<string, string>;
      const submitUrl = `${baseUrl}/api/f/${route.form_key}`;
      const exportUrl = `${baseUrl}/api/apps/${appRecord.id}/exports/${route.id}?target=html-js`;
      const toolName = (route.route_type || 'crm').toUpperCase();
      const integrationConfig = getIntegrationConfig(route);

      prompt += `### ${route.name}\n\n`;
      prompt += `- Tool: Zoho ${toolName}\n`;
      prompt += `- Target: ${route.target_module}\n`;
      prompt += `- Public endpoint: \`${submitUrl}\`\n`;
      prompt += `- Export: \`${exportUrl}\`\n`;
      if (integrationConfig) {
        prompt += `- Integration config: \`${JSON.stringify(integrationConfig)}\`\n`;
      }
      if (route.lead_source) {
        prompt += `- Lead Source: ${route.lead_source}\n`;
      }
      prompt += `\n`;

      const requiredFields = fields.filter((f: any) => f.required);
      const optionalFields = fields.filter((f: any) => !f.required);

      if (requiredFields.length > 0) {
        prompt += `Required fields:\n`;
        for (const f of requiredFields) {
          prompt += `- \`${f.name}\` (${f.type}) -> \`${fieldMapping[f.name] || f.zoho_field}\`\n`;
        }
      }

      if (optionalFields.length > 0) {
        prompt += `Optional fields:\n`;
        for (const f of optionalFields) {
          prompt += `- \`${f.name}\` (${f.type}) -> \`${fieldMapping[f.name] || f.zoho_field}\`\n`;
        }
      }

      prompt += `\nAsk the LLM to start from the generated html-js export and adapt it to your framework without changing the request payload shape.\n\n`;
    }
  }

  if (zohoTools.includes('salesiq')) {
    prompt += `## SalesIQ Widget Export\n\n`;
    prompt += `Use \`${baseUrl}/api/apps/${appRecord.id}/exports/salesiq-widget?target=html-js\` to get the starter widget snippet.\n`;
    prompt += `If the widget code is still a placeholder, replace it with the widget code from Zoho SalesIQ before shipping.\n\n`;
  }

  prompt += `## Output Expectations\n\n`;
  prompt += `When generating code, prefer plain HTML/JS first, preserve the public payload contract, and keep integration-specific details in environment/config layers rather than hardcoding them into components.\n`;

  return prompt;
}
