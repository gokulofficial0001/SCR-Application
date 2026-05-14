// Verifies the offline write-queue in js/store.js:
//   server DOWN  -> requester's write is queued (not lost)
//   page refresh -> queue survives in localStorage
//   server UP    -> flusher replays the queue, server receives the write
//
// Runs store.js inside a vm sandbox with shimmed localStorage + fetch.

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const STORE_CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8')
  + '\nthis.__Store = Store;';

// ── shared shims (persist across simulated refreshes) ──
const _ls = new Map();
const localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k)
};

let SERVER_UP = false;
const serverPosts = [];
async function fetchShim(url, opts) {
  if (url.includes('/api/admin/snapshot')) {
    // hydrate() always needs to succeed for the test to proceed
    const snap = {};
    for (const c of ['users','departments','scr_requests','workflow_stages',
      'approvals','feedback','notifications','development_updates','audit_log','sla_config']) snap[c] = [];
    snap._meta = { seeded: true };
    return { ok: true, status: 200, json: async () => snap };
  }
  if (!SERVER_UP) throw new Error('ECONNREFUSED (simulated server down)');
  if (opts && opts.method === 'POST') {
    serverPosts.push({ url, body: JSON.parse(opts.body) });
  }
  return { ok: true, status: 200, json: async () => (opts && opts.body ? JSON.parse(opts.body) : {}) };
}

const Utils = {
  generateId: () => 'id_' + Math.random().toString(36).slice(2, 12),
  nowISO: () => new Date().toISOString(),
  toast: (t, title, msg) => console.log(`     (toast:${t}) ${title} — ${msg}`)
};

function loadFreshStore() {
  const ctx = {
    localStorage, fetch: fetchShim, Utils, console,
    setInterval, clearInterval, setTimeout, clearTimeout,
    Math, Date, JSON, Object, Array, Promise, Set, Error
  };
  vm.createContext(ctx);
  vm.runInContext(STORE_CODE, ctx);
  const S = ctx.__Store;
  S._cache = {};
  S.COLLECTIONS.forEach(c => { S._cache[c] = []; });
  return S;
}

const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
function pass(m) { console.log('  [PASS] ' + m); }
function fail(m) { console.log('  [FAIL] ' + m); process.exitCode = 1; throw new Error(m); }

(async () => {
  console.log('============================================================');
  console.log('  Offline write-queue test');
  console.log('============================================================\n');

  // 1. SERVER DOWN — requester creates an SCR
  console.log('1. Server DOWN — requester submits an SCR via Store.add()');
  SERVER_UP = false;
  let Store = loadFreshStore();
  Store._loadQueue();
  Store.add('scr_requests', { id: 'scr_q1', scrNumber: 'SCR-QTEST-001', moduleName: 'Queue Test' });
  await tick();
  if (Store.pendingWrites() !== 1) fail(`expected 1 queued write, got ${Store.pendingWrites()}`);
  pass(`write was QUEUED (pendingWrites=${Store.pendingWrites()}) — not lost`);
  if (!_ls.get('scr_write_queue')) fail('queue not persisted to localStorage');
  pass('queue persisted to localStorage (survives a refresh)');
  console.log('');

  // 2. PAGE REFRESH — fresh Store, queue must reload from localStorage
  console.log('2. Simulate page refresh — brand-new Store instance');
  Store = loadFreshStore();
  const carried = Store._loadQueue();
  if (carried !== 1) fail(`queue did not survive refresh (got ${carried})`);
  pass(`queue restored from localStorage after refresh (${carried} item)`);
  console.log('');

  // 3. SERVER BACK UP — flusher replays the queue
  console.log('3. Server BACK UP — _flushQueue() replays the queue');
  SERVER_UP = true;
  await Store._flushQueue();
  if (Store.pendingWrites() !== 0) fail(`queue not drained (pendingWrites=${Store.pendingWrites()})`);
  pass(`queue fully drained (pendingWrites=0)`);
  const got = serverPosts.find(p => p.body && p.body.scrNumber === 'SCR-QTEST-001');
  if (!got) fail('queued write was NOT replayed to the server');
  pass(`queued write replayed to server: POST ${got.url} (${got.body.scrNumber})`);
  if (_ls.get('scr_write_queue') !== '[]') fail('localStorage queue not cleared after flush');
  pass('localStorage queue cleared after successful flush');
  console.log('');

  // 4. NORMAL PATH — server up, write goes straight through (no queue)
  console.log('4. Server UP from the start — write goes straight through');
  serverPosts.length = 0;
  Store = loadFreshStore();
  Store._loadQueue();
  Store.add('scr_requests', { id: 'scr_q2', scrNumber: 'SCR-QTEST-002', moduleName: 'Direct' });
  await tick();
  if (Store.pendingWrites() !== 0) fail('write was queued even though server is up');
  if (!serverPosts.find(p => p.body && p.body.scrNumber === 'SCR-QTEST-002')) fail('direct write never reached server');
  pass('server-up write reached server immediately, queue stayed empty');
  console.log('');

  console.log('============================================================');
  console.log('  ALL PASSED — a requester submission is never lost:');
  console.log('  queued on failure, survives refresh, auto-syncs on recovery.');
  console.log('============================================================');
})().catch(e => { console.error('\nTEST ERROR:', e.message); process.exit(1); });
