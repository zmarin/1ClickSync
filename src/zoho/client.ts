import { ZOHO_DC, type ZohoDC } from '../config';
import { getAccessToken } from './oauth';
import { query } from '../db';

type ZohoApp = 'crm' | 'forms' | 'salesiq';

interface ZohoApiResponse<T = any> {
  data?: T[];
  modules?: T[];
  fields?: T[];
  status?: string;
  code?: string;
  message?: string;
  details?: any;
}

interface ApiCallOptions {
  customerId: string;
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
  const { customerId, app, path, method = 'GET', body, stepId } = options;
  const startTime = Date.now();

  // Get fresh token + DC info
  const { token, dc, orgId } = await getAccessToken(customerId);

  // Build the full URL based on app and datacenter
  const baseUrl = ZOHO_DC[dc][app];
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json',
  };

  // CRM API v6 needs orgid header for multi-org accounts
  if (app === 'crm') {
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
  logApiCall(customerId, stepId, app, path, method, body, response.status, responseBody, duration)
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
  // Get all fields for a module
  async getFields(customerId: string, module: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/fields?module=${module}`,
    });
  },

  // Create a custom field
  async createField(customerId: string, module: string, fieldConfig: any, stepId?: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/fields?module=${module}`,
      method: 'POST',
      body: { fields: [fieldConfig] },
      stepId,
    });
  },

  // Update a field (e.g. add picklist values)
  async updateField(customerId: string, module: string, fieldId: string, fieldConfig: any, stepId?: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/fields/${fieldId}?module=${module}`,
      method: 'PATCH',
      body: { fields: [fieldConfig] },
      stepId,
    });
  },

  // Get pipeline/stages for a module
  async getPipeline(customerId: string, module: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/pipeline?module=${module}`,
    });
  },

  // Get layouts for a module
  async getLayouts(customerId: string, module: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/layouts?module=${module}`,
    });
  },

  // Create a record in any module (Leads, Contacts, etc.)
  async createRecord(customerId: string, module: string, recordData: Record<string, any>, stepId?: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/${module}`,
      method: 'POST',
      body: { data: [recordData] },
      stepId,
    });
  },

  // Get org info (to verify connection)
  async getOrg(customerId: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: '/crm/v6/org',
    });
  },

  // Get workflow rules
  async getWorkflowRules(customerId: string, module: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: `/crm/v6/settings/workflow_rules?module=${module}`,
    });
  },

  // Create workflow rule
  async createWorkflowRule(customerId: string, ruleConfig: any, stepId?: string) {
    return zohoApi({
      customerId,
      app: 'crm',
      path: '/crm/v6/settings/workflow_rules',
      method: 'POST',
      body: { workflow_rules: [ruleConfig] },
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

  /** True if the error is due to rate limiting */
  get isRateLimited(): boolean {
    return this.httpStatus === 429 || this.code === 'RATE_LIMIT_EXCEEDED';
  }

  /** True if retrying might help */
  get isRetryable(): boolean {
    return this.isRateLimited || this.httpStatus >= 500 || this.code === 'INTERNAL_ERROR';
  }

  /** True if the resource already exists (for idempotency) */
  get isDuplicate(): boolean {
    return this.code === 'DUPLICATE_DATA' || this.code === 'ALREADY_EXISTS';
  }
}

/**
 * Log API call to audit table
 */
async function logApiCall(
  customerId: string,
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
       (customer_id, step_id, zoho_app, endpoint, method, request_body, 
        response_status, response_body, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      customerId,
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
