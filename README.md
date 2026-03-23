# 1ClickSync

**Zoho integration generator for developer-owned apps. Connect your account, generate working integration code in minutes.**

## What It Does

1ClickSync connects to your Zoho account via OAuth and generates developer-facing integration artifacts for supported Zoho tools:

- Copy-paste HTML/JS starters
- Sample request and response payloads
- A machine-readable project manifest
- An LLM prompt you can paste into ChatGPT, Cursor, or Claude

Current GA exports cover Zoho CRM routes, Zoho Desk routes, Zoho Bookings routes, Zoho Books contact routes, Zoho Projects task routes, and a Zoho SalesIQ widget starter.

## Product Direction

1ClickSync is now centered on helping developers and agencies ship Zoho integrations faster.

- `GA`: CRM, Desk, Bookings, Books contacts, Projects, SalesIQ widget export
- `Beta`: Books invoice workflows until invoice-specific configuration is added
- `Legacy`: Template-driven setup automation remains in the codebase for backward compatibility, but it is no longer the primary product surface

## Architecture

```text
┌─────────────┐     ┌────────────────────────────────────────┐
│ Dashboard   │────▶│ Fastify API (Node.js + TypeScript)     │
│ (HTML/JS)   │     │ - Auth (JWT + bcrypt)                  │
└─────────────┘     │ - Zoho OAuth                           │
                    │ - Manifest / prompt / export endpoints │
                    │ - Billing + account flows              │
                    └──────────┬─────────────────────────────┘
                               │
                    ┌──────────▼─────────────────────────────┐
                    │ BullMQ Job Queue (Redis-backed)         │
                    │ - Legacy setup automation only          │
                    │ - Rate limited and retryable            │
                    └──────────┬─────────────────────────────┘
                               │
                    ┌──────────▼─────────────────────────────┐
                    │ Zoho APIs                               │
                    │ - CRM / Desk / Books / SalesIQ         │
                    └────────────────────────────────────────┘
```

## Quick Start

```bash
npm install
docker compose up postgres redis -d
cp .env.example .env
npm run db:migrate
npm run dev
npm run dev:worker
```

The app runs at `http://localhost:3000/app`.

For a lightweight API regression pass, run `npm run test:smoke` after migrations.

## Core API Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login and return JWT |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/forgot-password` | Request reset email |
| POST | `/api/auth/reset-password` | Reset password with token |

### Projects And Exports

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/apps` | Create project |
| GET | `/api/apps` | List projects |
| GET | `/api/apps/:appId` | Project detail |
| PATCH | `/api/apps/:appId` | Update project |
| GET | `/api/apps/:appId/manifest` | Developer manifest |
| GET | `/api/apps/:appId/prompt` | LLM integration prompt |
| GET | `/api/apps/:appId/exports/:integrationId?target=html-js` | HTML/JS export |

### Zoho Connection And Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/zoho` | Start Zoho OAuth flow |
| GET | `/api/auth/zoho/callback` | OAuth callback |
| GET | `/api/connection/:customerId` | Check Zoho connection status |
| POST | `/api/forms` | Create a generated route |
| GET | `/api/forms` | List generated routes |
| GET | `/api/forms/:formId` | Get route detail + legacy embed code |
| POST | `/api/f/:formKey` | Public submission endpoint |

### Legacy Automation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates` | List legacy setup templates |
| POST | `/api/setup/start` | Trigger legacy setup job |
| GET | `/api/setup/status/:jobId` | Check legacy job status |

## Project Structure

```text
src/
├── server.ts
├── worker.ts
├── api/
│   ├── app-routes.ts
│   ├── core-routes.ts
│   ├── export-utils.ts
│   └── forms.ts
├── auth/
├── billing/
├── db/
├── email/
├── queue/
├── security/
├── templates/
└── zoho/
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for the current Dokploy/Hetzner deployment notes.

## License

Proprietary — all rights reserved.
