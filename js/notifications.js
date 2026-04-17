/* ============================================================
   SCR MANAGEMENT SYSTEM — Notification System
   ============================================================ */

const Notifications = {
  // ── Create notification ─────────────────────────────────
  create(userId, message, type, scrId) {
    return Store.add('notifications', {
      userId,
      message,
      type,
      scrId: scrId || null,
      read: false,
      timestamp: Utils.nowISO()
    });
  },

  // ── Get for current user ────────────────────────────────
  getForCurrentUser() {
    const user = Auth.currentUser();
    if (!user) return [];
    return Store.filter('notifications', n => n.userId === user.id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // ── Unread count ────────────────────────────────────────
  getUnreadCount() {
    const user = Auth.currentUser();
    if (!user) return 0;
    return Store.count('notifications', n => n.userId === user.id && !n.read);
  },

  // ── Mark as read ────────────────────────────────────────
  markRead(id) {
    Store.update('notifications', id, { read: true });
    this.updateBadge();
  },

  // ── Mark all as read ────────────────────────────────────
  markAllRead() {
    const userNotifs = this.getForCurrentUser();
    userNotifs.forEach(n => {
      if (!n.read) Store.update('notifications', n.id, { read: true });
    });
    this.updateBadge();
  },

  // ── Update bell badge ──────────────────────────────────
  updateBadge() {
    const count = this.getUnreadCount();
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
    // Update sidebar badge
    const navBadge = document.getElementById('nav-notif-badge');
    if (navBadge) {
      navBadge.textContent = count;
      navBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  },

  // ── Toggle notification panel ───────────────────────────
  panelOpen: false,

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    let panel = document.getElementById('notif-panel');

    if (this.panelOpen) {
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'notif-panel';
        panel.className = 'notif-panel';
        document.body.appendChild(panel);
      }
      this.renderPanel();
    } else if (panel) {
      panel.remove();
    }
  },

  // ── Render panel ────────────────────────────────────────
  renderPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;

    const notifs = this.getForCurrentUser().slice(0, 20);

    panel.innerHTML = `
      <div class="notif-panel-header">
        <h4 style="font-size:var(--font-md);font-weight:var(--font-weight-semi)">Notifications</h4>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-ghost btn-sm" onclick="Notifications.markAllRead();Notifications.renderPanel()">Mark all read</button>
          <button class="btn btn-ghost btn-sm" onclick="Notifications.togglePanel()">✕</button>
        </div>
      </div>
      <div class="notif-panel-body">
        ${notifs.length === 0 ? `
          <div class="empty-state" style="padding:var(--space-8) var(--space-4)">
            <div class="empty-state-icon">🔔</div>
            <p class="empty-state-text">No notifications yet</p>
          </div>
        ` : notifs.map(n => `
          <div class="notif-item ${n.read ? '' : 'unread'}" onclick="Notifications.handleClick('${n.id}', '${n.scrId || ''}')">
            ${!n.read ? '<div class="notif-dot"></div>' : '<div style="width:8px"></div>'}
            <div>
              <div class="notif-text">${Utils.escapeHtml(n.message)}</div>
              <div class="notif-time">${Utils.formatTimeAgo(n.timestamp)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      ${notifs.length > 0 ? `
        <div style="padding:var(--space-3);border-top:var(--glass-border);text-align:center">
          <button class="btn btn-ghost btn-sm" onclick="Notifications.togglePanel();Router.navigate('notifications')">View All</button>
        </div>
      ` : ''}
    `;
  },

  // ── Handle notification click ───────────────────────────
  handleClick(notifId, scrId) {
    this.markRead(notifId);
    this.togglePanel();
    if (scrId) {
      Router.navigate('scr-detail', { id: scrId });
    }
  },

  // ── Render full notifications page ──────────────────────
  renderPage() {
    const notifs = this.getForCurrentUser();

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Notifications</h2>
          <p class="page-description">All your notifications in one place</p>
        </div>
        <button class="btn btn-ghost" onclick="Notifications.markAllRead();Router.navigate('notifications')">
          ✓ Mark All Read
        </button>
      </div>

      <div class="card">
        <div class="card-body">
          ${notifs.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">🔔</div>
              <h3 class="empty-state-title">All caught up!</h3>
              <p class="empty-state-text">You have no notifications</p>
            </div>
          ` : notifs.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" onclick="Notifications.markRead('${n.id}');${n.scrId ? `Router.navigate('scr-detail',{id:'${n.scrId}'})` : ''}" style="border-radius:var(--radius-md);margin-bottom:var(--space-1)">
              ${!n.read ? '<div class="notif-dot"></div>' : '<div style="width:8px"></div>'}
              <div style="flex:1">
                <div class="notif-text">${Utils.escapeHtml(n.message)}</div>
                <div class="notif-time">${Utils.formatTimeAgo(n.timestamp)} · ${Notifications.typeLabel(n.type)}</div>
              </div>
              ${n.scrId ? '<span class="text-xs text-brand">View →</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  typeLabel(type) {
    const map = { assignment: 'Assignment', status: 'Status Update', approval: 'Approval', sla: 'SLA Alert', new_scr: 'New SCR', feedback: 'Feedback' };
    return map[type] || type;
  },

  // ── Notify relevant users on events ─────────────────────
  notifySCRCreated(scr) {
    this.create('user_itc', `New SCR submitted: ${scr.scrNumber} from ${scr.department}`, 'new_scr', scr.id);
    this.create('user_ph', `New SCR submitted: ${scr.scrNumber} — ${scr.priority} priority`, 'new_scr', scr.id);
    this.updateBadge();
  },

  notifySCRAssigned(scr) {
    if (scr.assignedDeveloper) {
      this.create(scr.assignedDeveloper, `You have been assigned ${scr.scrNumber} (${scr.priority})`, 'assignment', scr.id);
    }
    this.updateBadge();
  },

  notifyStageChange(scr, stageName) {
    this.create('user_ph', `${scr.scrNumber} has reached ${stageName} stage`, 'status', scr.id);
    if (scr.assignedDeveloper) {
      this.create(scr.assignedDeveloper, `${scr.scrNumber} moved to ${stageName}`, 'status', scr.id);
    }
    this.updateBadge();
  },

  notifyApprovalNeeded(scr) {
    this.create('user_cio', `${scr.scrNumber} is awaiting your approval`, 'approval', scr.id);
    this.create('user_agm', `${scr.scrNumber} is awaiting approval`, 'approval', scr.id);
    this.updateBadge();
  }
};
