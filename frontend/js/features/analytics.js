// ==================== ANALYTICS ====================
const analytics = {
  chart: null,
  pieChart: null,
  currentType: 'expense',
  init() {
    this.populateYears().then(() => this.load());
  },
  async populateYears() {
    const select = document.getElementById('analytics-year');
    try {
      const { years } = await api('/analytics/distinct-years');
      if (!years || years.length === 0) return;
      select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    } catch (e) {
      console.error('Failed to load years:', e);
    }
  },
  onYearChange() {
    document.getElementById('analytics-month-filter').value = '';
    document.getElementById('analytics-week-filter').value = '';
    document.getElementById('analytics-week-filter').style.display = 'none';
    this.load();
  },
  async onMonthChange() {
    const month = document.getElementById('analytics-month-filter').value;
    const year = document.getElementById('analytics-year').value;
    const weekSelect = document.getElementById('analytics-week-filter');
    if (month) {
      try {
        const { weeks } = await api(`/analytics/weeks?year=${year}&month=${month}`);
        weekSelect.innerHTML =
          '<option value="">All Weeks</option>' +
          weeks.map((w) => `<option value="${w.week}">${w.label}</option>`).join('');
        weekSelect.style.display = '';
      } catch (e) {
        console.error('Failed to load weeks:', e);
      }
    } else {
      weekSelect.value = '';
      weekSelect.style.display = 'none';
    }
    this.load();
  },
  setType(type) {
    this.currentType = type;
    document
      .querySelectorAll('#page-analytics .period-selector button')
      .forEach((b) => b.classList.remove('active'));
    document.getElementById(`type-${type}`).classList.add('active');
    this.load();
  },
  async load() {
    const year = document.getElementById('analytics-year').value;
    const month = document.getElementById('analytics-month-filter').value;
    const week = document.getElementById('analytics-week-filter').value;
    let url = `/analytics/category-trends?year=${year}&type=${this.currentType}`;
    if (month) url += `&month=${month}`;
    if (week) url += `&week=${week}`;
    const [data, settings] = await Promise.all([api(url), api('/settings')]);
    this.currentCurrency = settings.local_currency || 'EUR';
    this.renderStackedChart(data, { year, month, week });
    this.renderPieChart(data);
    this.renderTopCategories(data);
    this.renderAverages(data);
  },
  currentCurrency: 'EUR',
  renderStackedChart(data, { year, month, week }) {
    const currency = this.currentCurrency;
    const ctx = document.getElementById('analytics-stacked-chart').getContext('2d');
    if (this.chart) this.chart.destroy();
    const cc = chartColors();

    // Determine label density based on view level
    let maxTicks = 12;
    if (week) maxTicks = 7;
    else if (month) maxTicks = 15;
    else maxTicks = 12;

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: data.datasets.map((ds, i) => ({
          label: ds.category,
          data: ds.data,
          backgroundColor: ds.color,
          borderRadius: 2,
          barPercentage: week ? 0.8 : month ? 0.8 : 0.7,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cc.tooltipBg,
            titleColor: cc.tooltipTitle,
            bodyColor: cc.tooltipBody,
            padding: 12,
            cornerRadius: 8,
            filter: (tooltipItem) => tooltipItem.raw > 0,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false, color: cc.grid },
            ticks: {
              color: cc.text,
              maxRotation: 45,
              minRotation: 0,
              maxTicksLimit: maxTicks,
            },
          },
          y: {
            stacked: true,
            grid: { color: cc.grid },
            ticks: {
              color: cc.text,
              callback: (v) => formatCurrency(v, currency),
            },
          },
        },
      },
    });
  },
  renderPieChart(data) {
    const currency = this.currentCurrency;
    const pageAnalytics = document.getElementById('page-analytics');
    if (!pageAnalytics || !pageAnalytics.classList.contains('active')) return;
    const ctx = document.getElementById('analytics-pie-chart').getContext('2d');
    if (this.pieChart) this.pieChart.destroy();
    const cc = chartColors();
    const totalByCat = data.datasets
      .map((ds) => ({
        label: ds.category,
        total: ds.data.reduce((a, b) => a + b, 0),
        color: ds.color,
      }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);

    this.pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: totalByCat.map((c) => c.label),
        datasets: [
          {
            data: totalByCat.map((c) => c.total),
            backgroundColor: totalByCat.map((c) => c.color),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: cc.legend,
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { size: 12 },
            },
          },
          tooltip: {
            backgroundColor: cc.tooltipBg,
            bodyColor: cc.tooltipBody,
            padding: 12,
            callbacks: {
              label: (ctx) => {
                const pct = ((ctx.raw / totalByCat.reduce((a, b) => a + b.total, 0)) * 100).toFixed(
                  1
                );
                return `${ctx.label}: ${formatCurrency(ctx.raw, currency)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  },
  renderTopCategories(data) {
    const currency = this.currentCurrency;
    const pageAnalytics = document.getElementById('page-analytics');
    if (!pageAnalytics || !pageAnalytics.classList.contains('active')) return;
    const totalByCat = data.datasets
      .map((ds) => ({
        name: ds.category,
        total: ds.data.reduce((a, b) => a + b, 0),
        color: ds.color,
      }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const total = totalByCat.reduce((a, b) => a + b.total, 0);
    const el = document.getElementById('analytics-top-categories');
    if (totalByCat.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>No ${this.currentType} data</p></div>`;
      return;
    }
    el.innerHTML = totalByCat
      .map((c) => {
        const pct = ((c.total / total) * 100).toFixed(0);
        return `<div class="analytics-category-item">
        <span class="analytics-category-color" style="background:${c.color}"></span>
        <span class="analytics-category-name">${escapeHtml(c.name)}</span>
        <span class="analytics-category-pct">${pct}%</span>
        <span class="analytics-category-amount">${formatCurrency(c.total, currency)}</span>
      </div>`;
      })
      .join('');
  },
  renderAverages(data) {
    const currency = this.currentCurrency;
    const totalExpenses = data.datasets.reduce(
      (sum, ds) => sum + ds.data.reduce((a, b) => a + b, 0),
      0
    );
    const numDays = data.numDays || data.labels.length;
    const avgDay = numDays > 0 ? totalExpenses / numDays : 0;
    const avgWeek = avgDay * 7;
    const avgMonth = avgDay * 30;

    document.getElementById('avg-day').textContent = formatCurrency(avgDay, currency);
    document.getElementById('avg-week').textContent = formatCurrency(avgWeek, currency);
    document.getElementById('avg-month').textContent = formatCurrency(avgMonth, currency);
  },
  async loadSankey() {
    const year = document.getElementById('analytics-year').value;
    const month = document.getElementById('sankey-month-filter').value;
    if (!month) {
      document.getElementById('sankey-chart-container').style.display = 'none';
      document.getElementById('sankey-empty').style.display = 'block';
      return;
    }
    try {
      const [sankeyData, settings] = await Promise.all([
        api(`/analytics/sankey?year=${year}&month=${month}`),
        api('/settings')
      ]);
      this.currentCurrency = settings.local_currency || 'EUR';
      this.renderSankey(sankeyData);
    } catch (e) {
      console.error('Failed to load sankey data:', e);
    }
  },
  renderSankey(data) {
    const pageAnalytics = document.getElementById('page-analytics');
    if (!pageAnalytics || !pageAnalytics.classList.contains('active')) return;
    const container = document.getElementById('sankey-chart-container');
    const emptyState = document.getElementById('sankey-empty');
    const svg = d3.select('#sankey-chart');
    svg.selectAll('*').remove();

    if (!data.nodes || data.nodes.length === 0) {
      container.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.innerHTML = '<p>No budget data available for this month</p>';
      return;
    }

    container.style.display = 'block';
    emptyState.style.display = 'none';

    const width = container.clientWidth || 800;
    const height = 380;
    svg.attr('width', width).attr('height', height);

    const cc = chartColors();
    const color = d3.scaleOrdinal().domain(['budget', 'actual', 'category', 'savings']).range([cc.budget || '#6366f1', cc.expense || '#ef4444', cc.primary || '#3b82f6', cc.success || '#22c55e']);

    const sankey = d3.sankey().nodeId(d => d.name).nodeWidth(20).nodePadding(12).extent([[20, 20], [width - 20, height - 20]]);

    const graph = sankey({
      nodes: data.nodes.map(d => Object.assign({}, d)),
      links: data.links.map(d => Object.assign({}, d))
    });

    const link = svg.append('g').selectAll('.sankey-link')
      .data(graph.links)
      .join('path')
      .attr('class', 'sankey-link')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke-width', d => Math.max(1, d.width))
      .attr('stroke', d => color(d.source.category || 'link'))
      .attr('stroke-opacity', 0.4)
      .attr('fill', 'none');

    link.append('title').text(d => `${d.source.name} → ${d.target.name}: ${formatCurrency(d.value, this.currentCurrency)}`);

    const node = svg.append('g').selectAll('.sankey-node')
      .data(graph.nodes)
      .join('g')
      .attr('class', 'sankey-node');

    node.append('rect')
      .attr('x', d => d.x0)
      .attr('y', d => d.y0)
      .attr('height', d => Math.max(1, d.y1 - d.y0))
      .attr('width', d => d.x1 - d.x0)
      .attr('fill', d => color(d.category || 'category'))
      .attr('opacity', 0.9);

    node.append('text')
      .attr('x', d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('y', d => (d.y1 + d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
      .attr('fill', cc.text || '#1e293b')
      .attr('font-size', '12px')
      .text(d => `${d.name} (${formatCurrency(d.value || 0, this.currentCurrency)})`);
  },
  populateYears() {
    const select = document.getElementById('analytics-year');
    const sankeyMonth = document.getElementById('sankey-month-filter');
    const currentYear = new Date().getFullYear();
    api('/analytics/distinct-years').then(({ years }) => {
      if (!years || years.length === 0) return;
      const options = years.map(y => `<option value="${y}">${y}</option>`).join('');
      select.innerHTML = options;
      const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
      sankeyMonth.innerHTML = '<option value="">Select Month</option>' +
        monthNames.slice(1).map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${i + 1 === parseInt(currentMonth) ? 'selected' : ''}>${m}</option>`).join('');
    }).catch(e => console.error('Failed to load years:', e));
  }
};
