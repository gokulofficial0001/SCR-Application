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

  // ── Edit/delete window — within 24h of original post ───
  // After 24 hours the entry is locked (audit trail integrity)
  EDIT_WINDOW_MS: 24 * 60 * 60 * 1000,

  _canModify(entry) {
    if (!entry || !entry.timestamp) return false;
    const t = new Date(entry.timestamp).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < this.EDIT_WINDOW_MS;
  },

  _hoursLeftToEdit(entry) {
    if (!entry || !entry.timestamp) return 0;
    const elapsed = Date.now() - new Date(entry.timestamp).getTime();
    return Math.max(0, Math.ceil((this.EDIT_WINDOW_MS - elapsed) / (60 * 60 * 1000)));
  },

  // ── Edit an update (author or admin, within 24h) ───────
  edit(updateId, { title, description, status, percentComplete }) {
    const user = Auth.currentUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const entry = Store.getById('development_updates', updateId);
    if (!entry) return { success: false, error: 'Update not found' };

    // Author-or-admin gate
    if (entry.authorId !== user.id && user.role !== 'admin') {
      return { success: false, error: 'You can only edit your own updates' };
    }

    // 24-hour edit window — once locked, the record is frozen for audit integrity
    if (!this._canModify(entry)) {
      return {
        success: false,
        error: 'This update was posted more than 24 hours ago and can no longer be edited or deleted.'
      };
    }

    // Validation (same as add)
    if (!Utils.isNonEmpty(title))       return { success: false, error: 'Title is required' };
    if (!Utils.isNonEmpty(description)) return { success: false, error: 'Description is required' };

    const pct = Number(percentComplete);
    const pctValid = !isNaN(pct) && pct >= 0 && pct <= 100;

    const updated = Store.update('development_updates', updateId, {
      title:       title.trim().slice(0, 120),
      description: description.trim().slice(0, 2000),
      status:      status || 'In Progress',
      percentComplete: pctValid ? Math.round(pct) : null,
      edited:   true,
      editedAt: Utils.nowISO(),
      editedBy: user.id
    });

    Audit.log('SCR', entry.scrId, 'Dev Update Edited', 'update', entry.title, updated.title);

    return { success: true, update: updated };
  },

  // ── Aggregate updates into per-task buckets ─────────────
  // Each update belongs to a TASK (identified by its title). If a developer
  // posts multiple updates for the same task ("Frontend UI" → 30% then 60%
  // then 100%), only the most recent entry per task represents that task's
  // current state. Two updates with different titles count as two tasks.
  _tasksByTitle(scrId) {
    const updates = this.getForSCR(scrId); // newest first
    if (updates.length === 0) return [];
    const map = new Map();
    updates.forEach(u => {
      const key = (u.title || '').toLowerCase().trim();
      if (!key) return;
      // Since updates are sorted newest-first, the first hit per key is latest
      if (!map.has(key)) map.set(key, u);
    });
    return [...map.values()];
  },

  // ── Effective % for one task (100 if Completed, else its percent) ──
  _taskPercent(t) {
    if (!t) return 0;
    if (t.status === 'Completed') return 100;
    if (typeof t.percentComplete === 'number') {
      return Math.max(0, Math.min(100, t.percentComplete));
    }
    return 0;
  },

  // ── Overall progress = average of latest % across ALL tasks ───
  // One task at 100% with two tasks remaining at 0% → overall = 33%
  // Three tasks: 100, 50, 0 → overall = 50%
  // Tasks "Blocked" still contribute their percentComplete (or 0)
  currentProgress(scrId) {
    const tasks = this._tasksByTitle(scrId);
    if (tasks.length === 0) return null;
    const sum = tasks.reduce((s, t) => s + this._taskPercent(t), 0);
    return Math.round(sum / tasks.length);
  },

  // ── Tasks summary for UI ("3 of 5 tasks done") ──────────
  taskSummary(scrId) {
    const tasks = this._tasksByTitle(scrId);
    if (tasks.length === 0) return null;
    const done = tasks.filter(t => t.status === 'Completed' || this._taskPercent(t) >= 100).length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    return { total: tasks.length, done, blocked, inProgress: tasks.length - done - blocked };
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

          ${overallPct !== null ? (() => {
            const summary = this.taskSummary(scrId);
            const summaryText = summary ?
              `${summary.done} of ${summary.total} task${summary.total === 1 ? '' : 's'} complete${summary.blocked > 0 ? ` · ${summary.blocked} blocked` : ''}`
              : '';
            return `
            <div style="margin-bottom:var(--space-4)">
              <div class="flex items-center justify-between mb-1">
                <span class="font-semi text-sm">Overall Progress</span>
                <span class="font-bold">${overallPct}%</span>
              </div>
              <div class="progress-bar" style="height:10px">
                <div class="progress-fill ${overallPct >= 100 ? 'success' : overallPct >= 60 ? '' : 'warning'}" style="width:${overallPct}%"></div>
              </div>
              ${summaryText ? `<div class="text-xs text-tertiary" style="margin-top:6px">${summaryText} · averaged across all tasks</div>` : ''}
            </div>`;
          })() : ''}

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
    const isOwner = currentUser && (currentUser.id === u.authorId || currentUser.role === 'admin');
    const canModify = isOwner && this._canModify(u);
    const hoursLeft = canModify ? this._hoursLeftToEdit(u) : 0;

    // Action area:
    //  • within 24h → Edit + Delete buttons + countdown hint
    //  • after 24h  → 🔒 Locked indicator (visible only to the author/admin)
    let actions = '';
    if (canModify) {
      actions = `
        <div class="flex items-center" style="gap:var(--space-2)">
          <span class="text-xs text-muted" title="Edit window remaining">⏱ ${hoursLeft}h to edit/delete</span>
          <button class="btn btn-ghost btn-sm" style="font-size:var(--font-xs)" onclick="DevUpdates.showEditForm('${u.id}')">✏️ Edit</button>
          <button class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);color:var(--color-danger-dark)" onclick="DevUpdates.handleDelete('${u.id}', '${u.scrId}')">🗑️ Delete</button>
        </div>
      `;
    } else if (isOwner) {
      actions = `
        <span class="text-xs text-muted" title="Edits are only allowed within 24 hours of posting" style="display:inline-flex;align-items:center;gap:4px">
          🔒 Locked
        </span>
      `;
    }

    const editedBadge = u.edited
      ? `<span class="text-xs text-tertiary" title="Edited on ${Utils.formatDateTime(u.editedAt || '')}" style="font-style:italic">· edited</span>`
      : '';

    return `
      <div style="padding:var(--space-4);background:#fff;border:1px solid var(--color-border);border-radius:var(--radius-lg)">
        <div class="flex items-center justify-between" style="gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
          <div class="flex items-center" style="gap:var(--space-2);flex-wrap:wrap">
            <span class="font-bold">${Utils.escapeHtml(u.title)}</span>
            ${Utils.badgeHtml(u.status, statusColor)}
            ${typeof u.percentComplete === 'number' ? `<span class="badge badge-neutral">${u.percentComplete}%</span>` : ''}
          </div>
          <div class="text-xs text-tertiary">
            ${Utils.formatDateTime(u.timestamp)}
            ${editedBadge}
          </div>
        </div>
        <p class="text-sm text-secondary" style="line-height:1.6;white-space:pre-wrap;margin-bottom:var(--space-2)">${Utils.escapeHtml(u.description)}</p>
        <div class="flex items-center justify-between" style="gap:var(--space-2);flex-wrap:wrap">
          <span class="text-xs text-muted">— ${Utils.escapeHtml(u.authorName)}</span>
          ${actions}
        </div>
      </div>
    `;
  },

  // ── Modal: add new update ───────────────────────────────
  showForm(scrId) {
    this._renderModal({ scrId, mode: 'create' });
  },

  // ── Modal: edit existing update ─────────────────────────
  showEditForm(updateId) {
    const entry = Store.getById('development_updates', updateId);
    if (!entry) { Utils.toast('error', 'Not Found', 'Update no longer exists'); return; }

    const user = Auth.currentUser();
    if (!user) { Utils.toast('error', 'Not authenticated', ''); return; }

    if (entry.authorId !== user.id && user.role !== 'admin') {
      Utils.toast('error', 'Denied', 'You can only edit your own updates');
      return;
    }

    if (!this._canModify(entry)) {
      Utils.toast('error', 'Locked',
        'This update was posted more than 24 hours ago and can no longer be edited.');
      return;
    }

    this._renderModal({ mode: 'edit', entry });
  },

  // ── Shared modal renderer (create + edit) ───────────────
  _renderModal({ scrId, mode = 'create', entry = null }) {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());

    const isEdit = mode === 'edit';
    const titleVal = isEdit ? Utils.escapeHtml(entry.title) : '';
    const descVal  = isEdit ? Utils.escapeHtml(entry.description) : '';
    const statusVal = isEdit ? entry.status : 'In Progress';
    const pctVal   = isEdit && typeof entry.percentComplete === 'number' ? entry.percentComplete : '';

    const headerLabel = isEdit ? '✏️ Edit Development Update' : '🛠️ Add Development Update';
    const submitLabel = isEdit ? 'Save Changes'              : 'Post Update';
    const submitCall  = isEdit
      ? `DevUpdates.handleEditSubmit('${entry.id}')`
      : `DevUpdates.handleSubmit('${scrId}')`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dev-update-modal';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3 class="modal-title">${headerLabel}</h3>
          <button class="modal-close" onclick="document.getElementById('dev-update-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          ${isEdit ? `
            <div style="padding:var(--space-3);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,.25);border-radius:var(--radius-md);margin-bottom:var(--space-4)">
              <p class="text-xs" style="margin:0;color:var(--color-warning-dark)">
                ⏱ Edits are allowed within <strong>24 hours</strong> of original post.
                You have <strong>${this._hoursLeftToEdit(entry)}h</strong> remaining.
              </p>
            </div>
          ` : ''}
          <div class="form-group">
            <label class="form-label">Task / Milestone Title <span class="required">*</span></label>
            <input type="text" class="form-input" id="du-title" placeholder="e.g. Frontend UI complete, API integration done" maxlength="120" value="${titleVal}">
          </div>
          <div class="form-group">
            <label class="form-label">Details <span class="required">*</span></label>
            <textarea class="form-textarea" id="du-desc" rows="4" placeholder="What was completed today? Any blockers? Next steps?" maxlength="2000">${descVal}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-select" id="du-status">
                <option value="In Progress" ${statusVal === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Completed"   ${statusVal === 'Completed' ? 'selected' : ''}>Completed</option>
                <option value="Blocked"     ${statusVal === 'Blocked' ? 'selected' : ''}>Blocked</option>
              </select>
              <span class="form-hint">"Completed" auto-counts this task as 100%</span>
            </div>
            <div class="form-group">
              <label class="form-label">This Task's Progress %</label>
              <input type="number" class="form-input" id="du-pct" min="0" max="100" step="5" placeholder="0-100" value="${pctVal}">
              <span class="form-hint">Percentage for THIS task only — overall progress is averaged across all tasks</span>
            </div>
          </div>
          <div style="padding:var(--space-3);background:rgba(61,95,184,0.06);border:1px solid rgba(61,95,184,.18);border-radius:var(--radius-md);margin-top:var(--space-3)">
            <p class="text-xs" style="margin:0;color:var(--color-text-secondary);line-height:1.5">
              💡 <strong>Tip:</strong> Use the same Title to update an existing task
              (e.g. "Frontend UI" posted at 30% → later 60% → 100%) — only the
              most recent entry per task is counted. Different titles create
              new tasks.
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('dev-update-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="${submitCall}">${submitLabel}</button>
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

  handleEditSubmit(updateId) {
    const title = document.getElementById('du-title')?.value || '';
    const description = document.getElementById('du-desc')?.value || '';
    const status = document.getElementById('du-status')?.value || 'In Progress';
    const pctRaw = document.getElementById('du-pct')?.value;
    const percentComplete = pctRaw === '' ? null : Number(pctRaw);

    const result = this.edit(updateId, { title, description, status, percentComplete });
    if (result.success) {
      Utils.toast('success', 'Update Saved', `"${result.update.title}" updated`);
      document.getElementById('dev-update-modal')?.remove();
      Router.navigate('scr-detail', { id: result.update.scrId });
    } else {
      Utils.toast('error', 'Error', result.error);
    }
  },

  // ── Delete an update (author or admin, within 24h) ─────
  async handleDelete(updateId, scrId) {
    const user = Auth.currentUser();
    if (!user) { Utils.toast('error', 'Not authenticated', ''); return; }

    const entry = Store.getById('development_updates', updateId);
    if (!entry) { Utils.toast('error', 'Not Found', 'Update no longer exists'); return; }

    if (entry.authorId !== user.id && user.role !== 'admin') {
      Utils.toast('error', 'Denied', 'You can only delete your own updates');
      return;
    }

    // 24-hour delete window — same rule as edit. Once locked, frozen for audit.
    if (!this._canModify(entry)) {
      Utils.toast('error', 'Locked',
        'This update was posted more than 24 hours ago and can no longer be deleted.');
      return;
    }

    const confirmed = await Utils.confirm('Delete Update?',
      'Remove this development update permanently? This action cannot be undone.', 'danger');
    if (!confirmed) return;

    Store.remove('development_updates', updateId);
    Audit.log('SCR', scrId, 'Dev Update Deleted', 'update', entry.title, null);
    Utils.toast('success', 'Deleted', 'Update removed');
    Router.navigate('scr-detail', { id: scrId });
  }
};
