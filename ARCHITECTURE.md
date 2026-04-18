# SCR Management System — Technical Architecture Reference

> Quick reference for developers: "when X is broken, look in Y"

---

## 📁 Project Structure

```
SCR FILES/
├── index.html                  → App shell (single HTML page)
├── serve.ps1                   → Local PowerShell HTTP server
├── ARCHITECTURE.md             → This file
├── css/
│   ├── index.css              → Design tokens + reset + animations
│   ├── components.css         → All reusable components
│   ├── dashboard.css          → Dashboard-specific styles
│   ├── responsive.css         → Mobile/tablet breakpoints
│   ├── ui-enhancements.css    → Hover effects, polish layer
│   ├── theme-light.css        → Warm paper light theme
│   └── performance.css        → 60-120fps motion tuning
└── js/
    ├── utils.js               → Shared helpers (dates, IDs, toast, escapeHtml)
    ├── store.js               → localStorage CRUD + seed + migrate
    ├── auth.js                → Login / sessions / permissions
    ├── audit.js               → Audit trail logging + page
    ├── workflow.js            → 6-stage workflow engine
    ├── sla-engine.js          → SLA math + overdue detection
    ├── notifications.js       → Bell + panel + notifications page
    ├── dashboard.js           → Dashboard page (KPIs, charts)
    ├── scr-manager.js         → SCR list + detail + form + print
    ├── dev-updates.js         → Developer progress journal (stage 5+)
    ├── approval.js            → Stage 4 AGM+CIO dual approval
    ├── feedback.js            → Feedback modal + ratings + page
    ├── self-service.js        → Requester portal
    ├── master-data.js         → Admin: users/depts/SLA/roles
    ├── router.js              → SPA routing + settings page
    └── app.js                 → App bootstrap + sidebar + header
```

---

## 📄 JavaScript Files — What They Own

### Core Infrastructure

**utils.js** — Shared helpers used by every other file
- Date formatting: `formatDate`, `formatDateTime`, `formatTimeAgo`
- ID generation: `generateId` (crypto.randomUUID), `generateSCRNumber` (regex-based sequence)
- Validation: `isNonEmpty`, `isValidDate`, `isDateRangeValid`, `isValidEmail`
- UI helpers: `toast` (capped at 4 visible), `confirm` (promise-based dialog)
- Security: `escapeHtml` — ALWAYS use this before rendering user input
- Constants: `stages`, `roleLabels`, `defaultDepartments`

**store.js** — localStorage data layer
- CRUD: `getAll`, `getById`, `add`, `update`, `remove`, `filter`, `count`
- Session: `getSession`, `setSession`, `clearSession`
- Seed + migrations: `seed`, `migrate`, `resetAll`
- Quota recovery: `_set` auto-prunes on QuotaExceededError
- Corruption recovery: `_get` removes corrupted key if parse fails
- Cascade delete: removing an SCR purges workflow/approvals/feedback/notifications
- Routine pruning: `pruneRoutine` called every init — trims audit>2000 entries, removes read notifs older than 90 days

### Auth & Audit

**auth.js** — Login, session, permissions
- Permission matrix: object mapping each role to `pages[]` and `actions[]`
- `login(username, password)` — checks credentials, rate-limits (5 attempts → 60s lockout)
- `logout()` — clears session, closes notif panel, re-inits app
- `currentUser()` — reads session from Store
- `canAccessPage(page)`, `canPerformAction(action)`, `hasRole(...roles)`
- `renderLoginPage()` — full HTML for split-screen login
- `handleLogin`, `quickLogin` — demo login buttons

**audit.js** — Compliance trail
- `log(entityType, entityId, action, field, oldVal, newVal, performedBy, role)` — appends entry
- `getForEntity(type, id)` — retrieve logs for a specific SCR/user
- `renderLog()` — full Audit Trail page with search filter
- `renderTimeline(scrId)` — vertical timeline inside SCR detail
- `actionBadge(action)` — semantic color mapping for action types

### Workflow & SLA

**workflow.js** — 6-stage state machine
- `stageRules` — matrix of which roles can advance/reject each stage + required fields
- `canAdvance(scr)` — role + stage + status checks
- `canReject(scr)`, `canClose(scr)`
- `advanceStage(scrId)` — validates required fields, creates workflow_stages entry, audit log, notifications
- `rejectStage(scrId, remarks)` — remarks required; reject from stage 3/4 → stage 2; from 6 → 5; from 2 → terminal
- `closeTicket(scrId)` — stage 6 QA sign-off
- `renderPipeline(scr)` — horizontal stage indicator on detail page
- `renderHistory(scrId)` — timeline of stage entries + exits

