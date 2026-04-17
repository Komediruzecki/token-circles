// ==================== BUDGETS ====================
const budgets = {
  budgetChart: null,
  historyChart: null,
  async load() {
    const monthSelect = document.getElementById('budget-month-select');
    this.populateMonthSelect(monthSelect);

    const selectedMonth = monthSelect.value;
    const [budgets, summary, settings] = await Promise.all([
      api('/budgets'),
      api('/budgets/summary' + (selectedMonth ? `?year=${selectedMonth.split('-')[0]}&month=${selectedMonth.split('-')[1]}` : '')),
      api('/settings'),
    ]);
    const currency = settings.local_currency || 'EUR';

    // Budget list
    const list = document.getElementById('budget-list');
    if (summary.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg><p>No budgets set. Add one to track spending.</p></div>';
    } else {
      list.innerHTML = summary
        .map((b) => {
          const pct = b.percentage || 0;
          const diff = Math.abs(b.remaining);
          const isOver = b.remaining < 0;
          const cls = pct >= 100 ? 'over' : pct >= 75 ? 'warning' : 'ok';
          const circleSize = 60;
          const strokeWidth = 5;
          const radius = (circleSize - strokeWidth) / 2;
          const circumference = 2 * Math.PI * radius;
          const offset = circumference - (pct / 100) * circumference;
          const circleColor = pct >= 100 ? 'var(--danger)' : pct >= 75 ? '#f59e0b' : 'var(--success)';
          return `<div class="budget-item">
          <div class="budget-item-header">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="cat-dot" style="background:${b.category_color || '#6b7280'}"></span>
              <span class="budget-item-name">${escapeHtml(b.category_name)}</span>
            </div>
            <div class="budget-item-actions">
              <button class="btn btn-ghost btn-sm" onclick="budgets.openModal(${b.id})" title="Edit budget">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm text-danger" onclick="budgets.delete(${b.id})" title="Delete budget">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <svg class="budget-circle" width="${circleSize}" height="${circleSize}" style="transform: rotate(-90deg);">
              <circle cx="${circleSize/2}" cy="${circleSize/2}" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${strokeWidth}"/>
              <circle cx="${circleSize/2}" cy="${circleSize/2}" r="${radius}" fill="none" stroke="${circleColor}" stroke-width="${strokeWidth}"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
            </svg>
            <div style="flex:1;">
              <div class="budget-bar"><div class="budget-bar-fill ${cls}" style="width:${Math.min(100, pct)}%"></div></div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                <span style="font-size:13px;font-weight:600;">${formatCurrency(b.spent || 0, currency)} <span style="font-weight:400;color:var(--text-secondary);">/ ${formatCurrency(b.amount, currency)}</span></span>
                <span class="${isOver ? 'text-danger' : 'text-success'}" style="font-size:12px;font-weight:500;">${isOver ? 'Over' : 'Under'}: ${formatCurrency(diff, currency)}</span>
              </div>
            </div>
          </div>
        </div>`;
        })
        .join('');
    }

    // Budget chart
    if (summary.length > 0) {
      const ctx = document.getElementById('chart-budget').getContext('2d');
      if (this.budgetChart) this.budgetChart.destroy();
      const cc = chartColors();
      this.budgetChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: summary.map((b) => b.category_name),
          datasets: [
            {
              label: 'Budget',
              data: summary.map((b) => b.amount),
              backgroundColor: cc.primaryBg,
              borderRadius: 4,
            },
            {
              label: 'Spent',
              data: summary.map((b) => b.spent || 0),
              backgroundColor: summary.map((b) =>
                b.percentage >= 100 ? cc.expense : b.percentage >= 75 ? '#f59e0b' : cc.income
              ),
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: { color: cc.legend, font: { size: 12 } },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)}`,
              },
            },
          },
          scales: {
            x: {
              beginAtZero: true,
              ticks: { callback: (v) => formatCurrency(v, currency) },
              grid: { color: cc.grid },
              ticks: { color: cc.text },
            },
            y: { grid: { color: cc.grid }, ticks: { color: cc.text } },
          },
        },
      });
    }
  },
  populateMonthSelect(select) {
    if (select.options.length > 1) return;
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      select.appendChild(opt);
    }
  },
  async duplicateLastMonth() {
    try {
      toast('Copying last month\'s budgets...', 'info');
      const result = await api('/budgets/duplicate-last', { method: 'POST', body: {} });
      if (result.ok) {
        toast(`Copied ${result.count} budgets from last month`, 'success');
        this.load();
      } else {
        toast(result.message || 'No budgets found to copy', 'error');
      }
    } catch (e) {
      toast('Failed to copy budgets: ' + e.message, 'error');
    }
  },
  async setFromExpenses() {
    try {
      toast('Setting budgets from last expenses...', 'info');
      const result = await api('/budgets/from-expenses', { method: 'POST', body: {} });
      if (result.ok) {
        toast(`Created ${result.count} budgets from last month's expenses`, 'success');
        this.load();
      } else {
        toast(result.message || 'No expenses found to copy', 'error');
      }
    } catch (e) {
      toast('Failed to set budgets: ' + e.message, 'error');
    }
  },
  async openModal(id = null) {
    document.getElementById('budget-id').value = id || '';
    document.getElementById('budget-modal-title').textContent = id ? 'Edit Budget' : 'Add Budget';
    const cats = await api('/categories');
    const catSelect = document.getElementById('budget-category');
    catSelect.innerHTML = cats
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');

    if (id) {
      const budgets = await api('/budgets');
      const b = budgets.find((x) => x.id === id);
      if (b) {
        catSelect.value = b.category_id;
        document.getElementById('budget-amount').value = b.amount;
        document.getElementById('budget-period').value = b.period;
        document.getElementById('budget-start').value = b.start_date || '';
        document.getElementById('budget-end').value = b.end_date || '';
      }
    } else {
      document.getElementById('budget-form').reset();
      document.getElementById('budget-start').value = new Date().toISOString().split('T')[0];
    }
    modal.open('budget-modal');
  },
  async save() {
    const id = document.getElementById('budget-id').value;
    const data = {
      category_id: parseInt(document.getElementById('budget-category').value),
      amount: parseFloat(document.getElementById('budget-amount').value),
      period: document.getElementById('budget-period').value,
      start_date: document.getElementById('budget-start').value,
      end_date: document.getElementById('budget-end').value || null,
    };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/budgets/${id}` : '/budgets';
    const result = await api(url, { method, body: data });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(id ? 'Budget updated' : 'Budget added', 'success');
    modal.close('budget-modal');
    this.load();
  },
  async delete(id) {
    if (!confirm('Delete this budget?')) return;
    const result = await api(`/budgets/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Budget deleted', 'success');
    this.load();
  },
};
