import assert from 'node:assert/strict';
import { buildServer } from '../server';
import { query, pool } from '../db';
import { encrypt } from '../zoho/encryption';
import { flowProducer, maintenanceQueue, redisConnection, setupQueue } from '../queue/setup';

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function expectStatus(actual: number, expected: number, context: string, body: string) {
  assert.equal(actual, expected, `${context} failed with ${actual}: ${body}`);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('/crm/v6/org')) {
      return jsonResponse({
        org: [{ id: 'org-123', company_name: 'Studio Org' }],
      });
    }

    if (url.includes('/crm/v6/settings/modules')) {
      return jsonResponse({
        modules: [
          { api_name: 'Leads', plural_label: 'Leads', singular_label: 'Lead' },
          { api_name: 'Contacts', plural_label: 'Contacts', singular_label: 'Contact' },
        ],
      });
    }

    if (url.includes('/crm/v6/settings/layouts')) {
      return jsonResponse({
        layouts: [
          { id: 'layout-1', name: 'Standard' },
        ],
      });
    }

    if (url.includes('/crm/v6/settings/fields?module=Leads')) {
      return jsonResponse({
        fields: [
          {
            id: 'field-lead-source',
            api_name: 'Lead_Source',
            display_label: 'Lead Source',
            pick_list_values: [
              { id: 'ls-1', display_value: 'Website A', actual_value: 'Website A', type: 'used' },
              { id: 'ls-2', display_value: 'Website B', actual_value: 'Website B', type: 'used' },
            ],
          },
          {
            id: 'field-email',
            api_name: 'Email',
            display_label: 'Email',
          },
        ],
      });
    }

    if (url.includes('/api/v1/departments')) {
      return jsonResponse({
        data: [{ id: 'dept-1', name: 'Support' }],
      });
    }

    if (url.includes('/api/v1/ticketFields')) {
      return jsonResponse({
        data: [{ id: 'ticket-subject', displayLabel: 'Subject' }],
      });
    }

    if (url.includes('/bookings/v1/json/availableslots')) {
      return jsonResponse({
        services: [{ serviceId: 'svc-1', name: 'Consultation', staff_name: 'Alex' }],
        staff: [{ staff_id: 'staff-1', name: 'Alex' }],
      });
    }

    if (url.includes('/books/v3/contacts')) {
      return jsonResponse({
        contacts: [{ contact_id: 'contact-1', contact_name: 'Ada Lovelace', email: 'ada@example.com' }],
      });
    }

    if (url.includes('/books/v3/items')) {
      return jsonResponse({
        items: [{ item_id: 'item-1', name: 'Starter' }],
      });
    }

    if (url.includes('/restapi/portals/')) {
      return jsonResponse({
        portals: [{ id: 'portal-1', name: 'Main Portal' }],
      });
    }

    if (url.includes('/restapi/portal/portal-1/projects/')) {
      return jsonResponse({
        projects: [{ id: 'project-1', name: 'Studio Rollout' }],
      });
    }

    throw new Error(`Unexpected fetch in studio test: ${url}`);
  }) as typeof fetch;

  const app = await buildServer({ scheduleMaintenance: false });

  try {
    await app.ready();

    const now = Date.now();
    const email = `studio-${now}@example.com`;
    const password = 'StudioTestPass123!';

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password,
        name: 'Studio Test User',
        company: '1ClickSync QA',
      },
    });
    expectStatus(registerResponse.statusCode, 201, 'register user', registerResponse.body);
    const token = (registerResponse.json() as { token: string }).token;

    const createProjectResponse = await app.inject({
      method: 'POST',
      url: '/api/apps',
      headers: authHeaders(token),
      payload: {
        name: 'Studio Project',
        domain: 'https://studio.example.com',
        business_type: 'saas',
        zoho_tools: ['crm', 'desk', 'bookings', 'books', 'projects'],
      },
    });
    expectStatus(createProjectResponse.statusCode, 201, 'create project', createProjectResponse.body);
    const project = createProjectResponse.json() as { id: string };

    const crmOauthResponse = await app.inject({
      method: 'GET',
      url: `/api/auth/zoho/service?app_id=${project.id}&service=crm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(crmOauthResponse.statusCode, 200, 'generate CRM service OAuth URL', crmOauthResponse.body);
    const crmOauth = crmOauthResponse.json() as { service: string; scopes: string[]; url: string };
    assert.equal(crmOauth.service, 'crm');
    assert.ok(crmOauth.scopes.every((scope) => scope.startsWith('ZohoCRM.')), 'CRM OAuth should only request CRM scopes');
    assert.match(decodeURIComponent(crmOauth.url), /ZohoCRM\.modules\.ALL/);
    assert.doesNotMatch(decodeURIComponent(crmOauth.url), /Desk\.tickets\.ALL/);

    await query(
      `INSERT INTO zoho_service_tokens
         (app_id, service, zoho_dc, zoho_org_id, access_token_enc, refresh_token_enc, token_expires_at, scopes, is_valid, connected_at, last_refreshed_at)
       VALUES ($1, $2, 'com', 'org-123', $3, $4, NOW() + INTERVAL '1 day', $5, TRUE, NOW(), NOW())`,
      [
        project.id,
        'crm',
        encrypt('crm-access-token'),
        encrypt('crm-refresh-token'),
        JSON.stringify([
          'ZohoCRM.modules.ALL',
          'ZohoCRM.settings.ALL',
          'ZohoCRM.settings.fields.ALL',
          'ZohoCRM.settings.layouts.ALL',
          'ZohoCRM.org.READ',
        ]),
      ]
    );

    const servicesResponse = await app.inject({
      method: 'GET',
      url: `/api/zoho/services?app_id=${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(servicesResponse.statusCode, 200, 'list studio services', servicesResponse.body);
    const services = (servicesResponse.json() as { services: Array<{ id: string; status: string }> }).services;
    assert.equal(services.find((service) => service.id === 'crm')?.status, 'ready');
    assert.equal(services.find((service) => service.id === 'desk')?.status, 'connect_required');

    const accountResponse = await app.inject({
      method: 'GET',
      url: `/api/zoho/account?app_id=${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(accountResponse.statusCode, 200, 'fetch studio account summary', accountResponse.body);
    const account = accountResponse.json() as {
      services: Record<string, { connected: boolean; status: string; scopes: string[] }>;
    };
    assert.equal(account.services.crm.connected, true);
    assert.equal(account.services.crm.status, 'ready');
    assert.equal(account.services.desk.connected, false);

    const crmResourcesResponse = await app.inject({
      method: 'GET',
      url: `/api/zoho/services/crm/resources?app_id=${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(crmResourcesResponse.statusCode, 200, 'fetch CRM studio resources', crmResourcesResponse.body);
    const crmResources = (crmResourcesResponse.json() as { resources: Array<{ type: string; name: string }> }).resources;
    assert.ok(crmResources.some((resource) => resource.type === 'module' && resource.name === 'Leads'));
    assert.ok(crmResources.some((resource) => resource.type === 'layout' && resource.name === 'Standard'));
    assert.ok(crmResources.some((resource) => resource.type === 'lead_source' && resource.name === 'Website A'));

    const crmActionsResponse = await app.inject({
      method: 'GET',
      url: `/api/zoho/services/crm/actions?app_id=${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(crmActionsResponse.statusCode, 200, 'fetch CRM studio actions', crmActionsResponse.body);
    const crmActions = (crmActionsResponse.json() as { actions: Array<{ id: string }> }).actions;
    assert.ok(crmActions.some((action) => action.id === 'add-lead-source'));

    const promptResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/prompt?service=crm&mode=augment-native`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(promptResponse.statusCode, 200, 'fetch CRM studio prompt', promptResponse.body);
    assert.match(promptResponse.body, /Prompt mode:\s*augment-native/i);
    assert.match(promptResponse.body, /Selected service:\s*CRM/i);
    assert.match(promptResponse.body, /Website A/);

    const appPageResponse = await app.inject({ method: 'GET', url: '/app' });
    expectStatus(appPageResponse.statusCode, 200, 'load studio app shell', appPageResponse.body);
    assert.match(appPageResponse.body, /crmSourcePanel/);
    assert.match(appPageResponse.body, /serviceConnectBtn/);
    assert.match(appPageResponse.body, /serviceDisconnectBtn/);
    assert.match(appPageResponse.body, /googleAuthBtn/);
    assert.match(appPageResponse.body, /params\.get\('token'\)/);

    const disconnectResponse = await app.inject({
      method: 'DELETE',
      url: `/api/auth/zoho/service?app_id=${project.id}&service=crm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(disconnectResponse.statusCode, 200, 'disconnect CRM service token', disconnectResponse.body);

    const servicesAfterDisconnectResponse = await app.inject({
      method: 'GET',
      url: `/api/zoho/services?app_id=${project.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(servicesAfterDisconnectResponse.statusCode, 200, 'list studio services after disconnect', servicesAfterDisconnectResponse.body);
    const servicesAfterDisconnect = (servicesAfterDisconnectResponse.json() as { services: Array<{ id: string; status: string }> }).services;
    assert.equal(servicesAfterDisconnect.find((service) => service.id === 'crm')?.status, 'connect_required');

    console.log('Studio test passed');
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.allSettled([
      app.close(),
      setupQueue.close(),
      maintenanceQueue.close(),
      flowProducer.close(),
      redisConnection.quit(),
      pool.end(),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
