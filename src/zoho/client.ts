import { ZOHO_DC, type ZohoDC, type ZohoApp } from '../config';
import { getAccessToken } from './oauth';
import { query } from '../db';

interface ZohoApiResponse<T = any> {
  data?: T[];
  modules?: T[];
  fields?: T[];
  status?: string;
  code?: string;
  message?: string;
  details?: any;
  [key: string]: any;
}

interface ApiCallOptions {
  appId: string;
  app: ZohoApp;
  path: string;             // e.g. '/crm/v6/settings/fields'
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  stepId?: string;          // for audit logging
}

/**
 * Make an authenticated request to any Zoho API.
 * Handles token retrieval, DC-aware URL construction, and audit logging.
 */
export async function zohoApi<T = any>(options: ApiCallOptions): Promise<ZohoApiResponse<T>> {
  const { appId, app, path, method = 'GET', body, stepId } = options;
  const startTime = Date.now();

  // Get fresh token + DC info
  const { token, dc, orgId } = await getAccessToken(appId, app);

  // Build the full URL based on app and datacenter
  const baseUrl = ZOHO_DC[dc][app];
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json',
  };

  // CRM API v6 needs orgid header for multi-org accounts
  if (app === 'crm' && orgId) {
    headers['X-CRM-ORG'] = orgId;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);
  const duration = Date.now() - startTime;

  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = { raw: await response.text() };
  }

  // Audit log (async, don't block on it)
  logApiCall(appId, stepId, app, path, method, body, response.status, responseBody, duration)
    .catch(err => console.error('[Audit] Log failed:', err.message));

  // Handle Zoho-specific errors
  if (!response.ok) {
    const errorCode = responseBody?.code || responseBody?.error || response.status;
    const errorMsg = responseBody?.message || responseBody?.error || 'Unknown Zoho API error';
    throw new ZohoApiError(errorCode, errorMsg, response.status, responseBody);
  }

  return responseBody;
}

/**
 * CRM-specific convenience methods
 */
export const crmApi = {
  async getModules(appId: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: '/crm/v6/settings/modules',
    });
  },

  async getFields(appId: string, module: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/fields?module=${module}`,
    });
  },

  async createField(appId: string, module: string, fieldConfig: any, stepId?: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/fields?module=${module}`,
      method: 'POST',
      body: { fields: [fieldConfig] },
      stepId,
    });
  },

  async updateField(appId: string, module: string, fieldId: string, fieldConfig: any, stepId?: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/fields/${fieldId}?module=${module}`,
      method: 'PATCH',
      body: { fields: [fieldConfig] },
      stepId,
    });
  },

  async getPipeline(appId: string, module: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/pipeline?module=${module}`,
    });
  },

  async getLayouts(appId: string, module: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/layouts?module=${module}`,
    });
  },

  async createRecord(appId: string, module: string, recordData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/${module}`,
      method: 'POST',
      body: { data: [recordData] },
      stepId,
    });
  },

  async getOrg(appId: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: '/crm/v6/org',
    });
  },

  async getWorkflowRules(appId: string, module: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: `/crm/v6/settings/workflow_rules?module=${module}`,
    });
  },

  async createWorkflowRule(appId: string, ruleConfig: any, stepId?: string) {
    return zohoApi({
      appId,
      app: 'crm',
      path: '/crm/v6/settings/workflow_rules',
      method: 'POST',
      body: { workflow_rules: [ruleConfig] },
      stepId,
    });
  },
};

/**
 * Desk-specific convenience methods
 * API: https://desk.zoho.com/DeskAPIDocument
 */
export const deskApi = {
  async createTicket(appId: string, ticketData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'desk',
      path: '/api/v1/tickets',
      method: 'POST',
      body: ticketData,
      stepId,
    });
  },

  async getTicketFields(appId: string) {
    return zohoApi({
      appId,
      app: 'desk',
      path: '/api/v1/ticketFields',
    });
  },

  async getDepartments(appId: string) {
    return zohoApi({
      appId,
      app: 'desk',
      path: '/api/v1/departments',
    });
  },

  async getContacts(appId: string, email?: string) {
    const path = email
      ? `/api/v1/contacts/search?email=${encodeURIComponent(email)}`
      : '/api/v1/contacts';
    return zohoApi({ appId, app: 'desk', path });
  },
};