**sla-engine.js** — Deadline math
- `getMaxHours(priority)` — reads from sla_config (Emergency 24h / Urgent 72h / Routine 168h)
- `calculate(scr)` — returns `{status, label, percent, color, remaining}`. Guards null createdAt and zero maxHours.
- `getOverdue()`, `getAtRisk()` — filtered lists for dashboard
- `renderIndicator(scr)` — inline badge for list view
- `renderProgressBar(scr)` — on detail page
- `checkAndNotify()` — fires SLA breach notifications

### Features (one per page)

**dashboard.js** — Main dashboard
- `render()` — welcome banner + 5 KPI cards + status donut + department bars + recent activity + workload + overdue
- `postRender()` → `drawStatusDonut()` — vanilla canvas donut chart with animation

**scr-manager.js** — THE biggest file. SCR list, detail, form, print
- `filters` object — search/status/priority/department
- `createSCR(data)` — duplicate detection + validation + audit + notifications
- `updateSCR(id, updates)` — blocks edits on Closed/Rejected, validates date ranges, audits field changes
- `getFiltered()` — applies filters + role-based visibility (requester sees only own)
- `renderList()` — full table with filters
- `renderDetail(id)` — 10-section detail view. Guards: null SCR, null session, requester-accessing-others
- `renderForm(editId)` — create/edit form with conditional sections by role
- `handleSubmit` — trim-aware validation, date range check, auto-populate assignedOn when dev set
- `handleAdvanceStage`, `handleRejectStage`, `handleCloseTicket`, `handleAcknowledge`
- `printSCR(id)` — opens print-friendly template in new window
- `renderPrintTemplate(scr)` — NABH-compliant printable form

**dev-updates.js** — Developer progress journal (Stage 5+)
- `add(scrId, {title, description, status, percentComplete})` — post update; gated to assigned developers only, stage 5+, not closed/rejected
- `getForSCR(scrId)` — all updates newest first
- `currentProgress(scrId)` — latest % complete from updates
- `renderForSCR(scrId, scr)` — timeline strip (Assigned / Schedule / Completed) + progress bar + list of updates + "Add Update" button
- `showForm(scrId)` — modal with title/description/status/percent fields
- `handleSubmit(scrId)`, `handleDelete(updateId, scrId)`

**approval.js** — Stage 4 dual approval
- `approvalChain = ['agm_it', 'cio']` — both must approve to advance to stage 5
- `canApprove(scrId)` — role + stage + status + self-approval block + stage-scoped prior-decision check
- `submitDecision(scrId, decision, comments)` — re-checks permission inside mutation to prevent race
- `_bothApproved(scrId)` — returns true only when both AGM and CIO approved
- `renderForSCR(scrId)` — approval cards + decision form inside detail view
- `renderList()` — Approvals page with Pending + History tabs

**feedback.js** — Star ratings on closed SCRs
- `questions` array — 5 standard questions (satisfaction, timeliness, quality, comms, recommend)
- `submitFeedback(scrId, ratings, comments)` — gates: Closed/Completed only, creator-only, one-per-user, all 5 ratings 1-5
- `showForm(scrId)` — modal with star rating widgets
- `setRating(questionId, value)` — click handler
- `renderForSCR(scrId)` — score circle + answer breakdown in detail view
- `renderList()` — feedback history page with avg scores

**self-service.js** — Requester portal
- `render()` — welcome + "My Requests" table + quick submit button + tracker
- `handleQuickSubmit(e)` — simplified form submission with trim-aware validation
- `showTracker()` — search SCR by number
- `trackSCR()` — displays status pipeline for looked-up SCR

**master-data.js** — Admin panel
- Tabs: Users / Departments / SLA / Roles & Permissions
- `showDeptForm(editId)`, `saveDept`, `deleteDept` — guards against deleting referenced depts or the last one
- `showUserForm(editId)`, `saveUser`, `deleteUser`
- `saveSLA` — validates 1-8760 hours
- `renderRolesMatrix` — editable role-permission matrix (writes to `role_permissions`)

**notifications.js** — Bell + panel + page
- `create(userId, message, type, scrId)` — deduplicates identical unread within 60s
- `togglePanel()` — slide-out from right
- `renderPanel()` — recent 20 notifications
- `renderPage()` — full notifications page with mark-all-read
- `updateBadge()` — bell icon count + sidebar count
- `notifySCRCreated`, `notifySCRAssigned`, `notifyStageChange`, `notifyRejection` — event-specific helpers

