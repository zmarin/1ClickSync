import { randomBytes } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth';
import { env, ZOHO_SERVICE_SCOPES, ZOHO_STUDIO_SERVICES } from '../config';
import { query, queryOne } from '../db';
import { buildSalesIQExport, getToolSupportSummary } from './export-utils';
import { ZohoApiError, booksApi, bookingsApi, crmApi, deskApi, projectsApi, zohoApi } from '../zoho/client';

const serviceSchema = z.enum(ZOHO_STUDIO_SERVICES);
type ServiceId = z.infer<typeof serviceSchema>;

const routeTypeSchema = z.enum(['crm', 'desk', 'bookings', 'books', 'projects']);
type RouteType = z.infer<typeof routeTypeSchema>;

export const promptModeSchema = z.enum(['build-custom-route', 'augment-native', 'work-from-config']);
export type PromptMode = z.infer<typeof promptModeSchema>;

const optionalText = (max: number) => z.union([
  z.string().trim().max(max),
  z.literal(''),
  z.null(),
  z.undefined(),
]).transform((value) => typeof value === 'string' && value.trim() ? value.trim() : null);

const optionalUrl = z.union([
  z.string().trim().url(),
  z.literal(''),
  z.null(),
  z.undefined(),
]).transform((value) => typeof value === 'string' && value.trim() ? value.trim() : null);

const appQuerySchema = z.object({
  app_id: z.string().uuid(),
  goal: optionalText(1000).optional(),
  mode: promptModeSchema.optional(),
});

const projectContextSchema = z.object({
  app_id: z.string().uuid(),
  app_name: optionalText(255),
  app_url: optionalUrl,
  app_docs_url: optionalUrl,
  target_base_url: optionalUrl,
  notes: optionalText(2000),
});

const handoffSchema = z.object({
  app_id: z.string().uuid(),
  service: serviceSchema,
  goal: z.string().trim().min(1).max(1000).default('Build the next step for this connected Zoho capability.'),
  action: z.string().trim().max(100).optional(),
  mode: promptModeSchema.default('work-from-config'),
});

const routeFieldSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'date', 'time', 'number']),
  required: z.boolean().optional(),
  zoho_field: z.string().trim().min(1),
  options: z.array(z.string()).optional(),
});

const createRouteActionSchema = z.object({
  app_id: z.string().uuid(),
  route_type: routeTypeSchema.optional(),
  name: z.string().trim().min(1).max(255).optional(),
  target_module: z.string().trim().min(1).max(100).optional(),
  lead_source: optionalText(255).optional(),
  fields: z.array(routeFieldSchema).optional(),
  style: z.record(z.any()).optional(),
});

const createLeadSourceSchema = z.object({
  app_id: z.string().uuid(),
  module: z.string().trim().min(1).default('Leads'),
  field_id: z.string().trim().optional(),
  display_value: z.string().trim().min(1).max(255),
});

const createRecordSchema = z.object({
  app_id: z.string().uuid(),
  module: z.string().trim().min(1).default('Leads'),
  payload: z.record(z.any()).default({}),
});

const createTicketSchema = z.object({
  app_id: z.string().uuid(),
  payload: z.object({
    subject: z.string().trim().min(1),
    email: z.string().email(),
    description: z.string().trim().min(1),
    phone: z.string().trim().optional(),
    contactName: z.string().trim().optional(),
    priority: z.string().trim().optional(),
  }),
});

const createAppointmentSchema = z.object({
  app_id: z.string().uuid(),
  payload: z.object({
    service_id: z.string().trim().min(1),
    staff_id: z.string().trim().min(1),
    from_time: z.string().trim().min(1),
    time_slot: z.string().trim().min(1),
    timezone: z.string().trim().default('UTC'),
    customer_details: z.object({
      name: z.string().trim().min(1),
      email: z.string().email(),
      phone_number: z.string().trim().optional(),
    }),
    additional_fields: z.record(z.any()).optional(),
  }),
});

const createContactSchema = z.object({
  app_id: z.string().uuid(),
  payload: z.object({
    contact_name: z.string().trim().min(1),
    email: z.string().email().optional(),
    company_name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    contact_type: z.string().trim().default('customer'),
  }),
});

const createInvoiceSchema = z.object({
  app_id: z.string().uuid(),
  payload: z.record(z.any()),
});

const createTaskSchema = z.object({
  app_id: z.string().uuid(),
  portalId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  payload: z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    priority: z.string().trim().default('None'),
    end_date: z.string().trim().optional(),
  }),
});

interface ProjectContext {
  appName: string | null;
  appUrl: string | null;
  appDocsUrl: string | null;
  targetBaseUrl: string | null;
  notes: string | null;
}

interface ServiceConnection {
  connected: boolean;
  status: 'ready' | 'reconnect_required' | 'connect_required';
  source: 'service' | 'legacy' | 'studio' | 'none';
  dc: string | null;
  orgId: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastRefreshedAt: string | null;
}

interface AppContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: Record<string, any>;
  zoho_connected: boolean;
  zoho_dc: string | null;
  zoho_org_id: string | null;
  zoho_scopes: unknown;
  zoho_connected_at: string | null;
  zoho_last_refreshed_at: string | null;
  legacyConnection: ServiceConnection | null;
  serviceConnections: Record<ServiceId, ServiceConnection>;
}

interface LegacyTokenRow {
  app_id: string;
  customer_id: string | null;
  zoho_dc: string | null;
  zoho_org_id: string | null;
  scopes: unknown;
  connected_at: string | null;
  last_refreshed_at: string | null;
  is_valid: boolean;
}

interface ServiceTokenRow {
  app_id: string;
  service: ServiceId;
  zoho_dc: string | null;
  zoho_org_id: string | null;
  scopes: unknown;
  connected_at: string | null;
  last_refreshed_at: string | null;
  is_valid: boolean;
}

interface ApiEndpointReference {
  audience: 'platform' | 'zoho';
  method: string;
  path: string;
  purpose: string;
  requiredScopes?: string[];
  documentationUrl?: string;
  notes?: string;
}

interface DocumentationLink {
  label: string;
  url: string;
  source: 'platform' | 'zoho' | 'user-app';
}

interface ServiceAction {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  method: 'POST';
  available: boolean;
  reason?: string;
  bodyExample?: Record<string, any>;
}

interface ResourceSummary {
  type: string;
  name: string;
  id?: string;
  status?: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface ServiceDefinition {
  name: string;
  summary: string;
  capabilityLevel: 'managed' | 'guided' | 'discover';
  firstTier: boolean;
  ownership: 'studio-managed' | 'zoho-native' | 'hybrid';
  requiredScopePrefixes: string[];
  documentationLinks: Array<{ label: string; url: string; source: 'zoho' | 'platform' }>;
}

const DEFAULT_ROUTE_FIELDS: Record<RouteType, Array<{
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'date' | 'time' | 'number';
  required: boolean;
  zoho_field: string;
  options?: string[];
}>> = {
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
    { name: 'priority', label: 'Priority', type: 'select', required: false, zoho_field: 'priority', options: ['None', 'Low', 'Medium', 'High'] },
    { name: 'due_date', label: 'Due Date', type: 'date', required: false, zoho_field: 'end_date' },
  ],
};

const DEFAULT_TARGET_MODULE: Record<RouteType, string> = {
  crm: 'Leads',
  desk: 'Tickets',
  bookings: 'Appointments',
  books: 'Contacts',
  projects: 'Tasks',
};

