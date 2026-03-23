import assert from 'node:assert/strict';
import { buildServer } from '../server';
import { queryOne, pool } from '../db';
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

async function main() {
  const app = await buildServer({ scheduleMaintenance: false });

  try {
    await app.ready();

    const now = Date.now();
    const email = `smoke-${now}@example.com`;
    const password = 'SmokeTestPass123!';

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password,
        name: 'Smoke Test User',
        company: '1ClickSync QA',
      },
    });
    expectStatus(registerResponse.statusCode, 201, 'register user', registerResponse.body);
    const registerBody = registerResponse.json() as { token: string; user: { id: string } };
    const token = registerBody.token;

    const createProjectResponse = await app.inject({
      method: 'POST',
      url: '/api/apps',
      headers: authHeaders(token),
      payload: {
        name: 'Smoke Project',
        domain: 'https://example.com',
        business_type: 'saas',
        zoho_tools: ['crm', 'desk', 'bookings', 'books', 'projects', 'salesiq'],
      },
    });
    expectStatus(createProjectResponse.statusCode, 201, 'create project', createProjectResponse.body);
    const project = createProjectResponse.json() as { id: string; name: string };

    const listProjectsResponse = await app.inject({
      method: 'GET',
      url: '/api/apps',
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(listProjectsResponse.statusCode, 200, 'list projects', listProjectsResponse.body);
    const projects = listProjectsResponse.json() as Array<{ id: string }>;
    assert.equal(projects.length, 1, 'new user should have exactly one project after first project creation');

    const appRow = await queryOne<{ id: string }>('SELECT id FROM apps WHERE id = $1', [project.id]);
    const customerRow = await queryOne<{ id: string }>('SELECT id FROM customers WHERE id = $1', [project.id]);
    assert.ok(appRow, 'project row should exist in apps');
    assert.ok(customerRow, 'backward-compatible customer row should exist for the project');

    const crmRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/forms',
      headers: authHeaders(token),
      payload: {
        app_id: project.id,
        route_type: 'crm',
        name: 'Inbound Lead Route',
        target_module: 'Leads',
        fields: [
          { name: 'last_name', label: 'Last Name', type: 'text', required: true, zoho_field: 'Last_Name' },
          { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'Email' },
          { name: 'message', label: 'Message', type: 'textarea', required: false, zoho_field: 'Description' },
        ],
        style: {
          buttonText: 'Send Lead',
          successMessage: 'Lead captured.',
        },
      },
    });
    expectStatus(crmRouteResponse.statusCode, 201, 'create CRM route', crmRouteResponse.body);
    const crmRoute = crmRouteResponse.json() as { form: { id: string; form_key: string } };

    const deskRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/forms',
      headers: authHeaders(token),
      payload: {
        app_id: project.id,
        route_type: 'desk',
        name: 'Support Ticket Route',
        target_module: 'Tickets',
        fields: [
          { name: 'subject', label: 'Subject', type: 'text', required: true, zoho_field: 'subject' },
          { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'email' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, zoho_field: 'description' },
        ],
        style: {
          successMessage: 'Ticket received.',
        },
      },
    });
    expectStatus(deskRouteResponse.statusCode, 201, 'create Desk route', deskRouteResponse.body);
    const deskRoute = deskRouteResponse.json() as { form: { id: string } };

    const booksRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/forms',
      headers: authHeaders(token),
      payload: {
        app_id: project.id,
        route_type: 'books',
        name: 'Books Contact Route',
        target_module: 'Contacts',
        fields: [
          { name: 'contact_name', label: 'Contact Name', type: 'text', required: true, zoho_field: 'contact_name' },
          { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'email' },
        ],
        style: {
          successMessage: 'Contact captured.',
        },
      },
    });
    expectStatus(booksRouteResponse.statusCode, 201, 'create Books contact route', booksRouteResponse.body);
    const booksRoute = booksRouteResponse.json() as { form: { id: string } };

    const bookingsRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/forms',
      headers: authHeaders(token),
      payload: {
        app_id: project.id,
        route_type: 'bookings',
        name: 'Appointment Booking Route',
        target_module: 'Appointments',
        fields: [
          { name: 'name', label: 'Full Name', type: 'text', required: true, zoho_field: 'customer_name' },
          { name: 'email', label: 'Email', type: 'email', required: true, zoho_field: 'customer_email' },
          { name: 'preferred_date', label: 'Preferred Date', type: 'date', required: true, zoho_field: 'from_time' },
          { name: 'preferred_time', label: 'Preferred Time', type: 'time', required: true, zoho_field: 'time_slot' },
        ],
        style: {
          buttonText: 'Book Appointment',
          successMessage: 'Appointment request received.',
          service_id: 'booking-service-123',
          staff_id: 'booking-staff-456',
          timezone: 'UTC',
        },
      },
    });
    expectStatus(bookingsRouteResponse.statusCode, 201, 'create Bookings route', bookingsRouteResponse.body);
    const bookingsRoute = bookingsRouteResponse.json() as { form: { id: string } };

    const projectsRouteResponse = await app.inject({
      method: 'POST',
      url: '/api/forms',
      headers: authHeaders(token),
      payload: {
        app_id: project.id,
        route_type: 'projects',
        name: 'Project Task Route',
        target_module: 'Tasks',
        fields: [
          { name: 'task_name', label: 'Task Name', type: 'text', required: true, zoho_field: 'name' },
          { name: 'description', label: 'Description', type: 'textarea', required: false, zoho_field: 'description' },
          { name: 'priority', label: 'Priority', type: 'select', required: false, zoho_field: 'priority', options: ['None', 'Low', 'Medium', 'High'] },
          { name: 'due_date', label: 'Due Date', type: 'date', required: false, zoho_field: 'end_date' },
        ],
        style: {
          buttonText: 'Create Task',
          successMessage: 'Task request received.',
          portalId: 'portal-123',
          projectId: 'project-456',
          defaultPriority: 'Medium',
        },
      },
    });
    expectStatus(projectsRouteResponse.statusCode, 201, 'create Projects route', projectsRouteResponse.body);
    const projectsRoute = projectsRouteResponse.json() as { form: { id: string } };

    const manifestResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(manifestResponse.statusCode, 200, 'fetch manifest', manifestResponse.body);
    const manifest = manifestResponse.json() as {
      integrations: Array<{ id: string; tool: string; kind: string; status: string }>;
      supported_integration_kinds: string[];
      exports: { integration_export_template: string };
    };
    assert.ok(manifest.supported_integration_kinds.includes('form_route'));
    assert.ok(manifest.supported_integration_kinds.includes('embed_widget'));
    assert.ok(manifest.integrations.some((item) => item.id === 'salesiq-widget' && item.kind === 'embed_widget'));
    assert.ok(manifest.integrations.some((item) => item.id === crmRoute.form.id && item.tool === 'crm'));
    assert.ok(manifest.integrations.some((item) => item.id === deskRoute.form.id && item.tool === 'desk'));
    assert.ok(manifest.integrations.some((item) => item.id === booksRoute.form.id && item.tool === 'books'));
    assert.ok(manifest.integrations.some((item) => item.id === bookingsRoute.form.id && item.tool === 'bookings'));
    assert.ok(manifest.integrations.some((item) => item.id === projectsRoute.form.id && item.tool === 'projects'));

    const promptResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/prompt`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(promptResponse.statusCode, 200, 'fetch prompt', promptResponse.body);
    assert.match(promptResponse.body, /Zoho Integration Generator Prompt/);
    assert.match(promptResponse.body, /SalesIQ Widget Export/);

    const crmExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/${crmRoute.form.id}?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(crmExportResponse.statusCode, 200, 'fetch CRM export', crmExportResponse.body);
    const crmExport = crmExportResponse.json() as {
      kind: string;
      sample_request: { url: string; body: Record<string, string> };
      sample_response: { success: boolean };
      snippet: string;
    };
    assert.equal(crmExport.kind, 'form_route');
    assert.match(crmExport.snippet, /Inbound Lead Route/);
    assert.match(crmExport.sample_request.url, /\/api\/f\//);
    assert.equal(crmExport.sample_response.success, true);

    const deskExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/${deskRoute.form.id}?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(deskExportResponse.statusCode, 200, 'fetch Desk export', deskExportResponse.body);
    const deskExport = deskExportResponse.json() as { tool: string; sample_request: { body: Record<string, string> } };
    assert.equal(deskExport.tool, 'desk');
    assert.equal(deskExport.sample_request.body.subject, 'Need help with onboarding');

    const booksExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/${booksRoute.form.id}?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(booksExportResponse.statusCode, 200, 'fetch Books export', booksExportResponse.body);
    const booksExport = booksExportResponse.json() as { tool: string; sample_request: { body: Record<string, string> } };
    assert.equal(booksExport.tool, 'books');
    assert.equal(booksExport.sample_request.body.contact_name, 'Ada Lovelace');

    const salesIqExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/salesiq-widget?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(salesIqExportResponse.statusCode, 200, 'fetch SalesIQ export', salesIqExportResponse.body);
    const salesIqExport = salesIqExportResponse.json() as { kind: string; snippet: string; instructions: string[] };
    assert.equal(salesIqExport.kind, 'embed_widget');
    assert.match(salesIqExport.snippet, /PASTE_YOUR_SALESIQ_WIDGET_CODE/);
    assert.ok(salesIqExport.instructions.length >= 2);

    const bookingsExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/${bookingsRoute.form.id}?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(bookingsExportResponse.statusCode, 200, 'fetch Bookings export', bookingsExportResponse.body);
    const bookingsExport = bookingsExportResponse.json() as {
      tool: string;
      integration_config: Record<string, string>;
      sample_request: { body: Record<string, string> };
    };
    assert.equal(bookingsExport.tool, 'bookings');
    assert.equal(bookingsExport.integration_config.service_id, 'booking-service-123');
    assert.equal(bookingsExport.sample_request.body.preferred_date, '2026-03-23');

    const projectsExportResponse = await app.inject({
      method: 'GET',
      url: `/api/apps/${project.id}/exports/${projectsRoute.form.id}?target=html-js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expectStatus(projectsExportResponse.statusCode, 200, 'fetch Projects export', projectsExportResponse.body);
    const projectsExport = projectsExportResponse.json() as {
      tool: string;
      integration_config: Record<string, string>;
      sample_request: { body: Record<string, string> };
    };
    assert.equal(projectsExport.tool, 'projects');
    assert.equal(projectsExport.integration_config.projectId, 'project-456');
    assert.equal(projectsExport.sample_request.body.priority, 'example_priority');

    const publicSubmitResponse = await app.inject({
      method: 'POST',
      url: `/api/f/${crmRoute.form.form_key}`,
      payload: {
        last_name: 'Lovelace',
        email: 'ada@example.com',
        message: 'Generated from smoke test',
      },
    });
    expectStatus(publicSubmitResponse.statusCode, 200, 'submit public CRM route', publicSubmitResponse.body);
    const publicSubmit = publicSubmitResponse.json() as { success: boolean; message: string };
    assert.equal(publicSubmit.success, true);
    assert.equal(publicSubmit.message, 'Lead captured.');

    const resetPageResponse = await app.inject({ method: 'GET', url: '/app?reset_token=smoke-token' });
    expectStatus(resetPageResponse.statusCode, 200, 'load reset password app route', resetPageResponse.body);
    assert.match(resetPageResponse.body, /resetForm/);

    const checkoutPageResponse = await app.inject({ method: 'GET', url: '/app?checkout=success' });
    expectStatus(checkoutPageResponse.statusCode, 200, 'load billing return app route', checkoutPageResponse.body);
    assert.match(checkoutPageResponse.body, /Zoho Integration Generator/);

    console.log('Smoke test passed');
  } finally {
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
