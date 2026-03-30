import { randomBytes } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth';
import { env } from '../config';
import { query, queryOne } from '../db';
import { buildSalesIQExport, getToolSupportSummary } from './export-utils';
import { ZohoApiError, booksApi, bookingsApi, crmApi, deskApi, projectsApi, zohoApi } from '../zoho/client';

const serviceSchema = z.enum(['crm', 'forms', 'mail', 'salesiq', 'bookings', 'desk', 'books', 'projects']);
type ServiceId = z.infer<typeof serviceSchema>;

const routeTypeSchema = z.enum(['crm', 'desk', 'bookings', 'books', 'projects']);
type RouteType = z.infer<typeof routeTypeSchema>;

const appQuerySchema = z.object({
  app_id: z.string().uuid(),
  goal: z.string().trim().max(1000).optional(),
});

const projectContextSchema = z.object({
  app_id: z.string().uuid(),
  app_name: z.string().trim().max(255).optional().nullable(),
  app_url: z.string().trim().url().optional().nullable(),
  app_docs_url: z.string().trim().url().optional().nullable(),
  target_base_url: z.string().trim().url().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const handoffSchema = z.object({
  app_id: z.string().uuid(),
  service: serviceSchema,
  goal: z.string().trim().min(1).max(1000).default('Build the next step for this connected Zoho capability.'),
  action: z.string().trim().max(100).optional(),
});

const routeFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'date', 'time', 'number']),
  required: z.boolean().optional(),
  zoho_field: z.string(),
  options: z.array(z.string()).optional(),
});

