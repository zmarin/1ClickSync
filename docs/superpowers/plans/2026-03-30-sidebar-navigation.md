# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dropdown workspace selector and service grid with a persistent two-panel sidebar (icon bar + service list) using Zoho's light theme with red accents.

**Architecture:** Single-file refactor of `public/index.html`. The HTML structure changes from a single-column `.shell` layout to a 3-column flex layout (icon bar | service panel | main content). All existing JS functions are preserved but rewired to sidebar click handlers instead of dropdown/grid events. No backend changes needed — all existing API endpoints are reused.

**Tech Stack:** Vanilla HTML/CSS/JS (matches existing codebase, no framework)

**Spec:** `docs/superpowers/specs/2026-03-30-sidebar-navigation-design.md`

---

### Task 1: Replace CSS variables and add sidebar styles

**Files:**
- Modify: `public/index.html:12-30` (CSS `:root` variables)
- Modify: `public/index.html:30-401` (add new CSS rules)

- [ ] **Step 1: Replace the `:root` color variables with Zoho light theme**

Find the existing `:root` block (lines 12-29) and replace it:

```css
:root {
  --bg: #FAFBFC;
  --panel: #ffffff;
  --panel-strong: #ffffff;
  --ink: #333333;
  --muted: #888888;
  --secondary: #555555;
  --line: #E0E3EB;
  --accent: #DC4C3E;
  --accent-strong: #c4392e;
  --accent-soft: #FFF5F4;
  --ready: #4CAF50;
  --warn: #FFC107;
  --danger: #DC4C3E;
  --inactive: #CCCCCC;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --radius: 8px;
  --radius-lg: 12px;
  --display: 'Space Grotesk', sans-serif;
  --body: 'IBM Plex Sans', sans-serif;
}
```

- [ ] **Step 2: Replace the `body` background with flat light background**

Find the existing `body` rule and replace:

```css
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--body);
  color: var(--ink);
  background: var(--bg);
}
```

- [ ] **Step 3: Add the sidebar layout CSS**

Add these rules after the existing `body` rule (before `a { color: inherit; }`):

```css
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.icon-bar {
  width: 56px;
  min-width: 56px;
  background: #F7F8FA;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 6px;
  overflow-y: auto;
}

.icon-bar-avatar {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.15s ease;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
}

.icon-bar-avatar:hover {
  border-color: var(--accent);
}

.icon-bar-avatar.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  box-shadow: 0 2px 4px rgba(220, 76, 62, 0.3);
}

.icon-bar-add {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 2px dashed #ccc;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 18px;
  cursor: pointer;
  margin-top: auto;
  margin-bottom: 8px;
  transition: 0.15s ease;
}

.icon-bar-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.service-panel {
  width: 170px;
  min-width: 170px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.service-panel-header {
  padding: 14px 16px 8px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid #f0f2f5;
}

.service-panel-list {
  flex: 1;
  padding: 2px 0;
}

.service-panel-item {
  padding: 9px 16px;
  font-size: 11px;
  color: var(--secondary);
  border-left: 3px solid transparent;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: 0.12s ease;
}

.service-panel-item:hover {
  background: #f9f9fb;
}

.service-panel-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
  border-left-color: var(--accent);
}

.service-panel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.service-panel-dot.ready { background: var(--ready); }
.service-panel-dot.reconnect_required { background: var(--warn); }
.service-panel-dot.connect_required { background: var(--inactive); }

.service-panel-footer {
  border-top: 1px solid #f0f2f5;
  padding: 12px 16px;
}

.main-panel {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg);
}

.main-panel .breadcrumb {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 16px;
}

.main-card {
  background: var(--panel);
  border-radius: var(--radius);
  border: 1px solid var(--line);
  padding: 16px;
  margin-bottom: 12px;
}

.main-card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 10px;
}

.tag-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  background: #f5f5f5;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 10px;
  color: var(--secondary);
}

.tag-action {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  font-size: 9px;
  padding: 3px 10px;
  border-radius: 10px;
  font-weight: 600;
}

.status-badge.connected {
  background: #E8F5E9;
  color: #2E7D32;
}

.status-badge.disconnected {
  background: #FFF3E0;
  color: #E65100;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
}

.empty-state-content {
  max-width: 340px;
}

.empty-state h2 {
  font-family: var(--display);
  font-size: 16px;
  margin: 12px 0 6px;
}

.empty-state p {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 16px;
}

.icon-bar-guide {
  color: var(--accent);
  font-size: 7px;
  text-align: center;
  margin-top: 4px;
  font-weight: 600;
}

@keyframes pulse-border {
  0%, 100% { border-color: #ccc; }
  50% { border-color: var(--accent); }
}

.icon-bar-add.pulse {
  animation: pulse-border 2s infinite;
}
```

