/* ============================================================
   SCR MANAGEMENT SYSTEM — Workflow Engine (7-Stage)
   ============================================================ */

const Workflow = {
  // ── Stage transition rules ──────────────────────────────
  stageRules: {
    1: { name: 'Requirement Submission', advanceRoles: ['it_coordinator', 'project_head', 'admin'], requiredFields: ['description', 'department', 'priority'] },
    2: { name: 'Ticket Raised', advanceRoles: ['it_coordinator', 'project_head', 'admin'], requiredFields: [] },
    3: { name: 'Initial Review', advanceRoles: ['it_coordinator', 'project_head', 'admin'], requiredFields: ['assignedTeam'] },
    4: { name: 'R&D Analysis', advanceRoles: ['project_head', 'developer', 'implementation', 'admin'], requiredFields: ['studyDate'] },
    5: { name: 'Development', advanceRoles: ['developer', 'implementation', 'project_head', 'admin'], requiredFields: ['assignedDeveloper', 'scheduleDate'] },
    6: { name: 'SCR Completion', advanceRoles: ['developer', 'project_head', 'admin'], requiredFields: [] },
    7: { name: 'Approval', advanceRoles: ['cio', 'agm_it', 'project_head', 'admin'], requiredFields: [] }
  },

  // ── Check if user can advance stage ─────────────────────
  canAdvance(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    if (scr.currentStage >= 7) return false;

    const rule = this.stageRules[scr.currentStage];
    if (!rule) return false;
    return rule.advanceRoles.includes(user.role);
  },

  // ── Validate stage requirements ─────────────────────────
  validateStage(scr) {
    const rule = this.stageRules[scr.currentStage];
    if (!rule) return { valid: true, missing: [] };

    const missing = [];
    rule.requiredFields.forEach(field => {
      if (!scr[field] || scr[field] === '') {
        missing.push(field);
      }
    });

    return { valid: missing.length === 0, missing };
  },

  // ── Advance to next stage ───────────────────────────────
  advanceStage(scrId, notes = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };

    if (!this.canAdvance(scr)) {
      return { success: false, error: 'You don\'t have permission to advance this stage' };
    }

    const validation = this.validateStage(scr);
    if (!validation.valid) {
      return { success: false, error: `Missing required fields: ${validation.missing.join(', ')}` };
    }

    const user = Auth.currentUser();
    const oldStage = scr.currentStage;
    const newStage = oldStage + 1;

    // Close current stage in workflow log
    const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === oldStage && !w.exitedAt);
    currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), action: 'Completed' }));

    // Create new stage entry
    Store.add('workflow_stages', {
      scrId,
      stage: newStage,
      enteredAt: Utils.nowISO(),
      exitedAt: null,
      performedBy: user.id,
      action: 'In Progress',
      notes: notes || `Advanced by ${user.name}`
    });

    // Update SCR
    const newStatus = newStage === 7 ? 'Completed' : 'In Progress';
    Store.update('scr_requests', scrId, {
      currentStage: newStage,
      status: newStatus
    });

    // Audit
    Audit.log('SCR', scrId, 'Stage Advanced', 'currentStage', Utils.getStageName(oldStage), Utils.getStageName(newStage));

    // Notifications
    const updatedScr = Store.getById('scr_requests', scrId);
    Notifications.notifyStageChange(updatedScr, Utils.getStageName(newStage));

    if (newStage === 7) {
      Notifications.notifyApprovalNeeded(updatedScr);
    }

    return { success: true, newStage };
  },

  // ── Render pipeline visualization ───────────────────────
  renderPipeline(scr) {
    const stages = Utils.stages;
    let html = '<div class="pipeline">';

    stages.forEach((stage, idx) => {
      const stageNum = stage.id;
      let stateClass = 'pending';
      let icon = '○';

      if (stageNum < scr.currentStage) {
        stateClass = 'completed';
        icon = '✓';
      } else if (stageNum === scr.currentStage) {
        stateClass = 'current';
        icon = '●';
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
      .sort((a, b) => a.stage - b.stage);

    if (entries.length === 0) return '<p class="text-muted text-sm">No workflow history</p>';

    return `
      <div class="timeline">
        ${entries.map(entry => {
          const stage = Utils.stages.find(s => s.id === entry.stage);
          const user = Store.getById('users', entry.performedBy);
          const isCompleted = !!entry.exitedAt;

          return `
            <div class="timeline-item">
              <div class="timeline-dot ${isCompleted ? 'success' : ''}"></div>
              <div class="timeline-content">
                <div class="timeline-title">${stage ? stage.name : `Stage ${entry.stage}`}</div>
                <div class="timeline-text">
                  ${entry.action} ${user ? `by ${user.name}` : ''}
                  <br>
                  Entered: ${Utils.formatDateTime(entry.enteredAt)}
                  ${entry.exitedAt ? `<br>Completed: ${Utils.formatDateTime(entry.exitedAt)}` : ' — In Progress'}
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
