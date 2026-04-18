/* ============================================================
   SCR MANAGEMENT SYSTEM — SLA & Escalation Engine
   ============================================================ */

const SLAEngine = {
  // ── Get SLA config for priority ─────────────────────────
  getMaxHours(priority) {
    const config = Store.getAll('sla_config');
    const entry = config.find(c => c.priority === priority);
    const raw = entry ? entry.maxHours : 168;
    const num = Number(raw);
    // Guard against invalid / zero / negative config (division-by-zero, always-overdue)
    return (isNaN(num) || num <= 0) ? 168 : num;
  },

  // ── Calculate SLA status for an SCR ─────────────────────
  calculate(scr) {
    if (!scr) {
      return { status: 'unknown', label: '—', percent: 0, color: 'neutral', remaining: 0 };
    }
    if (scr.status === 'Closed' || scr.status === 'Rejected') {
      return { status: 'closed', label: 'Closed', percent: 100, color: 'neutral', remaining: 0 };
    }
    if (scr.status === 'Completed') {
      return { status: 'completed', label: 'Completed', percent: 100, color: 'success', remaining: 0 };
    }

    // Guard against missing/invalid createdAt (otherwise new Date(null) → 1970)
    if (!Utils.isValidDate(scr.createdAt)) {
      return { status: 'unknown', label: 'Pending', percent: 0, color: 'neutral', remaining: 0 };
    }

    const maxHours = this.getMaxHours(scr.priority);
    const elapsed = Utils.hoursBetween(scr.createdAt, null);
    const remaining = maxHours - elapsed;
    const percent = Math.min(100, Math.round((elapsed / maxHours) * 100));

    if (remaining <= 0) {
      return { status: 'breached', label: `Overdue by ${Math.abs(remaining)}h`, percent: 100, color: 'danger', remaining };
    }
    if (percent >= 75) {
      return { status: 'at-risk', label: `${remaining}h remaining`, percent, color: 'warning', remaining };
    }
    return { status: 'on-track', label: `${remaining}h remaining`, percent, color: 'success', remaining };
  },

  // ── Get all overdue SCRs ────────────────────────────────
  getOverdue() {
    const scrs = Store.getAll('scr_requests');
    return scrs.filter(scr => {
      const sla = this.calculate(scr);
      return sla.status === 'breached';
    });
  },

  // ── Get at-risk SCRs ────────────────────────────────────
  getAtRisk() {
    const scrs = Store.getAll('scr_requests');
    return scrs.filter(scr => {
      const sla = this.calculate(scr);
      return sla.status === 'at-risk';
    });
  },

  // ── Render SLA indicator badge ──────────────────────────
  renderIndicator(scr) {
    const sla = this.calculate(scr);
    if (sla.status === 'closed' || sla.status === 'completed') return '';

    const icons = { 'on-track': '✓', 'at-risk': '⚠', 'breached': '🔴' };
    return `<span class="sla-indicator ${sla.status}">${icons[sla.status] || ''} ${sla.label}</span>`;
  },

  // ── Render SLA progress bar ─────────────────────────────
  renderProgressBar(scr) {
    const sla = this.calculate(scr);
    if (sla.status === 'closed' || sla.status === 'completed') return '';

    return `
      <div style="margin-top:var(--space-2)">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-tertiary">SLA Progress</span>
          <span class="text-xs font-semi" style="color:var(--color-${sla.color})">${sla.label}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${sla.color}" style="width:${sla.percent}%"></div>
        </div>
      </div>
    `;
  },

  // ── Check and generate notifications for overdue ────────
  checkAndNotify() {
    const overdue = this.getOverdue();
    overdue.forEach(scr => {
      // Check if notification already sent
      const existing = Store.filter('notifications', n => n.scrId === scr.id && n.type === 'sla');
      if (existing.length === 0) {
        // Notify all implementation team members and project head
        const implUsers = Store.filter('users', u => u.role === 'implementation');
        implUsers.forEach(u => Notifications.create(u.id, `SLA breach: ${scr.scrNumber} is overdue`, 'sla', scr.id));
        const phUsers = Store.filter('users', u => u.role === 'project_head');
        phUsers.forEach(u => Notifications.create(u.id, `SLA breach: ${scr.scrNumber} requires escalation`, 'sla', scr.id));
      }
    });
  },

  // ── Get SLA summary stats ───────────────────────────────
  getSummary() {
    const scrs = Store.getAll('scr_requests');
    const active = scrs.filter(s => !['Closed', 'Rejected'].includes(s.status));

    let onTrack = 0, atRisk = 0, breached = 0;
    active.forEach(scr => {
      const sla = this.calculate(scr);
      if (sla.status === 'on-track') onTrack++;
      else if (sla.status === 'at-risk') atRisk++;
      else if (sla.status === 'breached') breached++;
    });

    return { onTrack, atRisk, breached, total: active.length };
  },

  // ── Average resolution time (hours) ─────────────────────
  avgResolutionTime() {
    const closed = Store.filter('scr_requests', s => s.status === 'Closed' && s.completionDate);
    if (closed.length === 0) return 0;
    const total = closed.reduce((sum, scr) => sum + Utils.hoursBetween(scr.createdAt, scr.completionDate), 0);
    return Math.round(total / closed.length);
  }
};
