/* ============================================================
   SCR MANAGEMENT SYSTEM — Notification System
   ============================================================ */

const Notifications = {
  // ── Create notification (with duplicate dedup within last 60s) ──
  create(userId, message, type, scrId) {
    if (!userId || !message) return null;
    // Dedup: if same user/type/scrId message was created <60s ago and is still unread, skip
    const cutoff = Date.now() - 60 * 1000;
    const dupe = Store.filter('notifications', n =>
      n.userId === userId &&
      n.type === type &&
      n.scrId === (scrId || null) &&
      n.message === message &&
      !n.read &&
      new Date(n.timestamp).getTime() >= cutoff
    );
    if (dupe.length > 0) return dupe[0];

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
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">Notifications</h2>
          </div>
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
    // Notify all implementation team members of new submission
    const implUsers = Store.filter('users', u => u.role === 'implementation');
    implUsers.forEach(u => this.create(u.id, `New SCR submitted: ${scr.scrNumber} from ${scr.department} — awaiting your review`, 'new_scr', scr.id));
    this.updateBadge();
  },

  notifySCRAssigned(scr) {
    if (scr.assignedDeveloper) {
      this.create(scr.assignedDeveloper, `You have been assigned to ${scr.scrNumber} (${scr.priority || scr.intervention})`, 'assignment', scr.id);
    }
    if (scr.assignedDeveloper2) {
      this.create(scr.assignedDeveloper2, `You have been assigned to ${scr.scrNumber} (${scr.priority || scr.intervention})`, 'assignment', scr.id);
    }
    this.updateBadge();
  },

  notifyStageChange(scr, _fromStage, toStage) {
    const stageName = Utils.getStageName(toStage);
    // Notify project head when reaching stage 3
    if (toStage === 3) {
      const phUsers = Store.filter('users', u => u.role === 'project_head');
      phUsers.forEach(u => this.create(u.id, `${scr.scrNumber} is ready for your review — ${stageName}`, 'status', scr.id));
    }
    // Notify management when reaching stage 4
    if (toStage === 4) {
      const mgtUsers = Store.filter('users', u => u.role === 'agm_it' || u.role === 'cio');
      mgtUsers.forEach(u => this.create(u.id, `${scr.scrNumber} requires your approval — ${stageName}`, 'approval', scr.id));
    }
    // Notify developer when reaching stage 5
    if (toStage === 5) {
      if (scr.assignedDeveloper) this.create(scr.assignedDeveloper, `${scr.scrNumber} approved — ready for development`, 'assignment', scr.id);
      if (scr.assignedDeveloper2) this.create(scr.assignedDeveloper2, `${scr.scrNumber} approved — ready for development`, 'assignment', scr.id);
    }
    // Notify implementation team when reaching stage 6 (QA)
    if (toStage === 6) {
      const implUsers = Store.filter('users', u => u.role === 'implementation');
      implUsers.forEach(u => this.create(u.id, `${scr.scrNumber} development complete — awaiting QA review`, 'status', scr.id));
    }
    this.updateBadge();
  },

  notifyRejection(scr, fromStage, toStage, remarks) {
    const fromName = Utils.getStageName(fromStage);
    // Always notify implementation team on rejection back to stage 2
    if (toStage === 2) {
      const implUsers = Store.filter('users', u => u.role === 'implementation');
      implUsers.forEach(u => this.create(u.id, `${scr.scrNumber} returned from ${fromName}: "${remarks}"`, 'status', scr.id));
    }
    // Notify developer on rejection back to stage 5
    if (toStage === 5) {
      if (scr.assignedDeveloper) this.create(scr.assignedDeveloper, `${scr.scrNumber} QA failed — please rework: "${remarks}"`, 'status', scr.id);
      if (scr.assignedDeveloper2) this.create(scr.assignedDeveloper2, `${scr.scrNumber} QA failed — please rework: "${remarks}"`, 'status', scr.id);
    }
    this.updateBadge();
  },

  notifyApprovalNeeded(scr) {
    const mgtUsers = Store.filter('users', u => u.role === 'agm_it' || u.role === 'cio');
    mgtUsers.forEach(u => this.create(u.id, `${scr.scrNumber} is awaiting your management approval`, 'approval', scr.id));
    this.updateBadge();
  }
};