/**
 * Bookings-specific convenience methods
 * API: https://www.zoho.com/bookings/help/api/v1/book-appointment.html
 */
export const bookingsApi = {
  async getServices(appId: string) {
    return zohoApi({
      appId,
      app: 'bookings',
      path: '/bookings/v1/json/availableslots',
    });
  },

  async fetchAvailability(appId: string, serviceId: string, staffId: string, date: string) {
    return zohoApi({
      appId,
      app: 'bookings',
      path: `/bookings/v1/json/availableslots?service_id=${serviceId}&staff_id=${staffId}&selected_date=${date}`,
    });
  },

  async createAppointment(appId: string, appointmentData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'bookings',
      path: '/bookings/v1/json/appointment',
      method: 'POST',
      body: appointmentData,
      stepId,
    });
  },
};

/**
 * Books-specific convenience methods
 * API: https://www.zoho.com/books/api/v3/
 */
export const booksApi = {
  async createContact(appId: string, contactData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'books',
      path: '/books/v3/contacts',
      method: 'POST',
      body: contactData,
      stepId,
    });
  },

  async createInvoice(appId: string, invoiceData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'books',
      path: '/books/v3/invoices',
      method: 'POST',
      body: invoiceData,
      stepId,
    });
  },

  async getContacts(appId: string) {
    return zohoApi({ appId, app: 'books', path: '/books/v3/contacts' });
  },

  async getItems(appId: string) {
    return zohoApi({ appId, app: 'books', path: '/books/v3/items' });
  },
};

/**
 * Projects-specific convenience methods
 * API: https://www.zoho.com/projects/help/rest-api/tasks-api.html
 */
export const projectsApi = {
  async getPortals(appId: string) {
    return zohoApi({
      appId,
      app: 'projects',
      path: '/restapi/portals/',
    });
  },

  async getProjects(appId: string, portalId: string) {
    return zohoApi({
      appId,
      app: 'projects',
      path: `/restapi/portal/${portalId}/projects/`,
    });
  },

  async createTask(appId: string, portalId: string, projectId: string, taskData: Record<string, any>, stepId?: string) {
    return zohoApi({
      appId,
      app: 'projects',
      path: `/restapi/portal/${portalId}/projects/${projectId}/tasks/`,
      method: 'POST',
      body: taskData,
      stepId,
    });
  },
};

/**
 * Custom error for Zoho API failures
 */
export class ZohoApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
    public responseBody: any
  ) {
    super(`Zoho API Error [${code}]: ${message}`);
    this.name = 'ZohoApiError';
  }

  get isRateLimited(): boolean {
    return this.httpStatus === 429 || this.code === 'RATE_LIMIT_EXCEEDED';
  }

  get isRetryable(): boolean {
    return this.isRateLimited || this.httpStatus >= 500 || this.code === 'INTERNAL_ERROR';
  }

  get isDuplicate(): boolean {
    return this.code === 'DUPLICATE_DATA' || this.code === 'ALREADY_EXISTS';
  }
}

/**
 * Log API call to audit table
 */
async function logApiCall(
  appId: string,
  stepId: string | undefined,
  app: string,
  endpoint: string,
  method: string,
  requestBody: any,
  responseStatus: number,
  responseBody: any,
  durationMs: number
): Promise<void> {
  await query(
    `INSERT INTO api_audit_log
       (app_id, customer_id, step_id, zoho_app, endpoint, method, request_body,
        response_status, response_body, duration_ms)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      appId,
      stepId || null,
      app,
      endpoint,
      method,
      requestBody ? JSON.stringify(requestBody) : null,
      responseStatus,
      JSON.stringify(responseBody),
      durationMs,
    ]
  );
}
