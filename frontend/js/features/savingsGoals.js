// ==================== SAVINGS GOALS ====================
const savingsGoals = {
  editingId: null,

  async load() {
    const grid = document.getElementById('goals-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-spinner"></div>';

    try {
      const goals = await api('/savings-goals');
      const settingsData = await api('/settings');
      const currency = settingsData.local_currency || 'EUR';
      this.render(goals, currency);
    } catch (e) {
      grid.innerHTML = `<div class="empty-state"><p>Failed to load goals: ${escapeHtml(e.message)}</p></div>`;
    }
  },

  render(goals, currency) {
    const grid = document.getElementById('goals-grid');
    if (!grid) return;

    if (!goals || goals.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="padding:60px 20px;">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:48px;height:48px;margin:0 auto 16px;"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
        <p>No savings goals yet. Set a target to start tracking your progress.</p>
      </div>`;
      return;
    }

    grid.innerHTML = `<div class="goals-grid">${goals.map(g => this.renderGoal(g, currency)).join('')}</div>`;
  },

  renderGoal(g, currency) {
    const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0;
    const remaining = Math.max(0, g.target_amount - g.current_amount);
    const isComplete = pct >= 100;

    let statusColor = 'var(--primary)';
    let statusText = `${pct.toFixed(0)}% saved`;
    let deadlineInfo = '';

    if (g.deadline) {
      const deadline = new Date(g.deadline);
      const now = new Date();
      const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
      if (isComplete) {
        deadlineInfo = `<span style="color:var(--success);">Goal reached!</span>`;
      } else if (daysLeft < 0) {
        deadlineInfo = `<span style="color:var(--error);">Overdue by ${Math.abs(daysLeft)} days</span>`;
      } else if (daysLeft <= 30) {
        deadlineInfo = `<span style="color:var(--warning);">${daysLeft} days left</span>`;
      } else {
        deadlineInfo = `Due ${formatDate(g.deadline)}`;
      }
    }

    const barColor = isComplete ? 'var(--success)' : statusColor;
    const cardBg = isComplete ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg-secondary)';

    return `<div class="goal-card" style="background:${cardBg};border:1px solid ${isComplete ? 'rgba(16,185,129,0.2)' : 'var(--border)'}">
      <div class="goal-header">
        <div style="flex:1;">
          <div class="goal-name">${escapeHtml(g.name)}</div>
          ${deadlineInfo ? `<div class="goal-deadline">${deadlineInfo}</div>` : ''}
        </div>
        <div class="goal-actions">
          <button class="btn btn-ghost btn-sm" onclick="savingsGoals.openModal(${g.id})" title="Edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="savingsGoals.quickAdd(${g.id})" title="Add savings">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="savingsGoals.deleteGoal(${g.id})" title="Delete">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${pct.toFixed(1)}%;background:${barColor};"></div>
      </div>
      <div class="goal-amounts">
        <div>
          <span class="goal-amount-label">Current</span>
          <span class="goal-amount-value" style="color:var(--success);">${formatCurrency(g.current_amount, currency)}</span>
        </div>
        <div style="text-align:center;">
          <span class="goal-amount-label">Progress</span>
          <span class="goal-amount-value">${pct.toFixed(1)}%</span>
        </div>
        <div style="text-align:right;">
          <span class="goal-amount-label">${isComplete ? 'Excess' : 'Remaining'}</span>
          <span class="goal-amount-value" style="color:${isComplete ? 'var(--success)' : 'var(--text)'};">${formatCurrency(isComplete ? g.current_amount - g.target_amount : remaining, currency)}</span>
        </div>
      </div>
      <div class="goal-target-line">Target: ${formatCurrency(g.target_amount, currency)}</div>
      ${g.notes ? `<div class="goal-notes">${escapeHtml(g.notes)}</div>` : ''}
    </div>`;
  },

  openModal(id) {
    if (id) {
      this.openModalForEdit(id);
    } else {
      this.openModalNew();
    }
  },

  openModalNew() {
    this.editingId = null;
    document.getElementById('goal-id').value = '';
    document.getElementById('goal-name').value = '';
    document.getElementById('goal-target').value = '';
    document.getElementById('goal-current').value = '0';
    document.getElementById('goal-deadline').value = '';
    document.getElementById('goal-notes').value = '';
    document.getElementById('goal-modal-title').textContent = 'New Savings Goal';
    modal.open('goal-modal');
    document.getElementById('goal-name').focus();
  },

  async openModalForEdit(id) {
    try {
      const goals = await api('/savings-goals');
      const goal = goals.find(g => String(g.id) === String(id));
      if (!goal) return;
      this.editingId = goal.id;
      document.getElementById('goal-id').value = goal.id;
      document.getElementById('goal-name').value = goal.name || '';
      document.getElementById('goal-target').value = goal.target_amount || '';
      document.getElementById('goal-current').value = goal.current_amount || 0;
      document.getElementById('goal-deadline').value = goal.deadline || '';
      document.getElementById('goal-notes').value = goal.notes || '';
      document.getElementById('goal-modal-title').textContent = 'Edit Savings Goal';
      modal.open('goal-modal');
    } catch (e) {
      toast('Failed to load goal: ' + e.message, 'error');
    }
  },

  async save() {
    const name = document.getElementById('goal-name').value.trim();
    const target_amount = parseFloat(document.getElementById('goal-target').value);
    const current_amount = parseFloat(document.getElementById('goal-current').value) || 0;
    const deadline = document.getElementById('goal-deadline').value || null;
    const notes = document.getElementById('goal-notes').value.trim();

    if (!name) {
      toast('Please enter a goal name', 'error');
      return;
    }
    if (!target_amount || target_amount <= 0) {
      toast('Please enter a valid target amount', 'error');
      return;
    }

    const data = { name, target_amount, current_amount, deadline, notes };
    const id = this.editingId;

    try {
      if (id) {
        await api(`/savings-goals/${id}`, { method: 'PUT', body: data });
        toast('Goal updated', 'success');
      } else {
        await api('/savings-goals', { method: 'POST', body: data });
        toast('Goal created', 'success');
      }
      modal.close('goal-modal');
      this.load();
    } catch (e) {
      toast('Failed to save goal: ' + e.message, 'error');
    }
  },

  async quickAdd(id) {
    const amount = parseFloat(prompt('Enter amount to add to this goal:'));
    if (isNaN(amount) || amount <= 0) return;
    try {
      const goals = await api('/savings-goals');
      const goal = goals.find(g => String(g.id) === String(id));
      if (!goal) return;
      await api(`/savings-goals/${id}`, {
        method: 'PUT',
        body: {
          name: goal.name,
          target_amount: goal.target_amount,
          current_amount: goal.current_amount + amount,
          deadline: goal.deadline,
          notes: goal.notes,
        },
      });
      toast(`Added ${formatCurrency(amount, (await api('/settings')).local_currency || 'EUR')} to goal`, 'success');
      this.load();
    } catch (e) {
      toast('Failed to update goal: ' + e.message, 'error');
    }
  },

  async deleteGoal(id) {
    if (!confirm('Delete this savings goal? This cannot be undone.')) return;
    try {
      await api(`/savings-goals/${id}`, { method: 'DELETE' });
      toast('Goal deleted', 'success');
      this.load();
    } catch (e) {
      toast('Failed to delete goal: ' + e.message, 'error');
    }
  },
};
window.savingsGoals = savingsGoals;