### App Shell

**router.js** — SPA navigation
- `navigate(page, params)` — auth guard + permission guard + renders content + updates header title + closes mobile sidebar
- `render(page, params)` — switch statement dispatching to each module's `render()` method
- `renderSettings()` — profile display + admin reset-data button
- `handleReset()` — confirm dialog + Store.resetAll()

**app.js** — Entry point
- `init()` — seed, migrate, prune, bind storage sync, check auth, render shell, navigate to default page
- `renderShell()` — sidebar with role-aware nav + header with user menu + content area
- `toggleSidebar()` — mobile drawer / desktop collapse
- `_bindStorageSync()` — listens for cross-tab localStorage events (logout in tab A → tab B updates; notification badge auto-refresh), Escape key closes modals, click-overlay-to-close

---

## 🎨 CSS Files — Loaded in Order (Last Wins)

| # | File | Scope |
|---|---|---|
| 1 | `index.css` | CSS custom properties (tokens), reset, utility classes, keyframe animations |
| 2 | `components.css` | Every component: cards, buttons, forms, tables, modals, toasts, login, SCR form sections, approval cards, notification panel, sidebar, header |
| 3 | `dashboard.css` | Dashboard-specific: KPI grid, chart cards, activity feed, workload, welcome banner |
| 4 | `responsive.css` | Breakpoints: 1024 / 768 / 640 / 480 / 1440 |
| 5 | `ui-enhancements.css` | Hover effects, badge refinements, tab pill style, pipeline polish |
| 6 | `theme-light.css` | **Overrides** all dark theme colors → warm paper tones, larger fonts |
| 7 | `performance.css` | GPU transforms, spring easing curves, will-change hints, 60-120fps tuning |

Because later files win, theme-light.css and performance.css override everything above.

---

## 🔍 Debugging Map — If X is Broken, Look In Y

### Features

| Symptom | File / Function |
|---|---|
| Can't log in | auth.js → `login()` |
| Login locked out ("too many attempts") | auth.js → `_failedAttempts`, `_lockoutUntil` |
| Dashboard shows wrong KPI numbers | dashboard.js → `render()` + sla-engine.js |
| Dashboard chart missing | dashboard.js → `drawStatusDonut()` |
| SCR list missing some SCRs | scr-manager.js → `getFiltered()` (role-based filter) |
| Can't create SCR | scr-manager.js → `createSCR()`, `handleSubmit()` |
| SCR detail page crashes | scr-manager.js → `renderDetail()` |
| "Access Denied" on SCR detail | scr-manager.js → `renderDetail()` requester check |
| "Cannot edit closed SCR" | scr-manager.js → `updateSCR()` status guard |
| Stage won't advance | workflow.js → `canAdvance()`, `advanceStage()` |
| "Missing required fields" on advance | workflow.js → `stageRules`, `validateStage()` |
| Reject button missing | workflow.js → `canReject()`, `_rejectTarget` |
| Approval section empty | approval.js → `renderForSCR()` |
| Can't submit approval decision | approval.js → `canApprove()`, `submitDecision()` |
| Double approval allowed | approval.js → `canApprove()` stage-scoped check |
| SCR stuck at stage 4 | approval.js → `_bothApproved()` |
| Overdue SCRs wrong | sla-engine.js → `calculate()` |
| "Pending" SLA status | sla-engine.js → createdAt null guard |
| Feedback won't submit | feedback.js → `submitFeedback()` gates (creator-only, closed-only, one-per-user) |
| Stars not clickable | feedback.js → `setRating()` |
| Notifications not appearing | notifications.js → `create()`, dedup logic |
| Notification badge wrong count | notifications.js → `updateBadge()` |
| Notif panel won't close | app.js → Escape handler |
| Requester sees other users' SCRs | scr-manager.js `renderDetail()` + `getFiltered()` |
| Self-service form bug | self-service.js → `handleQuickSubmit()` |
| Can't delete department | master-data.js → `deleteDept()` (blocks if referenced) |
| SLA config rejected | master-data.js → `saveSLA()` (1-8760h range) |
| User form missing fields | master-data.js → `showUserForm()` |
| Audit trail missing entry | audit.js → find `Audit.log(...)` callers |
| Page navigation broken | router.js → `navigate()`, `render()` switch |
| Mobile menu won't open | app.js → `toggleSidebar()` + responsive.css |
| Cross-tab logout not working | app.js → `_bindStorageSync()` |

### Data Issues

