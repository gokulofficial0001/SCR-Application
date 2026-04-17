/* ============================================================
   SCR MANAGEMENT SYSTEM — Authentication & Role Management
   ============================================================ */

const Auth = {
  // ── Permission Matrix ───────────────────────────────────
  permissions: {
    admin: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'approvals', 'feedback', 'audit', 'master-data', 'notifications', 'settings'],
      actions: ['create_scr', 'edit_scr', 'delete_scr', 'assign_scr', 'advance_stage', 'approve', 'reject', 'hold', 'manage_users', 'manage_departments', 'view_audit', 'reset_data']
    },
    cio: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['approve', 'reject', 'hold', 'view_audit']
    },
    agm_it: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['approve', 'reject', 'hold', 'advance_stage', 'view_audit']
    },
    project_head: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['create_scr', 'edit_scr', 'assign_scr', 'advance_stage', 'approve', 'reject', 'hold', 'view_audit']
    },
    it_coordinator: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'feedback', 'notifications'],
      actions: ['create_scr', 'edit_scr', 'assign_scr', 'advance_stage']
    },
    implementation: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['create_scr', 'edit_scr', 'assign_scr', 'advance_stage', 'approve', 'reject', 'hold', 'view_audit']
    },
    developer: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'feedback', 'notifications'],
      actions: ['edit_scr', 'advance_stage']
    },
    requester: {
      pages: ['self-service', 'scr-detail', 'feedback', 'notifications'],
      actions: ['create_scr', 'submit_feedback']
    }
  },

  // ── Login ───────────────────────────────────────────────
  login(username, password) {
    const users = Store.getAll('users');
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return { success: false, error: 'Invalid username or password' };

    const session = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      email: user.email,
      department: user.department,
      loginAt: Utils.nowISO()
    };

    Store.setSession(session);

    // Audit log
    Audit.log('User', user.id, 'Login', null, null, null, user.name, user.role);

    return { success: true, user: session };
  },

  // ── Logout ──────────────────────────────────────────────
  logout() {
    const session = this.currentUser();
    if (session) {
      Audit.log('User', session.id, 'Logout', null, null, null, session.name, session.role);
    }
    Store.clearSession();
    Router.navigate('login');
  },

  // ── Current User ────────────────────────────────────────
  currentUser() {
    return Store.getSession();
  },

  // ── Check auth ──────────────────────────────────────────
  isLoggedIn() {
    return !!this.currentUser();
  },

  // ── Permission checks ──────────────────────────────────
  canAccessPage(page) {
    const user = this.currentUser();
    if (!user) return false;
    const perms = this.permissions[user.role];
    if (!perms) return false;
    return perms.pages.includes(page);
  },

  canPerformAction(action) {
    const user = this.currentUser();
    if (!user) return false;
    const perms = this.permissions[user.role];
    if (!perms) return false;
    return perms.actions.includes(action);
  },

  hasRole(...roles) {
    const user = this.currentUser();
    if (!user) return false;
    return roles.includes(user.role);
  },

  // ── Get default page for role ───────────────────────────
  getDefaultPage() {
    const user = this.currentUser();
    if (!user) return 'login';
    if (user.role === 'requester') return 'self-service';
    return 'dashboard';
  },

  // ── Render login page ──────────────────────────────────
  renderLoginPage() {
    return `
      <div class="login-page">
        <div class="login-card">
          <div class="login-logo">SCR</div>
          <h2 class="login-title">Welcome Back</h2>
          <p class="login-subtitle">Hospital IT — SCR Management System</p>
          
          <form id="login-form" onsubmit="Auth.handleLogin(event)">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" id="login-username" class="form-input" placeholder="Enter your username" required autocomplete="username">
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" id="login-password" class="form-input" placeholder="Enter your password" required autocomplete="current-password">
            </div>
            <div id="login-error" class="form-error hidden" style="margin-bottom:var(--space-4);text-align:center;font-size:var(--font-base)"></div>
            <button type="submit" class="btn btn-primary btn-lg w-full" id="login-btn" style="margin-top:var(--space-2)">
              Sign In
            </button>
          </form>

          <div style="margin-top:var(--space-8);padding-top:var(--space-4);border-top:var(--glass-border);">
            <p class="text-sm text-tertiary text-center" style="margin-bottom:var(--space-3)">Quick Demo Login</p>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-2);font-size:var(--font-xs)">
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('admin','admin123')" title="Full system access">👑 Admin</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('cio','cio123')" title="Chief Information Officer">🏛️ CIO</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('projecthead','ph123')" title="Project Head — approves tickets">📋 Proj. Head</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('impl','impl123')" title="Implementation Team — studies & first-level approval" style="background:rgba(20,184,166,0.1);border-color:rgba(20,184,166,0.3);color:#5eead4;">🔬 Impl. Team</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('coordinator','itc123')" title="IT Coordinator">🔗 IT Coord.</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('developer','dev123')" title="Developer">💻 Developer</button>
              <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('requester','req123')" title="Requester — submits SCRs" style="grid-column:span 3">🙋 Requester (End User)</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ── Handle login form ──────────────────────────────────
  handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    const result = Auth.login(username, password);
    if (result.success) {
      Utils.toast('success', 'Welcome!', `Signed in as ${result.user.name}`);
      App.init();
    } else {
      const errEl = document.getElementById('login-error');
      errEl.textContent = result.error;
      errEl.classList.remove('hidden');
      document.getElementById('login-password').value = '';
    }
  },

  // ── Quick login for demo ────────────────────────────────
  quickLogin(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
    const result = Auth.login(username, password);
    if (result.success) {
      Utils.toast('success', 'Welcome!', `Signed in as ${result.user.name}`);
      App.init();
    }
  }
};
