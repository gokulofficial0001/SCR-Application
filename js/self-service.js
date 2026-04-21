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
        <h2 class="welcome-title" style="max-width:none">SOFTWARE CHANGE REQUEST APPLICATION</h2>
        <p class="welcome-text" style="max-width:none;margin:0 auto">Submit new requests, track status, and provide feedback — all in one place</p>
      </div>

      <!-- Quick Actions — open each in a new popup window (not a tab) -->
      <div class="grid-3 gap-4 mb-6 stagger-children">
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.openInNewWindow('create-scr')">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">📝</div>
          <h4 style="margin-bottom:var(--space-1)">New Request</h4>
          <p class="text-sm text-tertiary">Submit a new SCR in under 1 minute</p>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.openInNewWindow('track')">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">🔍</div>
          <h4 style="margin-bottom:var(--space-1)">Track Status</h4>
          <p class="text-sm text-tertiary">Search by SCR number to see progress</p>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="SelfService.openInNewWindow('feedback')">
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

  // ── Open an action — all in the SAME tab (no new tabs spawned) ──
  // "New Request"  → navigate to full SCR Request screen in-place
  // Track / Feedback → reveal their inline panel on the Home page
  openInNewWindow(action) {
    if (action === 'create-scr') {
      // Flag this as a Home-initiated submission so handleSubmit shows
      // the success modal + redirects to Home instead of scr-detail
      sessionStorage.setItem('scr-new-tab-flow', '1');
      Router.navigate('scr-create');
    } else {
      this._runAction(action);
    }
  },

  // ── Dispatcher (fallback when new tab is blocked) ─────────
  _runAction(action) {
    switch (action) {
      case 'create-scr':  this.showQuickForm();     break;
      case 'track':       this.showTracker();       break;
      case 'feedback':    this.showFeedbackList();  break;
    }
  },

  // ── Render minimal content (called by App.renderMinimal) ──
  // Uses the SAME SCRManager.renderForm() that all other roles see, so
  // the form is consistent across the app and already requester-scoped.
  renderMinimal(action) {
    const host = document.getElementById('minimal-content');
    if (!host) return;

    if (action === 'create-scr') {
      // Reuse the canonical SCR request form (role-aware, same layout)
      host.innerHTML = SCRManager.renderForm();
      setTimeout(() => {
        if (typeof SCRManager.postRenderForm === 'function') SCRManager.postRenderForm();
        // 1. Hide the form's own page-header (the shell header already shows title + back button)
        document.querySelectorAll('#minimal-content > form .page-header, #minimal-content .page-header').forEach(h => {
          // If the page-header is inside the form wrapper, hide it to avoid duplication
          h.style.display = 'none';
        });
        // 2. Rewire bottom "← Cancel" button → back to Home
        document.querySelectorAll('#minimal-content [onclick*="scr-list"], #minimal-content [onclick*="Router.goBack"]').forEach(btn => {
          btn.setAttribute('onclick', 'App.backToHomeFromMinimal()');
          btn.setAttribute('title', 'Back to Home');
          if (/Cancel|Back/i.test(btn.textContent)) btn.textContent = '← Back to Home';
        });
      }, 40);

    } else if (action === 'track') {
      host.innerHTML = `<div id="self-service-tracker"></div>`;
      this.showTracker();
      setTimeout(() => this._rewireInlineCloseButtons(), 100);

    } else if (action === 'feedback') {
      host.innerHTML = `<div id="self-service-my-scrs"></div>`;
      this.showFeedbackList();
      setTimeout(() => this._rewireInlineCloseButtons(), 100);

    } else {
      host.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❓</div><h3 class="empty-state-title">Unknown Action</h3><button class="btn btn-primary mt-4" onclick="App.backToHomeFromMinimal()">Back to Home</button></div>`;
    }
  },

  // Rewire inline Close/Cancel buttons (used by tracker / feedback list
  // which use self-service.js's own containers).
  _rewireInlineCloseButtons() {
    document.querySelectorAll('#minimal-content [onclick*="self-service-form"][onclick*="hidden"], #minimal-content [onclick*="self-service-tracker"][onclick*="hidden"]').forEach(btn => {
      btn.setAttribute('onclick', 'App.backToHomeFromMinimal()');
      btn.setAttribute('title', 'Back to Home');
    });
  },

  // ── Submission success modal (healthcare-flow phrases) ──
  // Shown after New SCR / Feedback submit. Auto-redirects to Home after 4s.
  showSuccessModal({ title, message, buttonLabel = 'Go to Home →', icon = '✅', color = 'success', autoRedirectSec = 4 } = {}) {
    // Healthcare-flow phrases — randomized to feel fresh each time
    const phrases = [
      'Helping healthcare run smoother — one request at a time.',
      'Your request is in our hands. We\'ll take it from here.',
      'Technology in service of care.',
      'Another step toward seamless hospital operations.',
      'Powering better patient care through better IT.',
      'Behind every system change is a push for better healthcare delivery.',
      'Together, we\'re building a more responsive Hospital IT.',
      'Progress happens one SCR at a time.'
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];

    // Close any existing modals first
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());

    const colorMap = {
      success: 'var(--color-success-dark)',
      info:    'var(--color-primary-dark)',
      warning: 'var(--color-warning-dark)'
    };
    const titleColor = colorMap[color] || colorMap.success;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'success-modal';
    overlay.innerHTML = `
      <div class="modal modal-sm" style="max-width:480px">
        <div class="modal-body" style="text-align:center;padding:var(--space-8) var(--space-6)">
          <div style="font-size:4.5rem;margin-bottom:var(--space-3);filter:drop-shadow(0 4px 16px rgba(13,122,90,0.25))">${icon}</div>
          <h2 style="font-size:var(--font-xl);margin-bottom:var(--space-2);color:${titleColor};font-weight:800">${Utils.escapeHtml(title)}</h2>
          <p style="color:var(--color-text-secondary);line-height:1.6;margin-bottom:var(--space-5);font-size:var(--font-md)">${Utils.escapeHtml(message)}</p>
          <div style="padding:var(--space-3) var(--space-4);background:var(--color-bg-surface);border-left:3px solid var(--color-primary);border-radius:var(--radius-md);margin-bottom:var(--space-5);text-align:left">
            <p class="text-sm" style="font-style:italic;color:var(--color-text-secondary);line-height:1.5;margin:0">&ldquo;${Utils.escapeHtml(phrase)}&rdquo;</p>
            <p class="text-xs text-tertiary" style="margin:4px 0 0">— Hospital IT, SCR Team</p>
          </div>
          <button class="btn btn-primary btn-lg" onclick="SelfService.dismissSuccessModal()" style="min-width:200px">${Utils.escapeHtml(buttonLabel)}</button>
          ${autoRedirectSec > 0 ? `<p class="text-xs text-muted" style="margin-top:var(--space-3)">Returning to Home in <span id="success-countdown" style="font-weight:700">${autoRedirectSec}</span>s…</p>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Auto-redirect countdown — uses the same dismiss helper so timer
    // and button click behave identically (remove modal + go Home)
    if (autoRedirectSec > 0) {
      let sec = autoRedirectSec;
      this._successCountdownTimer = setInterval(() => {
        sec--;
        const counter = document.getElementById('success-countdown');
        if (counter) counter.textContent = sec;
        if (sec <= 0) {
          this.dismissSuccessModal();
        }
      }, 1000);
    }
  },

  // ── Close success modal + navigate to Home ──────────────
  // Single source of truth for both the button click and the auto-redirect
  dismissSuccessModal() {
    // 1. Clear the countdown timer if running
    if (this._successCountdownTimer) {
      clearInterval(this._successCountdownTimer);
      this._successCountdownTimer = null;
    }
    // 2. Remove the modal overlay from DOM (was never getting removed before)
    const overlay = document.getElementById('success-modal');
    if (overlay) overlay.remove();
    // 3. Also clear any other lingering modals (defensive)
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
    // 4. Navigate to Home — mode-aware
    if (document.body.dataset.mode === 'minimal' && typeof App !== 'undefined' && App.backToHomeFromMinimal) {
      App.backToHomeFromMinimal();
    } else if (typeof Router !== 'undefined') {
      Router.navigate('self-service');
    }
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

            <!-- Section 1: Header (Date only — SCR number auto-assigned at submit) -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">1</span>
                <span>Header</span>
                <span class="scr-section-badge">SOFTWARE CHANGE REQUEST (SCR) FORM</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-group" style="max-width:320px">
                  <label class="form-label">Request Date</label>
                  <input type="text" class="form-input" value="${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}" readonly style="opacity:0.6">
                </div>
              </div>
            </div>

            <!-- Section 2: Project Details (Request Type + Intervention filled by requester) -->
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
                <span class="scr-section-num">2</span>
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
              </div>
            </div>

            <!-- Section 3: Reason for Change -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">3</span>
                <span>Reason for Change</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-group">
                  <label class="form-label">Business Justification</label>
                  <textarea class="form-textarea" id="quick-reason" rows="2" placeholder="Why is this change needed?"></textarea>
                </div>
              </div>
            </div>

            <!-- Received By / Coordinated By / Attachments are IT-internal — hidden for requester -->
            <input type="hidden" id="quick-received-by" value="">
            <input type="hidden" id="quick-coordinated-by" value="">

            <!-- Section 4: End User Details -->
            <div class="scr-form-section">
              <div class="scr-form-section-title">
                <span class="scr-section-num">4</span>
                <span>End User Details</span>
              </div>
              <div class="scr-form-section-body">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">Requested By <span class="required">*</span></label>
                    <input type="text" class="form-input" id="quick-requested-by" value="${Utils.escapeHtml(user.name)}" readonly required style="opacity:0.85">
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
    const getVal = (id) => (document.getElementById(id)?.value || '').trim();

    // Requesters can't attach files — IT will add any internal docs during review
    const intervention = getVal('quick-intervention') || 'Routine';
    const data = {
      requestType: getVal('quick-type') || 'New',
      intervention,
      priority: intervention,
      moduleName: getVal('quick-module'),
      description: getVal('quick-desc'),
      reasonForChange: getVal('quick-reason'),
      attachments: [],
      requestedBy: getVal('quick-requested-by'),
      receivedBy: getVal('quick-received-by'),
      coordinatedBy: getVal('quick-coordinated-by'),
      department: getVal('quick-dept'),
      hodName: getVal('quick-hod'),
    };

    // Validate required (trim-aware)
    const missing = [];
    if (!Utils.isNonEmpty(data.requestType))  missing.push('Request Type');
    if (!Utils.isNonEmpty(data.intervention)) missing.push('Intervention');
    if (!Utils.isNonEmpty(data.moduleName))   missing.push('Module');
    if (!Utils.isNonEmpty(data.description))  missing.push('Description');
    if (!Utils.isNonEmpty(data.department))   missing.push('Department');
    if (!Utils.isNonEmpty(data.requestedBy))  missing.push('Requested By');
    if (missing.length > 0) {
      Utils.toast('error', 'Missing Fields', `Please fill: ${missing.join(', ')}`);
      return;
    }

    // Auto-fetch HOD fallback
    if (!data.hodName && data.department) {
      const dept = Store.getAll('departments').find(d => d.name === data.department);
      if (dept) data.hodName = dept.hodName;
    }

    const result = SCRManager.createSCR(data);
    if (result.success) {
      const isMinimal = document.body.dataset.mode === 'minimal';
      if (isMinimal) {
        this.showSuccessModal({
          icon: '🎉',
          title: 'Your Request Has Been Submitted',
          message: `${result.scr.scrNumber} is now in our queue. Our IT team will review it and you'll be notified at each stage — from review to delivery.`,
          buttonLabel: 'Back to Home →'
        });
      } else {
        Utils.toast('success', 'SCR Submitted! 🎉', `Your request ${result.scr.scrNumber} has been created`);
        Router.navigate('self-service');
      }
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

    // Requester view — status-only. No developer / schedules / dev updates /
    // "View Full Details" link. Just the tracking info they need.
    const rej = scr.lastRejection;

    resultDiv.innerHTML = `
      <div class="track-result">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="track-scr-number">${Utils.escapeHtml(scr.scrNumber)}</div>
            <p class="font-semi" style="color:var(--color-text-primary);margin:2px 0 0">${Utils.escapeHtml(scr.moduleName || '—')}</p>
            <p class="text-sm text-tertiary" style="margin:2px 0 0">${Utils.escapeHtml(scr.department || '—')}</p>
          </div>
          <div class="text-right">
            ${Utils.priorityBadge(scr.priority)}
            ${Utils.statusBadge(scr.status)}
          </div>
        </div>

        ${Workflow.renderPipeline(scr)}

        ${rej ? `
          <div style="margin-top:var(--space-4);padding:var(--space-3) var(--space-4);background:rgba(184,52,30,0.06);border-left:3px solid var(--color-danger);border-radius:var(--radius-md)">
            <div class="flex items-center" style="gap:var(--space-2);margin-bottom:var(--space-1)">
              <span style="font-size:1.1rem">⚠️</span>
              <span class="font-bold text-sm" style="color:var(--color-danger-dark)">Returned — ${Utils.escapeHtml(rej.fromStageName || '')}</span>
            </div>
            <p class="text-sm" style="color:var(--color-text-primary);line-height:1.6;margin:0;white-space:pre-wrap">"${Utils.escapeHtml(rej.remarks || '')}"</p>
          </div>
        ` : ''}

        <div class="detail-grid mt-4">
          <div class="detail-field">
            <span class="detail-label">Current Stage</span>
            <span class="detail-value font-semi">${Utils.escapeHtml(Utils.getStageName(scr.currentStage))}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">Submitted On</span>
            <span class="detail-value">${Utils.formatDate(scr.createdAt)}</span>
          </div>
          <div class="detail-field" style="grid-column:span 2">
            <span class="detail-label">Description</span>
            <span class="detail-value">${Utils.escapeHtml(scr.description || '—')}</span>
          </div>
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
