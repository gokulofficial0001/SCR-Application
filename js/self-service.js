/* ============================================================
   SCR MANAGEMENT SYSTEM — Self-Service Portal
   ============================================================ */

const SelfService = {
  render() {
    const user = Auth.currentUser();
    const mySCRs = Store.filter('scr_requests', s => s.createdBy === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return `
      <!-- Welcome Section -->
      <div class="welcome-banner" style="text-align:center">
        <h2 class="welcome-title" style="max-width:none">Self-Service Portal</h2>
        <p class="welcome-text" style="max-width:none;margin:0 auto">Submit new requests, track status, and provide feedback — all in one place</p>
      </div>

      <!-- Quick Actions -->
      <div class="grid-3 gap-4 mb-6 stagger-children">
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.showQuickForm()">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">📝</div>
          <h4 style="margin-bottom:var(--space-1)">New Request</h4>
          <p class="text-sm text-tertiary">Submit a new SCR in under 1 minute</p>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.showTracker()">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">🔍</div>
          <h4 style="margin-bottom:var(--space-1)">Track Status</h4>
          <p class="text-sm text-tertiary">Search by SCR number to see progress</p>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.showFeedbackList()">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">⭐</div>
          <h4 style="margin-bottom:var(--space-1)">Give Feedback</h4>
          <p class="text-sm text-tertiary">Rate completed requests</p>
        </div>
      </div>

      <!-- Quick Form Container -->
      <div id="self-service-form" class="hidden"></div>

      <!-- Tracker Container -->
      <div id="self-service-tracker" class="hidden"></div>

      <!-- My Requests -->
      <div class="card" id="self-service-my-scrs">
        <div class="card-header">
          <h3 class="card-title">📋 My Requests (${mySCRs.length})</h3>
        </div>
        <div class="card-body">
          ${mySCRs.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <h3 class="empty-state-title">No Requests Yet</h3>
              <p class="empty-state-text">Submit your first SCR using the "New Request" card above</p>
            </div>
          ` : `
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>SCR #</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${mySCRs.map(scr => {
                    const hasFeedback = Store.filter('feedback', f => f.scrId === scr.id).length > 0;
                    const needsFeedback = (scr.status === 'Closed' || scr.status === 'Completed') && !hasFeedback;
                    return `
                      <tr>
                        <td class="font-semi text-brand">${scr.scrNumber}</td>
                        <td>${Utils.badgeHtml(scr.requestType, 'neutral')}</td>
                        <td>${Utils.priorityBadge(scr.priority)}</td>
                        <td class="text-sm" style="max-width:200px">${Utils.escapeHtml(Utils.truncate(scr.description, 50))}</td>
                        <td>${Utils.statusBadge(scr.status)}</td>
                        <td class="text-xs text-tertiary">${Utils.getStageName(scr.currentStage)}</td>
                        <td class="text-sm text-tertiary">${Utils.formatDate(scr.createdAt)}</td>
                        <td>
                          <button class="btn btn-ghost btn-sm" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})">View</button>
                          ${needsFeedback ? `<button class="btn btn-outline btn-sm" onclick="Feedback.showForm('${scr.id}')">⭐ Rate</button>` : ''}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  },

  // ── Quick SCR Form ──────────────────────────────────────
  showQuickForm() {
    const container = document.getElementById('self-service-form');
    const depts = Store.getAll('departments');
    const user = Auth.currentUser();

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="card mb-6 animate-fade-in-up" style="border-color:var(--color-primary);border-width:2px">
        <div class="card-header">
          <div>
            <h3 class="card-title">📋 New Software Change Request</h3>
            <p class="text-sm text-tertiary mt-1">Fill in the details below — sections marked with * are required</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('self-service-form').classList.add('hidden')">&#x2715; Close</button>
        </div>
        <div class="card-body" style="padding-top:0">
          <form onsubmit="SelfService.handleQuickSubmit(event)">

            <!-- Section 1: Header (auto) -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">1</span>
                <span>Header</span>
                <span class="scr-section-badge">SOFTWARE CHANGE REQUEST (SCR) FORM</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">SCR Number</label>
                    <input type="text" class="form-input" value="Auto-generated on submit" readonly style="opacity:0.6">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="text" class="form-input" value="${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}" readonly style="opacity:0.6">
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 2: Project Details -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">2</span>
                <span>Project Details</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Request Type <span class="required">*</span></label>
                    <select class="form-select" id="quick-type" required>
                      <option value="">Select type...</option>
                      <option value="New">New Development</option>
                      <option value="Modification">Modification</option>
                      <option value="Report">Report</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Intervention <span class="required">*</span></label>
                    <select class="form-select" id="quick-intervention" required>
                      <option value="">Select intervention...</option>
                      <option value="Emergency">🔴 Emergency</option>
                      <option value="Urgent">🟡 Urgent</option>
                      <option value="Routine" selected>🔵 Routine</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 3: Request Description -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">3</span>
                <span>Request Description</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-group">
                  <label class="form-label">Module Name <span class="required">*</span></label>
                  <input type="text" class="form-input" id="quick-module" placeholder="e.g., Billing System, OPD Module, Lab Reports" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Detailed Description of Change <span class="required">*</span></label>
                  <textarea class="form-textarea" id="quick-desc" rows="4" required placeholder="Explain the change request clearly..."></textarea>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Before Scenario</label>
                    <textarea class="form-textarea" id="quick-before" rows="2" placeholder="Current situation / existing behaviour..."></textarea>
                    <span class="form-hint">How does it work currently?</span>
                  </div>
                  <div class="form-group">
                    <label class="form-label">After Scenario</label>
                    <textarea class="form-textarea" id="quick-after" rows="2" placeholder="Expected behaviour after change..."></textarea>
                    <span class="form-hint">How should it work after the change?</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 4: Reason for Change -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">4</span>
                <span>Reason for Change</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-group">
                  <label class="form-label">Business Justification</label>
                  <textarea class="form-textarea" id="quick-reason" rows="2" placeholder="Why is this change needed?"></textarea>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Problem Being Solved</label>
                    <textarea class="form-textarea" id="quick-problem" rows="2" placeholder="What problem does this solve?"></textarea>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Expected Impact</label>
                    <textarea class="form-textarea" id="quick-impact" rows="2" placeholder="Quantify the expected outcome..."></textarea>
                  </div>
                </div>
              </div>
            </div>

            <!-- Section 5: Attachments -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">5</span>
                <span>Attachments</span>
                <span class="scr-section-hint">Up to 6 files</span>
              </div>
              <div class="scr-form-section-body">
                <div id="quick-attachments">
                  <div class="attachment-slot" id="quick-att-0">
                    <span class="att-slot-num">1.</span>
                    <input type="text" class="form-input att-name-q" placeholder="Attachment description / filename" style="flex:1">
                  </div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm mt-2" onclick="SelfService.addAttachment()">+ Add Attachment</button>
              </div>
            </div>

            <!-- Section 6: End User Details -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">6</span>
                <span>End User Details</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Requested By <span class="required">*</span></label>
                    <input type="text" class="form-input" id="quick-requested-by" value="${Utils.escapeHtml(user.name)}" required>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Received By</label>
                    <input type="text" class="form-input" id="quick-received-by" placeholder="IT staff receiving this request">
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Coordinated By</label>
                    <input type="text" class="form-input" id="quick-coordinated-by" placeholder="IT coordinator name">
                  </div>
                  <div class="form-group">
                    <label class="form-label">Department Name <span class="required">*</span></label>
                    <select class="form-select" id="quick-dept" required onchange="SelfService.onQuickDeptChange()">
                      <option value="">Select department...</option>
                      ${depts.map(d => `<option value="${Utils.escapeHtml(d.name)}" ${user.department === d.name ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div class="form-group" style="max-width:400px">
                  <label class="form-label">Department HOD</label>
                  <input type="text" class="form-input" id="quick-hod" readonly placeholder="Auto-filled from department">
                  <span class="form-hint">Auto-fetched when department is selected</span>
                </div>
              </div>
            </div>

            <!-- Footer Note -->
            <div class="scr-form-footer-note">
              <span class="scr-footer-icon">🏥</span>
              <p>"Behind every system change is a push for better healthcare delivery."</p>
            </div>

            <div class="flex justify-between items-center mt-6">
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('self-service-form').classList.add('hidden')">Cancel</button>
              <button type="submit" class="btn btn-success btn-lg">📋 Submit SCR Request</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Auto-select dept and fill HOD
    this.onQuickDeptChange();
    document.getElementById('quick-module')?.focus();
  },

  addAttachment() {
    const container = document.getElementById('quick-attachments');
    if (!container) return;
    const count = container.querySelectorAll('.attachment-slot').length;
    if (count >= 6) { Utils.toast('warning', 'Max Attachments', 'You can attach up to 6 files'); return; }
    const slot = document.createElement('div');
    slot.className = 'attachment-slot';
    slot.id = `quick-att-${count}`;
    slot.innerHTML = `
      <span class="att-slot-num">${count + 1}.</span>
      <input type="text" class="form-input att-name-q" placeholder="Attachment description / filename" style="flex:1">
      <button type="button" class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()" style="color:var(--color-danger);padding:0 var(--space-2)">✕</button>
    `;
    container.appendChild(slot);
  },

  onQuickDeptChange() {
    const deptName = document.getElementById('quick-dept')?.value;
    const hodField = document.getElementById('quick-hod');
    if (deptName && hodField) {
      const dept = Store.getAll('departments').find(d => d.name === deptName);
      if (dept) hodField.value = dept.hodName;
    }
  },

  handleQuickSubmit(e) {
    e.preventDefault();
    const getVal = (id) => document.getElementById(id)?.value || '';

    // Collect attachments
    const attInputs = document.querySelectorAll('.att-name-q');
    const attachments = [];
    attInputs.forEach(inp => { if (inp.value.trim()) attachments.push({ name: inp.value.trim(), url: '' }); });

    const data = {
      requestType: getVal('quick-type'),
      intervention: getVal('quick-intervention'),
      priority: getVal('quick-intervention'),
      moduleName: getVal('quick-module'),
      description: getVal('quick-desc'),
      descriptionBefore: getVal('quick-before'),
      descriptionAfter: getVal('quick-after'),
      reasonForChange: getVal('quick-reason'),
      problemSolved: getVal('quick-problem'),
      expectedImpact: getVal('quick-impact'),
      attachments,
      requestedBy: getVal('quick-requested-by'),
      receivedBy: getVal('quick-received-by'),
      coordinatedBy: getVal('quick-coordinated-by'),
      department: getVal('quick-dept'),
      hodName: getVal('quick-hod'),
    };

    // Auto-fetch HOD fallback
    if (!data.hodName && data.department) {
      const dept = Store.getAll('departments').find(d => d.name === data.department);
      if (dept) data.hodName = dept.hodName;
    }

    const result = SCRManager.createSCR(data);
    if (result.success) {
      Utils.toast('success', 'SCR Submitted! 🎉', `Your request ${result.scr.scrNumber} has been created`);
      Router.navigate('self-service');
    } else {
      Utils.toast('error', 'Error', result.error || 'Failed to submit');
    }
  },

  // ── Status Tracker ──────────────────────────────────────
  showTracker() {
    const container = document.getElementById('self-service-tracker');
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="card mb-6 animate-fade-in-up">
        <div class="card-header">
          <h3 class="card-title">🔍 Track SCR Status</h3>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('self-service-tracker').classList.add('hidden')">✕ Close</button>
        </div>
        <div class="card-body">
          <div class="flex gap-3">
            <input type="text" class="form-input" id="track-input" placeholder="Enter SCR number (e.g., SCR-2026-0001)" style="max-width:350px">
            <button class="btn btn-primary" onclick="SelfService.trackSCR()">Track</button>
          </div>
          <div id="track-result"></div>
        </div>
      </div>
    `;
    document.getElementById('track-input')?.focus();
  },

  trackSCR() {
    const scrNumber = document.getElementById('track-input')?.value.trim().toUpperCase();
    const resultDiv = document.getElementById('track-result');
    if (!scrNumber || !resultDiv) return;

    const scr = Store.getAll('scr_requests').find(s => s.scrNumber.toUpperCase() === scrNumber);

    if (!scr) {
      resultDiv.innerHTML = `
        <div class="empty-state" style="padding:var(--space-6)">
          <div class="empty-state-icon">🔍</div>
          <h3 class="empty-state-title">Not Found</h3>
          <p class="empty-state-text">No SCR found with number "${Utils.escapeHtml(scrNumber)}"</p>
        </div>
      `;
      return;
    }

    const dev = scr.assignedDeveloper ? Store.getById('users', scr.assignedDeveloper) : null;
    const sla = SLAEngine.calculate(scr);

    resultDiv.innerHTML = `
      <div class="track-result">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="track-scr-number">${scr.scrNumber}</div>
            <p class="text-secondary">${Utils.escapeHtml(scr.department)}</p>
          </div>
          <div class="text-right">
            ${Utils.priorityBadge(scr.priority)}
            ${Utils.statusBadge(scr.status)}
          </div>
        </div>

        ${Workflow.renderPipeline(scr)}
        ${SLAEngine.renderProgressBar(scr)}

        <div class="detail-grid mt-4">
          <div class="detail-field">
            <span class="detail-label">Description</span>
            <span class="detail-value">${Utils.escapeHtml(scr.description)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">Current Stage</span>
            <span class="detail-value">${Utils.getStageName(scr.currentStage)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">Developer</span>
            <span class="detail-value">${dev ? Utils.escapeHtml(dev.name) : 'Not yet assigned'}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">Created</span>
            <span class="detail-value">${Utils.formatDate(scr.createdAt)}</span>
          </div>
        </div>

        <div class="flex gap-3 mt-4">
          <button class="btn btn-primary btn-sm" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})">View Full Details →</button>
        </div>
      </div>
    `;
  },

  // ── Feedback list (completed without feedback) ──────────
  showFeedbackList() {
    const user = Auth.currentUser();
    const mySCRs = Store.filter('scr_requests', s => s.createdBy === user.id);
    const needFeedback = mySCRs.filter(s => {
      if (s.status !== 'Closed' && s.status !== 'Completed') return false;
      return Store.filter('feedback', f => f.scrId === s.id).length === 0;
    });

    if (needFeedback.length === 0) {
      Utils.toast('info', 'All Done!', 'No completed SCRs waiting for your feedback');
      return;
    }

    // Open feedback for first one
    Feedback.showForm(needFeedback[0].id);
  }
};
