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
          <h2 class="page-title">Master Data</h2>
          <p class="page-description">Manage departments, staff, and system configuration</p>
        </div>
      </div>

      <div class="tabs">
        <button class="tab ${this.activeTab === 'departments' ? 'active' : ''}" onclick="MasterData.switchTab('departments', this)">🏢 Departments (${depts.length})</button>
        <button class="tab ${this.activeTab === 'staff' ? 'active' : ''}" onclick="MasterData.switchTab('staff', this)">👥 Staff (${users.length})</button>
        <button class="tab ${this.activeTab === 'sla' ? 'active' : ''}" onclick="MasterData.switchTab('sla', this)">⏱️ SLA Config</button>
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
    `;
  },

  switchTab(tab, el) {
    this.activeTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    ['departments', 'staff', 'sla'].forEach(t => {
      const el = document.getElementById(`master-tab-${t}`);
      if (el) el.classList.toggle('hidden', t !== tab);
    });
  },

  // ── Department Form ─────────────────────────────────────
  showDeptForm(editId) {
    const dept = editId ? Store.getById('departments', editId) : {};
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
    const confirmed = await Utils.confirm('Delete Department?', `Remove "${dept?.name}"? This cannot be undone.`, 'danger');
    if (confirmed) {
      Store.remove('departments', id);
      Audit.log('Department', id, 'Deleted', null, dept?.name, null);
      Utils.toast('success', 'Deleted', 'Department removed');
      Router.navigate('master-data');
    }
  },

  // ── User Form ───────────────────────────────────────────
  showUserForm(editId) {
    const user = editId ? Store.getById('users', editId) : {};
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

  // ── Save SLA config ─────────────────────────────────────
  saveSLA() {
    const config = Store.getAll('sla_config');
    config.forEach(cfg => {
      const input = document.getElementById(`sla-${cfg.priority}`);
      if (input) {
        const newVal = parseInt(input.value);
        if (newVal > 0) {
          Store.update('sla_config', cfg.id, { maxHours: newVal });
        }
      }
    });
    Utils.toast('success', 'SLA Updated', 'SLA configuration saved');
    Audit.log('System', 'sla_config', 'Updated', 'SLA Config', null, 'Updated');
  }
};