const SERVICE_DEFINITIONS: Record<ServiceId, ServiceDefinition> = {
  crm: {
    name: 'CRM',
    summary: 'Inspect modules, layouts, fields, and source attribution, then create records or route starters.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: ['ZohoCRM.'],
    documentationLinks: [
      { label: 'CRM record insert API', url: 'https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html', source: 'zoho' },
      { label: 'CRM layouts metadata API', url: 'https://www.zoho.com/crm/developer/docs/api/v8/layouts-meta.html', source: 'zoho' },
      { label: 'CRM fields metadata API', url: 'https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html', source: 'zoho' },
      { label: 'Zoho Forms and CRM integration', url: 'https://help.zoho.com/portal/en/kb/crm/integrations/zoho/zoho-forms/articles/zoho-forms-crm-integration', source: 'zoho' },
    ],
  },
  forms: {
    name: 'Forms',
    summary: 'Manage generated routes, inspect saved starters, and augment native Zoho Forms setups from the studio.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: [],
    documentationLinks: [
      { label: 'Zoho Forms and CRM integration', url: 'https://help.zoho.com/portal/en/kb/crm/integrations/zoho/zoho-forms/articles/zoho-forms-crm-integration', source: 'zoho' },
      { label: 'Generated routes API', url: '/api/forms', source: 'platform' },
    ],
  },
  mail: {
    name: 'Mail',
    summary: 'Inspect connected mail accounts and generate prompts for downstream integration work.',
    capabilityLevel: 'discover',
    firstTier: false,
    ownership: 'zoho-native',
    requiredScopePrefixes: ['ZohoMail.'],
    documentationLinks: [
      { label: 'Mail accounts API', url: 'https://www.zoho.com/mail/help/api/get-all-user-accounts.html', source: 'zoho' },
    ],
  },
  salesiq: {
    name: 'SalesIQ',
    summary: 'Inspect widget readiness and generate a user-app-ready widget export.',
    capabilityLevel: 'guided',
    firstTier: false,
    ownership: 'hybrid',
    requiredScopePrefixes: ['SalesIQ.'],
    documentationLinks: [
      { label: 'SalesIQ developer section', url: 'https://www.zoho.com/salesiq/help/developer-section/', source: 'zoho' },
    ],
  },
  bookings: {
    name: 'Bookings',
    summary: 'Inspect services and staff when possible, then save route starters or create appointments.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: ['ZohoBookings.'],
    documentationLinks: [
      { label: 'Bookings API reference', url: 'https://www.zoho.com/bookings/help/api/v1/book-appointment.html', source: 'zoho' },
    ],
  },
  desk: {
    name: 'Desk',
    summary: 'Inspect departments and ticket fields, then save route starters or create tickets.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: ['Desk.'],
    documentationLinks: [
      { label: 'Desk API reference', url: 'https://desk.zoho.com/DeskAPIDocument', source: 'zoho' },
    ],
  },
  books: {
    name: 'Books',
    summary: 'Inspect contacts and invoice readiness, then save contact routes or generate Books prompts.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: ['ZohoBooks.'],
    documentationLinks: [
      { label: 'Books contacts API', url: 'https://www.zoho.com/books/api/v3/contacts/', source: 'zoho' },
      { label: 'Books invoices API', url: 'https://www.zoho.com/books/api/v3/invoices/', source: 'zoho' },
    ],
  },
  projects: {
    name: 'Projects',
    summary: 'Inspect portals and projects, then save task targets or create tasks directly.',
    capabilityLevel: 'managed',
    firstTier: true,
    ownership: 'hybrid',
    requiredScopePrefixes: ['ZohoProjects.'],
    documentationLinks: [
      { label: 'Projects tasks API', url: 'https://www.zoho.com/projects/help/rest-api/tasks-api.html', source: 'zoho' },
    ],
  },
};

export async function zohoCapabilitiesPlugin(app: FastifyInstance) {
  app.get('/api/zoho/account', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return {
      app: {
        id: context.id,
        name: context.name,
        slug: context.slug,
        domain: context.domain,
      },
      zoho: {
        connected: context.zoho_connected,
        dc: context.zoho_dc,
        org_id: context.zoho_org_id,
        connected_at: context.zoho_connected_at,
        last_refreshed_at: context.zoho_last_refreshed_at,
        scopes: normalizeScopes(context.zoho_scopes),
      },
      services: context.serviceConnections,
      dashboardLink: buildDashboardLink(context.id),
      projectContext: readProjectContext(context.settings),
      studio: {
        services: readStudioServiceConfigs(context.settings),
      },
    };
  });

  app.get('/api/zoho/services', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    const routeCounts = await loadRouteCounts(context.id);
    return {
      app_id,
      services: (ZOHO_STUDIO_SERVICES as readonly ServiceId[]).map((service) => buildServiceCard(context, service, routeCounts)),
    };
  });

  app.get('/api/zoho/services/:service/resources', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedService = serviceSchema.parse((request.params as { service: string }).service);
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return {
      service: parsedService,
      resources: await discoverResources(context, parsedService),
      savedConfig: readStudioServiceConfig(context.settings, parsedService),
    };
  });

  app.get('/api/zoho/services/:service/actions', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedService = serviceSchema.parse((request.params as { service: string }).service);
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return {
      service: parsedService,
      actions: buildActions(context, parsedService),
    };
  });

  app.get('/api/zoho/services/:service/references', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedService = serviceSchema.parse((request.params as { service: string }).service);
    const { app_id, goal, mode } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return buildReferencePayload(
      context,
      parsedService,
      goal || buildDefaultGoal(parsedService, mode || 'work-from-config'),
      mode || 'work-from-config',
    );
  });

  app.get('/api/project-context', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return {
      app_id: context.id,
      projectContext: readProjectContext(context.settings),
    };
  });

  app.post('/api/project-context', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = projectContextSchema.parse(request.body);
    const context = await loadAppContext((request as any).userId, body.app_id, reply);
    if (!context) return;
    return saveProjectContext(context, body);
  });

  app.put('/api/project-context', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = projectContextSchema.parse(request.body);
    const context = await loadAppContext((request as any).userId, body.app_id, reply);
    if (!context) return;
    return saveProjectContext(context, body);
  });

  app.post('/api/zoho/handoff-bundle', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = handoffSchema.parse(request.body);
    const context = await loadAppContext((request as any).userId, body.app_id, reply);
    if (!context) return;

    const payload = await buildReferencePayload(context, body.service, body.goal, body.mode);
    return {
      ...payload,
      action: body.action || null,
    };
  });

  app.post('/api/zoho/services/:service/actions/:action', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedService = serviceSchema.parse((request.params as { service: string }).service);
    const action = z.string().trim().min(1).parse((request.params as { action: string }).action);
    const body = (request.body || {}) as Record<string, any>;
    const appId = z.string().uuid().parse(body.app_id);
    const context = await loadAppContext((request as any).userId, appId, reply);
    if (!context) return;

    const connection = serviceConnectionFor(context, parsedService);
    if (!connection.connected && parsedService !== 'forms' && action !== 'create-route') {
      return reply.status(400).send({ error: 'Connect the selected Zoho service before running this action.' });
    }

    try {
      switch (`${parsedService}:${action}`) {
        case 'forms:create-route':
        case 'crm:create-route':
        case 'desk:create-route':
        case 'bookings:create-route':
        case 'books:create-route':
        case 'projects:create-route':
          return createGeneratedRoute(context, parsedService, body);
        case 'crm:add-lead-source':
          return addCrmLeadSource(context, body);
        case 'crm:create-record': {
          const parsed = createRecordSchema.parse(body);
          return crmApi.createRecord(context.id, parsed.module, parsed.payload);
        }
        case 'desk:create-ticket': {
          const parsed = createTicketSchema.parse(body);
          return deskApi.createTicket(context.id, parsed.payload);
        }
        case 'bookings:create-appointment': {
          const parsed = createAppointmentSchema.parse(body);
          return bookingsApi.createAppointment(context.id, parsed.payload);
        }
        case 'books:create-contact': {
          const parsed = createContactSchema.parse(body);
          return booksApi.createContact(context.id, parsed.payload);
        }
        case 'books:create-invoice': {
          const parsed = createInvoiceSchema.parse(body);
          return booksApi.createInvoice(context.id, parsed.payload);
        }
        case 'projects:create-task': {
          const parsed = createTaskSchema.parse(body);
          return projectsApi.createTask(context.id, parsed.portalId, parsed.projectId, parsed.payload);
        }
        case 'salesiq:generate-widget-export':
          return buildSalesIQExport(context);
        default:
          return reply.status(404).send({ error: `Unsupported action ${action} for ${parsedService}` });
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      if (error instanceof ZohoApiError) {
        return reply.status(error.httpStatus).send({
          error: error.message,
          code: error.code,
          response: error.responseBody,
        });
      }
      return reply.status(400).send({ error: error.message || 'Action failed' });
    }
  });
}

