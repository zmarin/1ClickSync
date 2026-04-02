import { env } from '../config';
import { generateEmbedCode } from './forms';

export type ExportTarget = 'html-js';
export type IntegrationKind = 'form_route' | 'embed_widget';
export type IntegrationStatus = 'ga' | 'beta';

export interface IntegrationExport {
  id: string;
  kind: IntegrationKind;
  tool: string;
  name: string;
  status: IntegrationStatus;
  generated_at: string;
  generated_artifacts: string[];
  target: ExportTarget;
  snippet: string;
  instructions: string[];
  content: string;
  integration_config?: Record<string, string>;
  sample_request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: Record<string, string>;
    javascript: string;
  };
  sample_response?: Record<string, any>;
}

export interface ToolSummary {
  tool: string;
  status: IntegrationStatus;
  kind: IntegrationKind;
  summary: string;
  generated_artifacts: string[];
}

export function getToolSupportSummary(tool: string): ToolSummary {
  switch (tool) {
    case 'crm':
      return {
        tool,
        status: 'ga',
        kind: 'form_route',
        summary: 'Embeddable lead capture routes for Zoho CRM modules.',
        generated_artifacts: ['html-js', 'sample-request', 'sample-response', 'llm-prompt', 'manifest'],
      };
    case 'desk':
      return {
        tool,
        status: 'ga',
        kind: 'form_route',
        summary: 'Support ticket routes that submit directly into Zoho Desk.',
        generated_artifacts: ['html-js', 'sample-request', 'sample-response', 'llm-prompt', 'manifest'],
      };
    case 'books':
      return {
        tool,
        status: 'ga',
        kind: 'form_route',
        summary: 'Books contact capture routes. Invoice exports remain beta-only.',
        generated_artifacts: ['html-js', 'sample-request', 'sample-response', 'llm-prompt', 'manifest'],
      };
    case 'salesiq':
      return {
        tool,
        status: 'ga',
        kind: 'embed_widget',
        summary: 'SalesIQ widget export with copy-paste embed code and setup instructions.',
        generated_artifacts: ['html-js', 'llm-prompt', 'manifest'],
      };
    case 'bookings':
      return {
        tool,
        status: 'ga',
        kind: 'form_route',
        summary: 'Booking routes that create appointments from a configured service and staff member.',
        generated_artifacts: ['html-js', 'sample-request', 'sample-response', 'llm-prompt', 'manifest'],
      };
    case 'projects':
      return {
        tool,
        status: 'ga',
        kind: 'form_route',
        summary: 'Task creation routes for a configured Zoho Projects portal and project.',
        generated_artifacts: ['html-js', 'sample-request', 'sample-response', 'llm-prompt', 'manifest'],
      };
    default:
      return {
        tool,
        status: 'beta',
        kind: 'form_route',
        summary: 'Not yet classified for generated exports.',
        generated_artifacts: ['manifest'],
      };
  }
}

export function getFormFields(form: any): any[] {
  const styleConfig = form.style_config as Record<string, any> | undefined;
  return Array.isArray(styleConfig?.fields) ? styleConfig.fields : [];
}

export function getFormStyle(form: any): Record<string, any> {
  const styleConfig = ((form.style_config as Record<string, any>) || {});
  const style = { ...styleConfig };
  delete style.fields;
  return style;
}

export function getIntegrationConfig(form: any): Record<string, string> | undefined {
  const style = getFormStyle(form);
  const tool = form.route_type || 'crm';

  if (tool === 'crm') {
    const config: Record<string, string> = {};
    if (form.lead_source) config.lead_source = String(form.lead_source);
    if (style.layoutId) config.layoutId = String(style.layoutId);
    if (style.layoutName) config.layoutName = String(style.layoutName);
    if (style.configHome) config.configHome = String(style.configHome);
    if (style.ownership) config.ownership = String(style.ownership);
    if (style.promptDefaults) config.promptDefaults = JSON.stringify(style.promptDefaults);
    return Object.keys(config).length > 0 ? config : undefined;
  }

  if (tool === 'bookings') {
    const config: Record<string, string> = {};
    if (style.service_id) config.service_id = String(style.service_id);
    if (style.staff_id) config.staff_id = String(style.staff_id);
    if (style.timezone) config.timezone = String(style.timezone);
    return Object.keys(config).length > 0 ? config : undefined;
  }

  if (tool === 'projects') {
    const config: Record<string, string> = {};
    if (style.portalId) config.portalId = String(style.portalId);
    if (style.projectId) config.projectId = String(style.projectId);
    if (style.defaultPriority) config.defaultPriority = String(style.defaultPriority);
    return Object.keys(config).length > 0 ? config : undefined;
  }

  return undefined;
}

export function buildExamplePayload(fields: Array<{ name: string; type: string }>): Record<string, string> {
  const payload: Record<string, string> = {};

  for (const field of fields) {
    if (field.type === 'email') payload[field.name] = 'developer@example.com';
    else if (field.type === 'tel') payload[field.name] = '+1-555-0100';
    else if (field.type === 'date') payload[field.name] = '2026-03-23';
    else if (field.type === 'time') payload[field.name] = '09:30';
    else if (field.type === 'number') payload[field.name] = '1';
    else if (field.name === 'first_name') payload[field.name] = 'Ada';
    else if (field.name === 'last_name') payload[field.name] = 'Lovelace';
    else if (field.name === 'company') payload[field.name] = 'Analytical Engines';
    else if (field.name === 'subject') payload[field.name] = 'Need help with onboarding';
    else if (field.name === 'contact_name') payload[field.name] = 'Ada Lovelace';
    else if (field.type === 'textarea') payload[field.name] = 'Generated from the connected Zoho workspace.';
    else payload[field.name] = `example_${field.name}`;
  }

  return payload;
}