| Symptom | File |
|---|---|
| localStorage full error | store.js → `_set()` auto-prunes; check browser console |
| Data corrupted / app won't load | store.js → `_get()` recovers + `migrate()` |
| Old approver names showing | store.js → `migrate()` — bumps version, renames |
| Duplicate SCR numbers | utils.js → `generateSCRNumber()` regex |
| Session persists after delete | auth.js → `logout()` + Store.clearSession |

### UI Issues

| Symptom | File |
|---|---|
| Color scheme off | theme-light.css (overrides win) |
| Font too small | theme-light.css → `--font-*` vars |
| Mobile layout broken | responsive.css |
| Animations janky / stuttering | performance.css — GPU transforms |
| Transitions too slow | performance.css → `--dur-*` vars |
| Login page title invisible | theme-light.css → `.login-visual h1-h6` rule |
| Table cells misaligned | theme-light.css → `.data-table td` rules |
| Dropdown chevron missing | theme-light.css → `.form-select` (uses native browser arrow) |
| Welcome banner invisible text | theme-light.css → `.welcome-title` (solid color, no gradient) |
| Modal won't close | app.js → Escape key + overlay click handlers |
| Toast spam | utils.js → `toast()` capped at 4 |
| Pipeline stages overflowing | components.css → `.pipeline-stage` + responsive |
| KPI card values cut off | theme-light.css → `.kpi-value` overflow rules |

### Security

| Concern | File |
|---|---|
| XSS / raw HTML rendering | utils.js → `escapeHtml()` — verify callers use it |
| Login brute force | auth.js → rate limit (`_failedAttempts`, `_lockoutUntil`) |
| Requester URL enumeration | scr-manager.js → `renderDetail()` access check |
| Self-approval allowed | approval.js → `canApprove()` createdBy check |
| Terminal state edits | scr-manager.js → `updateSCR()` Closed/Rejected guard |

---

## 🔗 Data Flow

### Read (user views a page)
```
User clicks nav item / URL link
  ↓
Router.navigate('dashboard')         [router.js]
  ↓
permission checks (canAccessPage)    [auth.js]
  ↓
Dashboard.render()                   [dashboard.js]
  ↓
Store.getAll('scr_requests')         [store.js]
  ↓
localStorage.getItem('scr_scr_requests')
  ↓
JSON.parse + return
```

### Write (user submits form)
```
User clicks "Submit" on SCR create form
  ↓
SCRManager.handleSubmit(event)       [scr-manager.js]
  ↓
trim + validate required fields
  ↓
SCRManager.createSCR(data)
  ├─→ Store.add('scr_requests', ...)  [store.js]
  ├─→ Audit.log('SCR', id, 'Created') [audit.js]
  ├─→ Notifications.notifySCRCreated(scr)
  └─→ Store.add('workflow_stages', ...)
  ↓
Utils.toast('success', ...)          [utils.js]
  ↓
Router.navigate('scr-detail', {id})  [router.js]
```

### Workflow (stage advance)
```
User clicks "Advance Stage →"
  ↓
SCRManager.handleAdvanceStage(scrId)
  ↓
Workflow.advanceStage(scrId)         [workflow.js]
  ├─→ Workflow.canAdvance() role check
  ├─→ Workflow.validateStage() required fields
  ├─→ Store.update('scr_requests', id, {currentStage: newStage})
  ├─→ Store.update('workflow_stages', oldWfId, {exitedAt})
  ├─→ Store.add('workflow_stages', {stage: newStage, enteredAt})
  ├─→ Audit.log('SCR', id, 'Stage Advanced')
  └─→ Notifications.notifyStageChange(scr, old, new)
  ↓
Re-render SCR detail page
```

### Cross-tab sync (logout in tab A)
```
User clicks Logout in Tab A
  ↓
Auth.logout() → Store.clearSession()
  ↓
localStorage removeItem('scr_session')
  ↓
Browser fires 'storage' event in OTHER tabs
  ↓
app.js _bindStorageSync() listener
  ↓
Tab B sees session gone → App.init() → renders login page
```

---

## 🏗️ Data Model (localStorage keys)

All keys are prefixed `scr_`:

| Key | Collection | Shape |
|---|---|---|
| `scr_users` | Users | `[{id, name, username, password, role, email, department}]` |
| `scr_departments` | Departments | `[{id, name, hodName, hodEmail}]` |
| `scr_scr_requests` | SCRs | `[{id, scrNumber, currentStage, status, ...10 sections}]` |
| `scr_workflow_stages` | Stage transitions | `[{id, scrId, stage, enteredAt, exitedAt, action, performedBy, notes}]` |
| `scr_approvals` | AGM+CIO decisions | `[{id, scrId, approverRole, approverName, decision, comments, timestamp}]` |
| `scr_feedback` | Ratings | `[{id, scrId, q1..q5, avgScore, comments, submittedBy, timestamp}]` |
| `scr_notifications` | Per-user notifs | `[{id, userId, message, type, scrId, read, timestamp}]` |
| `scr_development_updates` | Dev progress journal | `[{id, scrId, authorId, authorName, title, description, status, percentComplete, timestamp}]` |
| `scr_audit_log` | Compliance trail | `[{id, entityType, entityId, action, field, oldValue, newValue, performedBy, role, timestamp}]` |
| `scr_sla_config` | SLA hours | `[{id, priority, maxHours}]` |
| `scr_role_permissions` | Role matrix | `{admin: {pages, actions}, cio: {...}, ...}` |
| `scr_session` | Current user | `{id, name, username, role, email, department, loginAt}` |
| `scr_seeded` | Seed flag | `true` |
| `scr_migration_version` | Migration flag | `2` |

---

## 🧰 Common Tasks

### Add a new page
1. Create `js/my-page.js` with a `render()` method
2. Add `<script src="js/my-page.js"></script>` to `index.html`
3. Add case in `router.js` → `render()` switch
4. Add title in `router.js` → `titles` map
5. Add permission in `auth.js` → `permissions` matrix
6. Add sidebar link in `app.js` → `renderShell()`

### Add a new field to SCR
1. Add default in `store.js` → `scrFieldDefaults()`
2. Add form input in `scr-manager.js` → `renderForm()`
3. Read value in `scr-manager.js` → `handleSubmit()` via `getVal('my-field-id')`
4. Display in `scr-manager.js` → `renderDetail()`
5. Optionally add to print template `renderPrintTemplate()`

### Change SLA durations
Edit `master-data.js` SLA tab → enter new hours → Save.
Or edit the seed in `store.js` line ~200 (`sla_config` entries).

### Change approver names
Edit `store.js` seed `users` array + run `Store.migrate()` (bump MIGRATION_VERSION).
Or edit in Master Data → Users tab.

### Reset all data (fresh demo state)
Settings page → "Reset All Data" button (admin only)
Or in browser console: `Store.resetAll()`

---

## 🚀 Running Locally

```powershell
# From SCR FILES directory
powershell -ExecutionPolicy Bypass -File serve.ps1

# Optional: change port
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
```

Server binds to all interfaces. LAN URL shown in banner.
If other devices can't connect: open port 3500 in Windows Firewall (one-time admin command in banner).

---

## 📊 Role → Capability Matrix

| Role | Pages | Actions |
|---|---|---|
| **admin** | All | All |
| **cio** | Dashboard, SCR list, SCR detail, Approvals, Feedback, Audit, Notifications | Approve, Reject (stage 4), View audit |
| **agm_it** | Same as CIO | Same as CIO |
| **project_head** | Dashboard, SCR list, SCR detail, SCR create, Feedback, Audit, Notifications | Create SCR, Edit, Assign, Advance, Reject (stage 3), View audit |
| **implementation** | Dashboard, SCR list, SCR detail, SCR create, Feedback, Audit, Notifications | Create SCR, Edit, Assign, Advance, Reject, Close ticket, View audit |
| **developer** | Dashboard, SCR list, SCR detail, Feedback, Notifications | Edit, Advance stage (5→6), Acknowledge |
| **requester** | Self-service, SCR detail (own only), Feedback, Notifications | Create SCR (via self-service), Submit feedback |

---

## 🔒 Security Model

- **Client-side only** (no backend). Security enforced in JS + localStorage.
- Passwords are stored plaintext in seed/localStorage. **For production**: replace with server-side auth.
- Auth checks are enforced in:
  - `router.js` → `navigate()` (page-level)
  - `scr-manager.js` → `renderDetail()` (requester-only-own-SCRs)
  - `scr-manager.js` → `updateSCR()` (terminal state guard)
  - `approval.js` → `canApprove()` (self-approval block + stage scope)
  - `feedback.js` → `submitFeedback()` (creator-only, closed-only, one-per-user)
- XSS prevention: every user-generated string passes `Utils.escapeHtml()` before rendering
- Login rate limit: 5 attempts → 60s lockout per username
- localStorage quota: auto-prunes audit (>2000) and read notifs (>90d) on boot

---

*Last updated: commit `192f63b` — production hardening pass. See `git log` for full change history.*