const createRouteActionSchema = z.object({
  app_id: z.string().uuid(),
  route_type: routeTypeSchema.optional(),
  name: z.string().trim().min(1).max(255).optional(),
  target_module: z.string().trim().min(1).max(100).optional(),
  lead_source: z.string().trim().max(255).optional().nullable(),
  fields: z.array(routeFieldSchema).optional(),
  style: z.record(z.any()).optional(),
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

interface AppContext {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  settings: Record<string, any>;
  zoho_connected: boolean;
  zoho_dc: string | null;
  zoho_org_id: string | null;
  zoho_scopes: any;
  zoho_connected_at: string | null;
  zoho_last_refreshed_at: string | null;
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
  count?: number;
  metadata?: Record<string, any>;
}

const DEFAULT_ROUTE_FIELDS: Record<RouteType, Array<{ name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'date' | 'time' | 'number'; required: boolean; zoho_field: string; options?: string[] }>> = {
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

const SERVICE_DEFINITIONS: Record<ServiceId, {
  name: string;
  summary: string;
  capabilityLevel: 'managed' | 'guided' | 'discover';
  firstTier: boolean;
  requiredScopePrefixes: string[];
  documentationLinks: Array<{ label: string; url: string; source: 'zoho' | 'platform' }>;
}> = {
  crm: {
    name: 'CRM',
    summary: 'Inspect modules, fields, and organization state, then create records or generated routes.',
    capabilityLevel: 'managed',
    firstTier: true,
    requiredScopePrefixes: ['ZohoCRM.'],
    documentationLinks: [
      { label: 'CRM modules and fields', url: 'https://www.zoho.com/developer/help/api/modules-fields.html', source: 'zoho' },
      { label: 'CRM records API', url: 'https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html', source: 'zoho' },
    ],
  },
  forms: {
    name: 'Forms',
    summary: 'Create and manage generated route starters that connect your app to Zoho-backed workflows.',
    capabilityLevel: 'managed',
    firstTier: true,
    requiredScopePrefixes: [],
    documentationLinks: [
      { label: 'Create generated routes', url: '/api/forms', source: 'platform' },
      { label: 'Route presets', url: '/api/forms/presets/Leads?route_type=crm', source: 'platform' },
    ],
  },
  mail: {
    name: 'Mail',
    summary: 'Inspect available mail accounts and use the handoff bundle to wire setup into your app.',
    capabilityLevel: 'discover',
    firstTier: true,
    requiredScopePrefixes: ['ZohoMail.'],
    documentationLinks: [
      { label: 'Mail accounts API', url: 'https://www.zoho.com/mail/help/api/get-all-user-accounts.html', source: 'zoho' },
    ],
  },
  salesiq: {
    name: 'SalesIQ',
    summary: 'Use the connected workspace to discover widget readiness and generate an embeddable widget export.',
    capabilityLevel: 'guided',
    firstTier: true,
    requiredScopePrefixes: ['SalesIQ.'],
    documentationLinks: [
      { label: 'SalesIQ developer section', url: 'https://www.zoho.com/salesiq/help/developer-section/', source: 'zoho' },
    ],
  },
  bookings: {
    name: 'Bookings',
    summary: 'Inspect booking setup requirements, create route starters, and create appointments.',
    capabilityLevel: 'managed',
    firstTier: true,
    requiredScopePrefixes: ['ZohoBookings.'],
    documentationLinks: [
      { label: 'Bookings appointment API', url: 'https://www.zoho.com/bookings/help/api/v1/book-appointment.html', source: 'zoho' },
    ],
  },
  desk: {
    name: 'Desk',
    summary: 'Discover support configuration, departments, and route/ticket actions for service workflows.',
    capabilityLevel: 'managed',
    firstTier: false,
    requiredScopePrefixes: ['Desk.'],
    documentationLinks: [
      { label: 'Desk API reference', url: 'https://desk.zoho.com/DeskAPIDocument', source: 'zoho' },
    ],
  },
  books: {
    name: 'Books',
    summary: 'Inspect Books contacts and use generated actions for contacts, invoices, and route starters.',
    capabilityLevel: 'managed',
    firstTier: false,
    requiredScopePrefixes: ['ZohoBooks.'],
    documentationLinks: [
      { label: 'Books contacts API', url: 'https://www.zoho.com/books/api/v3/contacts/', source: 'zoho' },
      { label: 'Books invoices API', url: 'https://www.zoho.com/books/api/v3/invoices/', source: 'zoho' },
    ],
  },
  projects: {
    name: 'Projects',
    summary: 'Inspect portals and projects, then create task routes or direct tasks against the connected account.',
    capabilityLevel: 'managed',
    firstTier: false,
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

    const scopes = normalizeScopes(context.zoho_scopes);
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
        scopes,
      },
      dashboardLink: buildDashboardLink(context.id),
      projectContext: readProjectContext(context.settings),
    };
  });

  app.get('/api/zoho/services', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { app_id } = appQuerySchema.parse(request.query);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    const scopes = normalizeScopes(context.zoho_scopes);
    const routeCounts = await loadRouteCounts(context.id);

    const services = (serviceSchema.options as ServiceId[]).map((service) => buildServiceCard(context, service, scopes, routeCounts));
    return { app_id, services };
  });

  app.get('/api/zoho/services/:service/resources', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { service } = request.params as { service: ServiceId };
    const { app_id } = appQuerySchema.parse(request.query);
    const parsedService = serviceSchema.parse(service);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    const resources = await discoverResources(context, parsedService);
    return { service: parsedService, resources };
  });

  app.get('/api/zoho/services/:service/actions', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { service } = request.params as { service: ServiceId };
    const { app_id } = appQuerySchema.parse(request.query);
    const parsedService = serviceSchema.parse(service);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    const scopes = normalizeScopes(context.zoho_scopes);
    return {
      service: parsedService,
      actions: buildActions(context, parsedService, scopes),
    };
  });

  app.get('/api/zoho/services/:service/references', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { service } = request.params as { service: ServiceId };
    const { app_id, goal } = appQuerySchema.parse(request.query);
    const parsedService = serviceSchema.parse(service);
    const context = await loadAppContext((request as any).userId, app_id, reply);
    if (!context) return;

    return buildReferencePayload(context, parsedService, goal || `Inspect and work with ${SERVICE_DEFINITIONS[parsedService].name}.`);
  });

  app.post('/api/project-context', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = projectContextSchema.parse(request.body);
    const context = await loadAppContext((request as any).userId, body.app_id, reply);
    if (!context) return;

    const settings = asObject(context.settings);
    settings.projectContext = {
      appName: body.app_name || null,
      appUrl: body.app_url || null,
      appDocsUrl: body.app_docs_url || null,
      targetBaseUrl: body.target_base_url || null,
      notes: body.notes || null,
    };

    const [updated] = await query(
      'UPDATE apps SET settings = $1, updated_at = NOW() WHERE id = $2 RETURNING settings',
      [JSON.stringify(settings), context.id]
    );

    return {
      app_id: context.id,
      projectContext: readProjectContext(updated?.settings || settings),
    };
  });

  app.put('/api/project-context', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return app.inject({
      method: 'POST',
      url: '/api/project-context',
      payload: request.body,
      headers: request.headers as Record<string, string>,
    });
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

  app.post('/api/zoho/handoff-bundle', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = handoffSchema.parse(request.body);
    const context = await loadAppContext((request as any).userId, body.app_id, reply);
    if (!context) return;

    return buildHandoffBundle(context, body.service, body.goal, body.action);
  });

  app.post('/api/zoho/services/:service/actions/:action', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { service, action } = request.params as { service: ServiceId; action: string };
    const parsedService = serviceSchema.parse(service);
    const body = (request.body || {}) as Record<string, any>;
    const appId = z.string().uuid().parse(body.app_id);
    const context = await loadAppContext((request as any).userId, appId, reply);
    if (!context) return;

    if (!context.zoho_connected && action !== 'create-route') {
      return reply.status(400).send({ error: 'Connect Zoho before running service actions.' });
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

async function loadAppContext(userId: string, appId: string, reply: FastifyReply): Promise<AppContext | null> {
  const record = await queryOne<AppContext>(
    `SELECT a.id, a.name, a.slug, a.domain, a.settings,
            CASE WHEN zt.is_valid = TRUE THEN TRUE ELSE FALSE END as zoho_connected,
            zt.zoho_dc,
            zt.zoho_org_id,
            zt.scopes as zoho_scopes,
            zt.connected_at as zoho_connected_at,
            zt.last_refreshed_at as zoho_last_refreshed_at
       FROM apps a
       LEFT JOIN zoho_tokens zt ON zt.app_id = a.id
      WHERE a.id = $1 AND a.user_id = $2`,
    [appId, userId]
  );

  if (!record) {
    reply.status(404).send({ error: 'App not found' });
    return null;
  }

  return {
    ...record,
    settings: asObject(record.settings),
  };
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

function hasScope(scopes: string[], prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((prefix) => scopes.some((scope) => scope === prefix || scope.startsWith(prefix)));
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

function buildPlatformReferences(appId: string, service: ServiceId): ApiEndpointReference[] {
  const encoded = encodeURIComponent(appId);
  const base = `/api/zoho/services/${service}`;
  const references: ApiEndpointReference[] = [
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/account?app_id=${encoded}`,
      purpose: 'Inspect connection, scopes, and project context for the active workspace.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/zoho/services?app_id=${encoded}`,
      purpose: 'List the service inventory available to the connected workspace.',
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `${base}/resources?app_id=${encoded}`,
      purpose: `Load the current ${SERVICE_DEFINITIONS[service].name} resources and discovery payload.`,
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `${base}/actions?app_id=${encoded}`,
      purpose: `List supported ${SERVICE_DEFINITIONS[service].name} management actions.`,
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `${base}/references?app_id=${encoded}`,
      purpose: `Return API endpoints and docs links for ${SERVICE_DEFINITIONS[service].name}.`,
    },
    {
      audience: 'platform',
      method: 'POST',
      path: '/api/zoho/handoff-bundle',
      purpose: 'Generate the structured prompt + endpoint + documentation handoff bundle.',
      notes: `Body: { app_id: '${appId}', service: '${service}', goal: '...' }`,
    },
    {
      audience: 'platform',
      method: 'GET',
      path: `/api/project-context?app_id=${encoded}`,
      purpose: 'Read the current app/project link metadata attached to the workspace.',
    },
    {
      audience: 'platform',
      method: 'PUT',
      path: '/api/project-context',
      purpose: 'Save or update the linked app URL, docs URL, and target base URL.',
      notes: `Body: { app_id: '${appId}', app_name, app_url, app_docs_url, target_base_url, notes }`,
    },
  ];

  return references.concat(buildServiceActionReferences(appId, service));
}

function buildServiceActionReferences(appId: string, service: ServiceId): ApiEndpointReference[] {
  switch (service) {
    case 'crm':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/crm/actions/create-record`,
          purpose: 'Create a CRM record through the connected workspace.',
          notes: `Body: { app_id: '${appId}', module: 'Leads', payload: { ... } }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/crm/actions/create-route`,
          purpose: 'Create a white-label CRM form route starter for this workspace.',
          notes: `Body: { app_id: '${appId}', target_module: 'Leads', name, lead_source?, style? }`,
        },
      ];
    case 'forms':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/forms/actions/create-route`,
          purpose: 'Create a generated route starter for CRM, Desk, Bookings, Books, or Projects.',
          notes: `Body: { app_id: '${appId}', route_type: 'crm' | 'desk' | 'bookings' | 'books' | 'projects', ... }`,
        },
      ];
    case 'mail':
      return [];
    case 'salesiq':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/salesiq/actions/generate-widget-export`,
          purpose: 'Return the current SalesIQ widget export for the connected workspace.',
          notes: `Body: { app_id: '${appId}' }`,
        },
      ];
    case 'bookings':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/bookings/actions/create-route`,
          purpose: 'Create a Bookings route starter configured with service and staff IDs.',
          notes: `Body: { app_id: '${appId}', style: { service_id, staff_id, timezone } }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/bookings/actions/create-appointment`,
          purpose: 'Create a live appointment against the connected Bookings account.',
          notes: `Body: { app_id: '${appId}', payload: { service_id, staff_id, from_time, time_slot, customer_details } }`,
        },
      ];
    case 'desk':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/desk/actions/create-route`,
          purpose: 'Create a support intake route starter for Zoho Desk.',
          notes: `Body: { app_id: '${appId}', target_module: 'Tickets', name, style? }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/desk/actions/create-ticket`,
          purpose: 'Create a Desk ticket via the connected workspace.',
          notes: `Body: { app_id: '${appId}', payload: { subject, email, description } }`,
        },
      ];
    case 'books':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/books/actions/create-route`,
          purpose: 'Create a Books contact route starter for the workspace.',
          notes: `Body: { app_id: '${appId}', target_module: 'Contacts', name, style? }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/books/actions/create-contact`,
          purpose: 'Create a Books contact.',
          notes: `Body: { app_id: '${appId}', payload: { contact_name, email?, company_name? } }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/books/actions/create-invoice`,
          purpose: 'Create an invoice using the connected Books account.',
          notes: `Body: { app_id: '${appId}', payload: { ...invoiceFields } }`,
        },
      ];
    case 'projects':
      return [
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/projects/actions/create-route`,
          purpose: 'Create a task route starter for a configured portal and project.',
          notes: `Body: { app_id: '${appId}', style: { portalId, projectId, defaultPriority } }`,
        },
        {
          audience: 'platform',
          method: 'POST',
          path: `/api/zoho/services/projects/actions/create-task`,
          purpose: 'Create a live Zoho Projects task.',
          notes: `Body: { app_id: '${appId}', portalId, projectId, payload: { name, description?, priority?, end_date? } }`,
        },
      ];
  }
}

function buildZohoReferences(service: ServiceId): ApiEndpointReference[] {
  switch (service) {
    case 'crm':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/org',
          purpose: 'Inspect the connected CRM organization.',
          requiredScopes: ['ZohoCRM.org.READ'],
          documentationUrl: 'https://www.zoho.com/crm/developer/docs/api/v8/get-org-data.html',
        },
        {
          audience: 'zoho',
          method: 'GET',
          path: '/crm/v6/settings/modules',
          purpose: 'List CRM modules that are available in the connected workspace.',
          requiredScopes: ['ZohoCRM.settings.ALL'],
          documentationUrl: 'https://www.zoho.com/developer/help/api/modules-fields.html',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/crm/v6/{module}',
          purpose: 'Create a CRM record in the selected module.',
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
          purpose: 'List mail accounts available to the authenticated user.',
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
          purpose: 'Load the SalesIQ widget runtime after you have a valid widget code.',
          requiredScopes: ['SalesIQ.portals.ALL'],
          documentationUrl: 'https://www.zoho.com/salesiq/help/developer-section/',
        },
      ];
    case 'bookings':
      return [
        {
          audience: 'zoho',
          method: 'POST',
          path: '/bookings/v1/json/appointment',
          purpose: 'Create a booking appointment for a service/staff combination.',
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
          purpose: 'Inspect Desk departments available in the connected workspace.',
          requiredScopes: ['Desk.basic.ALL'],
          documentationUrl: 'https://desk.zoho.com/DeskAPIDocument',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/api/v1/tickets',
          purpose: 'Create a Zoho Desk ticket.',
          requiredScopes: ['Desk.tickets.ALL'],
          documentationUrl: 'https://desk.zoho.com/DeskAPIDocument',
        },
      ];
    case 'books':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/books/v3/contacts',
          purpose: 'List contact records in Zoho Books.',
          requiredScopes: ['ZohoBooks.contacts.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/contacts/',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/books/v3/invoices',
          purpose: 'Create an invoice in Zoho Books.',
          requiredScopes: ['ZohoBooks.invoices.ALL'],
          documentationUrl: 'https://www.zoho.com/books/api/v3/invoices/',
        },
      ];
    case 'projects':
      return [
        {
          audience: 'zoho',
          method: 'GET',
          path: '/restapi/portals/',
          purpose: 'List Projects portals available to the connected workspace.',
          requiredScopes: ['ZohoProjects.portals.ALL'],
          documentationUrl: 'https://www.zoho.com/projects/help/rest-api/tasks-api.html',
        },
        {
          audience: 'zoho',
          method: 'POST',
          path: '/restapi/portal/{portalId}/projects/{projectId}/tasks/',
          purpose: 'Create a Zoho Projects task.',
          requiredScopes: ['ZohoProjects.tasks.ALL'],
          documentationUrl: 'https://www.zoho.com/projects/help/rest-api/tasks-api.html',
        },
      ];
  }
}

function buildActions(context: AppContext, service: ServiceId, scopes: string[]): ServiceAction[] {
  const connected = context.zoho_connected;
  const canProbe = connected && hasScope(scopes, SERVICE_DEFINITIONS[service].requiredScopePrefixes);
  const connectReason = connected
    ? undefined
    : 'Connect Zoho to unlock live inspection and manage actions.';
  const reconnectReason = !connected
    ? connectReason
    : `Reconnect the workspace with ${SERVICE_DEFINITIONS[service].name} scopes enabled.`;

  const createRouteExample = (routeType: RouteType) => ({
    app_id: context.id,
    route_type: routeType,
    name: `${SERVICE_DEFINITIONS[routeType as ServiceId]?.name || routeType} route starter`,
    target_module: routeType === 'crm' ? 'Leads' : routeType === 'desk' ? 'Tickets' : routeType === 'bookings' ? 'Appointments' : routeType === 'books' ? 'Contacts' : 'Tasks',
    style: routeType === 'bookings'
      ? { service_id: 'service-id', staff_id: 'staff-id', timezone: 'UTC' }
      : routeType === 'projects'
        ? { portalId: 'portal-id', projectId: 'project-id', defaultPriority: 'None' }
        : {},
  });

  switch (service) {
    case 'forms':
      return [
        {
          id: 'create-route',
          label: 'Create route starter',
          description: 'Create a generated route starter and keep the output white-label to the user app.',
          endpoint: '/api/zoho/services/forms/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('crm'),
        },
      ];
    case 'crm':
      return [
        {
          id: 'create-route',
          label: 'Create CRM route',
          description: 'Create a CRM route starter that captures leads or contacts into the connected workspace.',
          endpoint: '/api/zoho/services/crm/actions/create-route',
          method: 'POST',
          available: true,
          bodyExample: createRouteExample('crm'),
        },
        {
          id: 'create-record',
          label: 'Create CRM record',
          description: 'Create a live CRM record in the connected Zoho organization.',
          endpoint: '/api/zoho/services/crm/actions/create-record',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
          bodyExample: {
            app_id: context.id,
            module: 'Leads',
            payload: {
              Last_Name: 'Lovelace',
              Email: 'ada@example.com',
              Company: 'Analytical Engines',
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
          bodyExample: createRouteExample('desk'),
        },
        {
          id: 'create-ticket',
          label: 'Create ticket',
          description: 'Create a live Desk ticket using the connected workspace.',
          endpoint: '/api/zoho/services/desk/actions/create-ticket',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
          bodyExample: {
            app_id: context.id,
            payload: {
              subject: 'Need help with onboarding',
              email: 'support@example.com',
              description: 'Created from the Zoho capability workspace.',
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
          bodyExample: createRouteExample('bookings'),
        },
        {
          id: 'create-appointment',
          label: 'Create appointment',
          description: 'Create a live appointment using the connected Bookings account.',
          endpoint: '/api/zoho/services/bookings/actions/create-appointment',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
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
          bodyExample: createRouteExample('books'),
        },
        {
          id: 'create-contact',
          label: 'Create contact',
          description: 'Create a live Zoho Books contact.',
          endpoint: '/api/zoho/services/books/actions/create-contact',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
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
          label: 'Create invoice',
          description: 'Create an invoice using the connected Books account.',
          endpoint: '/api/zoho/services/books/actions/create-invoice',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
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
          bodyExample: createRouteExample('projects'),
        },
        {
          id: 'create-task',
          label: 'Create task',
          description: 'Create a live Zoho Projects task.',
          endpoint: '/api/zoho/services/projects/actions/create-task',
          method: 'POST',
          available: canProbe,
          reason: canProbe ? undefined : reconnectReason,
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
          available: connected,
          reason: connected ? undefined : connectReason,
          bodyExample: { app_id: context.id },
        },
      ];
    case 'mail':
      return [];
  }
}

function buildServiceCard(context: AppContext, service: ServiceId, scopes: string[], routeCounts: Record<string, number>) {
  const definition = SERVICE_DEFINITIONS[service];
  const ready = context.zoho_connected && hasScope(scopes, definition.requiredScopePrefixes);
  const routeCount = service === 'forms'
    ? Object.values(routeCounts).reduce((sum, value) => sum + value, 0)
    : routeCounts[service] || 0;

  return {
    id: service,
    name: definition.name,
    summary: definition.summary,
    firstTier: definition.firstTier,
    capabilityLevel: definition.capabilityLevel,
    status: !context.zoho_connected
      ? 'connect_required'
      : ready
        ? 'ready'
        : definition.requiredScopePrefixes.length > 0
          ? 'reconnect_required'
          : 'ready',
    zohoConnected: context.zoho_connected,
    routeCount,
    routeSupport: routeCount > 0 ? getToolSupportSummary(service === 'forms' ? 'crm' : service).status : 'ga',
    dashboardLink: buildDashboardLink(context.id, service),
    referencesUrl: `/api/zoho/services/${service}/references?app_id=${context.id}`,
    resourcesUrl: `/api/zoho/services/${service}/resources?app_id=${context.id}`,
    actionsUrl: `/api/zoho/services/${service}/actions?app_id=${context.id}`,
    reconnectReason: context.zoho_connected && !ready ? `Reconnect Zoho to add ${definition.name} scopes.` : null,
  };
}

async function buildReferencePayload(context: AppContext, service: ServiceId, goal: string) {
  const resources = await discoverResources(context, service);
  const scopes = normalizeScopes(context.zoho_scopes);
  const actions = buildActions(context, service, scopes);
  const projectContext = readProjectContext(context.settings);
  const dashboardLink = buildDashboardLink(context.id, service);
  const documentationLinks = buildDocumentationLinks(context, service, projectContext, dashboardLink);
  const apiEndpoints = [...buildPlatformReferences(context.id, service), ...buildZohoReferences(service)];

  return {
    service,
    serviceLabel: SERVICE_DEFINITIONS[service].name,
    goal,
    prompt: buildHandoffPrompt(context, service, goal, resources, actions, apiEndpoints, documentationLinks, projectContext),
    apiEndpoints,
    documentationLinks,
    dashboardLink,
    userAppLink: projectContext.appUrl,
    userAppDocsLink: projectContext.appDocsUrl,
    availableResources: resources,
    availableActions: actions,
  };
}

function buildDocumentationLinks(context: AppContext, service: ServiceId, projectContext: ProjectContext, dashboardLink: string): DocumentationLink[] {
  const definition = SERVICE_DEFINITIONS[service];
  const docs: DocumentationLink[] = definition.documentationLinks.map((entry) => ({
    label: entry.label,
    url: entry.source === 'platform' && entry.url.startsWith('/') ? new URL(entry.url, env.APP_URL).toString() : entry.url,
    source: entry.source,
  }));

  docs.unshift({ label: 'Open this workspace view', url: dashboardLink, source: 'platform' });

  if (projectContext.appDocsUrl) {
    docs.push({ label: 'User app documentation', url: projectContext.appDocsUrl, source: 'user-app' });
  }

  return docs;
}

function buildHandoffPrompt(
  context: AppContext,
  service: ServiceId,
  goal: string,
  resources: ResourceSummary[],
  actions: ServiceAction[],
  endpoints: ApiEndpointReference[],
  docs: DocumentationLink[],
  projectContext: ProjectContext,
): string {
  const definition = SERVICE_DEFINITIONS[service];
  const scopes = normalizeScopes(context.zoho_scopes);
  const availableActionLines = actions.length === 0
    ? '- No managed actions are wired yet for this service. Use the references and docs below.'
    : actions.map((action) => `- ${action.label}: ${action.available ? 'available' : `blocked (${action.reason})`} via ${action.endpoint}`);
  const resourceLines = resources.length === 0
    ? ['- No live resources were discovered yet. Treat this as an empty or partially configured service.']
    : resources.map((resource) => `- ${resource.name}${resource.description ? `: ${resource.description}` : ''}`);
  const endpointLines = endpoints.map((endpoint) => `- [${endpoint.audience}] ${endpoint.method} ${endpoint.path} — ${endpoint.purpose}${endpoint.documentationUrl ? ` (docs: ${endpoint.documentationUrl})` : ''}`);
  const docLines = docs.map((doc) => `- ${doc.label}: ${doc.url}`);
  const projectLines = [
    `- Project name: ${projectContext.appName || context.name}`,
    `- Project URL: ${projectContext.appUrl || 'not provided'}`,
    `- Project docs: ${projectContext.appDocsUrl || 'not provided'}`,
    `- Target base URL: ${projectContext.targetBaseUrl || 'not provided'}`,
    `- Notes: ${projectContext.notes || 'not provided'}`,
  ];

  return [
    `# ${projectContext.appName || context.name} — ${definition.name} capability handoff`,
    '',
    '## Role',
    '',
    `You are extending the user's app with Zoho ${definition.name} capabilities. Treat this as the user's product surface, not a 1ClickSync-branded integration.`,
    '',
    '## Goal',
    '',
    goal,
    '',
    '## Connected Zoho Workspace',
    '',
    `- Connected: ${context.zoho_connected ? 'yes' : 'no'}`,
    `- Datacenter: ${context.zoho_dc || 'unknown'}`,
    `- Organization ID: ${context.zoho_org_id || 'unknown'}`,
    `- OAuth scopes: ${scopes.length > 0 ? scopes.join(', ') : 'none detected'}`,
    '',
    '## User App Context',
    '',
    ...projectLines,
    '',
    `## Discovered ${definition.name} Resources`,
    '',
    ...resourceLines,
    '',
    '## Available Managed Actions',
    '',
    ...availableActionLines,
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
    '- Prefer the listed platform endpoints when the current product can manage the operation directly.',
    '- Use the listed Zoho endpoints when building code that integrates with the connected account outside this product.',
    '- Keep the implementation white-label to the user app and avoid introducing 1ClickSync branding in UI copy or generated assets.',
    '- Preserve permission awareness: if a scope is missing, the resulting implementation should guide the user to reconnect rather than silently failing.',
    '',
  ].join('\n');
}

