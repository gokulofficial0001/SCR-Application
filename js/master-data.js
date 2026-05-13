/* ============================================================
   SCR MANAGEMENT SYSTEM — Master Data Management
   ============================================================ */

const MasterData = {
  activeTab: 'departments',

  render() {
    const depts = Store.getAll('departments');
    const users = Store.getAll('users');

    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">Master Data</h2>
          </div>
          <p class="page-description">Manage departments, staff, and system configuration</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab ${this.activeTab === 'departments' ? 'active' : ''}" onclick="MasterData.switchTab('departments', this)">🏢 Departments (${depts.length})</button>
        <button class="tab ${this.activeTab === 'staff' ? 'active' : ''}" onclick="MasterData.switchTab('staff', this)">👥 Staff (${users.length})</button>
        <button class="tab ${this.activeTab === 'sla' ? 'active' : ''}" onclick="MasterData.switchTab('sla', this)">⏱️ SLA Config</button>
        ${Auth.hasRole('admin') ? `<button class="tab ${this.activeTab === 'user-rights' ? 'active' : ''}" onclick="MasterData.switchTab('user-rights', this)">🔐 User Rights</button>` : ''}
      </div>

      <!-- Departments Tab -->
      <div id="master-tab-departments" class="${this.activeTab !== 'departments' ? 'hidden' : ''}">
        <div class="flex justify-between items-center mb-4">
          <span class="text-sm text-tertiary">${depts.length} departments configured</span>
          <button class="btn btn-primary btn-sm" onclick="MasterData.showDeptForm()">+ Add Department</button>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Department Name</th>
                <th>HOD Name</th>
                <th>HOD Email</th>
                <th>IT Coordinator</th>
                <th>SCRs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${depts.map((d, i) => {
                const scrCount = Store.count('scr_requests', s => s.department === d.name);
                return `
                  <tr>
                    <td class="text-tertiary">${i + 1}</td>
                    <td class="font-medium">${Utils.escapeHtml(d.name)}</td>
                    <td class="text-sm">${Utils.escapeHtml(d.hodName)}</td>
                    <td class="text-sm text-tertiary">${Utils.escapeHtml(d.hodEmail)}</td>
                    <td class="text-sm">${Utils.escapeHtml(d.coordinatorName || '—')}</td>
                    <td>${Utils.badgeHtml(scrCount.toString(), scrCount > 0 ? 'primary' : 'neutral')}</td>
                    <td class="action-cell">
                      <button class="btn btn-ghost btn-icon sm" data-tooltip="Edit" onclick="MasterData.showDeptForm('${d.id}')">✏️</button>
                      <button class="btn btn-ghost btn-icon sm" data-tooltip="Delete" onclick="MasterData.deleteDept('${d.id}')">🗑️</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Staff Tab -->
      <div id="master-tab-staff" class="${this.activeTab !== 'staff' ? 'hidden' : ''}">
        <div class="flex justify-between items-center mb-4">
          <span class="text-sm text-tertiary">${users.length} users configured</span>
          <button class="btn btn-primary btn-sm" onclick="MasterData.showUserForm()">+ Add User</button>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Email</th>
                <th>Department</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="user-avatar" style="width:28px;height:28px;font-size:var(--font-xs)">${Utils.getInitials(u.name)}</div>
                      <span class="font-medium">${Utils.escapeHtml(u.name)}</span>
                    </div>
                  </td>
                  <td class="text-sm" style="font-family:monospace">${Utils.escapeHtml(u.username)}</td>
                  <td>${Utils.badgeHtml(Utils.getRoleLabel(u.role), 'info')}</td>
                  <td class="text-sm text-tertiary">${Utils.escapeHtml(u.email)}</td>
                  <td class="text-sm">${Utils.escapeHtml(u.department)}</td>
                  <td class="action-cell">
                    <button class="btn btn-ghost btn-icon sm" data-tooltip="Edit" onclick="MasterData.showUserForm('${u.id}')">✏️</button>
                    ${u.id !== 'user_admin' ? `<button class="btn btn-ghost btn-icon sm" data-tooltip="Delete" onclick="MasterData.deleteUser('${u.id}')">🗑️</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- SLA Config Tab -->
      <div id="master-tab-sla" class="${this.activeTab !== 'sla' ? 'hidden' : ''}">
        <div class="card" style="max-width:500px">
          <div class="card-header"><h3 class="card-title">SLA Configuration</h3></div>
          <div class="card-body">
            <p class="text-tertiary text-sm mb-6">Define maximum resolution time per priority level</p>
            ${Store.getAll('sla_config').map(cfg => `
              <div class="form-group">
                <label class="form-label">${Utils.priorityBadge(cfg.priority)}</label>
                <div class="flex items-center gap-2">
                  <input type="number" class="form-input" id="sla-${cfg.priority}" value="${cfg.maxHours}" style="max-width:120px" min="1">
                  <span class="text-sm text-tertiary">hours</span>
                </div>
              </div>
            `).join('')}
            <button class="btn btn-primary mt-4" onclick="MasterData.saveSLA()">Save Changes</button>
          </div>
        </div>
      </div>

      <!-- User Rights Tab -->
      ${Auth.hasRole('admin') ? `
      <div id="master-tab-user-rights" class="${this.activeTab !== 'user-rights' ? 'hidden' : ''}">
        ${this.renderUserRightsTab()}
      </div>
      ` : ''}
    `;
  },

  switchTab(tab, el) {
    this.activeTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    ['departments', 'staff', 'sla', 'user-rights'].forEach(t => {
      const el = document.getElementById(`master-tab-${t}`);
      if (el) el.classList.toggle('hidden', t !== tab);
    });
  },

  // ── Department Form ─────────────────────────────────────
  showDeptForm(editId) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
    const dept = editId ? Store.getById('departments', editId) : {};
    if (editId && !dept) { Utils.toast('error', 'Not Found', 'Department no longer exists'); return; }
    const isEdit = !!editId;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dept-modal';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Edit' : 'Add'} Department</h3>
          <button class="modal-close" onclick="MasterData._safeClose('dept-modal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Department Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="dept-name" value="${Utils.escapeHtml(dept.name || '')}" placeholder="e.g., Cardiology" maxlength="80" autocomplete="off">
            <span class="form-hint">2-80 characters. Must be unique.</span>
          </div>
          <div class="form-group">
            <label class="form-label">HOD Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="dept-hod" value="${Utils.escapeHtml(dept.hodName || '')}" placeholder="e.g., Dr. Ramesh Kumar" maxlength="80" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">HOD Email</label>
            <input type="email" class="form-input" id="dept-email" value="${Utils.escapeHtml(dept.hodEmail || '')}" placeholder="e.g., ramesh@hospital.in" maxlength="120" autocomplete="off">
            <span class="form-hint">Optional. Must be a valid email if provided.</span>
          </div>
          <div class="form-group">
            <label class="form-label">IT Coordinator Name</label>
            <input type="text" class="form-input" id="dept-coordinator" value="${Utils.escapeHtml(dept.coordinatorName || '')}" placeholder="e.g., Mr. Gokulraj S" maxlength="80" autocomplete="off">
            <span class="form-hint">Auto-fills the "Coordinated By" field on SCRs from this department</span>
          </div>
          <div class="form-group">
            <label class="form-label">IT Coordinator Email</label>
            <input type="email" class="form-input" id="dept-coordinator-email" value="${Utils.escapeHtml(dept.coordinatorEmail || '')}" placeholder="e.g., arjun@hospital.in" maxlength="120" autocomplete="off">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MasterData._safeClose('dept-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="MasterData.saveDept('${editId || ''}')">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Dirty-form guard: snapshot original values, then watch for closes
    const originals = {
      'dept-name':              dept.name || '',
      'dept-hod':               dept.hodName || '',
      'dept-email':             dept.hodEmail || '',
      'dept-coordinator':       dept.coordinatorName || '',
      'dept-coordinator-email': dept.coordinatorEmail || ''
    };
    this._setupDirtyGuard(overlay, 'dept-modal', Object.keys(originals), originals, 'department');
  },

  saveDept(editId) {
    const payload = {
      name:             document.getElementById('dept-name').value.trim(),
      hodName:          document.getElementById('dept-hod').value.trim(),
      hodEmail:         document.getElementById('dept-email').value.trim(),
      coordinatorName:  document.getElementById('dept-coordinator').value.trim(),
      coordinatorEmail: document.getElementById('dept-coordinator-email').value.trim()
    };

    const err = this._validateDept(payload, editId || null);
    if (err) { this._showError(err.field, err.message); return; }

    if (editId) {
      Store.update('departments', editId, payload);
      Audit.log('Department', editId, 'Updated', 'name', null, payload.name);
      Utils.toast('success', 'Updated', `${payload.name} department updated`);
    } else {
      Store.add('departments', payload);
      Audit.log('Department', payload.name, 'Created', null, null, payload.name);
      Utils.toast('success', 'Added', `${payload.name} department added`);
    }

    this._disposeGuard('dept-modal');
    document.getElementById('dept-modal')?.remove();
    Router.navigate('master-data');
  },

  async deleteDept(id) {
    const dept = Store.getById('departments', id);
    if (!dept) return;

    // Guard: cannot delete a department referenced by any SCR
    const refs = Store.filter('scr_requests', s => s.department === dept.name);
    if (refs.length > 0) {
      Utils.toast('error', 'Cannot Delete',
        `"${dept.name}" is referenced by ${refs.length} SCR${refs.length > 1 ? 's' : ''}. Reassign or archive those first.`);
      return;
    }

    // Guard: must keep at least one department (forms need a valid option)
    const total = Store.getAll('departments').length;
    if (total <= 1) {
      Utils.toast('error', 'Cannot Delete', 'At least one department must exist.');
      return;
    }

    const confirmed = await Utils.confirm('Delete Department?', `Remove "${dept.name}"? This cannot be undone.`, 'danger');
    if (confirmed) {
      Store.remove('departments', id);
      Audit.log('Department', id, 'Deleted', null, dept.name, null);
      Utils.toast('success', 'Deleted', 'Department removed');
      Router.navigate('master-data');
    }
  },

  // ── User Form ───────────────────────────────────────────
  showUserForm(editId) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
    const user = editId ? Store.getById('users', editId) : {};
    if (editId && !user) { Utils.toast('error', 'Not Found', 'User no longer exists'); return; }
    const isEdit = !!editId;
    const depts = Store.getAll('departments');
    const roles = Object.keys(Utils.roleLabels);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Edit' : 'Add'} User</h3>
          <button class="modal-close" onclick="MasterData._safeClose('user-modal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-name" value="${Utils.escapeHtml(user.name || '')}" placeholder="e.g., Mr. Gokulraj S" maxlength="80" autocomplete="off">
              <span class="form-hint">2-80 characters</span>
            </div>
            <div class="form-group">
              <label class="form-label">Username <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-username" value="${Utils.escapeHtml(user.username || '')}" placeholder="e.g., gokulraj" maxlength="30" pattern="[a-z0-9_]{3,30}" autocomplete="off">
              <span class="form-hint">3-30 chars: lowercase letters, numbers, underscores. Must be unique.</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Password <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-password" value="${Utils.escapeHtml(user.password || '')}" placeholder="At least 4 characters" maxlength="60" autocomplete="new-password">
              <span class="form-hint">Min 4 characters</span>
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="form-input" id="user-email" value="${Utils.escapeHtml(user.email || '')}" placeholder="e.g., name@hospital.in" maxlength="120" autocomplete="off">
              <span class="form-hint">Optional. Must be unique if provided.</span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Role <span class="required">*</span></label>
              <select class="form-select" id="user-role">
                ${roles.map(r => `<option value="${r}" ${user.role === r ? 'selected' : ''}>${Utils.getRoleLabel(r)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Department</label>
              <select class="form-select" id="user-dept">
                ${depts.map(d => `<option value="${Utils.escapeHtml(d.name)}" ${user.department === d.name ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MasterData._safeClose('user-modal')">Cancel</button>
          <button class="btn btn-primary" onclick="MasterData.saveUser('${editId || ''}')">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Dirty-form guard
    const originals = {
      'user-name':     user.name || '',
      'user-username': user.username || '',
      'user-password': user.password || '',
      'user-email':    user.email || '',
      'user-role':     user.role || (roles[0] || ''),
      'user-dept':     user.department || (depts[0]?.name || '')
    };
    this._setupDirtyGuard(overlay, 'user-modal', Object.keys(originals), originals, 'user');
  },

  saveUser(editId) {
    const data = {
      name:       document.getElementById('user-name').value.trim(),
      // Usernames are lowercased for case-insensitive matching
      username:   document.getElementById('user-username').value.trim().toLowerCase(),
      password:   document.getElementById('user-password').value,
      email:      document.getElementById('user-email').value.trim(),
      role:       document.getElementById('user-role').value,
      department: document.getElementById('user-dept').value
    };

    const err = this._validateUser(data, editId || null);
    if (err) { this._showError(err.field, err.message); return; }

    if (editId) {
      const old = Store.getById('users', editId);
      Store.update('users', editId, data);
      Audit.log('User', editId, 'Updated', null, old ? old.name : null, data.name);
      Utils.toast('success', 'Updated', `User ${data.name} updated`);
    } else {
      Store.add('users', data);
      Audit.log('User', data.username, 'Created', null, null, data.name);
      Utils.toast('success', 'Added', `User ${data.name} created`);
    }

    this._disposeGuard('user-modal');
    document.getElementById('user-modal')?.remove();
    Router.navigate('master-data');
  },

  async deleteUser(id) {
    const user = Store.getById('users', id);
    if (!user) return;

    // Cannot delete self
    const session = Auth.currentUser();
    if (session && session.id === id) {
      Utils.toast('error', 'Cannot Delete', 'You cannot delete your own account while signed in.');
      return;
    }

    // Last-admin protection
    if (user.role === 'admin') {
      const admins = Store.filter('users', u => u.role === 'admin');
      if (admins.length <= 1) {
        Utils.toast('error', 'Cannot Delete', 'At least one admin must remain in the system.');
        return;
      }
    }

    // Reference check — historic data stays but workflow displays may show "user unavailable"
    const refs = Store.filter('scr_requests', s =>
      s.createdBy === id ||
      s.assignedDeveloper === id ||
      s.assignedDeveloper2 === id ||
      s.acknowledgedBy === id ||
      s.phAcceptedBy === id ||
      s.heldBy === id
    );

    const msg = refs.length > 0
      ? `${user.name} is referenced by ${refs.length} SCR${refs.length > 1 ? 's' : ''}. Historic data will be preserved, but those SCRs may show "(user unavailable)" in workflow timelines. Continue?`
      : `Remove "${user.name}"? This cannot be undone.`;

    const confirmed = await Utils.confirm('Delete User?', msg, 'danger');
    if (confirmed) {
      Store.remove('users', id);
      Audit.log('User', id, 'Deleted', null, user.name, null);
      Utils.toast('success', 'Deleted', `${user.name} removed`);
      Router.navigate('master-data');
    }
  },

  // ── User Rights Matrix ──────────────────────────────────
  renderUserRightsTab() {
    const savedPerms = Store._get('role_permissions') || Auth.permissions;
    const roles = ['admin', 'cio', 'agm_it', 'project_head', 'implementation', 'developer', 'requester'];
    const allPages = ['dashboard','scr-list','scr-detail','scr-create','approvals','feedback','audit','master-data','notifications','settings','self-service'];
    const allActions = ['create_scr','edit_scr','delete_scr','assign_scr','advance_stage','approve','reject','hold','close_ticket','manage_users','manage_departments','view_audit','reset_data','submit_feedback'];
    const pageLabels = {
      'dashboard':'Dashboard','scr-list':'SCR List','scr-detail':'SCR Detail','scr-create':'Create SCR',
      'approvals':'Approvals','feedback':'Feedback','audit':'Audit Trail','master-data':'Master Data',
      'notifications':'Notifications','settings':'Settings','self-service':'Home'
    };
    const actionLabels = {
      'create_scr':'Create SCR','edit_scr':'Edit SCR','delete_scr':'Delete SCR','assign_scr':'Assign SCR',
      'advance_stage':'Advance Stage','approve':'Approve','reject':'Reject','hold':'Hold',
      'close_ticket':'Close Ticket','manage_users':'Manage Users','manage_departments':'Manage Departments',
      'view_audit':'View Audit','reset_data':'Reset Data','submit_feedback':'Submit Feedback'
    };

    const roleHeaders = roles.map(r =>
      `<th class="text-center" style="min-width:88px;font-size:var(--font-xs);line-height:1.3">${Utils.getRoleLabel(r)}</th>`
    ).join('');

    const mkRows = (keys, labels, type) => keys.map(k => `
      <tr>
        <td class="font-medium text-sm" style="white-space:nowrap">${labels[k] || k}</td>
        ${roles.map(r => `
          <td class="text-center">
            <input type="checkbox" class="rights-chk" data-role="${r}" data-type="${type}" data-val="${k}"
              ${(savedPerms[r]?.[type] || []).includes(k) ? 'checked' : ''}>
          </td>
        `).join('')}
      </tr>`).join('');

    return `
      <p class="text-tertiary text-sm mb-4">Configure page access and action permissions per role. Changes take effect immediately after saving.</p>

      <div class="card mb-6">
        <div class="card-header"><h3 class="card-title">Page Access</h3></div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th style="min-width:160px">Page</th>${roleHeaders}</tr></thead>
            <tbody>${mkRows(allPages, pageLabels, 'pages')}</tbody>
          </table>
        </div>
      </div>

      <div class="card mb-6">
        <div class="card-header"><h3 class="card-title">Action Permissions</h3></div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th style="min-width:160px">Action</th>${roleHeaders}</tr></thead>
            <tbody>${mkRows(allActions, actionLabels, 'actions')}</tbody>
          </table>
        </div>
      </div>

      <div class="flex gap-3 items-center">
        <button class="btn btn-primary" onclick="MasterData.saveUserRights()">Save Changes</button>
        <button class="btn btn-ghost" onclick="MasterData.resetUserRights()">Reset to Defaults</button>
        <span class="text-sm text-tertiary">Saved to local storage — applies to all active sessions</span>
      </div>
    `;
  },

  saveUserRights() {
    const roles = ['admin','cio','agm_it','project_head','implementation','developer','requester'];
    const perms = {};
    roles.forEach(r => { perms[r] = { pages: [], actions: [] }; });

    document.querySelectorAll('.rights-chk:checked').forEach(chk => {
      const { role, type, val } = chk.dataset;
      if (perms[role]) perms[role][type].push(val);
    });

    Store._set('role_permissions', perms);
    Audit.log('System', 'role_permissions', 'Updated', 'User Rights', null, 'Role permissions updated');
    Utils.toast('success', 'Saved', 'User rights updated successfully');
  },

  async resetUserRights() {
    const confirmed = await Utils.confirm('Reset Permissions?', 'Restore default permissions for all roles?', 'danger');
    if (confirmed) {
      Store._set('role_permissions', Auth.permissions);
      Utils.toast('success', 'Reset', 'Permissions restored to defaults');
      Router.navigate('master-data');
    }
  },

  // ── Save SLA config ─────────────────────────────────────
  // SLA rows are keyed by priority (unique). The seed historically
  // didn't assign ids, so we update by priority match — this also
  // sidesteps any id mismatch between installs.
  saveSLA() {
    const config = Store.getAll('sla_config');
    const invalid = [];
    const next = config.map(cfg => ({ ...cfg }));
    let updated = 0;

    next.forEach(cfg => {
      const input = document.getElementById(`sla-${cfg.priority}`);
      if (!input) return;
      const newVal = parseInt(input.value, 10);
      if (isNaN(newVal) || newVal < 1 || newVal > 8760) {
        invalid.push(cfg.priority);
        return;
      }
      if (newVal !== cfg.maxHours) {
        cfg.maxHours = newVal;
        if (!cfg.id) cfg.id = Utils.generateId();  // backfill missing id
        updated++;
      }
    });

    if (invalid.length > 0) {
      Utils.toast('error', 'Invalid SLA',
        `${invalid.join(', ')} must be between 1 and 8760 hours.`);
      return;
    }

    if (updated > 0) {
      Store._set('sla_config', next);
      Audit.log('System', 'sla_config', 'Updated', 'SLA Config', null, `${updated} row(s)`);
    }
    Utils.toast('success', 'SLA Updated', updated > 0 ? `${updated} SLA row(s) saved` : 'No changes');
  },

  // ── Validation helpers ─────────────────────────────────
  // Inline error: red border + message under the field. Self-clears
  // as soon as the user edits the offending input.
  _showError(fieldId, message) {
    const el = document.getElementById(fieldId);
    if (!el) {
      Utils.toast('warning', 'Invalid Input', message);
      return;
    }
    el.style.borderColor = 'var(--color-danger)';
    el.style.boxShadow = '0 0 0 3px rgba(184, 52, 30, 0.15)';

    const parent = el.parentElement;
    parent.querySelectorAll('.md-field-error').forEach(n => n.remove());

    const err = document.createElement('div');
    err.className = 'md-field-error';
    err.style.cssText = 'color:var(--color-danger);font-size:var(--font-xs);margin-top:4px;font-weight:500;line-height:1.4';
    err.textContent = message;
    parent.appendChild(err);

    setTimeout(() => el.focus(), 50);

    const clearOnce = () => {
      el.style.borderColor = '';
      el.style.boxShadow = '';
      parent.querySelectorAll('.md-field-error').forEach(n => n.remove());
      el.removeEventListener('input', clearOnce);
      el.removeEventListener('change', clearOnce);
    };
    el.addEventListener('input', clearOnce);
    el.addEventListener('change', clearOnce);
  },

  // Returns { field, message } if invalid; null if OK
  _validateDept(data, editId) {
    const nameSafe = /^[A-Za-z0-9 \-&.,()'/]+$/;
    if (!data.name) return { field: 'dept-name', message: 'Department name is required' };
    if (data.name.length < 2) return { field: 'dept-name', message: 'Name must be at least 2 characters' };
    if (data.name.length > 80) return { field: 'dept-name', message: 'Name cannot exceed 80 characters' };
    if (!nameSafe.test(data.name)) return { field: 'dept-name', message: 'Name contains invalid characters' };

    if (!data.hodName) return { field: 'dept-hod', message: 'HOD name is required' };
    if (data.hodName.length < 2) return { field: 'dept-hod', message: 'HOD name must be at least 2 characters' };
    if (data.hodName.length > 80) return { field: 'dept-hod', message: 'HOD name cannot exceed 80 characters' };

    if (data.hodEmail && !Utils.isValidEmail(data.hodEmail)) {
      return { field: 'dept-email', message: 'HOD email is not a valid email address' };
    }
    if (data.coordinatorName && data.coordinatorName.length > 80) {
      return { field: 'dept-coordinator', message: 'Coordinator name cannot exceed 80 characters' };
    }
    if (data.coordinatorEmail && !Utils.isValidEmail(data.coordinatorEmail)) {
      return { field: 'dept-coordinator-email', message: 'Coordinator email is not a valid email address' };
    }

    // Duplicate name (case-insensitive, excluding self when editing)
    const dupe = Store.getAll('departments').find(d =>
      d.name.toLowerCase() === data.name.toLowerCase() && d.id !== editId
    );
    if (dupe) return { field: 'dept-name', message: 'A department with this name already exists' };

    return null;
  },

  _validateUser(data, editId) {
    if (!data.name) return { field: 'user-name', message: 'Full name is required' };
    if (data.name.length < 2) return { field: 'user-name', message: 'Name must be at least 2 characters' };
    if (data.name.length > 80) return { field: 'user-name', message: 'Name cannot exceed 80 characters' };

    if (!data.username) return { field: 'user-username', message: 'Username is required' };
    if (data.username.length < 3) return { field: 'user-username', message: 'Username must be at least 3 characters' };
    if (data.username.length > 30) return { field: 'user-username', message: 'Username cannot exceed 30 characters' };
    if (!/^[a-z0-9_]+$/.test(data.username)) {
      return { field: 'user-username', message: 'Username can only contain lowercase letters, numbers, and underscores' };
    }

    if (!data.password) return { field: 'user-password', message: 'Password is required' };
    if (data.password.length < 4) return { field: 'user-password', message: 'Password must be at least 4 characters' };
    if (data.password.length > 60) return { field: 'user-password', message: 'Password cannot exceed 60 characters' };

    if (data.email && !Utils.isValidEmail(data.email)) {
      return { field: 'user-email', message: 'Email is not a valid email address' };
    }

    const validRoles = Object.keys(Utils.roleLabels);
    if (!validRoles.includes(data.role)) {
      return { field: 'user-role', message: 'Please select a valid role' };
    }

    const allUsers = Store.getAll('users');

    const dupeName = allUsers.find(u =>
      u.username && u.username.toLowerCase() === data.username.toLowerCase() && u.id !== editId
    );
    if (dupeName) return { field: 'user-username', message: 'A user with this username already exists' };

    if (data.email) {
      const dupeEmail = allUsers.find(u =>
        u.email && u.email.toLowerCase() === data.email.toLowerCase() && u.id !== editId
      );
      if (dupeEmail) return { field: 'user-email', message: 'Another user already has this email' };
    }

    // Lockout guard: don't let an admin demote themselves
    const session = Auth.currentUser();
    if (editId && session && session.id === editId) {
      const existing = Store.getById('users', editId);
      if (existing && existing.role === 'admin' && data.role !== 'admin') {
        return { field: 'user-role', message: 'You cannot remove admin privileges from your own account while signed in.' };
      }
    }

    // Last-admin guard: must keep at least one admin in the system
    if (editId) {
      const existing = Store.getById('users', editId);
      if (existing && existing.role === 'admin' && data.role !== 'admin') {
        const admins = allUsers.filter(u => u.role === 'admin');
        if (admins.length <= 1) {
          return { field: 'user-role', message: 'Cannot change role — at least one admin must remain in the system.' };
        }
      }
    }

    return null;
  },

  // ── Modal dirty-form guard ─────────────────────────────
  // Prevents accidental data loss when user clicks outside the modal
  // or presses Escape. Compares current field values against the
  // originals captured at modal open. If anything changed, asks for
  // confirmation before closing; otherwise closes silently.
  _guarded: {},

  _setupDirtyGuard(overlay, modalId, fieldIds, originals, kind) {
    const getDirty = () => fieldIds.some(id => {
      const el = document.getElementById(id);
      if (!el) return false;
      return (el.value || '').trim() !== (originals[id] || '').trim();
    });

    const escHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (!document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler, true);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      this._safeClose(modalId);
    };
    document.addEventListener('keydown', escHandler, true);

    // Intercept outside-click BEFORE the global handler in app.js fires
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;  // click was inside the modal box
      e.stopPropagation();
      this._safeClose(modalId);
    }, true);

    this._guarded[modalId] = { getDirty, escHandler, kind };
  },

  _disposeGuard(modalId) {
    const g = this._guarded[modalId];
    if (!g) return;
    document.removeEventListener('keydown', g.escHandler, true);
    delete this._guarded[modalId];
  },

  _safeClose(modalId) {
    const overlay = document.getElementById(modalId);
    if (!overlay) return;
    const g = this._guarded[modalId];
    if (!g || !g.getDirty()) {
      this._disposeGuard(modalId);
      overlay.remove();
      return;
    }
    this._confirmDiscard(g.kind, () => {
      this._disposeGuard(modalId);
      overlay.remove();
    });
  },

  // Same-DOM confirmation dialog (stacked on top of the form modal).
  // Higher z-index than its parent so the parent stays visible behind it.
  _confirmDiscard(kind, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';
    overlay.innerHTML = `
      <div class="modal modal-sm" style="max-width:440px">
        <div class="modal-body" style="padding:var(--space-6);text-align:center">
          <div style="font-size:3rem;margin-bottom:var(--space-3)">⚠️</div>
          <h4 style="margin-bottom:var(--space-2);font-size:var(--font-lg)">Discard changes?</h4>
          <p class="text-secondary" style="line-height:1.6;margin-bottom:var(--space-5);font-size:var(--font-base)">
            You've started entering ${Utils.escapeHtml(kind)} details. If you close now, your changes will be lost.
          </p>
          <div class="flex" style="gap:var(--space-3);justify-content:center">
            <button class="btn btn-ghost" id="dg-keep">No, Keep Editing</button>
            <button class="btn btn-danger" id="dg-discard">Yes, Discard</button>
          </div>
        </div>
      </div>
    `;
    // Block bubbling so the global app.js outside-click handler doesn't
    // remove this confirmation; user must use the buttons.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    }, true);
    document.body.appendChild(overlay);
    overlay.querySelector('#dg-keep').onclick = () => overlay.remove();
    overlay.querySelector('#dg-discard').onclick = () => {
      overlay.remove();
      onConfirm();
    };
    setTimeout(() => overlay.querySelector('#dg-keep')?.focus(), 50);
  }
};
