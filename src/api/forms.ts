import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate } from '../auth';
import { crmApi, deskApi, bookingsApi, booksApi, projectsApi, ZohoApiError } from '../zoho/client';
import { env } from '../config';
import { getAccessToken } from '../zoho/oauth';

// ── Schemas ─────────────────────────────────────────
const formStyleSchema = z.object({
  primaryColor: z.string().default('#3b82f6'),
  backgroundColor: z.string().default('#ffffff'),
  textColor: z.string().default('#1a1a1a'),
  borderRadius: z.string().default('8px'),
  fontFamily: z.string().default('Inter, sans-serif'),
  buttonText: z.string().default('Submit'),
  successMessage: z.string().default('Thank you! We will be in touch.'),
  service_id: z.string().optional(),
  staff_id: z.string().optional(),
  timezone: z.string().optional(),
  portalId: z.string().optional(),
  projectId: z.string().optional(),
  defaultPriority: z.enum(['None', 'Low', 'Medium', 'High']).optional(),
  layoutId: z.string().optional(),
  layoutName: z.string().optional(),
  configHome: z.string().optional(),
  ownership: z.string().optional(),
  promptDefaults: z.record(z.any()).optional(),
}).default({});

const createFormSchema = z.object({
  app_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),  // backward compat
  route_type: z.enum(['crm', 'desk', 'bookings', 'books', 'projects']).default('crm'),
  name: z.string().min(1).max(255).default('Contact Form'),
  target_module: z.string().min(1).max(100).default('Leads'),
  lead_source: z.string().max(255).optional(),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'date', 'time', 'number']),
    required: z.boolean().default(false),
    zoho_field: z.string(),
    options: z.array(z.string()).optional(),
  })).min(1),
  style: formStyleSchema,
});

const submitFormSchema = z.object({}).catchall(z.string());

// ── Default field presets per route type ─────────────
const FIELD_PRESETS: Record<string, Array<{ name: string; label: string; type: string; required: boolean; zoho_field: string }>> = {
  crm: [
    { name: 'first_name', label: 'First Name', type: 'text', required: false, zoho_field: 'First_Name' },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true, zoho_field: 'Last_Name' },
    { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'Email' },
    { name: 'phone', label: 'Phone', type: 'tel', required: false, zoho_field: 'Phone' },
    { name: 'company', label: 'Company', type: 'text', required: false, zoho_field: 'Company' },
    { name: 'message', label: 'Message', type: 'textarea', required: false, zoho_field: 'Description' },
  ],
  desk: [
    { name: 'subject', label: 'Subject', type: 'text', required: true, zoho_field: 'subject' },
    { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'email' },
    { name: 'name', label: 'Name', type: 'text', required: false, zoho_field: 'contactName' },
    { name: 'phone', label: 'Phone', type: 'tel', required: false, zoho_field: 'phone' },
    { name: 'description', label: 'Description', type: 'textarea', required: true, zoho_field: 'description' },
    { name: 'priority', label: 'Priority', type: 'select', required: false, zoho_field: 'priority' },
  ],
  bookings: [
    { name: 'name', label: 'Full Name', type: 'text', required: true, zoho_field: 'customer_name' },
    { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'customer_email' },
    { name: 'phone', label: 'Phone', type: 'tel', required: false, zoho_field: 'customer_phone' },
    { name: 'preferred_date', label: 'Preferred Date', type: 'date', required: true, zoho_field: 'from_time' },
    { name: 'preferred_time', label: 'Preferred Time', type: 'time', required: true, zoho_field: 'time_slot' },
    { name: 'notes', label: 'Notes', type: 'textarea', required: false, zoho_field: 'additional_fields' },
  ],
  books: [
    { name: 'contact_name', label: 'Contact Name', type: 'text', required: true, zoho_field: 'contact_name' },
    { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'email' },
    { name: 'company', label: 'Company', type: 'text', required: false, zoho_field: 'company_name' },
    { name: 'phone', label: 'Phone', type: 'tel', required: false, zoho_field: 'phone' },
    { name: 'notes', label: 'Notes', type: 'textarea', required: false, zoho_field: 'notes' },
  ],
  projects: [
    { name: 'task_name', label: 'Task Name', type: 'text', required: true, zoho_field: 'name' },
    { name: 'description', label: 'Description', type: 'textarea', required: false, zoho_field: 'description' },
    { name: 'priority', label: 'Priority', type: 'select', required: false, zoho_field: 'priority' },
    { name: 'due_date', label: 'Due Date', type: 'date', required: false, zoho_field: 'end_date' },
  ],
};

