import { crmApi, ZohoApiError } from '../zoho/client';
import { query, queryOne } from '../db';

interface StepContext {
  jobId: string;
  customerId: string;
  step: {
    stepId: string;
    action: string;
    targetApp: string;
    config: any;
    idempotencyKey: string;
    dependsOn?: string[];
  };
}

interface StepResult {
  status: 'completed' | 'skipped';
  resourceId?: string;
  resourceName?: string;
  details?: any;
}

/**
 * Main step processor — dispatches to action-specific handlers.
 */
export async function processSetupStep(ctx: StepContext): Promise<StepResult> {
  const { jobId, customerId, step } = ctx;

  // 1. Idempotency check — already completed?
  const existing = await queryOne<{ status: string; result: any }>(
    'SELECT status, result FROM setup_steps WHERE idempotency_key = $1',
    [step.idempotencyKey]
  );

  if (existing?.status === 'completed') {
    console.log(`[Step] ${step.stepId} already completed, skipping`);
    return { status: 'skipped', details: existing.result };
  }

  // 2. Check dependencies are met
  if (step.dependsOn?.length) {
    const unfinished = await query(
      `SELECT step_id, status FROM setup_steps 
       WHERE job_id = $1 AND step_id = ANY($2) AND status != 'completed'`,
      [jobId, step.dependsOn]
    );
    if (unfinished.length > 0) {
      throw new Error(
        `Dependencies not met: ${unfinished.map(u => `${u.step_id}(${u.status})`).join(', ')}`
      );
    }
  }

  // 3. Mark as running
  await query(
    `UPDATE setup_steps SET status = 'running', started_at = NOW(), attempts = attempts + 1
     WHERE idempotency_key = $1`,
    [step.idempotencyKey]
  );

  // 4. Dispatch to the right handler
  try {
    const handler = ACTION_HANDLERS[step.action];
    if (!handler) {
      throw new Error(`Unknown action type: ${step.action}`);
    }

    const result = await handler(customerId, step.config, step.stepId);

    // 5. Mark as completed
    await query(
      `UPDATE setup_steps SET status = 'completed', result = $1, completed_at = NOW()
       WHERE idempotency_key = $2`,
      [JSON.stringify(result), step.idempotencyKey]
    );

    // Track the created resource
    if (result.resourceId) {
      await query(
        `INSERT INTO created_resources 
           (customer_id, step_id, zoho_app, resource_type, resource_id, resource_name, metadata)
         VALUES ($1, (SELECT id FROM setup_steps WHERE idempotency_key = $2), $3, $4, $5, $6, $7)`,
        [
          customerId,
          step.idempotencyKey,
          step.targetApp,
          step.action,
          result.resourceId,
          result.resourceName,
          result.details ? JSON.stringify(result.details) : null,
        ]
      );
    }

    // Update job progress
    await query(
      `UPDATE setup_jobs SET completed_steps = completed_steps + 1 WHERE id = $1`,
      [jobId]
    );

    return result;
  } catch (err: any) {
    // Handle Zoho duplicate errors as "already exists" = success
    if (err instanceof ZohoApiError && err.isDuplicate) {
      console.log(`[Step] ${step.stepId} resource already exists, marking as completed`);
      const result: StepResult = { status: 'completed', details: { alreadyExisted: true } };
      await query(
        `UPDATE setup_steps SET status = 'completed', result = $1, completed_at = NOW()
         WHERE idempotency_key = $2`,
        [JSON.stringify(result), step.idempotencyKey]
      );
      await query(`UPDATE setup_jobs SET completed_steps = completed_steps + 1 WHERE id = $1`, [jobId]);
      return result;
    }

    // Mark step as failed
    await query(
      `UPDATE setup_steps SET status = 'failed', error = $1 WHERE idempotency_key = $2`,
      [err.message, step.idempotencyKey]
    );
    await query(`UPDATE setup_jobs SET failed_steps = failed_steps + 1 WHERE id = $1`, [jobId]);

    throw err; // Let BullMQ handle retry
  }
}

// ============================================================
// Action handlers — one per Zoho operation type
// ============================================================

