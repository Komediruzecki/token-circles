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
};