- [ ] **Step 4: Verify the file saves correctly**

Open `public/index.html` and confirm the new CSS is present and the file is not malformed.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add Zoho light theme CSS and sidebar layout styles"
```

---

### Task 2: Replace HTML structure with 3-column sidebar layout

**Files:**
- Modify: `public/index.html:454-657` (the `#appShell` div)

- [ ] **Step 1: Replace the `#appShell` HTML**

Replace everything from `<div id="appShell" class="hidden">` through its closing `</div>` (lines 454-657) with this new structure:

```html
<div id="appShell" class="app-layout hidden">
  <!-- Column 1: Icon bar -->
  <nav class="icon-bar" id="iconBar">
    <!-- Rendered by JS: account avatars -->
    <button class="icon-bar-add pulse" id="addAccountBtn" title="Connect Zoho account">+</button>
    <div class="icon-bar-guide" id="iconBarGuide">Connect</div>
  </nav>

  <!-- Column 2: Service panel -->
  <aside class="service-panel" id="servicePanel">
    <div class="service-panel-header" id="servicePanelHeader">No account</div>
    <div class="service-panel-list" id="servicePanelList">
      <!-- Rendered by JS: service items -->
    </div>
    <div class="service-panel-footer">
      <button class="btn btn-ghost" id="logoutBtn" style="font-size:10px;padding:6px 12px;width:100%;">Log out</button>
    </div>
  </aside>

  <!-- Column 3: Main panel -->
  <main class="main-panel" id="mainPanel">
    <!-- Empty state (no accounts) -->
    <div id="emptyState" class="empty-state hidden">
      <div class="empty-state-content">
        <div style="font-size:28px;">🔗</div>
        <h2>Connect your first Zoho account</h2>
        <p>Link a Zoho workspace to discover services, manage routes, and generate agent handoff bundles.</p>
        <button class="btn btn-primary" id="emptyConnectBtn">+ Connect Zoho Account</button>
      </div>
    </div>

    <!-- Workspace create form (shown in main panel as modal-like card) -->
    <div id="workspaceCreate" class="hidden" style="max-width:520px;margin:40px auto;">
      <div class="main-card">
        <h3 style="font-family:var(--display);margin:0 0 12px;">Create a new workspace</h3>
        <p class="muted" style="font-size:11px;margin-bottom:16px;">One workspace per Zoho account. After creating, you'll connect via OAuth.</p>
        <label class="label" for="newAppName">Workspace name</label>
        <input class="field" id="newAppName" placeholder="Acme client portal">
        <label class="label" for="newAppDomain" style="margin-top:10px;">User app URL (optional)</label>
        <input class="field" id="newAppDomain" placeholder="https://app.acme.test">
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-primary" id="createWorkspacePrimaryBtn">Create & connect Zoho</button>
          <button class="btn btn-ghost" id="cancelCreateBtn">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Service content (shown when an account + service are selected) -->
    <div id="serviceContent" class="hidden">
      <div class="breadcrumb" id="breadcrumb">Account &rsaquo; Service</div>

      <!-- Connection status card -->
      <div class="main-card">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h2 style="font-family:var(--display);font-size:15px;margin:0;" id="serviceTitle">Service</h2>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;" id="serviceMeta">DC &bull; Org</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="status-badge" id="connectionBadge">Status</span>
            <button class="btn btn-ghost" id="reconnectZohoBtn" style="font-size:10px;padding:6px 10px;">Reconnect</button>
          </div>
        </div>
      </div>

      <!-- App context card -->
      <div class="main-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <p class="main-card-title" style="margin:0;">Your App Context</p>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-primary" id="saveContextBtn" style="font-size:10px;padding:6px 12px;">Save context</button>
            <button class="btn btn-ghost" id="openAppLinkBtn" style="font-size:10px;padding:6px 12px;">Open app</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div><label class="label" for="contextAppName">App name</label><input class="field" id="contextAppName" placeholder="Acme portal"></div>
          <div><label class="label" for="contextAppUrl">App URL</label><input class="field" id="contextAppUrl" placeholder="https://app.acme.test"></div>
          <div><label class="label" for="contextDocsUrl">Docs URL</label><input class="field" id="contextDocsUrl" placeholder="https://docs.acme.test"></div>
          <div><label class="label" for="contextTargetBaseUrl">Target base URL</label><input class="field" id="contextTargetBaseUrl" placeholder="https://api.acme.test"></div>
        </div>
        <div style="margin-top:8px;">
          <label class="label" for="contextNotes">Agent notes</label>
          <textarea class="textarea" id="contextNotes" placeholder="Notes for your coding agent..." style="min-height:60px;"></textarea>
        </div>
      </div>

      <!-- Resources card -->
      <div class="main-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <p class="main-card-title" style="margin:0;">Resources</p>
          <button class="btn btn-ghost" id="refreshServiceBtn" style="font-size:10px;padding:6px 10px;">Refresh</button>
        </div>
        <div class="tag-list" id="resourceGrid">
          <span class="tag">No resources loaded</span>
        </div>
      </div>

      <!-- Docs card -->
      <div class="main-card" id="docsCard">
        <p class="main-card-title">Documentation</p>
        <div id="docsGrid" class="tag-list"></div>
      </div>

      <!-- Actions card -->
      <div class="main-card">
        <p class="main-card-title">Actions</p>
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
          <div style="flex:1;min-width:140px;">
            <label class="label" for="actionSelect">Action</label>
            <select class="select" id="actionSelect" style="width:100%;"></select>
          </div>
          <button class="btn btn-primary" id="runActionBtn" style="font-size:10px;padding:8px 14px;">Run action</button>
          <button class="btn btn-ghost" id="loadActionExampleBtn" style="font-size:10px;padding:8px 14px;">Load example</button>
        </div>
        <div style="margin-top:10px;">
          <label class="label" for="actionPayload">Payload</label>
          <textarea class="textarea" id="actionPayload" placeholder="Select an action to load a JSON example." style="min-height:100px;font-size:11px;"></textarea>
        </div>
        <p class="helper" id="actionHelper">Managed actions use the same platform endpoints shown in the handoff bundle.</p>
        <div id="actionResult" class="hidden" style="margin-top:10px;background:#f9f9fb;border-radius:var(--radius);padding:12px;">
          <p class="main-card-title">Result</p>
          <pre class="code" id="actionResultPre" style="font-size:10px;max-height:200px;overflow:auto;"></pre>
        </div>
      </div>

      <!-- Handoff card -->
      <div class="main-card">
        <p class="main-card-title">Generate Handoff Bundle</p>
        <label class="label" for="handoffGoal">Goal</label>
        <textarea class="textarea" id="handoffGoal" placeholder="Build a white-label CRM onboarding form..." style="min-height:60px;"></textarea>
        <div style="margin-top:10px;">
          <button class="btn btn-primary" id="generateHandoffBtn">Generate handoff</button>
        </div>
        <div id="handoffResult" class="hidden" style="margin-top:12px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span class="label">Prompt</span>
                <button class="btn btn-ghost" id="copyPromptBtn" style="font-size:9px;padding:4px 8px;">Copy</button>
              </div>
              <textarea class="textarea" id="handoffPrompt" style="min-height:240px;font-size:10px;"></textarea>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span class="label">Refs JSON</span>
                <button class="btn btn-ghost" id="copyRefsBtn" style="font-size:9px;padding:4px 8px;">Copy</button>
              </div>
              <textarea class="textarea" id="handoffRefs" style="min-height:240px;font-size:10px;"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>
```

