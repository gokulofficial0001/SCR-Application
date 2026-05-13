const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'scr.db');
const raw = new DatabaseSync(DB_PATH);

raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');

const db = {
  _raw: raw,
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const out = fn(...args);
      raw.exec('COMMIT');
      return out;
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch {}
      throw e;
    }
  },
  pragma: (stmt) => raw.exec(`PRAGMA ${stmt}`)
};

const COLLECTIONS = [
  'users',
  'departments',
  'scr_requests',
  'workflow_stages',
  'approvals',
  'feedback',
  'notifications',
  'development_updates',
  'audit_log',
  'sla_config'
];

for (const coll of COLLECTIONS) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${coll} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT
  );
`);

for (const coll of ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates', 'audit_log']) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${coll}_scr ON ${coll} (json_extract(data, '$.scrId'));`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (json_extract(data, '$.userId'));`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users (json_extract(data, '$.username'));`);

module.exports = { db, COLLECTIONS, DB_PATH };
