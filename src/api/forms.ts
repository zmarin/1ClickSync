import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { authenticate } from '../auth';
import { crmApi, ZohoApiError } from '../zoho/client';
import { env } from '../config';

// ── Schemas ─────────────────────────────────────────
const createFormSchema = z.object({
  app_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),  // backward compat
  name: z.string().min(1).max(255).default('Contact Form'),
  target_module: z.enum(['Leads', 'Contacts', 'Deals']).default('Leads'),
  lead_source: z.string().min(1).max(255),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['text', 'email', 'tel', 'textarea', 'select']),
    required: z.boolean().default(false),
    zoho_field: z.string(),
    options: z.array(z.string()).optional(),
  })).min(1),
  style: z.object({
    primaryColor: z.string().default('#3b82f6'),
    backgroundColor: z.string().default('#ffffff'),
    textColor: z.string().default('#1a1a1a'),
    borderRadius: z.string().default('8px'),
    fontFamily: z.string().default('Inter, sans-serif'),
    buttonText: z.string().default('Submit'),
    successMessage: z.string().default('Thank you! We will be in touch.'),
  }).default({}),
});

const submitFormSchema = z.object({}).catchall(z.string());

// ── Default field presets ───────────────────────────
const LEAD_FORM_DEFAULTS = [
  { name: 'first_name', label: 'First Name', type: 'text' as const, required: false, zoho_field: 'First_Name' },
  { name: 'last_name', label: 'Last Name', type: 'text' as const, required: true, zoho_field: 'Last_Name' },
  { name: 'email', label: 'Email', type: 'email' as const, required: true, zoho_field: 'Email' },
  { name: 'phone', label: 'Phone', type: 'tel' as const, required: false, zoho_field: 'Phone' },
  { name: 'company', label: 'Company', type: 'text' as const, required: false, zoho_field: 'Company' },
  { name: 'message', label: 'Message', type: 'textarea' as const, required: false, zoho_field: 'Description' },
];

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
          field_mapping, style_config, lead_source)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        appId, userId, formKey, body.name,
        body.target_module, JSON.stringify(fieldMapping),
        JSON.stringify({ ...body.style, fields: body.fields }),
        leadSource,
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
        `SELECT id, form_key, name, target_module, lead_source, is_active, submissions_count, created_at, app_id
         FROM form_configs WHERE user_id = $1 AND (app_id = $2 OR customer_id = $2) ORDER BY created_at DESC`,
        [userId, app_id]
      );
      return forms;
    }

    const forms = await query(
      `SELECT f.id, f.form_key, f.name, f.target_module, f.lead_source, f.is_active, f.submissions_count, f.created_at,
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
    return {
      module,
      fields: module === 'Contacts' ? LEAD_FORM_DEFAULTS : LEAD_FORM_DEFAULTS,
      style: createFormSchema.shape.style._def.defaultValue(),
    };
  });

  // ══════════════════════════════════════════════════
  // PUBLIC: Form submission endpoint (NO auth needed)
  // This is what the embedded form POSTs to
  // ══════════════════════════════════════════════════
  app.post('/api/f/:formKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const { formKey } = request.params as { formKey: string };

    // Look up the form config
    const form = await queryOne(
      'SELECT * FROM form_configs WHERE form_key = $1 AND is_active = TRUE',
      [formKey]
    );

    if (!form) {
      return reply.status(404).send({ error: 'Form not found or inactive' });
    }

    // Parse submitted fields
    const submittedData = submitFormSchema.parse(request.body);

    // Check that Zoho is connected for this app
    const appId = form.app_id || form.customer_id;
    const tokens = await queryOne(
      'SELECT id FROM zoho_tokens WHERE (app_id = $1 OR customer_id = $1) AND is_valid = TRUE',
      [appId]
    );

    // Map form fields → Zoho CRM fields
    const fieldMapping = form.field_mapping as Record<string, string>;
    const crmRecord: Record<string, any> = {};

    for (const [formField, zohoField] of Object.entries(fieldMapping)) {
      if (submittedData[formField] !== undefined) {
        crmRecord[zohoField] = submittedData[formField];
      }
    }

    // Add Lead Source attribution: "1ClickSync:<userId>"
    if (form.lead_source) {
      crmRecord['Lead_Source'] = form.lead_source;
    }

    // Log submission
    const [submission] = await query(
      `INSERT INTO form_submissions (form_id, app_id, customer_id, payload, ip_address, status)
       VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
      [form.id, appId, JSON.stringify(submittedData), request.ip, tokens ? 'processing' : 'queued']
    );

    // Increment submissions counter
    await query(
      'UPDATE form_configs SET submissions_count = submissions_count + 1, updated_at = NOW() WHERE id = $1',
      [form.id]
    );

    // If Zoho is connected, push to CRM immediately
    if (tokens) {
      try {
        const result = await crmApi.createRecord(
          appId,
          form.target_module,
          crmRecord
        );

        const recordId = result.data?.[0]?.details?.id || result.data?.[0]?.id || null;

        await query(
          `UPDATE form_submissions
           SET status = 'synced', zoho_record_id = $1, zoho_module = $2
           WHERE id = $3`,
          [recordId, form.target_module, submission.id]
        );

        // CORS: allow any origin (this is an embed)
        reply.header('Access-Control-Allow-Origin', '*');
        return {
          success: true,
          message: (form.style_config as any).successMessage || 'Thank you! We will be in touch.',
          record_id: recordId,
        };
      } catch (err: any) {
        const errMsg = err instanceof ZohoApiError ? err.message : 'CRM sync failed';
        await query(
          `UPDATE form_submissions SET status = 'failed', error = $1 WHERE id = $2`,
          [errMsg, submission.id]
        );

        request.log.error({ err: errMsg, formKey }, 'Form submission CRM sync failed');

        // Still return success to the user — data is saved, will retry
        reply.header('Access-Control-Allow-Origin', '*');
        return {
          success: true,
          message: (form.style_config as any).successMessage || 'Thank you! We will be in touch.',
          note: 'Submission saved, CRM sync pending.',
        };
      }
    }

    // No Zoho connection — save submission for later sync
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
// Embeddable HTML generator
// Returns a self-contained HTML snippet with inline CSS.
// Every style token is clearly labeled so an LLM or user
// can modify styling by changing the CSS custom properties.
// ══════════════════════════════════════════════════════
function generateEmbedCode(
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
