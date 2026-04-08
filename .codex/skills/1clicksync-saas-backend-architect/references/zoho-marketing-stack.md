# Zoho Marketing Stack For 1ClickSync

Use this reference when the task expands 1ClickSync beyond forms and operational routes into a real marketing layer.

## Product Framing

Do not build “outreach” as a single vague feature.

Build a repeatable marketing pipeline:

landing page or app event -> lead capture -> segmentation -> email nurture -> on-site chat and tracking -> CRM follow-up -> attribution

That framing keeps the work productizable and prevents a grab-bag of disconnected APIs.

## Service Roles

### Zoho Campaigns

Use for:

- email lists
- contacts and segmentation inputs
- campaign creation and sending
- campaign reporting

This is the email delivery and campaign layer.

### Zoho Marketing Automation

Use for:

- nurture journeys
- triggered sequences
- re-engagement flows
- Web Assistant domain tracking code
- automation around lead behavior

This is the automation and website-tracking layer.

### Zoho SalesIQ

Use for:

- on-site chat
- visitor tracking
- visitor enrichment
- widget install and customization
- conversion assistance

This is the chat and live-conversion layer.

### Zoho CRM

Use for:

- lead storage
- lifecycle stage
- marketing-to-sales handoff
- attribution anchor

This is the source of truth for lead status and downstream sales work.

## Productization Rules

- Start from a specific pipeline stage, not from “support all marketing.”
- Keep ownership per service explicit.
- Reuse the auth-first, scope-aware Zoho model already used elsewhere in the repo.
- If a new action writes remotely, treat it like other external write paths: validate, persist, and consider async-safe execution.
- Prefer beginner-first templates such as welcome nurture, trial follow-up, or marketing-origin lead capture instead of exposing raw API surfaces first.

## Feasible API-Backed Capabilities

Based on the user-provided product direction, serious API-backed features can include:

- pushing leads into Campaigns lists
- assigning contacts to nurture segments
- creating or scheduling campaigns
- inserting leads into Marketing Automation journeys
- embedding Web Assistant tracking code
- installing or customizing SalesIQ widget behavior
- syncing engaged leads into CRM for follow-up

These should be modeled as a coherent pipeline, not as isolated “outreach” toggles.
