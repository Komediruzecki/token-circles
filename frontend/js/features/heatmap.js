// ==================== HEATMAP ====================
const heatmap = {
  currentCurrency: 'EUR',

  init() {
    this.populateYearSelect();
  },

  async populateYearSelect() {
    const select = document.getElementById('heatmap-year-select');
    if (!select) return;
    try {
      const { years } = await api('/analytics/distinct-years');
      if (!years || years.length === 0) {
        select.innerHTML = '<option value="">-</option>';
        return;
      }
      select.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
      this.loadHeatmap();
    } catch (e) {
      console.error('Failed to load heatmap years:', e);
    }
  },

  async loadHeatmap() {
    const year = document.getElementById('heatmap-year-select')?.value;
    const type = document.getElementById('heatmap-type-select')?.value || 'expense';
    if (!year) return;

    try {
      const [data, settings] = await Promise.all([
        api(`/analytics/daily-heatmap?year=${year}&type=${type}`),
        api('/settings'),
      ]);
      this.currentCurrency = (settings && settings.local_currency) || 'EUR';
      this.renderHeatmap(data);
    } catch (e) {
      console.error('Failed to load heatmap data:', e);
      this.renderEmpty();
    }
  },

  renderEmpty() {
    const svg = d3.select('#heatmap-svg');
    svg.selectAll('*').remove();
    const container = document.getElementById('heatmap-container');
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.cssText = 'padding:40px;text-align:center;';
    empty.innerHTML = '<p>No data available for heatmap</p>';
    const existingEmpty = container.querySelector('.empty-state');
    if (!existingEmpty) container.appendChild(empty);
  },

  renderHeatmap(data) {
    const pageAnalytics = document.getElementById('page-analytics');
    if (!pageAnalytics || !pageAnalytics.classList.contains('active')) return;

    const container = document.getElementById('heatmap-container');
    const existingEmpty = container.querySelector('.empty-state');
    if (existingEmpty) existingEmpty.remove();

    const svg = d3.select('#heatmap-svg');
    svg.selectAll('*').remove();

    const cellSize = 14;
    const cellGap = 3;
    const step = cellSize + cellGap;
    const dayLabelWidth = 30;
    const monthLabelHeight = 20;

    const dataMap = new Map();
    let maxAmount = 0;
    if (data && data.dates) {
      Object.entries(data.dates).forEach(([date, amount]) => {
        dataMap.set(date, amount);
        if (amount > maxAmount) maxAmount = amount;
      });
    }

    const year = parseInt(document.getElementById('heatmap-year-select')?.value);
    if (!year) return;

    const weeks = [];
    const jan1 = new Date(year, 0, 1);
    let startDate = new Date(jan1);
    const dow = jan1.getDay();
    const daysToMon = dow === 0 ? -6 : 1 - dow;
    startDate.setDate(jan1.getDate() + daysToMon);

    for (let w = 0; w < 53; w++) {
      const weekDays = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const dateStr = this.formatDateStr(date);
        const inYear = date.getFullYear() === year;
        weekDays.push({
          date: date,
          dateStr: dateStr,
          amount: inYear ? (dataMap.get(dateStr) || 0) : null,
          inYear: inYear,
        });
      }
      weeks.push(weekDays);
    }

    const numWeeks = weeks.length;
    const svgWidth = Math.max(800, dayLabelWidth + numWeeks * step);
    const svgHeight = 7 * step + monthLabelHeight + 10;

    svg.attr('width', svgWidth).attr('height', svgHeight);

    const tooltip = document.getElementById('heatmap-tooltip');
    const cc = chartColors();

    const type = document.getElementById('heatmap-type-select')?.value || 'expense';
    const noDataColor = cc.expenseBg || 'rgba(239,68,68,.12)';
    const colors = ['#c6e48b', '#7bc96f', '#239a3b', '#196127'];
    if (type === 'income') {
      colors[0] = '#bbf7d0';
      colors[1] = '#4ade80';
      colors[2] = '#16a34a';
      colors[3] = '#14532d';
    }

    const colorScale = maxAmount > 0
      ? d3.scaleQuantize().domain([0, maxAmount]).range([...colors])
      : () => noDataColor;

    const g = svg.append('g').attr('transform', `translate(${dayLabelWidth}, ${monthLabelHeight})`);

    weeks.forEach((week, wi) => {
      week.forEach((day, di) => {
        if (!day.inYear) return;

        const x = wi * step;
        const y = di * step;
        const fill = day.amount > 0 ? colorScale(day.amount) : noDataColor;

        g.append('rect')
          .attr('class', 'heatmap-cell')
          .attr('x', x)
          .attr('y', y)
          .attr('width', cellSize)
          .attr('height', cellSize)
          .attr('rx', 2)
          .attr('fill', fill)
          .attr('data-date', day.dateStr)
          .attr('data-amount', day.amount)
          .on('mouseover', (event) => {
            const formatted = formatCurrency(day.amount, this.currentCurrency);
            const label = day.amount > 0
              ? `${formatDate(day.dateStr)}: ${formatted} ${type}`
              : `${formatDate(day.dateStr)}: No ${type}`;
            tooltip.innerHTML = label;
            tooltip.style.display = 'block';
            tooltip.style.left = (event.pageX + 12) + 'px';
            tooltip.style.top = (event.pageY - 40) + 'px';
          })
          .on('mousemove', (event) => {
            tooltip.style.left = (event.pageX + 12) + 'px';
            tooltip.style.top = (event.pageY - 40) + 'px';
          })
          .on('mouseout', () => {
            tooltip.style.display = 'none';
          })
          .on('click', () => {
            this.showDayDetails(day.dateStr, day.amount, type);
          });
      });
    });

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
    svg.append('g')
      .selectAll('text')
      .data(dayLabels)
      .join('text')
      .attr('class', 'heatmap-day-label')
      .attr('x', dayLabelWidth - 6)
      .attr('y', (d, i) => monthLabelHeight + i * step + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('font-size', '10px')
      .attr('fill', cc.text)
      .text((d) => d);

    const months = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const firstDayOfWeek = week.find((d) => d.inYear);
      if (firstDayOfWeek) {
        const month = firstDayOfWeek.date.getMonth();
        if (month !== lastMonth) {
          months.push({
            label: firstDayOfWeek.date.toLocaleDateString('en-US', { month: 'short' }),
            x: wi * step,
          });
          lastMonth = month;
        }
      }
    });

    svg.append('g')
      .selectAll('text')
      .data(months)
      .join('text')
      .attr('class', 'heatmap-month-label')
      .attr('x', (d) => d.x)
      .attr('y', monthLabelHeight - 4)
      .attr('font-size', '11px')
      .attr('fill', cc.text)
      .text((d) => d.label);

    this.renderLegend(colors, noDataColor);
  },

  renderLegend(colors, noDataColor) {
    const legend = document.querySelector('.heatmap-scale');
    if (!legend) return;
    const levels = [noDataColor, ...colors];
    legend.innerHTML = levels
      .map((c) => `<span style="background:${c};"></span>`)
      .join('');
  },

  formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  async showDayDetails(dateStr, amount, type) {
    try {
      const txns = await api(`/transactions?startDate=${dateStr}&endDate=${dateStr}&type=${type}&limit=20`);
      const list = Array.isArray(txns?.transactions) ? txns.transactions : (Array.isArray(txns?.rows) ? txns.rows : []);

      let html = `
        <div style="min-width:280px;">
          <div style="font-weight:600;font-size:14px;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px;">
            ${formatDate(dateStr)} &mdash; ${formatCurrency(amount, this.currentCurrency)}
          </div>`;

      if (list.length === 0) {
        html += `<p style="color:var(--text-secondary);font-size:13px;">No ${type} transactions</p>`;
      } else {
        html += `<div style="max-height:200px;overflow-y:auto;">`;
        list.slice(0, 10).forEach((tx) => {
          const sign = tx.type === 'income' ? '+' : '-';
          const color = tx.type === 'income' ? 'var(--income)' : 'var(--expense)';
          html += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
              <span style="color:var(--text);">${escapeHtml(tx.description || tx.category || '-')}</span>
              <span style="font-weight:600;color:${color};">${sign}${formatCurrency(Math.abs(tx.amount || 0), this.currentCurrency)}</span>
            </div>`;
        });
        if (list.length > 10) {
          html += `<div style="padding:5px 0;font-size:12px;color:var(--text-secondary);">+${list.length - 10} more</div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;

      this.showPopup(html);
    } catch (e) {
      console.error('Failed to load day details:', e);
    }
  },

  showPopup(html) {
    const existing = document.getElementById('heatmap-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'heatmap-popup';
    popup.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: var(--shadow-lg);
      z-index: 9999;
      min-width: 300px;
      max-width: 400px;
    `;
    popup.innerHTML = html;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'margin-top:12px;width:100%;padding:8px;background:var(--btn-secondary-bg);color:var(--btn-secondary-color);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;';
    closeBtn.onclick = () => popup.remove();
    popup.appendChild(closeBtn);

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:9998;';
    backdrop.onclick = () => {
      popup.remove();
      backdrop.remove();
    };

    document.body.appendChild(backdrop);
    document.body.appendChild(popup);
  }
};