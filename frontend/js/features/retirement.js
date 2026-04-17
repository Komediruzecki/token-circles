// ==================== RETIREMENT CALCULATOR ====================
const retirement = {
  chart: null,
  _debounceTimer: null,
  currentCurrency: 'EUR',
  scheduleUpdate() {
    // Debounce input changes - recalculate 400ms after last change
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.calculate(), 400);
  },
  init() {
    this.currentCurrency = settings.local_currency || 'EUR';
  },
  handleCountryChange() {
    const country = document.getElementById('ret-country').value;
    const expensesInput = document.getElementById('ret-expenses-retire');
    if (country) {
      expensesInput.disabled = true;
      expensesInput.placeholder = 'Disabled when country selected';
    } else {
      expensesInput.disabled = false;
      expensesInput.placeholder = 'Leave empty if using country';
    }
    this.scheduleUpdate();
  },
  async calculate() {
    const country = document.getElementById('ret-country').value;
    const expensesAtRetirement = country
      ? null
      : parseFloat(document.getElementById('ret-expenses-retire').value) || null;
    const payload = {
      currentAge: parseInt(document.getElementById('ret-age').value) || 30,
      retirementAge: parseInt(document.getElementById('ret-age-goal').value) || 65,
      currentSavings: parseFloat(document.getElementById('ret-savings').value) || 0,
      monthlyContribution: parseFloat(document.getElementById('ret-contrib').value) || 0,
      annualExpenses: parseFloat(document.getElementById('ret-expenses').value) || 30000,
      annualReturn: parseFloat(document.getElementById('ret-return').value) || 7,
      country: country,
      expensesAtRetirement: expensesAtRetirement,
    };
    try {
      const resp = await fetch(API + '/calculator/retire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Profile-Id': profile.currentId },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      this.renderResults(result);
    } catch (e) {
      toast('Calculation failed: ' + e.message, 'error');
    }
  },
  renderResults(result) {
    const r = result;
    const cc = chartColors();
    const currency = this.currentCurrency;

    const resultsEl = document.getElementById('retirement-results');
    if (!resultsEl) {
      toast('Retirement results container not found', 'error');
      return;
    }

    resultsEl.style.display = 'flex';
    resultsEl.style.flexDirection = 'column';

    document.getElementById('res-fire-age').textContent = r.fireAge || '-';
    document.getElementById('res-fire-number').textContent = formatCurrency(r.fireNumber, currency);
    document.getElementById('res-months-to-fire').textContent = r.monthsToFire
      ? `${r.monthsToFire} months`
      : '-';
    document.getElementById('res-current-nw').textContent = formatCurrency(
      r.currentNWAtFire,
      currency
    );
    document.getElementById('res-traditional-age').textContent = r.traditionalRetirementAge || '-';
    document.getElementById('res-savings-at-fire').textContent = formatCurrency(
      r.savingsAtRetirement,
      currency
    );

    // Scenarios at top of right panel
    const scenariosDiv = document.getElementById('res-scenarios');
    if (scenariosDiv) {
      scenariosDiv.innerHTML = (r.scenarios || [])
        .map((s) => {
          const isReached = s.reached;
          return `<div style="background:${isReached ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border-left:3px solid ${isReached ? 'var(--success)' : 'var(--error)'};padding:12px;border-radius:6px;margin-bottom:8px;">
          <div style="font-weight:600;margin-bottom:4px;">${s.name} (${s.return}% return)</div>
          <div style="font-size:13px;color:var(--text-secondary);">
            FIRE Age: <span style="color:${isReached ? 'var(--success)' : 'var(--error)'};font-weight:600;">${s.fireAge ?? '-'}</span>
            &nbsp;&bull;&nbsp;At FIRE: ${formatCurrency(s.savingsAtFire, currency)}
            &nbsp;&bull;&nbsp;${isReached ? 'Target Reached!' : 'Target Missed by ' + formatCurrency(Math.abs(s.shortfall), currency)}
          </div>
        </div>`;
        })
        .join('');
    }

    // Timeline chart
    const timeline = r.timeline || [];
    const retChart = document.getElementById('ret-chart');
    if (timeline.length === 0 || !retChart) {
      retChart &&
        (retChart.parentElement.innerHTML =
          '<p style="text-align:center;color:var(--text-secondary);padding:20px;">No timeline data available</p>');
      return;
    }
    const labels = timeline.map((t) => `${t.year} (age ${t.age})`);
    const savingsData = timeline.map((t) => t.savings);
    const fireLineData = timeline.map(() => r.fireNumber);

    const ctx = document.getElementById('ret-chart').getContext('2d');
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Savings Projection',
            data: savingsData,
            borderColor: cc.primary,
            backgroundColor: cc.primaryBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: `FIRE Target (${formatCurrency(r.fireNumber, currency)})`,
            data: fireLineData,
            borderColor: '#10b981',
            borderDash: [5, 5],
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: cc.legend } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: (v) => formatCurrency(v, currency), color: cc.text },
            grid: { color: cc.grid },
          },
          x: {
            ticks: { color: cc.text, maxTicksLimit: 12 },
            grid: { color: cc.grid },
          },
        },
      },
    });
  },
};
window.retirement = retirement;
