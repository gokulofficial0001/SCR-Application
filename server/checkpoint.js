// One-shot WAL checkpoint: merges scr.db-wal into scr.db and truncates the WAL.
// Run with:  node checkpoint.js
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'scr.db');
const before = fs.existsSync(DB_PATH + '-wal') ? fs.statSync(DB_PATH + '-wal').size : 0;

const db = new DatabaseSync(DB_PATH);
const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
db.close();

const after = fs.existsSync(DB_PATH + '-wal') ? fs.statSync(DB_PATH + '-wal').size : 0;
console.log(`WAL checkpoint: busy=${row.busy} log=${row.log} checkpointed=${row.checkpointed}`);
console.log(`WAL file: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
console.log(`scr.db is now current. Refresh / reopen it in DB Browser.`);