export function buildJavascriptExample(submitUrl: string, payload: Record<string, string>): string {
  return [
    `const response = await fetch('${submitUrl}', {`,
    `  method: 'POST',`,
    `  headers: { 'Content-Type': 'application/json' },`,
    `  body: JSON.stringify(${JSON.stringify(payload, null, 2)})`,
    `});`,
    `const result = await response.json();`,
    `console.log(result);`,
  ].join('\n');
}

export function buildFormRouteExport(form: any): IntegrationExport {
  const fields = getFormFields(form);
  const style = getFormStyle(form);
  const submitUrl = `${env.APP_URL}/api/f/${form.form_key}`;
  const tool = form.route_type || 'crm';
  const summary = getToolSupportSummary(tool);
  const integrationConfig = getIntegrationConfig(form);
  const payload = buildExamplePayload(fields);
  const javascript = buildJavascriptExample(submitUrl, payload);
  const snippet = generateEmbedCode(form.form_key, form.name, fields, style, submitUrl);
  const sampleResponse = {
    success: true,
    message: style.successMessage || 'Thank you! We will be in touch.',
    record_id: tool === 'crm' || tool === 'desk' || tool === 'books' ? 'zoho-record-id' : undefined,
  };
  const contentParts = [
    `# ${form.name}`,
    '',
    `Tool: Zoho ${tool.toUpperCase()}`,
    `Kind: form_route`,
    `Status: ${summary.status.toUpperCase()}`,
    `Target module: ${form.target_module}`,
    '',
    '## HTML/JS Snippet',
    '```html',
    snippet,
    '```',
    '',
  ];

  if (integrationConfig) {
    contentParts.push(
      '## Integration Configuration',
      '```json',
      JSON.stringify(integrationConfig, null, 2),
      '```',
      '',
    );
  }

  const content = [
    ...contentParts,
    '## Sample JavaScript Request',
    '```javascript',
    javascript,
    '```',
    '',
    '## Sample JSON Response',
    '```json',
    JSON.stringify(sampleResponse, null, 2),
    '```',
  ].join('\n');

  return {
    id: form.id,
    kind: 'form_route',
    tool,
    name: form.name,
    status: summary.status,
    generated_at: new Date().toISOString(),
    generated_artifacts: summary.generated_artifacts,
    target: 'html-js',
    snippet,
    instructions: [
      `Paste the snippet into your site or app and keep the submit URL pointed at ${submitUrl}.`,
      ...(integrationConfig
        ? [`This route is preconfigured with ${Object.entries(integrationConfig).map(([key, value]) => `${key}=${value}`).join(', ')}.`]
        : []),
      `Use the project manifest for machine-readable integration metadata.`,
      `Use the generated prompt when you want an LLM to adapt the snippet to a specific framework.`,
    ],
    content,
    integration_config: integrationConfig,
    sample_request: {
      method: 'POST',
      url: submitUrl,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      javascript,
    },
    sample_response: sampleResponse,
  };
}

export function buildSalesIQExport(appRecord: any): IntegrationExport {
  const settings = ((appRecord.settings as Record<string, any>) || {});
  const widgetCode = settings.salesiq_widget_code || 'PASTE_YOUR_SALESIQ_WIDGET_CODE';
  const snippet = [
    '<!-- Generated Zoho SalesIQ Widget -->',
    '<script>',
    '  window.$zoho = window.$zoho || {};',
    '  window.$zoho.salesiq = window.$zoho.salesiq || {',
    `    widgetcode: '${widgetCode}',`,
    '    values: {},',
    '    ready: function () {',
    `      console.log('SalesIQ ready for ${escapeForJs(appRecord.name)}');`,
    '    },',
    '  };',
    '  var d = document;',
    "  var s = d.createElement('script');",
    "  s.type = 'text/javascript';",
    '  s.id = "zsiqscript";',
    "  s.defer = true;",
    '  s.src = "https://salesiq.zoho.com/widget";',
    '  var first = d.getElementsByTagName("script")[0];',
    '  first.parentNode.insertBefore(s, first);',
    '</script>',
    '<!-- End generated Zoho SalesIQ Widget -->',
  ].join('\n');

  const content = [
    `# ${appRecord.name} — SalesIQ Widget Export`,
    '',
    'Tool: Zoho SalesIQ',
    'Kind: embed_widget',
    'Status: GA',
    '',
    '## HTML/JS Snippet',
    '```html',
    snippet,
    '```',
    '',
    '## Instructions',
    '1. Replace `PASTE_YOUR_SALESIQ_WIDGET_CODE` with the widget code from Zoho SalesIQ if you have not saved it in app settings yet.',
    '2. Paste the snippet before the closing `</body>` tag in your site or app shell.',
    '3. Use the generated handoff prompt if you want an LLM to adapt this to React, Next.js, or another framework.',
  ].join('\n');

  return {
    id: 'salesiq-widget',
    kind: 'embed_widget',
    tool: 'salesiq',
    name: `${appRecord.name} SalesIQ Widget`,
    status: 'ga',
    generated_at: new Date().toISOString(),
    generated_artifacts: ['html-js', 'llm-prompt', 'manifest'],
    target: 'html-js',
    snippet,
    instructions: [
      'Replace the widget code placeholder with your Zoho SalesIQ widget code if needed.',
      'Paste the snippet into your app shell or site layout.',
      'Use the generated handoff prompt to adapt the snippet for your framework.',
    ],
    content,
  };
}

function escapeForJs(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