- [ ] **Step 2: Verify the HTML structure is valid**

Check that all IDs referenced by existing JS functions still exist: `appShell`, `logoutBtn`, `newAppName`, `newAppDomain`, `createWorkspacePrimaryBtn`, `reconnectZohoBtn`, `saveContextBtn`, `openAppLinkBtn`, `contextAppName`, `contextAppUrl`, `contextDocsUrl`, `contextTargetBaseUrl`, `contextNotes`, `resourceGrid`, `docsGrid`, `actionSelect`, `actionPayload`, `actionHelper`, `actionResult`, `runActionBtn`, `loadActionExampleBtn`, `refreshServiceBtn`, `handoffGoal`, `generateHandoffBtn`, `handoffResult`, `handoffPrompt`, `handoffRefs`, `copyPromptBtn`, `copyRefsBtn`.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: replace app shell HTML with 3-column sidebar layout"
```

---

### Task 3: Rewrite JavaScript to drive sidebar navigation

**Files:**
- Modify: `public/index.html:661-1111` (the `<script>` block)

- [ ] **Step 1: Replace the `renderAppShell` and `loadApps` functions**

Replace `renderAppShell()` (line ~730) with:

```javascript
function renderAppShell() {
  byId('authShell').classList.add('hidden');
  byId('appShell').classList.remove('hidden');
}
```

Replace `loadApps()` (line ~753) with:

```javascript
async function loadApps() {
  state.apps = await api('/api/apps');
  renderIconBar();
  if (!state.apps.length) {
    showEmptyState();
    return;
  }
  if (!state.currentAppId || !state.apps.find((app) => app.id === state.currentAppId)) {
    state.currentAppId = state.apps[0].id;
    localStorage.setItem('currentAppId', state.currentAppId);
  }
  await loadWorkspace();
}
```

- [ ] **Step 2: Add the `renderIconBar` function**

Add after `loadApps`:

```javascript
function renderIconBar() {
  const bar = byId('iconBar');
  const addBtn = byId('addAccountBtn');
  const guide = byId('iconBarGuide');
  // Remove existing avatars (keep addBtn and guide)
  Array.from(bar.querySelectorAll('.icon-bar-avatar')).forEach((el) => el.remove());
  // Insert avatars before the add button
  state.apps.forEach((app) => {
    const avatar = document.createElement('div');
    avatar.className = `icon-bar-avatar ${app.id === state.currentAppId ? 'active' : ''}`;
    avatar.textContent = (app.name || '??').substring(0, 2).toUpperCase();
    avatar.title = app.name;
    avatar.dataset.appId = app.id;
    avatar.addEventListener('click', async () => {
      state.currentAppId = app.id;
      localStorage.setItem('currentAppId', state.currentAppId);
      renderIconBar();
      await loadWorkspace();
    });
    bar.insertBefore(avatar, addBtn);
  });
  // Show/hide guide text
  if (state.apps.length === 0) {
    addBtn.classList.add('pulse');
    guide.classList.remove('hidden');
  } else {
    addBtn.classList.remove('pulse');
    guide.classList.add('hidden');
  }
}
```

- [ ] **Step 3: Add `showEmptyState` and `hideAllMainPanels` helpers**

```javascript
function hideAllMainPanels() {
  byId('emptyState').classList.add('hidden');
  byId('workspaceCreate').classList.add('hidden');
  byId('serviceContent').classList.add('hidden');
}

