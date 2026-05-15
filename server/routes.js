const express = require('express');
const { db, COLLECTIONS } = require('./db');

const router = express.Router();
const nowISO = () => new Date().toISOString();

const CASCADE_ON_SCR_DELETE = ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates'];

const isValidColl = (c) => COLLECTIONS.includes(c);

router.param('coll', (req, res, next, coll) => {
  if (!isValidColl(coll)) return res.status(404).json({ error: `Unknown collection: ${coll}` });
  next();
});

router.get('/:coll', (req, res) => {
  const rows = db.prepare(`SELECT data FROM ${req.params.coll}`).all();
  res.json(rows.map(r => JSON.parse(r.data)));
});

router.put('/:coll', (req, res) => {
  const coll = req.params.coll;
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
  const row = db.prepare(`SELECT data FROM ${req.params.coll} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(row.data));
});

router.post('/:coll', (req, res) => {
  const coll = req.params.coll;
  const item = req.body || {};
  if (!item.id) return res.status(400).json({ error: 'id required' });
  item.createdAt = item.createdAt || nowISO();
  item.updatedAt = nowISO();
  db.prepare(`INSERT OR REPLACE INTO ${coll} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(item.id, JSON.stringify(item), item.createdAt, item.updatedAt);
  res.json(item);
});

router.patch('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  const id = req.params.id;
  const updates = req.body || {};
  const row = db.prepare(`SELECT data FROM ${coll} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const merged = { ...JSON.parse(row.data), ...updates, updatedAt: nowISO() };
  db.prepare(`UPDATE ${coll} SET data = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(merged), merged.updatedAt, id);
  res.json(merged);
});

router.delete('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  const id = req.params.id;
  if (coll === 'scr_requests') {
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
  const out = {};
  for (const coll of COLLECTIONS) {
    const rows = db.prepare(`SELECT data FROM ${coll}`).all();
    out[coll] = rows.map(r => JSON.parse(r.data));
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
