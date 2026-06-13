const express = require('express');
const { db, COLLECTIONS } = require('./db');

const router = express.Router();
const nowISO = () => new Date().toISOString();

const CASCADE_ON_SCR_DELETE = ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates'];

// VULN-002: explicit allowlist — every handler that interpolates coll into SQL
// must validate against this Set before executing any query.
const ALLOWED_COLLS = new Set([
  'users', 'departments', 'scr_requests', 'workflow_stages', 'approvals',
  'feedback', 'notifications', 'development_updates', 'audit_log', 'sla_config'
]);

const isValidColl = (c) => ALLOWED_COLLS.has(c);

// Roles restricted to their OWN SCRs — enforced server-side (not just in the UI),
// so the ownership rule can't be bypassed by calling the API directly.
const SELF_ONLY_ROLES = new Set(['requester', 'internal_requester']);

router.param('coll', (req, res, next, coll) => {
  if (!isValidColl(coll)) return res.status(404).json({ error: `Unknown collection: ${coll}` });
  next();
});

router.get('/:coll', (req, res) => {
  const coll = req.params.coll;
  const role = req.user?.role;
  const isAdmin = role === 'admin';
  const rows = db.prepare(`SELECT data FROM ${coll}`).all();
  let out = rows.map(r => {
    const parsed = JSON.parse(r.data);
    if (coll === 'users' && !isAdmin) { delete parsed.password; }
    return parsed;
  });
  // Ownership: requester / internal_requester only get their own SCRs (server-side).
  if (coll === 'scr_requests' && SELF_ONLY_ROLES.has(role)) {
    out = out.filter(s => s.createdBy === req.user.id);
  }
  res.json(out);
});

router.put('/:coll', (req, res) => {
  const coll = req.params.coll;
  const PROTECTED_COLLS = ['users', 'approvals', 'audit_log', 'workflow_stages', 'sessions', 'scr_requests'];
  if (PROTECTED_COLLS.includes(coll) && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin only' });
  }
  const items = Array.isArray(req.body) ? req.body : [];
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM ${coll}`).run();
    const insert = db.prepare(`INSERT INTO ${coll} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`);
    for (const item of items) {
      if (!item.id) continue;
      insert.run(item.id, JSON.stringify(item), item.createdAt || nowISO(), item.updatedAt || nowISO());
    }
  });
  tx();
  res.json({ count: items.length });
});

router.get('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  const role = req.user?.role;
  const isAdmin = role === 'admin';
  const row = db.prepare(`SELECT data FROM ${coll} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const parsed = JSON.parse(row.data);
  // Ownership: requester / internal_requester can only read their own SCRs.
  if (coll === 'scr_requests' && SELF_ONLY_ROLES.has(role) && parsed.createdBy !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: you can only view your own SCRs' });
  }
  if (coll === 'users' && !isAdmin) { delete parsed.password; }
  res.json(parsed);
});

router.post('/:coll', (req, res) => {
  const coll = req.params.coll;
  const item = req.body || {};
  if (!item.id) return res.status(400).json({ error: 'id required' });
  item.createdAt = item.createdAt || nowISO();
  item.updatedAt = nowISO();
  const stmt = db.prepare(`INSERT INTO ${coll} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`);
  try {
    stmt.run(item.id, JSON.stringify(item), item.createdAt, item.updatedAt);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'Conflict: record already exists. Use PATCH to update.' });
    }
    throw err;
  }
  res.json(item);
});

router.patch('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  const id = req.params.id;
  const updates = req.body || {};
  const row = db.prepare(`SELECT data FROM ${coll} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const current = JSON.parse(row.data);

  // ── Server-side write authorization for SCRs (mirrors the UI rules) ──
  if (coll === 'scr_requests') {
    const role = req.user?.role;
    // Plain requesters have no edit rights at all.
    if (role === 'requester') {
      return res.status(403).json({ error: 'Forbidden: requesters cannot edit SCRs' });
    }
    // Internal requesters may edit only their OWN SCR, and only before the
    // Implementation team accepts it (Stage 2).
    if (role === 'internal_requester') {
      const owns = current.createdBy === req.user.id;
      const beforeStage2 = (current.currentStage || 1) < 2;
      if (!owns || !beforeStage2) {
        return res.status(403).json({ error: 'Forbidden: you can only edit your own SCR before it is accepted' });
      }
    }
    // IT-side roles (impl, project_head, developer, agm_it, cio, admin) proceed.
  }

  if (updates._expectedUpdatedAt && current.updatedAt && current.updatedAt !== updates._expectedUpdatedAt) {
    return res.status(409).json({ error: 'Conflict: record was updated by another user. Please refresh and retry.' });
  }
  delete updates._expectedUpdatedAt; // remove before saving
  const merged = { ...current, ...updates, updatedAt: nowISO() };
  db.prepare(`UPDATE ${coll} SET data = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(merged), merged.updatedAt, id);
  res.json(merged);
});

