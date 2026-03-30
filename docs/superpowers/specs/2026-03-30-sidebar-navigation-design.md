# Sidebar Navigation for Connected Zoho Accounts

## Context

The current UI uses a dropdown selector at the top of a linear 6-step workflow to switch between connected Zoho workspaces. This buries account switching and forces users through sequential steps even when they just want to check a specific service. The goal is to add a persistent left sidebar that makes account and service navigation immediate, while keeping the existing workflow content in the main panel.

## Design Decision

**Two-panel Slack-style sidebar** with Zoho light theme (red accent #DC4C3E, white panels, status dots).

Chosen over: simple list sidebar (less scalable) and expandable tree (cluttered with many accounts).

## Layout Structure

Three columns, left to right:

### 1. Icon Bar (56px fixed)
- Vertical strip of account avatars showing 2-letter initials
- Active account: red background (#DC4C3E), white text, subtle shadow
- Inactive accounts: white background, gray text, light border
- "+" button at bottom: dashed border, opens the existing create-workspace + OAuth flow
- State: `currentAppId` in app state (same as today, just different UI trigger)

### 2. Service Panel (170px fixed)
- Header: selected account name in red, bold
- Service list: one row per service (CRM, Desk, Bookings, Mail, Forms, SalesIQ, Books, Projects)
- Each row has:
  - Status dot: green (#4CAF50) = ready, yellow (#FFC107) = reconnect needed, gray (#CCC) = not set up
  - Service name
- Active service: red left border (3px), light red background (#FFF5F4), red text
- Inactive service: transparent left border, #555 text
- Bottom: settings link (optional, for project context editing)
- Data source: existing `GET /api/zoho/services?app_id={appId}` endpoint

### 3. Main Panel (flex, remaining width)
- Background: #FAFBFC
- Content cards (white, rounded corners, light border) for the selected service:

**Card 1 — Connection Status**
- Service name + "Connected" / "Reconnect" badge
- Datacenter, org ID info
- Reconnect button if status is `reconnect_required` or `connect_required`
- Sources: existing step 3 logic + `GET /api/zoho/account`

**Card 2 — App Context** (existing step 2)
- App name, URL, docs URL, target base URL, notes
- Save button → `PUT /api/project-context`
- Only shown when a service is selected (not on account-level view)

**Card 3 — Resources** (existing step 5 resource grid)
- Discovered Zoho resources as tags/chips
- Source: `GET /api/zoho/services/:service/resources?app_id={appId}`

**Card 4 — Actions** (existing step 5 action panel)
- Action buttons: Create Route, Create Record, etc.
- Action selector + JSON payload textarea + result display
- Source: `GET /api/zoho/services/:service/actions?app_id={appId}`

**Card 5 — Handoff Bundle** (existing step 6)
- Goal textarea + Generate button
- Two-column output: prompt markdown + JSON refs
- Source: `POST /api/zoho/handoff-bundle`

### Breadcrumb
- Top of main panel: `AccountName > ServiceName`
- Provides context for what's currently displayed

## Empty State (New User, No Accounts)

- Icon bar: single "+" button with pulsing red dashed border, "Connect" label below
- Service panel: hidden (no account selected)
- Main panel: centered onboarding card with:
  - Link emoji icon
  - "Connect your first Zoho account" heading
  - Brief description of what connecting enables
  - Red "Connect Zoho Account" button → triggers existing OAuth flow

## Navigation Behavior

### Account switching
1. User clicks an account icon in the icon bar
2. `currentAppId` updates in state
3. Service panel re-renders with that account's services (from `GET /api/zoho/services?app_id={newAppId}`)
4. First "ready" service auto-selected, or first service if none ready
5. Main panel loads that service's details

### Service switching
1. User clicks a service in the service panel
2. `activeService` updates in state
3. Main panel re-renders with that service's resources, actions, handoff
4. API calls: resources, actions, references endpoints fire for the new service

### Adding new account
1. User clicks "+" in icon bar
2. A modal or inline form collects workspace name + business type (existing `POST /api/apps` fields)
3. After creation, triggers OAuth flow (`GET /api/auth/zoho?app_id={newAppId}`)
4. On successful callback, new account appears in icon bar, auto-selected

## Theme / Colors

| Element | Color | Usage |
|---------|-------|-------|
| Accent | #DC4C3E | Active items, buttons, account highlight |
| Accent light | #FFF5F4 | Active service background |
| Background | #FAFBFC | Main panel background |
| Panel background | #FFFFFF | Sidebar panels, content cards |
| Border | #E0E3EB | Panel borders, card borders |
| Text primary | #333333 | Headings, main text |
| Text secondary | #555555 | Service names, labels |
| Text muted | #888888 | Descriptions, metadata |
| Status ready | #4CAF50 | Green dot |
| Status warning | #FFC107 | Yellow dot |
| Status inactive | #CCCCCC | Gray dot |
| Status badge bg | #E8F5E9 | "Connected" badge background |
| Status badge text | #2E7D32 | "Connected" badge text |

## Files to Modify

### `public/index.html` (primary — ~1,111 lines)
- **Remove**: `#appSelector` dropdown, step 1 workspace selection UI, step 4 service grid
- **Add**: icon bar + service panel as new sidebar structure
- **Restructure**: `#appShell` layout from single-column to 3-column flex
- **Refactor**: `loadWorkspace()` → split into `renderIconBar()`, `renderServicePanel()`, `loadServiceDetails()`
- **Update**: `selectService()` → load main panel cards instead of scrolling to step 5
- **Update**: CSS — add sidebar styles, Zoho light theme tokens, status dot styles

### No backend changes required
- All existing API endpoints (`/api/apps`, `/api/zoho/services`, `/api/zoho/account`, etc.) already return the data needed
- State management (`currentAppId`, `activeService`) stays the same, just triggered by sidebar clicks instead of dropdown/grid

## Verification

1. **Login with existing account** → sidebar shows connected Zoho accounts as icons
2. **Click account icon** → service panel populates with correct services and status dots
3. **Click a service** → main panel loads resources, actions, docs, handoff for that service
4. **Switch accounts** → service panel updates, main panel refreshes
5. **"+" button** → triggers account creation + OAuth flow, new account appears in sidebar
6. **New user (no accounts)** → sees empty state with onboarding prompt
7. **Mobile/narrow viewport** → sidebar should collapse gracefully (icon bar stays, service panel hides behind a toggle)
