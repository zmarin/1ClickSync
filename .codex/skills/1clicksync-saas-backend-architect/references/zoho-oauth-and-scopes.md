# Zoho OAuth And Scope Rules

Use this reference whenever the task touches onboarding, service actions, token refresh, or any Zoho API capability.

## Current Auth Surface

Relevant files:

- [`src/config.ts`](../../../src/config.ts)
- [`src/api/core-routes.ts`](../../../src/api/core-routes.ts)
- [`src/zoho/oauth.ts`](../../../src/zoho/oauth.ts)
- [`src/zoho/client.ts`](../../../src/zoho/client.ts)

Current entry points:

- `GET /api/auth/zoho`
- `GET /api/auth/zoho/service`
- `GET /api/auth/zoho/callback`
- `DELETE /api/auth/zoho/service`

## Current Token Model

There are two live token paths:

- `zoho_tokens`: legacy full-app tokens
- `zoho_service_tokens`: service-scoped tokens per `(app_id, service)`

Current code already tries service tokens first and falls back to legacy tokens when scopes allow it. Any new auth or scope work must preserve that behavior until the legacy path is intentionally removed.

## First Product Rule

For any user-facing Zoho feature:

1. Authenticate Zoho first.
2. Exchange code for tokens.
3. Encrypt and store tokens.
4. Determine exact required scopes before the feature runs.
5. Compare granted scopes vs required scopes.
6. If scopes are missing, prompt the user to re-authenticate with the added scopes.

Do not attempt the privileged action first and discover scope failure by accident.

## Scope Planning Rules

### Service baseline

Service-level scopes are defined in [`src/config.ts`](../../../src/config.ts) under `ZOHO_SERVICE_SCOPES`.

Use these as the baseline for:

- CRM
- Desk
- Bookings
- SalesIQ
- Books
- Projects
- Mail

### Action-specific scopes

When a new action needs more than the service baseline:

- identify the exact scope names from Zoho docs
- request the union of baseline service scopes plus action-specific scopes
- store the refreshed granted scopes back on the token row
- surface reconnect or re-auth in the UI and API response instead of a vague error

Prefix-only scope checks are not enough for privileged actions. Use exact granted-vs-required comparisons.

## Refresh Rules

Before a Zoho call:

- check whether the token is expiring soon
- refresh if necessary
- persist refreshed values
- continue the action

If refresh fails permanently:

- mark the connection invalid or reconnect-required
- fail the action clearly
- do not keep retrying as if the error were transient

## Retry Rules

Retry only transient failures, such as:

- network errors
- timeouts
- HTTP 429
- recoverable 5xx responses

Do not retry:

- missing scope
- missing consent
- bad payload mapping
- invalid module or field names
- confirmed auth failure after refresh has failed

## Datacenter Rules

1ClickSync already supports multiple Zoho datacenters. Any new auth flow or connector change must respect the current DC-aware URL construction in [`src/config.ts`](../../../src/config.ts) and [`src/zoho/oauth.ts`](../../../src/zoho/oauth.ts).

Do not hardcode `.com` endpoints into new behavior.