export async function loadAppContext(userId: string, appId: string, reply: FastifyReply): Promise<AppContext | null> {
  const appRecord = await queryOne<{
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    settings: Record<string, any> | null;
  }>(
    'SELECT id, name, slug, domain, settings FROM apps WHERE id = $1 AND user_id = $2',
    [appId, userId]
  );

  if (!appRecord) {
    reply.status(404).send({ error: 'App not found' });
    return null;
  }

  const legacyRow = await queryOne<LegacyTokenRow>(
    `SELECT app_id, customer_id, zoho_dc, zoho_org_id, scopes, connected_at, last_refreshed_at, is_valid
       FROM zoho_tokens
      WHERE (app_id = $1 OR customer_id = $1) AND is_valid = TRUE`,
    [appId]
  );

  const serviceRows = await query<ServiceTokenRow>(
    `SELECT app_id, service, zoho_dc, zoho_org_id, scopes, connected_at, last_refreshed_at, is_valid
       FROM zoho_service_tokens
      WHERE app_id = $1 AND is_valid = TRUE`,
    [appId]
  );

  const normalizedLegacyScopes = normalizeScopes(legacyRow?.scopes);
  const legacyConnection = legacyRow ? buildTokenConnection('legacy', legacyRow.zoho_dc, legacyRow.zoho_org_id, normalizedLegacyScopes, legacyRow.connected_at, legacyRow.last_refreshed_at, ['Zoho']) : null;

  const serviceRowMap = new Map<ServiceId, ServiceTokenRow>();
  for (const row of serviceRows) {
    serviceRowMap.set(row.service, row);
  }

  const serviceConnections = {} as Record<ServiceId, ServiceConnection>;
  for (const service of ZOHO_STUDIO_SERVICES as readonly ServiceId[]) {
    serviceConnections[service] = resolveServiceConnection(service, serviceRowMap.get(service) || null, legacyRow || null, normalizedLegacyScopes);
  }

  const primary = pickPrimaryConnection(serviceConnections, legacyConnection);

  return {
    id: appRecord.id,
    name: appRecord.name,
    slug: appRecord.slug,
    domain: appRecord.domain,
    settings: asObject(appRecord.settings),
    zoho_connected: Boolean(primary?.connected),
    zoho_dc: primary?.dc || null,
    zoho_org_id: primary?.orgId || null,
    zoho_scopes: primary?.scopes || normalizedLegacyScopes,
    zoho_connected_at: primary?.connectedAt || null,
    zoho_last_refreshed_at: primary?.lastRefreshedAt || null,
    legacyConnection,
    serviceConnections,
  };
}

function resolveServiceConnection(
  service: ServiceId,
  serviceRow: ServiceTokenRow | null,
  legacyRow: LegacyTokenRow | null,
  legacyScopes: string[],
): ServiceConnection {
  if (service === 'forms') {
    return {
      connected: true,
      status: 'ready',
      source: 'studio',
      dc: serviceRow?.zoho_dc || legacyRow?.zoho_dc || null,
      orgId: serviceRow?.zoho_org_id || legacyRow?.zoho_org_id || null,
      scopes: [],
      connectedAt: serviceRow?.connected_at || legacyRow?.connected_at || null,
      lastRefreshedAt: serviceRow?.last_refreshed_at || legacyRow?.last_refreshed_at || null,
    };
  }

  if (serviceRow) {
    const scopes = normalizeScopes(serviceRow.scopes);
    return buildTokenConnection(
      'service',
      serviceRow.zoho_dc,
      serviceRow.zoho_org_id,
      scopes,
      serviceRow.connected_at,
      serviceRow.last_refreshed_at,
      SERVICE_DEFINITIONS[service].requiredScopePrefixes,
    );
  }

  if (legacyRow && supportsService(legacyScopes, service)) {
    return buildTokenConnection(
      'legacy',
      legacyRow.zoho_dc,
      legacyRow.zoho_org_id,
      legacyScopes,
      legacyRow.connected_at,
      legacyRow.last_refreshed_at,
      SERVICE_DEFINITIONS[service].requiredScopePrefixes,
    );
  }

  return {
    connected: false,
    status: 'connect_required',
    source: 'none',
    dc: null,
    orgId: null,
    scopes: [],
    connectedAt: null,
    lastRefreshedAt: null,
  };
}

function buildTokenConnection(
  source: 'service' | 'legacy',
  dc: string | null,
  orgId: string | null,
  scopes: string[],
  connectedAt: string | null,
  lastRefreshedAt: string | null,
  requiredScopePrefixes: string[],
): ServiceConnection {
  const ready = hasRequiredScope(scopes, requiredScopePrefixes);
  return {
    connected: true,
    status: ready ? 'ready' : 'reconnect_required',
    source,
    dc,
    orgId,
    scopes,
    connectedAt,
    lastRefreshedAt,
  };
}

function pickPrimaryConnection(
  serviceConnections: Record<ServiceId, ServiceConnection>,
  legacyConnection: ServiceConnection | null,
): ServiceConnection | null {
  const preferredOrder: ServiceId[] = ['crm', 'desk', 'bookings', 'books', 'projects', 'salesiq', 'mail'];
  for (const service of preferredOrder) {
    const connection = serviceConnections[service];
    if (connection?.connected) return connection;
  }
  return legacyConnection;
}

function serviceConnectionFor(context: AppContext, service: ServiceId): ServiceConnection {
  return context.serviceConnections[service];
}

function asObject(value: any): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function normalizeScopes(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value));
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value));
    } catch {
      return raw.split(',').map((value) => value.trim()).filter(Boolean);
    }
  }
  return [];
}

function requiredPrefixesForService(service: ServiceId): string[] {
  const explicit = SERVICE_DEFINITIONS[service].requiredScopePrefixes;
  if (explicit.length > 0) return explicit;

  return (ZOHO_SERVICE_SCOPES[service] || [])
    .map((scope) => {
      const [prefix] = String(scope).split('.');
      return prefix ? `${prefix}.` : '';
    })
    .filter(Boolean);
}

function supportsService(scopes: string[], service: ServiceId): boolean {
  const prefixes = requiredPrefixesForService(service);
  if (prefixes.length === 0) return true;
  return hasRequiredScope(scopes, prefixes);
}

function hasRequiredScope(scopes: string[], prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => scopes.some((scope) => String(scope).startsWith(prefix)));
}

function readProjectContext(settings: Record<string, any>): ProjectContext {
  const value = asObject(settings.projectContext);
  return {
    appName: typeof value.appName === 'string' ? value.appName : null,
    appUrl: typeof value.appUrl === 'string' ? value.appUrl : null,
    appDocsUrl: typeof value.appDocsUrl === 'string' ? value.appDocsUrl : null,
    targetBaseUrl: typeof value.targetBaseUrl === 'string' ? value.targetBaseUrl : null,
    notes: typeof value.notes === 'string' ? value.notes : null,
  };
}

function readStudioServiceConfigs(settings: Record<string, any>): Record<string, any> {
  return asObject(asObject(asObject(settings.studio).services));
}

function readStudioServiceConfig(settings: Record<string, any>, service: ServiceId): Record<string, any> {
  return asObject(readStudioServiceConfigs(settings)[service]);
}

