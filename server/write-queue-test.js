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
let SERVER_SCR_NUMBER = '173';
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
  let responseBody = opts && opts.body ? JSON.parse(opts.body) : {};
  if (opts && opts.method === 'POST') {
    if (url === '/api/scr_requests') {
      responseBody = { ...responseBody, scrNumber: SERVER_SCR_NUMBER };
    }
    serverPosts.push({ url, body: JSON.parse(opts.body), responseBody });
  }
  return { ok: true, status: 200, json: async () => responseBody };
}

let storeRef = null;
const Utils = {
  generateId: () => 'id_' + Math.random().toString(36).slice(2, 12),
  nowISO: () => new Date().toISOString(),
  generateProvisionalSCRNumber: () => {
    let max = 146;
    (storeRef ? storeRef.getAll('scr_requests') : []).forEach(scr => {
      const raw = String(scr.scrNumber || '').trim();
      if (/^\d+$/.test(raw) && Number(raw) > max) max = Number(raw);
    });
    return String(max + 1);
  },
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
  storeRef = S;
  S._cache = {};
  S.COLLECTIONS.forEach(c => { S._cache[c] = []; });
  S._ready = true;
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

  // 5. OFFLINE SCR — the server assigns the permanent number during sync
  console.log('5. OFFLINE SCR — provisional references are reconciled on sync');
  SERVER_UP = false;
  Store = loadFreshStore();
  Store._cache.scr_requests.push({ id: 'scr_old', scrNumber: '170' });
  const pendingSCR = await Store.addSCR({ id: 'scr_q3', createdBy: 'user_q3', scrNumber: '' });
  if (!pendingSCR.pending || pendingSCR.scr.scrNumber !== '171') {
    fail('offline SCR was not queued with a provisional number');
  }
  Store.add('audit_log', {
    id: 'audit_q3', entityType: 'SCR', entityId: 'scr_q3', action: 'Created',
    newValue: pendingSCR.scr.scrNumber
  });
  Store.add('notifications', {
    id: 'notif_q3', scrId: 'scr_q3',
    message: `New SCR submitted: ${pendingSCR.scr.scrNumber} from Test — awaiting review`
  });
  await tick();
  if (Store.pendingWrites() !== 3) fail(`expected 3 queued SCR-related writes, got ${Store.pendingWrites()}`);

  SERVER_UP = true;
  SERVER_SCR_NUMBER = '173';
  serverPosts.length = 0;
  await Store._flushQueue();
  const savedSCR = serverPosts.find(p => p.url === '/api/scr_requests');
  const savedAudit = serverPosts.find(p => p.url === '/api/audit_log');
  const savedNotification = serverPosts.find(p => p.url === '/api/notifications');
  if (!savedSCR || savedSCR.responseBody.scrNumber !== '173') fail('server did not assign the permanent SCR number');
  if (!savedAudit || savedAudit.body.newValue !== '173') fail('queued audit entry kept the provisional number');
  if (!savedNotification || !savedNotification.body.message.includes('173')) {
    fail('queued notification kept the provisional number');
  }
  pass('server-assigned number and dependent queued records were reconciled');
  console.log('');

  // 6. ONLINE SCR — the UI waits for the server-assigned number
  console.log('6. ONLINE SCR — the server response populates the cache');
  Store = loadFreshStore();
  serverPosts.length = 0;
  const savedOnlineSCR = await Store.addSCR({ id: 'scr_q4', createdBy: 'user_q4', scrNumber: '' });
  if (savedOnlineSCR.pending || savedOnlineSCR.scr.scrNumber !== '173') {
    fail('online SCR did not use the server-assigned number');
  }
  if (Store.getById('scr_requests', 'scr_q4').scrNumber !== '173') {
    fail('online SCR cache was not updated from the server response');
  }
  const onlinePost = serverPosts.find(p => p.url === '/api/scr_requests');
  if (!onlinePost || onlinePost.body.scrNumber !== '') {
    fail('client sent a generated number instead of asking the server to assign it');
  }
  pass('online submission used the assigned number returned by the server');
  console.log('');

  console.log('============================================================');
  console.log('  ALL PASSED — a requester submission is never lost:');
  console.log('  queued on failure, survives refresh, auto-syncs on recovery.');
  console.log('============================================================');
})().catch(e => { console.error('\nTEST ERROR:', e.message); process.exit(1); });
