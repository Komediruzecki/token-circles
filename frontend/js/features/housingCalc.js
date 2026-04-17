// ==================== HOUSING CALCULATOR ====================
const housingCalc = {
  chart: null,
  _debounceTimer: null,

  scheduleUpdate() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.calculate(), 400);
  },

  init() {
    // Set up input listeners
    const inputs = document.querySelectorAll('#housing-calc-form input, #housing-calc-form select');
    inputs.forEach(input => {
      input.addEventListener('input', () => this.scheduleUpdate());
    });

    // Set defaults
    this.setDefaults();
  },

  setDefaults() {
    // Rent defaults
    const rentInputs = {
      'h-rent-monthly': 1200,
      'h-rent-increase': 3,
      'h-invest-return': 7
    };

    // Buy defaults
    const buyInputs = {
      'h-buy-price': 300000,
      'h-buy-downpayment': 60000,
      'h-buy-term': 30,
      'h-buy-rate': 4,
      'h-buy-tax': 3000,
      'h-buy-insurance': 1200,
      'h-buy-maintenance': 1,
      'h-buy-hoa': 200
    };

    // Apply defaults if empty
    Object.entries(rentInputs).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = value;
    });

    Object.entries(buyInputs).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el && !el.value) el.value = value;
    });
  },

  calculate() {
    // Get rent inputs
    const rentMonthly = parseFloat(document.getElementById('h-rent-monthly').value) || 0;
    const rentIncrease = (parseFloat(document.getElementById('h-rent-increase').value) || 0) / 100;
    const investReturn = (parseFloat(document.getElementById('h-invest-return').value) || 7) / 100;

    // Get buy inputs
    const homePrice = parseFloat(document.getElementById('h-buy-price').value) || 0;
    const downPayment = parseFloat(document.getElementById('h-buy-downpayment').value) || 0;
    const loanTerm = parseInt(document.getElementById('h-buy-term').value) || 30;
    const interestRate = (parseFloat(document.getElementById('h-buy-rate').value) || 0) / 100;
    const propertyTax = parseFloat(document.getElementById('h-buy-tax').value) || 0;
    const insurance = parseFloat(document.getElementById('h-buy-insurance').value) || 0;
    const maintenancePct = (parseFloat(document.getElementById('h-buy-maintenance').value) || 0) / 100;
    const hoa = parseFloat(document.getElementById('h-buy-hoa').value) || 0;

    const years = 30;
    const results = [];

    // Monthly interest rate
    const monthlyRate = interestRate / 12;
    const totalMonths = loanTerm * 12;

    // Calculate monthly mortgage payment using amortization formula
    let monthlyPayment = 0;
    if (monthlyRate > 0 && totalMonths > 0) {
      monthlyPayment = homePrice * downPayment === homePrice ? 0 :
        (homePrice - downPayment) * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) /
        (Math.pow(1 + monthlyRate, totalMonths) - 1);
    } else if (totalMonths > 0) {
      monthlyPayment = (homePrice - downPayment) / totalMonths;
    }

    // Track cumulative values
    let cumulativeRent = 0;
    let cumulativeBuyCost = 0;
    let investmentBalance = downPayment; // What down payment could be worth if invested
    let cumulativePrincipal = downPayment; // Home equity starts with down payment
    let cumulativeInterest = 0;

    // Monthly breakdown for first few years
    let monthlyInterestRemaining = homePrice - downPayment;
    let principalBalance = homePrice - downPayment;

    for (let year = 1; year <= years; year++) {
      const yearRent = rentMonthly * 12 * Math.pow(1 + rentIncrease, year - 1);

      // Calculate mortgage details for this year
      let yearPrincipal = 0;
      let yearInterest = 0;
      let yearTax = propertyTax;
      let yearInsurance = insurance;
      let yearMaintenance = homePrice * maintenancePct;
      let yearHOA = hoa * 12;

      // Calculate mortgage principal/interest for each month of this year
      for (let month = 1; month <= 12; month++) {
        if (principalBalance > 0) {
          const interestPayment = principalBalance * monthlyRate;
          const principalPayment = Math.min(monthlyPayment - interestPayment, principalBalance);
          yearInterest += interestPayment;
          yearPrincipal += principalPayment;
          principalBalance -= principalPayment;
        }
      }

      // Add to cumulative
      cumulativeRent += yearRent;
      cumulativeBuyCost += monthlyPayment * 12 + yearTax + yearInsurance + yearMaintenance + yearHOA;
      cumulativePrincipal += yearPrincipal;
      cumulativeInterest += yearInterest;

      // Investment growth (what down payment could earn)
      investmentBalance *= (1 + investReturn);

      // Net worth calculation
      const rentNetWorth = investmentBalance - cumulativeRent;
      const buyNetWorth = cumulativePrincipal - (cumulativeBuyCost - cumulativePrincipal);
      // = down_payment + equity - total_costs_of_ownership + appreciation potential
      // Simplified: equity - (interest paid + taxes + insurance + maintenance + HOA - principal paid)
      // Actually simpler: equity_value - (total_paid - equity_built) = equity - net_cost
      // Net cost of buying = total_paid - equity = interest + taxes + insurance + maintenance + HOA
      const buyNetCost = cumulativeBuyCost - cumulativePrincipal; // What you've lost/costs
      const buyNetValue = cumulativePrincipal - buyNetCost; // equity minus costs = true net position

      results.push({
        year,
        rentCumulative: cumulativeRent,
        buyCumulative: cumulativeBuyCost,
        rentInvestmentValue: investmentBalance,
        buyEquity: cumulativePrincipal,
        rentNetWorth: investmentBalance - cumulativeRent,
        buyNetWorth: cumulativePrincipal - cumulativeBuyCost + cumulativePrincipal,
        rentNetCost: cumulativeRent,
        buyNetCost: cumulativeBuyCost - cumulativePrincipal
      });
    }

    // Find break-even year
    let breakEvenYear = null;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      // Break-even when: buy net cost < rent net cost + foregone investment
      // buy_cost - equity < rent_paid - investment_growth
      // This means buying is better when equity gains exceed the extra costs of owning
      if (r.buyNetCost <= r.rentNetCost) {
        breakEvenYear = r.year;
        break;
      }
    }

    this.renderResults(results, breakEvenYear, {
      rentMonthly,
      rentIncrease: rentIncrease * 100,
      homePrice,
      downPayment,
      monthlyPayment,
      totalInterest: cumulativeInterest,
      totalCosts: cumulativeBuyCost
    });
  },

  renderResults(results, breakEvenYear, summary) {
    const container = document.getElementById('housing-results');
    if (!container) return;

    container.style.display = 'block';

    const currency = settings.local_currency || 'EUR';
    const cc = chartColors();

    // Summary cards
    const lastResult = results[results.length - 1];

    // Build summary HTML
    let html = `
      <div class="housing-summary-grid">
        <div class="housing-summary-card rent">
          <div class="housing-summary-title">Rent Scenario (30 years)</div>
          <div class="housing-summary-row">
            <span>Total Rent Paid</span>
            <span class="value">${formatCurrency(lastResult.rentCumulative, currency)}</span>
          </div>
          <div class="housing-summary-row">
            <span>Investment Value</span>
            <span class="value">${formatCurrency(lastResult.rentInvestmentValue, currency)}</span>
          </div>
          <div class="housing-summary-row highlight">
            <span>Net Cost</span>
            <span class="value">${formatCurrency(lastResult.rentNetCost, currency)}</span>
          </div>
        </div>
        <div class="housing-summary-card buy">
          <div class="housing-summary-title">Buy Scenario (30 years)</div>
          <div class="housing-summary-row">
            <span>Total Mortgage + Costs</span>
            <span class="value">${formatCurrency(lastResult.buyCumulative, currency)}</span>
          </div>
          <div class="housing-summary-row">
            <span>Home Equity</span>
            <span class="value">${formatCurrency(lastResult.buyEquity, currency)}</span>
          </div>
          <div class="housing-summary-row highlight">
            <span>Net Cost</span>
            <span class="value">${formatCurrency(lastResult.buyNetCost, currency)}</span>
          </div>
        </div>
        <div class="housing-summary-card verdict">
          <div class="housing-summary-title">Comparison</div>
          <div class="housing-summary-row">
            <span>Winner</span>
            <span class="value ${lastResult.buyNetCost < lastResult.rentNetCost ? 'success' : 'warning'}">${
              lastResult.buyNetCost < lastResult.rentNetCost ? 'Buying' : 'Renting'
            }</span>
          </div>
          <div class="housing-summary-row">
            <span>Savings</span>
            <span class="value">${formatCurrency(Math.abs(lastResult.buyNetCost - lastResult.rentNetCost), currency)}</span>
          </div>
          <div class="housing-summary-row highlight">
            <span>Break-even</span>
            <span class="value">${breakEvenYear ? `Year ${breakEvenYear}` : 'Not reached'}</span>
          </div>
        </div>
      </div>
    `;

    // Comparison table
    const yearsToShow = [1, 5, 10, 15, 20, 25, 30];
    html += `
      <div class="housing-comparison-table-wrap">
        <table class="housing-comparison-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Cumulative Rent</th>
              <th>Investment Value</th>
              <th>Rent Net Cost</th>
              <th>Cumulative Buy Cost</th>
              <th>Home Equity</th>
              <th>Buy Net Cost</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            ${yearsToShow.map(y => {
              const r = results[y - 1];
              if (!r) return '';
              const diff = r.buyNetCost - r.rentNetCost;
              return `
                <tr>
                  <td>${r.year}</td>
                  <td>${formatCurrency(r.rentCumulative, currency)}</td>
                  <td>${formatCurrency(r.rentInvestmentValue, currency)}</td>
                  <td>${formatCurrency(r.rentNetCost, currency)}</td>
                  <td>${formatCurrency(r.buyCumulative, currency)}</td>
                  <td>${formatCurrency(r.buyEquity, currency)}</td>
                  <td>${formatCurrency(r.buyNetCost, currency)}</td>
                  <td class="${diff > 0 ? 'negative' : 'positive'}">${formatCurrency(Math.abs(diff), currency)} ${diff > 0 ? 'more for buy' : 'more for rent'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Break-even message
    if (breakEvenYear) {
      html += `
        <div class="housing-breakeven">
          <div class="breakeven-icon">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div class="breakeven-text">
            <strong>After ${breakEvenYear} years, buying becomes cheaper than renting.</strong>
            <p>At this point, your home equity exceeds the cumulative cost advantage of renting plus investment returns.</p>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="housing-breakeven neutral">
          <div class="breakeven-icon">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div class="breakeven-text">
            <strong>Buying does not become cheaper than renting within 30 years.</strong>
            <p>Consider factors like location, lifestyle, job stability, and market conditions when making your decision.</p>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Render chart
    this.renderChart(results, currency, cc);
  },

  renderChart(results, currency, cc) {
    const ctx = document.getElementById('housing-chart');
    if (!ctx) return;

    if (this.chart) this.chart.destroy();

    const labels = results.map(r => `Year ${r.year}`);
    const rentNetCost = results.map(r => r.rentNetCost);
    const buyNetCost = results.map(r => r.buyNetCost);

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Renting Net Cost',
            data: rentNetCost,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
          },
          {
            label: 'Buying Net Cost',
            data: buyNetCost,
            borderColor: cc.primary,
            backgroundColor: cc.primaryBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
          }
        ]
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
            ticks: { callback: v => formatCurrency(v, currency), color: cc.text },
            grid: { color: cc.grid },
            title: { display: true, text: 'Net Cost (lower is better)', color: cc.text }
          },
          x: {
            ticks: { color: cc.text, maxTicksLimit: 10 },
            grid: { color: cc.grid },
          },
        },
      },
    });
  },

  exportChart() {
    const canvas = document.getElementById('housing-chart');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'housing-comparison.png';
    a.click();
  }
};
window.housingCalc = housingCalc;