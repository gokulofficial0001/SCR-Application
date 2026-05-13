/* ============================================================
   SCR MANAGEMENT SYSTEM — Data Store (SQLite backend via /api)
   In-memory cache hydrated from server on boot. Mutations update
   the cache synchronously AND fire-and-forget a fetch() to the
   server so the public API stays sync (no caller changes needed).
   Session stays in localStorage (per-device, not shared).
   ============================================================ */

const Store = {
  // ── Storage backend constants ───────────────────────────
  // COLLECTIONS = array-shaped data (mirror server's COLLECTIONS list)
  COLLECTIONS: [
    'users', 'departments', 'scr_requests', 'workflow_stages',
    'approvals', 'feedback', 'notifications', 'development_updates',
    'audit_log', 'sla_config'
  ],
  // META_KEYS = singleton key/value entries (object or scalar)
  META_KEYS: ['seeded', 'migration_version', 'role_permissions'],

  // ── In-memory state ─────────────────────────────────────
  _cache: {},          // { collection: [items] }
  _meta: {},           // { key: value }
  _ready: false,       // true after hydrate succeeds
  _bootBatch: false,   // when true, mutations defer server writes
  _bootDirty: { collections: new Set(), meta: new Set() },
  _networkErrorShown: false,

  // ── Hydrate from server (call once on App.init) ─────────
  async hydrate() {
    const res = await fetch('/api/admin/snapshot', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const snap = await res.json();

    this._cache = {};
    this.COLLECTIONS.forEach(c => {
      this._cache[c] = Array.isArray(snap[c]) ? snap[c] : [];
    });
    this._meta = (snap && snap._meta) || {};
    this._ready = true;

    // First-run migration: if server is empty but THIS browser has
    // pre-backend localStorage data, push it up so nothing is lost.
    const serverHasData = this._meta.seeded === true;
    const localHasData = typeof localStorage !== 'undefined' && localStorage.getItem('scr_seeded') === 'true';
    if (!serverHasData && localHasData) {
      await this._migrateLocalStorageToServer();
    }
  },

  async _migrateLocalStorageToServer() {
    console.log('🚚 Migrating localStorage data to server (one-time)…');
    const payload = {};
    for (const c of this.COLLECTIONS) {
      try {
        const raw = localStorage.getItem(`scr_${c}`);
        payload[c] = raw ? JSON.parse(raw) : [];
      } catch { payload[c] = []; }
    }
    payload._meta = {};
    for (const k of this.META_KEYS) {
      try {
        const raw = localStorage.getItem(`scr_${k}`);
        if (raw) payload._meta[k] = JSON.parse(raw);
      } catch {}
    }
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Migration import failed: ${res.status}`);

    // Reload from server so cache reflects post-import state
    const snap = await (await fetch('/api/admin/snapshot', { cache: 'no-store' })).json();
    this._cache = {};
    this.COLLECTIONS.forEach(c => { this._cache[c] = Array.isArray(snap[c]) ? snap[c] : []; });
    this._meta = (snap && snap._meta) || {};

    console.log('✅ Migration complete — localStorage kept as backup');
    if (typeof Utils !== 'undefined' && Utils.toast) {
      Utils.toast('success', 'Migrated to Server', 'Your existing data has moved to the shared database.');
    }
  },

  // ── Boot batch — coalesce seed/migrate writes into bulk PUTs ──
  beginBootBatch() {
    this._bootBatch = true;
    this._bootDirty.collections.clear();
    this._bootDirty.meta.clear();
  },

  async commitBootBatch() {
    this._bootBatch = false;
    const colls = [...this._bootDirty.collections];
    const metas = [...this._bootDirty.meta];
    this._bootDirty.collections.clear();
    this._bootDirty.meta.clear();
    const tasks = [];
    for (const c of colls) {
      tasks.push(this._fetchSafe('PUT', `/api/${c}`, this._cache[c] || []));
    }
    for (const k of metas) {
      tasks.push(this._fetchSafe('PUT', `/api/meta/${k}`, this._meta[k]));
    }
    await Promise.all(tasks);
  },

  // ── Internal: fire-and-forget fetch with shared error handling ──
  _fetchSafe(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts)
      .then(r => {
        if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`);
        return r;
      })
      .catch(e => this._handleNetworkError(e));
  },

  _handleNetworkError(e) {
    console.error('Store sync failed:', e);
    if (this._networkErrorShown) return;
    this._networkErrorShown = true;
    if (typeof Utils !== 'undefined' && Utils.toast) {
      Utils.toast('warning', 'Sync Error', 'Could not save to server. Check the connection.');
    }
    setTimeout(() => { this._networkErrorShown = false; }, 5000);
  },

  // ── Internal: route key to either collection cache or meta ──
  _isCollection(key) { return this.COLLECTIONS.includes(key); },

  _get(key) {
    if (this._isCollection(key)) return this._cache[key] || null;
    return Object.prototype.hasOwnProperty.call(this._meta, key) ? this._meta[key] : null;
  },

  _set(key, value) {
    if (this._isCollection(key)) {
      this._cache[key] = value;
      if (this._bootBatch) {
        this._bootDirty.collections.add(key);
      } else {
        this._fetchSafe('PUT', `/api/${key}`, value);
      }
    } else {
      this._meta[key] = value;
      if (this._bootBatch) {
        this._bootDirty.meta.add(key);
      } else {
        this._fetchSafe('PUT', `/api/meta/${key}`, value);
      }
    }
  },

  // ── Routine pruning — operates on cache, flushes via _set ──
  pruneRoutine() {
    const audit = this._get('audit_log') || [];
    if (audit.length > 2000) {
      this._set('audit_log', audit.slice(-2000));
    }

    const now = Date.now();
    const cutoff = now - 90 * 86400000;
    const notifs = this._get('notifications') || [];
    const kept = notifs.filter(n => {
      if (!n.read) return true;
      const ts = new Date(n.timestamp).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
    if (kept.length !== notifs.length) this._set('notifications', kept);
  },

  getAll(collection) {
    return this._cache[collection] || [];
  },

  getById(collection, id) {
    const items = this.getAll(collection);
    return items.find(item => item.id === id) || null;
  },

  add(collection, item) {
    if (!item.id) item.id = Utils.generateId();
    if (!item.createdAt) item.createdAt = Utils.nowISO();
    item.updatedAt = Utils.nowISO();
    if (!this._cache[collection]) this._cache[collection] = [];
    this._cache[collection].push(item);
    if (this._bootBatch) {
      this._bootDirty.collections.add(collection);
    } else {
      this._fetchSafe('POST', `/api/${collection}`, item);
    }
    this._notify(collection, 'add', item);
    return item;
  },

  // ── SCR Field Schema (all 10 sections) ─────────────────
  scrFieldDefaults() {
    return {
      // Section 1 – Header (auto-generated)
      scrNumber: '',
      scrDate: Utils.today(),

      // Section 2 – Project Details
      requestType: '',        // New / Modification / Report / Other
      intervention: '',       // Emergency / Urgent / Routine  (renamed from priority)

      // Section 3 – Request Description
      moduleName: '',
      description: '',        // combined before/after description
      descriptionBefore: '',  // before scenario
      descriptionAfter: '',   // after scenario

      // Section 4 – Reason for Change
      reasonForChange: '',
      problemSolved: '',
      expectedImpact: '',

      // Section 5 – Attachments (array of {name, url})
      attachments: [],

      // Section 6 – End User Details
      requestedBy: '',
      receivedBy: '',
      coordinatedBy: '',
      department: '',
      hodName: '',

      // Section 7 – Study Details
      studyDoneByPrimary: '',
      studyDoneBySecondary: '',
      assignedDeveloper: '',   // Developer 1
      assignedDeveloper2: '',  // Developer 2
      assignedOn: null,
      studyDateFrom: null,
      studyDateTo: null,
      scheduleDate: null,
      completedOn: null,
      acknowledgedBy: '',
      acknowledgedAt: null,
      // Project Head accept-for-review (gates Stage 3 advance)
      phAcceptedBy: '',
      phAcceptedAt: null,

      // Section 8 – Approval
      approvalStatus: '',     // Approved / Not Approved / Hold
      approvalReason: '',
      projectHeadName: '',
      agmItName: '',
      cioName: '',

      // Section 9 – Remarks
      remarkProjectHead: '',
      remarkAgmIt: '',
      remarkCio: '',

      // System fields
      assignedTeam: '',
      currentStage: 1,
      status: 'Open',
      createdBy: '',
      priority: '',  // kept for backward compat, mirrors intervention

      // Rejection tracking (populated by workflow/approval when rejected)
      lastRejection: null,  // { fromStage, fromStageName, toStage, toStageName, remarks, by, byId, byRole, at }
      rejectionRemarks: '',
      rejectedBy: '',
      rejectedAt: null,

      // Hold tracking (populated by Workflow.holdStage / cleared on resume)
      holdReason: '',
      heldBy: '',
      heldAt: null,
      holdAtStage: null,
      lastHold: null  // { stage, stageName, reason, by, byId, byRole, at } — preserved across resume
    };
  },

  update(collection, id, updates) {
    const items = this.getAll(collection);
    const idx = items.findIndex(item => item.id === id);
    if (idx === -1) return null;
    const oldItem = { ...items[idx] };
    const merged = { ...items[idx], ...updates, updatedAt: Utils.nowISO() };
    items[idx] = merged;
    if (this._bootBatch) {
      this._bootDirty.collections.add(collection);
    } else {
      this._fetchSafe('PATCH', `/api/${collection}/${id}`, { ...updates, updatedAt: merged.updatedAt });
    }
    this._notify(collection, 'update', merged, oldItem);
    return merged;
  },

  remove(collection, id) {
    const items = this.getAll(collection);
    const item = items.find(i => i.id === id);
    if (!item) return null;
    this._cache[collection] = items.filter(i => i.id !== id);
    if (this._bootBatch) {
      this._bootDirty.collections.add(collection);
    } else {
      this._fetchSafe('DELETE', `/api/${collection}/${id}`);
    }
    this._notify(collection, 'remove', item);
    // Cascade: when an SCR is deleted, purge dependent records from cache.
    // Server cascades automatically on DELETE /api/scr_requests/:id.
    if (collection === 'scr_requests') this._cascadeDeleteSCR(id);
    return item;
  },

  // ── Cascade cleanup: remove all dependent records for a deleted SCR ──
  // Cache-only: the server cascades automatically when DELETE /api/scr_requests/:id
  // fires (see CASCADE_ON_SCR_DELETE in server/routes.js). We just keep the
  // local cache in sync so re-renders don't show orphan rows.
  _cascadeDeleteSCR(scrId) {
    ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates'].forEach(coll => {
      this._cache[coll] = (this._cache[coll] || []).filter(r => r.scrId !== scrId);
    });
    // Audit log preserved for NABH compliance.
  },

  // ── Query helpers ───────────────────────────────────────
  filter(collection, predicate) {
    return this.getAll(collection).filter(predicate);
  },

  count(collection, predicate) {
    if (!predicate) return this.getAll(collection).length;
    return this.filter(collection, predicate).length;
  },

  // ── Observer pattern ────────────────────────────────────
  _listeners: {},

  subscribe(collection, callback) {
    if (!this._listeners[collection]) this._listeners[collection] = [];
    this._listeners[collection].push(callback);
    return () => {
      this._listeners[collection] = this._listeners[collection].filter(cb => cb !== callback);
    };
  },

  _notify(collection, action, item, oldItem) {
    const listeners = this._listeners[collection] || [];
    listeners.forEach(cb => cb(action, item, oldItem));
  },

  // ── Session management ──────────────────────────────────
  // Sessions are per-device, NEVER pushed to the shared server. Each
  // browser/device has its own logged-in user. Stored in localStorage so
  // cross-tab logout still works via the 'storage' event in app.js.
  getSession() {
    try {
      const raw = localStorage.getItem('scr_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  setSession(user) {
    try { localStorage.setItem('scr_session', JSON.stringify(user)); }
    catch (e) { console.error('Session save failed:', e); }
  },

  clearSession() {
    try { localStorage.removeItem('scr_session'); } catch {}
  },

  // ── Check if seeded ─────────────────────────────────────
  isSeeded() {
    return this._get('seeded') === true;
  },

  // ── Seeds ───────────────────────────────────────────────
  seed() {
    if (this.isSeeded()) return;

    // Users — GKNM Information Technology department staff
    const ITDept = 'Information Technology';
    const users = [
      { id: 'user_admin',  name: 'System Admin',         username: 'admin',        password: 'admin123', role: 'admin',          email: 'admin@hospital.in',         department: ITDept },
      { id: 'user_cio',    name: 'Mr. Biju Velayudhan',  username: 'cio',          password: 'cio123',   role: 'cio',            email: 'biju@hospital.in',          department: ITDept },
      { id: 'user_agm',    name: 'Mr. S. Saravanakumar', username: 'agm',          password: 'agm123',   role: 'agm_it',         email: 'saravanakumar@hospital.in', department: ITDept },
      // Project Heads
      { id: 'user_ph',     name: 'Mr. Panneer Selvan',   username: 'projecthead',  password: 'ph123',    role: 'project_head',   email: 'panneer@hospital.in',       department: ITDept },
      { id: 'user_ph2',    name: 'Mr. T.V Raam Kumar',   username: 'projecthead2', password: 'ph123',    role: 'project_head',   email: 'raamkumar@hospital.in',     department: ITDept },
      // Implementation Team
      { id: 'user_impl',   name: 'Mrs. Saranya P',       username: 'impl',         password: 'impl123',  role: 'implementation', email: 'saranya.p@hospital.in',     department: ITDept },
      { id: 'user_impl2',  name: 'Mr. Gokulraj S',       username: 'impl2',        password: 'impl123',  role: 'implementation', email: 'gokulraj@hospital.in',      department: ITDept },
      { id: 'user_impl3',  name: 'Mr. Nantha Kumar S',   username: 'impl3',        password: 'impl123',  role: 'implementation', email: 'nantha@hospital.in',        department: ITDept },
      // Development Team
      { id: 'user_dev1',   name: 'Mrs. Saranya R',       username: 'developer',    password: 'dev123',   role: 'developer',      email: 'saranya.r@hospital.in',     department: ITDept },
      { id: 'user_dev2',   name: 'Mr. Yoganandham S',    username: 'developer2',   password: 'dev123',   role: 'developer',      email: 'yoga@hospital.in',          department: ITDept },
      { id: 'user_dev3',   name: 'Mr. Chakravarthy',     username: 'developer3',   password: 'dev123',   role: 'developer',      email: 'chakra@hospital.in',        department: ITDept },
      // Requesters (departmental)
      { id: 'user_req1',   name: 'Dr. Ramesh Kumar',     username: 'requester',    password: 'req123',   role: 'requester',      email: 'ramesh@hospital.in',        department: 'Cardiology' },
      { id: 'user_req2',   name: 'Dr. Priya Sharma',     username: 'requester2',   password: 'req123',   role: 'requester',      email: 'priya@hospital.in',         department: 'Radiology' },
      { id: 'user_req3',   name: 'Mr. Ganesh Babu',      username: 'requester3',   password: 'req123',   role: 'requester',      email: 'ganesh@hospital.in',        department: 'Pharmacy' }
    ];
    this._set('users', users);

    // Departments
    this._set('departments', Utils.defaultDepartments);

    // SLA Config
    this._set('sla_config', [
      { priority: 'Emergency', maxHours: 24 },
      { priority: 'Urgent', maxHours: 72 },
      { priority: 'Routine', maxHours: 168 }
    ]);

    // Role Permissions (editable via User Rights module — mirrors Auth.permissions defaults)
    this._set('role_permissions', {
      admin:          { pages: ['dashboard','scr-list','scr-detail','scr-create','approvals','feedback','audit','reports','master-data','notifications','settings'], actions: ['create_scr','edit_scr','delete_scr','assign_scr','advance_stage','approve','reject','hold','close_ticket','manage_users','manage_departments','view_audit','view_reports','reset_data'] },
      cio:            { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','hold','view_audit'] },
      agm_it:         { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','hold','view_audit'] },
      project_head:   { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','hold','view_audit'] },
      implementation: { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','hold','close_ticket','view_audit'] },
      developer:      { pages: ['dashboard','scr-list','scr-detail','feedback','notifications'], actions: ['edit_scr','advance_stage'] },
      requester:      { pages: ['self-service','scr-detail','scr-create','feedback','notifications'], actions: ['create_scr','submit_feedback'] }
    });

    // Sample SCR Requests (with full 10-section fields)
    const now = new Date();
    const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

    const sampleSCRs = [
      {
        id: 'scr_1', scrNumber: `SCR-${now.getFullYear()}-0001`, scrDate: daysAgo(10).split('T')[0],
        requestType: 'New', intervention: 'Emergency', priority: 'Emergency',
        moduleName: 'ICU Monitoring Module',
        description: 'Need real-time cardiac monitoring dashboard integration with existing HIS system for ICU ward. Must display live ECG waveforms and vital parameters.',
        descriptionBefore: 'Manual monitoring with periodic nurse check-ins every 30 minutes.',
        descriptionAfter: 'Real-time dashboard shows live ECG and vitals with auto-alert on threshold breach.',
        reasonForChange: 'Patient safety improvement in ICU ward',
        problemSolved: 'Delayed detection of critical cardiac events due to manual monitoring',
        expectedImpact: 'Reduce cardiac event response time from 15 min to under 2 min',
        requestedBy: 'Dr. Ramesh Kumar', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Cardiology', hodName: 'Dr. Ramesh Kumar',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: 'Mr. Nantha Kumar S',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: 'user_dev2',
        assignedOn: daysAgo(9).split('T')[0], studyDateFrom: daysAgo(9).split('T')[0], studyDateTo: daysAgo(8).split('T')[0],
        scheduleDate: daysAgo(6).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 5, status: 'In Progress',
        createdBy: 'user_req1', createdAt: daysAgo(10), updatedAt: daysAgo(1)
      },
      {
        id: 'scr_2', scrNumber: `SCR-${now.getFullYear()}-0002`, scrDate: daysAgo(14).split('T')[0],
        requestType: 'Modification', intervention: 'Urgent', priority: 'Urgent',
        moduleName: 'PACS Radiology Viewer',
        description: 'Modify PACS viewer to support 3D reconstruction view and add measurement tools for radiology reports.',
        descriptionBefore: 'Viewer supports 2D images only with no measurement tools.',
        descriptionAfter: '3D reconstruction enabled with measurement, annotation and reporting tools.',
        reasonForChange: 'Radiologist workflow efficiency and diagnostic accuracy',
        problemSolved: 'Radiologists manually calculate measurements using paper and scale',
        expectedImpact: 'Reduce report generation time by 40%',
        requestedBy: 'Dr. Priya Sharma', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Radiology', hodName: 'Dr. Priya Sharma',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: '',
        assignedOn: daysAgo(12).split('T')[0], studyDateFrom: daysAgo(13).split('T')[0], studyDateTo: daysAgo(12).split('T')[0],
        scheduleDate: daysAgo(10).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 4, status: 'In Progress',
        createdBy: 'user_req2', createdAt: daysAgo(14), updatedAt: daysAgo(2)
      },
      {
        id: 'scr_3', scrNumber: `SCR-${now.getFullYear()}-0003`, scrDate: daysAgo(22).split('T')[0],
        requestType: 'Report', intervention: 'Routine', priority: 'Routine',
        moduleName: 'Pharmacy Inventory',
        description: 'Create pharmacy inventory expiry alert report with auto-email notification to pharmacy HOD when medicines are within 90 days of expiry.',
        descriptionBefore: 'Manual stock verification done monthly by pharmacist.',
        descriptionAfter: 'Automated report generated weekly with email alerts 90 days before expiry.',
        reasonForChange: 'Reduce medicine wastage and prevent expired stock dispensing',
        problemSolved: 'Expired medicines discovered during dispensing causing patient risk',
        expectedImpact: 'Zero expired medicine incidents, 30% reduction in wastage cost',
        requestedBy: 'Mr. Ganesh Babu', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Pharmacy', hodName: 'Mr. Ganesh Babu',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: 'Mr. Nantha Kumar S',
        assignedDeveloper: 'user_dev3', assignedDeveloper2: '',
        assignedOn: daysAgo(20).split('T')[0], studyDateFrom: daysAgo(21).split('T')[0], studyDateTo: daysAgo(20).split('T')[0],
        scheduleDate: daysAgo(18).split('T')[0], completedOn: daysAgo(6).split('T')[0],
        approvalStatus: 'Approved', approvalReason: 'Report format meets requirements. Approved for deployment.',
        projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: 'Good implementation. Approved for deployment.',
        remarkAgmIt: 'Verified and approved by AGM-IT.',
        remarkCio: 'Final approval granted. Well done team.',
        assignedTeam: 'Development', attachments: [],
        currentStage: 6, status: 'Closed',
        createdBy: 'user_req3', createdAt: daysAgo(22), updatedAt: daysAgo(5)
      },
      {
        id: 'scr_4', scrNumber: `SCR-${now.getFullYear()}-0004`, scrDate: daysAgo(7).split('T')[0],
        requestType: 'New', intervention: 'Urgent', priority: 'Urgent',
        moduleName: 'Triage Management',
        description: 'Develop triage management module for ER department with color-coded priority assignment and average wait time display.',
        descriptionBefore: 'Paper-based triage with no digital tracking of wait times.',
        descriptionAfter: 'Digital triage board with ESI levels, real-time queue and wait time analytics.',
        reasonForChange: 'ER efficiency and patient safety compliance',
        problemSolved: 'High-risk patients waiting too long due to no priority visibility',
        expectedImpact: 'Reduce critical patient wait time by 60%',
        requestedBy: 'Dr. Vikram Singh', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Emergency Medicine', hodName: 'Dr. Vikram Singh',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: '',
        assignedOn: daysAgo(5).split('T')[0], studyDateFrom: daysAgo(6).split('T')[0], studyDateTo: daysAgo(5).split('T')[0],
        scheduleDate: daysAgo(3).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Implementation', attachments: [],
        currentStage: 3, status: 'In Progress',
        createdBy: 'user_req1', createdAt: daysAgo(7), updatedAt: daysAgo(1)
      },
      {
        id: 'scr_5', scrNumber: `SCR-${now.getFullYear()}-0005`, scrDate: daysAgo(32).split('T')[0],
        requestType: 'Modification', intervention: 'Routine', priority: 'Routine',
        moduleName: 'Finance & Billing System',
        description: 'Add GST calculation module to billing system and integrate with existing insurance claim processing workflow.',
        descriptionBefore: 'Manual GST calculation by billing staff using spreadsheets.',
        descriptionAfter: 'Auto GST computation on billing screen with insurance claim integration.',
        reasonForChange: 'GST compliance and billing accuracy',
        problemSolved: 'Manual GST errors causing claim rejections and audit issues',
        expectedImpact: 'Zero GST calculation errors, 50% faster claim processing',
        requestedBy: 'Mr. Karthik R', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Finance & Billing', hodName: 'Mr. Karthik R',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: 'Mr. Nantha Kumar S',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: 'user_dev3',
        assignedOn: daysAgo(30).split('T')[0], studyDateFrom: daysAgo(31).split('T')[0], studyDateTo: daysAgo(30).split('T')[0],
        scheduleDate: daysAgo(28).split('T')[0], completedOn: daysAgo(12).split('T')[0],
        approvalStatus: 'Approved', approvalReason: 'All billing requirements met.',
        projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: 'Good implementation. Approved for deployment.',
        remarkAgmIt: 'Verified and approved.',
        remarkCio: 'Final approval granted.',
        assignedTeam: 'Development', attachments: [],
        currentStage: 6, status: 'Closed',
        createdBy: 'user_req1', createdAt: daysAgo(32), updatedAt: daysAgo(8)
      },
      {
        id: 'scr_6', scrNumber: `SCR-${now.getFullYear()}-0006`, scrDate: daysAgo(4).split('T')[0],
        requestType: 'New', intervention: 'Emergency', priority: 'Emergency',
        moduleName: 'LIS Integration',
        description: 'Integrate LIS (Lab Information System) with barcode scanner for auto-sample tracking and result upload.',
        descriptionBefore: 'Manual sample labeling and result entry from lab analyzer.',
        descriptionAfter: 'Barcode scan links sample to patient, results auto-upload to LIS.',
        reasonForChange: 'Patient safety – eliminate sample mix-up risk',
        problemSolved: 'Sample labeling errors causing wrong results and repeat tests',
        expectedImpact: 'Zero sample mix-up incidents, 25% faster TAT',
        requestedBy: 'Dr. Saranya M', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Laboratory', hodName: 'Dr. Saranya M',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev3', assignedDeveloper2: '',
        assignedOn: daysAgo(3).split('T')[0], studyDateFrom: daysAgo(4).split('T')[0], studyDateTo: daysAgo(3).split('T')[0],
        scheduleDate: daysAgo(2).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 5, status: 'In Progress',
        createdBy: 'user_req2', createdAt: daysAgo(4), updatedAt: daysAgo(0)
      },
      {
        id: 'scr_7', scrNumber: `SCR-${now.getFullYear()}-0007`, scrDate: daysAgo(2).split('T')[0],
        requestType: 'Report', intervention: 'Routine', priority: 'Routine',
        moduleName: 'Nursing Handover',
        description: 'Design nursing shift handover report template with patient summary, pending medications, and critical notes section.',
        descriptionBefore: 'Verbal handover with no structured documentation.',
        descriptionAfter: 'Digital handover report with structured sections for each patient.',
        reasonForChange: 'Nursing care continuity and patient safety',
        problemSolved: 'Critical patient info lost during shift change',
        expectedImpact: 'Structured handover reduces medication errors by 35%',
        requestedBy: 'Ms. Anjali Thomas', receivedBy: 'Mrs. Saranya P', coordinatedBy: '',
        department: 'Nursing', hodName: 'Ms. Anjali Thomas',
        studyDoneByPrimary: '', studyDoneBySecondary: '',
        assignedDeveloper: '', assignedDeveloper2: '', assignedOn: null,
        studyDateFrom: null, studyDateTo: null, scheduleDate: null, completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 1, status: 'Open',
        createdBy: 'user_req3', createdAt: daysAgo(2), updatedAt: daysAgo(2)
      },
      {
        id: 'scr_8', scrNumber: `SCR-${now.getFullYear()}-0008`, scrDate: daysAgo(3).split('T')[0],
        requestType: 'Modification', intervention: 'Urgent', priority: 'Urgent',
        moduleName: 'Pediatrics EMR – Growth Chart',
        description: 'Update growth chart module in pediatrics EMR to include WHO 2025 standards and auto-calculate percentiles.',
        descriptionBefore: 'WHO 2006 chart manually plotted by pediatrician on paper.',
        descriptionAfter: 'WHO 2025 digital chart auto-plotted with percentile calculation.',
        reasonForChange: 'Clinical accuracy and NABH compliance',
        problemSolved: 'Outdated growth standards causing misdiagnosis in pediatric cases',
        expectedImpact: 'Improved diagnostic accuracy for 100% of pediatric consults',
        requestedBy: 'Dr. Anil Gupta', receivedBy: 'Mrs. Saranya P', coordinatedBy: '',
        department: 'Pediatrics', hodName: 'Dr. Anil Gupta',
        studyDoneByPrimary: '', studyDoneBySecondary: '',
        assignedDeveloper: '', assignedDeveloper2: '', assignedOn: null,
        studyDateFrom: null, studyDateTo: null, scheduleDate: null, completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 2, status: 'Open',
        createdBy: 'user_req1', createdAt: daysAgo(3), updatedAt: daysAgo(3)
      },
      {
        id: 'scr_9', scrNumber: `SCR-${now.getFullYear()}-0009`, scrDate: daysAgo(18).split('T')[0],
        requestType: 'Other', intervention: 'Routine', priority: 'Routine',
        moduleName: 'OPD Token System',
        description: 'Set up automated OPD token system with display screen integration and SMS notification to patients.',
        descriptionBefore: 'Manual token distribution at counter with no patient notification.',
        descriptionAfter: 'Auto token via kiosk, display board, and SMS when turn is approaching.',
        reasonForChange: 'Patient experience and queue management',
        problemSolved: 'Long waiting time complaints and crowding at OPD reception',
        expectedImpact: 'Reduce patient wait complaints by 70%, improve patient satisfaction score',
        requestedBy: 'Mr. Senthil Raja', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'Administration', hodName: 'Mr. Senthil Raja',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: 'Mr. Nantha Kumar S',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: '',
        assignedOn: daysAgo(15).split('T')[0], studyDateFrom: daysAgo(16).split('T')[0], studyDateTo: daysAgo(15).split('T')[0],
        scheduleDate: daysAgo(12).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Implementation', attachments: [],
        currentStage: 6, status: 'In Progress',
        createdBy: 'user_req2', createdAt: daysAgo(18), updatedAt: daysAgo(1)
      },
      {
        id: 'scr_10', scrNumber: `SCR-${now.getFullYear()}-0010`, scrDate: daysAgo(2).split('T')[0],
        requestType: 'New', intervention: 'Emergency', priority: 'Emergency',
        moduleName: 'OT Scheduling Module',
        description: 'Develop OT scheduling module with surgeon availability calendar, equipment booking, and conflict detection.',
        descriptionBefore: 'OT slots booked via phone calls with no conflict check.',
        descriptionAfter: 'Digital OT calendar with surgeon availability, equipment booking and auto-conflict detection.',
        reasonForChange: 'OT utilization and surgical efficiency',
        problemSolved: 'OT scheduling conflicts causing surgery delays and cancellations',
        expectedImpact: 'Increase OT utilization from 60% to 90%, zero double-booking',
        requestedBy: 'Dr. Meena Patel', receivedBy: 'Mrs. Saranya P', coordinatedBy: 'Mr. Gokulraj S',
        department: 'General Surgery', hodName: 'Dr. Meena Patel',
        studyDoneByPrimary: 'Mrs. Saranya P', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: '',
        assignedOn: daysAgo(1).split('T')[0], studyDateFrom: daysAgo(2).split('T')[0], studyDateTo: daysAgo(1).split('T')[0],
        scheduleDate: Utils.today(), completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Mr. Panneer Selvan', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
        remarkProjectHead: '', remarkAgmIt: '', remarkCio: '',
        assignedTeam: 'Development', attachments: [],
        currentStage: 2, status: 'In Progress',
        createdBy: 'user_req3', createdAt: daysAgo(2), updatedAt: daysAgo(0)
      }
    ];
    this._set('scr_requests', sampleSCRs);

    // Workflow stages for sample SCRs
    const workflowData = [];
    const stageActors = { 1: 'user_impl', 2: 'user_impl', 3: 'user_ph', 4: 'user_agm', 5: 'user_dev1', 6: 'user_impl' };
    sampleSCRs.forEach(scr => {
      for (let s = 1; s <= Math.min(scr.currentStage, 6); s++) {
        workflowData.push({
          id: Utils.generateId(),
          scrId: scr.id,
          stage: s,
          enteredAt: daysAgo(22 - s * 2),
          exitedAt: s < scr.currentStage ? daysAgo(22 - (s + 1) * 2) : null,
          performedBy: stageActors[s] || 'user_impl',
          action: s < scr.currentStage ? 'Completed' : (scr.status === 'Closed' ? 'Closed' : 'In Progress'),
          notes: `Stage ${s} processed`
        });
      }
    });
    this._set('workflow_stages', workflowData);

    // Sample approvals — Stage 4 (Management Approval: AGM + CIO both required)
    const approvals = [
      {
        id: 'appr_1', scrId: 'scr_5', approverRole: 'agm_it', approverName: 'Mr. S. Saravanakumar',
        decision: 'Approved', comments: 'Verified and approved.', timestamp: daysAgo(9)
      },
      {
        id: 'appr_2', scrId: 'scr_5', approverRole: 'cio', approverName: 'Mr. Biju Velayudhan',
        decision: 'Approved', comments: 'Final approval granted. Well done team.', timestamp: daysAgo(8)
      },
      {
        id: 'appr_3', scrId: 'scr_3', approverRole: 'agm_it', approverName: 'Mr. S. Saravanakumar',
        decision: 'Approved', comments: 'Report requirements met. Approved.', timestamp: daysAgo(5)
      },
      {
        id: 'appr_4', scrId: 'scr_3', approverRole: 'cio', approverName: 'Mr. Biju Velayudhan',
        decision: 'Approved', comments: 'Approved. Good work.', timestamp: daysAgo(5)
      }
    ];
    this._set('approvals', approvals);

    // Sample feedback
    const feedback = [
      {
        id: 'fb_1', scrId: 'scr_5', q1: 5, q2: 4, q3: 5, q4: 4, q5: 5,
        avgScore: 4.6, comments: 'Excellent work! The GST module works perfectly.',
        submittedBy: 'user_req1', timestamp: daysAgo(7)
      }
    ];
    this._set('feedback', feedback);

    // Sample audit log
    const auditLog = [
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_1', action: 'Created', field: null, oldValue: null, newValue: null, performedBy: 'Dr. Ramesh Kumar', role: 'requester', timestamp: daysAgo(10) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_1', action: 'Stage Advanced', field: 'currentStage', oldValue: 'Requirement Submission', newValue: 'Implementation Review', performedBy: 'Mrs. Saranya P', role: 'implementation', timestamp: daysAgo(9) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_2', action: 'Created', field: null, oldValue: null, newValue: null, performedBy: 'Dr. Priya Sharma', role: 'requester', timestamp: daysAgo(14) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_5', action: 'Approved', field: 'decision', oldValue: null, newValue: 'Approved', performedBy: 'Mr. Biju Velayudhan', role: 'cio', timestamp: daysAgo(8) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_5', action: 'Status Changed', field: 'status', oldValue: 'Completed', newValue: 'Closed', performedBy: 'System', role: 'admin', timestamp: daysAgo(8) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_7', action: 'Created', field: null, oldValue: null, newValue: null, performedBy: 'Mr. Ganesh Babu', role: 'requester', timestamp: daysAgo(2) },
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_10', action: 'Created', field: null, oldValue: null, newValue: null, performedBy: 'Mr. Ganesh Babu', role: 'requester', timestamp: daysAgo(2) },
      { id: Utils.generateId(), entityType: 'User', entityId: 'user_admin', action: 'Login', field: null, oldValue: null, newValue: null, performedBy: 'System Admin', role: 'admin', timestamp: daysAgo(0) }
    ];
    this._set('audit_log', auditLog);

    // Notifications
    const notifications = [
      { id: 'notif_1', userId: 'user_dev1', message: 'You have been assigned SCR-2026-0001 (Emergency) — ready for development', type: 'assignment', read: false, timestamp: daysAgo(1), scrId: 'scr_1' },
      { id: 'notif_2', userId: 'user_impl', message: 'SCR-2026-0009 development complete — awaiting QA review', type: 'status', read: false, timestamp: daysAgo(1), scrId: 'scr_9' },
      { id: 'notif_3', userId: 'user_cio', message: 'SCR-2026-0002 requires your management approval', type: 'approval', read: false, timestamp: daysAgo(2), scrId: 'scr_2' },
      { id: 'notif_4', userId: 'user_agm', message: 'SCR-2026-0002 requires your management approval', type: 'approval', read: false, timestamp: daysAgo(2), scrId: 'scr_2' },
      { id: 'notif_5', userId: 'user_admin', message: 'SLA breach: SCR-2026-0002 is overdue', type: 'sla', read: false, timestamp: daysAgo(0), scrId: 'scr_2' },
      { id: 'notif_6', userId: 'user_impl', message: 'New SCR submitted: SCR-2026-0008 from Pediatrics — awaiting your review', type: 'new_scr', read: true, timestamp: daysAgo(3), scrId: 'scr_8' }
    ];
    this._set('notifications', notifications);

    this._set('seeded', true);
    console.log('✅ SCR Store seeded with demo data');
  },

  // ── Migrate legacy data to current schema ────────
  // Runs on every app init. Idempotent — safe to re-run.
  migrate() {
    const MIGRATION_VERSION = 11;
    const current = this._get('migration_version') || 0;
    if (current >= MIGRATION_VERSION) return;

    const nameMap = {
      'Mr. Prasad Kumar': 'Mr. S. Saravanakumar',
      'Dr. Venkatesh R':  'Mr. Biju Velayudhan'
    };

    // v1 → v2: rebrand AGM-IT and CIO users to real-world names
    if (current < 2) {
      const users = this._get('users') || [];
      users.forEach(u => {
        if (u.id === 'user_agm') { u.name = 'Mr. S. Saravanakumar'; u.email = 'saravanakumar@hospital.in'; }
        if (u.id === 'user_cio') { u.name = 'Mr. Biju Velayudhan';  u.email = 'biju@hospital.in'; }
      });
      this._set('users', users);

      const approvals = this._get('approvals') || [];
      approvals.forEach(a => {
        if (nameMap[a.approverName]) a.approverName = nameMap[a.approverName];
      });
      this._set('approvals', approvals);

      const audit = this._get('audit_log') || [];
      audit.forEach(e => {
        if (nameMap[e.performedBy]) e.performedBy = nameMap[e.performedBy];
      });
      this._set('audit_log', audit);
    }

    // v2 → v3: add lastRejection field on SCRs; backfill from legacy fields
    // Also rename stored approver names + ensure default Project Head
    const scrs = this._get('scr_requests') || [];
    scrs.forEach(s => {
      if (!s.projectHeadName) s.projectHeadName = 'Mr. Panneer Selvan';
      s.agmItName = nameMap[s.agmItName] || s.agmItName || 'Mr. S. Saravanakumar';
      s.cioName   = nameMap[s.cioName]   || s.cioName   || 'Mr. Biju Velayudhan';

      // Backfill lastRejection on old rejected SCRs
      if (!s.lastRejection && s.status === 'Rejected' && s.rejectionRemarks) {
        s.lastRejection = {
          fromStage: s.currentStage || 2,
          fromStageName: (typeof Utils !== 'undefined' && Utils.getStageName) ? Utils.getStageName(s.currentStage || 2) : `Stage ${s.currentStage || 2}`,
          toStage: null,
          toStageName: 'Terminal',
          remarks: s.rejectionRemarks,
          by: s.rejectedBy || 'Unknown',
          byId: '',
          byRole: '',
          at: s.rejectedAt || s.updatedAt || s.createdAt
        };
      }
    });
    this._set('scr_requests', scrs);

    // v3 → v4: grant admin access to Reports page + view_reports action
    // Existing installs seeded before Reports existed won't have it, so the
    // nav item stays hidden. Patch in place here.
    if (current < 4) {
      const perms = this._get('role_permissions');
      if (perms && perms.admin) {
        if (Array.isArray(perms.admin.pages) && !perms.admin.pages.includes('reports')) {
          perms.admin.pages.push('reports');
        }
        if (Array.isArray(perms.admin.actions) && !perms.admin.actions.includes('view_reports')) {
          perms.admin.actions.push('view_reports');
        }
        this._set('role_permissions', perms);
      }
    }

    // v4 → v5: grant requester access to scr-create page so their
    // "New Request" card can open the full SCR Request form in a new tab
    if (current < 5) {
      const perms = this._get('role_permissions');
      if (perms && perms.requester) {
        if (Array.isArray(perms.requester.pages) && !perms.requester.pages.includes('scr-create')) {
          perms.requester.pages.push('scr-create');
        }
        this._set('role_permissions', perms);
      }
    }

    // v5 → v6: backfill coordinatorName / coordinatorEmail on existing
    // departments. Match against Utils.defaultDepartments by name; for
    // any custom-added department, leave coordinator blank (admin can
    // fill via Master Data → Departments → Edit).
    if (current < 6) {
      const depts = this._get('departments') || [];
      const defaultsByName = {};
      (typeof Utils !== 'undefined' && Utils.defaultDepartments ? Utils.defaultDepartments : [])
        .forEach(d => { defaultsByName[d.name] = d; });

      let touched = false;
      depts.forEach(d => {
        if (d.coordinatorName === undefined) {
          const def = defaultsByName[d.name];
          d.coordinatorName  = def ? (def.coordinatorName  || '') : '';
          d.coordinatorEmail = def ? (def.coordinatorEmail || '') : '';
          touched = true;
        }
      });
      if (touched) this._set('departments', depts);
    }

    // v6 → v7 (and onwards): wrong "Project Head / AGM-IT / CIO" names
    // on existing SCRs. We invoke the standalone resync helper below;
    // it's also wired to run unconditionally on every init so any stale
    // names get corrected even if the install was already at v7.
    // (Kept here for the version-bump record — the actual logic lives
    // in resyncReviewerNames so it can also run outside migrate().)

    // v7 → v8: replace placeholder/demo staff names with real GKNM
    // Information Technology department staff. Existing user IDs are
    // RENAMED in place (preserves SCR references like assignedDeveloper)
    // rather than deleted. Two new accounts are added: impl3 + ph2.
    if (current < 8) {
      const users = this._get('users') || [];
      const byId = {};
      users.forEach(u => { byId[u.id] = u; });

      const ITDept = 'Information Technology';
      const renameOrAdd = [
        // Implementation Team
        { id: 'user_impl',  name: 'Mrs. Saranya P',     username: 'impl',         password: 'impl123', role: 'implementation', email: 'saranya.p@hospital.in',  department: ITDept },
        { id: 'user_impl2', name: 'Mr. Gokulraj S',     username: 'impl2',        password: 'impl123', role: 'implementation', email: 'gokulraj@hospital.in',   department: ITDept },
        { id: 'user_impl3', name: 'Mr. Nantha Kumar S', username: 'impl3',        password: 'impl123', role: 'implementation', email: 'nantha@hospital.in',     department: ITDept },
        // Development Team
        { id: 'user_dev1',  name: 'Mrs. Saranya R',     username: 'developer',    password: 'dev123',  role: 'developer',      email: 'saranya.r@hospital.in',  department: ITDept },
        { id: 'user_dev2',  name: 'Mr. Yoganandham S',  username: 'developer2',   password: 'dev123',  role: 'developer',      email: 'yoga@hospital.in',       department: ITDept },
        { id: 'user_dev3',  name: 'Mr. Chakravarthy',   username: 'developer3',   password: 'dev123',  role: 'developer',      email: 'chakra@hospital.in',     department: ITDept },
        // Project Heads
        { id: 'user_ph',    name: 'Mr. Panneer Selvan', username: 'projecthead',  password: 'ph123',   role: 'project_head',   email: 'panneer@hospital.in',    department: ITDept },
        { id: 'user_ph2',   name: 'Mr. T.V Raam Kumar', username: 'projecthead2', password: 'ph123',   role: 'project_head',   email: 'raamkumar@hospital.in',  department: ITDept }
      ];

      renameOrAdd.forEach(spec => {
        const cur = byId[spec.id];
        if (cur) {
          // Update name/email/department (preserve role + login creds if admin changed them)
          cur.name = spec.name;
          cur.email = spec.email;
          cur.department = ITDept;
          if (!cur.username) cur.username = spec.username;
          if (!cur.password) cur.password = spec.password;
          if (!cur.role)     cur.role     = spec.role;
        } else {
          users.push({ ...spec, createdAt: Utils.nowISO(), updatedAt: Utils.nowISO() });
        }
      });

      // Also reassign all admin/cio/agm to "Information Technology" so the
      // department label matches the rebrand
      ['user_admin', 'user_cio', 'user_agm'].forEach(id => {
        const u = byId[id];
        if (u) u.department = ITDept;
      });

      this._set('users', users);

      // Ensure "Information Technology" department exists in the depts table
      const depts = this._get('departments') || [];
      const itExists = depts.find(d => d.name === ITDept);
      if (!itExists) {
        // If the legacy "IT Department" exists, RENAME it (preserves dept_id)
        const legacy = depts.find(d => d.name === 'IT Department');
        if (legacy) {
          legacy.name = ITDept;
          legacy.coordinatorName  = legacy.coordinatorName  || 'Mr. Gokulraj S';
          legacy.coordinatorEmail = legacy.coordinatorEmail || 'gokulraj@hospital.in';
          if (!legacy.hodName) legacy.hodName = 'Mr. Panneer Selvan';
          if (!legacy.hodEmail) legacy.hodEmail = 'panneer@hospital.in';
        } else {
          depts.push({
            id: Utils.generateId(),
            name: ITDept,
            hodName: 'Mr. Panneer Selvan',
            hodEmail: 'panneer@hospital.in',
            coordinatorName: 'Mr. Gokulraj S',
            coordinatorEmail: 'gokulraj@hospital.in'
          });
        }
        this._set('departments', depts);
      }
    }

    // v8 → v9: replace OLD demo staff names already baked into existing
    // SCR snapshot fields, workflow notes, approvals, dev updates, and
    // audit log so the new staff names appear EVERYWHERE consistently.
    // (User IDs are stable — only stored display strings need cleanup.)
    if (current < 9) {
      const nameMap = {
        'Mr. Arjun M':       'Mrs. Saranya P',
        'Mr. Suresh Kumar':  'Mr. Gokulraj S',
        'Ms. Preethi N':     'Mrs. Saranya R',
        'Mr. Kiran Raj':     'Mr. Yoganandham S',
        'Ms. Swathi V':      'Mr. Chakravarthy',
        'Ms. Deepa S':       'Mr. Panneer Selvan'
      };
      const oldNames = Object.keys(nameMap);

      // Helper: replace whole-string match
      const swap = (s) => (s && nameMap[s]) ? nameMap[s] : s;
      // Helper: replace substring occurrences (for free-text notes)
      const swapSubstr = (s) => {
        if (!s || typeof s !== 'string') return s;
        let out = s;
        oldNames.forEach(o => { out = out.split(o).join(nameMap[o]); });
        return out;
      };

      let touched = false;

      // SCRs — snapshot name fields
      const scrs = this._get('scr_requests') || [];
      scrs.forEach(s => {
        ['studyDoneByPrimary','studyDoneBySecondary','receivedBy','coordinatedBy',
         'projectHeadName','agmItName','cioName','rejectedBy'].forEach(f => {
          if (s[f] && nameMap[s[f]]) { s[f] = nameMap[s[f]]; touched = true; }
        });
        // lastRejection.by may also carry a stored old name
        if (s.lastRejection && s.lastRejection.by && nameMap[s.lastRejection.by]) {
          s.lastRejection.by = nameMap[s.lastRejection.by];
          touched = true;
        }
      });
      if (touched) this._set('scr_requests', scrs);

      // workflow_stages — notes are free-form, may contain "Advanced by ..." etc
      const wf = this._get('workflow_stages') || [];
      let wfTouched = false;
      wf.forEach(w => {
        const newNotes = swapSubstr(w.notes);
        if (newNotes !== w.notes) { w.notes = newNotes; wfTouched = true; }
      });
      if (wfTouched) this._set('workflow_stages', wf);

      // approvals — approverName snapshots
      const ap = this._get('approvals') || [];
      let apTouched = false;
      ap.forEach(a => {
        const fixed = swap(a.approverName);
        if (fixed !== a.approverName) { a.approverName = fixed; apTouched = true; }
      });
      if (apTouched) this._set('approvals', ap);

      // audit_log — performedBy
      const audit = this._get('audit_log') || [];
      let auditTouched = false;
      audit.forEach(e => {
        const fixed = swap(e.performedBy);
        if (fixed !== e.performedBy) { e.performedBy = fixed; auditTouched = true; }
        // oldValue / newValue may also contain old names (e.g. when a name field changed)
        const fv1 = swap(e.oldValue); if (fv1 !== e.oldValue) { e.oldValue = fv1; auditTouched = true; }
        const fv2 = swap(e.newValue); if (fv2 !== e.newValue) { e.newValue = fv2; auditTouched = true; }
      });
      if (auditTouched) this._set('audit_log', audit);

      // development_updates — authorName
      const devUp = this._get('development_updates') || [];
      let devTouched = false;
      devUp.forEach(u => {
        const fixed = swap(u.authorName);
        if (fixed !== u.authorName) { u.authorName = fixed; devTouched = true; }
      });
      if (devTouched) this._set('development_updates', devUp);

      // notifications — message text may name-drop old staff
      const notifs = this._get('notifications') || [];
      let nTouched = false;
      notifs.forEach(n => {
        const fixed = swapSubstr(n.message);
        if (fixed !== n.message) { n.message = fixed; nTouched = true; }
      });
      if (nTouched) this._set('notifications', notifs);

      console.log('✅ v9: rewrote old staff names in existing SCR snapshots, workflow notes, approvals, audit log, dev updates, notifications');
    }

    // v9 → v10: clear the auto-assigned IT Coordinator on departments
    // (Mr. Arjun M / Mr. Suresh Kumar were placeholders mapped to
    // Mr. Gokulraj S / Mr. Nantha Kumar S — but they're not the actual
    // coordinators). Only clears the ones I auto-assigned; preserves
    // any names admin manually set via Master Data → Departments.
    if (current < 10) {
      const autoAssigned = new Set([
        'Mr. Arjun M', 'Mr. Suresh Kumar',
        'Mr. Gokulraj S', 'Mr. Nantha Kumar S'
      ]);
      const depts = this._get('departments') || [];
      let touched = false;
      depts.forEach(d => {
        if (autoAssigned.has(d.coordinatorName)) {
          d.coordinatorName  = '';
          d.coordinatorEmail = '';
          touched = true;
        }
      });
      if (touched) {
        this._set('departments', depts);
        console.log('✅ v10: cleared auto-assigned IT Coordinator on departments — set per-dept manually via Master Data');
      }
    }

    // v10 → v11: grant the new "hold" action to roles that act on
    // the SCR (impl team / project head / AGM-IT / CIO). Admin already
    // had it. Idempotent — only adds when missing, preserves any custom
    // edits made via Master Data → User Rights.
    if (current < 11) {
      const perms = this._get('role_permissions');
      if (perms) {
        ['cio', 'agm_it', 'project_head', 'implementation'].forEach(role => {
          if (perms[role] && Array.isArray(perms[role].actions) && !perms[role].actions.includes('hold')) {
            perms[role].actions.push('hold');
          }
        });
        this._set('role_permissions', perms);
        console.log('✅ v11: granted "hold" action to impl/PH/AGM/CIO roles');
      }
    }

    this._set('migration_version', MIGRATION_VERSION);
    console.log('✅ SCR Store migrated to v' + MIGRATION_VERSION);
  },

  // ── Self-healing: ensure default user accounts exist ────
  // If admin accidentally deleted a default user, OR a user record
  // somehow ended up with a blank name, this restores it from the
  // canonical defaults. Idempotent — only writes when something is
  // actually missing/broken. Custom users + admin's renames are
  // preserved untouched.
  ensureDefaultUsers() {
    const ITDept = 'Information Technology';
    const DEFAULT_USERS = [
      { id: 'user_admin',  name: 'System Admin',         username: 'admin',        password: 'admin123', role: 'admin',          email: 'admin@hospital.in',           department: ITDept },
      { id: 'user_cio',    name: 'Mr. Biju Velayudhan',  username: 'cio',          password: 'cio123',   role: 'cio',            email: 'biju@hospital.in',            department: ITDept },
      { id: 'user_agm',    name: 'Mr. S. Saravanakumar', username: 'agm',          password: 'agm123',   role: 'agm_it',         email: 'saravanakumar@hospital.in',   department: ITDept },
      // Project Head — 2 staff
      { id: 'user_ph',     name: 'Mr. Panneer Selvan',   username: 'projecthead',  password: 'ph123',    role: 'project_head',   email: 'panneer@hospital.in',         department: ITDept },
      { id: 'user_ph2',    name: 'Mr. T.V Raam Kumar',   username: 'projecthead2', password: 'ph123',    role: 'project_head',   email: 'raamkumar@hospital.in',       department: ITDept },
      // Implementation Team — 3 staff
      { id: 'user_impl',   name: 'Mrs. Saranya P',       username: 'impl',         password: 'impl123',  role: 'implementation', email: 'saranya.p@hospital.in',       department: ITDept },
      { id: 'user_impl2',  name: 'Mr. Gokulraj S',       username: 'impl2',        password: 'impl123',  role: 'implementation', email: 'gokulraj@hospital.in',        department: ITDept },
      { id: 'user_impl3',  name: 'Mr. Nantha Kumar S',   username: 'impl3',        password: 'impl123',  role: 'implementation', email: 'nantha@hospital.in',          department: ITDept },
      // Development Team — 3 staff
      { id: 'user_dev1',   name: 'Mrs. Saranya R',       username: 'developer',    password: 'dev123',   role: 'developer',      email: 'saranya.r@hospital.in',       department: ITDept },
      { id: 'user_dev2',   name: 'Mr. Yoganandham S',    username: 'developer2',   password: 'dev123',   role: 'developer',      email: 'yoga@hospital.in',            department: ITDept },
      { id: 'user_dev3',   name: 'Mr. Chakravarthy',     username: 'developer3',   password: 'dev123',   role: 'developer',      email: 'chakra@hospital.in',          department: ITDept },
      // Requesters (departmental — kept for legacy)
      { id: 'user_req1',   name: 'Dr. Ramesh Kumar',     username: 'requester',    password: 'req123',   role: 'requester',      email: 'ramesh@hospital.in',          department: 'Cardiology' },
      { id: 'user_req2',   name: 'Dr. Priya Sharma',     username: 'requester2',   password: 'req123',   role: 'requester',      email: 'priya@hospital.in',           department: 'Radiology' },
      { id: 'user_req3',   name: 'Mr. Ganesh Babu',      username: 'requester3',   password: 'req123',   role: 'requester',      email: 'ganesh@hospital.in',          department: 'Pharmacy' }
    ];

    const existing = this._get('users') || [];
    const byId = {};
    existing.forEach(u => { byId[u.id] = u; });

    const restored = [];
    let touched = false;

    DEFAULT_USERS.forEach(def => {
      const cur = byId[def.id];
      if (!cur) {
        // User completely missing → restore the full default record
        existing.push({ ...def, createdAt: Utils.nowISO(), updatedAt: Utils.nowISO() });
        restored.push(`${def.role}: ${def.name} (added back)`);
        touched = true;
      } else {
        // User exists but has empty/missing essential fields → fill them
        // from defaults WITHOUT overwriting non-empty custom values
        let fixed = false;
        ['name', 'username', 'password', 'role', 'email', 'department'].forEach(k => {
          const val = (cur[k] !== undefined && cur[k] !== null) ? String(cur[k]).trim() : '';
          if (!val) {
            cur[k] = def[k];
            fixed = true;
          }
        });
        if (fixed) {
          restored.push(`${def.role}: ${cur.name} (fields restored)`);
          touched = true;
        }
      }
    });

    if (touched) {
      this._set('users', existing);
      console.log(`✅ Restored ${restored.length} default user account(s):`);
      restored.forEach(n => console.log('   • ' + n));
    }
  },

  // ── Self-healing resync of reviewer names on SCRs ────────
  // For each SCR, look up the REAL person who advanced stages 3→4 and
  // who decided at stage 4 (AGM/CIO), and correct projectHeadName /
  // agmItName / cioName if they're stale. Idempotent — safe to call on
  // every init. Logs corrections to console for diagnostics.
  resyncReviewerNames() {
    const scrs       = this._get('scr_requests')   || [];
    const stages     = this._get('workflow_stages') || [];
    const approvals  = this._get('approvals')      || [];
    const users      = this._get('users')          || [];
    if (scrs.length === 0) return;

    const userById = {};
    users.forEach(u => { userById[u.id] = u; });

    const corrections = [];
    let touched = false;

    scrs.forEach(scr => {
      // ── Project Head ──
      // Stage 3's exitedBy (explicit advancer field) OR stage 4's
      // performedBy (the user who created stage 4 = the advancer)
      const stage3 = stages.find(w => w.scrId === scr.id && w.stage === 3 && w.exitedAt);
      const stage4 = stages.find(w => w.scrId === scr.id && w.stage === 4);
      const phAdvancerId = (stage3 && stage3.exitedBy) || (stage4 && stage4.performedBy) || null;
      if (phAdvancerId) {
        const phUser = userById[phAdvancerId];
        if (phUser && phUser.role === 'project_head' && scr.projectHeadName !== phUser.name) {
          corrections.push(`${scr.scrNumber}: PH "${scr.projectHeadName}" → "${phUser.name}"`);
          scr.projectHeadName = phUser.name;
          touched = true;
        }
      }

      // ── AGM-IT ── most recent approval by agm_it
      const agmDecision = approvals
        .filter(a => a.scrId === scr.id && a.approverRole === 'agm_it')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      if (agmDecision && scr.agmItName !== agmDecision.approverName) {
        corrections.push(`${scr.scrNumber}: AGM "${scr.agmItName}" → "${agmDecision.approverName}"`);
        scr.agmItName = agmDecision.approverName;
        touched = true;
      }

      // ── CIO ── most recent approval by cio
      const cioDecision = approvals
        .filter(a => a.scrId === scr.id && a.approverRole === 'cio')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      if (cioDecision && scr.cioName !== cioDecision.approverName) {
        corrections.push(`${scr.scrNumber}: CIO "${scr.cioName}" → "${cioDecision.approverName}"`);
        scr.cioName = cioDecision.approverName;
        touched = true;
      }
    });

    if (touched) {
      this._set('scr_requests', scrs);
      console.log(`✅ Resynced reviewer names on ${corrections.length} SCR(s):`);
      corrections.forEach(c => console.log('   • ' + c));
    }
  },

  // ── Reset all data (admin Settings page) ────────────────
  // Wipes the SQLite DB on the server, clears the local cache, and
  // re-runs seed/migrate so the demo state comes back fresh.
  async resetAll() {
    const res = await fetch('/api/admin/reset', { method: 'POST' });
    if (!res.ok) {
      console.error('Reset failed:', res.status);
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('error', 'Reset Failed', 'Server did not accept the reset.');
      }
      return;
    }
    // Clear cache + meta locally so seed re-runs against empty state
    this._cache = {};
    this.COLLECTIONS.forEach(c => { this._cache[c] = []; });
    this._meta = {};
    // Re-seed + migrate + heal, then flush to server
    this.beginBootBatch();
    this.seed();
    this.migrate();
    this.ensureDefaultUsers();
    this.resyncReviewerNames();
    await this.commitBootBatch();
  }
};
