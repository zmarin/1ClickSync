# 1ClickSync

**Automated Zoho One setup. Connect your account, get a working CRM in minutes.**

## What it does

1ClickSync connects to your Zoho One account via OAuth and runs templated setup jobs — creating CRM fields, deal stages, workflows, and more — so you don't have to click through dozens of screens manually.

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  Dashboard   │────▶│  Fastify API (Node.js + TypeScript)  │
│  (React)     │     │  - Auth (JWT + bcrypt)                │
└─────────────┘     │  - OAuth flow (Zoho)                  │
                    │  - Stripe billing                     │
                    └──────────┬───────────────────────────┘
                               │
                    ┌──────────▼───────────────────────────┐
                    │  BullMQ Job Queue (Redis-backed)      │
                    │  - Rate-limited (15 calls/10s)        │
                    │  - Retryable (3 attempts, exp backoff)│
                    │  - Idempotent (skip completed steps)  │
                    └──────────┬───────────────────────────┘
                               │
                    ┌──────────▼───────────────────────────┐
                    │  Workers                              │
                    │  - CRM: fields, stages, workflows     │
                    │  - Forms: create + map to CRM         │
                    │  - SalesIQ: widget config              │
                    └──────────┬───────────────────────────┘
                               │
                    ┌──────────▼───────────────────────────┐
                    │  Zoho APIs (CRM, Forms, SalesIQ...)   │
                    └──────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install
npm install

# 2. Start Postgres + Redis
docker compose up postgres redis -d

# 3. Configure
cp .env.example .env
# Edit .env with your Zoho OAuth credentials

# 4. Run
npm run dev          # API server on :3000
npm run dev:worker   # Job processor
```

## Project Structure

```
src/
├── server.ts              # Fastify entry point
├── worker.ts              # BullMQ worker entry point
├── config.ts              # Environment + Zoho DC config
├── api/
│   └── routes.ts          # Zoho setup REST endpoints
├── auth/
│   ├── index.ts           # Registration, login, JWT auth
│   └── password-reset.ts  # Forgot/reset password flow
├── billing/
│   └── index.ts           # Stripe subscriptions + webhooks
├── db/
│   └── index.ts           # Postgres pool + helpers
├── email/
│   └── index.ts           # Nodemailer transporter
├── queue/
│   ├── setup.ts           # Queue definitions + job enqueuing
│   └── processors.ts      # Step execution logic
├── security/
│   └── index.ts           # Rate limiting, headers, sanitization
├── zoho/
│   ├── oauth.ts           # OAuth flow + token management
│   ├── client.ts          # Zoho API client + CRM helpers
│   └── encryption.ts      # AES-256-GCM for token storage
└── templates/
    ├── loader.ts           # Template loading + variable resolution
    └── saas-crm-quickstart.json
```

## API Endpoints

### Auth
| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| POST   | /api/auth/register            | Create account                 |
| POST   | /api/auth/login               | Login (returns JWT)            |
| GET    | /api/auth/me                  | Current user profile           |
| POST   | /api/auth/change-password     | Change password (authed)       |
| POST   | /api/auth/forgot-password     | Request reset email            |
| POST   | /api/auth/reset-password      | Reset with token               |

### Zoho Setup
| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| GET    | /health                       | Health check                   |
| POST   | /api/customers                | Create customer                |
| GET    | /api/auth/zoho                | Start Zoho OAuth flow          |
| GET    | /api/auth/zoho/callback       | OAuth callback                 |
| GET    | /api/connection/:customerId   | Check Zoho connection status   |
| GET    | /api/templates                | List available templates       |
| POST   | /api/setup/start              | Trigger a setup job            |
| GET    | /api/setup/status/:jobId      | Get job progress               |

### Billing
| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| POST   | /api/billing/checkout         | Create Stripe checkout session |
| GET    | /api/billing/status           | Get subscription status        |
| POST   | /api/billing/webhook          | Stripe webhook receiver        |

## Production Deploy

See [DEPLOY.md](./DEPLOY.md) for full Dokploy + Hetzner deployment guide.

## License

Proprietary — all rights reserved.
