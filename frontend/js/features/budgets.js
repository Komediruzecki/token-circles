// ==================== BUDGETS ====================
const budgets = {
  budgetChart: null,
  async load() {
    const [budgets, summary, settings] = await Promise.all([
      api('/budgets'),
      api('/budgets/summary'),
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
          return `<div class="budget-item">
          <div class="budget-item-header">
            <div style="display:flex;align-items:center;gap:6px;"><span class="cat-dot" style="background:${b.category_color || '#6b7280'}"></span><span class="budget-item-name">${b.category_name}</span></div>
            <div class="budget-item-amounts">${formatCurrency(b.spent || 0, currency)} / ${formatCurrency(b.amount, currency)}</div>
          </div>
          <div class="budget-bar"><div class="budget-bar-fill ${cls}" style="width:${Math.min(100, pct)}%"></div></div>
          <div style="font-size:12px;margin-top:4px;color:var(--text-secondary);display:flex;justify-content:space-between;">
             <span>${pct.toFixed(0)}% used</span>
             <span class="${isOver ? 'text-danger' : 'text-success'}">${isOver ? 'Over' : 'Under'}: ${formatCurrency(diff, currency)}</span>
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