async function saveProjectContext(
  context: AppContext,
  payload: z.infer<typeof projectContextSchema>,
) {
  const settings = asObject(context.settings);
  settings.projectContext = {
    appName: payload.app_name,
    appUrl: payload.app_url,
    appDocsUrl: payload.app_docs_url,
    targetBaseUrl: payload.target_base_url,
    notes: payload.notes,
  };

  const [updated] = await query(
    'UPDATE apps SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING settings',
    [JSON.stringify(settings), context.id]
  );

  return {
    app_id: context.id,
    projectContext: readProjectContext(asObject(updated?.settings || settings)),
  };
}

async function saveStudioServiceConfig(context: AppContext, service: ServiceId, patch: Record<string, any>) {
  const settings = asObject(context.settings);
  const studio = asObject(settings.studio);
  const services = asObject(studio.services);
  const current = asObject(services[service]);

  services[service] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  studio.services = services;
  settings.studio = studio;

  const [updated] = await query(
    'UPDATE apps SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING settings',
    [JSON.stringify(settings), context.id]
  );

  context.settings = asObject(updated?.settings || settings);
  return readStudioServiceConfig(context.settings, service);
}

async function loadRouteCounts(appId: string): Promise<Record<string, number>> {
  const rows = await query<{ route_type: string; count: string }>(
    `SELECT route_type, COUNT(*)::text as count
       FROM form_configs
      WHERE app_id = $1
      GROUP BY route_type`,
    [appId]
  );

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.route_type || 'crm'] = Number(row.count || 0);
    return acc;
  }, {});
}

function buildDashboardLink(appId: string, service?: ServiceId): string {
  const url = new URL('/app', env.APP_URL);
  url.searchParams.set('appId', appId);
  if (service) url.searchParams.set('service', service);
  return url.toString();
}

function createRouteExample(routeType: RouteType, appId?: string) {
  return {
    app_id: appId || 'app-id',
    route_type: routeType,
    name: `${SERVICE_DEFINITIONS[routeType].name} route starter`,
    target_module: DEFAULT_TARGET_MODULE[routeType],
    lead_source: routeType === 'crm' ? 'Website A' : undefined,
    fields: DEFAULT_ROUTE_FIELDS[routeType],
    style: routeType === 'bookings'
      ? { service_id: 'service-id', staff_id: 'staff-id', timezone: 'UTC' }
      : routeType === 'projects'
        ? { portalId: 'portal-id', projectId: 'project-id', defaultPriority: 'Medium' }
        : routeType === 'crm'
          ? { layoutId: 'layout-1', layoutName: 'Standard', ownership: 'hybrid' }
          : {},
  };
}

function buildActions(context: AppContext, service: ServiceId): ServiceAction[] {
  const connection = serviceConnectionFor(context, service);
  const ready = connection.status === 'ready';
  const connectReason = `Connect ${SERVICE_DEFINITIONS[service].name} for this workspace first.`;
  const reconnectReason = `Reconnect ${SERVICE_DEFINITIONS[service].name} to grant the required scopes.`;
  const blockedReason = connection.connected ? reconnectReason : connectReason;

  switch (service) {
    case 'forms':
      return [
        {
          id: 'create-route',
          label: 'Create route starter',
          description: 'Create a generated route starter that can post into one of the supported Zoho services.',
          endpoint: '/api/zoho/services/forms/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('crm', context.id),
        },
      ];
    case 'crm':
      return [
        {
          id: 'create-route',
          label: 'Create CRM route',
          description: 'Create a CRM route starter with a fixed lead source and saved studio config.',
          endpoint: '/api/zoho/services/crm/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('crm', context.id),
        },
        {
          id: 'add-lead-source',
          label: 'Add lead source',
          description: 'Create a missing CRM Lead_Source picklist value from the studio.',
          endpoint: '/api/zoho/services/crm/actions/add-lead-source',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            module: 'Leads',
            display_value: 'Website A',
          },
        },
        {
          id: 'create-record',
          label: 'Create record',
          description: 'Create a live CRM record in the connected organization.',
          endpoint: '/api/zoho/services/crm/actions/create-record',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            module: 'Leads',
            payload: {
              Last_Name: 'Lovelace',
              Email: 'ada@example.com',
              Company: 'Analytical Engines',
              Lead_Source: 'Website A',
            },
          },
        },
      ];
    case 'desk':
      return [
        {
          id: 'create-route',
          label: 'Create Desk route',
          description: 'Create a support route starter that posts into Zoho Desk.',
          endpoint: '/api/zoho/services/desk/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('desk', context.id),
        },
        {
          id: 'create-ticket',
          label: 'Create ticket',
          description: 'Create a live Desk ticket using the connected workspace.',
          endpoint: '/api/zoho/services/desk/actions/create-ticket',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            payload: {
              subject: 'Need help with onboarding',
              email: 'support@example.com',
              description: 'Created from the Zoho studio.',
              priority: 'High',
            },
          },
        },
      ];
    case 'bookings':
      return [
        {
          id: 'create-route',
          label: 'Create Bookings route',
          description: 'Create an appointment route starter configured for a service and staff member.',
          endpoint: '/api/zoho/services/bookings/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('bookings', context.id),
        },
        {
          id: 'create-appointment',
          label: 'Create appointment',
          description: 'Create a live appointment using the connected Bookings account.',
          endpoint: '/api/zoho/services/bookings/actions/create-appointment',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            payload: {
              service_id: 'service-id',
              staff_id: 'staff-id',
              from_time: '2026-03-31',
              time_slot: '09:30',
              timezone: 'UTC',
              customer_details: {
                name: 'Ada Lovelace',
                email: 'ada@example.com',
              },
            },
          },
        },
      ];
    case 'books':
      return [
        {
          id: 'create-route',
          label: 'Create Books route',
          description: 'Create a Books contact route starter for the user app.',
          endpoint: '/api/zoho/services/books/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('books', context.id),
        },
        {
          id: 'create-contact',
          label: 'Create contact',
          description: 'Create a live Zoho Books contact.',
          endpoint: '/api/zoho/services/books/actions/create-contact',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            payload: {
              contact_name: 'Ada Lovelace',
              email: 'ada@example.com',
              company_name: 'Analytical Engines',
            },
          },
        },
        {
          id: 'create-invoice',
          label: 'Create invoice (beta)',
          description: 'Create an invoice using the connected Books account. Invoice-specific configuration is still beta.',
          endpoint: '/api/zoho/services/books/actions/create-invoice',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            payload: {
              customer_id: 'customer-id',
              line_items: [{ item_id: 'item-id', rate: 100, quantity: 1 }],
            },
          },
        },
      ];
    case 'projects':
      return [
        {
          id: 'create-route',
          label: 'Create Projects route',
          description: 'Create a Projects task route starter bound to a portal and project.',
          endpoint: '/api/zoho/services/projects/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('projects', context.id),
        },
        {
          id: 'create-task',
          label: 'Create task',
          description: 'Create a live Zoho Projects task.',
          endpoint: '/api/zoho/services/projects/actions/create-task',
          method: 'POST',
          available: ready,
          reason: blockedReason,
          bodyExample: {
            app_id: context.id,
            portalId: 'portal-id',
            projectId: 'project-id',
            payload: {
              name: 'Sync Zoho capability detail page',
              description: 'Create task directly from the assistant dashboard.',
              priority: 'Medium',
            },
          },
        },
      ];
    case 'salesiq':
      return [
        {
          id: 'generate-widget-export',
          label: 'Generate widget export',
          description: 'Return the SalesIQ widget export that can be embedded in the user app shell.',
          endpoint: '/api/zoho/services/salesiq/actions/generate-widget-export',
          method: 'POST',
          available: connection.connected,
          reason: connection.connected ? undefined : connectReason,
          bodyExample: { app_id: context.id },
        },
      ];
    case 'mail':
      return [];
  }
}