type ActionHandler = (
  customerId: string,
  config: any,
  stepId: string
) => Promise<StepResult>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  /**
   * Create a custom field on a CRM module
   */
  async create_field(customerId, config, stepId): Promise<StepResult> {
    const { module: moduleName, field_label, data_type, api_name, values } = config;

    // Check if field already exists
    const existing = await crmApi.getFields(customerId, moduleName);
    const existingField = existing.fields?.find(
      (f: any) => f.api_name === api_name || f.field_label === field_label
    );

    if (existingField) {
      return {
        status: 'completed',
        resourceId: existingField.id,
        resourceName: field_label,
        details: { alreadyExisted: true },
      };
    }

    const fieldConfig: any = {
      field_label,
      data_type,
      api_name,
    };

    // Add picklist values if specified
    if (data_type === 'picklist' && values) {
      fieldConfig.pick_list_values = values.map((v: string) => ({
        display_value: v,
        actual_value: v,
      }));
    }

    const result = await crmApi.createField(customerId, moduleName, fieldConfig, stepId);
    const createdField = result.fields?.[0];

    return {
      status: 'completed',
      resourceId: createdField?.id || 'unknown',
      resourceName: field_label,
      details: createdField,
    };
  },

  /**
   * Update a picklist field — add new values without removing existing ones
   */
  async update_picklist(customerId, config, stepId): Promise<StepResult> {
    const { module: moduleName, field: fieldName, values, append_values } = config;

    // Get the current field to find its ID and existing values
    const fieldsResponse = await crmApi.getFields(customerId, moduleName);
    const field = fieldsResponse.fields?.find(
      (f: any) => f.api_name === fieldName || f.field_label === fieldName
    );

    if (!field) {
      throw new Error(`Field ${fieldName} not found on module ${moduleName}`);
    }

    // Build the new picklist values
    const existingValues = (field.pick_list_values || []).map((v: any) => v.display_value);
    const newValues = append_values || values || [];
    const allValues = values
      ? newValues // replace mode
      : [...new Set([...existingValues, ...newValues])]; // append mode

    const pickListValues = allValues.map((v: string) => ({
      display_value: v,
      actual_value: v,
    }));

    await crmApi.updateField(
      customerId,
      moduleName,
      field.id,
      { pick_list_values: pickListValues },
      stepId
    );

    return {
      status: 'completed',
      resourceId: field.id,
      resourceName: fieldName,
      details: { addedValues: newValues, totalValues: allValues.length },
    };
  },

  /**
   * Create a workflow rule
   */
  async create_workflow(customerId, config, stepId): Promise<StepResult> {
    const { module: moduleName, name, trigger, condition, actions } = config;

    // Check if a workflow with this name already exists
    const existing = await crmApi.getWorkflowRules(customerId, moduleName);
    const existingRule = existing.data?.find((r: any) => r.name === name);

    if (existingRule) {
      return {
        status: 'completed',
        resourceId: existingRule.id,
        resourceName: name,
        details: { alreadyExisted: true },
      };
    }

    // Build workflow rule config per Zoho CRM API v6
    const ruleConfig: any = {
      name,
      module: { api_name: moduleName },
      trigger: { type: trigger }, // 'workflow_action' for on_create etc.
    };

    // Note: Zoho's workflow rule creation API is complex — 
    // conditions and actions have specific schemas per trigger type.
    // This is a simplified version; expand as needed.
    if (condition) {
      ruleConfig.criteria = buildCriteria(condition);
    }

    const result = await crmApi.createWorkflowRule(customerId, ruleConfig, stepId);
    const created = result.data?.[0];

    return {
      status: 'completed',
      resourceId: created?.id || 'unknown',
      resourceName: name,
      details: created,
    };
  },

  /**
   * Verify CRM connection is working
   */
  async verify_connection(customerId, _config, stepId): Promise<StepResult> {
    const orgInfo = await crmApi.getOrg(customerId);
    return {
      status: 'completed',
      details: {
        orgName: orgInfo.data?.[0]?.company_name,
        orgId: orgInfo.data?.[0]?.id,
      },
    };
  },
};

/**
 * Build Zoho CRM criteria object from a simplified condition
 */
function buildCriteria(condition: { field: string; equals?: string; contains?: string }) {
  const comparator = condition.equals ? 'equal' : 'contains';
  const value = condition.equals || condition.contains;

  return {
    group_operator: 'and',
    group: [
      {
        field: { api_name: condition.field },
        comparator,
        value,
      },
    ],
  };
}
