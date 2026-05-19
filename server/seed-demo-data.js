// Demo data seeder — installs the 17 hospital departments + per-dept
// requester logins per the HOD map provided by the user.
//
// Behavior is a CLEAN REPLACEMENT for the departments collection: every
// pre-existing department row is removed and re-created from the list
// below. For users the script is surgical — it only touches per-dept
// requesters (id pattern user_req_<short>) and updates the existing
// internal_requester's department if it points at a department that
// no longer exists. All other users (admin, CIO, AGM, PH, impl, dev,
// the original user_req2/3) are left as-is.
//
// Run:  node seed-demo-data.js
//
// Passwords are bcrypt-hashed BEFORE the POST hits the server, so the
// database never holds the plaintext "req123" even briefly.

const { hashPassword } = require('./auth-helpers');

const API = 'http://localhost:3500/api';
const REQUESTER_PASSWORD = 'req123';

// 17 hospital departments — order matches the HOD map literal provided
// by the user, so the master-data list reads in the same sequence.
const DEPARTMENTS = [
  { short: 'it',       name: 'IT',               hodName: 'Mr. S. Saravanakumar' },
  { short: 'hr',       name: 'HR',               hodName: 'Mr. Nagappan' },
  { short: 'him',      name: 'HIM',              hodName: 'Mr. Prince Kumar' },
  { short: 'intaudit', name: 'Internal Audit',   hodName: 'Mrs. Mallika Devi' },
  { short: 'quality',  name: 'Quality',          hodName: 'Dr. Madhavi' },
  { short: 'pharm',    name: 'Pharmacy',         hodName: 'Mr. Tamilarasan' },
  { short: 'radio',    name: 'Radiology',        hodName: 'Mrs. Annalakshmi' },
  { short: 'lab',      name: 'Lab',              hodName: 'Dr. Kavitha' },
  { short: 'engg',     name: 'Engineering',      hodName: 'Mr. Ravikumar' },
  { short: 'nurs',     name: 'Nursing',          hodName: 'Mrs. Jayalakshmi' },
  { short: 'acct',     name: 'Accounts',         hodName: 'Mr. Pandia Rajan K' },
  { short: 'biomed',   name: 'Biomedical',       hodName: 'Mrs. Anandhi' },
  { short: 'ins',      name: 'Insurance',        hodName: 'Mr. Surendiran' },
  { short: 'pr',       name: 'Public Relations', hodName: 'Mrs. Bhanu Rao' },
  { short: 'histo',    name: 'Histopathology',   hodName: 'Mrs. Saritha S' },
  { short: 'house',    name: 'Housekeeping',     hodName: 'Mr. Preejith V' },
  { short: 'diet',     name: 'Dietary',          hodName: 'Mrs. Mekala D' }
];

// Generic requester display names — one per dept. The HOD field comes
// from the dept record, not from this list, so we don't have to invent
// real staff names here.
function requesterDisplayName(deptName) {
  return `Requester - ${deptName}`;
}

let TOKEN = null;
const authHeaders = (extra = {}) => ({
  ...extra,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
});

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  if (!r.ok) throw new Error(`Admin login failed: ${r.status}`);
  TOKEN = (await r.json()).token;
}

async function getColl(c) {
  const r = await fetch(`${API}/${c}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`GET ${c} -> ${r.status}`);
  return r.json();
}

async function putColl(c, items) {
  const r = await fetch(`${API}/${c}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(items)
  });
  if (!r.ok) throw new Error(`PUT ${c} -> ${r.status}`);
}

function nowISO() { return new Date().toISOString(); }

