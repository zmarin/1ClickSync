# Current 1ClickSync Architecture

Use this reference when the task needs to stay grounded in the current repo rather than drifting into a fresh platform design.

## Stack

- API server: Fastify + TypeScript in [`src/server.ts`](../../../src/server.ts)
- Auth: JWT and optional Google auth in [`src/auth`](../../../src/auth)
- Billing: Stripe in [`src/billing`](../../../src/billing)
- Data store: PostgreSQL via [`src/db/index.ts`](../../../src/db/index.ts)
- Queue/runtime: Redis + BullMQ
- Worker: [`src/worker.ts`](../../../src/worker.ts)
- Deployment target: Dokploy with app + worker + postgres + redis

## Canonical Product Entities

Current repo reality:

- `users`
- `apps` as the primary product/workspace entity
- `customers` as legacy compatibility
- `form_configs` as current route/starter storage
- `form_submissions` as current public execution log
- `zoho_tokens` for legacy app-wide tokens
- `zoho_service_tokens` for service-scoped tokens
- `setup_jobs` and `setup_steps` for legacy queue-driven setup automation

Relevant migrations:

- [`001_initial_schema.sql`](../../../src/db/migrations/001_initial_schema.sql)
- [`002_webform_configs.sql`](../../../src/db/migrations/002_webform_configs.sql)
- [`005_create_apps_and_reparent.sql`](../../../src/db/migrations/005_create_apps_and_reparent.sql)
- [`009_legacy_setup_compat.sql`](../../../src/db/migrations/009_legacy_setup_compat.sql)
- [`011_zoho_service_tokens.sql`](../../../src/db/migrations/011_zoho_service_tokens.sql)

## Primary API Surfaces

### App and export surface

[`src/api/app-routes.ts`](../../../src/api/app-routes.ts)

Owns:

- `/api/apps`
- `/api/apps/:appId`
- `/api/apps/:appId/manifest`
- `/api/apps/:appId/prompt`
- `/api/apps/:appId/exports/:integrationId`

These are current product features, not disposable scaffolding.

### Forms and public submission surface

[`src/api/forms.ts`](../../../src/api/forms.ts)

Owns:

- `/api/forms`
- `/api/forms/:formId`
- `/api/forms/presets/:module`
- `POST /api/f/:formKey`

Important current behavior:

- CRUD and starter generation live here.
- Public submissions still execute Zoho writes inline today.
- The embed snippet generated here is part of the current product contract.

### OAuth and legacy setup compatibility surface

[`src/api/core-routes.ts`](../../../src/api/core-routes.ts)

Owns:

- `/api/auth/zoho`
- `/api/auth/zoho/service`
- `/api/auth/zoho/callback`
- `/api/templates`
- `/api/setup/start`
- `/api/setup/status/:jobId`
- compatibility customer creation and connection checks

### Capability workspace surface

[`src/api/zoho-capabilities.ts`](../../../src/api/zoho-capabilities.ts)

Owns:

- service discovery
- action metadata
- handoff bundle generation
- project context
- entity discovery

This file is large and platform-shaped. Do not expand it casually without checking whether the task should instead reuse or split existing behavior.

## Worker Reality

[`src/worker.ts`](../../../src/worker.ts)

Current worker owns:

- legacy setup job processing
- maintenance jobs like token refresh

It does not yet own public `POST /api/f/:formKey` submission processing. That is one of the current reliability gaps.

## Product Outputs To Preserve Or Retire Intentionally

Before changing product behavior, check whether the task affects:

- app manifests
- LLM prompts
- HTML/JS exports
- SalesIQ widget export
- public submit URLs
- existing smoke-test expectations

Current smoke contract:

- [`src/tests/smoke.ts`](../../../src/tests/smoke.ts)

Do not remove existing outputs by accident.
