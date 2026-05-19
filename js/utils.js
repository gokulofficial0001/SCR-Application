/* ============================================================
   SCR MANAGEMENT SYSTEM — Utility Functions
   ============================================================ */

const Utils = {
  // ── ID Generation ───────────────────────────────────────
  generateId() {
    // Prefer crypto.randomUUID when available (modern browsers)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'id_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    }
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  },

  // ── SCR number = highest existing + 1 ──────────────────
  // The real-world paper SCR series is at #145, so the system continues
  // from 146. Scans every existing SCR's scrNumber, takes the highest
  // pure-numeric value, returns max+1. To shift the start later, change
  // SCR_SERIES_START.
  //
  // Deletion behaviour: if the highest-numbered SCR is deleted, the next
  // generated number fills that gap (e.g. delete 148 -> next create is
  // 148 again). The series follows the last EXISTING number, not a
  // historical high-water mark.
  SCR_SERIES_START: 146,

  generateSCRNumber() {
    let maxSeq = this.SCR_SERIES_START - 1;  // floor: first generated = SERIES_START
    Store.getAll('scr_requests').forEach(s => {
      const raw = (s && s.scrNumber != null) ? String(s.scrNumber).trim() : '';
      if (/^\d+$/.test(raw)) {
        const n = parseInt(raw, 10);
        if (n > maxSeq) maxSeq = n;
      }
    });
    return String(maxSeq + 1);
  },

  // ── Validation helpers ─────────────────────────────────
  isNonEmpty(str) {
    return typeof str === 'string' && str.trim().length > 0;
  },

  isValidDate(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
  },

  isDateRangeValid(from, to) {
    if (!from || !to) return true; // treat missing as acceptable
    const f = new Date(from);
    const t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) return false;
    return f <= t;
  },

  isValidEmail(str) {
    if (!str) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
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
    'requester': 'Requester',
    'internal_requester': 'Internal Requester'
  },

  getRoleLabel(role) {
    return Utils.roleLabels[role] || role;
  },

  // ── Department list ─────────────────────────────────────
  // Hospital department list — HOD map matches the canonical hard-coded
  // reference (mirrored in server/seed-demo-data.js). Coordinator names
  // are blank by default: set them per dept via Master Data when needed.
  defaultDepartments: [
    { id: 'dept_it',       name: 'IT',               hodName: 'Mr. S. Saravanakumar', hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_hr',       name: 'HR',               hodName: 'Mr. Nagappan',         hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_him',      name: 'HIM',              hodName: 'Mr. Prince Kumar',     hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_intaudit', name: 'Internal Audit',   hodName: 'Mrs. Mallika Devi',    hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_quality',  name: 'Quality',          hodName: 'Dr. Madhavi',          hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_pharm',    name: 'Pharmacy',         hodName: 'Mr. Tamilarasan',      hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_radio',    name: 'Radiology',        hodName: 'Mrs. Annalakshmi',     hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_lab',      name: 'Lab',              hodName: 'Dr. Kavitha',          hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_engg',     name: 'Engineering',      hodName: 'Mr. Ravikumar',        hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_nurs',     name: 'Nursing',          hodName: 'Mrs. Jayalakshmi',     hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_acct',     name: 'Accounts',         hodName: 'Mr. Pandia Rajan K',   hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_biomed',   name: 'Biomedical',       hodName: 'Mrs. Anandhi',         hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_ins',      name: 'Insurance',        hodName: 'Mr. Surendiran',       hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_pr',       name: 'Public Relations', hodName: 'Mrs. Bhanu Rao',       hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_histo',    name: 'Histopathology',   hodName: 'Mrs. Saritha S',       hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_house',    name: 'Housekeeping',     hodName: 'Mr. Preejith V',       hodEmail: '', coordinatorName: '', coordinatorEmail: '' },
    { id: 'dept_diet',     name: 'Dietary',          hodName: 'Mrs. Mekala D',        hodEmail: '', coordinatorName: '', coordinatorEmail: '' }
  ],

  // ── Toast helper (capped to 4 visible to avoid spam) ────
  toast(type, title, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Cap concurrent toasts — oldest gets dismissed early
    const existing = container.querySelectorAll('.toast:not(.toast-exit)');
    if (existing.length >= 4) {
      existing[0].classList.add('toast-exit');
      setTimeout(() => existing[0].remove(), 300);
    }

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
