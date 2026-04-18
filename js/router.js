/* ============================================================
   SCR MANAGEMENT SYSTEM — SPA Router
   ============================================================ */

const Router = {
  currentPage: null,
  params: {},

  // ── Navigation history stack (for "← Back" buttons) ─────
  history: [],
  _maxHistory: 30,

  // ── Navigate to a page ──────────────────────────────────
  // skipHistory: true when called from goBack() so we don't re-record
  navigate(page, params = {}, skipHistory = false) {
    // Auth guard
    if (page !== 'login' && !Auth.isLoggedIn()) {
      App.init();
      return;
    }

    // Permission guard
    if (page !== 'login' && !Auth.canAccessPage(page)) {
      // Redirect to default page for role
      const defaultPage = Auth.getDefaultPage();
      if (page !== defaultPage) {
        Utils.toast('warning', 'Access Denied', 'You don\'t have permission to access that page.');
        this.navigate(defaultPage);
        return;
      }
    }

    // Record previous page so "← Back" knows where to go
    if (!skipHistory && this.currentPage && this.currentPage !== page) {
      this.history.push({ page: this.currentPage, params: { ...this.params } });
      if (this.history.length > this._maxHistory) this.history.shift();
    }

    this.currentPage = page;
    this.params = params;

    // Update sidebar active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update header title
    const titles = {
      'dashboard': 'Dashboard',
      'scr-list': 'SCR Requests',
      'scr-detail': `SCR Details`,
      'scr-create': 'New SCR Request',
      'approvals': 'Approvals',
      'feedback': 'Feedback',
      'audit': 'Audit Trail',
      'reports': 'Audit Reports',
      'master-data': 'Master Data',
      'notifications': 'Notifications',
      'settings': 'Settings',
      'self-service': 'Home'
    };
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = titles[page] || page;

    // Render page content
    this.render(page, params);

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
    document.querySelector('.sidebar-backdrop')?.classList.remove('active');

    // Scroll to top
    window.scrollTo(0, 0);
  },

  // ── Render page content ─────────────────────────────────
  render(page, params) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    contentArea.innerHTML = '<div class="flex items-center justify-center p-8"><div class="spinner lg"></div></div>';

    // Small delay for smooth transition feel
    setTimeout(() => {
      let html = '';
      switch (page) {
        case 'dashboard':
          html = Dashboard.render();
          break;
        case 'scr-list':
          html = SCRManager.renderList();
          break;
        case 'scr-detail':
          html = SCRManager.renderDetail(params.id);
          break;
        case 'scr-create':
          html = SCRManager.renderForm(params.id);
          break;
        case 'approvals':
          html = Approval.renderList();
          break;
        case 'feedback':
          html = Feedback.renderList();
          break;
        case 'audit':
          html = Audit.renderLog();
          break;
        case 'reports':
          html = Reports.render();
          break;
        case 'master-data':
          html = MasterData.render();
          break;
        case 'notifications':
          html = Notifications.renderPage();
          break;
        case 'self-service':
          html = SelfService.render();
          break;
        case 'settings':
          html = this.renderSettings();
          break;
        default:
          html = `<div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <h3 class="empty-state-title">Page Not Found</h3>
            <p class="empty-state-text">The page you're looking for doesn't exist.</p>
            <button class="btn btn-primary" onclick="Router.navigate('dashboard')">Go to Dashboard</button>
          </div>`;
      }

      contentArea.innerHTML = `<div class="animate-fade-in">${html}</div>`;

      // Post-render hooks
      switch (page) {
        case 'dashboard':
          Dashboard.postRender();
          break;
        case 'scr-list':
          SCRManager.postRenderList();
          break;
        case 'scr-create':
          SCRManager.postRenderForm();
          break;
        case 'feedback':
          Feedback.postRender();
          break;
      }
    }, 80);
  },

  // ── Settings page ───────────────────────────────────────
  renderSettings() {
    const user = Auth.currentUser();
    if (!user) { App.init(); return ''; }
    return `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${this.renderBackButton()}
            <h2 class="page-title">Settings</h2>
          </div>
          <p class="page-description">System configuration and preferences</p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6)">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">👤 Profile</h3>
          </div>
          <div class="card-body">
            <div class="detail-grid">
              <div class="detail-field">
                <span class="detail-label">Name</span>
                <span class="detail-value">${Utils.escapeHtml(user.name || '—')}</span>
              </div>
              <div class="detail-field">
                <span class="detail-label">Role</span>
                <span class="detail-value">${Utils.escapeHtml(Utils.getRoleLabel(user.role))}</span>
              </div>
              <div class="detail-field">
                <span class="detail-label">Email</span>
                <span class="detail-value">${Utils.escapeHtml(user.email || '—')}</span>
              </div>
              <div class="detail-field">
                <span class="detail-label">Department</span>
                <span class="detail-value">${Utils.escapeHtml(user.department || '—')}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">⚙️ System</h3>
          </div>
          <div class="card-body">
            <p class="text-secondary mb-4">SCR Management System v1.0</p>
            <p class="text-tertiary text-sm mb-6">Built for Hospital IT Operations</p>
            ${Auth.canPerformAction('reset_data') ? `
              <button class="btn btn-danger" onclick="Router.handleReset()">🔄 Reset All Data</button>
              <p class="form-hint mt-2">This will reset all data to demo defaults</p>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  // ── Back button helpers ─────────────────────────────────
  canGoBack() {
    return this.history.length > 0;
  },

  goBack() {
    const prev = this.history.pop();
    if (prev) {
      this.navigate(prev.page, prev.params, true);
    } else {
      // No history — fall back to user's default home
      this.navigate(Auth.getDefaultPage(), {}, true);
    }
  },

  // Reusable back button — call from any page header
  // Returns empty string if there's nothing to go back to (so the
  // user's default home page doesn't show a pointless button).
  renderBackButton(size = 'sm') {
    if (!this.canGoBack()) return '';
    const cls = size === 'sm' ? 'btn btn-ghost btn-sm' : 'btn btn-ghost';
    return `<button class="${cls}" onclick="Router.goBack()" aria-label="Go back" title="Go back to previous page">← Back</button>`;
  },

  async handleReset() {
    const confirmed = await Utils.confirm('Reset Data?', 'All data will be reset to demo defaults. This cannot be undone.', 'danger');
    if (confirmed) {
      Store.resetAll();
      Utils.toast('success', 'Data Reset', 'All data has been reset to defaults.');
      Router.navigate('dashboard');
    }
  }
};
