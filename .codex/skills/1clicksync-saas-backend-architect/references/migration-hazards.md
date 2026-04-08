# Migration Hazards In This Repo

Use this reference before making structural changes.

## `apps` vs `customers`

The repo is mid-migration:

- `apps` is the modern product model
- `customers` still exists for backward compatibility
- several routes and DB writes still support both

Hazard:

- any rewrite that assumes only `apps` exist will miss dual reads, dual writes, and fallback behavior

Relevant places:

- [`src/api/app-routes.ts`](../../../src/api/app-routes.ts)
- [`src/api/forms.ts`](../../../src/api/forms.ts)
- [`src/api/core-routes.ts`](../../../src/api/core-routes.ts)
- [`005_create_apps_and_reparent.sql`](../../../src/db/migrations/005_create_apps_and_reparent.sql)

Default rule:

- build app-centered changes first
- keep compatibility bridges explicit
- remove legacy behavior only after parity is verified

## `form_configs` Is Broader Than The Name Suggests

Current `form_configs` stores more than contact forms. It already backs CRM, Desk, Bookings, Books, and Projects starter routes.

Hazard:

- treating it as a pure form-builder table or renaming behavior without a migration plan can break current exports, prompts, and public routes

## Public Submit Path Is Not Yet Queue-Safe

`POST /api/f/:formKey` in [`src/api/forms.ts`](../../../src/api/forms.ts) currently:

- persists the submission
- attempts Zoho dispatch inline
- can still return success if sync fails or Zoho is unavailable

Hazard:

- retries, browser re-submits, or process crashes can duplicate side effects
- changing this path safely requires idempotency, queueing, and state-transition planning

## Legacy Setup Queue Still Shapes Part Of The Repo

`setup_jobs` and `setup_steps` still exist and are processed by the worker.

Hazard:

- features can accidentally split into two provisioning models: legacy queued setup and modern direct workspace actions

Default rule:

- do not add a third path
- either reuse the existing guided workspace actions or intentionally isolate legacy setup

## Smoke-Tested Outputs Matter

The current repo promises more than CRUD:

- app manifests
- prompts
- exports
- SalesIQ widget starter/export
- public submit endpoints

Hazard:

- a cleanup that removes these outputs without replacement will break real product behavior and likely the smoke contract in [`src/tests/smoke.ts`](../../../src/tests/smoke.ts)

Default rule:

- preserve these outputs or retire them intentionally with test updates and user-visible migration notes