router.delete('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  const id = req.params.id;
  if (coll === 'scr_requests') {
    // Only admin may delete an SCR (and its child records).
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: only admin can delete SCRs' });
    }
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM ${coll} WHERE id = ?`).run(id);
      for (const child of CASCADE_ON_SCR_DELETE) {
        db.prepare(`DELETE FROM ${child} WHERE json_extract(data, '$.scrId') = ?`).run(id);
      }
    });
    tx();
  } else {
    db.prepare(`DELETE FROM ${coll} WHERE id = ?`).run(id);
  }
  res.json({ ok: true });
});

const metaRoutes = express.Router();

metaRoutes.get('/:key', (req, res) => {
  const row = db.prepare(`SELECT data FROM meta WHERE key = ?`).get(req.params.key);
  if (!row) return res.json(null);
  res.json(JSON.parse(row.data));
});

metaRoutes.put('/:key', (req, res) => {
  const value = req.body;
  db.prepare(`INSERT OR REPLACE INTO meta (key, data, updated_at) VALUES (?, ?, ?)`)
    .run(req.params.key, JSON.stringify(value), nowISO());
  res.json(value);
});

metaRoutes.delete('/:key', (req, res) => {
  db.prepare(`DELETE FROM meta WHERE key = ?`).run(req.params.key);
  res.json({ ok: true });
});

const adminRoutes = express.Router();

adminRoutes.get('/snapshot', (req, res) => {
  const role = req.user?.role;
  const isAdmin = role === 'admin';
  const selfOnly = SELF_ONLY_ROLES.has(role);
  const out = {};
  for (const coll of COLLECTIONS) {
    const rows = db.prepare(`SELECT data FROM ${coll}`).all();
    let arr = rows.map(r => {
      const parsed = JSON.parse(r.data);
      if (coll === 'users' && !isAdmin) { delete parsed.password; }
      return parsed;
    });
    // Requester / internal_requester hydrate only their own SCRs.
    if (coll === 'scr_requests' && selfOnly) {
      arr = arr.filter(s => s.createdBy === req.user.id);
    }
    out[coll] = arr;
  }
  const metaRows = db.prepare(`SELECT key, data FROM meta`).all();
  out._meta = {};
  for (const m of metaRows) out._meta[m.key] = JSON.parse(m.data);
  res.json(out);
});

adminRoutes.post('/import', (req, res) => {
  const payload = req.body || {};
  const tx = db.transaction(() => {
    for (const coll of COLLECTIONS) {
      const items = Array.isArray(payload[coll]) ? payload[coll] : [];
      db.prepare(`DELETE FROM ${coll}`).run();
      const insert = db.prepare(`INSERT INTO ${coll} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`);
      for (const item of items) {
        if (!item.id) continue;
        insert.run(item.id, JSON.stringify(item), item.createdAt || nowISO(), item.updatedAt || nowISO());
      }
    }
    if (payload._meta && typeof payload._meta === 'object') {
      db.prepare(`DELETE FROM meta`).run();
      const insertMeta = db.prepare(`INSERT INTO meta (key, data, updated_at) VALUES (?, ?, ?)`);
      for (const [k, v] of Object.entries(payload._meta)) {
        insertMeta.run(k, JSON.stringify(v), nowISO());
      }
    }
  });
  tx();
  res.json({ ok: true });
});

adminRoutes.post('/reset', (req, res) => {
  const tx = db.transaction(() => {
    for (const coll of COLLECTIONS) db.prepare(`DELETE FROM ${coll}`).run();
    db.prepare(`DELETE FROM meta`).run();
  });
  tx();
  res.json({ ok: true });
});

// Public health handler — exported separately so server.js can register
// it OUTSIDE the auth/admin gates (monitoring + the watchdog must reach
// it without a token).
function healthHandler(req, res) {
  const counts = {};
  for (const coll of COLLECTIONS) {
    counts[coll] = db.prepare(`SELECT COUNT(*) AS n FROM ${coll}`).get().n;
  }
  res.json({ ok: true, counts, timestamp: nowISO() });
}
adminRoutes.get('/health', healthHandler);  // kept for backward compat too

module.exports = { router, metaRoutes, adminRoutes, healthHandler };
