# SCR Backend (Express + SQLite)

Lightweight backend for the SCR Management System. Replaces `serve.ps1` once Phase 2 (frontend rewrite) is complete. For now it runs **alongside** `serve.ps1` — you can verify the API works without changing the frontend.

## Prerequisites

- **Node.js v22.5 or newer** — download from https://nodejs.org/. Uses Node's built-in `node:sqlite` module (no native compilation, no Python/Build Tools needed).
- Run on the host machine (10.10.1.26)

## First-time setup

```powershell
cd "D:\scr\SCR APPLICATION ANTIGRAVITY\SCR FILES\server"
npm install
```

This installs Express and CORS only. SQLite is built into Node 22.5+ — no separate install, no compilation. The `data/scr.db` file is auto-created on first run.

## Run the server

```powershell
npm start
```

You should see:

```
   Local:    http://localhost:3500/
   LAN:      http://10.10.1.26:3500/
   API:      http://localhost:3500/api/
   Health:   http://localhost:3500/api/admin/health
   Database: D:\scr\...\server\data\scr.db
```

The server serves both:
- **Static files** — your existing `index.html`, `js/`, `css/` (so the app keeps working at the same URL)
- **REST API** — `/api/*` endpoints backed by SQLite

## Stopping the existing PowerShell server first

If `serve.ps1` is still running on port 3500, stop it before starting the Node server (Ctrl+C in its terminal). Both can't bind to 3500 at the same time.

## Verifying the API works

In a browser or via curl:

```bash
# Health check — should return counts of all collections (all 0 initially)
curl http://localhost:3500/api/admin/health

# List all SCRs (empty array initially)
curl http://localhost:3500/api/scr_requests

# Snapshot of EVERYTHING (used by Store.hydrate in Phase 2)
curl http://localhost:3500/api/admin/snapshot
```

## API endpoints

### Per-collection CRUD (replace `:coll` with the collection name)

| Method | Path | Use |
|---|---|---|
| `GET` | `/api/:coll` | List all items |
| `GET` | `/api/:coll/:id` | Get one item |
| `POST` | `/api/:coll` | Create (body must include `id`) |
| `PATCH` | `/api/:coll/:id` | Partial update (merges) |
| `PUT` | `/api/:coll` | Bulk replace whole collection |
| `DELETE` | `/api/:coll/:id` | Remove (cascades for `scr_requests`) |

### Collections available

`users`, `departments`, `scr_requests`, `workflow_stages`, `approvals`, `feedback`, `notifications`, `development_updates`, `audit_log`, `sla_config`

### Meta singletons (key/value)

| Method | Path | Use |
|---|---|---|
| `GET` | `/api/meta/:key` | Get value (e.g. `role_permissions`, `seeded`, `migration_version`) |
| `PUT` | `/api/meta/:key` | Set value (body is the value as JSON) |
| `DELETE` | `/api/meta/:key` | Remove |

### Admin

| Method | Path | Use |
|---|---|---|
| `GET` | `/api/admin/snapshot` | Single round-trip dump of everything (Store.hydrate uses this) |
| `POST` | `/api/admin/import` | Bulk-load a snapshot (one-time localStorage migration) |
| `POST` | `/api/admin/reset` | Wipe all tables (admin "Reset Data" button) |
| `GET` | `/api/admin/health` | Liveness check + row counts per collection |

## Migrating your existing localStorage data

(Will be wired into the app's Settings page during Phase 2. For now, manual:)

1. On the host browser at `http://localhost:3500/`, open DevTools console:
   ```js
   const dump = {};
   ['users','departments','scr_requests','workflow_stages','approvals','feedback','notifications','development_updates','audit_log','sla_config'].forEach(k => {
     const raw = localStorage.getItem('scr_' + k);
     dump[k] = raw ? JSON.parse(raw) : [];
   });
   dump._meta = {};
   ['role_permissions','seeded','migration_version'].forEach(k => {
     const raw = localStorage.getItem('scr_' + k);
     if (raw) dump._meta[k] = JSON.parse(raw);
   });
   copy(JSON.stringify(dump));  // copies to clipboard
   ```
2. Paste into a file, e.g. `current-localstorage.json`
3. POST it to the server:
   ```bash
   curl -X POST http://localhost:3500/api/admin/import ^
     -H "Content-Type: application/json" ^
     -d @current-localstorage.json
   ```
4. Verify: `curl http://localhost:3500/api/admin/health` should now show your real row counts.

## Database file

- Location: `server/data/scr.db`
- Format: SQLite 3 with WAL journal
- Backup: just `copy scr.db scr-2026-05-09.db`
- Inspect: open with [DB Browser for SQLite](https://sqlitebrowser.org/) — every table has `id`, `data` (JSON), `created_at`, `updated_at`

## Troubleshooting

- **`EADDRINUSE` / port 3500 in use** → Stop `serve.ps1` first (Ctrl+C in its window). Both can't bind to the same port.
- **`Cannot find module 'node:sqlite'`** → Node is < 22.5. Upgrade to current LTS (22.x or 24.x). Check with `node --version`.
- **CORS error in browser** → Should not happen; CORS is wide-open. Check the request actually hits the Node server (not a stale cache).

## What's NOT in Phase 1

- Frontend `Store` still uses localStorage — your app works exactly as before
- Once Phase 2 lands, `store.js` is rewritten to use these endpoints
- After Phase 2, `serve.ps1` becomes obsolete (this server handles static files too)