// Backward compat alias
const LEAD_FORM_DEFAULTS = FIELD_PRESETS.crm;

// ── Module options per route type ───────────────────
const MODULE_OPTIONS: Record<string, string[]> = {
  crm: ['Leads', 'Contacts', 'Deals'],
  desk: ['Tickets'],
  bookings: ['Appointments'],
  books: ['Contacts'],
  projects: ['Tasks'],
};

export async function formsPlugin(app: FastifyInstance) {

  // ── Create a form config (authenticated) ──────────
  app.post('/api/forms', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createFormSchema.parse(request.body);
    const userId = (request as any).userId;
    const appId = body.app_id || body.customer_id;

    if (!appId) {
      return reply.status(400).send({ error: 'app_id is required' });
    }

    // Verify app belongs to this user (try apps table first, fall back to customers)
    let owner = await queryOne('SELECT id FROM apps WHERE id = $1 AND user_id = $2', [appId, userId]);
    if (!owner) {
      owner = await queryOne('SELECT id FROM customers WHERE id = $1 AND user_id = $2', [appId, userId]);
    }
    if (!owner) {
      return reply.status(404).send({ error: 'App not found' });
    }

    if (body.route_type === 'bookings' && (!body.style.service_id || !body.style.staff_id)) {
      return reply.status(400).send({ error: 'Bookings routes require a service ID and staff ID' });
    }

    if (body.route_type === 'projects' && (!body.style.portalId || !body.style.projectId)) {
      return reply.status(400).send({ error: 'Projects routes require a portal ID and project ID' });
    }

    // Generate unique form key
    const formKey = randomBytes(16).toString('hex');

    // Build field mapping: { formFieldName: zohoApiFieldName }
    const fieldMapping: Record<string, string> = {};
    for (const field of body.fields) {
      fieldMapping[field.name] = field.zoho_field;
    }

    // Lead source from user selection (dropdown or custom value)
    const leadSource = body.lead_source;

    const [form] = await query(
      `INSERT INTO form_configs
         (app_id, customer_id, user_id, form_key, name, target_module,
          route_type, field_mapping, style_config, lead_source)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        appId, userId, formKey, body.name,
        body.target_module, body.route_type,
        JSON.stringify(fieldMapping),
        JSON.stringify({ ...body.style, fields: body.fields }),
        body.lead_source || null,
      ]
    );

    return reply.status(201).send({
      form,
      form_key: formKey,
      submit_url: `${env.APP_URL}/api/f/${formKey}`,
      embed_code: generateEmbedCode(formKey, body.name, body.fields, body.style, `${env.APP_URL}/api/f/${formKey}`),
    });
  });

  // ── List forms (authenticated) ────────────────────
  // Optional: filter by app_id query param
  app.get('/api/forms', { preHandler: [authenticate] }, async (request: FastifyRequest) => {
    const userId = (request as any).userId;
    const { app_id } = request.query as { app_id?: string };

    if (app_id) {
      const forms = await query(
        `SELECT id, form_key, name, target_module, route_type, lead_source, is_active, submissions_count, created_at, app_id
         FROM form_configs WHERE user_id = $1 AND (app_id = $2 OR customer_id = $2) ORDER BY created_at DESC`,
        [userId, app_id]
      );
      return forms;
    }

    const forms = await query(
      `SELECT f.id, f.form_key, f.name, f.target_module, f.route_type, f.lead_source, f.is_active, f.submissions_count, f.created_at,
              f.app_id, a.name as app_name
       FROM form_configs f
       LEFT JOIN apps a ON a.id = f.app_id
       WHERE f.user_id = $1 ORDER BY f.created_at DESC`,
      [userId]
    );
    return forms;
  });

  // ── Get form config + embed code (authenticated) ──
  app.get('/api/forms/:formId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { formId } = request.params as { formId: string };
    const userId = (request as any).userId;

    const form = await queryOne(
      'SELECT * FROM form_configs WHERE id = $1 AND user_id = $2',
      [formId, userId]
    );
    if (!form) return reply.status(404).send({ error: 'Form not found' });

    const styleConfig = form.style_config as any;
    const fields = styleConfig.fields || LEAD_FORM_DEFAULTS;
    const style = { ...styleConfig };
    delete style.fields;

    return {
      ...form,
      submit_url: `${env.APP_URL}/api/f/${form.form_key}`,
      embed_code: generateEmbedCode(form.form_key, form.name, fields, style, `${env.APP_URL}/api/f/${form.form_key}`),
    };
  });

  // ── Update form config (authenticated) ──────────
  app.patch('/api/forms/:formId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { formId } = request.params as { formId: string };
    const userId = (request as any).userId;
    const body = request.body as Record<string, any>;

    const form = await queryOne(
      'SELECT * FROM form_configs WHERE id = $1 AND user_id = $2',
      [formId, userId]
    );
    if (!form) return reply.status(404).send({ error: 'Form not found' });

    // Build SET clause from allowed fields
    const allowed = ['name', 'lead_source', 'target_module', 'is_active'];
    const sets: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (body[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        values.push(body[key]);
        idx++;
      }
    }
    if (body.style) {
      // Merge style into existing style_config
      const existingStyle = form.style_config as any;
      sets.push(`style_config = $${idx}`);
      values.push(JSON.stringify({ ...existingStyle, ...body.style }));
      idx++;
    }

    values.push(formId);
    const [updated] = await query(
      `UPDATE form_configs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // Return updated form with fresh embed code
    const styleConfig = updated.style_config as any;
    const fields = styleConfig.fields || LEAD_FORM_DEFAULTS;
    const style = { ...styleConfig };
    delete style.fields;

    return {
      ...updated,
      submit_url: `${env.APP_URL}/api/f/${updated.form_key}`,
      embed_code: generateEmbedCode(updated.form_key, updated.name, fields, style, `${env.APP_URL}/api/f/${updated.form_key}`),
    };
  });

  // ── Delete form (authenticated) ────────────────
  app.delete('/api/forms/:formId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { formId } = request.params as { formId: string };
    const userId = (request as any).userId;

    const form = await queryOne(
      'SELECT id FROM form_configs WHERE id = $1 AND user_id = $2',
      [formId, userId]
    );
    if (!form) return reply.status(404).send({ error: 'Form not found' });

    await query('DELETE FROM form_configs WHERE id = $1', [formId]);
    return { success: true };
  });

  // ── Get form defaults/presets (authenticated) ─────
  app.get('/api/forms/presets/:module', { preHandler: [authenticate] }, async (request: FastifyRequest) => {
    const { module } = request.params as { module: string };
    const { route_type = 'crm' } = request.query as { route_type?: string };
    const presets = FIELD_PRESETS[route_type] || FIELD_PRESETS.crm;
    const modules = MODULE_OPTIONS[route_type] || MODULE_OPTIONS.crm;
    return {
      module,
      route_type,
      fields: presets,
      modules,
      style: createFormSchema.shape.style._def.defaultValue(),
    };
  });

  // ══════════════════════════════════════════════════
  // PUBLIC: Form submission endpoint (NO auth needed)
  // Dispatches to CRM, Desk, Bookings, Books, or Projects
  // based on form.route_type
  // ══════════════════════════════════════════════════
  app.post('/api/f/:formKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const { formKey } = request.params as { formKey: string };

    const form = await queryOne(
      'SELECT * FROM form_configs WHERE form_key = $1 AND is_active = TRUE',
      [formKey]
    );

    if (!form) {
      return reply.status(404).send({ error: 'Form not found or inactive' });
    }

    const submittedData = submitFormSchema.parse(request.body);
    const appId = form.app_id || form.customer_id;
    const routeType = form.route_type || 'crm';

    let connectionAvailable = false;
    try {
      await getAccessToken(appId, routeType as any);
      connectionAvailable = true;
    } catch {
      connectionAvailable = false;
    }

    // Map form fields → Zoho fields using field_mapping
    const fieldMapping = form.field_mapping as Record<string, string>;
    const mappedData: Record<string, any> = {};
    for (const [formField, zohoField] of Object.entries(fieldMapping)) {
      if (submittedData[formField] !== undefined) {
        mappedData[zohoField] = submittedData[formField];
      }
    }

    // CRM-specific: add Lead Source
    if (routeType === 'crm' && form.lead_source) {
      mappedData['Lead_Source'] = form.lead_source;
    }

    // Log submission
    const [submission] = await query(
      `INSERT INTO form_submissions (form_id, app_id, customer_id, payload, ip_address, status)
       VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
      [form.id, appId, JSON.stringify(submittedData), request.ip, connectionAvailable ? 'processing' : 'queued']
    );

    await query(
      'UPDATE form_configs SET submissions_count = submissions_count + 1, updated_at = NOW() WHERE id = $1',
      [form.id]
    );

    // If Zoho is connected, dispatch to the appropriate tool
    if (connectionAvailable) {
      try {
        const result = await dispatchToZoho(routeType, appId, form, mappedData, submittedData);
        const recordId = result.data?.[0]?.details?.id || result.data?.[0]?.id
          || result.data?.id || result.appointment?.booking_id || null;

        await query(
          `UPDATE form_submissions
           SET status = 'synced', zoho_record_id = $1, zoho_module = $2
           WHERE id = $3`,
          [String(recordId || ''), `${routeType}.${form.target_module}`, submission.id]
        );

        reply.header('Access-Control-Allow-Origin', '*');
        return {
          success: true,
          message: (form.style_config as any).successMessage || 'Thank you! We will be in touch.',
          record_id: recordId,
        };
      } catch (err: any) {
        const errMsg = err instanceof ZohoApiError ? err.message : `${routeType} sync failed`;
        await query(
          `UPDATE form_submissions SET status = 'failed', error = $1 WHERE id = $2`,
          [errMsg, submission.id]
        );

        request.log.error({ err: errMsg, formKey, routeType }, 'Form submission sync failed');

        reply.header('Access-Control-Allow-Origin', '*');
        return {
          success: true,
          message: (form.style_config as any).successMessage || 'Thank you! We will be in touch.',
          note: 'Submission saved, sync pending.',
        };
      }
    }

    reply.header('Access-Control-Allow-Origin', '*');
    return {
      success: true,
      message: (form.style_config as any).successMessage || 'Thank you! We will be in touch.',
    };
  });

  // ══════════════════════════════════════════════════
  // Lead Source management (fetches from Zoho CRM)
  // ══════════════════════════════════════════════════

  // Get available Lead_Source picklist values from Zoho CRM
  // Get Lead_Source picklist values from any module (Leads, Contacts, Deals)
  // Accepts appId or customerId for backward compat
  app.get('/api/lead-sources/:appId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const { module = 'Leads' } = request.query as { module?: string };

    try {
      const result = await crmApi.getFields(appId, module);
      const fields = result.fields || [];
      const leadSourceField = fields.find((f: any) => f.api_name === 'Lead_Source');

      if (!leadSourceField) {
        return reply.status(404).send({ error: `Lead_Source field not found in ${module} module` });
      }

      const values = (leadSourceField.pick_list_values || [])
        .filter((v: any) => v.type === 'used')
        .map((v: any) => ({
          display_value: v.display_value,
          actual_value: v.actual_value || v.display_value,
          id: v.id,
        }));

      return { field_id: leadSourceField.id, module, values };
    } catch (err: any) {
      request.log.error({ err: err.message, module }, 'Failed to fetch lead sources');
      return reply.status(500).send({ error: `Failed to fetch lead sources from ${module}` });
    }
  });

  // Add a new Lead_Source picklist value to any module
  app.post('/api/lead-sources/:appId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { appId } = request.params as { appId: string };
    const { field_id, display_value, module = 'Leads' } = request.body as {
      field_id: string; display_value: string; module?: string;
    };

    if (!field_id || !display_value) {
      return reply.status(400).send({ error: 'field_id and display_value are required' });
    }

    try {
      await crmApi.updateField(appId, module, field_id, {
        pick_list_values: [{ display_value }],
      });

      return { success: true, display_value, module };
    } catch (err: any) {
      request.log.error({ err: err.message, module }, 'Failed to add lead source');
      return reply.status(500).send({ error: `Failed to add lead source to ${module}` });
    }
  });

  // CORS preflight for the public form endpoint
  app.options('/api/f/:formKey', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type')
      .send();
  });
}


// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// Route dispatcher — sends data to the correct Zoho tool
// ══════════════════════════════════════════════════════
async function dispatchToZoho(
  routeType: string,
  appId: string,
  form: any,
  mappedData: Record<string, any>,
  rawData: Record<string, any>,
): Promise<any> {
  switch (routeType) {
    case 'crm':
      return crmApi.createRecord(appId, form.target_module, mappedData);

    case 'desk':
      return deskApi.createTicket(appId, {
        subject: mappedData.subject || rawData.subject || 'Support Request',
        email: mappedData.email || rawData.email,
        phone: mappedData.phone || rawData.phone,
        description: mappedData.description || rawData.description || rawData.message || '',
        contactName: mappedData.contactName || rawData.name || '',
        priority: mappedData.priority || rawData.priority || undefined,
        channel: 'Web',
      });

    case 'bookings':
      return bookingsApi.createAppointment(appId, {
        service_id: mappedData.service_id || form.style_config?.service_id,
        staff_id: mappedData.staff_id || form.style_config?.staff_id,
        from_time: mappedData.from_time || rawData.preferred_date,
        time_slot: mappedData.time_slot || rawData.preferred_time,
        timezone: mappedData.timezone || rawData.timezone || form.style_config?.timezone || 'UTC',
        customer_details: {
          name: mappedData.customer_name || rawData.name || '',
          email: mappedData.customer_email || rawData.email || '',
          phone_number: mappedData.customer_phone || rawData.phone || '',
        },
        additional_fields: mappedData.additional_fields || rawData.notes ? { notes: rawData.notes } : undefined,
      });

    case 'books':
      if ((form.target_module || 'Contacts') !== 'Contacts') {
        throw new Error('Zoho Books exports currently support Contacts only');
      }
      return booksApi.createContact(appId, {
        contact_name: mappedData.contact_name || rawData.contact_name || rawData.name || '',
        email: mappedData.email || rawData.email || '',
        company_name: mappedData.company_name || rawData.company || '',
        phone: mappedData.phone || rawData.phone || '',
        notes: mappedData.notes || rawData.notes || '',
        contact_type: 'customer',
      });

    case 'projects': {
      const portalId = form.style_config?.portalId || '';
      const projectId = form.style_config?.projectId || '';
      if (!portalId || !projectId) {
        throw new Error('Portal ID and Project ID are required for Projects routes');
      }
      return projectsApi.createTask(appId, portalId, projectId, {
        name: mappedData.name || rawData.task_name || 'New Task',
        description: mappedData.description || rawData.description || '',
        priority: mappedData.priority || rawData.priority || form.style_config?.defaultPriority || 'None',
        end_date: mappedData.end_date || rawData.due_date || undefined,
      });
    }

    default:
      throw new Error(`Unsupported route type: ${routeType}`);
  }
}


// ══════════════════════════════════════════════════════
// Embeddable HTML generator
// Returns a self-contained HTML snippet with inline CSS.
// Every style token is clearly labeled so an LLM or user
// can modify styling by changing the CSS custom properties.
// ══════════════════════════════════════════════════════
export function generateEmbedCode(
  formKey: string,
  formName: string,
  fields: Array<{ name: string; label: string; type: string; required?: boolean; options?: string[] }>,
  style: Record<string, any>,
  submitUrl: string,
): string {
  const s = {
    primaryColor: style.primaryColor || '#3b82f6',
    backgroundColor: style.backgroundColor || '#ffffff',
    textColor: style.textColor || '#1a1a1a',
    borderRadius: style.borderRadius || '8px',
    fontFamily: style.fontFamily || 'Inter, sans-serif',
    buttonText: style.buttonText || 'Submit',
    successMessage: style.successMessage || 'Thank you! We will be in touch.',
  };

  // Build field HTML
  const fieldsHtml = fields.map(f => {
    const req = f.required ? ' required' : '';
    const reqMark = f.required ? ' <span style="color:#ef4444">*</span>' : '';

    if (f.type === 'textarea') {
      return `
      <div class="ocs-field">
        <label for="ocs-${f.name}">${f.label}${reqMark}</label>
        <textarea id="ocs-${f.name}" name="${f.name}" rows="3"${req}></textarea>
      </div>`;
    }
    if (f.type === 'select' && f.options) {
      const opts = f.options.map(o => `<option value="${o}">${o}</option>`).join('');
      return `
      <div class="ocs-field">
        <label for="ocs-${f.name}">${f.label}${reqMark}</label>
        <select id="ocs-${f.name}" name="${f.name}"${req}>
          <option value="">Select...</option>${opts}
        </select>
      </div>`;
    }
    return `
      <div class="ocs-field">
        <label for="ocs-${f.name}">${f.label}${reqMark}</label>
        <input type="${f.type}" id="ocs-${f.name}" name="${f.name}"${req} />
      </div>`;
  }).join('\n');

  return `<!-- 1ClickSync Form: ${formName} -->
<!-- ═══════════════════════════════════════════════════════
     STYLE GUIDE — Edit the CSS variables below to restyle.
     An LLM can modify any of these values:
       --ocs-primary     : Button & accent color
       --ocs-bg          : Form background
       --ocs-text        : Text color
       --ocs-radius      : Border radius for inputs & button
       --ocs-font        : Font family
       --ocs-input-bg    : Input background
       --ocs-input-border: Input border color
       --ocs-shadow      : Form box-shadow
     ═══════════════════════════════════════════════════════ -->
<div id="ocs-form-${formKey}" class="ocs-form-wrapper">
  <style>
    #ocs-form-${formKey} {
      /* ── EDITABLE STYLE TOKENS ────────────────── */
      --ocs-primary: ${s.primaryColor};
      --ocs-bg: ${s.backgroundColor};
      --ocs-text: ${s.textColor};
      --ocs-radius: ${s.borderRadius};
      --ocs-font: ${s.fontFamily};
      --ocs-input-bg: #f9fafb;
      --ocs-input-border: #d1d5db;
      --ocs-shadow: 0 4px 24px rgba(0,0,0,0.08);
      /* ── END TOKENS ───────────────────────────── */

      font-family: var(--ocs-font);
      color: var(--ocs-text);
      background: var(--ocs-bg);
      border-radius: var(--ocs-radius);
      box-shadow: var(--ocs-shadow);
      max-width: 480px;
      padding: 32px;
      margin: 0 auto;
      box-sizing: border-box;
    }
    #ocs-form-${formKey} .ocs-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 20px 0;
    }
    #ocs-form-${formKey} .ocs-field {
      margin-bottom: 16px;
    }
    #ocs-form-${formKey} label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 6px;
    }
    #ocs-form-${formKey} input,
    #ocs-form-${formKey} textarea,
    #ocs-form-${formKey} select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--ocs-input-border);
      border-radius: var(--ocs-radius);
      background: var(--ocs-input-bg);
      font-family: var(--ocs-font);
      font-size: 0.9rem;
      color: var(--ocs-text);
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    #ocs-form-${formKey} input:focus,
    #ocs-form-${formKey} textarea:focus,
    #ocs-form-${formKey} select:focus {
      outline: none;
      border-color: var(--ocs-primary);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
    }
    #ocs-form-${formKey} .ocs-btn {
      width: 100%;
      padding: 12px;
      background: var(--ocs-primary);
      color: #fff;
      border: none;
      border-radius: var(--ocs-radius);
      font-family: var(--ocs-font);
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-top: 8px;
    }
    #ocs-form-${formKey} .ocs-btn:hover { opacity: 0.9; }
    #ocs-form-${formKey} .ocs-btn:disabled { opacity: 0.6; cursor: wait; }
    #ocs-form-${formKey} .ocs-success {
      text-align: center;
      padding: 24px;
      color: #059669;
      font-weight: 500;
    }
    #ocs-form-${formKey} .ocs-error {
      color: #ef4444;
      font-size: 0.85rem;
      margin-top: 8px;
    }
    #ocs-form-${formKey} .ocs-powered {
      text-align: center;
      margin-top: 16px;
      font-size: 0.75rem;
      color: #9ca3af;
    }
    #ocs-form-${formKey} .ocs-powered a { color: #6b7280; text-decoration: none; }
  </style>

  <form id="ocs-formEl-${formKey}" novalidate>
    <div class="ocs-title">${formName}</div>
${fieldsHtml}
    <button type="submit" class="ocs-btn">${s.buttonText}</button>
    <div class="ocs-error" id="ocs-error-${formKey}" style="display:none"></div>
    <div class="ocs-powered">Powered by <a href="https://1clicksync.com" target="_blank">1ClickSync</a></div>
  </form>

  <script>
  (function(){
    var form = document.getElementById('ocs-formEl-${formKey}');
    var errEl = document.getElementById('ocs-error-${formKey}');
    var wrapper = document.getElementById('ocs-form-${formKey}');

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      errEl.style.display = 'none';
      var btn = form.querySelector('.ocs-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      var data = {};
      var inputs = form.querySelectorAll('input, textarea, select');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].name) data[inputs[i].name] = inputs[i].value;
      }

      fetch('${submitUrl}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          wrapper.innerHTML = '<div class="ocs-success">' + (res.message || '${s.successMessage}') + '</div>';
        } else {
          errEl.textContent = res.error || 'Something went wrong.';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '${s.buttonText}';
        }
      })
      .catch(function() {
        errEl.textContent = 'Network error. Please try again.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '${s.buttonText}';
      });
    });
  })();
  </script>
</div>
<!-- End 1ClickSync Form -->`;
}
