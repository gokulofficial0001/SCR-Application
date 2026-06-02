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

  // Stage 4 is managed by approval.js; reject from stages 3/4 goes to 2; stage 5 reject goes to 4; stage 6 reject goes to 5
  _rejectTarget: { 2: null, 3: 2, 4: 2, 5: 4, 6: 5 }, // null = terminal rejection

  // ── Roles that can place an SCR on Hold at each stage ───
  // Mirrors the action roles for that stage (anyone who can act on
  // it can also pause it). Admin always allowed via canPerformAction.
  holdRoles: {
    2: ['implementation'],
    3: ['project_head'],
    4: ['agm_it', 'cio']
  },

  // ── Check if user can advance stage ─────────────────────
  canAdvance(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    if (scr.status === 'On Hold') return false;  // must be resumed first
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
    if (scr.status === 'On Hold') return false;
    const rule = this.stageRules[6];
    return rule.advanceRoles.includes(user.role);
  },

  // ── Check if user can reject current stage ───────────────
  canReject(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected') return false;
    if (scr.status === 'On Hold') return false;  // must be resumed first

    const rule = this.stageRules[scr.currentStage];
    if (!rule || rule.rejectRoles.length === 0) return false;
    return rule.rejectRoles.includes(user.role);
  },

  // ── Check if user can place SCR on Hold ─────────────────
  // Allowed at the action stages (2, 3, 4) for the role that owns
  // that stage, plus admin. Already-held / closed / rejected blocked.
  canHold(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status === 'Closed' || scr.status === 'Rejected' || scr.status === 'On Hold') return false;
    if (!Auth.canPerformAction('hold')) return false;
    const allowedRoles = this.holdRoles[scr.currentStage] || [];
    return user.role === 'admin' || allowedRoles.includes(user.role);
  },

  // ── Check if user can resume a held SCR ─────────────────
  // Same roles that could have held it (so PH can resume what PH held,
  // etc.) plus admin override.
  canResume(scr) {
    const user = Auth.currentUser();
    if (!user) return false;
    if (scr.status !== 'On Hold') return false;
    if (!Auth.canPerformAction('hold')) return false;
    const allowedRoles = this.holdRoles[scr.currentStage] || [];
    return user.role === 'admin' || allowedRoles.includes(user.role);
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

    if (!Number.isInteger(scr.currentStage) || scr.currentStage < 1 || scr.currentStage > 6) {
      console.error('Invalid currentStage for SCR', scr.id, ':', scr.currentStage);
      throw new Error('Invalid SCR stage: ' + scr.currentStage);
    }

    // Workflow gates — defense in depth alongside the UI gating
    if (scr.currentStage === 3 && !scr.phAcceptedBy) {
      return { success: false, error: 'Project Head must Accept for Review before advancing to Management Approval.' };
    }
    if (scr.currentStage === 5 && !scr.acknowledgedBy) {
      return { success: false, error: 'Developer must Acknowledge the assignment before submitting to QA.' };
    }

    const validation = this.validateStage(scr);
    if (!validation.valid) return { success: false, error: `Missing required fields: ${validation.missing.join(', ')}` };

    const user = Auth.currentUser();
    const oldStage = scr.currentStage;
    const newStage = oldStage + 1;

    const moveResult = this._moveToStage(scrId, oldStage, newStage, user, notes || `Advanced by ${user.name}`, 'In Progress', false, scr.updatedAt);
    if (moveResult && moveResult.conflict) {
      return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
    }

    // Auto-stamp "Received By" when the implementation team accepts the
    // request (stage 1 → 2). Only fills if currently empty so a manually
    // entered name (rare, but possible if impl team created the SCR) is
    // preserved. This is the moment IT formally takes ownership.
    if (oldStage === 1 && newStage === 2 && !scr.receivedBy) {
      // Re-fetch so updatedAt reflects the _moveToStage write above
      const scrAfterMove = Store.getById('scr_requests', scrId);
      Store.update('scr_requests', scrId, { receivedBy: user.name, _expectedUpdatedAt: scrAfterMove ? scrAfterMove.updatedAt : undefined });
      Audit.log('SCR', scrId, 'Auto-filled', 'receivedBy', null, user.name);
    }

    // Auto-stamp "Project Head" with the actual reviewer's name when
    // they advance stage 3 → 4. The form's projectHeadName field gets a
    // hard-coded default ("Ms. Deepa S") at SCR creation; without this
    // override, the Management Approval card would always show that
    // default even if a different PH (e.g. Mr. Panneer Selvan) reviewed.
    if (oldStage === 3 && newStage === 4 && user.role === 'project_head') {
      const oldName = scr.projectHeadName || '';
      if (oldName !== user.name) {
        // Re-fetch so updatedAt reflects the _moveToStage write above
        const scrAfterMove = Store.getById('scr_requests', scrId);
        Store.update('scr_requests', scrId, { projectHeadName: user.name, _expectedUpdatedAt: scrAfterMove ? scrAfterMove.updatedAt : undefined });
        Audit.log('SCR', scrId, 'Auto-filled', 'projectHeadName', oldName, user.name);
      }
    }

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

    if (!Number.isInteger(scr.currentStage) || scr.currentStage < 1 || scr.currentStage > 6) {
      console.error('Invalid currentStage for SCR', scr.id, ':', scr.currentStage);
      throw new Error('Invalid SCR stage: ' + scr.currentStage);
    }

    const user = Auth.currentUser();

    const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === 6 && !w.exitedAt);
    currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), exitedBy: user.id, action: 'Closed' }));

    const closeResult = Store.update('scr_requests', scrId, { status: 'Closed', completedOn: Utils.today(), _expectedUpdatedAt: scr.updatedAt });
    if (closeResult && closeResult.conflict) {
      return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
    }

    Audit.log('SCR', scrId, 'Ticket Closed', 'status', 'In Progress', 'Closed', user.name, user.role);

    Notifications.create(scr.createdBy, `Your SCR ${scr.scrNumber} has been verified and closed`, 'status', scrId);
    const closeMsg = `${scr.scrNumber} has been verified and closed by QA`;
    if (scr.assignedDeveloper)  Notifications.create(scr.assignedDeveloper,  closeMsg, 'status', scrId);
    if (scr.assignedDeveloper2) Notifications.create(scr.assignedDeveloper2, closeMsg, 'status', scrId);
    Notifications.updateBadge();

    return { success: true };
  },

  // ── Reject stage — backward escalation with remarks ──────
  rejectStage(scrId, remarks = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canReject(scr)) return { success: false, error: 'You do not have permission to reject this stage' };
    if (!remarks.trim()) return { success: false, error: 'Rejection remarks are required' };

    if (!Number.isInteger(scr.currentStage) || scr.currentStage < 1 || scr.currentStage > 6) {
      console.error('Invalid currentStage for SCR', scr.id, ':', scr.currentStage);
      throw new Error('Invalid SCR stage: ' + scr.currentStage);
    }

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
      currentWf.forEach(w => Store.update('workflow_stages', w.id, { exitedAt: Utils.nowISO(), exitedBy: user.id, action: 'Rejected', notes: remarks }));

      const terminalResult = Store.update('scr_requests', scrId, {
        status: 'Rejected',
        rejectionRemarks: remarks,
        rejectedBy: user.name,
        rejectedAt: Utils.nowISO(),
        lastRejection: rejectionRecord,
        _expectedUpdatedAt: scr.updatedAt
      });
      if (terminalResult && terminalResult.conflict) {
        return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
      }

      Audit.log('SCR', scrId, 'Rejected', 'status', 'In Progress', 'Rejected', user.name, user.role);

      Notifications.create(scr.createdBy, `Your SCR ${scr.scrNumber} has been rejected: ${remarks}`, 'status', scrId);
      Notifications.updateBadge();

      return { success: true, terminal: true };
    }

    // Backward escalation
    const rejectMoveResult = this._moveToStage(scrId, fromStage, targetStage, user, remarks, 'In Progress', true, scr.updatedAt);
    if (rejectMoveResult && rejectMoveResult.conflict) {
      return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
    }

    // Always record lastRejection so it can be tracked on every screen
    // Re-fetch so updatedAt reflects the _moveToStage write above
    const scrAfterReject = Store.getById('scr_requests', scrId);
    Store.update('scr_requests', scrId, { lastRejection: rejectionRecord, _expectedUpdatedAt: scrAfterReject ? scrAfterReject.updatedAt : undefined });

    Audit.log('SCR', scrId, 'Stage Rejected', 'currentStage', Utils.getStageName(fromStage), Utils.getStageName(targetStage), user.name, user.role);

    const updatedScr = Store.getById('scr_requests', scrId);
    Notifications.notifyRejection(updatedScr, fromStage, targetStage, remarks);

    return { success: true, targetStage, terminal: false };
  },

  // ── Place SCR on Hold (preserves stage; freezes status) ─
  // Requires a non-empty reason. The SCR stays at its current stage
  // but advance/reject/approve are blocked until someone resumes it.
  holdStage(scrId, reason = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canHold(scr)) return { success: false, error: 'You cannot place this SCR on hold at the current stage' };
    if (!reason.trim()) return { success: false, error: 'A reason is required to place the SCR on hold' };

    const user = Auth.currentUser();
    const heldAt = Utils.nowISO();

    const holdResult = Store.update('scr_requests', scrId, {
      status: 'On Hold',
      holdReason: reason.trim(),
      heldBy: user.id,
      heldAt,
      holdAtStage: scr.currentStage,
      lastHold: {
        stage: scr.currentStage,
        stageName: Utils.getStageName(scr.currentStage),
        reason: reason.trim(),
        by: user.name,
        byId: user.id,
        byRole: user.role,
        at: heldAt
      },
      _expectedUpdatedAt: scr.updatedAt
    });
    if (holdResult && holdResult.conflict) {
      return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
    }

    // Append a workflow note (do NOT exit the active stage — just record the hold)
    Store.add('workflow_stages', {
      scrId,
      stage: scr.currentStage,
      enteredAt: heldAt,
      exitedAt: heldAt,
      performedBy: user.id,
      exitedBy: user.id,
      action: 'On Hold',
      notes: `Placed on hold by ${user.name} (${Utils.getRoleLabel(user.role)}): ${reason.trim()}`
    });

    Audit.log('SCR', scrId, 'Placed On Hold', 'status', 'In Progress', 'On Hold', user.name, user.role);

    // Notify creator + everyone whose action is now blocked at this stage
    Notifications.create(scr.createdBy, `${scr.scrNumber} placed on hold by ${user.name}: ${reason.trim()}`, 'status', scrId);
    const stageRoles = this.holdRoles[scr.currentStage] || [];
    stageRoles.forEach(role => {
      Store.filter('users', u => u.role === role).forEach(u => {
        if (u.id !== user.id) {
          Notifications.create(u.id, `${scr.scrNumber} on hold at ${Utils.getStageName(scr.currentStage)} — awaiting resume`, 'status', scrId);
        }
      });
    });
    Notifications.updateBadge();

    return { success: true };
  },

  // ── Resume a held SCR (back to In Progress at same stage) ─
  resumeStage(scrId, note = '') {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };
    if (!this.canResume(scr)) return { success: false, error: 'You cannot resume this SCR' };

    const user = Auth.currentUser();

    const resumeResult = Store.update('scr_requests', scrId, {
      status: 'In Progress',
      // Clear active hold fields — keep lastHold for history
      holdReason: '',
      heldBy: '',
      heldAt: null,
      holdAtStage: null,
      _expectedUpdatedAt: scr.updatedAt
    });
    if (resumeResult && resumeResult.conflict) {
      return { success: false, error: 'This SCR was just updated by another user. Please refresh the page to see the latest status before proceeding.' };
    }

    Store.add('workflow_stages', {
      scrId,
      stage: scr.currentStage,
      enteredAt: Utils.nowISO(),
      exitedAt: Utils.nowISO(),
      performedBy: user.id,
      exitedBy: user.id,
      action: 'Resumed',
      notes: note.trim() ? `Resumed by ${user.name}: ${note.trim()}` : `Resumed by ${user.name}`
    });

    Audit.log('SCR', scrId, 'Resumed', 'status', 'On Hold', 'In Progress', user.name, user.role);

    // Notify creator + the stage's owners that work can continue
    Notifications.create(scr.createdBy, `${scr.scrNumber} resumed — review continuing`, 'status', scrId);
    const stageRoles = this.holdRoles[scr.currentStage] || [];
    stageRoles.forEach(role => {
      Store.filter('users', u => u.role === role).forEach(u => {
        if (u.id !== user.id) {
          Notifications.create(u.id, `${scr.scrNumber} resumed by ${user.name} — ready for action at ${Utils.getStageName(scr.currentStage)}`, 'status', scrId);
        }
      });
    });
    Notifications.updateBadge();

    return { success: true };
  },

  // ── Internal: move SCR to a given stage ─────────────────
  _moveToStage(scrId, fromStage, toStage, user, notes, status, isRejection = false, expectedUpdatedAt = undefined) {
    const stageFrom = Number(fromStage);
    const stageTo   = Number(toStage);
    if (!Number.isInteger(stageFrom)) throw new Error('Corrupt workflow_stages record: ' + JSON.stringify({ stage: fromStage }));
    if (!Number.isInteger(stageTo))   throw new Error('Corrupt workflow_stages record: ' + JSON.stringify({ stage: toStage }));

    const currentWf = Store.filter('workflow_stages', w => w.scrId === scrId && w.stage === fromStage && !w.exitedAt);
    currentWf.forEach(w => Store.update('workflow_stages', w.id, {
      exitedAt: Utils.nowISO(),
      exitedBy: user.id,  // who advanced/rejected this stage
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

    // Build the SCR update payload
    const scrPatch = { currentStage: toStage, status };

    // Clear PH "Accept for Review" when SCR is sent backward to Stage ≤ 2
    // so a fresh acceptance is required if the SCR returns to Stage 3 again.
    if (toStage < 3) {
      scrPatch.phAcceptedBy = '';
      scrPatch.phAcceptedAt = null;
    }

    // Optimistic concurrency: include the client's known updatedAt so the
    // server can reject the write with 409 if another user has already
    // modified this record since we last fetched it.
    if (expectedUpdatedAt !== undefined) {
      scrPatch._expectedUpdatedAt = expectedUpdatedAt;
    }

    const patchResult = Store.update('scr_requests', scrId, scrPatch);

    if (toStage < 3) {
      Audit.log('SCR', scrId, 'Auto-cleared', 'phAcceptedBy', 'set', '(cleared on backward move)');
    }

    // Propagate conflict signal to caller
    if (patchResult && patchResult.conflict) {
      return { conflict: true };
    }
  },

  // ── Look up the ACTUAL reviewer's current name ───────────
  // Resolves who really advanced/approved for a role, regardless of
  // what the SCR's stored *Name field says. Falls back to the stored
  // value (or sensible default) when no workflow record exists yet.
  actualReviewerName(scr, role) {
    if (!scr) return '';

    if (role === 'project_head') {
      // Stage 3 exitedBy preferred; otherwise stage 4 performedBy
      const stages = Store.filter('workflow_stages', w => w.scrId === scr.id);
      const stage3 = stages.find(w => w.stage === 3 && w.exitedAt);
      const stage4 = stages.find(w => w.stage === 4);
      const advancerId = (stage3 && stage3.exitedBy) || (stage4 && stage4.performedBy) || null;
      if (advancerId) {
        const u = Store.getById('users', advancerId);
        if (u && u.role === 'project_head') return u.name;
      }
      return scr.projectHeadName || 'Mr. Panneer Selvan';
    }

    if (role === 'agm_it' || role === 'cio') {
      // Most recent approval by that role
      const dec = Store.filter('approvals', a => a.scrId === scr.id && a.approverRole === role)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
      if (dec) {
        // Approval record stored a snapshot — but resolve to LIVE name if user still exists
        const u = Store.filter('users', x => x.role === role && x.name === dec.approverName)[0];
        if (u) return u.name;
        return dec.approverName;
      }
      return role === 'agm_it'
        ? (scr.agmItName || 'Mr. S. Saravanakumar')
        : (scr.cioName   || 'Mr. Biju Velayudhan');
    }

    return '';
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
        <div class="pipeline-stage ${stateClass}" title="${Utils.escapeHtml(stage.name)}">
          <span class="stage-dot"></span>
          <span>${Utils.escapeHtml(stage.short)}</span>
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
          const stageNum = Number(entry.stage);
          if (!Number.isInteger(stageNum)) throw new Error('Corrupt workflow_stages record: ' + JSON.stringify(entry));
          const stage = Utils.stages.find(s => s.id === stageNum);
          const enterUser = Store.getById('users', entry.performedBy);
          const exitUser = entry.exitedBy ? Store.getById('users', entry.exitedBy) : null;
          const isCompleted = !!entry.exitedAt;
          const isRejected = entry.action === 'Rejected' || entry.action === 'Returned';

          // For completed/rejected stages, show who ACTED on it (exited).
          // Fall back to enterUser for legacy records that lack exitedBy.
          // For active stages, show who entered / is handling it.
          const displayUser = isCompleted ? (exitUser || enterUser) : enterUser;
          const displayName = displayUser ? Utils.escapeHtml(displayUser.name) : null;

          return `
            <div class="timeline-item">
              <div class="timeline-dot ${isCompleted ? (isRejected ? 'danger' : 'success') : ''}"></div>
              <div class="timeline-content">
                <div class="timeline-title">${stage ? Utils.escapeHtml(stage.name) : `Stage ${entry.stage}`}
                  ${isRejected ? '<span class="badge badge-danger" style="font-size:10px;margin-left:4px">Returned</span>' : ''}
                </div>
                <div class="timeline-text">
                  ${Utils.escapeHtml(entry.action || '')} ${displayName ? `by ${displayName}` : '<span class="text-muted">(user unavailable)</span>'}
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
