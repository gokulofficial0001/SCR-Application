/* ============================================================
   SCR MANAGEMENT SYSTEM — Main Application Controller
   ============================================================ */

const App = {
  // ── Initialize ──────────────────────────────────────────
  init() {
    // Seed data if first run
    Store.seed();
    // Backfill / rename legacy data in existing localStorage
    Store.migrate();
    // Trim old audit / notifications so quota stays healthy
    Store.pruneRoutine();
    // Cross-tab sync — listen for session changes and storage events
    this._bindStorageSync();

    // Check authentication
    if (!Auth.isLoggedIn()) {
      this.renderLogin();
      return;
    }

    const urlParams = new URL(window.location.href).searchParams;

    // Minimal mode — opened from Home's Track / Feedback cards in a new tab.
    // Stripped-down shell showing only the requested section.
    const minimalAction = urlParams.get('minimal');
    if (minimalAction) {
      this.renderMinimal(minimalAction);
      return;
    }

    // Render full app shell (sidebar + header + everything)
    this.renderShell();

    // New SCR tab flow — requester clicked "New Request" on Home.
    // Navigate to the full scr-create screen and set a flag so the
    // submit handler knows to show the success modal + redirect to Home
    // instead of going to SCR detail.
    const action = urlParams.get('action');
    if (action === 'new-scr') {
      sessionStorage.setItem('scr-new-tab-flow', '1');
      Router.navigate('scr-create');
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      // Normal flow — navigate to the user's default page
      const defaultPage = Auth.getDefaultPage();
      Router.navigate(defaultPage);
    }

    // Update notification badge
    Notifications.updateBadge();

    // Run SLA check
    SLAEngine.checkAndNotify();
  },

  // ── Minimal view (focused single-action tab) ────────────
  renderMinimal(action) {
    const info = {
      'create-scr': { icon: '📝', title: 'New Change Request',   sub: 'Submit a software change request to the Hospital IT team' },
      'track':      { icon: '🔍', title: 'Track Request Status', sub: 'Check the progress of an existing SCR' },
      'feedback':   { icon: '⭐', title: 'Give Feedback',          sub: 'Rate the delivery of a completed request' }
    }[action] || { icon: '📋', title: 'Self Service', sub: '' };

    document.body.dataset.mode = 'minimal';

    document.getElementById('app').innerHTML = `
      <div class="minimal-wrapper" style="min-height:100vh;display:flex;flex-direction:column;background:var(--color-bg-deepest)">
        <header class="minimal-header" style="position:sticky;top:0;z-index:10;background:var(--color-bg-elevated);border-bottom:1px solid var(--color-border);padding:var(--space-4) var(--space-6);display:flex;align-items:center;gap:var(--space-4);box-shadow:var(--shadow-sm);flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="App.backToHomeFromMinimal()" title="Back to Home">← Back to Home</button>
          <div style="flex:1;min-width:200px">
            <h1 style="font-size:var(--font-lg);margin:0;line-height:1.2;color:var(--color-text-primary)">${info.icon} ${Utils.escapeHtml(info.title)}</h1>
            ${info.sub ? `<p class="text-sm text-tertiary" style="margin:2px 0 0">${Utils.escapeHtml(info.sub)}</p>` : ''}
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-tertiary)">
            ${Utils.escapeHtml(Auth.currentUser()?.name || '')}
          </div>
        </header>
        <main style="flex:1;padding:var(--space-5) var(--space-4);width:100%;max-width:960px;margin:0 auto">
          <div id="minimal-content"></div>
        </main>
        <div class="toast-container" id="toast-container"></div>
      </div>
    `;

    // Mount the specific section into the minimal content area
    setTimeout(() => {
      if (typeof SelfService !== 'undefined' && SelfService.renderMinimal) {
        SelfService.renderMinimal(action);
      }
    }, 40);
  },

  // ── Exit minimal mode — load full Home in the same tab ──
  backToHomeFromMinimal() {
    // Drop ?minimal= from the URL, reload into the normal app shell
    delete document.body.dataset.mode;
    window.location.href = window.location.pathname;
  },

  // ── Render Login ────────────────────────────────────────
  renderLogin() {
    document.getElementById('app').innerHTML = Auth.renderLoginPage();
  },

  // ── Render App Shell ────────────────────────────────────
  renderShell() {
    const user = Auth.currentUser();
    const isRequester = user.role === 'requester';

    document.getElementById('app').innerHTML = `
      <!-- Sidebar -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="brand-icon">SCR</div>
          <div class="brand-text">
            <span class="brand-name">SCR System</span>
            <span class="brand-sub">Hospital IT</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          ${isRequester ? `
            <div class="nav-section">
              <div class="nav-section-title">Portal</div>
              <div class="nav-item" data-page="self-service" onclick="Router.navigate('self-service')">
                <span class="nav-icon">🏠</span>
                <span class="nav-label">Home</span>
              </div>
            </div>
          ` : `
            <div class="nav-section">
              <div class="nav-section-title">Overview</div>
              <div class="nav-item" data-page="dashboard" onclick="Router.navigate('dashboard')">
                <span class="nav-icon">📊</span>
                <span class="nav-label">Dashboard</span>
              </div>
            </div>

            <div class="nav-section">
              <div class="nav-section-title">Management</div>
              <div class="nav-item" data-page="scr-list" onclick="Router.navigate('scr-list')">
                <span class="nav-icon">📋</span>
                <span class="nav-label">SCR Requests</span>
              </div>
              ${Auth.canAccessPage('scr-create') ? `
                <div class="nav-item" data-page="scr-create" onclick="Router.navigate('scr-create')">
                  <span class="nav-icon">➕</span>
                  <span class="nav-label">New SCR</span>
                </div>
              ` : ''}
              ${Auth.canAccessPage('approvals') ? `
                <div class="nav-item" data-page="approvals" onclick="Router.navigate('approvals')">
                  <span class="nav-icon">✅</span>
                  <span class="nav-label">Approvals</span>
                </div>
              ` : ''}
            </div>
          `}

          ${Auth.canAccessPage('feedback') ? `
            <div class="nav-section">
              <div class="nav-section-title">Insights</div>
              <div class="nav-item" data-page="feedback" onclick="Router.navigate('feedback')">
                <span class="nav-icon">⭐</span>
                <span class="nav-label">Feedback</span>
              </div>
              ${Auth.canAccessPage('audit') ? `
                <div class="nav-item" data-page="audit" onclick="Router.navigate('audit')">
                  <span class="nav-icon">🔒</span>
                  <span class="nav-label">Audit Trail</span>
                </div>
              ` : ''}
              ${Auth.canAccessPage('reports') ? `
                <div class="nav-item" data-page="reports" onclick="Router.navigate('reports')">
                  <span class="nav-icon">📊</span>
                  <span class="nav-label">Reports</span>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <div class="nav-section">
            <div class="nav-section-title">System</div>
            <div class="nav-item" data-page="notifications" onclick="Router.navigate('notifications')">
              <span class="nav-icon">🔔</span>
              <span class="nav-label">Notifications</span>
              <span class="nav-badge" id="nav-notif-badge" style="display:none">0</span>
            </div>
            ${Auth.canAccessPage('master-data') ? `
              <div class="nav-item" data-page="master-data" onclick="Router.navigate('master-data')">
                <span class="nav-icon">🗃️</span>
                <span class="nav-label">Master Data</span>
              </div>
            ` : ''}
            ${Auth.canAccessPage('settings') ? `
              <div class="nav-item" data-page="settings" onclick="Router.navigate('settings')">
                <span class="nav-icon">⚙️</span>
                <span class="nav-label">Settings</span>
              </div>
            ` : ''}
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="nav-item" onclick="Auth.logout()" style="color:var(--color-danger-light)">
            <span class="nav-icon">🚪</span>
            <span class="nav-label">Sign Out</span>
          </div>
        </div>
      </aside>

      <!-- Mobile sidebar backdrop -->
      <div class="sidebar-backdrop" id="sidebar-backdrop" onclick="App.toggleSidebar()"></div>

      <!-- Header -->
      <header class="header" id="header">
        <div class="header-left">
          <button class="header-toggle" onclick="App.toggleSidebar()" aria-label="Toggle sidebar">☰</button>
          <h1 class="header-title" id="header-title">Dashboard</h1>
        </div>
        <div class="header-right">
          <button class="notification-btn" onclick="Notifications.togglePanel()" aria-label="Notifications">
            🔔
            <span class="notif-count" id="notif-badge" style="display:none">0</span>
          </button>
          <div class="user-menu" onclick="App.toggleUserMenu()">
            <div class="user-avatar">${Utils.getInitials(user.name)}</div>
            <div class="user-info">
              <span class="user-name">${Utils.escapeHtml(user.name)}</span>
              <span class="user-role">${Utils.getRoleLabel(user.role)}</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <main class="app-content" id="app-content">
        <div class="content-area" id="content-area">
          <div class="flex items-center justify-center p-8"><div class="spinner lg"></div></div>
        </div>
      </main>

      <!-- Toast Container -->
      <div class="toast-container" id="toast-container"></div>
    `;
  },

  // ── Toggle sidebar (mobile) ─────────────────────────────
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
      backdrop.classList.toggle('active');
    } else {
      sidebar.classList.toggle('collapsed');
      document.getElementById('app-content').classList.toggle('sidebar-collapsed');
      document.getElementById('header').classList.toggle('sidebar-collapsed');
    }
  },

  // ── User menu toggle ───────────────────────────────────
  toggleUserMenu() {
    // Simple — navigate to settings
    if (Auth.canAccessPage('settings')) {
      Router.navigate('settings');
    }
  },

  // ── Cross-tab sync ──────────────────────────────────────
  // If user logs in/out in another tab, keep this tab consistent
  _storageSyncBound: false,
  _bindStorageSync() {
    if (this._storageSyncBound) return;
    this._storageSyncBound = true;
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      // Session changed in another tab — re-init so UI matches truth
      if (e.key === 'scr_session') {
        const wasLoggedIn = !!e.oldValue;
        const nowLoggedIn = !!e.newValue;
        if (wasLoggedIn !== nowLoggedIn || e.oldValue !== e.newValue) {
          // Close any open panels first
          const panel = document.getElementById('notif-panel');
          if (panel) panel.remove();
          if (typeof Notifications !== 'undefined') Notifications.panelOpen = false;
          this.init();
        }
      }
      // Notifications updated in another tab — refresh badge
      if (e.key === 'scr_notifications' && typeof Notifications !== 'undefined' && Auth.isLoggedIn()) {
        Notifications.updateBadge();
      }
    });

    // Escape key closes the topmost modal / notif panel
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modals = document.querySelectorAll('.modal-overlay');
      if (modals.length > 0) {
        modals[modals.length - 1].remove();
        return;
      }
      const notifPanel = document.getElementById('notif-panel');
      if (notifPanel) {
        notifPanel.remove();
        if (typeof Notifications !== 'undefined') Notifications.panelOpen = false;
      }
    });

    // Click on overlay (but not on the modal itself) closes modal
    document.addEventListener('click', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
        e.target.remove();
      }
    });
  }
};

// ── Boot ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
