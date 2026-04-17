/* ============================================================
   SCR MANAGEMENT SYSTEM — Main Application Controller
   ============================================================ */

const App = {
  // ── Initialize ──────────────────────────────────────────
  init() {
    // Seed data if first run
    Store.seed();

    // Check authentication
    if (!Auth.isLoggedIn()) {
      this.renderLogin();
      return;
    }

    // Render app shell
    this.renderShell();

    // Navigate to default page
    const defaultPage = Auth.getDefaultPage();
    Router.navigate(defaultPage);

    // Update notification badge
    Notifications.updateBadge();

    // Run SLA check
    SLAEngine.checkAndNotify();
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
                <span class="nav-label">Self Service</span>
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
  }
};

// ── Boot ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
