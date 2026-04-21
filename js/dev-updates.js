/* ============================================================
   SCR MANAGEMENT SYSTEM — Developer Progress Updates
   ──────────────────────────────────────────────────────────
   Stage 5 (Development): assigned developers post incremental
   task-level updates (e.g. "Frontend UI done", "API integrated").
   Timeline runs from Project Head's Schedule Date → Completed On.
   ============================================================ */

const DevUpdates = {

  // ── Create an update ────────────────────────────────────
  add(scrId, { title, description, status, percentComplete }) {
    const user = Auth.currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const scr = Store.getById('scr_requests', scrId);
    if (!scr) return { success: false, error: 'SCR not found' };

    // Gate: only the assigned developers (or admin) can post
    const isAssignedDev = (scr.assignedDeveloper === user.id || scr.assignedDeveloper2 === user.id);
    if (!isAssignedDev && user.role !== 'admin') {
      return { success: false, error: 'Only the assigned developer can post updates' };
    }

    // Gate: stage must be 5 (Development) or later until closure
    if (scr.currentStage < 5 || scr.status === 'Closed' || scr.status === 'Rejected') {
      return { success: false, error: 'Updates can only be posted during Development stage' };
    }

    // Validate
    if (!Utils.isNonEmpty(title)) return { success: false, error: 'Title is required' };
    if (!Utils.isNonEmpty(description)) return { success: false, error: 'Description is required' };
    const pct = Number(percentComplete);
    const pctValid = !isNaN(pct) && pct >= 0 && pct <= 100;

    const entry = Store.add('development_updates', {
      scrId,
      authorId: user.id,
      authorName: user.name,
      title: title.trim().slice(0, 120),
      description: description.trim().slice(0, 2000),
      status: status || 'In Progress',  // In Progress / Completed / Blocked
      percentComplete: pctValid ? Math.round(pct) : null,
      timestamp: Utils.nowISO()
    });

    Audit.log('SCR', scrId, 'Dev Update Posted', 'update', null, entry.title);

    // Notify project head + implementation team that dev has progressed
    const stakeholders = Store.filter('users', u =>
      u.role === 'project_head' || u.role === 'implementation'
    );
    stakeholders.forEach(u => {
      Notifications.create(
        u.id,
        `${scr.scrNumber} dev update: ${entry.title}`,
        'status',
        scrId
      );
    });

    return { success: true, update: entry };
  },

  // ── Fetch updates for an SCR ────────────────────────────
  getForSCR(scrId) {
    return Store.filter('development_updates', u => u.scrId === scrId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // ── Compute overall progress (most recent update's %) ──
  currentProgress(scrId) {
    const updates = this.getForSCR(scrId);
    const withPct = updates.filter(u => typeof u.percentComplete === 'number');
    if (withPct.length === 0) return null;
    return withPct[0].percentComplete;
  },

  // ── Render section inside SCR detail ────────────────────
  renderForSCR(scrId, scr) {
    // Only show section for SCRs that have reached Development stage
    if (!scr || scr.currentStage < 5) return '';

    const user = Auth.currentUser();
    // Requesters don't see internal development progress — it's
    // implementation-side detail. Their view shows only status + pipeline.
    if (user && user.role === 'requester') return '';

    const updates = this.getForSCR(scrId);
    const isAssignedDev = user && (scr.assignedDeveloper === user.id || scr.assignedDeveloper2 === user.id);
    const canPost = (isAssignedDev || (user && user.role === 'admin')) &&
                    scr.status !== 'Closed' && scr.status !== 'Rejected';

    // Timeline milestones (Project Head's plan)
    const schedDate = scr.scheduleDate;
    const completedDate = scr.completedOn;
    const assignedDate = scr.assignedOn;
    const overallPct = this.currentProgress(scrId);

    return `
      <div class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3)">
          <h3 class="card-title">🛠️ Development Updates</h3>
          ${canPost ? `<button class="btn btn-primary btn-sm" onclick="DevUpdates.showForm('${scrId}')">+ Add Update</button>` : ''}
        </div>
        <div class="card-body">

          <!-- Timeline strip -->
          <div class="dev-timeline" style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);margin-bottom:var(--space-5);padding:var(--space-4);background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg)">
            <div>
              <div class="detail-label">Assigned On</div>
              <div class="detail-value font-semi">${Utils.formatDate(assignedDate)}</div>
            </div>
            <div>
              <div class="detail-label">Schedule Date (Target)</div>
              <div class="detail-value font-semi">${Utils.formatDate(schedDate)}</div>
            </div>
            <div>
              <div class="detail-label">Completed On</div>
              <div class="detail-value font-semi">${completedDate ? Utils.formatDate(completedDate) : '<span class="text-muted">Pending</span>'}</div>
            </div>
          </div>

          ${overallPct !== null ? `
          <div style="margin-bottom:var(--space-4)">
            <div class="flex items-center justify-between mb-2">
              <span class="font-semi text-sm">Overall Progress</span>
              <span class="font-bold">${overallPct}%</span>
            </div>
            <div class="progress-bar" style="height:10px">
              <div class="progress-fill ${overallPct >= 100 ? 'success' : overallPct >= 60 ? '' : 'warning'}" style="width:${overallPct}%"></div>
            </div>
          </div>` : ''}

          ${updates.length === 0 ? `
            <div class="empty-state" style="padding:var(--space-6)">
              <div class="empty-state-icon" style="font-size:2rem">📝</div>
              <p class="empty-state-text">No development updates yet${canPost ? '. Click "+ Add Update" to log progress.' : '.'}</p>
            </div>
          ` : `
            <div class="dev-update-list" style="display:flex;flex-direction:column;gap:var(--space-3)">
              ${updates.map(u => this._renderItem(u, user)).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  },

  _renderItem(u, currentUser) {
    const statusColor = u.status === 'Completed' ? 'success' : u.status === 'Blocked' ? 'danger' : 'info';
    const canDelete = currentUser && (currentUser.id === u.authorId || currentUser.role === 'admin');
    return `
      <div style="padding:var(--space-4);background:#fff;border:1px solid var(--color-border);border-radius:var(--radius-lg)">
        <div class="flex items-center justify-between" style="gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
          <div class="flex items-center" style="gap:var(--space-2);flex-wrap:wrap">
            <span class="font-bold">${Utils.escapeHtml(u.title)}</span>
            ${Utils.badgeHtml(u.status, statusColor)}
            ${typeof u.percentComplete === 'number' ? `<span class="badge badge-neutral">${u.percentComplete}%</span>` : ''}
          </div>
          <div class="text-xs text-tertiary">${Utils.formatDateTime(u.timestamp)}</div>
        </div>
        <p class="text-sm text-secondary" style="line-height:1.6;white-space:pre-wrap;margin-bottom:var(--space-2)">${Utils.escapeHtml(u.description)}</p>
        <div class="flex items-center justify-between" style="gap:var(--space-2);flex-wrap:wrap">
          <span class="text-xs text-muted">— ${Utils.escapeHtml(u.authorName)}</span>
          ${canDelete ? `<button class="btn btn-ghost btn-sm" style="font-size:var(--font-xs)" onclick="DevUpdates.handleDelete('${u.id}', '${u.scrId}')">🗑️ Delete</button>` : ''}
        </div>
      </div>
    `;
  },

  // ── Modal: add new update ───────────────────────────────
  showForm(scrId) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dev-update-modal';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3 class="modal-title">🛠️ Add Development Update</h3>
          <button class="modal-close" onclick="document.getElementById('dev-update-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Task / Milestone Title <span class="required">*</span></label>
            <input type="text" class="form-input" id="du-title" placeholder="e.g. Frontend UI complete, API integration done" maxlength="120">
          </div>
          <div class="form-group">
            <label class="form-label">Details <span class="required">*</span></label>
            <textarea class="form-textarea" id="du-desc" rows="4" placeholder="What was completed today? Any blockers? Next steps?" maxlength="2000"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-select" id="du-status">
                <option value="In Progress" selected>In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Blocked">Blocked</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Overall Progress %</label>
              <input type="number" class="form-input" id="du-pct" min="0" max="100" step="5" placeholder="0-100">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('dev-update-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="DevUpdates.handleSubmit('${scrId}')">Post Update</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('du-title')?.focus(), 50);
  },

  handleSubmit(scrId) {
    const title = document.getElementById('du-title')?.value || '';
    const description = document.getElementById('du-desc')?.value || '';
    const status = document.getElementById('du-status')?.value || 'In Progress';
    const pctRaw = document.getElementById('du-pct')?.value;
    const percentComplete = pctRaw === '' ? null : Number(pctRaw);

    const result = this.add(scrId, { title, description, status, percentComplete });
    if (result.success) {
      Utils.toast('success', 'Update Posted', `"${result.update.title}" logged`);
      document.getElementById('dev-update-modal')?.remove();
      Router.navigate('scr-detail', { id: scrId });
    } else {
      Utils.toast('error', 'Error', result.error);
    }
  },

  // ── Delete an update (author or admin) ──────────────────
  async handleDelete(updateId, scrId) {
    const confirmed = await Utils.confirm('Delete Update?', 'Remove this development update permanently?', 'danger');
    if (!confirmed) return;

    const user = Auth.currentUser();
    const entry = Store.getById('development_updates', updateId);
    if (!entry) { Utils.toast('error', 'Not Found', 'Update no longer exists'); return; }
    if (entry.authorId !== user.id && user.role !== 'admin') {
      Utils.toast('error', 'Denied', 'You can only delete your own updates');
      return;
    }

    Store.remove('development_updates', updateId);
    Audit.log('SCR', scrId, 'Dev Update Deleted', 'update', entry.title, null);
    Utils.toast('success', 'Deleted', 'Update removed');
    Router.navigate('scr-detail', { id: scrId });
  }
};
