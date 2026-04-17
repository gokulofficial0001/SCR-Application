/* ============================================================
   SCR MANAGEMENT SYSTEM — Authentication & Role Management
   ============================================================ */

const Auth = {
  // ── Permission Matrix ───────────────────────────────────
  permissions: {
    admin: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'approvals', 'feedback', 'audit', 'master-data', 'notifications', 'settings'],
      actions: ['create_scr', 'edit_scr', 'delete_scr', 'assign_scr', 'advance_stage', 'approve', 'reject', 'hold', 'close_ticket', 'manage_users', 'manage_departments', 'view_audit', 'reset_data']
    },
    cio: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['approve', 'reject', 'view_audit']
    },
    agm_it: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'approvals', 'feedback', 'audit', 'notifications'],
      actions: ['approve', 'reject', 'view_audit']
    },
    project_head: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'feedback', 'audit', 'notifications'],
      actions: ['create_scr', 'edit_scr', 'assign_scr', 'advance_stage', 'reject', 'view_audit']
    },
    implementation: {
      pages: ['dashboard', 'scr-list', 'scr-detail', 'scr-create', 'feedback', 'audit', 'notifications'],
      actions: ['create_scr', 'edit_scr', 'assign_scr', 'advance_stage', 'reject', 'close_ticket', 'view_audit']
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
    // Close notification panel if open
    const panel = document.getElementById('notif-panel');
    if (panel) panel.remove();
    Notifications.panelOpen = false;
    App.init();
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
  _getPermissions() {
    return Store._get('role_permissions') || this.permissions;
  },

  canAccessPage(page) {
    const user = this.currentUser();
    if (!user) return false;
    const perms = this._getPermissions()[user.role];
    if (!perms) return false;
    return perms.pages.includes(page);
  },

  canPerformAction(action) {
    const user = this.currentUser();
    if (!user) return false;
    const perms = this._getPermissions()[user.role];
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
      <div class="login-split">

        <!-- ═══ LEFT VISUAL PANEL ═══ -->
        <div class="login-visual">
          <!-- Gradient mesh orbs -->
          <div class="lv-mesh lv-mesh-1"></div>
          <div class="lv-mesh lv-mesh-2"></div>
          <div class="lv-mesh lv-mesh-3"></div>

          <!-- Network nodes (positions match SVG connection coords) -->
          <div class="lv-nodes">
            <span class="lv-node"     style="top:12%;left:8%"></span>
            <span class="lv-node"     style="top:22%;left:28%"></span>
            <span class="lv-node"     style="top:38%;left:12%"></span>
            <span class="lv-node"     style="top:55%;left:35%"></span>
            <span class="lv-node"     style="top:70%;left:15%"></span>
            <span class="lv-node"     style="top:82%;left:42%"></span>
            <span class="lv-node"     style="top:15%;left:58%"></span>
            <span class="lv-node"     style="top:45%;left:62%"></span>
            <span class="lv-node"     style="top:65%;left:55%"></span>
            <span class="lv-node"     style="top:30%;left:78%"></span>
            <span class="lv-node lv-node-lg" style="top:10%;left:42%"></span>
            <span class="lv-node lv-node-lg" style="top:62%;left:28%"></span>
            <span class="lv-node lv-node-lg" style="top:85%;left:65%"></span>
          </div>

          <!-- Animated network connection lines -->
          <svg class="lv-connections" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line class="lv-conn" x1="8"  y1="12" x2="28" y2="22"/>
            <line class="lv-conn" x1="28" y1="22" x2="12" y2="38"/>
            <line class="lv-conn" x1="12" y1="38" x2="35" y2="55"/>
            <line class="lv-conn" x1="35" y1="55" x2="28" y2="62"/>
            <line class="lv-conn" x1="28" y1="62" x2="15" y2="70"/>
            <line class="lv-conn" x1="15" y1="70" x2="42" y2="82"/>
            <line class="lv-conn" x1="42" y1="82" x2="65" y2="85"/>
            <line class="lv-conn" x1="42" y1="10" x2="58" y2="15"/>
            <line class="lv-conn" x1="58" y1="15" x2="78" y2="30"/>
            <line class="lv-conn" x1="78" y1="30" x2="62" y2="45"/>
            <line class="lv-conn" x1="62" y1="45" x2="55" y2="65"/>
            <line class="lv-conn" x1="28" y1="22" x2="42" y2="10"/>
            <line class="lv-conn" x1="35" y1="55" x2="62" y2="45"/>
            <line class="lv-conn" x1="55" y1="65" x2="65" y2="85"/>
          </svg>

          <!-- Rotating rings + hospital cross brand mark -->
          <div class="lv-center">
            <div class="lv-rings">
              <div class="lv-ring lv-ring-1"></div>
              <div class="lv-ring lv-ring-2"></div>
              <div class="lv-ring lv-ring-3"></div>
            </div>
            <div class="lv-brand-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="13" y="2"  width="6" height="28" rx="2" fill="white"/>
                <rect x="2"  y="13" width="28" height="6" rx="2" fill="white"/>
              </svg>
            </div>
          </div>

          <!-- ECG pulse line -->
          <div class="lv-ecg-wrap">
            <svg class="lv-ecg" viewBox="0 0 900 80" preserveAspectRatio="none">
              <polyline class="lv-ecg-line" points="
                0,40 90,40 120,40 145,12 160,68 175,6 192,56 215,40
                300,40 330,40 355,12 370,68 385,6 402,56 425,40
                510,40 540,40 565,12 580,68 595,6 612,56 635,40
                900,40"/>
            </svg>
          </div>

          <!-- Branding text -->
          <div class="lv-content">
            <div class="lv-tag"><span class="lv-tag-dot"></span>Hospital IT Operations</div>
            <h1 class="lv-title">Software Change<br>Request System</h1>
            <p class="lv-sub">Structured workflows. Full traceability.<br>Clinical excellence through technology.</p>
            <div class="lv-chips">
              <span class="lv-chip">6-Stage Workflow</span>
              <span class="lv-chip">Dual Approval</span>
              <span class="lv-chip">Complete Audit Trail</span>
            </div>
          </div>
        </div>

        <!-- ═══ RIGHT FORM PANEL ═══ -->
        <div class="login-form-side">
          <div class="login-card">
            <div class="login-logo">SCR</div>
            <h2 class="login-title">Welcome Back</h2>
            <p class="login-subtitle">Sign in to continue</p>

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
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('admin','admin123')"      title="Full system access">👑 Admin</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('cio','cio123')"          title="Chief Information Officer">🏛️ CIO</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('agm','agm123')"          title="AGM IT">📊 AGM – IT</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('projecthead','ph123')"   title="Project Head">📋 Proj. Head</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('impl','impl123')"        title="Implementation Team" style="background:rgba(20,184,166,0.1);border-color:rgba(20,184,166,0.3);color:#5eead4;">🔬 Impl. Team</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('developer','dev123')"    title="Developer">💻 Developer</button>
                <button class="btn btn-ghost btn-sm" onclick="Auth.quickLogin('requester','req123')"    title="Requester" style="grid-column:span 3">🙋 Requester (End User)</button>
              </div>
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
