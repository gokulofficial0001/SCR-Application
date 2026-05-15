// One-shot data consolidation:
//  - Merges duplicate user records (user_req -> user_req1, user_dev -> user_dev1)
//    by remapping every reference across all collections, then deleting the strays.
//  - Restores role_permissions to the backend meta.
//
// Pure DATA fix — no workflow logic is touched. Run with:  node consolidate-users.js

const API = 'http://localhost:3500/api';

// stray id -> canonical id
const REMAP = {
  user_req: 'user_req1',
  user_dev: 'user_dev1'
};

// per-collection fields that store a user id
const USER_ID_FIELDS = {
  scr_requests:        ['createdBy', 'assignedDeveloper', 'assignedDeveloper2', 'acknowledgedBy', 'phAcceptedBy', 'heldBy'],
  workflow_stages:     ['performedBy', 'exitedBy'],
  feedback:            ['submittedBy'],
  notifications:       ['userId'],
  development_updates: ['authorId']
};

// canonical role_permissions (mirrors store.js seed — includes the 'hold' action)
const ROLE_PERMISSIONS = {
  admin:          { pages: ['dashboard','scr-list','scr-detail','scr-create','approvals','feedback','audit','reports','master-data','notifications','settings'], actions: ['create_scr','edit_scr','delete_scr','assign_scr','advance_stage','approve','reject','hold','close_ticket','manage_users','manage_departments','view_audit','view_reports','reset_data'] },
  cio:            { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','hold','view_audit'] },
  agm_it:         { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','hold','view_audit'] },
  project_head:   { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','hold','view_audit'] },
  implementation: { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','hold','close_ticket','view_audit'] },
  developer:      { pages: ['dashboard','scr-list','scr-detail','feedback','notifications'], actions: ['edit_scr','advance_stage'] },
  requester:      { pages: ['self-service','scr-detail','scr-create','feedback','notifications'], actions: ['create_scr','submit_feedback'] }
};

let TOKEN = null;
function authHeaders(extra = {}) {
  const h = { ...extra };
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`;
  return h;
}
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  if (!r.ok) throw new Error(`Login as admin failed: ${r.status} — cannot consolidate without admin rights`);
  TOKEN = (await r.json()).token;
}
async function getColl(c) {
  const r = await fetch(`${API}/${c}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${c} -> ${r.status}`);
  return r.json();
}
async function putColl(c, items) {
  const r = await fetch(`${API}/${c}`, {
    method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(items)
  });
  if (!r.ok) throw new Error(`PUT ${c} -> ${r.status}`);
}
async function putMeta(k, v) {
  const r = await fetch(`${API}/meta/${k}`, {
    method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(v)
  });
  if (!r.ok) throw new Error(`PUT meta/${k} -> ${r.status}`);
}

(async () => {
  console.log('============================================================');
  console.log('  User consolidation + role_permissions restore');
  console.log('============================================================\n');
  await login();
  console.log('  Authenticated as admin\n');

  // 1. Remap user-id references in every collection
  for (const [coll, fields] of Object.entries(USER_ID_FIELDS)) {
    const items = await getColl(coll);
    let changed = 0;
    for (const item of items) {
      for (const f of fields) {
        if (item[f] && REMAP[item[f]]) { item[f] = REMAP[item[f]]; changed++; }
      }
    }
    if (changed > 0) { await putColl(coll, items); console.log(`  ${coll.padEnd(20)} remapped ${changed} reference(s)`); }
    else            { console.log(`  ${coll.padEnd(20)} no references to remap`); }
  }

  // 2. audit_log — remap entityId only for User-type entries (performedBy is a name, leave it)
  const audit = await getColl('audit_log');
  let auChanged = 0;
  for (const e of audit) {
    if (e.entityType === 'User' && e.entityId && REMAP[e.entityId]) { e.entityId = REMAP[e.entityId]; auChanged++; }
  }
  if (auChanged > 0) { await putColl('audit_log', audit); console.log(`  audit_log            remapped ${auChanged} entityId(s)`); }
  else               { console.log(`  audit_log            no entityIds to remap`); }

  // 3. Delete the stray duplicate user records
  const users = await getColl('users');
  const strayIds = Object.keys(REMAP);
  const kept = users.filter(u => !strayIds.includes(u.id));
  const removed = users.length - kept.length;
  await putColl('users', kept);
  console.log(`  users                removed ${removed} duplicate(s): ${strayIds.join(', ')}`);

  // 4. Restore role_permissions to backend meta
  await putMeta('role_permissions', ROLE_PERMISSIONS);
  console.log(`  meta.role_permissions restored (${Object.keys(ROLE_PERMISSIONS).length} roles)`);

  // 5. Verify
  console.log('\n  --- verification ---');
  const finalUsers = await getColl('users');
  const counts = {};
  finalUsers.forEach(u => { counts[u.username] = (counts[u.username] || 0) + 1; });
  const stillDup = Object.entries(counts).filter(([, n]) => n > 1);
  if (stillDup.length === 0) {
    console.log(`  [PASS] no duplicate usernames remain (${finalUsers.length} users total)`);
  } else {
    console.log(`  [FAIL] still duplicated: ${JSON.stringify(stillDup)}`);
    process.exit(1);
  }

  // confirm every SCR's createdBy points to a real user
  const scrs = await getColl('scr_requests');
  const userIds = new Set(finalUsers.map(u => u.id));
  const orphans = scrs.filter(s => s.createdBy && !userIds.has(s.createdBy));
  if (orphans.length === 0) {
    console.log(`  [PASS] all ${scrs.length} SCRs have a valid createdBy reference`);
  } else {
    console.log(`  [WARN] ${orphans.length} SCR(s) still have an unknown createdBy: ` +
      orphans.map(s => `${s.scrNumber}=${s.createdBy}`).join(', '));
  }

  const rp = await (await fetch(`${API}/meta/role_permissions`)).json();
  console.log(`  [${rp && rp.requester ? 'PASS' : 'FAIL'}] role_permissions in backend: ` +
    (rp ? Object.keys(rp).join(', ') : 'null'));

  console.log('\n============================================================');
  console.log('  Done. Duplicate users consolidated, references remapped,');
  console.log('  role_permissions restored.  >>> Log out + log back in <<<');
  console.log('  so your session picks up the single canonical user id.');
  console.log('============================================================');
})().catch(e => { console.error('\nCONSOLIDATION FAILED:', e.message); process.exit(1); });
