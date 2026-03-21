import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

interface TemplateStep {
  id: string;
  order: number;
  action: string;
  target_app: string;
  config: any;
  depends_on?: string[];
  description: string;
}

interface Template {
  id: string;
  name: string;
  description: string;
  business_type: string;
  version: string;
  steps: TemplateStep[];
}

interface CustomerContext {
  site_name: string;
  site_url?: string;
  email: string;
  business_type: string;
}

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

// Load all templates at startup
const templateCache = new Map<string, Template>();

export function loadTemplates(): void {
  const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const raw = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
    const template: Template = JSON.parse(raw);
    templateCache.set(template.id, template);
    console.log(`[Templates] Loaded: ${template.id} (${template.steps.length} steps)`);
  }
}

export function getTemplate(id: string): Template | undefined {
  return templateCache.get(id);
}

export function listTemplates(): Template[] {
  return Array.from(templateCache.values());
}

/**
 * Resolve template variables ({{customer.xxx}}) with actual customer data.
 * Returns a new template with all placeholders replaced.
 */
export function resolveTemplate(template: Template, customer: CustomerContext): Template {
  const serialized = JSON.stringify(template);

  const resolved = serialized
    .replace(/\{\{customer\.site_name\}\}/g, customer.site_name)
    .replace(/\{\{customer\.site_url\}\}/g, customer.site_url || customer.site_name)
    .replace(/\{\{customer\.email\}\}/g, customer.email)
    .replace(/\{\{customer\.business_type\}\}/g, customer.business_type);

  return JSON.parse(resolved);
}

/**
 * Generate idempotency keys for each step in a resolved template.
 * Key format: {customer_id}:{template_id}:{template_version}:{step_id}
 * This means re-running the same template version skips already-completed steps.
 */
export function generateIdempotencyKeys(
  template: Template,
  customerId: string
): Array<TemplateStep & { idempotencyKey: string }> {
  return template.steps.map(step => ({
    ...step,
    idempotencyKey: `${customerId}:${template.id}:${template.version}:${step.id}`,
  }));
}
