/* ============================================================
   SCR MANAGEMENT SYSTEM — Feedback System
   ============================================================ */

const Feedback = {
  // ── Questions ───────────────────────────────────────────
  questions: [
    { id: 'q1', text: 'Overall satisfaction with the solution' },
    { id: 'q2', text: 'Timeliness of delivery' },
    { id: 'q3', text: 'Quality of implementation' },
    { id: 'q4', text: 'Communication quality during development' },
    { id: 'q5', text: 'Would you recommend this team?' }
  ],

  // ── Get feedback for SCR ────────────────────────────────
  getForSCR(scrId) {
    return Store.filter('feedback', f => f.scrId === scrId);
  },

  // ── Submit feedback ─────────────────────────────────────
  submitFeedback(scrId, ratings, comments) {
    const user = Auth.currentUser();
    const avg = Object.values(ratings).reduce((s, v) => s + v, 0) / Object.values(ratings).length;

    const fb = Store.add('feedback', {
      scrId,
      q1: ratings.q1,
      q2: ratings.q2,
      q3: ratings.q3,
      q4: ratings.q4,
      q5: ratings.q5,
      avgScore: Math.round(avg * 10) / 10,
      comments: comments || '',
      submittedBy: user.id,
      timestamp: Utils.nowISO()
    });

    Audit.log('SCR', scrId, 'Feedback Submitted', 'avgScore', null, avg.toFixed(1));

    // Notify developer
    const scr = Store.getById('scr_requests', scrId);
    if (scr && scr.assignedDeveloper) {
      Notifications.create(scr.assignedDeveloper, `Feedback received for ${scr.scrNumber}: ${avg.toFixed(1)}/5`, 'feedback', scrId);
    }

    return { success: true, feedback: fb };
  },

  // ── Show feedback form modal ────────────────────────────
  showForm(scrId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'feedback-modal';
    overlay.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3 class="modal-title">📝 Submit Feedback</h3>
          <button class="modal-close" onclick="document.getElementById('feedback-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-secondary mb-6">Rate your experience with this SCR (1-5 stars)</p>

          ${this.questions.map(q => `
            <div class="form-group" style="padding:var(--space-3);background:var(--color-bg-base);border-radius:var(--radius-md);margin-bottom:var(--space-3)">
              <label class="form-label mb-2">${q.text}</label>
              <div class="star-rating" id="rating-${q.id}">
                ${[1,2,3,4,5].map(n => `
                  <span class="star" data-value="${n}" data-question="${q.id}" onclick="Feedback.setRating('${q.id}', ${n})">★</span>
                `).join('')}
                <span class="text-sm text-tertiary ml-auto" id="rating-value-${q.id}">Not rated</span>
              </div>
            </div>
          `).join('')}

          <div class="form-group mt-4">
            <label class="form-label">Additional Comments</label>
            <textarea class="form-textarea" id="feedback-comments" rows="3" placeholder="Any suggestions for improvement..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('feedback-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="Feedback.handleSubmit('${scrId}')">Submit Feedback</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  },

  // ── Star rating handler ─────────────────────────────────
  _ratings: {},

  setRating(questionId, value) {
    this._ratings[questionId] = value;
    const container = document.getElementById(`rating-${questionId}`);
    if (container) {
      container.querySelectorAll('.star').forEach(star => {
        const v = parseInt(star.dataset.value);
        star.classList.toggle('active', v <= value);
      });
    }
    const label = document.getElementById(`rating-value-${questionId}`);
    if (label) {
      const labels = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
      label.textContent = `${value}/5 — ${labels[value]}`;
    }
  },

  // ── Handle submit ───────────────────────────────────────
  handleSubmit(scrId) {
    const ratings = this._ratings;
    const allRated = this.questions.every(q => ratings[q.id]);

    if (!allRated) {
      Utils.toast('warning', 'Incomplete', 'Please rate all questions');
      return;
    }

    const comments = document.getElementById('feedback-comments')?.value || '';
    const result = this.submitFeedback(scrId, ratings, comments);

    if (result.success) {
      Utils.toast('success', 'Thank You!', `Feedback submitted with avg score ${result.feedback.avgScore}/5`);
      document.getElementById('feedback-modal')?.remove();
      this._ratings = {};
      Router.navigate('scr-detail', { id: scrId });
    }
  },

  // ── Render feedback for SCR detail ──────────────────────
  renderForSCR(scrId) {
    const feedbacks = this.getForSCR(scrId);
    if (feedbacks.length === 0) return '<p class="text-muted text-sm">No feedback yet</p>';

    return feedbacks.map(fb => {
      const user = Store.getById('users', fb.submittedBy);
      const scoreClass = fb.avgScore >= 4 ? 'excellent' : fb.avgScore >= 3 ? 'good' : fb.avgScore >= 2 ? 'average' : 'poor';

      return `
        <div style="text-align:center;margin-bottom:var(--space-4)">
          <div class="feedback-score-circle ${scoreClass}">${fb.avgScore}</div>
          <p class="text-sm text-secondary">Average Score</p>
        </div>
        <div class="detail-grid" style="gap:var(--space-3)">
          ${this.questions.map(q => `
            <div class="flex items-center justify-between" style="padding:var(--space-2) var(--space-3);background:var(--color-bg-base);border-radius:var(--radius-md)">
              <span class="text-sm text-secondary">${q.text}</span>
              <span class="font-semi" style="color:var(--color-warning)">${'★'.repeat(fb[q.id])}${'☆'.repeat(5 - fb[q.id])}</span>
            </div>
          `).join('')}
        </div>
        ${fb.comments ? `
          <div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--color-bg-base);border-radius:var(--radius-md)">
            <p class="text-xs text-muted mb-1">Comments</p>
            <p class="text-sm text-secondary">"${Utils.escapeHtml(fb.comments)}"</p>
          </div>
        ` : ''}
        <p class="text-xs text-muted mt-2">Submitted by ${user ? user.name : 'Unknown'} · ${Utils.formatDate(fb.timestamp)}</p>
      `;
    }).join('<hr style="border-color:var(--color-border);margin:var(--space-4) 0">');
  },

  // ── Render feedback list page ───────────────────────────
  renderList() {
    const allFeedback = Store.getAll('feedback').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const scrRequests = Store.getAll('scr_requests');

    // Stats
    const totalFeedbacks = allFeedback.length;
    const avgOverall = totalFeedbacks > 0 ? (allFeedback.reduce((s, f) => s + f.avgScore, 0) / totalFeedbacks).toFixed(1) : '—';

    // SCRs needing feedback (closed without feedback)
    const needFeedback = scrRequests.filter(s => 
      (s.status === 'Closed' || s.status === 'Completed') && 
      !allFeedback.find(f => f.scrId === s.id)
    );

    return `
      <div class="page-header">
        <div class="page-header-left">
          <h2 class="page-title">Feedback</h2>
          <p class="page-description">User satisfaction ratings and improvement tracking</p>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid-3 gap-4 mb-6">
        <div class="kpi-card success">
          <div class="kpi-icon">⭐</div>
          <div class="kpi-value">${avgOverall}</div>
          <div class="kpi-label">Average Rating</div>
        </div>
        <div class="kpi-card primary">
          <div class="kpi-icon">📊</div>
          <div class="kpi-value">${totalFeedbacks}</div>
          <div class="kpi-label">Total Feedbacks</div>
        </div>
        <div class="kpi-card warning">
          <div class="kpi-icon">📝</div>
          <div class="kpi-value">${needFeedback.length}</div>
          <div class="kpi-label">Awaiting Feedback</div>
        </div>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="Feedback.switchTab('received', this)">Received (${totalFeedbacks})</button>
        <button class="tab" onclick="Feedback.switchTab('pending', this)">Pending (${needFeedback.length})</button>
      </div>

      <div id="feedback-tab-received">
        ${allFeedback.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">⭐</div>
            <h3 class="empty-state-title">No Feedback Yet</h3>
            <p class="empty-state-text">Feedback will appear here once submitted</p>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>SCR #</th>
                  <th>Department</th>
                  <th>Overall</th>
                  <th>Timeliness</th>
                  <th>Quality</th>
                  <th>Communication</th>
                  <th>Recommend</th>
                  <th>Avg</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${allFeedback.map(fb => {
                  const scr = Store.getById('scr_requests', fb.scrId);
                  const scoreColor = fb.avgScore >= 4 ? 'success' : fb.avgScore >= 3 ? 'primary' : fb.avgScore >= 2 ? 'warning' : 'danger';
                  return `
                    <tr style="cursor:pointer" onclick="Router.navigate('scr-detail',{id:'${fb.scrId}'})">
                      <td class="font-semi text-brand">${scr ? scr.scrNumber : '—'}</td>
                      <td class="text-sm">${scr ? scr.department : '—'}</td>
                      <td class="text-center">${fb.q1}/5</td>
                      <td class="text-center">${fb.q2}/5</td>
                      <td class="text-center">${fb.q3}/5</td>
                      <td class="text-center">${fb.q4}/5</td>
                      <td class="text-center">${fb.q5}/5</td>
                      <td>${Utils.badgeHtml(fb.avgScore.toFixed(1), scoreColor)}</td>
                      <td class="text-sm text-tertiary">${Utils.formatDate(fb.timestamp)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <div id="feedback-tab-pending" class="hidden">
        ${needFeedback.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <h3 class="empty-state-title">All Caught Up</h3>
            <p class="empty-state-text">All completed SCRs have received feedback</p>
          </div>
        ` : `
          <div class="stagger-children">
            ${needFeedback.map(scr => `
              <div class="card mb-3">
                <div class="flex items-center justify-between">
                  <div>
                    <span class="font-semi text-brand">${scr.scrNumber}</span>
                    <span class="text-sm text-secondary ml-2">${scr.department}</span>
                    <p class="text-sm text-tertiary mt-1">${Utils.truncate(scr.description, 80)}</p>
                  </div>
                  <button class="btn btn-outline btn-sm" onclick="Feedback.showForm('${scr.id}')">📝 Give Feedback</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  },

  postRender() {},

  switchTab(tab, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('feedback-tab-received').classList.toggle('hidden', tab !== 'received');
    document.getElementById('feedback-tab-pending').classList.toggle('hidden', tab !== 'pending');
  }
};
