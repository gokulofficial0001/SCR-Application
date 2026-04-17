/* ============================================================
   SCR MANAGEMENT SYSTEM — Utility Functions
   ============================================================ */

const Utils = {
  // ── ID Generation ───────────────────────────────────────
  generateId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  },

  generateSCRNumber() {
    const year = new Date().getFullYear();
    const existing = Store.getAll('scr_requests');
    const thisYear = existing.filter(s => s.scrNumber && s.scrNumber.includes(year.toString()));
    const seq = (thisYear.length + 1).toString().padStart(4, '0');
    return `SCR-${year}-${seq}`;
  },

  // ── Date Formatting ─────────────────────────────────────
  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { 
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  },

  formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const d = new Date(dateStr);
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return Utils.formatDate(dateStr);
  },

  // ── Today's date in YYYY-MM-DD ──────────────────────────
  today() {
    return new Date().toISOString().split('T')[0];
  },

  nowISO() {
    return new Date().toISOString();
  },

  // ── Hours between two dates ─────────────────────────────
  hoursBetween(start, end) {
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    return Math.round((e - s) / 3600000);
  },

  // ── String helpers ──────────────────────────────────────
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },

  truncate(str, len = 50) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
  },

  slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },

  getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
  },

  // ── Duplicate detection (simple similarity) ─────────────
  similarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    if (a === b) return 1;
    
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.length / union.size; // Jaccard similarity
  },

  // ── Escaping HTML ───────────────────────────────────────
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ── Number formatting ──────────────────────────────────
  formatNumber(n) {
    if (n === null || n === undefined) return '0';
    return n.toLocaleString('en-IN');
  },

  // ── Priority helpers ────────────────────────────────────
  priorityConfig: {
    'Emergency': { color: 'danger', icon: '🔴', slaHours: 24 },
    'Urgent':    { color: 'warning', icon: '🟡', slaHours: 72 },
    'Routine':   { color: 'info', icon: '🔵', slaHours: 168 }
  },

  // ── Status helpers ──────────────────────────────────────
  statusConfig: {
    'Open':        { color: 'success', icon: '📋' },
    'In Progress': { color: 'primary', icon: '⚙️' },
    'On Hold':     { color: 'warning', icon: '⏸️' },
    'Completed':   { color: 'info', icon: '✅' },
    'Closed':      { color: 'neutral', icon: '🔒' },
    'Rejected':    { color: 'danger', icon: '❌' }
  },

  // ── Stage helpers ───────────────────────────────────────
  stages: [
    { id: 1, name: 'Requirement Submission', short: 'Submitted' },
    { id: 2, name: 'Implementation Review',  short: 'Impl. Review' },
    { id: 3, name: 'Project Head Review',    short: 'PH Review' },
    { id: 4, name: 'Management Approval',    short: 'MGT Approval' },
    { id: 5, name: 'Development',            short: 'Development' },
    { id: 6, name: 'QA & Closure',           short: 'QA & Close' }
  ],

  getStageName(stageId) {
    const stage = Utils.stages.find(s => s.id === stageId);
    return stage ? stage.name : 'Unknown';
  },

  // ── Role display ────────────────────────────────────────
  roleLabels: {
    'admin': 'System Admin',
    'cio': 'CIO',
    'agm_it': 'AGM – IT',
    'project_head': 'Project Head',
    'implementation': 'Implementation Team',
    'developer': 'Developer',
    'requester': 'Requester'
  },

  getRoleLabel(role) {
    return Utils.roleLabels[role] || role;
  },

  // ── Department list ─────────────────────────────────────
  defaultDepartments: [
    { id: 'dept_1', name: 'Cardiology', hodName: 'Dr. Ramesh Kumar', hodEmail: 'ramesh@hospital.in' },
    { id: 'dept_2', name: 'Radiology', hodName: 'Dr. Priya Sharma', hodEmail: 'priya@hospital.in' },
    { id: 'dept_3', name: 'Neurology', hodName: 'Dr. Suresh Menon', hodEmail: 'suresh@hospital.in' },
    { id: 'dept_4', name: 'Orthopedics', hodName: 'Dr. Kavitha Nair', hodEmail: 'kavitha@hospital.in' },
    { id: 'dept_5', name: 'Pediatrics', hodName: 'Dr. Anil Gupta', hodEmail: 'anil@hospital.in' },
    { id: 'dept_6', name: 'Oncology', hodName: 'Dr. Lakshmi Iyer', hodEmail: 'lakshmi@hospital.in' },
    { id: 'dept_7', name: 'Emergency Medicine', hodName: 'Dr. Vikram Singh', hodEmail: 'vikram@hospital.in' },
    { id: 'dept_8', name: 'General Surgery', hodName: 'Dr. Meena Patel', hodEmail: 'meena@hospital.in' },
    { id: 'dept_9', name: 'Ophthalmology', hodName: 'Dr. Rajesh Verma', hodEmail: 'rajesh@hospital.in' },
    { id: 'dept_10', name: 'Pharmacy', hodName: 'Mr. Ganesh Babu', hodEmail: 'ganesh@hospital.in' },
    { id: 'dept_11', name: 'Laboratory', hodName: 'Dr. Saranya M', hodEmail: 'saranya@hospital.in' },
    { id: 'dept_12', name: 'Nursing', hodName: 'Ms. Anjali Thomas', hodEmail: 'anjali@hospital.in' },
    { id: 'dept_13', name: 'Administration', hodName: 'Mr. Senthil Raja', hodEmail: 'senthil@hospital.in' },
    { id: 'dept_14', name: 'Finance & Billing', hodName: 'Mr. Karthik R', hodEmail: 'karthik@hospital.in' },
    { id: 'dept_15', name: 'IT Department', hodName: 'Mr. Dinesh Kumar', hodEmail: 'dinesh@hospital.in' }
  ],

  // ── Toast helper ────────────────────────────────────────
  toast(type, title, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || 'ℹ'}</div>
      <div class="toast-content">
        <div class="toast-title">${Utils.escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${Utils.escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // ── Modal helper ────────────────────────────────────────
  showModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('hidden');
  },

  hideModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('hidden');
  },

  // ── Confirm dialog ──────────────────────────────────────
  confirm(title, message, type = 'warning') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-body" style="text-align:center; padding: var(--space-8) var(--space-6);">
            <div class="confirm-icon ${type}">
              ${type === 'danger' ? '🗑️' : type === 'warning' ? '⚠️' : '✓'}
            </div>
            <h4 style="margin-bottom:var(--space-2)">${Utils.escapeHtml(title)}</h4>
            <p style="margin-bottom:var(--space-6)">${Utils.escapeHtml(message)}</p>
            <div style="display:flex;gap:var(--space-3);justify-content:center">
              <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
              <button class="btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">Confirm</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
      overlay.querySelector('#confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
    });
  },

  // ── Debounce ────────────────────────────────────────────
  debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // ── Badge HTML helper ───────────────────────────────────
  badgeHtml(text, color = 'neutral', dot = false) {
    return `<span class="badge badge-${color}${dot ? ' badge-dot' : ''}">${Utils.escapeHtml(text)}</span>`;
  },

  // ── Priority badge ─────────────────────────────────────
  priorityBadge(priority) {
    const cfg = Utils.priorityConfig[priority] || { color: 'neutral', icon: '⚪' };
    return `<span class="badge badge-${cfg.color} badge-dot">${Utils.escapeHtml(priority)}</span>`;
  },

  // ── Status badge ────────────────────────────────────────
  statusBadge(status) {
    const cfg = Utils.statusConfig[status] || { color: 'neutral' };
    return `<span class="badge badge-${cfg.color} badge-dot">${Utils.escapeHtml(status)}</span>`;
  }
};