function buildServiceCard(
  context: AppContext,
  service: ServiceId,
  routeCounts: Record<string, number>,
) {
  const definition = SERVICE_DEFINITIONS[service];
  const connection = serviceConnectionFor(context, service);
  const routeCount = service === 'forms'
    ? Object.values(routeCounts).reduce((sum, value) => sum + value, 0)
    : routeCounts[service] || 0;

  return {
    id: service,
    name: definition.name,
    summary: definition.summary,
    firstTier: definition.firstTier,
    capabilityLevel: definition.capabilityLevel,
    ownership: definition.ownership,
    status: connection.status,
    zohoConnected: connection.connected,
    routeCount,
    routeSupport: routeCount > 0
      ? getToolSupportSummary(service === 'forms' ? 'crm' : service).status
      : 'ga',
    source: connection.source,
    dc: connection.dc,
    orgId: connection.orgId,
    scopes: connection.scopes,
    dashboardLink: buildDashboardLink(context.id, service),
    resourcesUrl: `/api/zoho/services/${service}/resources?app_id=${context.id}`,
    actionsUrl: `/api/zoho/services/${service}/actions?app_id=${context.id}`,
    referencesUrl: `/api/zoho/services/${service}/references?app_id=${context.id}`,
    reconnectReason: connection.status === 'reconnect_required'
      ? `Reconnect ${definition.name} to add the required scopes.`
      : null,
  };
}

export async function buildReferencePayload(
  context: AppContext,
  service: ServiceId,
  goal: string,
  mode: PromptMode = 'work-from-config',
) {
  const resources = await discoverResources(context, service);
  const actions = buildActions(context, service);
  const projectContext = readProjectContext(context.settings);
  const savedConfig = readStudioServiceConfig(context.settings, service);
  const dashboardLink = buildDashboardLink(context.id, service);
  const documentationLinks = buildDocumentationLinks(service, projectContext, dashboardLink);
  const apiEndpoints = [
    ...buildPlatformReferences(context.id, service, actions, mode),
    ...buildZohoReferences(service),
  ];

  return {
    service,
    serviceLabel: SERVICE_DEFINITIONS[service].name,
    goal,
    mode,
    savedConfig,
    prompt: buildHandoffPrompt(context, service, goal, mode, resources, actions, apiEndpoints, documentationLinks, projectContext, savedConfig),
    apiEndpoints,
    documentationLinks,
    dashboardLink,
    userAppLink: projectContext.appUrl,
    userAppDocsLink: projectContext.appDocsUrl,
    availableResources: resources,
    availableActions: actions,
  };
}

function buildDefaultGoal(service: ServiceId, mode: PromptMode): string {
  if (mode === 'augment-native') {
    return `Inspect the existing ${SERVICE_DEFINITIONS[service].name} setup and augment it without breaking native Zoho behavior.`;
  }
  if (mode === 'build-custom-route') {
    return `Build a new ${SERVICE_DEFINITIONS[service].name} route or embed surface for the user app.`;
  }
  return `Work from the saved ${SERVICE_DEFINITIONS[service].name} studio configuration and move the integration forward.`;
}

function buildPlatformReferences(appId: string, service: ServiceId, actions: ServiceAction[], mode: PromptMode): ApiEndpointReference[] {
  const references: ApiEndpointReference[] = [
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/account?app_id=${appId}`,
      purpose: 'Return service-aware Zoho connection state, primary connection metadata, saved project context, and per-service status.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/services?app_id=${appId}`,
      purpose: 'List discoverable Zoho services, capability level, route counts, ownership model, and reconnect state.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/auth/zoho/service?app_id=${appId}&service=${service}`,
      purpose: 'Generate a service-specific Zoho OAuth URL for the selected service.',
      notes: 'Use this instead of broad consent for new studio connections.',
    },
    {
      audience: 'platform',
      method: 'DELETE',
      path: `/api/auth/zoho/service?app_id=${appId}&service=${service}`,
      purpose: 'Disconnect the selected service-scoped Zoho token from the current workspace.',
      notes: 'Use when the saved service token needs to be reset or re-authorized.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/services/${service}/resources?app_id=${appId}`,
      purpose: 'Fetch existing resources, saved route starters, and discovery probes for the selected service.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/services/${service}/actions?app_id=${appId}`,
      purpose: 'Fetch supported managed actions and example payloads for the selected service.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/services/${service}/references?app_id=${appId}&mode=${mode}`,
      purpose: 'Generate the service-specific prompt, endpoint references, docs links, and app links for the selected mode.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'POST',
      path: '/api/zoho/handoff-bundle',
      purpose: 'Generate a structured handoff bundle for a specific service, goal, and prompt mode.',
      notes: 'Requires authenticated user session and body.app_id.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/apps/${appId}/prompt?service=${service}&mode=${mode}`,
      purpose: 'Generate a markdown prompt grounded in the live account state, saved config, and selected prompt mode.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/project-context?app_id=${appId}`,
      purpose: 'Read the saved user app context attached to the current workspace.',
      notes: 'Requires authenticated user session.',
    },
    {
      audience: 'platform',
      method: 'PUT',
      path: '/api/project-context',
      purpose: 'Save the user app name, app URL, docs URL, target base URL, and notes for the current workspace.',
      notes: 'Requires authenticated user session and body.app_id.',
    },
  ];

  for (const action of actions) {
    references.push({
      audience: 'platform',
      method: action.method,
      path: action.endpoint,
      purpose: action.description,
      notes: action.available ? 'Available for the current connection state.' : `Blocked until ${action.reason || 'the service is connected.'}`,
    });
  }

  return references;
}

function buildZohoReferences(service: ServiceId): ApiEndpointReference[] {
  switch (service) {
    case 'crm':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/org',
          purpose: 'Read CRM organization metadata for the connected account.',
          requiredScopes: ['ZohoCRM.org.READ'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/get-org-data.html',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/settings/modules',
          purpose: 'List CRM modules available to the connected account.',
          requiredScopes: ['ZohoCRM.settings.ALL'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/modules-api.html',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/settings/layouts?module={module}',
          purpose: 'Read CRM layouts for the selected module.',
          requiredScopes: ['ZohoCRM.settings.layouts.ALL'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/layouts-meta.html',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/settings/fields?module={module}',
          purpose: 'Read CRM field metadata and Lead_Source picklist values for the selected module.',
          requiredScopes: ['ZohoCRM.settings.fields.ALL'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/crm/v6/{module}',
          purpose: 'Create CRM records in the selected module.',
          requiredScopes: ['ZohoCRM.modules.ALL'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html',
        },
      ];
    case 'forms':
      return [];
    case 'mail':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/api/accounts',
          purpose: 'List mail accounts or organizations visible to the connected user.',
          requiredScopes: ['ZohoMail.accounts.ALL'],
          documentationUrl: 'https://www.zoho.com/mail/help/api/get-all-user-accounts.html',
        },
      ];
    case 'salesiq':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: 'https://salesiq.zoho.com/widget',
          purpose: 'Embed the SalesIQ widget using the configured widget code.',
          documentationUrl: 'https://www.zoho.com/salesiq/help/developer-section/web-sdk-installation-2.0.html',
        },
      ];
    case 'bookings':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/bookings/v1/json/availableslots',
          purpose: 'Fetch booking services, staff, and slot availability when exposed by the current Bookings account.',
          requiredScopes: ['ZohoBookings.data.ALL'],
          documentationUrl: 'https://www.zoho.com/bookings/help/api/v1/get-available-slots.html',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/bookings/v1/json/appointment',
          purpose: 'Create an appointment using the connected Bookings account.',
          requiredScopes: ['ZohoBookings.data.ALL'],
          documentationUrl: 'https://www.zoho.com/bookings/help/api/v1/book-appointment.html',
        },
      ];
    case 'desk':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/api/v1/departments',
          purpose: 'List Zoho Desk departments for the connected account.',
          requiredScopes: ['Desk.basic.ALL'],
          documentationUrl: 'https://desk.zoho.com/DeskAPIDocument#Departments#Departments_ListallDepartments',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/api/v1/ticketFields',
          purpose: 'List Zoho Desk ticket fields for the connected account.',
          requiredScopes: ['Desk.settings.ALL'],
          documentationUrl: 'https://desk.zoho.com/DeskAPIDocument#Settings#TicketField',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/api/v1/tickets',
          purpose: 'Create a Zoho Desk ticket.',
          requiredScopes: ['Desk.tickets.ALL'],
          documentationUrl: 'https://desk.zoho.com/DeskAPIDocument#Tickets#Tickets_Createaticket',
        },
      ];
    case 'books':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/books/v3/contacts',
          purpose: 'List contacts from the connected Zoho Books organization.',
          requiredScopes: ['ZohoBooks.contacts.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/contacts/#list-contacts',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/books/v3/items',
          purpose: 'List items to determine invoice readiness and available line item targets.',
          requiredScopes: ['ZohoBooks.settings.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/items/',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/books/v3/contacts',
          purpose: 'Create a contact in Zoho Books.',
          requiredScopes: ['ZohoBooks.contacts.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/contacts/#create-a-contact',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/books/v3/invoices',
          purpose: 'Create an invoice in Zoho Books.',
          requiredScopes: ['ZohoBooks.invoices.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/invoices/#create-an-invoice',
        },
      ];
    case 'projects':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/restapi/portals/',
          purpose: 'List portals available to the connected Zoho Projects account.',
          requiredScopes: ['ZohoProjects.portals.ALL'],
          documentationUrl: 'https://www.zoho.com/projects/help/rest-api/portals-api.html',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/restapi/portal/{portalId}/projects/',
          purpose: 'List projects inside a portal so the studio can target task creation.',
          requiredScopes: ['ZohoProjects.projects.ALL'],
          documentationUrl: 'https://www.zoho.com/projects/help/rest-api/projects-api.html',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/restapi/portal/{portalId}/projects/{projectId}/tasks/',
          purpose: 'Create a task in a specific Zoho Projects project.',
          requiredScopes: ['ZohoProjects.tasks.ALL'],
          documentationUrl: 'https://www.zoho.com/projects/help/rest-api/tasks-api.html',
        },
      ];
  }
}