function showEmptyState() {
  hideAllMainPanels();
  byId('emptyState').classList.remove('hidden');
  byId('servicePanelHeader').textContent = 'No account';
  byId('servicePanelList').innerHTML = '';
}
```

- [ ] **Step 4: Replace `loadWorkspace` to render service panel + auto-select service**

Replace the existing `loadWorkspace` function:

```javascript
async function loadWorkspace() {
  const appRecord = state.apps.find((app) => app.id === state.currentAppId);
  if (!appRecord) return showEmptyState();
  state.account = await api(`/api/zoho/account?app_id=${state.currentAppId}`);
  state.projectContext = (await api(`/api/project-context?app_id=${state.currentAppId}`)).projectContext;
  state.services = (await api(`/api/zoho/services?app_id=${state.currentAppId}`)).services;
  state.details = {};
  renderServicePanel(appRecord);
  const params = new URLSearchParams(window.location.search);
  const requestedService = params.get('service');
  const nextService = requestedService && state.services.find((s) => s.id === requestedService)
    ? requestedService
    : (state.activeService && state.services.find((s) => s.id === state.activeService)
      ? state.activeService
      : (state.services.find((s) => s.status === 'ready')
        ? state.services.find((s) => s.status === 'ready').id
        : (state.services[0] ? state.services[0].id : null)));
  if (nextService) {
    await selectService(nextService);
  } else {
    hideAllMainPanels();
    byId('serviceContent').classList.remove('hidden');
    byId('breadcrumb').textContent = appRecord.name;
    byId('serviceTitle').textContent = 'No services available';
    byId('serviceMeta').textContent = 'Connect Zoho to discover services';
  }
}
```

- [ ] **Step 5: Add `renderServicePanel` function**

```javascript
function renderServicePanel(appRecord) {
  byId('servicePanelHeader').textContent = appRecord.name;
  byId('servicePanelList').innerHTML = state.services.map((service) => `
    <div class="service-panel-item ${state.activeService === service.id ? 'active' : ''}" data-sid="${service.id}">
      <span class="service-panel-dot ${service.status}"></span>
      ${escapeHtml(service.name)}
    </div>
  `).join('');
  Array.from(document.querySelectorAll('[data-sid]')).forEach((el) => {
    el.addEventListener('click', () => selectService(el.dataset.sid));
  });
}
```

- [ ] **Step 6: Replace `selectService` and `renderServiceDetail`**

Replace `selectService`:

```javascript
async function selectService(serviceId) {
  state.activeService = serviceId;
  const appRecord = state.apps.find((app) => app.id === state.currentAppId);
  if (appRecord) renderServicePanel(appRecord);
  hideAllMainPanels();
  byId('serviceContent').classList.remove('hidden');
  if (!state.details[serviceId]) {
    const [resources, actions, references] = await Promise.all([
      api(`/api/zoho/services/${serviceId}/resources?app_id=${state.currentAppId}`),
      api(`/api/zoho/services/${serviceId}/actions?app_id=${state.currentAppId}`),
      api(`/api/zoho/services/${serviceId}/references?app_id=${state.currentAppId}`),
    ]);
    state.details[serviceId] = { resources, actions, references };
  }
  renderServiceDetail();
}
```

Replace `renderServiceDetail`:

```javascript
function renderServiceDetail() {
  const service = state.services.find((s) => s.id === state.activeService);
  const detail = state.details[state.activeService];
  const appRecord = state.apps.find((app) => app.id === state.currentAppId);
  if (!service || !detail) return;

  byId('breadcrumb').textContent = `${appRecord ? appRecord.name : 'Account'} › ${service.name}`;
  byId('serviceTitle').textContent = service.name;
  byId('serviceMeta').textContent = `${state.account.zoho.dc || 'No DC'} • Org ${state.account.zoho.org_id || 'unknown'}`;

  const connected = state.account.zoho.connected;
  const badge = byId('connectionBadge');
  badge.textContent = connected ? 'Connected' : 'Not connected';
  badge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  byId('reconnectZohoBtn').style.display = (service.status === 'reconnect_required' || !connected) ? '' : 'none';

  renderProjectContext();

  const resources = detail.resources.resources || [];
  byId('resourceGrid').innerHTML = resources.length
    ? resources.map((r) => `<span class="tag">${escapeHtml(r.name || r.type)}</span>`).join('')
    : '<span class="tag">No live resources yet</span>';

  const docs = detail.references.documentationLinks || [];
  const docsCard = byId('docsCard');
  if (docs.length) {
    docsCard.classList.remove('hidden');
    byId('docsGrid').innerHTML = docs.map((d) =>
      `<a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer" class="tag tag-action" style="text-decoration:none;">${escapeHtml(d.label)}</a>`
    ).join('');
  } else {
    docsCard.classList.add('hidden');
  }

  renderActionDetail(detail.actions.actions || []);
}
```

- [ ] **Step 7: Remove `renderAppSelector`, `renderOverview`, `renderServices`, `renderDetailPlaceholder`**

These functions are no longer needed. Delete them entirely:
- `renderAppSelector()` — replaced by `renderIconBar()`
- `renderOverview()` — overview stats now in connection card
- `renderServices()` — replaced by `renderServicePanel()`
- `renderDetailPlaceholder()` — replaced by `hideAllMainPanels` logic

- [ ] **Step 8: Update `renderActionDetail` to use new result container**

Replace the action result rendering in `runCurrentAction`:

```javascript
async function runCurrentAction() {
  const action = currentAction();
  if (!action) return showToast('Select an action first.');
  if (!action.available) return showToast(action.reason || 'This action is currently blocked.');
  try {
    const payload = JSON.parse(byId('actionPayload').value || '{}');
    payload.app_id = state.currentAppId;
    const result = await api(`/api/zoho/services/${state.activeService}/actions/${action.id}`, { method: 'POST', body: payload });
    byId('actionResult').classList.remove('hidden');
    byId('actionResultPre').textContent = JSON.stringify(result, null, 2);
    showToast(`${action.label} completed.`, 'success');
    state.details[state.activeService] = null;
    await selectService(state.activeService);
  } catch (error) {
    showToast(error.message);
  }
}
```

- [ ] **Step 9: Replace event listeners at the bottom**

Replace the event listener block (lines ~1081-1108) with:

```javascript
byId('authSubmitBtn').addEventListener('click', submitAuth);
byId('authToggleBtn').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'register' : 'login'));
byId('logoutBtn').addEventListener('click', logout);
byId('addAccountBtn').addEventListener('click', () => {
  hideAllMainPanels();
  byId('workspaceCreate').classList.remove('hidden');
  byId('newAppName').focus();
});
byId('emptyConnectBtn').addEventListener('click', () => {
  hideAllMainPanels();
  byId('workspaceCreate').classList.remove('hidden');
  byId('newAppName').focus();
});
byId('cancelCreateBtn').addEventListener('click', async () => {
  if (state.apps.length) {
    await loadWorkspace();
  } else {
    showEmptyState();
  }
});
byId('createWorkspacePrimaryBtn').addEventListener('click', async () => {
  await createWorkspace();
});
byId('reconnectZohoBtn').addEventListener('click', connectZoho);
byId('openAppLinkBtn').addEventListener('click', openUserApp);
byId('saveContextBtn').addEventListener('click', saveContext);
byId('refreshServiceBtn').addEventListener('click', async () => {
  if (!state.activeService) return showToast('Select a service first.');
  state.details[state.activeService] = null;
  await selectService(state.activeService);
  showToast('Service detail refreshed.', 'success');
});
byId('actionSelect').addEventListener('change', loadCurrentActionExample);
byId('loadActionExampleBtn').addEventListener('click', loadCurrentActionExample);
byId('runActionBtn').addEventListener('click', runCurrentAction);
byId('generateHandoffBtn').addEventListener('click', generateHandoff);
byId('copyPromptBtn').addEventListener('click', () => copyFrom('handoffPrompt'));
byId('copyRefsBtn').addEventListener('click', () => copyFrom('handoffRefs'));

