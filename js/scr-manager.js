/* ============================================================
   SCR MANAGEMENT SYSTEM — SCR Request Manager
   ============================================================ */

const SCRManager = {
  // ── Current filters state ───────────────────────────────
  filters: {
    search: '',
    status: 'all',            // 'all' | 'Open' | 'In Progress' | ... | comma-separated like 'Closed,Completed'
    priority: 'all',
    department: 'all',
    assignedDeveloper: 'all', // filter by developer ID
    slaStatus: 'all'          // 'all' | 'breached' | 'at-risk' | 'on-track'
  },

  // ── Reset + apply filters, then navigate to list (drilldown helper) ──
  drillTo(newFilters = {}) {
    this.filters = {
      search: '',
      status: 'all',
      priority: 'all',
      department: 'all',
      assignedDeveloper: 'all',
      slaStatus: 'all',
      ...newFilters
    };
    Router.navigate('scr-list');
  },

  // ── Clear a single filter chip ──
  clearFilter(key) {
    if (!(key in this.filters)) return;
    this.filters[key] = key === 'search' ? '' : 'all';
    Router.navigate('scr-list');
  },

  // ── Create SCR ──────────────────────────────────────────
  createSCR(data) {
    const user = Auth.currentUser();
    const scrNumber = Utils.generateSCRNumber();

    // Duplicate detection
    const existing = Store.getAll('scr_requests');
    const dupes = existing.filter(s => 
      s.status !== 'Closed' && s.status !== 'Rejected' && 
      Utils.similarity(s.description, data.description) > 0.5
    );

    const scr = Store.add('scr_requests', {
      // Section 1
      scrNumber,
      scrDate: Utils.today(),
      // Section 2
      requestType: data.requestType,
      intervention: data.intervention || data.priority || '',
      priority: data.intervention || data.priority || '',
      // Section 3
      moduleName: data.moduleName || '',
      description: data.description,
      // Section 4
      reasonForChange: data.reasonForChange || '',
      // Section 5
      attachments: data.attachments || [],
      // Section 6
      requestedBy: data.requestedBy || user.name,
      receivedBy: data.receivedBy || '',
      coordinatedBy: data.coordinatedBy || '',
      department: data.department,
      hodName: data.hodName || '',
      // Section 7
      studyDoneByPrimary: data.studyDoneByPrimary || '',
      studyDoneBySecondary: data.studyDoneBySecondary || '',
      assignedDeveloper: data.assignedDeveloper || '',
      assignedDeveloper2: data.assignedDeveloper2 || '',
      assignedOn: data.assignedOn || null,
      studyDateFrom: data.studyDateFrom || null,
      studyDateTo: data.studyDateTo || null,
      scheduleDate: data.scheduleDate || null,
      completedOn: data.completedOn || null,
      // Section 8 — defaults to standard hospital approvers
      approvalStatus: data.approvalStatus || '',
      approvalReason: data.approvalReason || '',
      projectHeadName: data.projectHeadName || 'Mr. Panneer Selvan',
      agmItName: data.agmItName || 'Mr. S. Saravanakumar',
      cioName: data.cioName || 'Mr. Biju Velayudhan',
      // Section 9
      remarkProjectHead: data.remarkProjectHead || '',
      remarkAgmIt: data.remarkAgmIt || '',
      remarkCio: data.remarkCio || '',
      // System
      assignedTeam: data.assignedTeam || '',
      currentStage: 1,
      status: 'Open',
      createdBy: user.id
    });

    // Create initial workflow entry
    Store.add('workflow_stages', {
      scrId: scr.id,
      stage: 1,
      enteredAt: Utils.nowISO(),
      exitedAt: null,
      performedBy: user.id,
      action: 'Submitted',
      notes: 'SCR submitted by ' + user.name
    });

    // Audit
    Audit.log('SCR', scr.id, 'Created', null, null, scrNumber);

    // Notifications
    Notifications.notifySCRCreated(scr);

    return { success: true, scr, duplicates: dupes };
  },

  // ── Update SCR ──────────────────────────────────────────
  updateSCR(id, updates) {
    const old = Store.getById('scr_requests', id);
    if (!old) return { success: false, error: 'SCR not found' };

    // Guard: terminal states are read-only (except for post-closure workflow fields)
    if (old.status === 'Closed' || old.status === 'Rejected') {
      return { success: false, error: `Cannot edit an SCR in "${old.status}" state` };
    }

    // Validate date ranges if present in updates
    const from = updates.studyDateFrom ?? old.studyDateFrom;
    const to = updates.studyDateTo ?? old.studyDateTo;
    if (!Utils.isDateRangeValid(from, to)) {
      return { success: false, error: 'Study Date To must be on or after Study Date From' };
    }

    // Acknowledgement is held by ONE specific user (the one who clicked
    // Acknowledge). If THAT user is no longer in the assigned pair, the
    // ack no longer applies — clear it so the new dev must acknowledge.
    const nextPrimary   = updates.assignedDeveloper  !== undefined ? updates.assignedDeveloper  : old.assignedDeveloper;
    const nextSecondary = updates.assignedDeveloper2 !== undefined ? updates.assignedDeveloper2 : old.assignedDeveloper2;
    const ackByStillAssigned = old.acknowledgedBy &&
                               (old.acknowledgedBy === nextPrimary || old.acknowledgedBy === nextSecondary);
    if (old.acknowledgedBy && !ackByStillAssigned) {
      updates.acknowledgedBy = '';
      updates.acknowledgedAt = null;
      Audit.log('SCR', id, 'Auto-cleared', 'acknowledgedBy', 'set', '(cleared because acknowledging developer was unassigned)');
    }

    const scr = Store.update('scr_requests', id, updates);

    // Track field changes (skip timestamps, deep-nested fields)
    Object.keys(updates).forEach(field => {
      const a = old[field], b = updates[field];
      if (a !== b && !['updatedAt'].includes(field) && typeof a !== 'object' && typeof b !== 'object') {
        Audit.log('SCR', id, 'Updated', field, a, b);
      }
    });

    // If either developer changed (added, replaced, or removed), notify.
    // notifySCRAssigned() itself sends to BOTH currently-assigned devs.
    const primaryChanged   = updates.assignedDeveloper  !== undefined && updates.assignedDeveloper  !== old.assignedDeveloper;
    const secondaryChanged = updates.assignedDeveloper2 !== undefined && updates.assignedDeveloper2 !== old.assignedDeveloper2;
    if (primaryChanged || secondaryChanged) {
      Notifications.notifySCRAssigned(scr);
    }

    return { success: true, scr };
  },

  // ── Get filtered SCRs ──────────────────────────────────
  getFiltered() {
    let scrs = Store.getAll('scr_requests');
    const { search, status, priority, department, assignedDeveloper, slaStatus } = this.filters;

    if (search) {
      const q = search.toLowerCase();
      scrs = scrs.filter(s =>
        s.scrNumber.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
      );
    }
    // Status supports comma-separated list (e.g. 'Closed,Completed' for all finished SCRs)
    if (status && status !== 'all') {
      const list = status.split(',').map(s => s.trim()).filter(Boolean);
      if (list.length) scrs = scrs.filter(s => list.includes(s.status));
    }
    if (priority !== 'all')  scrs = scrs.filter(s => s.priority === priority);
    if (department !== 'all') scrs = scrs.filter(s => s.department === department);

    if (assignedDeveloper && assignedDeveloper !== 'all') {
      scrs = scrs.filter(s => s.assignedDeveloper === assignedDeveloper || s.assignedDeveloper2 === assignedDeveloper);
    }

    if (slaStatus && slaStatus !== 'all') {
      scrs = scrs.filter(s => SLAEngine.calculate(s).status === slaStatus);
    }

    // Role-based filtering: requester + internal_requester see only their own
    const user = Auth.currentUser();
    if (user.role === 'requester' || user.role === 'internal_requester') {
      scrs = scrs.filter(s => s.createdBy === user.id);
    }

    return scrs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // ── Render SCR List ─────────────────────────────────────
  renderList() {
    const scrs = this.getFiltered();
    const depts = Store.getAll('departments');

    // Active drill-down chips (for filters that don't have their own dropdown)
    const activeChips = [];
    if (this.filters.assignedDeveloper && this.filters.assignedDeveloper !== 'all') {
      const dev = Store.getById('users', this.filters.assignedDeveloper);
      activeChips.push({
        key: 'assignedDeveloper',
        label: `Developer: ${dev ? dev.name : this.filters.assignedDeveloper}`
      });
    }
    if (this.filters.slaStatus && this.filters.slaStatus !== 'all') {
      const slaLabels = { breached: 'SLA Breached', 'at-risk': 'At Risk', 'on-track': 'On Track' };
      activeChips.push({
        key: 'slaStatus',
        label: slaLabels[this.filters.slaStatus] || this.filters.slaStatus
      });
    }
    if (this.filters.status && this.filters.status.includes(',')) {
      activeChips.push({ key: 'status', label: `Status: ${this.filters.status}` });
    }

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">SCR Requests</h2>
          </div>
          <p class="page-description">Manage all software change requests</p>
        </div>
        ${Auth.canPerformAction('create_scr') ? `
          <button class="btn btn-primary" onclick="Router.navigate('scr-create')">
            + New SCR
          </button>
        ` : ''}
      </div>

      ${activeChips.length > 0 ? `
        <div class="flex items-center" style="gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);background:var(--color-primary-subtle);border:1px solid rgba(61,95,184,0.2);border-radius:var(--radius-lg)">
          <span class="text-sm font-semi" style="color:var(--color-primary-dark)">Active drill-down:</span>
          ${activeChips.map(c => `
            <span class="badge primary" style="gap:6px">
              ${Utils.escapeHtml(c.label)}
              <button onclick="SCRManager.clearFilter('${c.key}')" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;font-weight:bold" title="Remove filter">✕</button>
            </span>
          `).join('')}
          <button class="btn btn-ghost btn-sm" onclick="SCRManager.drillTo({})" style="margin-left:auto">Clear all filters</button>
        </div>
      ` : ''}

      <div class="filter-bar">
        <div class="search-bar" style="flex:1;max-width:300px">
          <span class="search-icon">🔍</span>
          <input type="text" class="form-input" id="scr-search" placeholder="Search SCRs..." 
            value="${Utils.escapeHtml(this.filters.search)}" oninput="SCRManager.handleFilter()">
        </div>
        <select class="form-select" id="filter-status" style="width:140px" onchange="SCRManager.handleFilter()">
          <option value="all">All Status</option>
          <option value="Open" ${this.filters.status === 'Open' ? 'selected' : ''}>Open</option>
          <option value="In Progress" ${this.filters.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="Completed" ${this.filters.status === 'Completed' ? 'selected' : ''}>Completed</option>
          <option value="On Hold" ${this.filters.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
          <option value="Closed" ${this.filters.status === 'Closed' ? 'selected' : ''}>Closed</option>
          <option value="Rejected" ${this.filters.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
        <select class="form-select" id="filter-priority" style="width:140px" onchange="SCRManager.handleFilter()">
          <option value="all">All Priority</option>
          <option value="Emergency" ${this.filters.priority === 'Emergency' ? 'selected' : ''}>Emergency</option>
          <option value="Urgent" ${this.filters.priority === 'Urgent' ? 'selected' : ''}>Urgent</option>
          <option value="Routine" ${this.filters.priority === 'Routine' ? 'selected' : ''}>Routine</option>
        </select>
        <select class="form-select" id="filter-dept" style="width:160px" onchange="SCRManager.handleFilter()">
          <option value="all">All Departments</option>
          ${depts.map(d => `<option value="${Utils.escapeHtml(d.name)}" ${this.filters.department === d.name ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
        </select>
        <span class="text-sm text-tertiary">${scrs.length} results</span>
      </div>

      ${scrs.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3 class="empty-state-title">No SCRs Found</h3>
          <p class="empty-state-text">Try adjusting your filters or create a new SCR</p>
          ${Auth.canPerformAction('create_scr') ? `
            <button class="btn btn-primary mt-4" onclick="Router.navigate('scr-create')">+ New SCR</button>
          ` : ''}
        </div>
      ` : `
        <div class="table-container">
          <table class="data-table" id="scr-table">
            <thead>
              <tr>
                <th class="sortable">SCR #</th>
                <th>Type</th>
                <th class="sortable">Priority</th>
                <th>Department</th>
                <th>Description</th>
                <th>Stage</th>
                <th class="sortable">Status</th>
                <th>SLA</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${scrs.map(scr => {
                const rej = scr.lastRejection;
                const rejTooltip = rej ? `Rejected at ${rej.fromStageName} by ${rej.by}: ${String(rej.remarks || '').replace(/"/g, '\'')}` : '';
                return `
                  <tr style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})">
                    <td><span class="font-semi text-brand">${scr.scrNumber}</span></td>
                    <td>${Utils.badgeHtml(scr.requestType, 'neutral')}</td>
                    <td>${Utils.priorityBadge(scr.priority)}</td>
                    <td class="text-sm">${Utils.escapeHtml(scr.department)}</td>
                    <td class="text-sm" style="max-width:250px">${Utils.escapeHtml(Utils.truncate(scr.description, 60))}</td>
                    <td><span class="text-xs text-tertiary">${Utils.getStageName(scr.currentStage)}</span></td>
                    <td>${Utils.statusBadge(scr.status)} ${rej ? `<span title="${Utils.escapeHtml(rejTooltip)}" style="margin-left:4px;cursor:help" aria-label="Rejection remarks">⚠️</span>` : ''}</td>
                    <td>${SLAEngine.renderIndicator(scr)}</td>
                    <td class="text-sm text-tertiary">${Utils.formatDate(scr.createdAt)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  },

  postRenderList() {
    // Any post-render setup
  },

  // ── Filter handler ──────────────────────────────────────
  handleFilter() {
    this.filters.search = document.getElementById('scr-search')?.value || '';
    this.filters.status = document.getElementById('filter-status')?.value || 'all';
    this.filters.priority = document.getElementById('filter-priority')?.value || 'all';
    this.filters.department = document.getElementById('filter-dept')?.value || 'all';
    Router.navigate('scr-list');
  },

  // ── Render SCR Detail ──────────────────────────────────
  renderDetail(id) {
    const scr = Store.getById('scr_requests', id);
    if (!scr) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3 class="empty-state-title">SCR Not Found</h3>
        <p class="empty-state-text">This SCR does not exist or may have been removed.</p>
        <button class="btn btn-primary mt-4" onclick="Router.navigate('scr-list')">Back to List</button>
      </div>`;
    }

    const currentUser = Auth.currentUser();
    if (!currentUser) {
      // Session lost mid-render — bounce to login
      App.init();
      return '';
    }

    // Access control: requesters + internal requesters can only view SCRs they created
    if ((currentUser.role === 'requester' || currentUser.role === 'internal_requester') && scr.createdBy !== currentUser.id) {
      return `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-text">You can only view SCRs that you have created.</p>
        <button class="btn btn-primary mt-4" onclick="Router.navigate('self-service')">Back to My Requests</button>
      </div>`;
    }

    const dev = scr.assignedDeveloper ? Store.getById('users', scr.assignedDeveloper) : null;
    const dev2 = scr.assignedDeveloper2 ? Store.getById('users', scr.assignedDeveloper2) : null;
    const creator = Store.getById('users', scr.createdBy);
    // Internal requesters can only edit their own SCR, and only until the
    // Implementation team accepts it (Stage 2). After that, only Admin (and
    // the normal IT roles) keep the edit ability.
    const isInternalReqOwner = currentUser.role === 'internal_requester'
      && scr.createdBy === currentUser.id
      && (scr.currentStage || 1) < 2;
    const canEdit = Auth.canPerformAction('edit_scr')
      && (currentUser.role !== 'internal_requester' || isInternalReqOwner)
      && scr.status !== 'Closed' && scr.status !== 'Rejected';
    const hasFeedback = Store.filter('feedback', f => f.scrId === id).length > 0;
    const isApprover = Auth.hasRole('agm_it', 'cio', 'admin');
    const isImpl = Auth.hasRole('implementation', 'admin');
    const isPH = Auth.hasRole('project_head', 'admin');
    const isAssignedDev = Auth.hasRole('developer', 'admin') &&
      (scr.assignedDeveloper === currentUser.id || scr.assignedDeveloper2 === currentUser.id);
    const canAcknowledge = isAssignedDev && scr.currentStage === 5 && !scr.acknowledgedBy && scr.status !== 'Closed';

    // Project Head must "Accept for Review" before they can advance Stage 3.
    // Developer must "Acknowledge" before they can advance Stage 5 (Submit to QA).
    // Both gates ensure explicit ownership of the work before the transition.
    const canPhAccept = isPH && scr.currentStage === 3 && !scr.phAcceptedBy && scr.status !== 'Closed' && scr.status !== 'Rejected';
    const canAdvance = Workflow.canAdvance(scr)
      && (scr.currentStage !== 3 || !!scr.phAcceptedBy)
      && (scr.currentStage !== 5 || !!scr.acknowledgedBy);

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            <button class="btn btn-ghost btn-sm" onclick="Router.goBack()" title="Go back">← Back</button>
            <h2 class="page-title">${scr.scrNumber}</h2>
            ${Utils.priorityBadge(scr.intervention || scr.priority)}
            ${Utils.statusBadge(scr.status)}
          </div>
          <p class="page-description">${Utils.escapeHtml(scr.department)} · Created ${Utils.formatDate(scr.createdAt)}</p>
        </div>
        <div class="flex gap-2">
          ${canEdit ? `<button class="btn btn-ghost" onclick="Router.navigate('scr-create',{id:'${scr.id}'})">✏️ Edit</button>` : ''}
          ${scr.status === 'Closed' || Auth.hasRole('admin') ? `<button class="btn btn-ghost" onclick="SCRManager.printSCR('${scr.id}')" title="${scr.status === 'Closed' ? 'Print SCR Form' : 'Admin: Print SCR Form at current stage'}">🖨️ Print</button>` : ''}
          ${canPhAccept ? `<button class="btn btn-warning" onclick="SCRManager.handlePhAccept('${scr.id}')">👁 Accept for Review</button>` : ''}
          ${canAcknowledge ? `<button class="btn btn-warning" onclick="SCRManager.handleAcknowledge('${scr.id}')">👁 Acknowledge</button>` : ''}
          ${Workflow.canReject(scr) ? `<button class="btn btn-danger btn-sm" onclick="SCRManager.handleRejectStage('${scr.id}')">✕ Reject</button>` : ''}
          ${Workflow.canHold(scr) ? `<button class="btn btn-warning btn-sm" onclick="SCRManager.handleHoldStage('${scr.id}')" title="Pause this SCR — work cannot continue until resumed">⏸ Hold</button>` : ''}
          ${Workflow.canResume(scr) ? `<button class="btn btn-success btn-sm" onclick="SCRManager.handleResumeStage('${scr.id}')" title="Lift the hold and continue review">▶ Resume</button>` : ''}
          ${Workflow.canClose(scr) ? `<button class="btn btn-success" onclick="SCRManager.handleCloseTicket('${scr.id}')">✓ Close Ticket</button>` : ''}
          ${canAdvance ? `<button class="btn btn-primary" onclick="SCRManager.handleAdvanceStage('${scr.id}')">${Workflow.getAdvanceLabel(scr.currentStage)}</button>` : ''}
          ${Auth.canPerformAction('delete_scr') ? `<button class="btn btn-danger" onclick="SCRManager.handleDeleteSCR('${scr.id}')" title="Admin only — permanently delete this SCR and all its history">🗑️ Delete SCR</button>` : ''}
        </div>
      </div>

      <!-- Pipeline -->
      <div class="card mb-4">
        ${Workflow.renderPipeline(scr)}
        ${SLAEngine.renderProgressBar(scr)}
      </div>

      ${scr.status === 'On Hold' && scr.holdReason ? `
      <!-- Hold banner — currently on hold, requires resume before action -->
      <div class="card mb-4" style="border-left:4px solid var(--color-warning);background:rgba(245,158,11,0.06)">
        <div class="card-body">
          <div class="flex items-center" style="gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
            <span style="font-size:1.5rem">⏸</span>
            <span class="font-bold" style="color:var(--color-warning-dark);font-size:var(--font-md)">On Hold at ${Utils.escapeHtml(Utils.getStageName(scr.holdAtStage || scr.currentStage))}</span>
            ${Utils.badgeHtml('Paused', 'warning')}
          </div>
          <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;margin-bottom:var(--space-2);white-space:pre-wrap">"${Utils.escapeHtml(scr.holdReason)}"</p>
          <p class="text-xs text-tertiary">— ${Utils.escapeHtml(Store.getById('users', scr.heldBy)?.name || 'Unknown')} · ${Utils.formatDateTime(scr.heldAt)}</p>
        </div>
      </div>
      ` : ''}

      ${scr.lastRejection ? `
      <!-- Rejection banner — visible on every screen that shows this SCR -->
      <div class="card mb-4" style="border-left:4px solid var(--color-danger);background:rgba(184,52,30,0.04)">
        <div class="card-body">
          <div class="flex items-center" style="gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
            <span style="font-size:1.5rem">⚠️</span>
            <span class="font-bold" style="color:var(--color-danger-dark);font-size:var(--font-md)">Rejected at ${Utils.escapeHtml(scr.lastRejection.fromStageName || 'Unknown Stage')}</span>
            ${Utils.badgeHtml(scr.status === 'Rejected' ? 'Terminal' : `Returned to ${scr.lastRejection.toStageName || ''}`, scr.status === 'Rejected' ? 'danger' : 'warning')}
          </div>
          <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;margin-bottom:var(--space-2);white-space:pre-wrap">"${Utils.escapeHtml(scr.lastRejection.remarks || '')}"</p>
          <p class="text-xs text-tertiary">— ${Utils.escapeHtml(scr.lastRejection.by || 'Unknown')} (${Utils.escapeHtml(Utils.getRoleLabel(scr.lastRejection.byRole || ''))}) · ${Utils.formatDateTime(scr.lastRejection.at)}</p>
        </div>
      </div>
      ` : ''}

      ${scr.currentStage === 3 || scr.phAcceptedBy ? `
      <!-- PH Acceptance status banner — visible at stage 3+ -->
      <div class="card mb-4" style="border-left:4px solid ${scr.phAcceptedBy ? 'var(--color-success)' : 'var(--color-warning)'};background:${scr.phAcceptedBy ? 'rgba(13,122,90,0.05)' : 'rgba(245,158,11,0.06)'}">
        <div class="card-body" style="padding:var(--space-3) var(--space-4)">
          <div class="flex items-center" style="gap:var(--space-3);flex-wrap:wrap">
            <span style="font-size:1.3rem">${scr.phAcceptedBy ? '👁' : '⏳'}</span>
            <span class="font-bold" style="color:${scr.phAcceptedBy ? 'var(--color-success-dark)' : 'var(--color-warning-dark)'};font-size:var(--font-base)">
              ${scr.phAcceptedBy ? 'Project Head Review — Accepted' : 'Awaiting Project Head Acceptance'}
            </span>
            ${scr.phAcceptedBy
              ? `<span class="text-sm text-secondary">by ${Utils.escapeHtml(Store.getById('users', scr.phAcceptedBy)?.name || '—')} · ${Utils.formatDateTime(scr.phAcceptedAt)}</span>`
              : `<span class="text-sm text-tertiary">— PH must accept before review work can begin</span>`}
          </div>
        </div>
      </div>
      ` : ''}

      <div class="scr-detail-grid">
        <!-- Main Column -->
        <div class="scr-detail-main">

          <!-- SECTION 1+2: Header & Project Details -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📋 SCR Header & Project Details</h3>
            </div>
            <div class="card-body">
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">SCR Number</span>
                  <span class="detail-value font-bold text-brand">${Utils.escapeHtml(scr.scrNumber)}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Date</span>
                  <span class="detail-value">${Utils.formatDate(scr.scrDate || scr.createdAt)}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Request Type</span>
                  <span class="detail-value">${Utils.badgeHtml(scr.requestType, 'neutral')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Intervention</span>
                  <span class="detail-value">${Utils.priorityBadge(scr.intervention || scr.priority)}</span>
                </div>
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">Module Name</span>
                  <span class="detail-value font-semi">${Utils.escapeHtml(scr.moduleName || '—')}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- SECTION 3: Request Description -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📝 Request Description</h3>
            </div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label" style="margin-bottom:var(--space-1)">Description</label>
                <p style="color:var(--color-text-primary);line-height:1.8;white-space:pre-wrap">${Utils.escapeHtml(scr.description || '—')}</p>
              </div>
            </div>
          </div>

          <!-- SECTION 4: Reason for Change -->
          ${scr.reasonForChange ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">💡 Reason for Change</h3>
            </div>
            <div class="card-body">
              <div class="detail-grid">
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">Business Justification</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.reasonForChange || '—')}</span>
                </div>
              </div>
            </div>
          </div>` : ''}

          <!-- SECTION 5: Attachments -->
          ${scr.attachments && scr.attachments.length > 0 ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📎 Attachments (${scr.attachments.length})</h3>
            </div>
            <div class="card-body">
              <ol style="padding-left:var(--space-4);color:var(--color-text-secondary)">
                ${scr.attachments.map(a => `<li style="margin-bottom:var(--space-2);font-size:var(--font-sm)">${Utils.escapeHtml(a.name)}</li>`).join('')}
              </ol>
            </div>
          </div>` : ''}

          <!-- SECTION 6: End User Details -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">👤 End User Details</h3>
            </div>
            <div class="card-body">
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">Requested By</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.requestedBy || (creator ? creator.name : '—'))}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Received By</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.receivedBy || '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Coordinated By</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.coordinatedBy || '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Department</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.department)}</span>
                </div>
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">Department HOD</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.hodName || '—')}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- SECTION 7: Study Details — hidden for requesters (internal IT detail) -->
          ${(isImpl || scr.studyDoneByPrimary) && currentUser.role !== 'requester' ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">🔬 Study Details</h3>
            </div>
            <div class="card-body">
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">Study Done By (Primary)</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.studyDoneByPrimary || '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Study Done By (Secondary)</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.studyDoneBySecondary || '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Developer 1</span>
                  <span class="detail-value">${dev ? Utils.escapeHtml(dev.name) : (scr.assignedDeveloper ? Utils.escapeHtml(scr.assignedDeveloper) : '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Developer 2</span>
                  <span class="detail-value">${dev2 ? Utils.escapeHtml(dev2.name) : (scr.assignedDeveloper2 ? Utils.escapeHtml(scr.assignedDeveloper2) : '—')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Assigned On</span>
                  <span class="detail-value">${Utils.formatDate(scr.assignedOn)}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Study Date From – To</span>
                  <span class="detail-value">${Utils.formatDate(scr.studyDateFrom)} – ${Utils.formatDate(scr.studyDateTo)}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Schedule Date</span>
                  <span class="detail-value">${Utils.formatDate(scr.scheduleDate)}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Completed On</span>
                  <span class="detail-value">${Utils.formatDate(scr.completedOn)}</span>
                </div>
                ${scr.currentStage >= 5 || scr.acknowledgedBy ? `
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">Developer Acknowledgement</span>
                  <span class="detail-value">
                    ${scr.acknowledgedBy
                      ? `${Utils.badgeHtml('Acknowledged', 'success')} &nbsp;${Utils.escapeHtml(Store.getById('users', scr.acknowledgedBy)?.name || '—')} &nbsp;·&nbsp; ${Utils.formatDate(scr.acknowledgedAt)}`
                      : `${Utils.badgeHtml('Pending', 'warning')} &nbsp;<span class="text-tertiary text-sm">Awaiting developer acknowledgement</span>`}
                  </span>
                </div>` : ''}
              </div>
            </div>
          </div>` : ''}

          <!-- SECTION 7b: Development Updates (visible once stage ≥ 5) -->
          ${DevUpdates.renderForSCR(scr.id, scr)}

          <!-- SECTION 9a: Review Remarks — ALWAYS visible once any remark exists (PH / AGM / CIO) -->
          ${scr.remarkProjectHead || scr.remarkAgmIt || scr.remarkCio ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📝 Review Remarks</h3>
            </div>
            <div class="card-body">
              <div style="display:flex;flex-direction:column;gap:var(--space-3)">
                ${scr.remarkProjectHead ? `
                  <div style="padding:var(--space-3);background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid var(--color-primary);border-radius:var(--radius-md)">
                    <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
                      <span style="font-size:1.1rem">👤</span>
                      <span class="font-bold text-sm">Project Head</span>
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'project_head'))}</span>
                    </div>
                    <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;white-space:pre-wrap;margin:0">${Utils.escapeHtml(scr.remarkProjectHead)}</p>
                  </div>
                ` : ''}
                ${scr.remarkAgmIt ? `
                  <div style="padding:var(--space-3);background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid var(--color-info);border-radius:var(--radius-md)">
                    <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
                      <span style="font-size:1.1rem">📊</span>
                      <span class="font-bold text-sm">AGM – IT</span>
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'agm_it'))}</span>
                    </div>
                    <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;white-space:pre-wrap;margin:0">${Utils.escapeHtml(scr.remarkAgmIt)}</p>
                  </div>
                ` : ''}
                ${scr.remarkCio ? `
                  <div style="padding:var(--space-3);background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid var(--color-success);border-radius:var(--radius-md)">
                    <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
                      <span style="font-size:1.1rem">🏛️</span>
                      <span class="font-bold text-sm">CIO</span>
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'cio'))}</span>
                    </div>
                    <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;white-space:pre-wrap;margin:0">${Utils.escapeHtml(scr.remarkCio)}</p>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>` : ''}

          <!-- SECTION 8: Management Approval (Stage 4 panel + decision) -->
          ${(isApprover && scr.currentStage === 4) || scr.approvalStatus ? `
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">✅ Management Approval</h3>
            </div>
            <div class="card-body">
              ${scr.approvalStatus ? `
              <div class="scr-approval-decision ${scr.approvalStatus === 'Approved' ? 'approved' : scr.approvalStatus === 'Not Approved' ? 'rejected' : 'hold'}" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);border-radius:var(--radius-lg);margin-bottom:var(--space-4);background:${scr.approvalStatus === 'Approved' ? 'var(--color-success-subtle)' : scr.approvalStatus === 'Not Approved' ? 'var(--color-danger-subtle)' : 'var(--color-warning-subtle)'}">
                <span style="font-size:1.5rem">${scr.approvalStatus === 'Approved' ? '✅' : scr.approvalStatus === 'Not Approved' ? '❌' : '⏸️'}</span>
                <div>
                  <div class="font-bold" style="color:${scr.approvalStatus === 'Approved' ? 'var(--color-success-light)' : scr.approvalStatus === 'Not Approved' ? 'var(--color-danger-light)' : 'var(--color-warning-light)'};font-size:var(--font-md)">${scr.approvalStatus}</div>
                  ${scr.approvalReason ? `<div class="text-sm text-secondary">${Utils.escapeHtml(scr.approvalReason)}</div>` : ''}
                </div>
              </div>` : ''}
              <div class="detail-grid">
                <div class="detail-field">
                  <span class="detail-label">Project Head</span>
                  <span class="detail-value">${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'project_head'))}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">AGM – IT</span>
                  <span class="detail-value">${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'agm_it'))}</span>
                </div>
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">CIO</span>
                  <span class="detail-value">${Utils.escapeHtml(Workflow.actualReviewerName(scr, 'cio'))}</span>
                </div>
                ${scr.currentStage >= 3 || scr.phAcceptedBy ? `
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">PH Review Acceptance</span>
                  <span class="detail-value">
                    ${scr.phAcceptedBy
                      ? `${Utils.badgeHtml('Accepted', 'success')} &nbsp;${Utils.escapeHtml(Store.getById('users', scr.phAcceptedBy)?.name || '—')} &nbsp;·&nbsp; ${Utils.formatDate(scr.phAcceptedAt)}`
                      : `${Utils.badgeHtml('Pending', 'warning')} &nbsp;<span class="text-tertiary text-sm">Awaiting Project Head acceptance</span>`}
                  </span>
                </div>` : ''}
              </div>
              ${Approval.renderForSCR(scr.id)}
            </div>
          </div>` : `
          <div class="card">
            <div class="card-header"><h3 class="card-title">✅ Approvals</h3></div>
            <div class="card-body">${Approval.renderForSCR(scr.id)}</div>
          </div>`}

          <!-- Feedback -->
          ${scr.status === 'Closed' || scr.status === 'Completed' ? `
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">⭐ Feedback</h3>
              </div>
              <div class="card-body">
                ${hasFeedback ? Feedback.renderForSCR(scr.id) : `
                  <p class="text-tertiary mb-4">No feedback submitted yet</p>
                  ${Auth.canPerformAction('submit_feedback') || Auth.hasRole('admin', 'requester') ? `
                    <button class="btn btn-outline" onclick="Feedback.showForm('${scr.id}')">&#x2B50; Submit Feedback</button>
                  ` : ''}
                `}
              </div>
            </div>
          ` : ''}

          <!-- Section 10: Footer -->
          <div class="scr-detail-footer-note">
            <span style="font-size:1.5rem">🏥</span>
            <p>"Behind every system change is a push for better healthcare delivery."</p>
          </div>
        </div>

        <!-- Sidebar Column -->
        <div class="scr-detail-sidebar">
          <!-- Workflow History -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">🔄 Workflow</h3>
            </div>
            <div class="card-body">
              ${Workflow.renderHistory(scr.id)}
            </div>
          </div>

          <!-- Activity Timeline -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">📜 Activity</h3>
            </div>
            <div class="card-body">
              ${Audit.renderTimeline(scr.id)}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ── Handle advance stage ────────────────────────────────
  async handleAdvanceStage(scrId) {
    const scr = Store.getById('scr_requests', scrId);
    const nextStage = scr.currentStage + 1;
    const confirmed = await Utils.confirm('Advance Stage?', `Move to "${Utils.getStageName(nextStage)}"?`);
    if (!confirmed) return;

    const result = Workflow.advanceStage(scrId);
    if (result.success) {
      Utils.toast('success', 'Stage Advanced', `Moved to ${Utils.getStageName(result.newStage)}`);
      Router.navigate('scr-detail', { id: scrId });
    } else {
      Utils.toast('error', 'Cannot Advance', result.error);
    }
  },

  // ── Handle reject / return stage ────────────────────────
  async handleRejectStage(scrId) {
    const scr = Store.getById('scr_requests', scrId);
    const targetStage = Workflow._rejectTarget[scr.currentStage];
    const targetLabel = targetStage ? `return to "${Utils.getStageName(targetStage)}"` : 'reject this SCR (terminal)';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-body" style="padding:var(--space-6)">
          <h4 style="margin-bottom:var(--space-2)">Reject & ${targetStage ? 'Return' : 'Close'}</h4>
          <p class="text-secondary text-sm mb-4">This will ${targetLabel}. Remarks are required.</p>
          <div class="form-group">
            <label class="form-label">Remarks <span class="required">*</span></label>
            <textarea id="reject-remarks" class="form-textarea" rows="3" placeholder="Explain the reason for rejection..."></textarea>
          </div>
          <div class="flex gap-3 justify-end mt-4">
            <button class="btn btn-ghost" id="reject-cancel">Cancel</button>
            <button class="btn btn-danger" id="reject-confirm">Confirm Rejection</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#reject-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#reject-confirm').onclick = () => {
      const remarks = document.getElementById('reject-remarks').value.trim();
      overlay.remove();
      const result = Workflow.rejectStage(scrId, remarks);
      if (result.success) {
        const msg = result.terminal ? 'SCR has been rejected' : `Returned to ${Utils.getStageName(result.targetStage)}`;
        Utils.toast(result.terminal ? 'error' : 'warning', 'Rejected', msg);
        Router.navigate('scr-detail', { id: scrId });
      } else {
        Utils.toast('error', 'Error', result.error);
      }
    };
  },

  // ── Handle Hold (pause SCR until someone resumes it) ───
  async handleHoldStage(scrId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-body" style="padding:var(--space-6)">
          <h4 style="margin-bottom:var(--space-2)">⏸ Place SCR On Hold</h4>
          <p class="text-secondary text-sm mb-4">The SCR will pause at the current stage. No advance / reject / approval can happen until someone resumes it. A reason is required.</p>
          <div class="form-group">
            <label class="form-label">Reason for Hold <span class="required">*</span></label>
            <textarea id="hold-reason" class="form-textarea" rows="3" placeholder="e.g. Awaiting clarification from requester / vendor dependency / budget approval pending..."></textarea>
          </div>
          <div class="flex gap-3 justify-end mt-4">
            <button class="btn btn-ghost" id="hold-cancel">Cancel</button>
            <button class="btn btn-warning" id="hold-confirm">Confirm Hold</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('hold-reason')?.focus(), 50);

    overlay.querySelector('#hold-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#hold-confirm').onclick = () => {
      const reason = document.getElementById('hold-reason').value.trim();
      if (!reason) { Utils.toast('warning', 'Reason Required', 'Please explain why this SCR is being held.'); return; }
      overlay.remove();
      const result = Workflow.holdStage(scrId, reason);
      if (result.success) {
        Utils.toast('warning', 'On Hold', 'SCR has been placed on hold');
        Router.navigate('scr-detail', { id: scrId });
      } else {
        Utils.toast('error', 'Error', result.error);
      }
    };
  },

  // ── Handle Resume (lift the hold) ───────────────────────
  async handleResumeStage(scrId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-body" style="padding:var(--space-6)">
          <h4 style="margin-bottom:var(--space-2)">▶ Resume SCR</h4>
          <p class="text-secondary text-sm mb-4">Lift the hold and continue review at the current stage. A note is optional.</p>
          <div class="form-group">
            <label class="form-label">Resume Note (optional)</label>
            <textarea id="resume-note" class="form-textarea" rows="2" placeholder="e.g. Clarification received / dependency resolved..."></textarea>
          </div>
          <div class="flex gap-3 justify-end mt-4">
            <button class="btn btn-ghost" id="resume-cancel">Cancel</button>
            <button class="btn btn-success" id="resume-confirm">Confirm Resume</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('resume-note')?.focus(), 50);

    overlay.querySelector('#resume-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#resume-confirm').onclick = () => {
      const note = document.getElementById('resume-note').value.trim();
      overlay.remove();
      const result = Workflow.resumeStage(scrId, note);
      if (result.success) {
        Utils.toast('success', 'Resumed', 'SCR is back in progress');
        Router.navigate('scr-detail', { id: scrId });
      } else {
        Utils.toast('error', 'Error', result.error);
      }
    };
  },

  // ── Handle Project Head "Accept for Review" (Stage 3) ──
  async handlePhAccept(scrId) {
    const confirmed = await Utils.confirm(
      'Accept for Review?',
      'Confirm that you will review this SCR, assign a developer, and forward to Management Approval.',
      'primary'
    );
    if (!confirmed) return;

    const user = Auth.currentUser();
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) { Utils.toast('error', 'Not Found', 'SCR no longer exists'); return; }

    // Defensive guards
    if (scr.currentStage !== 3) {
      Utils.toast('error', 'Wrong Stage', 'This SCR is not at Project Head Review.');
      return;
    }
    if (scr.phAcceptedBy) {
      Utils.toast('warning', 'Already Accepted', 'This SCR has already been accepted for review.');
      return;
    }

    Store.update('scr_requests', scrId, {
      phAcceptedBy: user.id,
      phAcceptedAt: Utils.nowISO(),
      // Also stamp PH name now (so Management Approval header shows the
      // actual PH who took it, even before they advance)
      projectHeadName: user.name
    });

    Audit.log('SCR', scrId, 'PH Accepted for Review', 'phAcceptedBy', null, user.name, user.name, user.role);

    // Notify implementation team that PH has picked it up
    const impl = Store.filter('users', u => u.role === 'implementation');
    impl.forEach(u => {
      Notifications.create(
        u.id,
        `${scr.scrNumber} accepted by Project Head ${user.name} — review in progress`,
        'status',
        scrId
      );
    });

    Utils.toast('success', 'Accepted for Review',
      'You can now assign a developer and advance to Management Approval.');
    Router.navigate('scr-detail', { id: scrId });
  },

  // ── Handle developer acknowledgement ───────────────────
  async handleAcknowledge(scrId) {
    const confirmed = await Utils.confirm(
      'Acknowledge Assignment?',
      'Confirm that you have received and understood this SCR and are ready to begin development.',
      'primary'
    );
    if (!confirmed) return;

    const user = Auth.currentUser();
    const scr = Store.getById('scr_requests', scrId);
    Store.update('scr_requests', scrId, {
      acknowledgedBy: user.id,
      acknowledgedAt: Utils.nowISO()
    });

    Audit.log('SCR', scrId, 'Acknowledged', 'acknowledgedBy', null, user.name, user.name, user.role);

    // Notify implementation team and project head
    const recipients = Store.filter('users', u => u.role === 'implementation' || u.role === 'project_head');
    recipients.forEach(u => {
      Notifications.create(u.id, `${scr.scrNumber} acknowledged by developer ${user.name} — development in progress`, 'info', scrId);
    });

    Utils.toast('success', 'Acknowledged', 'Assignment acknowledged. Team has been notified.');
    Router.navigate('scr-detail', { id: scrId });
  },

  // ── Handle close ticket (Stage 6 QA approval) ──────────
  async handleCloseTicket(scrId) {
    const confirmed = await Utils.confirm('Close Ticket?', 'Mark this SCR as verified and closed?', 'warning');
    if (!confirmed) return;

    const result = Workflow.closeTicket(scrId);
    if (result.success) {
      Utils.toast('success', 'Ticket Closed', 'SCR has been verified and closed successfully');
      Router.navigate('scr-detail', { id: scrId });
    } else {
      Utils.toast('error', 'Error', result.error);
    }
  },

  // ── Handle delete SCR (admin only) ──────────────────────
  // Permanently removes the SCR. Store.remove cascades on the server +
  // in the cache: workflow_stages, approvals, feedback, notifications
  // and development_updates for this SCR are all purged. The audit_log
  // is preserved (NABH — historic trail must survive).
  async handleDeleteSCR(scrId) {
    if (!Auth.canPerformAction('delete_scr')) {
      Utils.toast('error', 'Not Allowed', 'Only an administrator can delete an SCR.');
      return;
    }
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) { Utils.toast('error', 'Not Found', 'SCR no longer exists.'); return; }

    const childCount =
      Store.filter('workflow_stages', w => w.scrId === scrId).length +
      Store.filter('approvals', a => a.scrId === scrId).length +
      Store.filter('feedback', f => f.scrId === scrId).length +
      Store.filter('development_updates', d => d.scrId === scrId).length;

    const confirmed = await Utils.confirm(
      'Delete this SCR?',
      `${scr.scrNumber} — "${Utils.truncate(scr.moduleName || scr.description || '', 60)}"\n\n` +
      `This permanently deletes the SCR and ${childCount} linked record(s) ` +
      `(workflow history, approvals, feedback, dev updates). The audit trail is kept. ` +
      `This cannot be undone.`,
      'danger'
    );
    if (!confirmed) return;

    const user = Auth.currentUser();
    Store.remove('scr_requests', scrId);
    Audit.log('SCR', scrId, 'Deleted', 'scrNumber', scr.scrNumber, null,
      user ? user.name : 'Admin', user ? user.role : 'admin');

    Utils.toast('success', 'SCR Deleted', `${scr.scrNumber} and its linked records were removed.`);
    Router.navigate('scr-list');
  },

  // ── Render Create/Edit Form (10-Section role-based) ─────
  renderForm(editId) {
    const isEdit = !!editId;
    const scr = isEdit ? Store.getById('scr_requests', editId) : {};
    const user = Auth.currentUser();
    const depts = Store.getAll('departments');
    const devs = Store.filter('users', u => u.role === 'developer');
    const impTeam = Store.filter('users', u => u.role === 'implementation');

    // Role visibility flags
    const isRequester = Auth.hasRole('requester');
    const isInternalReq = Auth.hasRole('internal_requester');
    const isImpl = Auth.hasRole('implementation', 'admin');
    const isPH = Auth.hasRole('project_head', 'admin');
    const isApprover = Auth.hasRole('agm_it', 'cio', 'admin');
    const isAdmin = Auth.hasRole('admin');
    // Both roles use the self-service portal and only see their own SCRs;
    // use this flag wherever the *layout* (simplified header, hidden
    // approver bits) should match the regular Requester experience.
    const isReqLike = isRequester || isInternalReq;

    // Pre-fill end user from current user if either kind of requester
    const defaultRequestedBy = scr.requestedBy || (isReqLike ? user.name : '');
    const defaultDept = scr.department || (isReqLike ? user.department : '');
    // Pre-fill study primary from current user if implementation team
    const defaultStudyPrimary = scr.studyDoneByPrimary || (isImpl && !isAdmin ? user.name : '');

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            <button class="btn btn-ghost btn-sm" onclick="Router.goBack()" title="Go back">← Back</button>
            <h2 class="page-title">${isEdit ? `Edit ${scr.scrNumber}` : 'New SCR Request'}</h2>
          </div>
          <p class="page-description">${isEdit ? 'Update SCR details' : 'Submit a new software change request'}</p>
        </div>
      </div>

      <form id="scr-form" onsubmit="SCRManager.handleSubmit(event, '${editId || ''}')" style="max-width:900px">

        <!-- ━━━━━━ SECTION 1: HEADER ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">1</span>
            <span>Header</span>
            <span class="scr-section-badge">SOFTWARE CHANGE REQUEST (SCR) FORM</span>
          </div>
          <div class="scr-form-section-body">
            ${isRequester ? `
              <!-- Requester view: only Date shown. SCR Number is auto-assigned at save. -->
              <div class="form-group" style="max-width:320px">
                <label class="form-label">Request Date</label>
                <input type="text" class="form-input" value="${Utils.formatDate(isEdit ? scr.scrDate : Utils.today())}" readonly style="opacity:0.7">
              </div>
            ` : `
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">SCR Number</label>
                  <input type="text" class="form-input" value="${isEdit ? Utils.escapeHtml(scr.scrNumber) : 'Auto-generated on submit'}" readonly style="opacity:0.7">
                </div>
                <div class="form-group">
                  <label class="form-label">Date</label>
                  <input type="text" class="form-input" value="${Utils.formatDate(isEdit ? scr.scrDate : Utils.today())}" readonly style="opacity:0.7">
                </div>
              </div>
            `}
          </div>
        </div>

        <!-- ━━━━━━ SECTION 2: PROJECT DETAILS ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">2</span>
            <span>Project Details</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Request Type <span class="required">*</span></label>
                <select class="form-select" id="scr-type" required ${isEdit && !Auth.canPerformAction('edit_scr') ? 'disabled' : ''}>
                  <option value="">Select type...</option>
                  <option value="New" ${scr.requestType === 'New' ? 'selected' : ''}>New Development</option>
                  <option value="Modification" ${scr.requestType === 'Modification' ? 'selected' : ''}>Modification</option>
                  <option value="Report" ${scr.requestType === 'Report' ? 'selected' : ''}>Report</option>
                  <option value="Other" ${scr.requestType === 'Other' ? 'selected' : ''}>Other</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Intervention <span class="required">*</span></label>
                <select class="form-select" id="scr-intervention" required>
                  <option value="">Select intervention...</option>
                  <option value="Emergency" ${(scr.intervention||scr.priority) === 'Emergency' ? 'selected' : ''}>🔴 Emergency</option>
                  <option value="Urgent" ${(scr.intervention||scr.priority) === 'Urgent' ? 'selected' : ''}>🟡 Urgent</option>
                  <option value="Routine" ${(scr.intervention||scr.priority) === 'Routine' ? 'selected' : ''}>🔵 Routine</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- ━━━━━━ SECTION 3: REQUEST DESCRIPTION ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">3</span>
            <span>Request Description</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-group">
              <label class="form-label">Module Name <span class="required">*</span></label>
              <input type="text" class="form-input" id="scr-module" value="${Utils.escapeHtml(scr.moduleName || '')}" placeholder="e.g., Billing System, OPD Module, LIS Integration" required>
            </div>
            <div class="form-group">
              <label class="form-label">Detailed Description of Change <span class="required">*</span></label>
              <textarea class="form-textarea" id="scr-desc" rows="4" required placeholder="Explain the overall change request clearly...">${Utils.escapeHtml(scr.description || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- ━━━━━━ SECTION 4: REASON FOR CHANGE ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">4</span>
            <span>Reason for Change</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-group">
              <label class="form-label">Business Justification</label>
              <textarea class="form-textarea" id="scr-reason" rows="2" placeholder="Why is this change needed? Business impact...">${Utils.escapeHtml(scr.reasonForChange || '')}</textarea>
            </div>
          </div>
        </div>

        ${isRequester ? '' : `
        <!-- ━━━━━━ SECTION 5: ATTACHMENTS ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">5</span>
            <span>Attachments</span>
            <span class="scr-section-hint">Up to 6 files</span>
          </div>
          <div class="scr-form-section-body">
            <div id="attachments-container">
              ${this._renderAttachmentSlots(scr.attachments || [])}
            </div>
            <button type="button" class="btn btn-ghost btn-sm mt-2" onclick="SCRManager.addAttachmentSlot()">+ Add Attachment</button>
          </div>
        </div>
        `}

        <!-- ━━━━━━ SECTION 6: END USER DETAILS ━━━━━━ -->
        <div class="scr-form-section">
          <div class="scr-form-section-title">
            <span class="scr-section-num">6</span>
            <span>End User Details</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Requested By <span class="required">*</span></label>
                ${isAdmin ? this._renderSelectWithOther({
                  id: 'scr-requested-by',
                  options: Store.getAll('users').map(u => ({ value: u.name, label: u.name + (u.department ? ` (${u.department})` : '') })),
                  selectedValue: defaultRequestedBy,
                  placeholder: 'Select requester...',
                  allowOther: true,
                  required: true
                }) : `<input type="text" class="form-input" id="scr-requested-by" value="${Utils.escapeHtml(defaultRequestedBy)}" placeholder="Full name of requester" ${isRequester ? 'readonly' : ''} required>`}
              </div>
              <div class="form-group">
                <label class="form-label">Department Name <span class="required">*</span></label>
                <select class="form-select" id="scr-dept" required onchange="SCRManager.onDeptChange()">
                  <option value="">Select department...</option>
                  ${depts.map(d => `<option value="${Utils.escapeHtml(d.name)}" ${(defaultDept === d.name) ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            ${isRequester ? `
              <!-- Received By / Coordinated By are IT-internal fields; filled during review -->
              <input type="hidden" id="scr-received-by" value="${Utils.escapeHtml(scr.receivedBy || '')}">
              <input type="hidden" id="scr-coordinated-by" value="${Utils.escapeHtml(scr.coordinatedBy || '')}">
            ` : `
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Received By</label>
                  <input type="text" class="form-input" id="scr-received-by" value="${Utils.escapeHtml(scr.receivedBy || '')}" placeholder="IT staff who received the request">
                  <span class="form-hint">Auto-filled with the impl team member who accepts the request (Stage 1 → 2)</span>
                </div>
                <div class="form-group">
                  <label class="form-label">Coordinated By</label>
                  ${isAdmin ? this._renderSelectWithOther({
                    id: 'scr-coordinated-by',
                    options: Store.filter('users', u => u.role === 'implementation' || u.role === 'admin').map(u => ({ value: u.name, label: u.name })),
                    selectedValue: scr.coordinatedBy || '',
                    placeholder: 'Select coordinator...',
                    allowOther: true
                  }) : `<input type="text" class="form-input" id="scr-coordinated-by" value="${Utils.escapeHtml(scr.coordinatedBy || '')}" placeholder="IT coordinator name">`}
                  <span class="form-hint">Auto-filled from department · editable if a different coordinator is handling this SCR</span>
                </div>
              </div>
            `}
            <div class="form-group" style="max-width:400px">
              <label class="form-label">Department HOD</label>
              <input type="text" class="form-input" id="scr-hod" value="${Utils.escapeHtml(scr.hodName || '')}" readonly placeholder="Auto-filled from department">
              <span class="form-hint">Auto-fetched when department is selected</span>
            </div>
          </div>
        </div>

        <!-- ━━━━━━ SECTION 7: STUDY DETAILS (Implementation Team) / DEVELOPER ASSIGNMENT (Project Head) ━━━━━━ -->
        ${isImpl ? `
        <div class="scr-form-section scr-section-impl">
          <div class="scr-form-section-title">
            <span class="scr-section-num impl">7</span>
            <span>Study Details</span>
            <span class="scr-section-role-badge">Implementation Team</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Study Done By (Primary)</label>
                ${this._renderSelectWithOther({
                  id: 'scr-study-primary',
                  options: impTeam.map(u => ({ value: u.name, label: u.name })),
                  selectedValue: defaultStudyPrimary,
                  placeholder: 'Select primary analyst...',
                  allowOther: isAdmin
                })}
              </div>
              <div class="form-group">
                <label class="form-label">Study Done By (Secondary)</label>
                ${this._renderSelectWithOther({
                  id: 'scr-study-secondary',
                  options: impTeam.map(u => ({ value: u.name, label: u.name })),
                  selectedValue: scr.studyDoneBySecondary || '',
                  placeholder: 'Select secondary analyst...',
                  allowOther: isAdmin
                })}
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Assigned Developer 1</label>
                ${this._renderSelectWithOther({
                  id: 'scr-developer',
                  options: devs.map(d => ({ value: d.id, label: d.name })),
                  selectedValue: scr.assignedDeveloper || '',
                  placeholder: 'Select developer...',
                  allowOther: isAdmin
                })}
              </div>
              <div class="form-group">
                <label class="form-label">Assigned Developer 2</label>
                ${this._renderSelectWithOther({
                  id: 'scr-developer2',
                  options: devs.map(d => ({ value: d.id, label: d.name })),
                  selectedValue: scr.assignedDeveloper2 || '',
                  placeholder: 'Select developer...',
                  allowOther: isAdmin
                })}
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Study Date From</label>
                <input type="date" class="form-input" id="scr-study-from" value="${scr.studyDateFrom || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Study Date To</label>
                <input type="date" class="form-input" id="scr-study-to" value="${scr.studyDateTo || ''}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Assigned On</label>
                <input type="date" class="form-input" id="scr-assigned-on" value="${scr.assignedOn || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Schedule Date</label>
                <input type="date" class="form-input" id="scr-schedule" value="${scr.scheduleDate || ''}">
              </div>
            </div>
            <div class="form-group" style="max-width:400px">
              <label class="form-label">Completed On</label>
              <input type="date" class="form-input" id="scr-completed-on" value="${scr.completedOn || ''}">
            </div>
            <!-- Duplicate check -->
            <div id="duplicate-warning" class="hidden" style="background:var(--color-warning-subtle);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-lg);padding:var(--space-4);">
              <p class="font-semi text-warning mb-2">⚠️ Possible Duplicates Detected</p>
              <div id="duplicate-list"></div>
            </div>
          </div>
        </div>
        ` : isPH ? `
        <div class="scr-form-section scr-section-impl">
          <div class="scr-form-section-title">
            <span class="scr-section-num impl">7</span>
            <span>Developer Assignment & Timeline</span>
            <span class="scr-section-role-badge">Project Head</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Assigned Developer 1 <span class="required">*</span></label>
                ${this._renderSelectWithOther({
                  id: 'scr-developer',
                  options: devs.map(d => ({ value: d.id, label: d.name })),
                  selectedValue: scr.assignedDeveloper || '',
                  placeholder: 'Select developer...',
                  allowOther: isAdmin,
                  required: true
                })}
              </div>
              <div class="form-group">
                <label class="form-label">Assigned Developer 2</label>
                ${this._renderSelectWithOther({
                  id: 'scr-developer2',
                  options: devs.map(d => ({ value: d.id, label: d.name })),
                  selectedValue: scr.assignedDeveloper2 || '',
                  placeholder: 'Select developer...',
                  allowOther: isAdmin
                })}
              </div>
            </div>

            <!-- Project Head: development timeline -->
            <div style="margin-top:var(--space-4);padding:var(--space-4);background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg)">
              <p class="font-semi text-sm" style="margin-bottom:var(--space-3)">📅 Development Timeline</p>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Assigned On</label>
                  <input type="date" class="form-input" id="scr-assigned-on" value="${scr.assignedOn || Utils.today()}">
                </div>
                <div class="form-group">
                  <label class="form-label">Schedule Date (target completion)</label>
                  <input type="date" class="form-input" id="scr-schedule" value="${scr.scheduleDate || ''}">
                </div>
              </div>
              <div class="form-group" style="max-width:400px">
                <label class="form-label">Completed On</label>
                <input type="date" class="form-input" id="scr-completed-on" value="${scr.completedOn || ''}">
                <p class="form-help">Leave empty until QA sign-off. Developer posts progress updates during development.</p>
              </div>
            </div>

            <input type="hidden" id="scr-study-primary" value="${Utils.escapeHtml(scr.studyDoneByPrimary || '')}">
            <input type="hidden" id="scr-study-secondary" value="${Utils.escapeHtml(scr.studyDoneBySecondary || '')}">
            <input type="hidden" id="scr-study-from" value="${scr.studyDateFrom || ''}">
            <input type="hidden" id="scr-study-to" value="${scr.studyDateTo || ''}">
          </div>
        </div>
        ` : isInternalReq ? `
        <!-- Internal Requester: pre-fills technical fields normally captured by Impl + PH later -->
        <div class="scr-form-section scr-section-impl">
          <div class="scr-form-section-title">
            <span class="scr-section-num impl">7</span>
            <span>Study & Assignment Details</span>
            <span class="scr-section-role-badge">Internal Requester</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Study Done By (Primary)</label>
                <input type="text" class="form-input" id="scr-study-primary" value="${Utils.escapeHtml(scr.studyDoneByPrimary || '')}" placeholder="Name of primary analyst">
              </div>
              <div class="form-group">
                <label class="form-label">Study Done By (Secondary)</label>
                <input type="text" class="form-input" id="scr-study-secondary" value="${Utils.escapeHtml(scr.studyDoneBySecondary || '')}" placeholder="Name of secondary analyst">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Assigned Developer 1</label>
                <select class="form-select" id="scr-developer">
                  <option value="">Select developer...</option>
                  ${devs.map(d => `<option value="${d.id}" ${scr.assignedDeveloper === d.id ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Assigned Developer 2</label>
                <select class="form-select" id="scr-developer2">
                  <option value="">Select developer...</option>
                  ${devs.map(d => `<option value="${d.id}" ${scr.assignedDeveloper2 === d.id ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Study Date From</label>
                <input type="date" class="form-input" id="scr-study-from" value="${scr.studyDateFrom || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Study Date To</label>
                <input type="date" class="form-input" id="scr-study-to" value="${scr.studyDateTo || ''}">
              </div>
            </div>
            <div style="margin-top:var(--space-4);padding:var(--space-4);background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg)">
              <p class="font-semi text-sm" style="margin-bottom:var(--space-3)">📅 Development Timeline</p>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Assigned On</label>
                  <input type="date" class="form-input" id="scr-assigned-on" value="${scr.assignedOn || ''}">
                </div>
                <div class="form-group">
                  <label class="form-label">Schedule Date (target completion)</label>
                  <input type="date" class="form-input" id="scr-schedule" value="${scr.scheduleDate || ''}">
                </div>
              </div>
              <div class="form-group" style="max-width:400px">
                <label class="form-label">Completed On</label>
                <input type="date" class="form-input" id="scr-completed-on" value="${scr.completedOn || ''}">
                <p class="form-help">Usually filled at QA sign-off — leave empty if not yet completed.</p>
              </div>
            </div>
            <div class="form-group" style="max-width:400px;margin-top:var(--space-4)">
              <label class="form-label">Project Head Name</label>
              <input type="text" class="form-input" id="scr-ph-name" value="${Utils.escapeHtml(scr.projectHeadName || 'Mr. Panneer Selvan')}" placeholder="Project Head full name">
            </div>
          </div>
        </div>
        ` : `<input type="hidden" id="scr-developer" value="${Utils.escapeHtml(scr.assignedDeveloper || '')}">
             <input type="hidden" id="scr-developer2" value="${Utils.escapeHtml(scr.assignedDeveloper2 || '')}">
             <input type="hidden" id="scr-study-primary" value="">
             <input type="hidden" id="scr-study-secondary" value="">
             <input type="hidden" id="scr-assigned-on" value="${scr.assignedOn || ''}">
             <input type="hidden" id="scr-study-from" value="${scr.studyDateFrom || ''}">
             <input type="hidden" id="scr-study-to" value="${scr.studyDateTo || ''}">
             <input type="hidden" id="scr-schedule" value="${scr.scheduleDate || ''}">
             <input type="hidden" id="scr-completed-on" value="${scr.completedOn || ''}">`}

        <!-- ━━━━━━ SECTION 8: APPROVAL SECTION (Approvers) ━━━━━━ -->
        ${isApprover ? `
        <div class="scr-form-section scr-section-approval">
          <div class="scr-form-section-title">
            <span class="scr-section-num approval">8</span>
            <span>Approval Section</span>
            <span class="scr-section-role-badge approval">Approvers Only</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-group">
              <label class="form-label">Approval Decision</label>
              <div class="approval-radio-group">
                <label class="approval-radio-option">
                  <input type="radio" name="scr-approval" value="Approved" ${scr.approvalStatus === 'Approved' ? 'checked' : ''}>
                  <span class="approval-radio-inner approved">✓ Approved</span>
                </label>
                <label class="approval-radio-option">
                  <input type="radio" name="scr-approval" value="Not Approved" ${scr.approvalStatus === 'Not Approved' ? 'checked' : ''}>
                  <span class="approval-radio-inner rejected">✕ Not Approved</span>
                </label>
                <label class="approval-radio-option">
                  <input type="radio" name="scr-approval" value="Hold" ${scr.approvalStatus === 'Hold' ? 'checked' : ''}>
                  <span class="approval-radio-inner hold">⏸ Hold</span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Reason for Decision</label>
              <textarea class="form-textarea" id="scr-approval-reason" rows="2" placeholder="Explain the approval decision...">${Utils.escapeHtml(scr.approvalReason || '')}</textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Project Head Name</label>
                <input type="text" class="form-input" id="scr-ph-name" value="${Utils.escapeHtml(scr.projectHeadName || 'Mr. Panneer Selvan')}" placeholder="Project Head full name">
              </div>
              <div class="form-group">
                <label class="form-label">AGM – IT Name</label>
                <input type="text" class="form-input" id="scr-agm-name" value="${Utils.escapeHtml(scr.agmItName || 'Mr. S. Saravanakumar')}" placeholder="AGM IT full name">
              </div>
            </div>
            <div class="form-group" style="max-width:400px">
              <label class="form-label">CIO Name</label>
              <input type="text" class="form-input" id="scr-cio-name" value="${Utils.escapeHtml(scr.cioName || 'Mr. Biju Velayudhan')}" placeholder="CIO full name">
            </div>
          </div>
        </div>
        ` : ''}

        <!-- ━━━━━━ SECTION 9: REVIEW REMARKS (Project Head + Approvers) ━━━━━━ -->
        ${isApprover || isPH ? `
        <div class="scr-form-section scr-section-approval">
          <div class="scr-form-section-title">
            <span class="scr-section-num approval">9</span>
            <span>Review Remarks</span>
            <span class="scr-section-role-badge approval">Project Head, AGM-IT, CIO</span>
          </div>
          <div class="scr-form-section-body">
            <div class="form-group">
              <label class="form-label">Project Head Remarks ${isPH ? '<span class="required">*</span>' : ''}</label>
              <textarea class="form-textarea" id="scr-remark-ph" rows="3" placeholder="Review findings, recommendations, developer assignment rationale..." ${!Auth.hasRole('project_head','admin') ? 'readonly style="opacity:0.7"' : ''}>${Utils.escapeHtml(scr.remarkProjectHead || '')}</textarea>
              ${!Auth.hasRole('project_head','admin') ? '<span class="form-hint">Read-only — only the Project Head can edit this field</span>' : '<span class="form-hint">Write your review remarks before advancing to Management Approval</span>'}
            </div>
            <div class="form-group">
              <label class="form-label">AGM – IT Remarks</label>
              <textarea class="form-textarea" id="scr-remark-agm" rows="3" placeholder="AGM-IT approval comments..." ${!Auth.hasRole('agm_it','admin') ? 'readonly style="opacity:0.7"' : ''}>${Utils.escapeHtml(scr.remarkAgmIt || '')}</textarea>
              ${!Auth.hasRole('agm_it','admin') ? '<span class="form-hint">Read-only — only AGM-IT can edit this field</span>' : ''}
            </div>
            <div class="form-group">
              <label class="form-label">CIO Remarks</label>
              <textarea class="form-textarea" id="scr-remark-cio" rows="3" placeholder="CIO approval comments..." ${!Auth.hasRole('cio','admin') ? 'readonly style="opacity:0.7"' : ''}>${Utils.escapeHtml(scr.remarkCio || '')}</textarea>
              ${!Auth.hasRole('cio','admin') ? '<span class="form-hint">Read-only — only the CIO can edit this field</span>' : ''}
            </div>
          </div>
        </div>
        ` : ''}

        <!-- ━━━━━━ SECTION 10: FOOTER ━━━━━━ -->
        <div class="scr-form-footer-note">
          <span class="scr-footer-icon">🏥</span>
          <p>"Behind every system change is a push for better healthcare delivery."</p>
        </div>

        <!-- Submit / Save -->
        <div class="flex justify-between items-center mt-6">
          <button type="button" class="btn btn-ghost" onclick="Router.goBack()" title="Discard changes and go back">← Cancel</button>
          <button type="submit" class="btn btn-success btn-lg" id="scr-submit-btn">
            ${isEdit ? '💾 Update SCR' : '📋 Submit SCR'}
          </button>
        </div>

      </form>
    `;
  },

  // ── Attachment slot renderer ─────────────────────────────
  _renderAttachmentSlots(attachments) {
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const att = attachments[i] || { name: '', url: '' };
      slots.push(`
        <div class="attachment-slot" id="att-slot-${i}">
          <span class="att-slot-num">${i + 1}.</span>
          <input type="text" class="form-input att-name" id="att-name-${i}" value="${Utils.escapeHtml(att.name)}" placeholder="Attachment description / filename" style="flex:1">
          ${i >= (attachments.length || 0) ? `<button type="button" class="btn btn-ghost btn-sm" onclick="SCRManager.removeAttachmentSlot(${i})" style="color:var(--color-danger);padding:0 var(--space-2)">✕</button>` : ''}
        </div>
      `);
    }
    // Only show filled slots + 1 empty
    const filled = attachments.length;
    return slots.slice(0, Math.min(filled + 1, 6)).join('');
  },

  _attachmentCount: 1,

  addAttachmentSlot() {
    const container = document.getElementById('attachments-container');
    if (!container) return;
    const existing = container.querySelectorAll('.attachment-slot').length;
    if (existing >= 6) { Utils.toast('warning', 'Max Attachments', 'You can attach up to 6 files'); return; }
    const i = existing;
    const slot = document.createElement('div');
    slot.className = 'attachment-slot';
    slot.id = `att-slot-${i}`;
    slot.innerHTML = `
      <span class="att-slot-num">${i + 1}.</span>
      <input type="text" class="form-input att-name" id="att-name-${i}" placeholder="Attachment description / filename" style="flex:1">
      <button type="button" class="btn btn-ghost btn-sm" onclick="SCRManager.removeAttachmentSlot(${i})" style="color:var(--color-danger);padding:0 var(--space-2)">✕</button>
    `;
    container.appendChild(slot);
  },

  removeAttachmentSlot(i) {
    document.getElementById(`att-slot-${i}`)?.remove();
  },

  _collectAttachments(fallbackAttachments) {
    const slots = document.querySelectorAll('.att-name');
    // If section isn't rendered (e.g. hidden for requesters), preserve what was there
    if (slots.length === 0 && Array.isArray(fallbackAttachments)) return fallbackAttachments;
    const result = [];
    slots.forEach(s => { if (s.value.trim()) result.push({ name: s.value.trim(), url: '' }); });
    return result;
  },

  postRenderForm() {
    // Auto-fill HOD if dept is pre-selected
    this.onDeptChange();
  },

  // ── Reusable: dropdown with admin-only "Other" free-text fallback ─
  // opts = { id, options: [{value,label}], selectedValue, placeholder, allowOther, required }
  // Renders the <select> + a hidden text input that toggles in when "Other"
  // is picked. When the selected value doesn't match any option (e.g. a
  // previously-typed custom name on an SCR being edited), it starts in
  // free-text mode so the value is preserved across edits.
  _renderSelectWithOther(opts) {
    const { id, options, selectedValue, placeholder, allowOther, required } = opts;
    const sel = selectedValue || '';
    const matchesOption = options.some(o => o.value === sel);
    const startInOther = !!allowOther && !matchesOption && !!sel;
    const dropdownValue = startInOther ? '__other__' : sel;

    const optsHtml = options.map(o =>
      `<option value="${Utils.escapeHtml(o.value)}" ${dropdownValue === o.value ? 'selected' : ''}>${Utils.escapeHtml(o.label)}</option>`
    ).join('');
    const otherOpt = allowOther
      ? `<option value="__other__" ${dropdownValue === '__other__' ? 'selected' : ''}>➕ Other (custom)…</option>`
      : '';
    const onchange = allowOther ? `onchange="SCRManager.toggleOtherInput('${id}')"` : '';
    const req = required ? 'required' : '';

    const otherInputHtml = allowOther ? `
      <input type="text" class="form-input" id="${id}__other"
             value="${Utils.escapeHtml(startInOther ? sel : '')}"
             placeholder="Enter custom name"
             style="margin-top:6px;display:${dropdownValue === '__other__' ? 'block' : 'none'}">
    ` : '';

    return `
      <select class="form-select" id="${id}" ${onchange} ${req}>
        <option value="">${Utils.escapeHtml(placeholder || 'Select...')}</option>
        ${optsHtml}
        ${otherOpt}
      </select>
      ${otherInputHtml}
    `;
  },

  // onchange handler for selects rendered via _renderSelectWithOther
  toggleOtherInput(id) {
    const sel = document.getElementById(id);
    const txt = document.getElementById(id + '__other');
    if (!sel || !txt) return;
    if (sel.value === '__other__') {
      txt.style.display = 'block';
      txt.focus();
    } else {
      txt.style.display = 'none';
    }
  },

  // Reads the effective value of a select that may have an "Other" branch.
  // Returns the typed free-text value when "__other__" is selected, else
  // the dropdown's plain value. Works for plain <select>s too.
  _readSelectVal(id) {
    const sel = document.getElementById(id);
    if (!sel) return '';
    if (sel.value === '__other__') {
      const txt = document.getElementById(id + '__other');
      return txt ? txt.value.trim() : '';
    }
    return sel.value;
  },

  // ── Department change handler ───────────────────────────
  onDeptChange() {
    const deptName = document.getElementById('scr-dept')?.value;
    if (!deptName) return;
    const dept = Store.getAll('departments').find(d => d.name === deptName);
    if (!dept) return;

    // HOD auto-fill
    const hodField = document.getElementById('scr-hod');
    if (hodField) hodField.value = dept.hodName || '';

    // IT Coordinator auto-fill — only overwrite if currently empty,
    // so a manually-typed coordinator isn't wiped when dept is re-selected.
    // Coordinator field can be either an <input> (non-admin) or a <select>
    // with an "Other" branch (admin); handle both.
    const coordField = document.getElementById('scr-coordinated-by');
    if (!coordField) return;
    const target = dept.coordinatorName || '';
    if (coordField.tagName === 'SELECT') {
      const current = this._readSelectVal('scr-coordinated-by').trim();
      if (!current && target) {
        const match = Array.from(coordField.options).find(o => o.value === target);
        if (match) {
          coordField.value = target;
          this.toggleOtherInput('scr-coordinated-by');
        } else {
          coordField.value = '__other__';
          const txt = document.getElementById('scr-coordinated-by__other');
          if (txt) { txt.value = target; txt.style.display = 'block'; }
        }
      }
    } else if (!coordField.value.trim()) {
      coordField.value = target;
    }
  },

  // ── Duplicate check ─────────────────────────────────────
  checkDuplicates() {
    const desc = document.getElementById('scr-desc')?.value;
    if (!desc) return;

    const existing = Store.filter('scr_requests', s => s.status !== 'Closed' && s.status !== 'Rejected');
    const dupes = existing.filter(s => Utils.similarity(s.description, desc) > 0.4);

    const warning = document.getElementById('duplicate-warning');
    const list = document.getElementById('duplicate-list');
    if (dupes.length > 0 && warning && list) {
      warning.classList.remove('hidden');
      list.innerHTML = dupes.map(d => `
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-medium text-brand">${d.scrNumber}</span>
          <span class="text-xs text-secondary">${Utils.truncate(d.description, 50)}</span>
          ${Utils.statusBadge(d.status)}
        </div>
      `).join('');
    }
  },

  // ── Form submit ─────────────────────────────────────────
  handleSubmit(e, editId) {
    e.preventDefault();

    // getVal handles both plain inputs/selects AND the "Other → free text"
    // pattern. If the element's value is "__other__" it reads the paired
    // <id>__other text input instead, so admin-typed custom names flow
    // through transparently with no per-field special casing below.
    //
    // Returns undefined (not '') when the element isn't in the DOM at all,
    // so we can strip it from the update payload and let Store.update's
    // spread-merge preserve whatever's already on the SCR. Matters for the
    // internal_requester edit path: their form doesn't include the approval
    // or remark fields, and we don't want those silently wiped.
    const getVal = (id) => {
      const el = document.getElementById(id);
      if (!el) return undefined;
      if (el.value === '__other__') {
        const txt = document.getElementById(id + '__other');
        return txt ? txt.value.trim() : '';
      }
      return el.value;
    };
    const getRadio = (name) => {
      const checked = document.querySelector(`input[name="${name}"]:checked`);
      if (checked) return checked.value;
      // No radio with this name at all → not in this role's form → preserve.
      // Some but unselected → '' (user actively cleared it).
      return document.querySelector(`input[name="${name}"]`) ? '' : undefined;
    };

    // Preserve existing attachments if section was hidden for this role
    const existing = editId ? (Store.getById('scr_requests', editId) || {}) : {};

    const data = {
      // Section 2 — defaults applied when hidden for requester
      requestType: getVal('scr-type') || 'New',
      intervention: getVal('scr-intervention') || 'Routine',
      priority: getVal('scr-intervention') || 'Routine',
      // Section 3
      moduleName: getVal('scr-module'),
      description: getVal('scr-desc'),
      // Section 4
      reasonForChange: getVal('scr-reason'),
      // Section 5 — fall back to existing attachments when section is hidden
      attachments: this._collectAttachments(existing.attachments),
      // Section 6
      requestedBy: getVal('scr-requested-by'),
      receivedBy: getVal('scr-received-by'),
      coordinatedBy: getVal('scr-coordinated-by'),
      department: getVal('scr-dept'),
      hodName: getVal('scr-hod'),
      // Section 7 (impl team only)
      studyDoneByPrimary: getVal('scr-study-primary'),
      studyDoneBySecondary: getVal('scr-study-secondary'),
      assignedDeveloper: getVal('scr-developer'),
      assignedDeveloper2: getVal('scr-developer2'),
      assignedOn: getVal('scr-assigned-on') || (getVal('scr-developer') ? Utils.today() : null),
      studyDateFrom: getVal('scr-study-from') || (getVal('scr-study-primary') ? Utils.today() : null),
      studyDateTo: getVal('scr-study-to') || (getVal('scr-study-primary') ? (getVal('scr-study-from') || Utils.today()) : null),
      scheduleDate: getVal('scr-schedule') || null,
      completedOn: getVal('scr-completed-on') || null,
      // Section 8 (approvers)
      approvalStatus: getRadio('scr-approval'),
      approvalReason: getVal('scr-approval-reason'),
      projectHeadName: getVal('scr-ph-name'),
      agmItName: getVal('scr-agm-name'),
      cioName: getVal('scr-cio-name'),
      // Section 9
      remarkProjectHead: getVal('scr-remark-ph'),
      remarkAgmIt: getVal('scr-remark-agm'),
      remarkCio: getVal('scr-remark-cio'),
    };

    // Validate required (trim-aware — whitespace alone is not valid)
    const requiredFields = [
      ['requestType',  'Request Type'],
      ['intervention', 'Intervention'],
      ['department',   'Department'],
      ['description',  'Description'],
      ['moduleName',   'Module'],
      ['requestedBy',  'Requested By']
    ];
    const missing = requiredFields.filter(([k]) => !Utils.isNonEmpty(data[k])).map(([, l]) => l);
    if (missing.length > 0) {
      Utils.toast('error', 'Validation Error', `Please fill: ${missing.join(', ')}`);
      return;
    }

    // Date range sanity — studyDateFrom <= studyDateTo
    if (!Utils.isDateRangeValid(data.studyDateFrom, data.studyDateTo)) {
      Utils.toast('error', 'Invalid Date Range', 'Study Date To must be on or after Study Date From.');
      return;
    }

    // Trim all string fields to prevent whitespace-only values sneaking through
    Object.keys(data).forEach(k => {
      if (typeof data[k] === 'string') data[k] = data[k].trim();
    });

    // Drop undefined keys so update payloads don't wipe fields the current
    // role's form didn't render (e.g. internal_requester never sees the
    // Approval section, so its agm/cio/remark fields should be preserved).
    Object.keys(data).forEach(k => {
      if (data[k] === undefined) delete data[k];
    });

    let result;
    // Detect special-flow modes:
    //  • minimal-shell (legacy Track/Feedback popup tabs)
    //  • new-tab flow from requester Home "New Request" (full shell, but
    //    needs to show success modal + redirect to Home instead of scr-detail)
    const isMinimal = document.body.dataset.mode === 'minimal';
    const isNewTabFlow = sessionStorage.getItem('scr-new-tab-flow') === '1';
    const useSuccessModal = isMinimal || isNewTabFlow;

    if (editId) {
      result = this.updateSCR(editId, data);
      if (result.success) {
        if (useSuccessModal && typeof SelfService !== 'undefined' && SelfService.showSuccessModal) {
          sessionStorage.removeItem('scr-new-tab-flow');
          SelfService.showSuccessModal({
            icon: '✏️',
            title: 'Your Changes Have Been Saved',
            message: `${result.scr.scrNumber} has been updated. The team will be notified of the changes.`,
            buttonLabel: 'Back to Home →'
          });
        } else {
          Utils.toast('success', 'SCR Updated', `${result.scr.scrNumber} has been updated`);
          Router.navigate('scr-detail', { id: editId });
        }
      }
    } else {
      result = this.createSCR(data);
      if (result.success) {
        let msg = `${result.scr.scrNumber} created successfully`;
        if (result.duplicates.length > 0) msg += ` (${result.duplicates.length} possible duplicates found)`;

        if (useSuccessModal && typeof SelfService !== 'undefined' && SelfService.showSuccessModal) {
          sessionStorage.removeItem('scr-new-tab-flow');
          SelfService.showSuccessModal({
            icon: '🎉',
            title: 'Your Request Has Been Submitted',
            message: `${result.scr.scrNumber} is now in our queue. Our IT team will review it and you'll be notified at each stage — from review to delivery.${result.duplicates.length > 0 ? ` (Note: ${result.duplicates.length} similar requests already exist.)` : ''}`,
            buttonLabel: 'Back to Home →'
          });
        } else {
          Utils.toast('success', 'SCR Created', msg);
          Router.navigate('scr-detail', { id: result.scr.id });
        }
      }
    }

    if (!result.success) {
      Utils.toast('error', 'Error', result.error || 'Submission failed');
    }
  },

  // ── Print SCR as A4 form ────────────────────────────────
  printSCR(scrId) {
    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return;

    const dev1  = scr.assignedDeveloper  ? Store.getById('users', scr.assignedDeveloper)  : null;
    const dev2  = scr.assignedDeveloper2 ? Store.getById('users', scr.assignedDeveloper2) : null;

    const approvals   = Store.filter('approvals', a => a.scrId === scrId);
    const agmDecision = approvals.find(a => a.approverRole === 'agm_it');
    const cioDecision = approvals.find(a => a.approverRole === 'cio');

    // Approval state — only one of these ticks. Two signals can set it:
    //   (a) workflow approvals table (AGM + CIO clicked Approve/Reject) — Stage 4 flow
    //   (b) scr.approvalStatus set directly via the SCR form (admin override / pre-workflow data)
    // If both exist, the direct status wins (admin's explicit choice).
    const directStatus = scr.approvalStatus || '';
    const isApproved =
      directStatus === 'Approved' ||
      (directStatus === '' && agmDecision?.decision === 'Approved' && cioDecision?.decision === 'Approved');
    const isRejected =
      directStatus === 'Not Approved' ||
      (directStatus === '' && (agmDecision?.decision === 'Rejected' || cioDecision?.decision === 'Rejected'));
    const isHold =
      !isApproved && !isRejected && (
        directStatus === 'Hold' ||
        agmDecision?.decision === 'Hold' ||
        cioDecision?.decision === 'Hold' ||
        scr.status === 'On Hold'
      );

    const esc = (v) => (v || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmt = (d) => d ? Utils.formatDate(d) : '';
    const naIfEmpty = (v) => (v && String(v).trim()) ? v : 'NA';

    const approvalReason = scr.approvalReason || scr.remarkProjectHead || agmDecision?.comments || cioDecision?.comments || '';

    const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(scr.scrNumber)} — SCR Form</title>
<style>
  /* Symmetric @page margin = content centred on the sheet */
  @page { size: A4 portrait; margin: 12mm; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body { width: 100%; margin: 0; padding: 0; }

  body {
    font-family: 'Calibri', 'Segoe UI', Arial, Helvetica, sans-serif;
    /* Default font-size = VALUE size. Labels + headers are sized down below. */
    font-size: 14px;
    color: #000;
    background: #fff;
    line-height: 1.4;
  }

  /* Outer wrapper forces horizontal centring even when the browser
     gives the body extra space (some print previews add edge padding) */
  .page-wrap {
    width: 100%;
    margin: 0 auto;
    padding: 0;
  }

  /* ── TITLE BANNER ── */
  .title-banner {
    border: 2px solid #4a6b1e;
    text-align: center;
    padding: 8px;
    margin: 0;
  }
  .title-banner h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #000;
  }

  /* ── ALL FORM TABLES ── */
  /* table-layout: fixed + explicit column widths means the columns NEVER
     re-flow based on content. Long content stays inside its cell. */
  table.f {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    page-break-inside: avoid;   /* don't split any section across pages */
    /* -1px overlaps the bottom border of this table with the top border
       of the next, so adjacent sections share a single border line and
       read as one continuous paper form. */
    margin-bottom: -1px;
  }
  /* The title banner sits flush against the first table */
  .title-banner + table.f { margin-top: 0; }
  table.f td {
    border: 1px solid #444;
    padding: 5px 10px;
    vertical-align: middle;
    word-wrap: break-word;
    overflow: hidden;
  }

  /* Force a hard page break — used to push Study Details onto page 2 */
  .page-break-before {
    page-break-before: always;
    break-before: page;
  }

  /* Section header row (green band running full width) */
  td.sec {
    background: #a2c878;
    font-weight: 700;
    font-size: 12.5px;
    color: #000;
    padding: 5px 12px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    height: 22px;
  }

  /* Bold label cell with light tint — held at 12px so the bigger value
     text reads as the primary content */
  td.lbl   { font-weight: 700; background: #f4f4f4; font-size: 12px; }
  td.lbl-c { font-weight: 700; background: #f4f4f4; font-size: 12px; text-align: center; }

  /* Centered value cell (names, dates in grid layouts) — inherits 14px */
  td.val-c { text-align: center; vertical-align: middle; }

  /* ── FIXED-HEIGHT CONTENT CELLS ── */
  td.area    { padding: 0; vertical-align: top; height: 155px; }
  td.area-lg { padding: 0; vertical-align: top; height: 155px; }
  td.area-sm { padding: 0; vertical-align: top; height: 62px;  }

  .clip {
    padding: 8px 12px;
    overflow: hidden;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    line-height: 1.5;
    box-sizing: border-box;
  }
  td.area    > .clip { height: 155px; }
  td.area-lg > .clip { height: 155px; }
  td.area-sm > .clip { height: 62px;  }

  /* Single-line rows — sized to fill Page 1 fully while keeping End User on it */
  .row-h-28 td { height: 42px; }
  .row-h-42 td { height: 58px; }
  .row-h-48 td { height: 58px; }

  /* Signature cell for the approver names */
  td.sig { padding: 0; vertical-align: bottom; text-align: center; height: 62px; }
  td.sig > .sig-inner { height: 62px; padding: 0 6px 8px; box-sizing: border-box; display: flex; align-items: flex-end; justify-content: center; word-wrap: break-word; font-size: 13px; font-weight: 600; }

  /* ── APPROVAL STATUS COLOURED CELLS ── */
  /* Each status sits in a fixed-colour cell; the empty cell next to it gets a tick when chosen */
  td.ap-approved   { background: #7fc356; color: #000; text-align: center; font-weight: 700; }
  td.ap-rejected   { background: #f0a050; color: #000; text-align: center; font-weight: 700; }
  td.ap-hold       { background: #5a9fd4; color: #000; text-align: center; font-weight: 700; }
  td.ap-mark { text-align: center; font-weight: 700; font-size: 14px; }

  /* Footer NOTE block */
  .note-body td { font-size: 11.5px; line-height: 1.55; }
  .note-body td.note-lbl { font-weight: 700; width: 24%; vertical-align: top; }
  .quote-row td {
    text-align: center;
    font-style: italic;
    color: #c2185b;
    padding: 12px;
    font-size: 13px;
    background: #fafafa;
  }

  .no-break { page-break-inside: avoid; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>

<div class="page-wrap">

<!-- TITLE -->
<div class="title-banner">
  <h1>SOFTWARE CHANGE REQUEST (SCR) FORM</h1>
</div>

<!-- HEADER ROW: SCR Number + Date -->
<table class="f">
  <colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>
  <tr class="row-h-28">
    <td class="lbl">SCR Number</td>
    <td>${esc(scr.scrNumber)}</td>
    <td class="lbl">Date</td>
    <td>${fmt(scr.scrDate || scr.createdAt)}</td>
  </tr>
</table>

<!-- PROJECT DETAILS -->
<table class="f">
  <colgroup><col style="width:18%"><col style="width:82%"></colgroup>
  <tr><td class="sec" colspan="2">PROJECT DETAILS</td></tr>
  <tr class="row-h-28">
    <td class="lbl">Request Type</td>
    <td>${esc(scr.requestType)}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl">Intervention</td>
    <td>${esc(scr.intervention || scr.priority)}</td>
  </tr>
</table>

<!-- REQUEST DESCRIPTION -->
<table class="f">
  <colgroup><col style="width:18%"><col style="width:82%"></colgroup>
  <tr><td class="sec" colspan="2">REQUEST DESCRIPTION</td></tr>
  <tr class="row-h-28">
    <td class="lbl">Module Name</td>
    <td>${esc(scr.moduleName)}</td>
  </tr>
  <tr>
    <td colspan="2" class="area"><div class="clip">${esc(scr.description)}</div></td>
  </tr>
</table>

<!-- REASON FOR CHANGE -->
<table class="f">
  <tr><td class="sec">REASON FOR CHANGE</td></tr>
  <tr>
    <td class="area-lg"><div class="clip">${esc(scr.reasonForChange)}</div></td>
  </tr>
</table>

<!-- ATTACHMENTS — 2x3 grid (1-3 left, 4-6 right) -->
<table class="f">
  <colgroup><col style="width:6%"><col style="width:44%"><col style="width:6%"><col style="width:44%"></colgroup>
  <tr><td class="sec" colspan="4">ATTACHMENTS</td></tr>
  <tr class="row-h-28">
    <td class="lbl-c">1.</td>
    <td>${scr.attachments && scr.attachments[0] ? esc(scr.attachments[0].name) : ''}</td>
    <td class="lbl-c">4.</td>
    <td>${scr.attachments && scr.attachments[3] ? esc(scr.attachments[3].name) : ''}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c">2.</td>
    <td>${scr.attachments && scr.attachments[1] ? esc(scr.attachments[1].name) : ''}</td>
    <td class="lbl-c">5.</td>
    <td>${scr.attachments && scr.attachments[4] ? esc(scr.attachments[4].name) : ''}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c">3.</td>
    <td>${scr.attachments && scr.attachments[2] ? esc(scr.attachments[2].name) : ''}</td>
    <td class="lbl-c">6.</td>
    <td>${scr.attachments && scr.attachments[5] ? esc(scr.attachments[5].name) : ''}</td>
  </tr>
</table>

<!-- END USER — single 6-col table so the 3-col + 2-col blocks share borders -->
<table class="f">
  <colgroup>
    <col style="width:16.67%"><col style="width:16.66%"><col style="width:16.67%">
    <col style="width:16.66%"><col style="width:16.67%"><col style="width:16.67%">
  </colgroup>
  <tr><td class="sec" colspan="6">END USER</td></tr>
  <tr class="row-h-28">
    <td class="lbl-c" colspan="2">Requested By</td>
    <td class="lbl-c" colspan="2">Received By</td>
    <td class="lbl-c" colspan="2">Coordinated By</td>
  </tr>
  <tr class="row-h-42">
    <td class="val-c" colspan="2">${esc(scr.requestedBy)}</td>
    <td class="val-c" colspan="2">${esc(scr.receivedBy)}</td>
    <td class="val-c" colspan="2">${esc(scr.coordinatedBy)}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c" colspan="3">Department Name</td>
    <td class="lbl-c" colspan="3">Department HOD</td>
  </tr>
  <tr class="row-h-42">
    <td class="val-c" colspan="3">${esc(scr.department)}</td>
    <td class="val-c" colspan="3">${esc(scr.hodName)}</td>
  </tr>
</table>

<!-- STUDY DETAILS — always begins on page 2 -->
<table class="f page-break-before">
  <colgroup><col style="width:25%"><col style="width:25%"><col style="width:25%"><col style="width:25%"></colgroup>
  <tr><td class="sec" colspan="4">STUDY DETAILS</td></tr>
  <tr class="row-h-28">
    <td class="lbl-c">Study Done by</td>
    <td class="lbl-c">Study Done by</td>
    <td class="lbl-c">Study Date From</td>
    <td class="lbl-c">Study Date To</td>
  </tr>
  <tr class="row-h-48">
    <td class="val-c">${esc(naIfEmpty(scr.studyDoneByPrimary))}</td>
    <td class="val-c">${esc(naIfEmpty(scr.studyDoneBySecondary))}</td>
    <td class="val-c">${fmt(scr.studyDateFrom)}</td>
    <td class="val-c">${fmt(scr.studyDateTo)}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c">Assigned Developer 1</td>
    <td class="lbl-c">Assigned Developer 2</td>
    <td class="lbl-c">Assigned On</td>
    <td class="lbl-c">Schedule On</td>
  </tr>
  <tr class="row-h-48">
    <td class="val-c">${esc(dev1 ? dev1.name : naIfEmpty(scr.assignedDeveloper))}</td>
    <td class="val-c">${esc(dev2 ? dev2.name : naIfEmpty(scr.assignedDeveloper2))}</td>
    <td class="val-c">${fmt(scr.assignedOn)}</td>
    <td class="val-c">${fmt(scr.scheduleDate)}</td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c">Completed On</td>
    <td colspan="3" style="background:#fff"></td>
  </tr>
  <tr class="row-h-42">
    <td class="val-c">${fmt(scr.completedOn)}</td>
    <td colspan="3" style="background:#fff"></td>
  </tr>
</table>

<!-- APPROVALS -->
<table class="f">
  <colgroup><col style="width:16%"><col style="width:17%"><col style="width:16%"><col style="width:17%"><col style="width:16%"><col style="width:18%"></colgroup>
  <tr><td class="sec" colspan="6">APPROVALS</td></tr>
  <tr class="row-h-28">
    <td class="ap-approved">Approved</td>
    <td class="ap-mark">${isApproved ? '✓' : ''}</td>
    <td class="ap-rejected">Not Approved</td>
    <td class="ap-mark">${isRejected ? '✓' : ''}</td>
    <td class="ap-hold">Hold</td>
    <td class="ap-mark">${isHold ? '✓' : ''}</td>
  </tr>
  <tr>
    <td class="lbl" colspan="6" style="padding:0">
      <div class="clip" style="height:38px;background:#f4f4f4"><strong>Reason:</strong> ${esc(approvalReason)}</div>
    </td>
  </tr>
  <tr class="row-h-28">
    <td class="lbl-c" colspan="2">Project Head</td>
    <td class="lbl-c" colspan="2">AGM - IT</td>
    <td class="lbl-c" colspan="2">Chief Information Officer</td>
  </tr>
  <tr>
    <td class="sig" colspan="2"><div class="sig-inner">${esc(scr.projectHeadName || 'Mr. Panneer Selvan')}</div></td>
    <td class="sig" colspan="2"><div class="sig-inner">${esc(scr.agmItName || 'Mr. S. Saravanakumar')}</div></td>
    <td class="sig" colspan="2"><div class="sig-inner">${esc(scr.cioName || 'Mr. Biju Velayudhan')}</div></td>
  </tr>
</table>

<!-- REMARKS -->
<table class="f">
  <tr><td class="sec">REMARKS</td></tr>
  <tr>
    <td class="area-sm" style="background:#fff">
      <div class="clip"><strong>Project Head Remarks:</strong> ${esc(scr.remarkProjectHead)}</div>
    </td>
  </tr>
  <tr>
    <td class="area-sm" style="background:#fff">
      <div class="clip"><strong>AGM IT Remarks:</strong> ${esc(scr.remarkAgmIt || agmDecision?.comments)}</div>
    </td>
  </tr>
  <tr>
    <td class="area-sm" style="background:#fff">
      <div class="clip"><strong>CIO Remarks:</strong> ${esc(scr.remarkCio || cioDecision?.comments)}</div>
    </td>
  </tr>
</table>

<!-- NOTE -->
<table class="f note-body">
  <tr><td class="sec">NOTE:</td></tr>
  <tr>
    <td>
      <strong>Request Description:</strong> Describe the change being requested. Be as specific as possible. If appropriate include technical details, diagrams, and a 'before and after' description.
    </td>
  </tr>
  <tr>
    <td>
      <strong>Reasons for this Change:</strong> Request describe the reasons and the purposes of this request (what is the process or technical driver). Explain the impact of the change request on the Business Case.
    </td>
  </tr>
  <tr class="quote-row">
    <td>Behind every system change is a push for better healthcare delivery.</td>
  </tr>
</table>

</div><!-- /.page-wrap -->
</body></html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank', 'width=900,height=700');
    win.addEventListener('load', () => {
      win.focus();
      setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 400);
    });
  }
};