async function buildHandoffBundle(context: AppContext, service: ServiceId, goal: string, action?: string) {
  const payload = await buildReferencePayload(context, service, goal);
  return {
    ...payload,
    action: action || null,
  };
}

async function discoverResources(context: AppContext, service: ServiceId): Promise<ResourceSummary[]> {
  const resources: ResourceSummary[] = [];
  const routeRows = await query<{ id: string; name: string; route_type: string; target_module: string; is_active: boolean; created_at: string }>(
    `SELECT id, name, route_type, target_module, is_active, created_at
       FROM form_configs
      WHERE app_id = $1
      ORDER BY created_at DESC
      LIMIT 12`,
    [context.id]
  );

  const routeResources = routeRows
    .filter((row) => service === 'forms' || row.route_type === service)
    .map<ResourceSummary>((row) => ({
      type: 'route',
      id: row.id,
      name: row.name,
      status: row.is_active ? 'active' : 'inactive',
      description: `${row.route_type.toUpperCase()} → ${row.target_module}`,
      metadata: { created_at: row.created_at },
    }));

  if (routeResources.length > 0) {
    resources.push(...routeResources);
  }

  if (!context.zoho_connected) {
    resources.unshift({
      type: 'connection',
      name: 'Zoho connection required',
      status: 'connect_required',
      description: 'Connect the workspace to fetch live service data and manage Zoho resources.',
    });
    return resources;
  }

  switch (service) {
    case 'forms':
      resources.unshift({
        type: 'summary',
        name: 'Generated route workspace',
        description: `${routeResources.length} route starter(s) already configured for this app.`,
      });
      return resources;
    case 'crm': {
      const [orgProbe, modulesProbe] = await Promise.all([
        safeProbe(async () => crmApi.getOrg(context.id)),
        safeProbe(async () => zohoApi({ appId: context.id, app: 'crm', path: '/crm/v6/settings/modules' })),
      ]);
      const org = pickFirst((orgProbe.value as any)?.org, (orgProbe.value as any)?.data);
      if (org) {
        resources.unshift({
          type: 'organization',
          name: org.company_name || org.companyName || context.name,
          description: `Connected CRM org ${org.id || context.zoho_org_id || ''}`.trim(),
        });
      }
      const modules = pickArray((modulesProbe.value as any)?.modules, (modulesProbe.value as any)?.data);
      modules.slice(0, 8).forEach((module: any) => {
        resources.push({
          type: 'module',
          name: module.api_name || module.module_name || module.plural_label || 'CRM module',
          description: module.plural_label || module.singular_label || 'Available module',
        });
      });
      if (!modules.length && modulesProbe.error) {
        resources.push({ type: 'probe', name: 'CRM modules unavailable', description: modulesProbe.error, status: 'warning' });
      }
      return resources;
    }
    case 'mail': {
      const accountsProbe = await safeProbe(async () => zohoApi({ appId: context.id, app: 'mail', path: '/api/accounts' }));
      const accounts = pickArray((accountsProbe.value as any)?.data, (accountsProbe.value as any)?.accounts, (accountsProbe.value as any)?.account);
      accounts.slice(0, 8).forEach((account: any) => {
        resources.push({
          type: 'account',
          name: account.displayName || account.primaryEmailAddress || account.mailboxAddress || account.emailAddress || 'Mail account',
          description: account.accountId ? `Account ${account.accountId}` : 'Connected mail account',
        });
      });
      if (!accounts.length) {
        resources.push({
          type: 'probe',
          name: accountsProbe.error ? 'Mail discovery needs reconnect' : 'No mail accounts discovered',
          description: accountsProbe.error || 'The connected workspace did not return mail accounts for the current scopes.',
          status: accountsProbe.error ? 'warning' : 'info',
        });
      }
      return resources;
    }
    case 'salesiq': {
      const widgetCode = typeof context.settings.salesiq_widget_code === 'string' ? context.settings.salesiq_widget_code : '';
      resources.unshift({
        type: 'widget',
        name: widgetCode ? 'Widget code configured' : 'Widget export ready',
        description: widgetCode ? 'A SalesIQ widget code is stored in app settings.' : 'Use the action panel to generate the current SalesIQ widget export.',
      });
      return resources;
    }
    case 'bookings': {
      const servicesProbe = await safeProbe(async () => bookingsApi.getServices(context.id));
      const services = pickArray((servicesProbe.value as any)?.services, (servicesProbe.value as any)?.data, (servicesProbe.value as any)?.service);
      services.slice(0, 6).forEach((item: any) => {
        resources.push({
          type: 'service',
          name: item.name || item.service_name || item.serviceId || 'Booking service',
          description: item.staff_name || item.description || 'Available Bookings service',
        });
      });
      if (!services.length) {
        resources.push({
          type: 'probe',
          name: servicesProbe.error ? 'Bookings discovery needs configuration' : 'No booking services discovered',
          description: servicesProbe.error || 'Add service/staff IDs when creating route starters if the account does not expose a list endpoint.',
          status: servicesProbe.error ? 'warning' : 'info',
        });
      }
      return resources;
    }
    case 'desk': {
      const departmentsProbe = await safeProbe(async () => deskApi.getDepartments(context.id));
      const departments = pickArray((departmentsProbe.value as any)?.data, (departmentsProbe.value as any)?.departments);
      departments.slice(0, 6).forEach((department: any) => {
        resources.push({
          type: 'department',
          name: department.name || department.departmentName || 'Desk department',
          description: department.id ? `Department ${department.id}` : 'Connected department',
        });
      });
      if (!departments.length && departmentsProbe.error) {
        resources.push({ type: 'probe', name: 'Desk departments unavailable', description: departmentsProbe.error, status: 'warning' });
      }
      return resources;
    }
    case 'books': {
      const contactsProbe = await safeProbe(async () => booksApi.getContacts(context.id));
      const contacts = pickArray((contactsProbe.value as any)?.contacts, (contactsProbe.value as any)?.data);
      contacts.slice(0, 8).forEach((contact: any) => {
        resources.push({
          type: 'contact',
          name: contact.contact_name || contact.customer_name || contact.name || 'Books contact',
          description: contact.email || 'Connected Books contact',
        });
      });
      if (!contacts.length && contactsProbe.error) {
        resources.push({ type: 'probe', name: 'Books contacts unavailable', description: contactsProbe.error, status: 'warning' });
      }
      return resources;
    }
    case 'projects': {
      const portalsProbe = await safeProbe(async () => projectsApi.getPortals(context.id));
      const portals = pickArray((portalsProbe.value as any)?.portals, (portalsProbe.value as any)?.data, (portalsProbe.value as any)?.portals?.portal);
      portals.slice(0, 6).forEach((portal: any) => {
        resources.push({
          type: 'portal',
          name: portal.name || portal.portal_name || portal.id || 'Projects portal',
          description: portal.id ? `Portal ${portal.id}` : 'Connected portal',
        });
      });
      if (!portals.length && portalsProbe.error) {
        resources.push({ type: 'probe', name: 'Projects portals unavailable', description: portalsProbe.error, status: 'warning' });
      }
      return resources;
    }
  }
}

