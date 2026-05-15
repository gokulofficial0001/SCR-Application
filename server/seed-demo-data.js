// Demo data seeder — adds 15 hospital departments with HOD + IT-coordinator
// assignments AND one requester login per clinical department, so the SCR
// workflow can be demoed end-to-end from any of them.
//
// Idempotent: re-running won't duplicate anything — existing departments
// (matched by name) are updated, existing usernames are skipped.
//
// Run:  node seed-demo-data.js
//
// Passwords are bcrypt-hashed BEFORE the POST hits the server, so the DB
// never holds the plaintext "req123" even briefly.

const { hashPassword } = require('./auth-helpers');

const API = 'http://localhost:3500/api';
const REQUESTER_PASSWORD = 'req123';

// IT-team users that already exist and can act as per-dept coordinators.
// Cycled round-robin across the clinical depts below.
const IT_COORDINATORS = [
  { name: 'Mrs. Saranya P',     email: 'saranya@hospital.in' },
  { name: 'Mr. Gokulraj S',     email: 'gokulraj@hospital.in' },
  { name: 'Mr. Nantha Kumar S', email: 'nantha@hospital.in' }
];

// 15 demo departments — clinical + support. Each will get one requester.
// Each dept's id is derived from `short` (e.g. dept_cardio) to avoid the
// dept_1/dept_2/... collision with any pre-existing rows from earlier seeds.
const DEPARTMENTS = [
  { short: 'cardio',   name: 'Cardiology',             hodName: 'Dr. Ramesh Kumar',  hodEmail: 'ramesh@hospital.in'  },
  { short: 'radio',    name: 'Radiology',              hodName: 'Dr. Priya Sharma',  hodEmail: 'priya@hospital.in'   },
  { short: 'neuro',    name: 'Neurology',              hodName: 'Dr. Suresh Menon',  hodEmail: 'suresh@hospital.in'  },
  { short: 'ortho',    name: 'Orthopedics',            hodName: 'Dr. Kavitha Nair',  hodEmail: 'kavitha@hospital.in' },
  { short: 'paed',     name: 'Pediatrics',             hodName: 'Dr. Anil Gupta',    hodEmail: 'anil@hospital.in'    },
  { short: 'onco',     name: 'Oncology',               hodName: 'Dr. Lakshmi Iyer',  hodEmail: 'lakshmi@hospital.in' },
  { short: 'emerg',    name: 'Emergency Medicine',     hodName: 'Dr. Vikram Singh',  hodEmail: 'vikram@hospital.in'  },
  { short: 'surg',     name: 'General Surgery',        hodName: 'Dr. Meena Patel',   hodEmail: 'meena@hospital.in'   },
  { short: 'ophth',    name: 'Ophthalmology',          hodName: 'Dr. Rajesh Verma',  hodEmail: 'rajesh@hospital.in'  },
  { short: 'pharm',    name: 'Pharmacy',               hodName: 'Mr. Ganesh Babu',   hodEmail: 'ganesh@hospital.in'  },
  { short: 'lab',      name: 'Laboratory',             hodName: 'Dr. Saranya M',     hodEmail: 'saranyam@hospital.in'},
  { short: 'nurs',     name: 'Nursing',                hodName: 'Ms. Anjali Thomas', hodEmail: 'anjali@hospital.in'  },
  { short: 'admin',    name: 'Administration',         hodName: 'Mr. Senthil Raja',  hodEmail: 'senthil@hospital.in' },
  { short: 'fin',      name: 'Finance & Billing',      hodName: 'Mr. Karthik R',     hodEmail: 'karthik@hospital.in' },
  { short: 'it',       name: 'Information Technology', hodName: 'Mr. Panneer Selvan',hodEmail: 'panneer@hospital.in',
    coordinatorName: 'Mr. Gokulraj S', coordinatorEmail: 'gokulraj@hospital.in', skipRequester: true }
];

