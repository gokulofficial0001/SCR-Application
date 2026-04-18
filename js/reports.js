/* ============================================================
   SCR MANAGEMENT SYSTEM — Audit Reports (Weekly / Monthly / Yearly)
   ──────────────────────────────────────────────────────────
   Permission-gated reporting module for compliance / audit.
   Generates summary + detail reports across any period with CSV
   export + browser-print support. Currently scoped to admin only
   (permissions controlled via auth.js — adjust roles there).
   ============================================================ */

const Reports = {

  // ── Period state ────────────────────────────────────────
  period: 'month',  // 'week' | 'month' | 'year' | 'custom'
  customFrom: null,
  customTo: null,

  // ── Compute date range for the selected period ──────────
  getRange() {
    const now = new Date();
    let from, to;

    switch (this.period) {
      case 'week': {
        // Last 7 days inclusive
        from = new Date(now); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0);
        to = new Date(now); to.setHours(23, 59, 59, 999);
        break;
      }
      case 'month': {
        // Last 30 days inclusive
        from = new Date(now); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
        to = new Date(now); to.setHours(23, 59, 59, 999);
        break;
      }
      case 'year': {
        from = new Date(now); from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() + 1); from.setHours(0, 0, 0, 0);
        to = new Date(now); to.setHours(23, 59, 59, 999);
        break;
      }
      case 'custom': {
        from = this.customFrom ? new Date(this.customFrom + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), 1);
        to = this.customTo ? new Date(this.customTo + 'T23:59:59') : new Date(now);
        break;
      }
    }
    return { from, to };
  },

  periodLabel() {
    const { from, to } = this.getRange();
    const labels = {
      week: 'Weekly Report (Last 7 days)',
      month: 'Monthly Report (Last 30 days)',
      year: 'Yearly Report (Last 365 days)',
      custom: `Custom Report (${Utils.formatDate(from)} – ${Utils.formatDate(to)})`
    };
    return labels[this.period] || 'Report';
  },

  // ── Filter SCRs by createdAt within range ───────────────
  _scrsInRange() {
    const { from, to } = this.getRange();
    return Store.getAll('scr_requests').filter(s => {
      const d = new Date(s.createdAt);
      return !isNaN(d) && d >= from && d <= to;
    });
  },

  _approvalsInRange() {
    const { from, to } = this.getRange();
    return Store.getAll('approvals').filter(a => {
      const d = new Date(a.timestamp);
      return !isNaN(d) && d >= from && d <= to;
    });
  },

  _auditInRange() {
    const { from, to } = this.getRange();
    return Store.getAll('audit_log').filter(e => {
      const d = new Date(e.timestamp);
      return !isNaN(d) && d >= from && d <= to;
    });
  },

  _feedbackInRange() {
    const { from, to } = this.getRange();
    return Store.getAll('feedback').filter(f => {
      const d = new Date(f.timestamp);
      return !isNaN(d) && d >= from && d <= to;
    });
  },

  // ── Set period + re-render ──────────────────────────────
  setPeriod(p) {
    this.period = p;
    Router.navigate('reports');
  },

  setCustomRange() {
    this.customFrom = document.getElementById('rpt-from')?.value || null;
    this.customTo = document.getElementById('rpt-to')?.value || null;
    this.period = 'custom';
    Router.navigate('reports');
  },

  // ── Main render ─────────────────────────────────────────
  render() {
    if (!Auth.canAccessPage('reports')) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-text">You do not have permission to view audit reports.</p>
      </div>`;
    }

    const { from, to } = this.getRange();
    const scrs = this._scrsInRange();
    const approvals = this._approvalsInRange();
    const audit = this._auditInRange();
    const feedback = this._feedbackInRange();

    // KPIs
    const total = scrs.length;
    const closed = scrs.filter(s => s.status === 'Closed').length;
    const rejected = scrs.filter(s => s.status === 'Rejected').length;
    const inProgress = scrs.filter(s => s.status === 'In Progress').length;
    const open = scrs.filter(s => s.status === 'Open').length;
    const onHold = scrs.filter(s => s.status === 'On Hold').length;
    const breached = scrs.filter(s => {
      const sla = SLAEngine.calculate(s);
      return sla.status === 'breached';
    }).length;
    const atRisk = scrs.filter(s => {
      const sla = SLAEngine.calculate(s);
      return sla.status === 'at-risk';
    }).length;

    const avgFeedback = feedback.length > 0
      ? (feedback.reduce((sum, f) => sum + (f.avgScore || 0), 0) / feedback.length).toFixed(2)
      : '—';

    const closureRate = total > 0 ? Math.round((closed / total) * 100) : 0;
    const rejectionRate = total > 0 ? Math.round((rejected / total) * 100) : 0;

    const approved = approvals.filter(a => a.decision === 'Approved').length;
    const rejectedApprovals = approvals.filter(a => a.decision === 'Rejected').length;

    // Department breakdown
    const byDept = {};
    scrs.forEach(s => { byDept[s.department] = (byDept[s.department] || 0) + 1; });
    const deptRows = Object.entries(byDept).sort((a, b) => b[1] - a[1]);

    // Priority breakdown
    const byPriority = { Emergency: 0, Urgent: 0, Routine: 0 };
    scrs.forEach(s => { byPriority[s.priority || s.intervention] = (byPriority[s.priority || s.intervention] || 0) + 1; });

    // Stage distribution
    const byStage = {};
    scrs.forEach(s => {
      const name = Utils.getStageName(s.currentStage) || `Stage ${s.currentStage}`;
      byStage[name] = (byStage[name] || 0) + 1;
    });

    // Rejections (look at lastRejection OR status === 'Rejected')
    const rejections = scrs.filter(s => s.lastRejection || s.status === 'Rejected');

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">📊 Audit Reports</h2>
          </div>
          <p class="page-description">Generate compliance and operational reports for any time period</p>
        </div>
        <div class="flex gap-2 no-print">
          <button class="btn btn-ghost" onclick="window.print()">🖨️ Print</button>
          <button class="btn btn-primary" onclick="Reports.downloadCSV()">⬇️ Download CSV</button>
        </div>
      </div>

      <!-- Period selector -->
      <div class="card mb-4 no-print">
        <div class="card-body">
          <div class="flex items-center" style="gap:var(--space-3);flex-wrap:wrap">
            <span class="font-semi">Period:</span>
            <button class="btn ${this.period === 'week' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="Reports.setPeriod('week')">Weekly</button>
            <button class="btn ${this.period === 'month' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="Reports.setPeriod('month')">Monthly</button>
            <button class="btn ${this.period === 'year' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="Reports.setPeriod('year')">Yearly</button>
            <div style="height:24px;width:1px;background:var(--color-border)"></div>
            <span class="text-sm text-tertiary">Custom:</span>
            <input type="date" class="form-input" id="rpt-from" value="${this.customFrom || ''}" style="min-width:150px;max-width:170px">
            <span class="text-sm">→</span>
            <input type="date" class="form-input" id="rpt-to" value="${this.customTo || ''}" style="min-width:150px;max-width:170px">
            <button class="btn btn-ghost btn-sm" onclick="Reports.setCustomRange()">Apply</button>
          </div>
        </div>
      </div>

      <!-- Report header (shown in print) -->
      <div class="card mb-4" style="border-left:4px solid var(--color-primary)">
        <div class="card-body">
          <h3 class="font-bold" style="font-size:var(--font-xl);margin-bottom:var(--space-1)">${this.periodLabel()}</h3>
          <p class="text-sm text-secondary">
            <strong>Period:</strong> ${Utils.formatDate(from)} – ${Utils.formatDate(to)}
            &nbsp;·&nbsp; <strong>Generated:</strong> ${Utils.formatDateTime(Utils.nowISO())}
            &nbsp;·&nbsp; <strong>By:</strong> ${Utils.escapeHtml(Auth.currentUser()?.name || '—')}
          </p>
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="dashboard-kpis" style="margin-bottom:var(--space-5)">
        <div class="kpi-card primary">
          <div class="kpi-icon">📋</div>
          <div class="kpi-value">${total}</div>
          <div class="kpi-label">Total SCRs</div>
        </div>
        <div class="kpi-card success">
          <div class="kpi-icon">✅</div>
          <div class="kpi-value">${closed}</div>
          <div class="kpi-label">Closed (${closureRate}%)</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-icon">⚙️</div>
          <div class="kpi-value">${inProgress}</div>
          <div class="kpi-label">In Progress</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-value">${atRisk + breached}</div>
          <div class="kpi-label">At-Risk / Breached</div>
        </div>
        <div class="kpi-card danger">
          <div class="kpi-icon">❌</div>
          <div class="kpi-value">${rejected}</div>
          <div class="kpi-label">Rejected (${rejectionRate}%)</div>
        </div>
      </div>

      <div class="scr-detail-grid" style="grid-template-columns:2fr 1fr;gap:var(--space-4)">

        <!-- Left: Department breakdown -->
        <div class="card">
          <div class="card-header"><h3 class="card-title">🏢 SCRs by Department</h3></div>
          <div class="card-body">
            ${deptRows.length === 0 ? '<p class="text-muted text-sm">No SCRs in this period</p>' : `
              <table class="data-table">
                <thead>
                  <tr><th>Department</th><th style="text-align:right">SCRs</th><th style="text-align:right">% of Total</th></tr>
                </thead>
                <tbody>
                  ${deptRows.map(([dept, count]) => `
                    <tr>
                      <td>${Utils.escapeHtml(dept || '—')}</td>
                      <td style="text-align:right" class="font-semi">${count}</td>
                      <td style="text-align:right">${total > 0 ? Math.round((count / total) * 100) : 0}%</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <!-- Right: Priority + Stage + Approval + Feedback summary -->
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">

          <div class="card">
            <div class="card-header"><h3 class="card-title">🔥 By Priority</h3></div>
            <div class="card-body">
              ${['Emergency','Urgent','Routine'].map(p => `
                <div class="flex justify-between items-center mb-2">
                  <span class="text-sm">${p}</span>
                  <span class="font-bold">${byPriority[p] || 0}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3 class="card-title">📈 By Stage</h3></div>
            <div class="card-body">
              ${Object.keys(byStage).length === 0 ? '<p class="text-muted text-sm">—</p>' :
                Object.entries(byStage).map(([stage, count]) => `
                  <div class="flex justify-between items-center mb-2">
                    <span class="text-sm">${Utils.escapeHtml(stage)}</span>
                    <span class="font-bold">${count}</span>
                  </div>
                `).join('')
              }
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3 class="card-title">✅ Approvals in Period</h3></div>
            <div class="card-body">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm">Approved</span>
                <span class="font-bold text-success">${approved}</span>
              </div>
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm">Rejected</span>
                <span class="font-bold text-danger">${rejectedApprovals}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm">Total Decisions</span>
                <span class="font-bold">${approvals.length}</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3 class="card-title">⭐ Feedback</h3></div>
            <div class="card-body">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm">Responses</span>
                <span class="font-bold">${feedback.length}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm">Avg Score</span>
                <span class="font-bold" style="color:var(--color-warning-dark)">${avgFeedback}/5</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Rejection analysis -->
      ${rejections.length > 0 ? `
      <div class="card mt-4">
        <div class="card-header">
          <h3 class="card-title">❌ Rejection Analysis (${rejections.length})</h3>
        </div>
        <div class="card-body">
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr><th>SCR</th><th>Department</th><th>Rejected At</th><th>Returned To</th><th>By</th><th>Remarks</th><th>Date</th></tr>
              </thead>
              <tbody>
                ${rejections.map(s => {
                  const r = s.lastRejection || {};
                  return `<tr>
                    <td class="font-semi text-brand">${Utils.escapeHtml(s.scrNumber || '—')}</td>
                    <td class="text-sm">${Utils.escapeHtml(s.department || '—')}</td>
                    <td class="text-sm">${Utils.escapeHtml(r.fromStageName || Utils.getStageName(s.currentStage) || '—')}</td>
                    <td class="text-sm">${Utils.escapeHtml(r.toStageName || (s.status === 'Rejected' ? 'Terminal' : '—'))}</td>
                    <td class="text-sm">${Utils.escapeHtml(r.by || s.rejectedBy || '—')}</td>
                    <td class="text-sm" style="max-width:320px">${Utils.escapeHtml(Utils.truncate(r.remarks || s.rejectionRemarks || '—', 80))}</td>
                    <td class="text-sm text-tertiary">${Utils.formatDate(r.at || s.rejectedAt || s.updatedAt)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>` : ''}

      <!-- Full SCR detail list (audit table) -->
      <div class="card mt-4">
        <div class="card-header">
          <h3 class="card-title">📋 SCR Audit Log (${scrs.length} records)</h3>
        </div>
        <div class="card-body">
          ${scrs.length === 0 ? '<p class="text-muted text-sm text-center p-4">No SCRs in this period</p>' : `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>SCR #</th><th>Date</th><th>Department</th><th>Module</th>
                    <th>Priority</th><th>Stage</th><th>Status</th><th>SLA</th>
                  </tr>
                </thead>
                <tbody>
                  ${scrs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(s => {
                    const sla = SLAEngine.calculate(s);
                    return `<tr>
                      <td class="font-semi text-brand">${Utils.escapeHtml(s.scrNumber || '—')}</td>
                      <td class="text-sm">${Utils.formatDate(s.createdAt)}</td>
                      <td class="text-sm">${Utils.escapeHtml(s.department || '—')}</td>
                      <td class="text-sm">${Utils.escapeHtml(Utils.truncate(s.moduleName || '—', 30))}</td>
                      <td>${Utils.priorityBadge(s.priority || s.intervention)}</td>
                      <td class="text-xs text-tertiary">${Utils.escapeHtml(Utils.getStageName(s.currentStage) || '—')}</td>
                      <td>${Utils.statusBadge(s.status)}</td>
                      <td class="text-xs">${Utils.escapeHtml(sla.label || '—')}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>

      <!-- Audit activity -->
      <div class="card mt-4">
        <div class="card-header">
          <h3 class="card-title">🔒 Audit Activity (${audit.length} entries)</h3>
        </div>
        <div class="card-body">
          ${audit.length === 0 ? '<p class="text-muted text-sm text-center p-4">No audit activity in this period</p>' : `
            <div class="table-container">
              <table class="data-table">
                <thead><tr><th>When</th><th>Entity</th><th>Action</th><th>By</th><th>Role</th></tr></thead>
                <tbody>
                  ${audit.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 200).map(e => `
                    <tr>
                      <td class="text-xs" style="font-family:monospace">${Utils.formatDateTime(e.timestamp)}</td>
                      <td class="text-sm">${Utils.escapeHtml(e.entityType || '—')}</td>
                      <td class="text-sm">${Utils.escapeHtml(e.action || '—')}</td>
                      <td class="text-sm">${Utils.escapeHtml(e.performedBy || '—')}</td>
                      <td class="text-xs text-tertiary">${Utils.escapeHtml(Utils.getRoleLabel(e.role) || '—')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${audit.length > 200 ? `<p class="text-xs text-muted text-center mt-3">Showing 200 of ${audit.length} — full audit available in Audit Trail page</p>` : ''}
            </div>
          `}
        </div>
      </div>

      <style>
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .card { border: 1px solid #ccc !important; box-shadow: none !important; break-inside: avoid; }
          .page-header { page-break-after: avoid; }
          .data-table { font-size: 10pt !important; }
        }
      </style>
    `;
  },

  // ── CSV Export ──────────────────────────────────────────
  downloadCSV() {
    const { from, to } = this.getRange();
    const scrs = this._scrsInRange();

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };

    const header = [
      'SCR Number', 'Request Date', 'Created At', 'Department', 'Module Name',
      'Request Type', 'Intervention', 'Priority', 'Status', 'Current Stage',
      'Requested By', 'Assigned Developer', 'Schedule Date', 'Completed On',
      'Approval Status', 'Rejected At Stage', 'Rejection Remarks',
      'Rejected By', 'Rejected Date', 'SLA Status', 'SLA Label'
    ];

    const rows = scrs.map(s => {
      const dev = s.assignedDeveloper ? Store.getById('users', s.assignedDeveloper) : null;
      const sla = SLAEngine.calculate(s);
      const r = s.lastRejection || {};
      return [
        s.scrNumber, s.scrDate, s.createdAt, s.department, s.moduleName,
        s.requestType, s.intervention || s.priority, s.priority, s.status,
        Utils.getStageName(s.currentStage),
        s.requestedBy, dev ? dev.name : '', s.scheduleDate, s.completedOn,
        s.approvalStatus, r.fromStageName || '', r.remarks || s.rejectionRemarks || '',
        r.by || s.rejectedBy || '', r.at || s.rejectedAt || '',
        sla.status, sla.label
      ].map(esc).join(',');
    });

    const csv = [header.join(','), ...rows].join('\r\n');
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    const filename = `SCR_Report_${this.period}_${fromStr}_to_${toStr}.csv`;

    this._download(csv, filename, 'text/csv;charset=utf-8');
    Utils.toast('success', 'CSV Downloaded', filename);
    Audit.log('System', 'report', 'Report Exported', 'CSV', null, `${this.period} report`);
  },

  _download(content, filename, mime) {
    // Prepend BOM so Excel opens UTF-8 correctly
    const blob = new Blob(['\uFEFF', content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
