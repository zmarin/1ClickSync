# Stripe Production Setup For Dokploy

This repo now supports three paid plans through Stripe Checkout:

- `starter`: `€19/month`
- `pro`: `€49/month`
- `agency`: `€99/month`

## Current production state

As of `2026-04-08`, the Dokploy compose stack for `1ClickSync` on `https://1clicksync.com` already has:

- `APP_URL=https://1clicksync.com`
- `ZOHO_REDIRECT_URI=https://1clicksync.com/api/auth/zoho/callback`
- `GOOGLE_REDIRECT_URI=https://1clicksync.com/api/auth/google/callback`

It does **not** currently have Stripe configured in the compose env.

## Stripe dashboard values

Use these URLs in Stripe:

- Checkout success URL:
  - `https://1clicksync.com/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`
- Checkout cancel URL:
  - `https://1clicksync.com/app?checkout=cancel`
- Billing portal return URL:
  - `https://1clicksync.com/app?billing=portal`
- Webhook endpoint:
  - `https://1clicksync.com/api/billing/webhook`

Recommended webhook events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## Dokploy env vars to add

Add these to the `1ClickSync` compose env in Dokploy:

```env
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_STARTER_PRICE_ID=price_xxx
STRIPE_PRO_PRICE_ID=price_xxx
STRIPE_AGENCY_PRICE_ID=price_xxx
STRIPE_CHECKOUT_SUCCESS_URL=https://1clicksync.com/app?checkout=success&session_id={CHECKOUT_SESSION_ID}
STRIPE_CHECKOUT_CANCEL_URL=https://1clicksync.com/app?checkout=cancel
STRIPE_PORTAL_RETURN_URL=https://1clicksync.com/app?billing=portal
```

## Products and prices to create in Stripe

Create one recurring monthly price for each product:

1. `1ClickSync Starter`
   - `€19/month`
2. `1ClickSync Pro`
   - `€49/month`
3. `1ClickSync Agency`
   - `€99/month`

Store the resulting `price_...` values in the Dokploy env above.

## Production flow after deploy

1. Redeploy the Dokploy compose stack after adding the new env vars.
2. Create or update the Stripe webhook endpoint to point at `https://1clicksync.com/api/billing/webhook`.
3. Complete a test Checkout session.
4. Confirm `/api/billing/status` shows the new plan and subscription state.
5. Confirm the customer can open `/api/billing/portal` from the app and manage the subscription.