// First-name lookup so a department requester sounds realistic — pulled from
// the HOD's department so the demo data feels coherent.
const REQUESTER_NAMES = {
  cardio: 'Dr. Arjun Krishnan',  radio: 'Dr. Neha Reddy',     neuro: 'Dr. Sandeep Pillai',
  ortho:  'Dr. Manish Joshi',    paed:  'Dr. Sneha Kapoor',   onco:  'Dr. Rohit Bansal',
  emerg:  'Dr. Pooja Mehta',     surg:  'Dr. Vinod Kumar',    ophth: 'Dr. Aishwarya Rao',
  pharm:  'Mr. Hari Prasad',     lab:   'Ms. Divya Krishnan', nurs:  'Ms. Latha Murugan',
  admin:  'Mr. Suresh Iyer',     fin:   'Ms. Revathi Subramanian'
};

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
  console.log('  Demo data seeder — departments + per-dept requesters');
  console.log('============================================================\n');

  await login();
  console.log('  Authenticated as admin\n');

  // ── 1. Merge departments ────────────────────────────────────
  const existingDepts = await getColl('departments');
  const byName = new Map(existingDepts.map(d => [d.name.toLowerCase(), d]));
  const merged = [];
  let added = 0, updated = 0;

  for (let i = 0; i < DEPARTMENTS.length; i++) {
    const seed = DEPARTMENTS[i];
    const coord = seed.coordinatorName
      ? { name: seed.coordinatorName, email: seed.coordinatorEmail }
      : IT_COORDINATORS[i % IT_COORDINATORS.length];

    const existing = byName.get(seed.name.toLowerCase());
    const dept = {
      id: existing ? existing.id : `dept_${seed.short}`,
      name: seed.name,
      hodName: seed.hodName,
      hodEmail: seed.hodEmail,
      coordinatorName: coord.name,
      coordinatorEmail: coord.email,
      createdAt: existing ? (existing.createdAt || nowISO()) : nowISO(),
      updatedAt: nowISO()
    };
    merged.push(dept);
    if (existing) updated++; else added++;
    byName.delete(seed.name.toLowerCase());
  }
  // Preserve any pre-existing departments not in our seed list (don't nuke user data)
  for (const leftover of byName.values()) merged.push(leftover);

  await putColl('departments', merged);
  console.log(`  departments  added ${added}, updated ${updated}, preserved ${byName.size} other`);
  console.log(`               total now: ${merged.length}\n`);

  // ── 2. Add one requester per clinical department ────────────
  const existingUsers = await getColl('users');
  const usernamesLower = new Set(existingUsers.map(u => String(u.username || '').toLowerCase()));
  const finalUsers = [...existingUsers];
  let userAdded = 0, userSkipped = 0;
  const hashedDefault = hashPassword(REQUESTER_PASSWORD);

  for (const dept of DEPARTMENTS) {
    if (dept.skipRequester) continue;
    const username = `req_${dept.short}`;
    if (usernamesLower.has(username)) { userSkipped++; continue; }

    finalUsers.push({
      id: `user_req_${dept.short}`,
      name: REQUESTER_NAMES[dept.short] || `Requester ${dept.name}`,
      username,
      password: hashedDefault,
      role: 'requester',
      email: `${username}@hospital.in`,
      department: dept.name,
      createdAt: nowISO(),
      updatedAt: nowISO()
    });
    userAdded++;
  }

  if (userAdded > 0) await putColl('users', finalUsers);
  console.log(`  requesters   added ${userAdded}, skipped ${userSkipped} (already exist)`);
  console.log(`               login pattern: req_<dept>  /  ${REQUESTER_PASSWORD}\n`);

  // ── 3. Verify ───────────────────────────────────────────────
  console.log('  --- verification ---');
  const finalDepts = await getColl('departments');
  const finalUsersCheck = await getColl('users');

  const missingCoord = finalDepts.filter(d => !d.coordinatorName);
  console.log(`  [${missingCoord.length === 0 ? 'PASS' : 'WARN'}] ` +
    `every dept has an IT coordinator (${finalDepts.length - missingCoord.length}/${finalDepts.length})`);

  const reqUsers = finalUsersCheck.filter(u => u.role === 'requester');
  const deptsCovered = new Set(reqUsers.map(u => u.department));
  const clinicalDepts = DEPARTMENTS.filter(d => !d.skipRequester).map(d => d.name);
  const uncovered = clinicalDepts.filter(n => !deptsCovered.has(n));
  console.log(`  [${uncovered.length === 0 ? 'PASS' : 'WARN'}] ` +
    `every clinical dept has a requester (${clinicalDepts.length - uncovered.length}/${clinicalDepts.length})`);
  if (uncovered.length) console.log(`         uncovered: ${uncovered.join(', ')}`);

  // Smoke-test one of the new logins so we know bcrypt round-trip works
  const sample = finalUsersCheck.find(u => u.username === 'req_cardio');
  if (sample) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'req_cardio', password: REQUESTER_PASSWORD })
    });
    console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] sample login req_cardio/${REQUESTER_PASSWORD} -> ${r.status}`);
  }

  console.log('\n============================================================');
  console.log(`  Done. ${finalDepts.length} departments, ${reqUsers.length} requesters.`);
  console.log('  Demo logins:  req_radio / req123, req_neuro / req123, etc.');
  console.log('============================================================');
})().catch(e => { console.error('\nSEED FAILED:', e.message); process.exit(1); });
