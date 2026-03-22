import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate } from '../auth';
import { env } from '../config';

// ── Schemas ─────────────────────────────────────────
const createAppSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().max(255).optional(),
  business_type: z.string().max(100).default('saas'),
  zoho_tools: z.array(z.enum(['crm', 'desk', 'bookings', 'salesiq', 'books', 'projects'])).default(['crm']),
});

const updateAppSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().max(255).optional(),
  business_type: z.string().max(100).optional(),
  zoho_tools: z.array(z.enum(['crm', 'desk', 'bookings', 'salesiq', 'books', 'projects'])).optional(),
  is_active: z.boolean().optional(),
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
      `INSERT INTO apps (user_id, name, slug, domain, business_type, zoho_tools)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, body.name, slug, body.domain || null, body.business_type, JSON.stringify(body.zoho_tools)]
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
      `SELECT id, form_key, name, target_module, lead_source, is_active, submissions_count, created_at
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

    // Build manifest
    const routeManifest: Record<string, any> = {};
    for (const route of routes) {
      const styleConfig = route.style_config as any;
      const fields = styleConfig?.fields || [];
      const fieldMapping = route.field_mapping as Record<string, string>;

      routeManifest[route.name.toLowerCase().replace(/\s+/g, '_')] = {
        name: route.name,
        key: route.form_key,
        endpoint: `${env.APP_URL}/api/f/${route.form_key}`,
        method: 'POST',
        target: `crm.${route.target_module}`,
        lead_source: route.lead_source,
        fields: fields.map((f: any) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          required: f.required || false,
          zoho_field: fieldMapping[f.name] || f.zoho_field,
        })),
        embed_url: `${env.APP_URL}/api/forms/${route.id}`,
      };
    }

    const zohoTools = (appRecord.zoho_tools as string[]) || ['crm'];

    const manifest = {
      app: {
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

    const prompt = generateLLMPrompt(appRecord, routes);

    reply.type('text/markdown');
    return prompt;
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
    modules.salesiq = ['Visitors', 'Chats'];
  }
  if (tools.includes('books')) {
    modules.books = ['Invoices', 'Contacts', 'Items'];
  }
  if (tools.includes('projects')) {
    modules.projects = ['Projects', 'Tasks', 'Milestones'];
  }

  return modules;
}

/**
 * Generate a markdown prompt for LLM consumption.
 * This is the text a developer pastes into their AI tool.
 */
function generateLLMPrompt(appRecord: any, routes: any[]): string {
  const appName = appRecord.name;
  const baseUrl = env.APP_URL;

  let prompt = `# ${appName} — Zoho Integration Guide\n\n`;
  prompt += `> Generated by 1ClickSync. Paste this into your AI coding tool.\n\n`;

  // Connection status
  if (appRecord.zoho_connected) {
    prompt += `**Status:** Connected to Zoho (${appRecord.zoho_dc?.toUpperCase() || 'COM'} datacenter)\n\n`;
  } else {
    prompt += `**Status:** Not connected to Zoho yet. Connect at ${baseUrl}/app\n\n`;
  }

  prompt += `---\n\n`;
  prompt += `## Available Endpoints\n\n`;

  if (routes.length === 0) {
    prompt += `No routes configured yet. Create routes at ${baseUrl}/app\n\n`;
    return prompt;
  }

  for (const route of routes) {
    const styleConfig = route.style_config as any;
    const fields = styleConfig?.fields || [];
    const fieldMapping = route.field_mapping as Record<string, string>;
    const submitUrl = `${baseUrl}/api/f/${route.form_key}`;

    prompt += `### ${route.name}\n\n`;
    prompt += `\`POST ${submitUrl}\`\n\n`;
    prompt += `**Target:** Zoho CRM → ${route.target_module}\n`;
    if (route.lead_source) {
      prompt += `**Lead Source:** ${route.lead_source}\n`;
    }
    prompt += `\n`;

    // Fields table
    const requiredFields = fields.filter((f: any) => f.required);
    const optionalFields = fields.filter((f: any) => !f.required);

    if (requiredFields.length > 0) {
      prompt += `**Required fields:**\n`;
      for (const f of requiredFields) {
        prompt += `- \`${f.name}\` (${f.type}) → maps to Zoho \`${fieldMapping[f.name] || f.zoho_field}\`\n`;
      }
      prompt += `\n`;
    }

    if (optionalFields.length > 0) {
      prompt += `**Optional fields:**\n`;
      for (const f of optionalFields) {
        prompt += `- \`${f.name}\` (${f.type}) → maps to Zoho \`${fieldMapping[f.name] || f.zoho_field}\`\n`;
      }
      prompt += `\n`;
    }

    // Example code
    const examplePayload: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === 'email') examplePayload[f.name] = 'user@example.com';
      else if (f.type === 'tel') examplePayload[f.name] = '+1234567890';
      else if (f.name === 'first_name') examplePayload[f.name] = 'John';
      else if (f.name === 'last_name') examplePayload[f.name] = 'Doe';
      else if (f.name === 'company') examplePayload[f.name] = 'Acme Inc';
      else if (f.type === 'textarea') examplePayload[f.name] = 'Hello, I would like to learn more.';
      else examplePayload[f.name] = `example_${f.name}`;
    }

    prompt += `**Example (JavaScript):**\n\n`;
    prompt += '```javascript\n';
    prompt += `const response = await fetch('${submitUrl}', {\n`;
    prompt += `  method: 'POST',\n`;
    prompt += `  headers: { 'Content-Type': 'application/json' },\n`;
    prompt += `  body: JSON.stringify(${JSON.stringify(examplePayload, null, 4)})\n`;
    prompt += `});\n`;
    prompt += `const result = await response.json();\n`;
    prompt += `// result: { success: true, message: "...", record_id: "..." }\n`;
    prompt += '```\n\n';

    // Response shape
    prompt += `**Success response:**\n`;
    prompt += '```json\n';
    prompt += `{ "success": true, "message": "Thank you!", "record_id": "zoho-record-id" }\n`;
    prompt += '```\n\n';

    prompt += `**Error response:**\n`;
    prompt += '```json\n';
    prompt += `{ "error": "Form not found or inactive" }\n`;
    prompt += '```\n\n';

    prompt += `---\n\n`;
  }

  // Embed section
  prompt += `## Embedding Forms\n\n`;
  prompt += `Each route has a self-contained HTML embed snippet available at:\n`;
  prompt += `\`GET ${baseUrl}/api/forms/{formId}\` (authenticated)\n\n`;
  prompt += `The embed code includes inline CSS with customizable CSS variables:\n`;
  prompt += `- \`--ocs-primary\`: Button & accent color\n`;
  prompt += `- \`--ocs-bg\`: Form background\n`;
  prompt += `- \`--ocs-text\`: Text color\n`;
  prompt += `- \`--ocs-radius\`: Border radius\n`;
  prompt += `- \`--ocs-font\`: Font family\n\n`;

  // CORS note
  prompt += `## CORS\n\n`;
  prompt += `All \`/api/f/*\` endpoints accept cross-origin requests (\`Access-Control-Allow-Origin: *\`).\n`;
  prompt += `You can call them from any domain.\n\n`;

  // Manifest reference
  prompt += `## Machine-Readable Manifest\n\n`;
  prompt += `For programmatic access, use the JSON manifest:\n`;
  prompt += `\`GET ${baseUrl}/api/apps/${appRecord.id}/manifest\` (authenticated)\n`;

  return prompt;
}
