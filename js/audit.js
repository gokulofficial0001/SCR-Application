/* ============================================================
   SCR MANAGEMENT SYSTEM — Audit Trail
   ============================================================ */

const Audit = {
  // ── Log an action ───────────────────────────────────────
  log(entityType, entityId, action, field, oldValue, newValue, performedBy, role) {
    const entry = {
      id: Utils.generateId(),
      entityType,
      entityId,
      action,
      field,
      oldValue: oldValue ? String(oldValue) : null,
      newValue: newValue ? String(newValue) : null,
      performedBy: performedBy || Auth.currentUser()?.name || 'System',
      role: role || Auth.currentUser()?.role || 'system',
      timestamp: Utils.nowISO()
    };
    Store.add('audit_log', entry);
    return entry;
  },

  // ── Get logs for entity ─────────────────────────────────
  getForEntity(entityType, entityId) {
    return Store.filter('audit_log', l => l.entityType === entityType && l.entityId === entityId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // ── Render audit log page ──────────────────────────────
  renderLog() {
    const logs = Store.getAll('audit_log').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">Audit Trail</h2>
          </div>
          <p class="page-description">Complete system activity log for NABH compliance</p>
        </div>
        <div style="display:flex;gap:var(--space-3)">
          <div class="search-bar">
            <span class="search-icon">🔍</span>
            <input type="text" class="form-input" placeholder="Search audit log..." oninput="Audit.filterLog(this.value)">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" id="audit-log-body">
          ${logs.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <h3 class="empty-state-title">No Audit Entries</h3>
              <p class="empty-state-text">System activity will be logged here</p>
            </div>
          ` : `
            <div class="table-container">
              <table class="data-table" id="audit-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                    <th>User</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  ${logs.map(log => `
                    <tr class="audit-row">
                      <td><span class="text-xs" style="font-family:monospace">${Utils.formatDateTime(log.timestamp)}</span></td>
                      <td>${Audit.actionBadge(log.action)}</td>
                      <td>
                        <span class="text-sm font-medium">${Utils.escapeHtml(log.entityType)}</span>
                        ${log.entityId ? `<br><span class="text-xs text-tertiary">${Utils.escapeHtml(log.entityId)}</span>` : ''}
                      </td>
                      <td>
                        ${log.field ? `
                          <span class="text-sm">${Utils.escapeHtml(log.field)}: 
                          <span class="text-danger">${Utils.escapeHtml(log.oldValue || '—')}</span> → 
                          <span class="text-success">${Utils.escapeHtml(log.newValue || '—')}</span></span>
                        ` : '<span class="text-muted text-sm">—</span>'}
                      </td>
                      <td class="text-sm">${Utils.escapeHtml(log.performedBy)}</td>
                      <td>${Utils.badgeHtml(Utils.getRoleLabel(log.role), 'neutral')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  },

  // ── Action badge color ──────────────────────────────────
  actionBadge(action) {
    const colors = {
      'Created': 'success', 'Login': 'primary', 'Logout': 'neutral',
      'Stage Advanced': 'info', 'Approved': 'success', 'Rejected': 'danger',
      'Status Changed': 'warning', 'Updated': 'primary', 'Deleted': 'danger',
      'Hold': 'warning', 'Assigned': 'info'
    };
    return Utils.badgeHtml(action, colors[action] || 'neutral');
  },

  // ── Filter ──────────────────────────────────────────────
  filterLog(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#audit-table tbody .audit-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  },

  // ── Render timeline for SCR detail ──────────────────────
  renderTimeline(scrId) {
    const logs = this.getForEntity('SCR', scrId);
    if (logs.length === 0) return '<p class="text-muted text-sm">No activity recorded</p>';

    return `
      <div class="timeline">
        ${logs.map(log => `
          <div class="timeline-item">
            <div class="timeline-dot ${log.action === 'Approved' ? 'success' : log.action === 'Rejected' ? 'danger' : ''}"></div>
            <div class="timeline-content">
              <div class="timeline-title">${Utils.escapeHtml(log.action)}${log.field ? ` — ${Utils.escapeHtml(log.field)}` : ''}</div>
              <div class="timeline-text">
                ${log.oldValue ? `${Utils.escapeHtml(log.oldValue)} → ${Utils.escapeHtml(log.newValue)}` : ''}
                <br>by ${Utils.escapeHtml(log.performedBy)} · ${Utils.formatTimeAgo(log.timestamp)}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
};
