/* ============================================================
   SCR MANAGEMENT SYSTEM — Data Store (localStorage)
   Provides CRUD, seed data, and reactive state management
   ============================================================ */

const Store = {
  // ── Core CRUD ───────────────────────────────────────────
  _get(key) {
    try {
      const data = localStorage.getItem(`scr_${key}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error(`Store._get(${key}) error — data may be corrupted:`, e);
      // Best-effort recovery: remove corrupted key so app can continue
      try { localStorage.removeItem(`scr_${key}`); } catch {}
      return null;
    }
  },

  _set(key, value) {
    const payload = JSON.stringify(value);
    try {
      localStorage.setItem(`scr_${key}`, payload);
    } catch (e) {
      // QuotaExceededError or similar — try to recover by pruning
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
        console.warn(`Store._set(${key}): quota exceeded, pruning logs…`);
        this._prune();
        try {
          localStorage.setItem(`scr_${key}`, payload);
          return;
        } catch (e2) {
          console.error(`Store._set(${key}) still failed after prune:`, e2);
          if (typeof Utils !== 'undefined' && Utils.toast) {
            Utils.toast('error', 'Storage Full', 'Local storage is full. Please export and clear old data.');
          }
          return;
        }
      }
      console.error(`Store._set(${key}) error:`, e);
    }
  },

  // ── Prune old audit/notification records to recover quota ──
  _prune() {
    // Keep last 500 audit entries + delete notifications older than 60 days
    const cutoff = Date.now() - 60 * 86400000;
    const audit = (this._get('audit_log') || []).slice(-500);
    try { localStorage.setItem('scr_audit_log', JSON.stringify(audit)); } catch {}

    const notifs = (this._get('notifications') || []).filter(n => {
      if (!n.read) return true; // keep unread
      const ts = new Date(n.timestamp).getTime();
      return !isNaN(ts) && ts >= cutoff;
    });
    try { localStorage.setItem('scr_notifications', JSON.stringify(notifs)); } catch {}
  },

  // ── Routine pruning — called on app init ──
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
    return this._get(collection) || [];
  },

  getById(collection, id) {
    const items = this.getAll(collection);
    return items.find(item => item.id === id) || null;
  },

  add(collection, item) {
    const items = this.getAll(collection);
    if (!item.id) item.id = Utils.generateId();
    if (!item.createdAt) item.createdAt = Utils.nowISO();
    item.updatedAt = Utils.nowISO();
    items.push(item);
    this._set(collection, items);
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
      rejectedAt: null
    };
  },

  update(collection, id, updates) {
    const items = this.getAll(collection);
    const idx = items.findIndex(item => item.id === id);
    if (idx === -1) return null;
    const oldItem = { ...items[idx] };
    items[idx] = { ...items[idx], ...updates, updatedAt: Utils.nowISO() };
    this._set(collection, items);
    this._notify(collection, 'update', items[idx], oldItem);
    return items[idx];
  },

  remove(collection, id) {
    let items = this.getAll(collection);
    const item = items.find(i => i.id === id);
    items = items.filter(i => i.id !== id);
    this._set(collection, items);
    if (item) {
      this._notify(collection, 'remove', item);
      // Cascade: when an SCR is deleted, purge dependent records
      if (collection === 'scr_requests') this._cascadeDeleteSCR(id);
    }
    return item;
  },

  // ── Cascade cleanup: remove all dependent records for a deleted SCR ──
  _cascadeDeleteSCR(scrId) {
    ['workflow_stages', 'approvals', 'feedback', 'notifications', 'development_updates'].forEach(coll => {
      const items = (this._get(coll) || []).filter(r => r.scrId !== scrId);
      this._set(coll, items);
    });
    // Audit log — mark SCR deletion but keep historic entries for compliance
    // (NABH requires audit trail preservation; don't purge audit)
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
  getSession() {
    return this._get('session');
  },

  setSession(user) {
    this._set('session', user);
  },

  clearSession() {
    localStorage.removeItem('scr_session');
  },

  // ── Check if seeded ─────────────────────────────────────
  isSeeded() {
    return this._get('seeded') === true;
  },

  // ── Seeds ───────────────────────────────────────────────
  seed() {
    if (this.isSeeded()) return;

    // Users
    const users = [
      { id: 'user_admin', name: 'System Admin', username: 'admin', password: 'admin123', role: 'admin', email: 'admin@hospital.in', department: 'IT Department' },
      { id: 'user_cio', name: 'Mr. Biju Velayudhan', username: 'cio', password: 'cio123', role: 'cio', email: 'biju@hospital.in', department: 'IT Department' },
      { id: 'user_agm', name: 'Mr. S. Saravanakumar', username: 'agm', password: 'agm123', role: 'agm_it', email: 'saravanakumar@hospital.in', department: 'IT Department' },
      { id: 'user_ph', name: 'Ms. Deepa S', username: 'projecthead', password: 'ph123', role: 'project_head', email: 'deepa@hospital.in', department: 'IT Department' },
      { id: 'user_impl', name: 'Mr. Arjun M', username: 'impl', password: 'impl123', role: 'implementation', email: 'arjun@hospital.in', department: 'IT Department' },
      { id: 'user_impl2', name: 'Mr. Suresh Kumar', username: 'impl2', password: 'impl123', role: 'implementation', email: 'suresh@hospital.in', department: 'IT Department' },
      { id: 'user_dev1', name: 'Ms. Preethi N', username: 'developer', password: 'dev123', role: 'developer', email: 'preethi@hospital.in', department: 'IT Department' },
      { id: 'user_dev2', name: 'Mr. Kiran Raj', username: 'developer2', password: 'dev123', role: 'developer', email: 'kiran@hospital.in', department: 'IT Department' },
      { id: 'user_dev3', name: 'Ms. Swathi V', username: 'developer3', password: 'dev123', role: 'developer', email: 'swathi@hospital.in', department: 'IT Department' },
      { id: 'user_req1', name: 'Dr. Ramesh Kumar', username: 'requester', password: 'req123', role: 'requester', email: 'ramesh@hospital.in', department: 'Cardiology' },
      { id: 'user_req2', name: 'Dr. Priya Sharma', username: 'requester2', password: 'req123', role: 'requester', email: 'priya@hospital.in', department: 'Radiology' },
      { id: 'user_req3', name: 'Mr. Ganesh Babu', username: 'requester3', password: 'req123', role: 'requester', email: 'ganesh@hospital.in', department: 'Pharmacy' }
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
      cio:            { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','view_audit'] },
      agm_it:         { pages: ['dashboard','scr-list','scr-detail','approvals','feedback','audit','notifications'], actions: ['approve','reject','view_audit'] },
      project_head:   { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','view_audit'] },
      implementation: { pages: ['dashboard','scr-list','scr-detail','scr-create','feedback','audit','notifications'], actions: ['create_scr','edit_scr','assign_scr','advance_stage','reject','close_ticket','view_audit'] },
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
        requestedBy: 'Dr. Ramesh Kumar', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Cardiology', hodName: 'Dr. Ramesh Kumar',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: 'Mr. Ravi Shankar',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: 'user_dev2',
        assignedOn: daysAgo(9).split('T')[0], studyDateFrom: daysAgo(9).split('T')[0], studyDateTo: daysAgo(8).split('T')[0],
        scheduleDate: daysAgo(6).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Dr. Priya Sharma', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Radiology', hodName: 'Dr. Priya Sharma',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: '',
        assignedOn: daysAgo(12).split('T')[0], studyDateFrom: daysAgo(13).split('T')[0], studyDateTo: daysAgo(12).split('T')[0],
        scheduleDate: daysAgo(10).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Mr. Ganesh Babu', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Pharmacy', hodName: 'Mr. Ganesh Babu',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: 'Mr. Ravi Shankar',
        assignedDeveloper: 'user_dev3', assignedDeveloper2: '',
        assignedOn: daysAgo(20).split('T')[0], studyDateFrom: daysAgo(21).split('T')[0], studyDateTo: daysAgo(20).split('T')[0],
        scheduleDate: daysAgo(18).split('T')[0], completedOn: daysAgo(6).split('T')[0],
        approvalStatus: 'Approved', approvalReason: 'Report format meets requirements. Approved for deployment.',
        projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Dr. Vikram Singh', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Emergency Medicine', hodName: 'Dr. Vikram Singh',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: '',
        assignedOn: daysAgo(5).split('T')[0], studyDateFrom: daysAgo(6).split('T')[0], studyDateTo: daysAgo(5).split('T')[0],
        scheduleDate: daysAgo(3).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Mr. Karthik R', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Finance & Billing', hodName: 'Mr. Karthik R',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: 'Mr. Ravi Shankar',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: 'user_dev3',
        assignedOn: daysAgo(30).split('T')[0], studyDateFrom: daysAgo(31).split('T')[0], studyDateTo: daysAgo(30).split('T')[0],
        scheduleDate: daysAgo(28).split('T')[0], completedOn: daysAgo(12).split('T')[0],
        approvalStatus: 'Approved', approvalReason: 'All billing requirements met.',
        projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Dr. Saranya M', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Laboratory', hodName: 'Dr. Saranya M',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev3', assignedDeveloper2: '',
        assignedOn: daysAgo(3).split('T')[0], studyDateFrom: daysAgo(4).split('T')[0], studyDateTo: daysAgo(3).split('T')[0],
        scheduleDate: daysAgo(2).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Ms. Anjali Thomas', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: '',
        department: 'Nursing', hodName: 'Ms. Anjali Thomas',
        studyDoneByPrimary: '', studyDoneBySecondary: '',
        assignedDeveloper: '', assignedDeveloper2: '', assignedOn: null,
        studyDateFrom: null, studyDateTo: null, scheduleDate: null, completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Dr. Anil Gupta', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: '',
        department: 'Pediatrics', hodName: 'Dr. Anil Gupta',
        studyDoneByPrimary: '', studyDoneBySecondary: '',
        assignedDeveloper: '', assignedDeveloper2: '', assignedOn: null,
        studyDateFrom: null, studyDateTo: null, scheduleDate: null, completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Mr. Senthil Raja', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'Administration', hodName: 'Mr. Senthil Raja',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: 'Mr. Ravi Shankar',
        assignedDeveloper: 'user_dev1', assignedDeveloper2: '',
        assignedOn: daysAgo(15).split('T')[0], studyDateFrom: daysAgo(16).split('T')[0], studyDateTo: daysAgo(15).split('T')[0],
        scheduleDate: daysAgo(12).split('T')[0], completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
        requestedBy: 'Dr. Meena Patel', receivedBy: 'Mr. Ravi Shankar', coordinatedBy: 'Mr. Arjun M',
        department: 'General Surgery', hodName: 'Dr. Meena Patel',
        studyDoneByPrimary: 'Mr. Arjun M', studyDoneBySecondary: '',
        assignedDeveloper: 'user_dev2', assignedDeveloper2: '',
        assignedOn: daysAgo(1).split('T')[0], studyDateFrom: daysAgo(2).split('T')[0], studyDateTo: daysAgo(1).split('T')[0],
        scheduleDate: Utils.today(), completedOn: null,
        approvalStatus: '', approvalReason: '', projectHeadName: 'Ms. Deepa S', agmItName: 'Mr. S. Saravanakumar', cioName: 'Mr. Biju Velayudhan',
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
      { id: Utils.generateId(), entityType: 'SCR', entityId: 'scr_1', action: 'Stage Advanced', field: 'currentStage', oldValue: 'Requirement Submission', newValue: 'Implementation Review', performedBy: 'Mr. Arjun M', role: 'implementation', timestamp: daysAgo(9) },
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
    const MIGRATION_VERSION = 5;
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
      if (!s.projectHeadName) s.projectHeadName = 'Ms. Deepa S';
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

    this._set('migration_version', MIGRATION_VERSION);
    console.log('✅ SCR Store migrated to v' + MIGRATION_VERSION);
  },

  // ── Reset all data ──────────────────────────────────────
  resetAll() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('scr_'));
    keys.forEach(k => localStorage.removeItem(k));
    this.seed();
  }
};