(async () => {
  console.log('============================================================');
  console.log('  Demo data seeder — 17-dept HOD map + per-dept requesters');
  console.log('============================================================\n');

  await login();
  console.log('  Authenticated as admin\n');

  // ── 1. Replace departments wholesale ────────────────────────
  const newDepts = DEPARTMENTS.map(d => ({
    id: `dept_${d.short}`,
    name: d.name,
    hodName: d.hodName,
    hodEmail: '',
    coordinatorName: '',
    coordinatorEmail: '',
    createdAt: nowISO(),
    updatedAt: nowISO()
  }));
  await putColl('departments', newDepts);
  console.log(`  departments  REPLACED — now ${newDepts.length} rows (clean wipe)\n`);

  // ── 2. Surgical user update ─────────────────────────────────
  // Keep every system user; drop per-dept requesters whose dept is no
  // longer in the new list; add fresh per-dept requesters for every new
  // dept; reassign the internal_requester to the new IT dept if needed.
  const existingUsers = await getColl('users');
  const newDeptNames = new Set(newDepts.map(d => d.name));
  const hashedDefault = hashPassword(REQUESTER_PASSWORD);

  // Identify which users are per-dept requesters created by a previous
  // run of this script (id starts with user_req_) — those are owned by
  // this script and safe to remove + recreate.
  const isPerDeptRequester = (u) => /^user_req_/.test(u.id);

  // Other requester users (e.g. legacy user_req1/2/3) are NOT touched,
  // but if their department no longer exists their HOD auto-fill will
  // break in the form. We log a warning so the operator notices.
  const orphanedLegacy = existingUsers.filter(u =>
    u.role === 'requester' && !isPerDeptRequester(u) && !newDeptNames.has(u.department)
  );
  if (orphanedLegacy.length) {
    console.log(`  [warn] ${orphanedLegacy.length} legacy requester(s) now in a department that does not exist:`);
    orphanedLegacy.forEach(u => console.log(`         - ${u.username} (id=${u.id}, dept="${u.department}")`));
    console.log('         Their SCRs are unaffected, but the form will not auto-fill the HOD.\n');
  }

  // Internal requester: reassign to "IT" if currently sitting in a
  // department that just got removed.
  const internalReq = existingUsers.find(u => u.role === 'internal_requester');
  if (internalReq && !newDeptNames.has(internalReq.department)) {
    const before = internalReq.department;
    internalReq.department = 'IT';
    internalReq.updatedAt = nowISO();
    console.log(`  internal_requester ${internalReq.username}: dept "${before}" -> "IT"`);
  }

  // Build the final user list: everything that's not a per-dept
  // requester + freshly seeded per-dept requesters.
  const preserved = existingUsers.filter(u => !isPerDeptRequester(u));
  const newPerDept = DEPARTMENTS.map(d => ({
    id: `user_req_${d.short}`,
    name: requesterDisplayName(d.name),
    username: `req_${d.short}`,
    password: hashedDefault,
    role: 'requester',
    email: `req_${d.short}@hospital.in`,
    department: d.name,
    createdAt: nowISO(),
    updatedAt: nowISO()
  }));

  const finalUsers = [...preserved, ...newPerDept];
  await putColl('users', finalUsers);
  console.log(`  users        preserved ${preserved.length} + added ${newPerDept.length} per-dept requesters\n`);

  // ── 3. Verify ───────────────────────────────────────────────
  console.log('  --- verification ---');
  const finalDepts = await getColl('departments');
  const finalUsersCheck = await getColl('users');

  console.log(`  [${finalDepts.length === DEPARTMENTS.length ? 'PASS' : 'FAIL'}] department count: ${finalDepts.length} (expected ${DEPARTMENTS.length})`);

  const hodMismatch = DEPARTMENTS.filter(d => {
    const live = finalDepts.find(x => x.name === d.name);
    return !live || live.hodName !== d.hodName;
  });
  console.log(`  [${hodMismatch.length === 0 ? 'PASS' : 'FAIL'}] every dept has the correct HOD (${DEPARTMENTS.length - hodMismatch.length}/${DEPARTMENTS.length})`);
  if (hodMismatch.length) hodMismatch.forEach(d => console.log(`         missing: ${d.name} -> ${d.hodName}`));

  const reqUsers = finalUsersCheck.filter(u => u.role === 'requester' && isPerDeptRequester(u));
  console.log(`  [${reqUsers.length === DEPARTMENTS.length ? 'PASS' : 'FAIL'}] per-dept requester count: ${reqUsers.length} (expected ${DEPARTMENTS.length})`);

  // Smoke-test one of the new logins so we know bcrypt round-trip works
  const sampleLogin = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'req_it', password: REQUESTER_PASSWORD })
  });
  console.log(`  [${sampleLogin.ok ? 'PASS' : 'FAIL'}] sample login req_it/${REQUESTER_PASSWORD} -> ${sampleLogin.status}`);

  console.log('\n============================================================');
  console.log(`  Done. ${finalDepts.length} departments, ${reqUsers.length} per-dept requesters.`);
  console.log('  Demo logins:  req_it / req123, req_hr / req123, ...');
  console.log('============================================================');
})().catch(e => { console.error('\nSEED FAILED:', e.message); process.exit(1); });
