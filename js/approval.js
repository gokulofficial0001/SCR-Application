/* ============================================================
   SCR MANAGEMENT SYSTEM — Approval System
   ============================================================ */

const Approval = {
  // ── Approval chain ──────────────────────────────────────
  approvalChain: ['project_head', 'agm_it', 'cio'],

  // ── Get approvals for SCR ───────────────────────────────
  getForSCR(scrId) {
    return Store.filter('approvals', a => a.scrId === scrId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  // ── Check if user can approve ───────────────────────────
  canApprove(scrId) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (!Auth.canPerformAction('approve')) return false;

    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return false;
    if (scr.currentStage < 6) return false; // Must be at completion or approval stage

    // Check if already approved by this role
    const existing = Store.filter('approvals', a => a.scrId === scrId && a.approverRole === user.role);
    if (existing.length > 0) return false;

    return true;
  },

  // ── Submit approval decision ────────────────────────────
  submitDecision(scrId, decision, comments) {
    const user = Auth.currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    if (!comments || comments.trim() === '') {
      return { success: false, error: 'Comments are required' };
    }

    const approval = Store.add('approvals', {
      scrId,
      approverRole: user.role,
      approverName: user.name,
      decision,
      comments: comments.trim(),
      timestamp: Utils.nowISO()
    });

    // Audit
    Audit.log('SCR', scrId, decision, 'decision', null, decision, user.name, user.role);

    // Handle decision
    const scr = Store.getById('scr_requests', scrId);
    if (decision === 'Rejected') {
      Store.update('scr_requests', scrId, { status: 'Rejected' });
      Audit.log('SCR', scrId, 'Status Changed', 'status', scr.status, 'Rejected');
    } else if (decision === 'Hold') {
      Store.update('scr_requests', scrId, { status: 'On Hold' });
      Audit.log('SCR', scrId, 'Status Changed', 'status', scr.status, 'On Hold');
    } else if (decision === 'Approved') {
      // Check if final approval (CIO)
      if (user.role === 'cio') {
        Store.update('scr_requests', scrId, { status: 'Closed', completionDate: Utils.today() });
        Audit.log('SCR', scrId, 'Status Changed', 'status', scr.status, 'Closed');
        // Notify
        if (scr.assignedDeveloper) {
          Notifications.create(scr.assignedDeveloper, `${scr.scrNumber} has been approved and closed by CIO`, 'approval', scrId);
        }
        Notifications.create(scr.createdBy, `Your SCR ${scr.scrNumber} has been approved and closed`, 'approval', scrId);
      } else {
        // Notify next approver
        const nextIdx = this.approvalChain.indexOf(user.role) + 1;
        if (nextIdx < this.approvalChain.length) {
          const nextRole = this.approvalChain[nextIdx];
          const nextUsers = Store.filter('users', u => u.role === nextRole);
          nextUsers.forEach(u => {
            Notifications.create(u.id, `${scr.scrNumber} is awaiting your approval (approved by ${user.name})`, 'approval', scrId);
          });
        }
      }
    }

    Notifications.updateBadge();
    return { success: true, approval };
  },

  // ── Render approval section for SCR detail ──────────────
  renderForSCR(scrId) {
    const approvals = this.getForSCR(scrId);
    const canApprove = this.canApprove(scrId);

    let html = '';

    // Existing approvals
    if (approvals.length > 0) {
      html += approvals.map(a => {
        const icons = { 'Approved': '✓', 'Rejected': '✕', 'Hold': '⏸' };
        const statusClass = a.decision.toLowerCase();
        return `
          <div class="approval-card">
            <div class="approval-status-icon ${statusClass}">
              ${icons[a.decision] || '?'}
            </div>
            <div class="approval-info">
              <div class="approval-role">${Utils.getRoleLabel(a.approverRole)}</div>
              <div class="approval-name">${Utils.escapeHtml(a.approverName)}</div>
              <div class="approval-comment">"${Utils.escapeHtml(a.comments)}"</div>
              <div class="approval-time">${Utils.formatDateTime(a.timestamp)}</div>
            </div>
            <div>${Utils.badgeHtml(a.decision, a.decision === 'Approved' ? 'success' : a.decision === 'Rejected' ? 'danger' : 'warning')}</div>
          </div>
        `;
      }).join('');
    }

    // Pending approvals in chain
    this.approvalChain.forEach(role => {
      const existing = approvals.find(a => a.approverRole === role);
      if (!existing) {
        html += `
          <div class="approval-card" style="opacity:0.5">
            <div class="approval-status-icon pending">⏳</div>
            <div class="approval-info">
              <div class="approval-role">${Utils.getRoleLabel(role)}</div>
              <div class="approval-name">Pending</div>
            </div>
            <div>${Utils.badgeHtml('Pending', 'neutral')}</div>
          </div>
        `;
      }
    });

    // Approval form
    if (canApprove) {
      html += `
        <div class="card mt-4" style="border-color:var(--color-primary);border-width:2px">
          <div class="card-header">
            <h4 class="card-title">📝 Your Decision</h4>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Comments <span class="required">*</span></label>
              <textarea id="approval-comments" class="form-textarea" placeholder="Enter your review comments..." rows="3"></textarea>
            </div>
            <div class="flex gap-3">
              <button class="btn btn-success" onclick="Approval.handleDecision('${scrId}', 'Approved')">✓ Approve</button>
              <button class="btn btn-warning" onclick="Approval.handleDecision('${scrId}', 'Hold')">⏸ Hold</button>
              <button class="btn btn-danger" onclick="Approval.handleDecision('${scrId}', 'Rejected')">✕ Reject</button>
            </div>
          </div>
        </div>
      `;
    }

    return html || '<p class="text-muted text-sm">No approvals yet</p>';
  },

  // ── Handle approval decision ────────────────────────────
  handleDecision(scrId, decision) {
    const comments = document.getElementById('approval-comments')?.value;
    const result = this.submitDecision(scrId, decision, comments);
    if (result.success) {
      Utils.toast('success', `SCR ${decision}`, `Your decision has been recorded.`);
      Router.navigate('scr-detail', { id: scrId });
    } else {
      Utils.toast('error', 'Error', result.error);
    }
  },

  // ── Render approvals list page ──────────────────────────
  renderList() {
    const user = Auth.currentUser();
    const allSCRs = Store.getAll('scr_requests');

    // SCRs awaiting approval (stage 6 or 7)
    const pending = allSCRs.filter(scr => {
      if (scr.currentStage < 6) return false;
      if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
      // Check if current user hasn't approved yet
      const userApproval = Store.filter('approvals', a => a.scrId === scr.id && a.approverRole === user.role);
      return userApproval.length === 0;
    });

    // Recent decisions
    const recentDecisions = Store.getAll('approvals')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Approvals</h2>
          <p class="page-description">Review and approve completed SCRs</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="Approval.switchTab('pending', this)">Pending (${pending.length})</button>
        <button class="tab" onclick="Approval.switchTab('history', this)">Recent Decisions</button>
      </div>

      <div id="approval-tab-pending">
        ${pending.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <h3 class="empty-state-title">All caught up!</h3>
            <p class="empty-state-text">No SCRs awaiting your approval</p>
          </div>
        ` : `
          <div class="stagger-children">
            ${pending.map(scr => `
              <div class="card mb-3" style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-3 mb-2">
                      <span class="font-bold text-brand">${scr.scrNumber}</span>
                      ${Utils.priorityBadge(scr.priority)}
                      ${Utils.statusBadge(scr.status)}
                    </div>
                    <p class="text-secondary text-sm">${Utils.truncate(scr.description, 100)}</p>
                    <p class="text-tertiary text-xs mt-1">${scr.department} · ${Utils.formatDate(scr.createdAt)}</p>
                  </div>
                  <button class="btn btn-primary btn-sm">Review →</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <div id="approval-tab-history" class="hidden">
        ${recentDecisions.length === 0 ? `
          <p class="text-muted text-center p-8">No decisions yet</p>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>SCR</th>
                  <th>Decision</th>
                  <th>By</th>
                  <th>Role</th>
                  <th>Comments</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${recentDecisions.map(a => {
                  const scr = Store.getById('scr_requests', a.scrId);
                  return `
                    <tr style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${a.scrId}'})">
                      <td class="font-medium text-brand">${scr ? scr.scrNumber : a.scrId}</td>
                      <td>${Utils.badgeHtml(a.decision, a.decision === 'Approved' ? 'success' : a.decision === 'Rejected' ? 'danger' : 'warning')}</td>
                      <td>${Utils.escapeHtml(a.approverName)}</td>
                      <td class="text-sm">${Utils.getRoleLabel(a.approverRole)}</td>
                      <td class="text-sm text-secondary">${Utils.truncate(a.comments, 40)}</td>
                      <td class="text-sm">${Utils.formatDate(a.timestamp)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  },

  // ── Tab switching ───────────────────────────────────────
  switchTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('approval-tab-pending').classList.toggle('hidden', tab !== 'pending');
    document.getElementById('approval-tab-history').classList.toggle('hidden', tab !== 'history');
  }
};
