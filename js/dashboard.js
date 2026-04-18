/* ============================================================
   SCR MANAGEMENT SYSTEM — Dashboard & Analytics
   ============================================================ */

const Dashboard = {
  render() {
    const user = Auth.currentUser();
    const scrs = Store.getAll('scr_requests');
    const feedback = Store.getAll('feedback');

    // KPI calculations
    const total = scrs.length;
    const open = scrs.filter(s => s.status === 'Open').length;
    const inProgress = scrs.filter(s => s.status === 'In Progress').length;
    const completed = scrs.filter(s => s.status === 'Completed' || s.status === 'Closed').length;
    const slaSummary = SLAEngine.getSummary();
    const avgResolution = SLAEngine.avgResolutionTime();

    // Recent SCRs
    const recentSCRs = [...scrs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

    // Overdue
    const overdue = SLAEngine.getOverdue();

    // Department stats
    const deptStats = {};
    scrs.forEach(s => {
      deptStats[s.department] = (deptStats[s.department] || 0) + 1;
    });
    const topDepts = Object.entries(deptStats).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Developer workload
    const devs = Store.filter('users', u => u.role === 'developer');
    const devWorkload = devs.map(d => {
      const count = scrs.filter(s => s.assignedDeveloper === d.id && s.status !== 'Closed' && s.status !== 'Rejected').length;
      return { ...d, activeCount: count };
    }).sort((a, b) => b.activeCount - a.activeCount);

    // Avg feedback
    const avgFeedback = feedback.length > 0
      ? (feedback.reduce((s, f) => s + f.avgScore, 0) / feedback.length).toFixed(1)
      : '—';

    // Pre-computed status counts (used in donut legend)
    const statusCounts = {
      'Open': open,
      'In Progress': inProgress,
      'Completed': scrs.filter(s => s.status === 'Completed').length,
      'Closed': scrs.filter(s => s.status === 'Closed').length,
      'On Hold': scrs.filter(s => s.status === 'On Hold').length,
      'Rejected': scrs.filter(s => s.status === 'Rejected').length
    };

    const canViewReports = Auth.canAccessPage('reports');
    const canViewFeedback = Auth.canAccessPage('feedback');

    return `
      <!-- Welcome Banner (drilldown links on overdue + at-risk counts) -->
      <div class="welcome-banner">
        <h2 class="welcome-title">Welcome back, ${Utils.escapeHtml(user.name)} 👋</h2>
        <p class="welcome-text">Here's what's happening with your SCR system today. You have
          <strong style="cursor:pointer;text-decoration:underline dotted" title="View all overdue" onclick="SCRManager.drillTo({slaStatus:'breached'})">${slaSummary.breached} overdue</strong>
          and
          <strong style="cursor:pointer;text-decoration:underline dotted" title="View all at-risk" onclick="SCRManager.drillTo({slaStatus:'at-risk'})">${slaSummary.atRisk} at-risk</strong>
          requests.</p>
      </div>

      <!-- KPI Cards (every card drills into SCR list with appropriate filter) -->
      <div class="dashboard-kpis stagger-children">
        <div class="kpi-card primary" onclick="SCRManager.drillTo({})" style="cursor:pointer" title="View all SCRs">
          <div class="kpi-icon">📋</div>
          <div class="kpi-value">${total}</div>
          <div class="kpi-label">Total SCRs</div>
        </div>
        <div class="kpi-card success" onclick="SCRManager.drillTo({status:'Open'})" style="cursor:pointer" title="View Open SCRs">
          <div class="kpi-icon">📂</div>
          <div class="kpi-value">${open}</div>
          <div class="kpi-label">Open</div>
        </div>
        <div class="kpi-card info" onclick="SCRManager.drillTo({status:'In Progress'})" style="cursor:pointer" title="View In Progress SCRs">
          <div class="kpi-icon">⚙️</div>
          <div class="kpi-value">${inProgress}</div>
          <div class="kpi-label">In Progress</div>
        </div>
        <div class="kpi-card warning" onclick="SCRManager.drillTo({status:'Closed,Completed'})" style="cursor:pointer" title="View Completed / Closed SCRs">
          <div class="kpi-icon">✅</div>
          <div class="kpi-value">${completed}</div>
          <div class="kpi-label">Completed</div>
        </div>
        <div class="kpi-card danger" onclick="SCRManager.drillTo({slaStatus:'breached'})" style="cursor:pointer" title="View all overdue SCRs">
          <div class="kpi-icon">🔴</div>
          <div class="kpi-value">${slaSummary.breached}</div>
          <div class="kpi-label">Overdue</div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="dashboard-charts">
        <div class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">📊 SCR Status Distribution</h3>
            <button class="btn btn-ghost btn-sm" onclick="SCRManager.drillTo({})" title="View all">View All →</button>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-8);flex-wrap:wrap">
            <div class="chart-canvas-container" style="width:220px;height:220px;flex-shrink:0;position:relative">
              <canvas id="status-chart"></canvas>
              <div class="donut-center" style="cursor:pointer" onclick="SCRManager.drillTo({})" title="View all SCRs">
                <div class="donut-center-value">${total}</div>
                <div class="donut-center-label">Total</div>
              </div>
            </div>
            <div style="flex:1;min-width:180px">
              <!-- Every legend item drills into that specific status -->
              <div class="chart-legend" style="flex-direction:column;gap:var(--space-2)">
                ${[
                  ['Open',        '#10b981'],
                  ['In Progress', '#3b82f6'],
                  ['Completed',   '#8b5cf6'],
                  ['Closed',      '#64748b'],
                  ['On Hold',     '#f59e0b'],
                  ['Rejected',    '#ef4444']
                ].map(([label, color]) => `
                  <div class="legend-item dashboard-drill" style="cursor:pointer;padding:4px 8px;border-radius:6px;transition:background 0.15s" onclick="SCRManager.drillTo({status:'${label}'})" title="View ${label}">
                    <div class="legend-dot" style="background:${color}"></div>
                    <span>${label}</span>
                    <span class="font-semi" style="margin-left:auto">${statusCounts[label]}</span>
                  </div>
                `).join('')}
              </div>
              <div class="quick-stats mt-6" style="flex-wrap:wrap">
                <div class="quick-stat" ${canViewReports ? 'onclick="Router.navigate(\'reports\')" style="cursor:pointer" title="Open reports"' : ''}>
                  <div class="quick-stat-value">${avgResolution}h</div>
                  <div class="quick-stat-label">Avg Resolution</div>
                </div>
                <div class="quick-stat" ${canViewFeedback ? 'onclick="Router.navigate(\'feedback\')" style="cursor:pointer" title="Open feedback"' : ''}>
                  <div class="quick-stat-value">${avgFeedback}</div>
                  <div class="quick-stat-label">Avg Rating</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Department bars — each row drills into that department -->
        <div class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">🏢 By Department</h3>
          </div>
          <div id="dept-chart-container">
            ${topDepts.length === 0 ? '<p class="text-muted text-sm text-center p-4">No department data yet</p>' : topDepts.map(([dept, count]) => {
              const maxCount = topDepts[0][1] || 1;
              const pct = Math.round((count / maxCount) * 100);
              return `
                <div class="dashboard-drill" style="margin-bottom:var(--space-3);cursor:pointer;padding:6px 8px;border-radius:6px;transition:background 0.15s" onclick="SCRManager.drillTo({department:'${String(dept).replace(/'/g,'\\\'')}'})" title="View ${Utils.escapeHtml(dept)} SCRs">
                  <div class="flex justify-between mb-1">
                    <span class="text-sm text-secondary">${Utils.escapeHtml(Utils.truncate(dept, 18))}</span>
                    <span class="text-sm font-semi">${count}</span>
                  </div>
                  <div class="progress-bar" style="height:8px">
                    <div class="progress-fill" style="width:${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Bottom Row -->
      <div class="dashboard-bottom">
        <!-- Recent SCRs — each item already drills into detail -->
        <div class="chart-card">
          <div class="chart-header">
            <h3 class="chart-title">🕐 Recent Requests</h3>
            <button class="btn btn-ghost btn-sm" onclick="SCRManager.drillTo({})">View All →</button>
          </div>
          ${recentSCRs.length === 0 ? '<p class="text-muted text-sm text-center p-4">No SCRs yet</p>' : `
            <div>
              ${recentSCRs.map(scr => `
                <div class="activity-item" style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})" title="Open ${Utils.escapeHtml(scr.scrNumber)}">
                  <div class="activity-icon ${scr.status === 'Open' ? 'create' : scr.status === 'In Progress' ? 'update' : 'close'}">
                    ${scr.status === 'Open' ? '📂' : scr.status === 'In Progress' ? '⚙️' : '✅'}
                  </div>
                  <div class="activity-content">
                    <div class="activity-text">
                      <strong>${scr.scrNumber}</strong> — ${Utils.escapeHtml(Utils.truncate(scr.description, 40))}
                    </div>
                    <div class="activity-time">
                      <span onclick="event.stopPropagation();SCRManager.drillTo({department:'${String(scr.department).replace(/'/g,'\\\'')}'})" style="cursor:pointer;text-decoration:underline dotted" title="View dept">${Utils.escapeHtml(scr.department)}</span>
                      · ${Utils.formatTimeAgo(scr.createdAt)}
                      ${SLAEngine.renderIndicator(scr)}
                    </div>
                  </div>
                  <div onclick="event.stopPropagation();SCRManager.drillTo({priority:'${scr.priority}'})" title="View ${scr.priority} priority" style="cursor:pointer">
                    ${Utils.priorityBadge(scr.priority)}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <!-- Right Column: Dev Workload + Overdue -->
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">

          <!-- Developer Workload — each row drills into that developer's SCRs -->
          <div class="chart-card">
            <div class="chart-header">
              <h3 class="chart-title">👨‍💻 Developer Workload</h3>
            </div>
            ${devWorkload.length === 0 ? '<p class="text-muted text-sm text-center p-4">No developers</p>' : `
              ${devWorkload.map(d => `
                <div class="workload-item dashboard-drill" style="cursor:pointer;padding:6px 8px;border-radius:6px;transition:background 0.15s" onclick="SCRManager.drillTo({assignedDeveloper:'${d.id}'})" title="View SCRs assigned to ${Utils.escapeHtml(d.name)}">
                  <div class="workload-avatar">${Utils.getInitials(d.name)}</div>
                  <div class="workload-info">
                    <div class="workload-name">${Utils.escapeHtml(d.name)}</div>
                    <div class="workload-bar">
                      <div class="progress-bar" style="flex:1;height:6px">
                        <div class="progress-fill ${d.activeCount > 3 ? 'danger' : d.activeCount > 1 ? 'warning' : ''}"
                          style="width:${Math.min(100, d.activeCount * 20)}%"></div>
                      </div>
                      <span class="workload-count">${d.activeCount}</span>
                    </div>
                  </div>
                </div>
              `).join('')}
            `}
          </div>

          <!-- Overdue — header drills into full breach list; each item opens detail -->
          ${overdue.length > 0 ? `
            <div class="chart-card" style="border-color:rgba(239,68,68,0.3)">
              <div class="chart-header">
                <h3 class="chart-title" style="color:var(--color-danger-dark);cursor:pointer;text-decoration:underline dotted" onclick="SCRManager.drillTo({slaStatus:'breached'})" title="View all overdue">⚠️ Overdue (${overdue.length})</h3>
                <button class="btn btn-ghost btn-sm" onclick="SCRManager.drillTo({slaStatus:'breached'})">View All →</button>
              </div>
              ${overdue.slice(0, 4).map(scr => {
                const sla = SLAEngine.calculate(scr);
                return `
                  <div class="overdue-item" style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${scr.id}'})" title="Open ${Utils.escapeHtml(scr.scrNumber)}">
                    <div>
                      <div class="overdue-scr">${Utils.escapeHtml(scr.scrNumber)}</div>
                      <div class="overdue-dept">${Utils.escapeHtml(scr.department)}</div>
                    </div>
                    <div class="overdue-time">${Utils.escapeHtml(sla.label)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="chart-card">
              <div style="text-align:center;padding:var(--space-6)">
                <span style="font-size:2rem">✅</span>
                <p class="text-success font-semi mt-2">No Overdue SCRs</p>
                <p class="text-tertiary text-sm">All requests are within SLA</p>
              </div>
            </div>
          `}
        </div>
      </div>

      <!-- Drill-down hover affordance -->
      <style>
        .dashboard-drill:hover { background: rgba(61,95,184,0.08); }
      </style>
    `;
  },

  // ── Post render: draw charts ────────────────────────────
  postRender() {
    this.drawStatusDonut();
  },

  // ── Donut Chart (vanilla canvas) ────────────────────────
  drawStatusDonut() {
    const canvas = document.getElementById('status-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 220;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    const scrs = Store.getAll('scr_requests');
    const data = [
      { label: 'Open', value: scrs.filter(s => s.status === 'Open').length, color: '#10b981' },
      { label: 'In Progress', value: scrs.filter(s => s.status === 'In Progress').length, color: '#3b82f6' },
      { label: 'Completed', value: scrs.filter(s => s.status === 'Completed').length, color: '#8b5cf6' },
      { label: 'Closed', value: scrs.filter(s => s.status === 'Closed').length, color: '#64748b' },
      { label: 'On Hold', value: scrs.filter(s => s.status === 'On Hold').length, color: '#f59e0b' },
      { label: 'Rejected', value: scrs.filter(s => s.status === 'Rejected').length, color: '#ef4444' }
    ].filter(d => d.value > 0);

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return;

    const cx = size / 2;
    const cy = size / 2;
    const outerR = 100;
    const innerR = 65;

    // Animate
    let progress = 0;
    const animate = () => {
      progress = Math.min(1, progress + 0.03);
      ctx.clearRect(0, 0, size, size);
      
      let currentAngle = -Math.PI / 2;
      data.forEach(segment => {
        const sliceAngle = (segment.value / total) * 2 * Math.PI * progress;
        
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, currentAngle, currentAngle + sliceAngle);
        ctx.arc(cx, cy, innerR, currentAngle + sliceAngle, currentAngle, true);
        ctx.closePath();
        ctx.fillStyle = segment.color;
        ctx.fill();
        
        currentAngle += sliceAngle;
      });

      if (progress < 1) requestAnimationFrame(animate);
    };
    animate();
  }
};
