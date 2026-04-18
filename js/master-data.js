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
          <button class="modal-close" onclick="document.getElementById('dept-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Department Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="dept-name" value="${Utils.escapeHtml(dept.name || '')}" placeholder="e.g., Cardiology">
          </div>
          <div class="form-group">
            <label class="form-label">HOD Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="dept-hod" value="${Utils.escapeHtml(dept.hodName || '')}" placeholder="e.g., Dr. Ramesh Kumar">
          </div>
          <div class="form-group">
            <label class="form-label">HOD Email</label>
            <input type="email" class="form-input" id="dept-email" value="${Utils.escapeHtml(dept.hodEmail || '')}" placeholder="e.g., ramesh@hospital.in">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('dept-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="MasterData.saveDept('${editId || ''}')">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  saveDept(editId) {
    const name = document.getElementById('dept-name').value.trim();
    const hodName = document.getElementById('dept-hod').value.trim();
    const hodEmail = document.getElementById('dept-email').value.trim();

    if (!name || !hodName) {
      Utils.toast('warning', 'Required', 'Name and HOD are required');
      return;
    }

    if (editId) {
      Store.update('departments', editId, { name, hodName, hodEmail });
      Audit.log('Department', editId, 'Updated', 'name', null, name);
      Utils.toast('success', 'Updated', `${name} department updated`);
    } else {
      Store.add('departments', { name, hodName, hodEmail });
      Audit.log('Department', name, 'Created', null, null, name);
      Utils.toast('success', 'Added', `${name} department added`);
    }

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
          <button class="modal-close" onclick="document.getElementById('user-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Full Name <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-name" value="${Utils.escapeHtml(user.name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Username <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-username" value="${Utils.escapeHtml(user.username || '')}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Password <span class="required">*</span></label>
              <input type="text" class="form-input" id="user-password" value="${Utils.escapeHtml(user.password || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="form-input" id="user-email" value="${Utils.escapeHtml(user.email || '')}">
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
          <button class="btn btn-ghost" onclick="document.getElementById('user-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="MasterData.saveUser('${editId || ''}')">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  saveUser(editId) {
    const data = {
      name: document.getElementById('user-name').value.trim(),
      username: document.getElementById('user-username').value.trim(),
      password: document.getElementById('user-password').value,
      email: document.getElementById('user-email').value.trim(),
      role: document.getElementById('user-role').value,
      department: document.getElementById('user-dept').value
    };

    if (!data.name || !data.username || !data.password) {
      Utils.toast('warning', 'Required', 'Name, username, and password are required');
      return;
    }

    if (editId) {
      Store.update('users', editId, data);
      Utils.toast('success', 'Updated', `User ${data.name} updated`);
    } else {
      Store.add('users', data);
      Utils.toast('success', 'Added', `User ${data.name} created`);
    }

    document.getElementById('user-modal')?.remove();
    Router.navigate('master-data');
  },

  async deleteUser(id) {
    const user = Store.getById('users', id);
    const confirmed = await Utils.confirm('Delete User?', `Remove "${user?.name}"?`, 'danger');
    if (confirmed) {
      Store.remove('users', id);
      Utils.toast('success', 'Deleted', 'User removed');
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
  saveSLA() {
    const config = Store.getAll('sla_config');
    const invalid = [];
    let updated = 0;
    config.forEach(cfg => {
      const input = document.getElementById(`sla-${cfg.priority}`);
      if (!input) return;
      const newVal = parseInt(input.value, 10);
      if (isNaN(newVal) || newVal < 1 || newVal > 8760) {
        invalid.push(cfg.priority);
        return;
      }
      if (newVal !== cfg.maxHours) {
        Store.update('sla_config', cfg.id, { maxHours: newVal });
        updated++;
      }
    });

    if (invalid.length > 0) {
      Utils.toast('error', 'Invalid SLA',
        `${invalid.join(', ')} must be between 1 and 8760 hours.`);
      return;
    }

    Utils.toast('success', 'SLA Updated', updated > 0 ? `${updated} SLA row(s) saved` : 'No changes');
    if (updated > 0) Audit.log('System', 'sla_config', 'Updated', 'SLA Config', null, 'Updated');
  }
};