function buildDocumentationLinks(service: ServiceId, projectContext: ProjectContext, dashboardLink: string): DocumentationLink[] {
  const docs: DocumentationLink[] = SERVICE_DEFINITIONS[service].documentationLinks.map((entry) => ({
    label: entry.label,
    url: entry.source === 'platform' && entry.url.startsWith('/')
      ? new URL(entry.url, env.APP_URL).toString()
      : entry.url,
    source: entry.source,
  }));

  docs.unshift({ label: 'Open this workspace view', url: dashboardLink, source: 'platform' });
  if (projectContext.appDocsUrl) {
    docs.push({ label: 'User app documentation', url: projectContext.appDocsUrl, source: 'user-app' });
  }
  return docs;
}

function buildModeGuidance(mode: PromptMode, service: ServiceId): string[] {
  switch (mode) {
    case 'build-custom-route':
      return [
        `Build a new ${SERVICE_DEFINITIONS[service].name} route or embed surface from the studio-managed endpoints.`,
        'Prefer the platform route/export surface when the studio already models the workflow.',
      ];
    case 'augment-native':
      return [
        'Preserve any native Zoho setup that already exists.',
        'Use the discovered resources to augment the current configuration instead of replacing it.',
      ];
    case 'work-from-config':
      return [
        'Start from the saved studio configuration and generated routes first.',
        'Only introduce new Zoho-side configuration when the saved config is missing a required target.',
      ];
  }
}

function buildHandoffPrompt(
  context: AppContext,
  service: ServiceId,
  goal: string,
  mode: PromptMode,
  resources: ResourceSummary[],
  actions: ServiceAction[],
  endpoints: ApiEndpointReference[],
  docs: DocumentationLink[],
  projectContext: ProjectContext,
  savedConfig: Record<string, any>,
): string {
  const definition = SERVICE_DEFINITIONS[service];
  const connection = serviceConnectionFor(context, service);
  const resourceLines = resources.length > 0
    ? resources.map((resource) => `- [${resource.type}] ${resource.name}${resource.description ? `: ${resource.description}` : ''}`)
    : ['- No live resources were discovered yet. Treat this as an empty or partially configured service.'];
  const actionLines = actions.length > 0
    ? actions.map((action) => `- ${action.label}: ${action.available ? 'available' : `blocked (${action.reason})`} via ${action.endpoint}`)
    : ['- No managed actions are currently wired for this service. Use the references and docs below.'];
  const endpointLines = endpoints.map((endpoint) => {
    const docsSuffix = endpoint.documentationUrl ? ` (docs: ${endpoint.documentationUrl})` : '';
    return `- [${endpoint.audience}] ${endpoint.method} ${endpoint.path} - ${endpoint.purpose}${docsSuffix}`;
  });
  const docLines = docs.map((doc) => `- ${doc.label}: ${doc.url}`);
  const projectLines = [
    `- Project name: ${projectContext.appName || context.name}`,
    `- Project URL: ${projectContext.appUrl || 'not provided'}`,
    `- Project docs: ${projectContext.appDocsUrl || 'not provided'}`,
    `- Target base URL: ${projectContext.targetBaseUrl || 'not provided'}`,
    `- Notes: ${projectContext.notes || 'not provided'}`,
  ];
  const savedConfigLines = Object.keys(savedConfig).length > 0
    ? Object.entries(savedConfig).map(([key, value]) => `- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    : ['- No saved studio configuration for this service yet.'];
  const modeLines = buildModeGuidance(mode, service).map((line) => `- ${line}`);

  return [
    `# ${projectContext.appName || context.name} - ${definition.name} studio handoff`,
    '',
    `Selected service: ${definition.name}`,
    `Prompt mode: ${mode}`,
    '',
    '## Goal',
    '',
    goal,
    '',
    '## Mode Guidance',
    '',
    ...modeLines,
    '',
    '## Connected Zoho Workspace',
    '',
    `- Connected: ${connection.connected ? 'yes' : 'no'}`,
    `- Status: ${connection.status}`,
    `- Connection source: ${connection.source}`,
    `- Datacenter: ${connection.dc || 'unknown'}`,
    `- Organization ID: ${connection.orgId || 'unknown'}`,
    `- OAuth scopes: ${connection.scopes.length > 0 ? connection.scopes.join(', ') : 'none detected'}`,
    '',
    '## User App Context',
    '',
    ...projectLines,
    '',
    '## Saved Studio Config',
    '',
    ...savedConfigLines,
    '',
    `## Discovered ${definition.name} Resources`,
    '',
    ...resourceLines,
    '',
    '## Available Managed Actions',
    '',
    ...actionLines,
    '',
    '## Relevant API Endpoints',
    '',
    ...endpointLines,
    '',
    '## Documentation Links',
    '',
    ...docLines,
    '',
    '## Delivery Rules',
    '',
    '- Keep the implementation white-label to the user app and avoid introducing 1ClickSync branding in shipped UI copy.',
    '- Prefer the listed platform endpoints when the studio already manages the workflow or saved config.',
    '- Use the listed Zoho endpoints when the user app must integrate directly with the connected account.',
    '- If a scope is missing, surface a reconnect step instead of failing silently.',
    '- Preserve route payload shape and field mapping when adapting generated exports to another framework.',
    '',
  ].join('\n');
}

