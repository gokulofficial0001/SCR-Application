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
      projectHeadName: data.projectHeadName || 'Ms. Deepa S',
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

    const scr = Store.update('scr_requests', id, updates);

    // Track field changes (skip timestamps, deep-nested fields)
    Object.keys(updates).forEach(field => {
      const a = old[field], b = updates[field];
      if (a !== b && !['updatedAt'].includes(field) && typeof a !== 'object' && typeof b !== 'object') {
        Audit.log('SCR', id, 'Updated', field, a, b);
      }
    });

    // If developer assigned, notify
    if (updates.assignedDeveloper && updates.assignedDeveloper !== old.assignedDeveloper) {
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

    // Role-based filtering for requester
    const user = Auth.currentUser();
    if (user.role === 'requester') {
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
                    <td>${Utils.statusBadge(scr.status)} ${rej ? `<span data-tooltip="${Utils.escapeHtml(rejTooltip)}" style="margin-left:4px;cursor:help" aria-label="Rejection remarks">⚠️</span>` : ''}</td>
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

    // Access control: requesters can only view SCRs they created
    if (currentUser.role === 'requester' && scr.createdBy !== currentUser.id) {
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
    const canEdit = Auth.canPerformAction('edit_scr') && scr.status !== 'Closed' && scr.status !== 'Rejected';
    const canAdvance = Workflow.canAdvance(scr);
    const hasFeedback = Store.filter('feedback', f => f.scrId === id).length > 0;
    const isApprover = Auth.hasRole('agm_it', 'cio', 'admin');
    const isImpl = Auth.hasRole('implementation', 'admin');
    const isAssignedDev = Auth.hasRole('developer', 'admin') &&
      (scr.assignedDeveloper === currentUser.id || scr.assignedDeveloper2 === currentUser.id);
    const canAcknowledge = isAssignedDev && scr.currentStage === 5 && !scr.acknowledgedBy && scr.status !== 'Closed';

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
          ${scr.status === 'Closed' ? `<button class="btn btn-ghost" onclick="SCRManager.printSCR('${scr.id}')" title="Print SCR Form">🖨️ Print</button>` : ''}
          ${canAcknowledge ? `<button class="btn btn-warning" onclick="SCRManager.handleAcknowledge('${scr.id}')">👁 Acknowledge</button>` : ''}
          ${Workflow.canReject(scr) ? `<button class="btn btn-danger btn-sm" onclick="SCRManager.handleRejectStage('${scr.id}')">✕ Reject</button>` : ''}
          ${Workflow.canClose(scr) ? `<button class="btn btn-success" onclick="SCRManager.handleCloseTicket('${scr.id}')">✓ Close Ticket</button>` : ''}
          ${canAdvance ? `<button class="btn btn-primary" onclick="SCRManager.handleAdvanceStage('${scr.id}')">${Workflow.getAdvanceLabel(scr.currentStage)}</button>` : ''}
        </div>
      </div>

      <!-- Pipeline -->
      <div class="card mb-4">
        ${Workflow.renderPipeline(scr)}
        ${SLAEngine.renderProgressBar(scr)}
      </div>

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

          <!-- SECTION 7: Study Details -->
          ${isImpl || scr.studyDoneByPrimary ? `
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
                  <span class="detail-value">${dev ? Utils.escapeHtml(dev.name) : '—'}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">Developer 2</span>
                  <span class="detail-value">${dev2 ? Utils.escapeHtml(dev2.name) : '—'}</span>
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
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(scr.projectHeadName || 'Ms. Deepa S')}</span>
                    </div>
                    <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;white-space:pre-wrap;margin:0">${Utils.escapeHtml(scr.remarkProjectHead)}</p>
                  </div>
                ` : ''}
                ${scr.remarkAgmIt ? `
                  <div style="padding:var(--space-3);background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid var(--color-info);border-radius:var(--radius-md)">
                    <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
                      <span style="font-size:1.1rem">📊</span>
                      <span class="font-bold text-sm">AGM – IT</span>
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(scr.agmItName || 'Mr. S. Saravanakumar')}</span>
                    </div>
                    <p class="text-sm" style="color:var(--color-text-primary);line-height:1.7;white-space:pre-wrap;margin:0">${Utils.escapeHtml(scr.remarkAgmIt)}</p>
                  </div>
                ` : ''}
                ${scr.remarkCio ? `
                  <div style="padding:var(--space-3);background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid var(--color-success);border-radius:var(--radius-md)">
                    <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
                      <span style="font-size:1.1rem">🏛️</span>
                      <span class="font-bold text-sm">CIO</span>
                      <span class="text-xs text-tertiary">— ${Utils.escapeHtml(scr.cioName || 'Mr. Biju Velayudhan')}</span>
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
                  <span class="detail-value">${Utils.escapeHtml(scr.projectHeadName || 'Ms. Deepa S')}</span>
                </div>
                <div class="detail-field">
                  <span class="detail-label">AGM – IT</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.agmItName || 'Mr. S. Saravanakumar')}</span>
                </div>
                <div class="detail-field" style="grid-column:span 2">
                  <span class="detail-label">CIO</span>
                  <span class="detail-value">${Utils.escapeHtml(scr.cioName || 'Mr. Biju Velayudhan')}</span>
                </div>
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
    const isImpl = Auth.hasRole('implementation', 'admin');
    const isPH = Auth.hasRole('project_head', 'admin');
    const isApprover = Auth.hasRole('agm_it', 'cio', 'admin');
    const isAdmin = Auth.hasRole('admin');

    // Pre-fill end user from current user if requester
    const defaultRequestedBy = scr.requestedBy || (isRequester ? user.name : '');
    const defaultDept = scr.department || (isRequester ? user.department : '');
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
                <input type="text" class="form-input" id="scr-requested-by" value="${Utils.escapeHtml(defaultRequestedBy)}" placeholder="Full name of requester" ${isRequester ? 'readonly' : ''} required>
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
                </div>
                <div class="form-group">
                  <label class="form-label">Coordinated By</label>
                  <input type="text" class="form-input" id="scr-coordinated-by" value="${Utils.escapeHtml(scr.coordinatedBy || '')}" placeholder="IT coordinator name">
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
                <select class="form-select" id="scr-study-primary">
                  <option value="">Select primary analyst...</option>
                  ${impTeam.map(u => `<option value="${Utils.escapeHtml(u.name)}" ${(defaultStudyPrimary === u.name) ? 'selected' : ''}>${Utils.escapeHtml(u.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Study Done By (Secondary)</label>
                <select class="form-select" id="scr-study-secondary">
                  <option value="">Select secondary analyst...</option>
                  ${impTeam.map(u => `<option value="${Utils.escapeHtml(u.name)}" ${scr.studyDoneBySecondary === u.name ? 'selected' : ''}>${Utils.escapeHtml(u.name)}</option>`).join('')}
                </select>
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
                <label class="form-label">Assigned On</label>
                <input type="date" class="form-input" id="scr-assigned-on" value="${scr.assignedOn || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Study Date From</label>
                <input type="date" class="form-input" id="scr-study-from" value="${scr.studyDateFrom || ''}">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Study Date To</label>
                <input type="date" class="form-input" id="scr-study-to" value="${scr.studyDateTo || ''}">
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
                <input type="text" class="form-input" id="scr-ph-name" value="${Utils.escapeHtml(scr.projectHeadName || 'Ms. Deepa S')}" placeholder="Project Head full name">
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

  // ── Department change handler ───────────────────────────
  onDeptChange() {
    const deptName = document.getElementById('scr-dept')?.value;
    const hodField = document.getElementById('scr-hod');
    if (deptName && hodField) {
      const dept = Store.getAll('departments').find(d => d.name === deptName);
      if (dept) hodField.value = dept.hodName;
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

    const getVal = (id) => document.getElementById(id)?.value || '';
    const getRadio = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';

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

    const isApproved  = agmDecision?.decision === 'Approved' && cioDecision?.decision === 'Approved';
    const isRejected  = agmDecision?.decision === 'Rejected' || cioDecision?.decision === 'Rejected';
    const chkApproved = isApproved  ? 'checked' : '';
    const chkRejected = isRejected  ? 'checked' : '';
    const chkHold     = (!isApproved && !isRejected && (agmDecision || cioDecision)) ? 'checked' : '';

    const esc  = (v) => (v || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '—';
    const fmt  = (d) => d ? Utils.formatDate(d) : '—';
    const dash = (v) => v || '—';

    // Build 6 attachment slots
    const attSlots = Array.from({ length: 6 }, (_, i) => {
      const a = scr.attachments && scr.attachments[i];
      return `<tr><td class="att-num">${i + 1}.</td><td class="att-val">${a ? esc(a.name) : ''}</td></tr>`;
    });

    const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(scr.scrNumber)} — SCR Form</title>
<style>
  @page { size: A4 portrait; margin: 15mm 18mm; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
  }

  /* WATERMARK */
  body::before {
    content: 'GKNM HOSPITAL';
    position: fixed;
    top: 38%; left: 15%;
    font-size: 72px;
    font-weight: bold;
    color: rgba(0,0,0,0.04);
    transform: rotate(-35deg);
    white-space: nowrap;
    z-index: -1;
    pointer-events: none;
  }

  /* ── PAGE HEADER ── */
  .page-header {
    text-align: center;
    border-bottom: 2px solid #000;
    padding-bottom: 8px;
    margin-bottom: 10px;
  }
  .hospital-name {
    font-size: 18px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .hospital-sub {
    font-size: 11px;
    color: #444;
    margin-top: 2px;
  }
  .form-title {
    font-size: 13px;
    font-weight: bold;
    background: #000;
    color: #fff;
    padding: 4px 0;
    margin-top: 8px;
    letter-spacing: 0.5px;
  }

  /* ── SECTION HEADING ── */
  .sec-head {
    font-size: 11px;
    font-weight: bold;
    background: #e8e8e8;
    border: 1px solid #999;
    border-bottom: none;
    padding: 4px 8px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 10px;
  }

  /* ── FORM TABLE ── */
  table.form-tbl {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  table.form-tbl td {
    border: 1px solid #999;
    padding: 5px 7px;
    vertical-align: top;
    word-wrap: break-word;
  }
  td.lbl {
    background: #f5f5f5;
    font-weight: bold;
    width: 28%;
    white-space: nowrap;
    color: #111;
  }
  td.val {
    width: 22%;
  }
  td.val-wide {
    /* used when spanning full width */
  }
  td.area {
    min-height: 44px;
    height: 44px;
    white-space: pre-wrap;
    line-height: 1.5;
  }
  td.area-sm {
    min-height: 30px;
    height: 30px;
    white-space: pre-wrap;
  }

  /* ── ATTACHMENTS ── */
  table.att-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.att-tbl td { border: 1px solid #999; padding: 4px 6px; }
  td.att-num { width: 24px; font-weight: bold; background: #f5f5f5; text-align: center; }
  td.att-val { }

  /* ── APPROVAL CHECKBOXES ── */
  .approval-checks { padding: 6px 0; }
  .approval-checks label { margin-right: 28px; font-size: 12px; vertical-align: middle; }
  .approval-checks input[type=checkbox] { width: 14px; height: 14px; margin-right: 5px; vertical-align: middle; }

  /* ── SIGNATURES ── */
  table.sign-tbl { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.sign-tbl td { width: 33.33%; text-align: center; padding: 0 10px; vertical-align: bottom; }
  .sign-space { height: 48px; }
  .sign-line { border-top: 1px solid #000; padding-top: 4px; font-size: 10px; font-weight: bold; }

  /* ── REMARKS TABLE ── */
  table.rem-tbl { width: 100%; border-collapse: collapse; }
  table.rem-tbl td { border: 1px solid #999; padding: 5px 7px; vertical-align: top; }
  td.rem-lbl { background: #f5f5f5; font-weight: bold; width: 28%; white-space: nowrap; }
  td.rem-val { min-height: 30px; height: 30px; }

  /* ── FOOTER ── */
  .print-footer {
    margin-top: 14px;
    border-top: 1px solid #ccc;
    padding-top: 6px;
    font-size: 9.5px;
    color: #555;
    line-height: 1.6;
  }

  /* ── PAGE BREAK CONTROL ── */
  .no-break { page-break-inside: avoid; }
</style>
</head><body>

<!-- PAGE HEADER -->
<div class="page-header">
  <div class="hospital-name">GKNM Hospital</div>
  <div class="hospital-sub">IT Department · Quality &amp; Patient Safety</div>
  <div class="form-title">SOFTWARE CHANGE REQUEST (SCR) FORM</div>
</div>

<!-- HEADER INFO -->
<div class="no-break">
<table class="form-tbl">
  <tr>
    <td class="lbl">SCR Number</td>
    <td class="val">${esc(scr.scrNumber)}</td>
    <td class="lbl">Date</td>
    <td class="val">${fmt(scr.scrDate || scr.createdAt)}</td>
  </tr>
  <tr>
    <td class="lbl">Request Type</td>
    <td class="val">${esc(scr.requestType)}</td>
    <td class="lbl">Intervention / Priority</td>
    <td class="val">${esc(scr.intervention || scr.priority)}</td>
  </tr>
  <tr>
    <td class="lbl">Module Name</td>
    <td class="val" colspan="3">${esc(scr.moduleName)}</td>
  </tr>
</table>
</div>

<!-- REQUEST DESCRIPTION -->
<div class="sec-head">Request Description</div>
<div class="no-break">
<table class="form-tbl">
  <tr>
    <td class="lbl" style="width:28%">Description</td>
    <td class="val area" colspan="3">${esc(scr.description)}</td>
  </tr>
</table>
</div>

<!-- REASON FOR CHANGE -->
<div class="sec-head">Reason for Change</div>
<div class="no-break">
<table class="form-tbl">
  <tr>
    <td class="lbl">Business Justification</td>
    <td class="val area" colspan="3">${esc(scr.reasonForChange)}</td>
  </tr>
</table>
</div>

<!-- ATTACHMENTS -->
<div class="sec-head">Attachments</div>
<div class="no-break">
<table class="att-tbl">
  <tr>
    ${attSlots.slice(0,3).map(s => s.replace('<tr>','').replace('</tr>','')).join('')}
  </tr>
  <tr>
    ${attSlots.slice(3,6).map(s => s.replace('<tr>','').replace('</tr>','')).join('')}
  </tr>
</table>
</div>

<!-- END USER DETAILS -->
<div class="sec-head">End User Details</div>
<div class="no-break">
<table class="form-tbl">
  <tr>
    <td class="lbl">Requested By</td>
    <td class="val">${esc(scr.requestedBy)}</td>
    <td class="lbl">Received By</td>
    <td class="val">${esc(scr.receivedBy)}</td>
  </tr>
  <tr>
    <td class="lbl">Coordinated By</td>
    <td class="val">${esc(scr.coordinatedBy)}</td>
    <td class="lbl">Department</td>
    <td class="val">${esc(scr.department)}</td>
  </tr>
  <tr>
    <td class="lbl">Department HOD</td>
    <td class="val" colspan="3">${esc(scr.hodName)}</td>
  </tr>
</table>
</div>

<!-- STUDY DETAILS -->
<div class="sec-head">Study Details</div>
<div class="no-break">
<table class="form-tbl">
  <tr>
    <td class="lbl">Study Done By (Primary)</td>
    <td class="val">${esc(scr.studyDoneByPrimary)}</td>
    <td class="lbl">Study Done By (Secondary)</td>
    <td class="val">${esc(scr.studyDoneBySecondary)}</td>
  </tr>
  <tr>
    <td class="lbl">Assigned Developer 1</td>
    <td class="val">${esc(dev1 ? dev1.name : dash(scr.assignedDeveloper))}</td>
    <td class="lbl">Assigned Developer 2</td>
    <td class="val">${esc(dev2 ? dev2.name : dash(scr.assignedDeveloper2))}</td>
  </tr>
  <tr>
    <td class="lbl">Assigned On</td>
    <td class="val">${fmt(scr.assignedOn)}</td>
    <td class="lbl">Completed On</td>
    <td class="val">${fmt(scr.completedOn)}</td>
  </tr>
  <tr>
    <td class="lbl">Study Date From</td>
    <td class="val">${fmt(scr.studyDateFrom)}</td>
    <td class="lbl">Study Date To</td>
    <td class="val">${fmt(scr.studyDateTo)}</td>
  </tr>
  <tr>
    <td class="lbl">Schedule Date</td>
    <td class="val">${fmt(scr.scheduleDate)}</td>
    <td class="lbl"></td>
    <td class="val"></td>
  </tr>
</table>
</div>

<!-- APPROVAL -->
<div class="sec-head">Approval Decision</div>
<div class="no-break" style="border:1px solid #999; padding:6px 8px;">
  <div class="approval-checks">
    <label><input type="checkbox" ${chkApproved}> Approved</label>
    <label><input type="checkbox" ${chkRejected}> Not Approved</label>
    <label><input type="checkbox" ${chkHold}> Hold</label>
  </div>
  <!-- Signatures -->
  <table class="sign-tbl">
    <tr>
      <td><div class="sign-space"></div><div class="sign-line">${esc(scr.projectHeadName || 'Project Head')}</div></td>
      <td><div class="sign-space"></div><div class="sign-line">${esc(scr.agmItName || 'AGM – IT')}</div></td>
      <td><div class="sign-space"></div><div class="sign-line">${esc(scr.cioName || 'Chief Information Officer')}</div></td>
    </tr>
  </table>
</div>

<!-- REMARKS -->
<div class="sec-head">Remarks</div>
<div class="no-break">
<table class="rem-tbl">
  <tr>
    <td class="rem-lbl">Project Head Remarks</td>
    <td class="rem-val">${esc(scr.remarkProjectHead)}</td>
  </tr>
  <tr>
    <td class="rem-lbl">AGM – IT Remarks</td>
    <td class="rem-val">${esc(scr.remarkAgmIt || agmDecision?.comments)}</td>
  </tr>
  <tr>
    <td class="rem-lbl">CIO Remarks</td>
    <td class="rem-val">${esc(scr.remarkCio || cioDecision?.comments)}</td>
  </tr>
</table>
</div>

<!-- FOOTER -->
<div class="print-footer">
  <b>NOTE:</b>&nbsp; Request Description: Describe the change clearly. &nbsp;|&nbsp;
  Reasons: Explain business impact and expected outcome.<br>
  <i>Behind every system change is a push for better healthcare delivery.</i>
  &emsp;|&emsp; Printed: ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
</div>

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
