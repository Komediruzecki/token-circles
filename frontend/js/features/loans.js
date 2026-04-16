// ==================== LOANS ====================
const loans = {
  ratePeriodCount: 0,
  loanCharts: {},
  // Client-side cache for loan calculations
  loanCache: {},
  // Current profile currency
  currentCurrency: 'EUR',

  async load() {
    // Load settings first to get currency
    try {
      const settings = await api('/settings');
      this.currentCurrency = settings.local_currency || 'EUR';
    } catch (e) {
      this.currentCurrency = 'EUR';
    }

    // Save cached loan results before re-rendering so tab switches don't destroy them
    const savedCache = {};
    for (const [id, val] of Object.entries(this.loanCache)) {
      savedCache[id] = { result: val.result, loan: val.loan };
    }

    const loans = await api('/loans');
    const container = document.getElementById('loans-list');
    if (!loans.length) {
      container.innerHTML = `<div class="card"><div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg><p>No loans yet. Create your first loan to see amortization.</p></div></div>`;
      return;
    }

    container.innerHTML = loans
      .map(
        (l) => `<div class="card" style="margin-bottom:16px;" id="loan-card-${l.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <h3 style="font-size:18px;font-weight:700;">${l.name}</h3>
          <p style="font-size:13px;color:var(--text-secondary);">Principal: ${formatCurrency(l.principal, this.currentCurrency)} | ${l.term_months} months</p>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="loans.calculate(${l.id})">Calculate</button>
          <button class="btn btn-ghost btn-sm" onclick="loans.openPrepaymentModal(${l.id})">+ Prepayment</button>
          <button class="btn btn-ghost btn-sm" onclick="loans.editLoan(${l.id})">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="loans.deleteLoan(${l.id})">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
      <div id="loan-details-${l.id}" style="display:none;"></div>
    </div>`
      )
      .join('');

    // Restore any previously cached loan calculations so diagrams and table persist across tab switches
    for (const [id, val] of Object.entries(savedCache)) {
      if (document.getElementById(`loan-details-${id}`)) {
        this.loanCache[id] = val;
        const details = document.getElementById(`loan-details-${id}`);
        details.style.display = 'block';
        this.renderLoanDetails(id, val.result, val.loan);
      }
    }
  },
  openLoanModal(id = null) {
    document.getElementById('loan-id').value = id || '';
    document.getElementById('loan-modal-title').textContent = id ? 'Edit Loan' : 'New Loan';
    this.ratePeriodCount = 0;
    document.getElementById('loan-rate-periods').innerHTML = '';
    if (id) {
      api(`/loans/${id}`).then((l) => {
        if (l && !l.error) {
          document.getElementById('loan-name').value = l.name;
          document.getElementById('loan-principal').value = l.principal;
          document.getElementById('loan-start').value = l.start_date;
          document.getElementById('loan-term').value = l.term_months;
          document.getElementById('loan-rate').value =
            l.interest_rate || l.rate_periods?.[0]?.rate || 5;
          l.rate_periods?.forEach((rp, i) => {
            if (i > 0) this.addRatePeriod();
            const items = document.querySelectorAll('.rate-period-item');
            const item = items[i];
            if (item) {
              item.querySelector('.rp-rate').value = rp.rate;
              item.querySelector('.rp-start').value = rp.start_month;
              item.querySelector('.rp-end').value = rp.end_month || '';
            }
          });
        }
      });
    } else {
      document.getElementById('loan-form').reset();
      document.getElementById('loan-start').value = new Date().toISOString().split('T')[0];
      document.getElementById('loan-term').value = 360;
      document.getElementById('loan-rate').value = 5;
    }
    modal.open('loan-modal');
  },
  addRatePeriod() {
    this.ratePeriodCount++;
    const rpList = document.getElementById('loan-rate-periods');
    const rp = document.createElement('div');
    rp.className = 'rate-period-item';
    rp.innerHTML = `
      <span style="font-size:12px;color:var(--text-secondary);">Rate:</span>
      <input type="number" step="0.001" class="form-control rp-rate" placeholder="5.0" style="width:70px;">
      <span style="font-size:12px;color:var(--text-secondary);">From month:</span>
      <input type="number" class="form-control rp-start" placeholder="1" min="1" style="width:70px;">
      <span style="font-size:12px;color:var(--text-secondary);">To:</span>
      <input type="number" class="form-control rp-end" placeholder="End" style="width:70px;">
      <button class="btn btn-ghost btn-sm" onclick="this.parentElement.remove()">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    `;
    rpList.appendChild(rp);
  },
  async saveLoan() {
    const btn = document.getElementById('loan-save-btn');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    btn.classList.add('loading');
    try {
      const id = document.getElementById('loan-id').value;
      const ratePeriods = [];
      document.querySelectorAll('.rate-period-item').forEach((item) => {
        const rate = parseFloat(item.querySelector('.rp-rate').value);
        const start = parseInt(item.querySelector('.rp-start').value);
        const end = item.querySelector('.rp-end').value
          ? parseInt(item.querySelector('.rp-end').value)
          : null;
        if (rate && start) ratePeriods.push({ rate, start_month: start, end_month: end });
      });
      const data = {
        name: document.getElementById('loan-name').value,
        principal: parseFloat(document.getElementById('loan-principal').value),
        start_date: document.getElementById('loan-start').value,
        term_months: parseInt(document.getElementById('loan-term').value),
        interest_rate: parseFloat(document.getElementById('loan-rate').value),
        rate_periods: ratePeriods,
      };
      if (id) data.id = parseInt(id);
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/loans/${id}` : '/loans';
      const result = await api(url, { method, body: data });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      // Invalidate cache so rate/prepayment changes trigger a fresh calculation
      if (id) {
        delete this.loanCache[parseInt(id)];
      }
      toast(id ? 'Loan updated' : 'Loan created', 'success');
      modal.close('loan-modal');
      this.load();
    } finally {
      btn.textContent = origText;
      btn.classList.remove('loading');
    }
  },
  async editLoan(id) {
    this.openLoanModal(id);
  },
  async deleteLoan(id) {
    if (!confirm('Delete this loan?')) return;
    const result = await api(`/loans/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    // Clean up cached data for this loan
    if (this.loanCache[id]) {
      if (this.loanCharts[id]) {
        Object.values(this.loanCharts[id]).forEach((c) => c.destroy());
        delete this.loanCharts[id];
      }
      delete this.loanCache[id];
    }
    toast('Loan deleted', 'success');
    this.load();
  },
  openPrepaymentModal(loanId, prepaymentId = null) {
    this.prepaymentLoanId = loanId;
    document.getElementById('prepay-loan-id').value = loanId;
    document.getElementById('prepay-id').value = prepaymentId || '';

    if (prepaymentId) {
      // Editing: find the prepayment
      const cached = this.loanCache[loanId];
      if (cached) {
        const p = cached.loan.prepayments?.find((prep) => prep.id === prepaymentId);
        if (p) {
          document.getElementById('prepay-modal-title').textContent = 'Edit Prepayment';
          // Show date picker with the month
          const loanStart = new Date(cached.loan.start_date);
          const prepayDate = new Date(loanStart);
          prepayDate.setMonth(prepayDate.getMonth() + p.month - 1);
          document.getElementById('prepay-date').value = prepayDate.toISOString().split('T')[0];
          document.getElementById('prepay-amount').value = p.amount;
          document.getElementById('prepay-note').value = p.note || '';
        }
      }
    } else {
      // New prepayment
      document.getElementById('prepay-modal-title').textContent = 'Add Prepayment';
      document.getElementById('prepay-date').value = '';
      document.getElementById('prepay-amount').value = '';
      document.getElementById('prepay-note').value = '';
    }
    modal.open('prepay-modal');
    // Update month preview
    this.updatePrepayMonthPreview();
  },
  updatePrepayMonthPreview() {
    const loanId = parseInt(document.getElementById('prepay-loan-id').value);
    const dateStr = document.getElementById('prepay-date').value;
    const preview = document.getElementById('prepay-month-preview');
    if (!loanId || !dateStr || !this.loanCache[loanId]) {
      if (preview) preview.textContent = '';
      return;
    }
    const loanStart = new Date(this.loanCache[loanId].loan.start_date);
    const prepayDate = new Date(dateStr + 'T00:00:00');
    const monthNum =
      (prepayDate.getFullYear() - loanStart.getFullYear()) * 12 +
      (prepayDate.getMonth() - loanStart.getMonth()) +
      1;
    if (preview) preview.textContent = monthNum > 0 ? `Month ${monthNum}` : '';
  },
  async savePrepayment() {
    const loanId = parseInt(document.getElementById('prepay-loan-id').value);
    const prepayId = document.getElementById('prepay-id').value;
    const dateStr = document.getElementById('prepay-date').value;
    const amount = parseFloat(document.getElementById('prepay-amount').value);
    const note = document.getElementById('prepay-note').value;

    if (!dateStr) {
      toast('Please select a date', 'error');
      return;
    }
    if (!amount || amount <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }

    // Convert date to month number
    const loanStart = new Date(this.loanCache[loanId]?.loan.start_date + 'T00:00:00');
    const prepayDate = new Date(dateStr + 'T00:00:00');
    const monthNum =
      (prepayDate.getFullYear() - loanStart.getFullYear()) * 12 +
      (prepayDate.getMonth() - loanStart.getMonth()) +
      1;
    if (monthNum < 1) {
      toast('Prepayment date must be after loan start date', 'error');
      return;
    }

    if (prepayId) {
      // Delete old and create new (PUT not supported, so delete + create)
      const del = await api(`/loans/${loanId}/prepayments/${prepayId}`, { method: 'DELETE' });
      if (del.error) {
        toast(del.error, 'error');
        return;
      }
    }

    const result = await api(`/loans/${loanId}/prepayments`, {
      method: 'POST',
      body: { month: monthNum, amount, note },
    });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(prepayId ? 'Prepayment updated' : 'Prepayment added', 'success');
    modal.close('prepay-modal');
    // Recalculate and cache
    await this.fetchAndRenderLoan(loanId);
  },
  async deletePrepayment(loanId, prepaymentId) {
    if (!confirm('Delete this prepayment?')) return;
    const result = await api(`/loans/${loanId}/prepayments/${prepaymentId}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Prepayment deleted', 'success');
    await this.fetchAndRenderLoan(loanId);
  },
  openRatePeriodModal(loanId, ratePeriodId = null) {
    this.ratePeriodLoanId = loanId;
    document.getElementById('rp-loan-id').value = loanId;
    document.getElementById('rp-id').value = ratePeriodId || '';

    if (ratePeriodId) {
      // Editing: find the rate period
      const cached = this.loanCache[loanId];
      if (cached) {
        const rp = cached.loan.rate_periods?.find((r) => r.id === ratePeriodId);
        if (rp) {
          document.getElementById('rate-period-modal-title').textContent = 'Edit Rate Period';
          document.getElementById('rp-rate').value = rp.rate;
          document.getElementById('rp-start').value = rp.start_month;
          document.getElementById('rp-end').value = rp.end_month || '';
          this.updateRatePeriodPreview();
        }
      }
    } else {
      // New rate period
      document.getElementById('rate-period-modal-title').textContent = 'Add Rate Period';
      document.getElementById('rp-rate').value = '';
      document.getElementById('rp-start').value = '';
      document.getElementById('rp-end').value = '';
    }
    modal.open('rate-period-modal');
  },
  updateRatePeriodPreview() {
    const loanId = parseInt(document.getElementById('rp-loan-id').value);
    const startStr = document.getElementById('rp-start').value;
    const preview = document.getElementById('rp-start-preview');
    if (!loanId || !startStr || !this.loanCache[loanId]) {
      if (preview) preview.textContent = '';
      return;
    }
    const loanStart = new Date(this.loanCache[loanId].loan.start_date);
    const monthNum = parseInt(startStr);
    const rateDate = new Date(loanStart);
    rateDate.setMonth(rateDate.getMonth() + monthNum - 1);
    if (preview)
      preview.textContent = `Starting ${rateDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  },
  async saveRatePeriod() {
    const loanId = parseInt(document.getElementById('rp-loan-id').value);
    const ratePeriodId = document.getElementById('rp-id').value;
    const rate = parseFloat(document.getElementById('rp-rate').value);
    const start_month = parseInt(document.getElementById('rp-start').value);
    const end_month = document.getElementById('rp-end').value
      ? parseInt(document.getElementById('rp-end').value)
      : null;

    if (!rate || !start_month) {
      toast('Please enter rate and start month', 'error');
      return;
    }
    if (end_month && end_month <= start_month) {
      toast('End month must be after start month', 'error');
      return;
    }

    if (ratePeriodId) {
      // Update existing
      const result = await api(`/loans/${loanId}/rates/${ratePeriodId}`, {
        method: 'PUT',
        body: { rate, start_month, end_month },
      });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
    } else {
      // Create new
      const result = await api(`/loans/${loanId}/rates`, {
        method: 'POST',
        body: { rate, start_month, end_month },
      });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
    }
    toast(ratePeriodId ? 'Rate period updated' : 'Rate period added', 'success');
    modal.close('rate-period-modal');
    await this.fetchAndRenderLoan(loanId);
  },
  async deleteRatePeriod(loanId, ratePeriodId) {
    if (!confirm('Delete this rate period?')) return;
    const result = await api(`/loans/${loanId}/rates/${ratePeriodId}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Rate period deleted', 'success');
    await this.fetchAndRenderLoan(loanId);
  },
  async addPrepayment(loanId) {
    // Legacy fallback
    this.openPrepaymentModal(loanId);
  },
  async calculate(loanId, forceRecalc = false) {
    const btn = event?.target?.closest('button');
    const originalText = btn?.textContent;
    if (btn) {
      btn.textContent = 'Loading...';
      btn.disabled = true;
    }

    try {
      // If we have cached results and not forcing recalc, just render
      if (!forceRecalc && this.loanCache[loanId]) {
        const details = document.getElementById(`loan-details-${loanId}`);
        details.style.display = 'block';
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.renderLoanDetails(loanId, this.loanCache[loanId].result, this.loanCache[loanId].loan);
        return;
      }
      await this.fetchAndRenderLoan(loanId);
    } finally {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  },
  async fetchAndRenderLoan(loanId) {
    const [result, loan] = await Promise.all([
      api(`/loans/${loanId}/calculate`, { method: 'POST' }),
      api(`/loans/${loanId}`),
    ]);
    if (result.error) {
      toast(result.error, 'error');
      return;
    }

    // Cache the results
    this.loanCache[loanId] = { result, loan };

    const details = document.getElementById(`loan-details-${loanId}`);
    details.style.display = 'block';
    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    this.renderLoanDetails(loanId, result, loan);
  },
  renderLoanDetails(loanId, result, loan) {
    const details = document.getElementById(`loan-details-${loanId}`);
    const currency = this.currentCurrency;

    // Destroy existing charts for this loan
    if (this.loanCharts[loanId]) {
      Object.values(this.loanCharts[loanId]).forEach((c) => c.destroy());
    }
    if (!this.loanCharts[loanId]) this.loanCharts[loanId] = {};

    const s = result.summary;

    details.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="btn btn-secondary btn-sm" onclick="loans.calculate(${loanId}, true)" title="Recalculate with current loan data">Recalculate</button>
      </div>
      <div class="loan-summary-grid">
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Total Paid</div>
          <div class="loan-summary-stat-value">${formatCurrency(s.totalPaid, currency)}</div>
        </div>
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Total Interest</div>
          <div class="loan-summary-stat-value">${formatCurrency(s.totalInterest, currency)}</div>
        </div>
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Payoff Date</div>
          <div class="loan-summary-stat-value highlight">${s.payoffDate || '-'}</div>
        </div>
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Interest Saved</div>
          <div class="loan-summary-stat-value saved">${formatCurrency(s.interestSaved, currency)}</div>
        </div>
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Months Saved</div>
          <div class="loan-summary-stat-value saved">${s.monthsSaved > 0 ? s.monthsSaved + ' months' : '-'}</div>
        </div>
        <div class="loan-summary-stat">
          <div class="loan-summary-stat-label">Monthly Payment</div>
          <div class="loan-summary-stat-value">${formatCurrency(s.avgMonthlyPayment, currency)}</div>
        </div>
      </div>

      ${
        loan.prepayments?.length
          ? `<div style="margin-bottom:16px;">
        <div class="card-title" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
          <span>Prepayments</span>
          <button class="btn btn-ghost btn-sm" onclick="loans.openPrepaymentModal(${loanId})">+ Add</button>
        </div>
        ${loan.prepayments
          .map((p) => {
            const loanStart = new Date(loan.start_date);
            const prepayDate = new Date(loanStart);
            prepayDate.setMonth(prepayDate.getMonth() + p.month - 1);
            return `<div class="prepayment-item" style="display:flex;align-items:center;gap:8px;">
            <span class="month">${formatDate(prepayDate.toISOString().split('T')[0])}</span>
            <span class="amount">+${formatCurrency(p.amount, currency)}</span>
            ${p.note ? `<span style="color:var(--text-secondary);font-size:11px;">${p.note}</span>` : ''}
            <div style="margin-left:auto;display:flex;gap:4px;">
              <button class="btn btn-ghost btn-sm" onclick="loans.openPrepaymentModal(${loanId}, ${p.id})" title="Edit">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm" onclick="loans.deletePrepayment(${loanId}, ${p.id})" title="Delete">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>`;
          })
          .join('')}
      </div>`
          : `<div style="margin-bottom:16px;">
        <button class="btn btn-secondary btn-sm" onclick="loans.openPrepaymentModal(${loanId})">+ Add Prepayment</button>
      </div>`
      }

      ${
        loan.rate_periods?.length
          ? `<div style="margin-bottom:16px;">
        <div class="card-title" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
          <span>Rate Periods</span>
          <button class="btn btn-ghost btn-sm" onclick="loans.openRatePeriodModal(${loanId})">+ Add</button>
        </div>
        ${loan.rate_periods
          .map((rp) => {
            const loanStart = new Date(loan.start_date);
            const rateDate = new Date(loanStart);
            rateDate.setMonth(rateDate.getMonth() + rp.start_month - 1);
            return `<div class="prepayment-item" style="display:flex;align-items:center;gap:8px;">
            <span class="month">${formatDate(rateDate.toISOString().split('T')[0])}</span>
            <span style="color:var(--text-secondary);font-size:11px;">(${rp.start_month}${rp.end_month ? ' - ' + rp.end_month : '+'} mo)</span>
            <span class="amount">${rp.rate}%</span>
            <div style="margin-left:auto;display:flex;gap:4px;">
              <button class="btn btn-ghost btn-sm" onclick="loans.openRatePeriodModal(${loanId}, ${rp.id})" title="Edit">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm" onclick="loans.deleteRatePeriod(${loanId}, ${rp.id})" title="Delete">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>`;
          })
          .join('')}
      </div>`
          : ''
      }

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div><canvas id="loan-chart-principal-${loanId}" style="height:220px;"></canvas></div>
        <div><canvas id="loan-chart-balance-${loanId}" style="height:220px;"></canvas></div>
      </div>

      <div class="card-title" style="margin-bottom:8px;">Amortization Schedule</div>
      <div class="amort-table">
        <table>
          <thead><tr>
            <th>#</th><th>Date</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th><th>Rate</th><th>Prepay</th><th>Note</th>
          </tr></thead>
          <tbody>
          ${result.schedule
            .map((row, idx) => {
              const prev = idx > 0 ? result.schedule[idx - 1] : null;
              const rateChanged = prev && prev.rate !== row.rate;
              const hasPrepayment = row.prepayment > 0;
              const rowClass = hasPrepayment
                ? 'prepayment-row'
                : rateChanged
                  ? 'rate-change-row'
                  : '';
              const note = hasPrepayment ? 'Prepayment' : rateChanged ? `Rate: ${row.rate}%` : '';
              return `<tr class="${rowClass}">
              <td>${row.month}</td>
              <td>${row.date}</td>
              <td class="td-amount">${formatCurrency(row.payment, currency)}</td>
              <td class="td-amount income">${formatCurrency(row.principal, currency)}</td>
              <td class="td-amount expense">${formatCurrency(row.interest, currency)}</td>
              <td style="font-weight:600;">${formatCurrency(row.balance, currency)}</td>
              <td>${row.rate.toFixed(3)}%</td>
              <td>${row.prepayment > 0 ? `<span style="color:var(--success);font-weight:600;">${formatCurrency(row.prepayment, currency)}</span>` : '-'}</td>
              <td>${note ? `<span style="font-size:11px;color:var(--warning);font-weight:600;">${note}</span>` : ''}</td>
            </tr>`;
            })
            .join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-secondary);display:flex;gap:16px;">
        <span><span style="background:rgba(245,158,11,.15);padding:2px 6px;border-radius:4px;margin-right:4px;">&nbsp;</span> Rate Change</span>
        <span><span style="background:rgba(16,185,129,.15);padding:2px 6px;border-radius:4px;margin-right:4px;">&nbsp;</span> Prepayment</span>
      </div>
    `;

    // Principal vs Interest stacked bar
    const prinCtx = document.getElementById(`loan-chart-principal-${loanId}`).getContext('2d');
    const cc = chartColors();
    this.loanCharts[loanId].principal = new Chart(prinCtx, {
      type: 'bar',
      data: {
        labels: result.schedule
          .filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
          .map((r) => r.month),
        datasets: [
          {
            label: 'Principal',
            data: result.schedule
              .filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
              .map((r) => r.principal),
            backgroundColor: cc.income,
            borderRadius: 2,
          },
          {
            label: 'Interest',
            data: result.schedule
              .filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
              .map((r) => r.interest),
            backgroundColor: cc.expense,
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        stacked: true,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 }, color: cc.legend },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.raw, currency)}`,
            },
          },
        },
        scales: {
          y: {
            stacked: true,
            ticks: { callback: (v) => formatCurrency(v, currency) },
            grid: { color: cc.grid },
            ticks: { color: cc.text },
          },
          x: { grid: { color: cc.grid }, ticks: { color: cc.text } },
        },
      },
    });

    // Balance over time
    const balCtx = document.getElementById(`loan-chart-balance-${loanId}`).getContext('2d');
    this.loanCharts[loanId].balance = new Chart(balCtx, {
      type: 'line',
      data: {
        labels: result.schedule
          .filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
          .map((r) => r.month),
        datasets: [
          {
            label: 'Remaining Balance',
            data: result.schedule
              .filter((_, i) => i % Math.ceil(result.schedule.length / 24) === 0)
              .map((r) => r.balance),
            borderColor: cc.primary,
            backgroundColor: cc.primaryBg,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
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
  },
};