async function createGeneratedRoute(context: AppContext, service: ServiceId, rawBody: Record<string, any>) {
  const parsed = createRouteActionSchema.parse(rawBody);
  const routeType = routeTypeSchema.parse(service === 'forms' ? (parsed.route_type || 'crm') : service);
  const targetModule = parsed.target_module || (routeType === 'crm' ? 'Leads' : routeType === 'desk' ? 'Tickets' : routeType === 'bookings' ? 'Appointments' : routeType === 'books' ? 'Contacts' : 'Tasks');
  const fields = parsed.fields || DEFAULT_ROUTE_FIELDS[routeType];
  const style = {
    ...(parsed.style || {}),
    fields,
  };

  if (routeType === 'bookings' && (!style.service_id || !style.staff_id)) {
    throw new Error('Bookings routes require style.service_id and style.staff_id.');
  }
  if (routeType === 'projects' && (!style.portalId || !style.projectId)) {
    throw new Error('Projects routes require style.portalId and style.projectId.');
  }

  const fieldMapping: Record<string, string> = {};
  for (const field of fields) {
    fieldMapping[field.name] = field.zoho_field;
  }

  const formKey = randomBytes(16).toString('hex');
  const [created] = await query(
    `INSERT INTO form_configs
       (app_id, customer_id, user_id, form_key, name, target_module, route_type, field_mapping, style_config, lead_source)
     VALUES ($1, $1, (SELECT user_id FROM apps WHERE id = $1), $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, form_key, name, target_module, route_type, lead_source, is_active`,
    [
      context.id,
      formKey,
      parsed.name || `${SERVICE_DEFINITIONS[routeType as ServiceId].name} route starter`,
      targetModule,
      routeType,
      JSON.stringify(fieldMapping),
      JSON.stringify(style),
      parsed.lead_source || null,
    ]
  );

  return {
    success: true,
    form_id: created.id,
    form_key: created.form_key,
    route_type: created.route_type,
    submit_url: `${env.APP_URL}/api/f/${created.form_key}`,
    name: created.name,
  };
}

async function safeProbe<T>(fn: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (error: any) {
    return { value: null, error: error.message || 'Probe failed' };
  }
}

function pickArray(...candidates: any[]): any[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function pickFirst(...candidates: any[]): any | null {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate[0];
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}