async function discoverResources(context: AppContext, service: ServiceId): Promise<ResourceSummary[]> {
  const resources: ResourceSummary[] = [];
  const routeRows = await query<{
    id: string;
    name: string;
    route_type: string;
    target_module: string;
    lead_source: string | null;
    is_active: boolean;
    created_at: string;
    style_config: Record<string, any> | null;
  }>(
    `SELECT id, name, route_type, target_module, lead_source, is_active, created_at, style_config
       FROM form_configs
      WHERE app_id = $1
      ORDER BY created_at DESC
      LIMIT 20`,
    [context.id]
  );

  const routeResources = routeRows
    .filter((row) => service === 'forms' || row.route_type === service)
    .map<ResourceSummary>((row) => ({
      type: 'route',
      id: row.id,
      name: row.name,
      status: row.is_active ? 'active' : 'inactive',
      description: `${String(row.route_type || '').toUpperCase()} -> ${row.target_module}${row.lead_source ? ` (Lead source: ${row.lead_source})` : ''}`,
      metadata: {
        created_at: row.created_at,
        configHome: asObject(row.style_config).configHome || 'studio',
      },
    }));

  if (routeResources.length > 0) {
    resources.push(...routeResources);
  }

  if (service === 'forms') {
    resources.unshift({
      type: 'summary',
      name: 'Generated route workspace',
      description: `${routeResources.length} route starter(s) already configured for this app.`,
      metadata: {
        ownership: 'hybrid',
      },
    });
    return resources;
  }

  const connection = serviceConnectionFor(context, service);
  if (!connection.connected) {
    resources.unshift({
      type: 'connection',
      name: `${SERVICE_DEFINITIONS[service].name} connection required`,
      status: 'connect_required',
      description: 'Connect this Zoho service to fetch live account data and manage resources from the studio.',
    });
    return resources;
  }

  switch (service) {
    case 'crm': {
      const targetModule = readStudioServiceConfig(context.settings, 'crm').targetModule || 'Leads';
      const [orgProbe, modulesProbe, layoutsProbe, fieldsProbe] = await Promise.all([
        safeProbe(async () => crmApi.getOrg(context.id)),
        safeProbe(async () => crmApi.getModules(context.id)),
        safeProbe(async () => crmApi.getLayouts(context.id, targetModule)),
        safeProbe(async () => crmApi.getFields(context.id, targetModule)),
      ]);

      const org = pickFirstObject(orgProbe.value?.org, orgProbe.value?.data);
      if (org) {
        resources.unshift({
          type: 'organization',
          name: org.company_name || org.companyName || context.name,
          description: `Connected CRM org ${org.id || connection.orgId || ''}`.trim(),
        });
      }

      const modules = pickFirstArray(modulesProbe.value?.modules, modulesProbe.value?.data);
      for (const module of modules.slice(0, 12)) {
        resources.push({
          type: 'module',
          id: module.id,
          name: module.api_name || module.module_name || module.plural_label || 'CRM module',
          description: module.plural_label || module.singular_label || 'Available module',
        });
      }

      const layouts = pickFirstArray(layoutsProbe.value?.layouts, layoutsProbe.value?.data);
      for (const layout of layouts.slice(0, 12)) {
        resources.push({
          type: 'layout',
          id: layout.id,
          name: layout.name || layout.display_name || `Layout ${layout.id}`,
          description: `Module ${targetModule}`,
        });
      }

      const fields = pickFirstArray(fieldsProbe.value?.fields, fieldsProbe.value?.data);
      for (const field of fields.slice(0, 16)) {
        resources.push({
          type: 'field',
          id: field.id,
          name: field.api_name || field.display_label || 'Field',
          description: field.display_label || field.data_type || `Module ${targetModule}`,
        });
      }

      const leadSourceField = fields.find((field: any) => field.api_name === 'Lead_Source');
      const leadSources = Array.isArray(leadSourceField?.pick_list_values) ? leadSourceField.pick_list_values : [];
      for (const value of leadSources) {
        if (value.type && value.type !== 'used') continue;
        resources.push({
          type: 'lead_source',
          id: value.id,
          name: value.display_value || value.actual_value || 'Lead Source',
          description: `Module ${targetModule}`,
          metadata: {
            module: targetModule,
            field_id: leadSourceField?.id,
            actual_value: value.actual_value || value.display_value,
          },
        });
      }

      if (modules.length === 0 && modulesProbe.error) {
        resources.push({ type: 'probe', name: 'CRM modules unavailable', status: 'warning', description: modulesProbe.error });
      }
      if (layouts.length === 0 && layoutsProbe.error) {
        resources.push({ type: 'probe', name: 'CRM layouts unavailable', status: 'warning', description: layoutsProbe.error });
      }
      if (fields.length === 0 && fieldsProbe.error) {
        resources.push({ type: 'probe', name: 'CRM fields unavailable', status: 'warning', description: fieldsProbe.error });
      }
      if (!leadSourceField) {
        resources.push({
          type: 'probe',
          name: 'Lead source field missing',
          status: 'warning',
          description: `Lead_Source was not found on the ${targetModule} module.`,
        });
      }
      return resources;
    }
    case 'desk': {
      const [departmentsProbe, fieldsProbe] = await Promise.all([
        safeProbe(async () => deskApi.getDepartments(context.id)),
        safeProbe(async () => deskApi.getTicketFields(context.id)),
      ]);
      const departments = pickFirstArray(departmentsProbe.value?.data, departmentsProbe.value?.departments);
      const ticketFields = pickFirstArray(fieldsProbe.value?.data, fieldsProbe.value?.fields);

      for (const department of departments.slice(0, 10)) {
        resources.push({
          type: 'department',
          id: department.id,
          name: department.name || department.departmentName || 'Desk department',
          description: department.id ? `Department ${department.id}` : 'Connected department',
        });
      }
      for (const field of ticketFields.slice(0, 16)) {
        resources.push({
          type: 'ticket_field',
          id: field.id,
          name: field.displayLabel || field.apiName || field.name || 'Ticket field',
          description: field.dataType || field.type || 'Desk field',
        });
      }
      if (departments.length === 0 && departmentsProbe.error) {
        resources.push({ type: 'probe', name: 'Desk departments unavailable', status: 'warning', description: departmentsProbe.error });
      }
      if (ticketFields.length === 0 && fieldsProbe.error) {
        resources.push({ type: 'probe', name: 'Desk fields unavailable', status: 'warning', description: fieldsProbe.error });
      }
      return resources;
    }
    case 'bookings': {
      const servicesProbe = await safeProbe(async () => bookingsApi.getServices(context.id));
      const services = pickFirstArray(servicesProbe.value?.services, servicesProbe.value?.data, servicesProbe.value?.service);
      const staff = pickFirstArray(servicesProbe.value?.staff, servicesProbe.value?.staff_members);

      for (const item of services.slice(0, 10)) {
        resources.push({
          type: 'service',
          id: item.service_id || item.serviceId,
          name: item.name || item.service_name || item.serviceId || 'Booking service',
          description: item.staff_name || item.description || 'Available Bookings service',
        });
      }
      for (const member of staff.slice(0, 10)) {
        resources.push({
          type: 'staff',
          id: member.staff_id || member.id,
          name: member.name || member.staff_name || 'Staff member',
          description: member.email || 'Available staff target',
        });
      }
      if (services.length === 0 && staff.length === 0) {
        resources.push({
          type: 'capability',
          name: 'Manual IDs required',
          status: servicesProbe.error ? 'warning' : 'info',
          description: servicesProbe.error || 'Save service_id and staff_id manually when the Bookings account does not expose discovery endpoints.',
        });
      }
      return resources;
    }
    case 'books': {
      const [contactsProbe, itemsProbe] = await Promise.all([
        safeProbe(async () => booksApi.getContacts(context.id)),
        safeProbe(async () => booksApi.getItems(context.id)),
      ]);
      const contacts = pickFirstArray(contactsProbe.value?.contacts, contactsProbe.value?.data);
      const items = pickFirstArray(itemsProbe.value?.items, itemsProbe.value?.data);

      for (const contact of contacts.slice(0, 12)) {
        resources.push({
          type: 'contact',
          id: contact.contact_id || contact.id,
          name: contact.contact_name || contact.customer_name || contact.name || 'Books contact',
          description: contact.email || 'Connected Books contact',
        });
      }

      resources.unshift({
        type: 'capability',
        name: 'Invoice exports beta',
        status: items.length > 0 ? 'ready' : 'info',
        description: items.length > 0
          ? `Detected ${items.length} item(s); invoice creation is possible but still treated as beta in the studio.`
          : 'No invoice items were discovered. Manual item IDs may still be required.',
      });

      if (contacts.length === 0 && contactsProbe.error) {
        resources.push({ type: 'probe', name: 'Books contacts unavailable', status: 'warning', description: contactsProbe.error });
      }
      if (items.length === 0 && itemsProbe.error) {
        resources.push({ type: 'probe', name: 'Books items unavailable', status: 'warning', description: itemsProbe.error });
      }
      return resources;
    }
    case 'projects': {
      const portalsProbe = await safeProbe(async () => projectsApi.getPortals(context.id));
      const portals = pickFirstArray(portalsProbe.value?.portals, portalsProbe.value?.data, portalsProbe.value?.portals?.portal);

      for (const portal of portals.slice(0, 10)) {
        resources.push({
          type: 'portal',
          id: portal.id,
          name: portal.name || portal.portal_name || portal.id || 'Projects portal',
          description: portal.id ? `Portal ${portal.id}` : 'Connected portal',
        });
      }

      const firstPortalId = portals[0]?.id;
      if (firstPortalId) {
        const projectsProbe = await safeProbe(async () => projectsApi.getProjects(context.id, firstPortalId));
        const projects = pickFirstArray(projectsProbe.value?.projects, projectsProbe.value?.data);
        for (const project of projects.slice(0, 12)) {
          resources.push({
            type: 'project',
            id: project.id,
            name: project.name || project.project_name || project.id || 'Projects project',
            description: `Portal ${firstPortalId}`,
          });
        }
        const firstProjectId = projects[0]?.id;
        if (firstProjectId) {
          resources.push({
            type: 'task_target',
            name: `${projects[0]?.name || firstProjectId} task target`,
            description: `Portal ${firstPortalId}, project ${firstProjectId}`,
            metadata: {
              portalId: firstPortalId,
              projectId: firstProjectId,
            },
          });
        }
        if (projects.length === 0 && projectsProbe.error) {
          resources.push({ type: 'probe', name: 'Projects unavailable', status: 'warning', description: projectsProbe.error });
        }
      } else if (portalsProbe.error) {
        resources.push({ type: 'probe', name: 'Projects portals unavailable', status: 'warning', description: portalsProbe.error });
      }

      return resources;
    }
    case 'salesiq': {
      const widgetCode = typeof context.settings.salesiq_widget_code === 'string' ? context.settings.salesiq_widget_code : '';
      resources.unshift({
        type: 'widget',
        name: widgetCode ? 'Widget code configured' : 'Widget export ready',
        description: widgetCode
          ? 'A SalesIQ widget code is stored in app settings.'
          : 'Use the action panel to generate the current SalesIQ widget export.',
      });
      return resources;
    }
    case 'mail': {
      const accountsProbe = await safeProbe(async () => zohoApi({ appId: context.id, app: 'mail', path: '/api/accounts' }));
      const accounts = pickFirstArray(accountsProbe.value?.data, accountsProbe.value?.accounts, accountsProbe.value?.account);
      for (const account of accounts.slice(0, 12)) {
        resources.push({
          type: 'account',
          name: account.displayName || account.primaryEmailAddress || account.mailboxAddress || account.emailAddress || 'Mail account',
          description: account.accountId ? `Account ${account.accountId}` : 'Connected mail account',
        });
      }
      if (accounts.length === 0) {
        resources.push({
          type: 'probe',
          name: accountsProbe.error ? 'Mail discovery needs reconnect' : 'No mail accounts discovered',
          status: accountsProbe.error ? 'warning' : 'info',
          description: accountsProbe.error || 'The connected workspace did not return mail accounts for the current scopes.',
        });
      }
      return resources;
    }
  }
}

