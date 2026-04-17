/* ============================================================
   SCR MANAGEMENT SYSTEM — Approval System (Stage 4: MGT Approval)
   Both AGM-IT and CIO must approve before advancing to Development.
   Either rejecting sends the SCR back to Stage 2 (Implementation Review).
   ============================================================ */

const Approval = {
  // Stage 4 approval chain — both required
  approvalChain: ['agm_it', 'cio'],

  getForSCR(scrId) {
    return Store.filter('approvals', a => a.scrId === scrId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },

  // Can current user submit a decision at Stage 4?
  canApprove(scrId) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (!Auth.canPerformAction('approve')) return false;

    const scr = Store.getById('scr_requests', scrId);
    if (!scr || scr.currentStage !== 4) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    if (!this.approvalChain.includes(user.role)) return false;

    // Already decided?
    const existing = Store.filter('approvals', a => a.scrId === scrId && a.approverRole === user.role);
    return existing.length === 0;
  },

  // Both AGM and CIO have approved?
  _bothApproved(scrId) {
    return this.approvalChain.every(role => {
      const decision = Store.filter('approvals', a => a.scrId === scrId && a.approverRole === role);
      return decision.length > 0 && decision[decision.length - 1].decision === 'Approved';
    });
  },

  submitDecision(scrId, decision, comments) {
    const user = Auth.currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };
    if (!comments || !comments.trim()) return { success: false, error: 'Comments are required' };

    if (!this.canApprove(scrId)) return { success: false, error: 'You cannot submit a decision for this SCR' };

    Store.add('approvals', {
      scrId,
      approverRole: user.role,
      approverName: user.name,
      decision,
      comments: comments.trim(),
      timestamp: Utils.nowISO()
    });

    Audit.log('SCR', scrId, decision, 'decision', null, decision, user.name, user.role);

    const scr = Store.getById('scr_requests', scrId);

    if (decision === 'Rejected') {
      // Rejection from either manager → back to Stage 2 with remarks
      const fromStage = 4;
      const toStage = 2;

      const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === fromStage && !w.exitedAt);
      currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), action: 'Rejected', notes: comments.trim() }));

      Store.add('workflow_stages', {
        scrId, stage: toStage,
        enteredAt: Utils.nowISO(), exitedAt: null,
        performedBy: user.id, action: 'Returned',
        notes: `Rejected by ${user.name} (${Utils.getRoleLabel(user.role)}): ${comments.trim()}`
      });

      Store.update('scr_requests', scrId, { currentStage: toStage, status: 'In Progress' });

      Audit.log('SCR', scrId, 'Stage Rejected', 'currentStage', Utils.getStageName(4), Utils.getStageName(2), user.name, user.role);

      // Notify implementation team
      const implUsers = Store.filter('users', u => u.role === 'implementation');
      implUsers.forEach(u => Notifications.create(u.id, `${scr.scrNumber} rejected at Management Approval by ${user.name} — returned to Implementation Review`, 'status', scrId));

    } else if (decision === 'Approved') {
      if (this._bothApproved(scrId)) {
        // Both approved — advance to Stage 5 (Development)
        const fromStage = 4;
        const toStage = 5;

        const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === fromStage && !w.exitedAt);
        currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), action: 'Approved' }));

        Store.add('workflow_stages', {
          scrId, stage: toStage,
          enteredAt: Utils.nowISO(), exitedAt: null,
          performedBy: user.id, action: 'In Progress',
          notes: 'Management approval complete — assigned to Development'
        });

        Store.update('scr_requests', scrId, { currentStage: toStage, status: 'In Progress' });

        Audit.log('SCR', scrId, 'Stage Advanced', 'currentStage', Utils.getStageName(4), Utils.getStageName(5), user.name, user.role);

        // Notify developer(s)
        if (scr.assignedDeveloper) {
          Notifications.create(scr.assignedDeveloper, `${scr.scrNumber} has been approved by management — ready for development`, 'assignment', scrId);
        }
        if (scr.assignedDeveloper2) {
          Notifications.create(scr.assignedDeveloper2, `${scr.scrNumber} has been approved by management — ready for development`, 'assignment', scrId);
        }
      } else {
        // First approval received — notify the other approver
        const nextRole = this.approvalChain.find(r => r !== user.role);
        const nextUsers = Store.filter('users', u => u.role === nextRole);
        nextUsers.forEach(u => Notifications.create(u.id, `${scr.scrNumber} approved by ${user.name} — awaiting your approval`, 'approval', scrId));
      }
    }

    Notifications.updateBadge();
    return { success: true };
  },

  handleDecision(scrId, decision) {
    const comments = document.getElementById('approval-comments')?.value || '';
    const result = this.submitDecision(scrId, decision, comments);
    if (result.success) {
      Utils.toast('success', `Decision Recorded`, `SCR ${decision}.`);
      Router.navigate('scr-detail', { id: scrId });
    } else {
      Utils.toast('error', 'Error', result.error);
    }
  },

  // Render approval panel inside SCR detail (only visible at Stage 4)
  renderForSCR(scrId) {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr || scr.currentStage !== 4) return '';

    const approvals = this.getForSCR(scrId);
    const canApprove = this.canApprove(scrId);
    let html = '';

    // Existing decisions
    approvals.forEach(a => {
      const icons = { 'Approved': '✓', 'Rejected': '✕' };
      const color = a.decision === 'Approved' ? 'success' : 'danger';
      html += `
        <div class="approval-card">
          <div class="approval-status-icon ${a.decision.toLowerCase()}">${icons[a.decision] || '?'}</div>
          <div class="approval-info">
            <div class="approval-role">${Utils.getRoleLabel(a.approverRole)}</div>
            <div class="approval-name">${Utils.escapeHtml(a.approverName)}</div>
            <div class="approval-comment">"${Utils.escapeHtml(a.comments)}"</div>
            <div class="approval-time">${Utils.formatDateTime(a.timestamp)}</div>
          </div>
          <div>${Utils.badgeHtml(a.decision, color)}</div>
        </div>
      `;
    });

    // Pending slots
    this.approvalChain.forEach(role => {
      if (!approvals.find(a => a.approverRole === role)) {
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

    // Decision form for current user
    if (canApprove) {
      html += `
        <div class="card mt-4" style="border-color:var(--color-primary);border-width:2px">
          <div class="card-header"><h4 class="card-title">📝 Your Decision</h4></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Comments <span class="required">*</span></label>
              <textarea id="approval-comments" class="form-textarea" placeholder="Enter your review comments..." rows="3"></textarea>
            </div>
            <div class="flex gap-3">
              <button class="btn btn-success" onclick="Approval.handleDecision('${scrId}', 'Approved')">✓ Approve</button>
              <button class="btn btn-danger"  onclick="Approval.handleDecision('${scrId}', 'Rejected')">✕ Reject</button>
            </div>
          </div>
        </div>
      `;
    }

    return html || '<p class="text-muted text-sm">No decisions yet</p>';
  },

  // Approvals list page — SCRs at Stage 4 pending current user's decision
  renderList() {
    const user = Auth.currentUser();
    const allSCRs = Store.getAll('scr_requests');

    const pending = allSCRs.filter(scr => {
      if (scr.currentStage !== 4) return false;
      if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
      if (!this.approvalChain.includes(user.role)) return false;
      const userApproval = Store.filter('approvals', a => a.scrId === scr.id && a.approverRole === user.role);
      return userApproval.length === 0;
    });

    const recentDecisions = Store.getAll('approvals')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Management Approvals</h2>
          <p class="page-description">SCRs awaiting AGM-IT and CIO approval (both required)</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="Approval.switchTab('pending', this)">Pending (${pending.length})</button>
        <button class="tab" onclick="Approval.switchTab('history', this)">Decision History</button>
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
                      ${Utils.priorityBadge(scr.priority || scr.intervention)}
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
                <tr><th>SCR</th><th>Decision</th><th>By</th><th>Role</th><th>Comments</th><th>Date</th></tr>
              </thead>
              <tbody>
                ${recentDecisions.map(a => {
                  const scr = Store.getById('scr_requests', a.scrId);
                  return `
                    <tr style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${a.scrId}'})">
                      <td class="font-medium text-brand">${scr ? scr.scrNumber : a.scrId}</td>
                      <td>${Utils.badgeHtml(a.decision, a.decision === 'Approved' ? 'success' : 'danger')}</td>
                      <td>${Utils.escapeHtml(a.approverName)}</td>
                      <td class="text-sm">${Utils.getRoleLabel(a.approverRole)}</td>
                      <td class="text-sm text-secondary">${Utils.truncate(a.comments, 50)}</td>
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

  switchTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('approval-tab-pending').classList.toggle('hidden', tab !== 'pending');
    document.getElementById('approval-tab-history').classList.toggle('hidden', tab !== 'history');
  }
};
