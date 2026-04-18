// ==================== DASHBOARD ====================
const dashboard = {
  charts: {},
  init() {
    this.populateYears();
    this.load();
  },
  populateYears() {
    const select = document.getElementById('dashboard-year');
    if (select.options.length > 1) return;
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 5; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      select.appendChild(opt);
    }
    select.value = currentYear;
  },
  onYearChange() {
    const year = document.getElementById('dashboard-year').value;
    const monthSelect = document.getElementById('dashboard-month-select');
    if (year) {
      monthSelect.style.display = 'inline-block';
    } else {
      monthSelect.value = '';
    }
    this.updateDisplay();
    this.loadSummary();
  },
  onMonthChange() {
    this.updateDisplay();
    this.loadSummary();
  },
  updateDisplay() {
    const year = document.getElementById('dashboard-year').value;
    const month = document.getElementById('dashboard-month-select').value;
    const monthEl = document.getElementById('dashboard-month');

    if (month) {
      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      monthEl.textContent = `${monthNames[parseInt(month) - 1]} ${year}`;
    } else if (year) {
      monthEl.textContent = year;
    } else {
      monthEl.textContent = 'All Time';
    }
  },
  prevMonth() {
    const yearEl = document.getElementById('dashboard-year');
    const monthEl = document.getElementById('dashboard-month-select');
    let year = parseInt(yearEl.value) || new Date().getFullYear();
    let month = parseInt(monthEl.value) || new Date().getMonth() + 1;

    month--;
    if (month < 1) {
      month = 12;
      year--;
    }
    yearEl.value = year;
    monthEl.value = String(month).padStart(2, '0');
    this.updateDisplay();
    this.loadSummary();
  },
  nextMonth() {
    const yearEl = document.getElementById('dashboard-year');
    const monthEl = document.getElementById('dashboard-month-select');
    let year = parseInt(yearEl.value) || new Date().getFullYear();
    let month = parseInt(monthEl.value) || new Date().getMonth() + 1;

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
    yearEl.value = year;
    monthEl.value = String(month).padStart(2, '0');
    this.updateDisplay();
    this.loadSummary();
  },
  async load() {
    this.updateDisplay();
    await Promise.all([this.loadSummary(), this.loadCharts()]);
    if (typeof recurring !== 'undefined') recurring.load();
    this.loadRecurringInsights();
  },
  async loadSummary() {
    const year = document.getElementById('dashboard-year').value;
    const month = document.getElementById('dashboard-month-select').value;

    let url = '/dashboard/summary';
    if (year && month) {
      url += `?year=${year}&month=${month}`;
    } else if (year) {
      url += `?year=${year}`;
    }

    const data = await api(url);
    const currency = data.currency || 'EUR';
    document.getElementById('stat-income').textContent = formatCurrency(
      data.summary?.income || 0,
      currency
    );
    document.getElementById('stat-expense').textContent = formatCurrency(
      data.summary?.expense || 0,
      currency
    );
    document.getElementById('stat-balance').textContent = formatCurrency(
      data.summary?.balance || 0,
      currency
    );

    // Month-over-month deltas
    const prev = data.prevSummary || {};
    const setDelta = (id, current, prevVal, inverse) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!prevVal || prevVal === 0) { el.textContent = ''; return; }
      const pct = ((current - prevVal) / Math.abs(prevVal)) * 100;
      const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
      // For expenses, lower is better; for income/balance, higher is better
      const positive = inverse ? pct < 0 : pct > 0;
      el.className = 'stat-card-delta ' + (pct === 0 ? '' : positive ? 'positive' : 'negative');
      el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% vs prev`;
    };
    setDelta('delta-income', data.summary?.income || 0, prev.income, false);
    setDelta('delta-expense', data.summary?.expense || 0, prev.expense, true);
    const balance = data.summary?.balance || 0;
    const prevBalance = (prev.income || 0) - (prev.expense || 0);
    setDelta('delta-balance', balance, prevBalance, false);

    // Fetch and display net worth
    const nw = await api('/dashboard/net-worth');
    document.getElementById('stat-networth').textContent = formatCurrency(
      nw.totalNetWorth || 0,
      currency
    );

    // Budget alerts
    this.loadBudgetAlerts();

    // Savings rate
    this.loadSavingsRate();

    // Recent transactions
    const rt = document.getElementById('recent-transactions');
    if (!data.recent || data.recent.length === 0) {
      rt.innerHTML =
        '<div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><p>No transactions yet</p></div>';
    } else {
      rt.innerHTML = `<div class="table-wrap" style="max-height:280px;overflow-y:auto;">
        <table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>
        ${data.recent
          .map(
            (t) => `<tr>
          <td>${formatDate(t.date)}</td>
          <td><span class="cat-dot" style="background:${t.category_color || '#6b7280'}"></span>${escapeHtml(t.description) || '-'}</td>
          <td class="td-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${formatCurrency(t.amount_local || t.amount, currency)}</td>
        </tr>`
          )
          .join('')}
        </tbody></table></div>`;
    }
  },
  async loadCharts() {
    const chartData = await api('/dashboard/charts?months=12');
    const currency = chartData.currency || 'EUR';

    // Spending by category - Doughnut
    if (this.charts.category) this.charts.category.destroy();
    const catCtx = document.getElementById('chart-category').getContext('2d');
    const catLabels = (chartData.byCategory || []).map((c) => c.name);
    const catData = (chartData.byCategory || []).map((c) => c.total);
    const catColors = (chartData.byCategory || []).map((c) => c.color);

    this.charts.category = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels.length ? catLabels : ['No data'],
        datasets: [
          {
            data: catData.length ? catData : [1],
            backgroundColor: catColors.length ? catColors : ['#e2e8f0'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, padding: 12, font: { size: 12, color: chartColors().legend } },
          },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.raw, currency)}` },
          },
        },
      },
    });

    // Monthly income vs expense - Bar
    if (this.charts.monthly) this.charts.monthly.destroy();
    const monthlyCtx = document.getElementById('chart-monthly').getContext('2d');
    const monthlyLabels = (chartData.monthly || []).map((m) => m.month);
    const monthlyIncome = (chartData.monthly || []).map((m) => m.income);
    const monthlyExpense = (chartData.monthly || []).map((m) => m.expense);

    const cc = chartColors();
    this.charts.monthly = new Chart(monthlyCtx, {
      type: 'bar',
      data: {
        labels: monthlyLabels.length ? monthlyLabels : ['No data'],
        datasets: [
          {
            label: 'Income',
            data: monthlyIncome.length ? monthlyIncome : [0],
            backgroundColor: cc.income,
            borderRadius: 4,
          },
          {
            label: 'Expenses',
            data: monthlyExpense.length ? monthlyExpense : [0],
            backgroundColor: cc.expense,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: { size: 12 }, color: cc.legend } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => formatCurrency(v, currency) },
            grid: { color: cc.grid },
            title: { display: false, color: cc.text },
            ticks: { color: cc.text },
          },
          x: { grid: { color: cc.grid }, ticks: { color: cc.text } },
        },
      },
    });

    // Cash flow - Line
    if (this.charts.cashflow) this.charts.cashflow.destroy();
    const cfCtx = document.getElementById('chart-cashflow').getContext('2d');
    const cfData = chartData.cashFlow || [];

    this.charts.cashflow = new Chart(cfCtx, {
      type: 'line',
      data: {
        labels: cfData.map((r) => r.month),
        datasets: [
          {
            label: 'Cumulative Balance',
            data: cfData.map((r) => r.cumulative),
            borderColor: cc.primary,
            backgroundColor: cc.primaryBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: cc.primary,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            callbacks: { label: (ctx) => ` Balance: ${formatCurrency(ctx.raw, currency)}` },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => formatCurrency(v, currency) },
            grid: { color: cc.grid },
            ticks: { color: cc.text },
          },
          x: { grid: { color: cc.grid }, ticks: { color: cc.text } },
        },
      },
    });

    // Net worth over time - Line
    await this.loadNetWorthChart(currency);
  },
  async loadNetWorthChart(currency) {
    const nwCard = document.getElementById('networth-chart-card');
    if (!nwCard) return;

    try {
      const timeline = await api('/accounts/history/timeline');
      if (!timeline || timeline.length === 0) {
        nwCard.style.display = 'none';
        return;
      }
      nwCard.style.display = 'block';

      if (this.charts.networth) this.charts.networth.destroy();
      const ctx = document.getElementById('chart-networth').getContext('2d');
      const cc = chartColors();

      const labels = timeline.map((r) => {
        const d = new Date(r.date);
        return `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`;
      });
      const data = timeline.map((r) => r.net_worth);

      this.charts.networth = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Net Worth',
              data,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 4,
              pointBackgroundColor: '#10b981',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { font: { size: 12 }, color: cc.legend } },
            tooltip: {
              callbacks: { label: (ctx) => ` Net Worth: ${formatCurrency(ctx.raw, currency)}` },
            },
          },
          scales: {
            y: {
              ticks: { callback: (v) => formatCurrency(v, currency), color: cc.text },
              grid: { color: cc.grid },
            },
            x: {
              grid: { color: cc.grid },
              ticks: { color: cc.text, maxTicksLimit: 12 },
            },
          },
        },
      });
    } catch (e) {
      const nwCard = document.getElementById('networth-chart-card');
      if (nwCard) nwCard.style.display = 'none';
    }
  },
  async loadRecurringInsights() {
    const card = document.getElementById('recurring-insights-card');
    if (!card) return;
    try {
      const data = await api('/recurring/upcoming');
      const currency = data.currency || 'EUR';
      const container = document.getElementById('recurring-insights-list');

      if (!data.transactions || data.transactions.length === 0) {
        card.style.display = 'none';
        return;
      }
      card.style.display = 'block';

      // Show total
      const totalEl = document.getElementById('recurring-insights-total');
      if (totalEl) totalEl.textContent = formatCurrency(data.totalMonthly || 0, currency);

      // Show top 5 upcoming
      const top5 = data.transactions.slice(0, 5);
      container.innerHTML = top5.map(t => {
        const day = new Date(t.next_date).getDate();
        const daySuffix = getDaySuffix(day);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="cat-dot" style="background:${t.category_color || '#6b7280'}"></span>
            <span style="font-weight:500;">${escapeHtml(t.description || '-')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <span style="font-weight:600;color:${t.type === 'expense' ? 'var(--expense)' : 'var(--income)'};">
              ${t.type === 'expense' ? '-' : '+'}${formatCurrency(t.amount, currency)}
            </span>
            <span style="font-size:12px;color:var(--text-secondary);min-width:36px;text-align:right;">
              ${day}${daySuffix}
            </span>
          </div>
        </div>`;
      }).join('');

      // Show category summary
      const catSummary = document.getElementById('recurring-insights-categories');
      if (catSummary && data.byCategory && data.byCategory.length > 0) {
        catSummary.innerHTML = data.byCategory.slice(0, 4).map(c => {
          const barPct = Math.min(100, (c.total / (data.totalMonthly || 1)) * 100);
          return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:5px;">
                <span class="cat-dot" style="background:${c.color || '#6b7280'}"></span>
                ${escapeHtml(c.name)}
              </span>
              <span style="font-size:12px;font-weight:500;">${formatCurrency(c.total, currency)}</span>
            </div>
            <div style="background:var(--bg-secondary);border-radius:3px;height:4px;overflow:hidden;">
              <div style="width:${barPct}%;height:100%;background:${c.color || 'var(--primary)'};border-radius:3px;"></div>
            </div>
          </div>`;
        }).join('');
      }
    } catch (e) {
      const card = document.getElementById('recurring-insights-card');
      if (card) card.style.display = 'none';
    }
  },
  async loadSavingsRate() {
    const card = document.getElementById('savings-rate-card');
    if (!card) return;
    try {
      const year = document.getElementById('dashboard-year').value;
      const month = document.getElementById('dashboard-month-select').value;

      // Fetch current month summary for savings rate calculation
      let summaryUrl = '/dashboard/summary';
      if (year && month) summaryUrl += `?year=${year}&month=${month}`;
      else if (year) summaryUrl += `?year=${year}`;

      const [summaryData, allSettings] = await Promise.all([
        api(summaryUrl),
        api('/api/settings'),
      ]);

      if (!summaryData || !summaryData.summary) {
        card.style.display = 'none';
        return;
      }

      const income = summaryData.summary?.income || 0;
      const expense = summaryData.summary?.expense || 0;
      const goal = parseFloat(allSettings.savings_rate_goal) || null;

      const content = document.getElementById('savings-rate-content');
      const subtitle = document.getElementById('savings-rate-subtitle');
      const goalInput = document.getElementById('savings-rate-goal-input');

      if (goalInput && goal) goalInput.value = goal;

      // No goal set — show prompt
      if (!goal) {
        card.style.display = 'block';
        subtitle.textContent = 'Set a savings rate target to track your progress';
        content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-secondary);">
          <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 8px;opacity:.4;"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <p style="font-size:14px;margin:0;">Enter your target savings rate above and click "Set Goal"</p>
        </div>`;
        return;
      }

      // Calculate current savings rate
      const currentRate = income > 0 ? ((income - expense) / income) * 100 : 0;

      // Get previous month for MoM
      let prevRate = null;
      if (year && month) {
        let prevYear = parseInt(year);
        let prevMonth = parseInt(month) - 1;
        if (prevMonth < 1) { prevMonth = 12; prevYear--; }
        const prevData = await api(`/dashboard/summary?year=${prevYear}&month=${String(prevMonth).padStart(2, '0')}`);
        const prevIncome = prevData.summary?.income || 0;
        const prevExpense = prevData.summary?.expense || 0;
        prevRate = prevIncome > 0 ? ((prevIncome - prevExpense) / prevIncome) * 100 : 0;
      }

      // Color coding
      const progressPct = Math.min(100, (currentRate / goal) * 100);
      let statusColor, statusLabel;
      if (currentRate >= goal) {
        statusColor = 'var(--success)';
        statusLabel = 'On Track';
      } else if (currentRate >= goal * 0.5) {
        statusColor = '#f59e0b';
        statusLabel = 'Getting There';
      } else {
        statusColor = 'var(--error)';
        statusLabel = 'Below Target';
      }

      // Month label
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const monthLabel = month ? `${monthNames[parseInt(month) - 1]}` : (year ? year : 'All Time');

      // MoM delta
      let momHtml = '';
      if (prevRate !== null) {
        const delta = currentRate - prevRate;
        const arrow = delta >= 0 ? '▲' : '▼';
        const momColor = delta >= 0 ? 'var(--success)' : 'var(--error)';
        momHtml = `<span style="font-size:12px;color:${momColor};font-weight:500;margin-left:8px;">${arrow} ${Math.abs(delta).toFixed(1)}% vs last month</span>`;
      }

      card.style.display = 'block';
      subtitle.textContent = `${monthLabel} ${year || ''}`;

      content.innerHTML = `
        <div style="margin-bottom:12px;">
          <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
            <span style="font-size:28px;font-weight:700;color:${statusColor};">${currentRate.toFixed(1)}%</span>
            <span style="font-size:14px;color:var(--text-secondary);">savings rate</span>
            <span style="margin-left:auto;font-size:12px;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:10px;">${statusLabel}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);">
            Target: <strong>${goal}%</strong>${momHtml}
          </div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:6px;height:10px;overflow:hidden;margin-bottom:12px;">
          <div style="width:${Math.min(100, progressPct)}%;height:100%;background:${statusColor};border-radius:6px;transition:width .4s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
          <span>${currentRate.toFixed(1)}% of ${goal}% goal</span>
          <span>${income > 0 ? `Balance: ${formatCurrency(income - expense, settings.local_currency || 'EUR')}` : 'No income data'}</span>
        </div>`;
    } catch (e) {
      console.warn('Savings rate load failed:', e);
      const card = document.getElementById('savings-rate-card');
      if (card) card.style.display = 'none';
    }
  },
  async loadBudgetAlerts() {
    const card = document.getElementById('budget-alerts-card');
    if (!card) return;
    try {
      const data = await api('/budgets/alerts?threshold=80');
      const alerts = data.alerts || [];
      const list = document.getElementById('budget-alerts-list');
      const currency = settings.local_currency || 'EUR';

      if (alerts.length === 0) {
        card.style.display = 'none';
        return;
      }
      card.style.display = 'block';
      list.innerHTML = alerts
        .map((a) => {
          const color =
            a.status === 'over'
              ? 'var(--error)'
              : a.status === 'warning'
              ? '#f59e0b'
              : 'var(--success)';
          const bg =
            a.status === 'over'
              ? 'rgba(239,68,68,0.08)'
              : a.status === 'warning'
              ? 'rgba(245,158,11,0.08)'
              : 'rgba(16,185,129,0.08)';
          const label =
            a.status === 'over'
              ? 'Over Budget!'
              : a.status === 'warning'
              ? 'Near Limit'
              : 'On Track';
          return `<div style="background:${bg};border-left:3px solid ${color};padding:12px;border-radius:6px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="cat-dot" style="background:${a.categoryColor || '#6b7280'}"></span>
              <span style="font-weight:600;">${escapeHtml(a.categoryName)}</span>
            </div>
            <span style="font-size:12px;font-weight:600;color:${color};">${label}</span>
          </div>
          <div style="background:var(--bg-secondary);border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px;">
            <div style="width:${Math.min(100, a.percentage)}%;height:100%;background:${color};border-radius:4px;transition:width .3s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);">
            <span>${formatCurrency(a.spent, currency)} / ${formatCurrency(a.budgetAmount, currency)}</span>
            <span>${a.percentage}%</span>
          </div>
        </div>`;
        })
        .join('');
    } catch (e) {
      card.style.display = 'none';
    }
  },
  async setSavingsRateGoal() {
    const input = document.getElementById('savings-rate-goal-input');
    if (!input) return;
    const value = parseFloat(input.value);
    if (isNaN(value) || value <= 0 || value > 100) {
      input.style.borderColor = 'var(--error)';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: { savings_rate_goal: value },
      });
      input.value = value;
      input.style.borderColor = '';
      this.loadSavingsRate();
    } catch (e) {
      console.error('Failed to save savings rate goal:', e);
    }
  },
};

function getDaySuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
