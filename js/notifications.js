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
          <button class="btn btn-ghost btn-sm" id="notif-panel-mark-all">Mark all read</button>
          <button class="btn btn-ghost btn-sm" id="notif-panel-close">✕</button>
        </div>
      </div>
      <div class="notif-panel-body">
        ${notifs.length === 0 ? `
          <div class="empty-state" style="padding:var(--space-8) var(--space-4)">
            <div class="empty-state-icon">🔔</div>
            <p class="empty-state-text">No notifications yet</p>
          </div>
        ` : notifs.map(n => `
          <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${Utils.escapeHtml(n.id)}" data-scr-id="${Utils.escapeHtml(n.scrId || '')}" style="cursor:pointer">
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
          <button class="btn btn-ghost btn-sm" id="notif-panel-view-all">View All</button>
        </div>
      ` : ''}
    `;

    // Delegated click handler for notification items (safe — values read from dataset, not HTML)
    panel.addEventListener('click', function handlePanelClick(e) {
      // Mark-all button
      if (e.target.closest('#notif-panel-mark-all')) {
        Notifications.markAllRead();
        Notifications.renderPanel();
        return;
      }
      // Close button
      if (e.target.closest('#notif-panel-close')) {
        Notifications.togglePanel();
        return;
      }
      // View-all button
      if (e.target.closest('#notif-panel-view-all')) {
        Notifications.togglePanel();
        Router.navigate('notifications');
        return;
      }
      // Individual notification item
      const item = e.target.closest('[data-notif-id]');
      if (!item) return;
      const id = item.dataset.notifId;
      const scrId = item.dataset.scrId;
      Notifications.handleClick(id, scrId);
    });
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

    const html = `
      <div class="page-header">
        <div class="page-header-left">
          <div class="flex items-center gap-3">
            ${Router.renderBackButton()}
            <h2 class="page-title">Notifications</h2>
          </div>
          <p class="page-description">All your notifications in one place</p>
        </div>
        <button class="btn btn-ghost" id="notif-page-mark-all">
          ✓ Mark All Read
        </button>
      </div>

      <div class="card">
        <div class="card-body" id="notif-page-list">
          ${notifs.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">🔔</div>
              <h3 class="empty-state-title">All caught up!</h3>
              <p class="empty-state-text">You have no notifications</p>
            </div>
          ` : notifs.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-notif-id="${Utils.escapeHtml(n.id)}" data-scr-id="${Utils.escapeHtml(n.scrId || '')}" style="border-radius:var(--radius-md);margin-bottom:var(--space-1);cursor:pointer">
              ${!n.read ? '<div class="notif-dot"></div>' : '<div style="width:8px"></div>'}
              <div style="flex:1">
                <div class="notif-text">${Utils.escapeHtml(n.message)}</div>
                <div class="notif-time">${Utils.formatTimeAgo(n.timestamp)} · ${Utils.escapeHtml(Notifications.typeLabel(n.type))}</div>
              </div>
              ${n.scrId ? '<span class="text-xs text-brand">View →</span>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Attach delegated listeners after the caller inserts the returned HTML into the DOM.
    // Use a one-time rAF so the elements are present when we query them.
    requestAnimationFrame(function attachNotifPageHandlers() {
      const markAllBtn = document.getElementById('notif-page-mark-all');
      if (markAllBtn) {
        markAllBtn.addEventListener('click', function() {
          Notifications.markAllRead();
          Router.navigate('notifications');
        });
      }

      const list = document.getElementById('notif-page-list');
      if (list) {
        list.addEventListener('click', function handlePageClick(e) {
          const item = e.target.closest('[data-notif-id]');
          if (!item) return;
          const id = item.dataset.notifId;
          const scrId = item.dataset.scrId;
          Notifications.markRead(id);
          if (scrId) {
            Router.navigate('scr-detail', { id: scrId });
          }
        });
      }
    });

    return html;
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
    // Notify BOTH assigned developers when reaching stage 5 (Development).
    // Same message they previously got at assignment time, so it surfaces
    // as an actionable item in their notification list.
    if (toStage === 5) {
      const msg = `${scr.scrNumber} has been approved by management — ready for development`;
      if (scr.assignedDeveloper)  this.create(scr.assignedDeveloper,  msg, 'assignment', scr.id);
      if (scr.assignedDeveloper2) this.create(scr.assignedDeveloper2, msg, 'assignment', scr.id);
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
