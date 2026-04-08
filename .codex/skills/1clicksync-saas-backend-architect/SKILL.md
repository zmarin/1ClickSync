---
name: 1clicksync-saas-backend-architect
description: Use when modifying 1ClickSync backend or infrastructure behavior in the current Fastify/TypeScript repo, especially `src/api/*`, `src/zoho/*`, `src/queue/*`, `src/worker.ts`, `src/db/migrations/*`, public ingestion, Zoho OAuth/scopes, template-backed onboarding, reliability, or Dokploy deployment changes.
---

# 1ClickSync SaaS Backend Architect

## Overview

Use this skill to keep 1ClickSync changes production-safe, app-centered, Zoho-auth-first, and grounded in the current Fastify/TypeScript codebase. This skill is for backend behavior, integrations, queues, migrations, and deployment discipline, not for generic greenfield platform design or UI polish.

## Start Here

Before changing code, identify which of these areas the task touches:

- database tables and migrations
- API routes and request contracts
- service or orchestration logic
- worker and queue behavior
- Zoho OAuth, scopes, and token refresh
- deployment or environment variables
- existing product outputs that must stay compatible

Read the matching references before proposing the solution:

- [`references/current-architecture.md`](./references/current-architecture.md) for the current repo shape
- [`references/zoho-oauth-and-scopes.md`](./references/zoho-oauth-and-scopes.md) for auth, token storage, refresh, and scope-gap handling
- [`references/migration-hazards.md`](./references/migration-hazards.md) for `apps`/`customers` compatibility and public submit hazards
- [`references/zoho-marketing-stack.md`](./references/zoho-marketing-stack.md) when the task expands into Campaigns, Marketing Automation, SalesIQ, or CRM-driven marketing flows
- [`checklists/backend-change.md`](./checklists/backend-change.md) for the default implementation checklist
- [`checklists/deployment.md`](./checklists/deployment.md) when the change affects Dokploy, env vars, app/worker coordination, or rollout order

## Repo Reality

Treat these as default truths unless the user explicitly asks to replatform:

- stack: Fastify + TypeScript + PostgreSQL + Redis + BullMQ + Dokploy
- primary product entity: `apps`
- migration compatibility entity: `customers`
- current Zoho token model: legacy full-app tokens plus service-scoped tokens
- current product outputs to preserve or explicitly retire: app manifests, prompts, exports, public submit endpoints, SalesIQ starter/export behavior
- beginner-friendly v1 direction: Zoho auth first, then template choice, then minimal configuration, then publish and inspect logs

Do not silently replace this with Python/FastAPI assumptions.

## Non-Negotiable Rules

- Treat `apps` as canonical. `customers` is a compatibility shim until intentionally removed.
- Keep route handlers thin. Put orchestration in services and Zoho-specific behavior in connectors.
- Default public ingestion and Zoho write actions to queue-backed or async-safe execution. Read-only discovery or admin probes may stay synchronous when safe.
- Preserve existing product outputs unless the task explicitly retires them with migration coverage.
- Prefer small vertical slices: migration, service, route, worker, test, docs/env.
- Prefer beginner-safe templates and app-centered flows over broad new platform abstractions.
- Do not log tokens, refresh secrets, or raw credentials.

## Zoho Auth-First Workflow

For any user-facing Zoho capability, think in this order:

1. Authenticate the Zoho account.
2. Exchange the auth code for tokens.
3. Encrypt and store the tokens.
4. Identify the exact scopes required by the chosen template, service action, or write path.
5. Compare required scopes against the scopes stored on the current token row.
6. If scopes are missing, require re-auth with the merged scope request before attempting the action.
7. Refresh expiring tokens before remote calls.
8. Retry only after auth and scope validity are known.

Do not treat permission failures as a substitute for scope planning.

## Default Decision Patterns

### If the task changes public ingestion

- Persist the inbound record before remote side effects.
- Decide idempotency strategy up front.
- Prefer accept-and-enqueue over inline Zoho writes.
- Define retryable and terminal failure states explicitly.

### If the task changes a Zoho action

- Identify exact required scopes first.
- Check whether existing service-scoped tokens are enough.
- If not, add a reconnect or re-auth path instead of assuming baseline service scopes are sufficient.
- Keep payload mapping and connector logic out of routes.

### If the task changes onboarding or templates

- Start from the beginner goal, not from service discovery jargon.
- Connect Zoho first.
- Choose a small template set.
- Reuse existing app, form, prompt, and export infrastructure where possible.
- Keep advanced workspace behavior behind the simpler front door instead of duplicating provisioning logic.

### If the task changes schema or compatibility

- Use additive migrations first.
- Call out `apps` vs `customers` consequences explicitly.
- Do not make `settings` the silent source of truth for core operational data.
- Preserve old read paths until parity is proven, then retire them intentionally.

## Output Expectations

For non-trivial backend work, explicitly cover:

- scope
- DB/API/service/worker/env impact
- Zoho auth and scope implications
- compatibility or migration hazards
- smallest safe implementation slice
- verification commands and rollout notes

Keep user-facing summaries concise, but do not skip architecture impact.

## Anti-Patterns

Avoid these:

- starting from route code before checking DB, worker, auth, and migration impact
- replatforming to Python or inventing a new stack without being asked
- synchronous Zoho writes in public ingestion by default
- dropping manifest, prompt, export, or public submit behavior accidentally
- treating `form_configs` as if it were a generic platform entity without acknowledging current behavior
- duplicating new flows and legacy flows without a retirement plan
- describing a vague “outreach feature” instead of a full marketing pipeline when building Zoho marketing capabilities

## Marketing Layer Guidance

If the task is about marketing, build a pipeline, not a vague outreach tool:

landing page or app event -> lead capture -> segmentation -> email nurture -> on-site chat/tracking -> CRM handoff -> attribution

Map Zoho services this way:

- Zoho Campaigns: lists, contacts, campaigns, send/reporting
- Zoho Marketing Automation: journeys, tracking code, triggered nurture
- Zoho SalesIQ: live chat, visitor tracking, widget customization
- Zoho CRM: source of truth for lead lifecycle and sales handoff

Treat this as a staged system with explicit ownership per service, not as a single magic switch.

## Use This Skill To Push Back

Push back when a change would:

- ignore missing OAuth scopes
- write to Zoho inline in a public request path without good reason
- create cross-tenant risk
- skip idempotency on public or retryable paths
- add destructive schema changes without migration planning
- duplicate existing app-centered behavior with a new parallel abstraction

Build code that survives real users, real token issues, and real Zoho failures.