async function addCrmLeadSource(context: AppContext, rawBody: Record<string, any>) {
  const parsed = createLeadSourceSchema.parse(rawBody);
  const fieldsResult = await crmApi.getFields(context.id, parsed.module);
  const fields = pickFirstArray(fieldsResult.fields, fieldsResult.data);
  const leadSourceField = fields.find((field: any) => field.api_name === 'Lead_Source');

  if (!leadSourceField && !parsed.field_id) {
    throw new Error(`Lead_Source field not found in ${parsed.module}.`);
  }

  const fieldId = parsed.field_id || leadSourceField.id;
  await crmApi.updateField(context.id, parsed.module, fieldId, {
    pick_list_values: [{ display_value: parsed.display_value }],
  });

  await saveStudioServiceConfig(context, 'crm', {
    targetModule: parsed.module,
    leadSource: parsed.display_value,
    leadSourceFieldId: fieldId,
    ownership: 'hybrid',
    configHome: 'studio',
  });

  return {
    success: true,
    module: parsed.module,
    field_id: fieldId,
    display_value: parsed.display_value,
  };
}

async function createGeneratedRoute(context: AppContext, service: ServiceId, rawBody: Record<string, any>) {
  const parsed = createRouteActionSchema.parse(rawBody);
  const routeType = routeTypeSchema.parse(service === 'forms' ? (parsed.route_type || 'crm') : service);
  const fields = parsed.fields || DEFAULT_ROUTE_FIELDS[routeType];
  const fieldMapping: Record<string, string> = {};

  for (const field of fields) {
    fieldMapping[field.name] = field.zoho_field;
  }

  const style = {
    ...(parsed.style || {}),
    fields,
    configHome: 'studio',
    ownership: routeType === 'crm' ? 'hybrid' : 'studio-managed',
    promptDefaults: {
      service: routeType,
      mode: routeType === 'crm' ? 'augment-native' : 'work-from-config',
    },
  } as Record<string, any>;

  if (routeType === 'bookings' && (!style.service_id || !style.staff_id)) {
    throw new Error('Bookings routes require style.service_id and style.staff_id.');
  }
  if (routeType === 'projects' && (!style.portalId || !style.projectId)) {
    throw new Error('Projects routes require style.portalId and style.projectId.');
  }

  const formKey = randomBytes(16).toString('hex');
  const name = parsed.name || `${SERVICE_DEFINITIONS[routeType].name} route starter`;
  const targetModule = parsed.target_module || DEFAULT_TARGET_MODULE[routeType];
  const [created] = await query<{
    id: string;
    form_key: string;
    route_type: string;
    name: string;
    lead_source: string | null;
  }>(
    `INSERT INTO form_configs
       (app_id, customer_id, user_id, form_key, name, target_module, route_type, field_mapping, style_config, lead_source)
     VALUES ($1, $1, (SELECT user_id FROM apps WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, form_key, route_type, name, lead_source`,
    [
      context.id,
      formKey,
      name,
      targetModule,
      routeType,
      JSON.stringify(fieldMapping),
      JSON.stringify(style),
      parsed.lead_source || null,
    ]
  );

  await saveStudioServiceConfig(context, routeType, {
    targetModule,
    leadSource: parsed.lead_source || null,
    layoutId: style.layoutId || null,
    layoutName: style.layoutName || null,
    fieldMapping,
    ownership: style.ownership,
    configHome: style.configHome,
    promptDefaults: style.promptDefaults,
  });

  const defaultMode = routeType === 'crm' ? 'augment-native' : 'work-from-config';

  return {
    success: true,
    form_id: created.id,
    form_key: created.form_key,
    route_type: created.route_type,
    name: created.name,
    submit_url: `${env.APP_URL}/api/f/${created.form_key}`,
    export_url: `${env.APP_URL}/api/apps/${context.id}/exports/${created.id}?target=html-js`,
    prompt_url: `${env.APP_URL}/api/apps/${context.id}/prompt?service=${routeType}&mode=${defaultMode}`,
  };
}

async function safeProbe<T>(fn: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (error: any) {
    return { value: null, error: error.message || 'Probe failed' };
  }
}

function pickFirstArray(...candidates: any[]): any[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickFirstObject(...candidates: any[]): any | null {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate[0];
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}