bootstrap();
```

- [ ] **Step 10: Update `createWorkspace` to auto-trigger OAuth after creation**

Replace `createWorkspace`:

```javascript
async function createWorkspace() {
  const name = byId('newAppName').value.trim();
  const domain = byId('newAppDomain').value.trim();
  if (!name) return showToast('Workspace name is required.');
  try {
    const created = await api('/api/apps', {
      method: 'POST',
      body: {
        name,
        domain: domain || undefined,
        business_type: 'saas',
        zoho_tools: ['crm', 'desk', 'bookings', 'salesiq', 'books', 'projects'],
      },
    });
    state.currentAppId = created.id;
    localStorage.setItem('currentAppId', state.currentAppId);
    byId('newAppName').value = '';
    byId('newAppDomain').value = '';
    showToast('Workspace created. Redirecting to Zoho OAuth...', 'success');
    await connectZoho();
  } catch (error) {
    showToast(error.message);
  }
}
```

- [ ] **Step 11: Commit**

```bash
git add public/index.html
git commit -m "feat: rewrite JS for sidebar navigation with icon bar + service panel"
```

---

### Task 4: Clean up removed CSS and dead HTML references

**Files:**
- Modify: `public/index.html` (CSS section)

- [ ] **Step 1: Remove CSS rules that reference deleted elements**

Remove these CSS rules that are no longer used (the topbar, step cards, service grid, etc.):

- `.shell` — replaced by `.app-layout`
- `.topbar`, `.topbar-actions` — replaced by icon bar
- `.workflow` — replaced by main panel cards
- `.step-card`, `.step-head`, `.step-mark`, `.step-index`, `.step-label` — no more step numbers
- `.service-card`, `.service-top`, `.service-name`, `.service-meta`, `.service-bottom` — replaced by `.service-panel-item`
- `.summary-grid`, `.summary-card` — overview stats removed
- `.detail-grid` — replaced by stacked cards
- `.output-grid`, `.output-box`, `.output-name` — simplified
- `.info-pill`, `.status-pill` — replaced by `.status-badge` and `.service-panel-dot`
- `.empty-card` — replaced by `.empty-state`
- `.action-panel`, `.action-box`, `.action-name` — integrated into main card

Keep: `.auth-card`, `.auth-grid`, `.auth-copy`, `.auth-form`, `.auth-points`, `.auth-title` (auth shell unchanged), `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.field`, `.textarea`, `.select`, `.label`, `.hidden`, `.muted`, `.helper`, `.code`, `.toast`, `.toast-wrap`.

- [ ] **Step 2: Verify no CSS references broken elements**

Search for any class name used in HTML that isn't defined in CSS, and vice versa.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "refactor: remove dead CSS from old step-based layout"
```

---

### Task 5: End-to-end verification

**Files:**
- Read: `public/index.html` (full file)

- [ ] **Step 1: Run TypeScript build to confirm no backend breakage**

```bash
npx tsc --noEmit
```

Expected: no errors (we only changed `public/index.html`).

- [ ] **Step 2: Start the dev server and test in browser**

```bash
npm run dev
```

Open the app in browser and verify:

1. **Login** → auth shell appears normally, login/register works
2. **With accounts** → icon bar shows account avatars, clicking one loads its services in the service panel
3. **Service panel** → clicking a service loads resources, actions, docs, handoff in the main panel
4. **"+" button** → shows workspace creation form, creates workspace, redirects to OAuth
5. **No accounts** → empty state with "Connect your first Zoho account" + pulsing "+" button
6. **Reconnect** → reconnect button appears for services needing it
7. **Actions** → selecting an action loads the example, running it shows results
8. **Handoff** → generating a handoff shows prompt + refs in two columns
9. **Logout** → returns to auth shell

- [ ] **Step 3: Commit any fixes found during testing**

```bash
git add public/index.html
git commit -m "fix: address issues found during sidebar e2e testing"
```

- [ ] **Step 4: Final commit and push**

```bash
git push origin main
```
