/* ============================================================
   SCR MANAGEMENT SYSTEM — Workflow Engine (6-Stage)
   ============================================================ */

const Workflow = {
  // ── Stage rules ──────────────────────────────────────────
  // Stage 4 advance is handled exclusively by Approval.js (both AGM + CIO must approve)
  stageRules: {
    1: { name: 'Requirement Submission', advanceRoles: ['implementation', 'admin'], rejectRoles: [],                           requiredFields: ['description', 'department', 'intervention'] },
    2: { name: 'Implementation Review',  advanceRoles: ['implementation', 'admin'], rejectRoles: ['implementation', 'admin'], requiredFields: [] },
    3: { name: 'Project Head Review',    advanceRoles: ['project_head', 'admin'],   rejectRoles: ['project_head', 'admin'],   requiredFields: ['assignedDeveloper'] },
    4: { name: 'Management Approval',    advanceRoles: [],                          rejectRoles: ['agm_it', 'cio', 'admin'],  requiredFields: [] },
    5: { name: 'Development',            advanceRoles: ['developer', 'admin'],      rejectRoles: [],                          requiredFields: [] },
    6: { name: 'QA & Closure',           advanceRoles: ['implementation', 'admin'], rejectRoles: ['implementation', 'admin'], requiredFields: [] }
  },

  // Stage 4 is managed by approval.js; reject from stages 3/4 goes to 2; stage 6 reject goes to 5
  _rejectTarget: { 2: null, 3: 2, 4: 2, 6: 5 }, // null = terminal rejection

  // ── Check if user can advance stage ─────────────────────
  canAdvance(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    if (scr.currentStage >= 6) return false; // stage 6 close handled separately
    if (scr.currentStage === 4) return false; // stage 4 managed by approvals

    const rule = this.stageRules[scr.currentStage];
    return rule ? rule.advanceRoles.includes(user.role) : false;
  },

  // ── Check if user can close at stage 6 ──────────────────
  canClose(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.currentStage !== 6) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    const rule = this.stageRules[6];
    return rule.advanceRoles.includes(user.role);
  },

  // ── Check if user can reject current stage ───────────────
  canReject(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;

    const rule = this.stageRules[scr.currentStage];
    if (!rule || rule.rejectRoles.length === 0) return false;
    return rule.rejectRoles.includes(user.role);
  },

  // ── Validate required fields before advancing ────────────
  validateStage(scr) {
    const rule = this.stageRules[scr.currentStage];
    if (!rule) return { valid: true, missing: [] };

    const missing = rule.requiredFields.filter(field => !scr[field] || scr[field] === '');
    return { valid: missing.length === 0, missing };
  },

  // ── Advance to next stage ────────────────────────────────
  advanceStage(scrId, notes = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canAdvance(scr)) return { success: false, error: 'You do not have permission to advance this stage' };

    const validation = this.validateStage(scr);
    if (!validation.valid) return { success: false, error: `Missing required fields: ${validation.missing.join(', ')}` };

    const user = Auth.currentUser();
    const oldStage = scr.currentStage;
    const newStage = oldStage + 1;

    this._moveToStage(scrId, oldStage, newStage, user, notes || `Advanced by ${user.name}`, 'In Progress');

    Audit.log('SCR', scrId, 'Stage Advanced', 'currentStage', Utils.getStageName(oldStage), Utils.getStageName(newStage));

    const updatedScr = Store.getById('scr_requests', scrId);
    Notifications.notifyStageChange(updatedScr, oldStage, newStage);

    return { success: true, newStage };
  },

  // ── Close ticket at stage 6 (QA approved) ───────────────
  closeTicket(scrId) {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canClose(scr)) return { success: false, error: 'You do not have permission to close this ticket' };

    const user = Auth.currentUser();

    const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === 6 && !w.exitedAt);
    currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), action: 'Closed' }));

    Store.update('scr_requests', scrId, { status: 'Closed', completedOn: Utils.today() });

    Audit.log('SCR', scrId, 'Ticket Closed', 'status', 'In Progress', 'Closed', user.name, user.role);

    Notifications.create(scr.createdBy, `Your SCR ${scr.scrNumber} has been verified and closed`, 'status', scrId);
    if (scr.assignedDeveloper) {
      Notifications.create(scr.assignedDeveloper, `${scr.scrNumber} has been verified and closed by QA`, 'status', scrId);
    }
    Notifications.updateBadge();

    return { success: true };
  },

  // ── Reject stage — backward escalation with remarks ──────
  rejectStage(scrId, remarks = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canReject(scr)) return { success: false, error: 'You do not have permission to reject this stage' };
    if (!remarks.trim()) return { success: false, error: 'Rejection remarks are required' };

    const user = Auth.currentUser();
    const fromStage = scr.currentStage;
    const targetStage = this._rejectTarget[fromStage];

    // Build lastRejection object — written for every rejection for consistent tracking
    const rejectionRecord = {
      fromStage,
      fromStageName: Utils.getStageName(fromStage),
      toStage: targetStage,
      toStageName: targetStage ? Utils.getStageName(targetStage) : 'Terminal',
      remarks: remarks.trim(),
      by: user.name,
      byId: user.id,
      byRole: user.role,
      at: Utils.nowISO()
    };

    if (targetStage === null || targetStage === undefined) {
      // Terminal rejection (stage 2)
      const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === fromStage && !w.exitedAt);
      currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), action: 'Rejected', notes: remarks }));

      Store.update('scr_requests', scrId, {
        status: 'Rejected',
        rejectionRemarks: remarks,
        rejectedBy: user.name,
        rejectedAt: Utils.nowISO(),
        lastRejection: rejectionRecord
      });

      Audit.log('SCR', scrId, 'Rejected', 'status', 'In Progress', 'Rejected', user.name, user.role);

      Notifications.create(scr.createdBy, `Your SCR ${scr.scrNumber} has been rejected: ${remarks}`, 'status', scrId);
      Notifications.updateBadge();

      return { success: true, terminal: true };
    }

    // Backward escalation
    this._moveToStage(scrId, fromStage, targetStage, user, remarks, 'In Progress', true);

    // Always record lastRejection so it can be tracked on every screen
    Store.update('scr_requests', scrId, { lastRejection: rejectionRecord });

    Audit.log('SCR', scrId, 'Stage Rejected', 'currentStage', Utils.getStageName(fromStage), Utils.getStageName(targetStage), user.name, user.role);

    const updatedScr = Store.getById('scr_requests', scrId);
    Notifications.notifyRejection(updatedScr, fromStage, targetStage, remarks);

    return { success: true, targetStage, terminal: false };
  },

  // ── Internal: move SCR to a given stage ─────────────────
  _moveToStage(scrId, fromStage, toStage, user, notes, status, isRejection = false) {
    const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === fromStage && !w.exitedAt);
    currentWf.forEach(w => Store.update('workflow_stages', w.id, {
      exitedAt: Utils.nowISO(),
      action: isRejection ? 'Rejected' : 'Completed'
    }));

    Store.add('workflow_stages', {
      scrId,
      stage: toStage,
      enteredAt: Utils.nowISO(),
      exitedAt: null,
      performedBy: user.id,
      action: isRejection ? 'Returned' : 'In Progress',
      notes
    });

    Store.update('scr_requests', scrId, { currentStage: toStage, status });
  },

  // ── Stage advance labels (context-sensitive) ─────────────
  getAdvanceLabel(stage) {
    const labels = {
      1: 'Accept for Review →',
      2: 'Forward to Project Head →',
      3: 'Approve & Send for Management Approval →',
      5: 'Submit to QA →'
    };
    return labels[stage] || 'Advance Stage →';
  },

  // ── Render pipeline visualization ────────────────────────
  renderPipeline(scr) {
    const stages = Utils.stages;
    let html = '<div class="pipeline">';

    stages.forEach((stage, idx) => {
      const stageNum = stage.id;
      let stateClass = 'pending';

      if (stageNum < scr.currentStage) {
        stateClass = 'completed';
      } else if (stageNum === scr.currentStage) {
        stateClass = scr.status === 'Rejected' ? 'rejected' : 'current';
      }

      html += `
        <div class="pipeline-stage ${stateClass}" data-tooltip="${stage.name}">
          <span class="stage-dot"></span>
          <span>${stage.short}</span>
        </div>
      `;

      if (idx < stages.length - 1) {
        html += `<div class="pipeline-connector ${stageNum < scr.currentStage ? 'completed' : ''}"></div>`;
      }
    });

    html += '</div>';
    return html;
  },

  // ── Render stage history ────────────────────────────────
  renderHistory(scrId) {
    const entries = Store.filter('workflow_stages', w => w.scrId === scrId)
      .sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));

    if (entries.length === 0) return '<p class="text-muted text-sm">No workflow history</p>';

    return `
      <div class="timeline">
        ${entries.map(entry => {
          const stage = Utils.stages.find(s => s.id === entry.stage);
          const user = Store.getById('users', entry.performedBy);
          const isCompleted = !!entry.exitedAt;
          const isRejected = entry.action === 'Rejected' || entry.action === 'Returned';

          return `
            <div class="timeline-item">
              <div class="timeline-dot ${isCompleted ? (isRejected ? 'danger' : 'success') : ''}"></div>
              <div class="timeline-content">
                <div class="timeline-title">${stage ? Utils.escapeHtml(stage.name) : `Stage ${entry.stage}`}
                  ${isRejected ? '<span class="badge badge-danger" style="font-size:10px;margin-left:4px">Returned</span>' : ''}
                </div>
                <div class="timeline-text">
                  ${Utils.escapeHtml(entry.action || '')} ${user ? `by ${Utils.escapeHtml(user.name)}` : '<span class="text-muted">(user unavailable)</span>'}
                  <br>Entered: ${Utils.formatDateTime(entry.enteredAt)}
                  ${entry.exitedAt ? `<br>Exited: ${Utils.formatDateTime(entry.exitedAt)}` : ' — In Progress'}
                  ${entry.notes ? `<br><em style="color:var(--color-text-tertiary)">${Utils.escapeHtml(entry.notes)}</em>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
};
