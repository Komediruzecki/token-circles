// ==================== TRANSACTION FILTERS ====================
const txFilters = {
  currentPreset: 'month',
  selectedCategories: [],

  async init() {
    // Populate year dropdown from distinct-years API
    const yearSelect = document.getElementById('tx-year-filter');
    if (!yearSelect) return;
    try {
      const { years } = await api('/analytics/distinct-years');
      // Clear then append in same synchronous block to prevent race condition
      // where two init() calls could cause duplicates
      yearSelect.innerHTML = '';
      const currentYear = new Date().getFullYear();
      if (years && years.length > 0) {
        years.forEach((y) => {
          const opt = document.createElement('option');
          opt.value = y;
          opt.textContent = y;
          yearSelect.appendChild(opt);
        });
      } else {
        yearSelect.innerHTML = `<option value="${currentYear}">${currentYear}</option>`;
      }
    } catch (e) {
      yearSelect.innerHTML = '';
    }
    this.setPreset('month');
    this.loadCategories(); // Load categories for multi-select filter
  },

  initMultiSelect() {
    const container = document.getElementById('tx-cat-filter-container');
    if (!container) return;

    const cats = window.allCategories || [];
    container.innerHTML = `
      <div class="tx-cat-filter" id="tx-cat-filter">
        <div class="tx-cat-filter-display" onclick="txFilters.toggleMultiSelect()">
          <span id="tx-cat-filter-label">All Categories</span>
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
        </div>
        <div class="tx-cat-filter-dropdown" id="tx-cat-filter-dropdown">
          <label class="tx-cat-option">
            <input type="checkbox" id="tx-cat-all" checked onchange="txFilters.toggleAllCategories()">
            <span>All Categories</span>
          </label>
          ${cats.map((c) => `
            <label class="tx-cat-option">
              <input type="checkbox" class="tx-cat-checkbox" value="${c.id}" onchange="txFilters.onCategoryChange()">
              <span class="cat-dot" style="background:${c.color || '#6b7280'}"></span>
              <span>${escapeHtml(c.name)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const filter = document.getElementById('tx-cat-filter');
      if (filter && !filter.contains(e.target)) {
        filter.classList.remove('open');
      }
    });
  },

  toggleMultiSelect() {
    const filter = document.getElementById('tx-cat-filter');
    if (filter) filter.classList.toggle('open');
  },

  toggleAllCategories() {
    const allCheckbox = document.getElementById('tx-cat-all');
    const checkboxes = document.querySelectorAll('.tx-cat-checkbox');
    checkboxes.forEach((cb) => { cb.checked = allCheckbox.checked; });
    // If "All" is checked, use empty array (show all). If unchecked, use empty to show all as fallback.
    // The key is we don't toggle between empty and specific - either all or nothing based on checkbox state
    if (allCheckbox.checked) {
      this.selectedCategories = [];
    } else {
      // When unchecking "All", check if any individual are checked
      const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
      if (anyChecked) {
        this.selectedCategories = Array.from(checkboxes).filter(cb => cb.checked).map(cb => parseInt(cb.value));
      } else {
        // No individual selected - check "All" back on as fallback (show all)
        allCheckbox.checked = true;
        this.selectedCategories = [];
      }
    }
    this.updateLabel();
    if (typeof transactions !== 'undefined') transactions.load();
  },

  onCategoryChange() {
    const allCheckbox = document.getElementById('tx-cat-all');
    const checkboxes = document.querySelectorAll('.tx-cat-checkbox:checked');
    this.selectedCategories = Array.from(checkboxes).map((cb) => parseInt(cb.value));
    // "All" checkbox is checked only when no specific categories are selected
    allCheckbox.checked = this.selectedCategories.length === 0;
    this.updateLabel();
    if (typeof transactions !== 'undefined') transactions.load();
  },

  updateLabel() {
    const label = document.getElementById('tx-cat-filter-label');
    if (!label) return;
    if (this.selectedCategories.length === 0) {
      label.textContent = 'All Categories';
    } else {
      label.textContent = `${this.selectedCategories.length} Selected`;
    }
  },

  async loadCategories() {
    const res = await api('/categories');
    // API returns { rows, total } - extract the array
    window.allCategories = (res && res.rows) ? res.rows : (Array.isArray(res) ? res : []);
    this.initMultiSelect();
  },

  setPreset(preset) {
    this.currentPreset = preset;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Update active button
    document
      .querySelectorAll('#page-transactions .period-selector button')
      .forEach((b) => b.classList.remove('active'));
    const btn = document.getElementById(`tx-preset-${preset}`);
    if (btn) btn.classList.add('active');

    const fromInput = document.getElementById('tx-date-from');
    const toInput = document.getElementById('tx-date-to');
    const yearSelect = document.getElementById('tx-year-filter');
    const monthSelect = document.getElementById('tx-month-filter');

    if (preset === 'month') {
      // Current month
      fromInput.value = `${year}-${month}-01`;
      const nextMonth = new Date(year, parseInt(month), 1);
      const lastDay = new Date(nextMonth.getTime() - 86400000).getDate();
      toInput.value = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      yearSelect.value = year;
      monthSelect.value = month;
    } else if (preset === 'last-month') {
      // Last month
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lmYear = lastMonthDate.getFullYear();
      const lmMonth = String(lastMonthDate.getMonth() + 1).padStart(2, '0');
      fromInput.value = `${lmYear}-${lmMonth}-01`;
      const nextMonth = new Date(lmYear, parseInt(lmMonth), 1);
      const lastDay = new Date(nextMonth.getTime() - 86400000).getDate();
      toInput.value = `${lmYear}-${lmMonth}-${String(lastDay).padStart(2, '0')}`;
      yearSelect.value = lmYear;
      monthSelect.value = lmMonth;
    } else if (preset === 'year') {
      // Current year
      fromInput.value = `${year}-01-01`;
      toInput.value = `${year}-12-31`;
      yearSelect.value = year;
      monthSelect.value = '';
    } else {
      // Custom - clear year/month but keep dates
      yearSelect.value = '';
      monthSelect.value = '';
    }
    if (typeof transactions !== 'undefined') transactions.load();
  },

  onYearChange() {
    const year = document.getElementById('tx-year-filter').value;
    const month = document.getElementById('tx-month-filter').value;
    const fromInput = document.getElementById('tx-date-from');
    const toInput = document.getElementById('tx-date-to');

    if (year && month) {
      fromInput.value = `${year}-${month}-01`;
      const nextMonth = new Date(year, parseInt(month), 1);
      const lastDay = new Date(nextMonth.getTime() - 86400000).getDate();
      toInput.value = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    } else if (year) {
      fromInput.value = `${year}-01-01`;
      toInput.value = `${year}-12-31`;
    }
    if (typeof transactions !== 'undefined') transactions.load();
  },

  onMonthChange() {
    const year = document.getElementById('tx-year-filter').value;
    const month = document.getElementById('tx-month-filter').value;
    const fromInput = document.getElementById('tx-date-from');
    const toInput = document.getElementById('tx-date-to');

    if (year && month) {
      fromInput.value = `${year}-${month}-01`;
      const nextMonth = new Date(year, parseInt(month), 1);
      const lastDay = new Date(nextMonth.getTime() - 86400000).getDate();
      toInput.value = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    }
    if (typeof transactions !== 'undefined') transactions.load();
  },

  onCustomDateChange() {
    // When user manually changes dates, set preset to custom
    this.currentPreset = 'custom';
    document
      .querySelectorAll('#page-transactions .period-selector button')
      .forEach((b) => b.classList.remove('active'));
    document.getElementById('tx-preset-custom').classList.add('active');
    if (typeof transactions !== 'undefined') transactions.load();
  },
};

// ==================== RECURRING ====================
const recurring = {
  async load() {
    const list = document.getElementById('recurring-list');
    if (!list) return;
    const items = await api('/recurring');
    const currency = (await api('/settings')).local_currency || 'EUR';
    if (!items || items.length === 0) {
      list.innerHTML =
        '<div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><p>No recurring items</p></div>';
      return;
    }
    list.innerHTML = items
      .map(
        (r) => `
      <div class="recurring-item">
        <div class="recurring-info">
          <span class="cat-dot" style="background:${r.category_color || '#6b7280'}"></span>
          <span class="recurring-name">${r.description}</span>
          <span class="recurring-freq badge">${r.frequency}</span>
        </div>
        <div class="recurring-right">
          <span class="recurring-amount ${r.type}">${r.type === 'expense' ? '-' : '+'}${formatCurrency(r.amount, currency)}</span>
          <span class="recurring-next">${r.next_date ? formatDate(r.next_date) : '-'}</span>
          <button class="btn btn-ghost btn-sm" onclick="recurring.populate(${r.id})" title="Add to transactions">+</button>
          <button class="btn btn-ghost btn-sm" onclick="recurring.openModal(${r.id})" title="Edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="recurring.delete(${r.id})" title="Delete">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `
      )
      .join('');
  },
  async openModal(id = null) {
    document.getElementById('recurring-id').value = id || '';
    document.getElementById('recurring-modal-title').textContent = id
      ? 'Edit Recurring'
      : 'Add Recurring';
    const catsRes = await api('/categories');
    const cats = (catsRes && catsRes.rows) ? catsRes.rows : (Array.isArray(catsRes) ? catsRes : []);
    document.getElementById('recurring-category').innerHTML =
      '<option value="">Select category...</option>' +
      cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (id) {
      const r = await api(`/recurring/${id}`).catch(() => null);
      if (r && !r.error) {
        document.getElementById('recurring-id').value = r.id;
        document.getElementById('recurring-description').value = r.description || '';
        document.getElementById('recurring-amount').value = r.amount || '';
        document.getElementById('recurring-frequency').value = r.frequency || 'monthly';
        document.getElementById('recurring-day').value = r.day_of_month || '';
        document.getElementById('recurring-next-date').value = r.next_date || '';
        document.getElementById('recurring-category').value = r.category_id || '';
        document.getElementById('recurring-type').value = r.type || 'expense';
        document.getElementById('recurring-notes').value = r.notes || '';
      }
    } else {
      document.getElementById('recurring-form').reset();
      document.getElementById('recurring-next-date').value = new Date().toISOString().split('T')[0];
    }
    modal.open('recurring-modal');
  },
  async save() {
    const id = document.getElementById('recurring-id').value;
    const data = {
      description: document.getElementById('recurring-description').value,
      amount: parseFloat(document.getElementById('recurring-amount').value),
      frequency: document.getElementById('recurring-frequency').value,
      day_of_month: parseInt(document.getElementById('recurring-day').value) || null,
      next_date: document.getElementById('recurring-next-date').value || null,
      category_id: parseInt(document.getElementById('recurring-category').value) || null,
      type: document.getElementById('recurring-type').value,
      notes: document.getElementById('recurring-notes').value,
    };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/recurring/${id}` : '/recurring';
    const result = await api(url, { method, body: data });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(id ? 'Recurring updated' : 'Recurring added', 'success');
    modal.close('recurring-modal');
    this.load();
  },
  async delete(id) {
    if (!confirm('Delete this recurring transaction?')) return;
    const result = await api(`/recurring/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Recurring deleted', 'success');
    this.load();
  },
  async populate(id) {
    const result = await api(`/recurring/${id}/populate`, { method: 'POST' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Transaction added, next date updated', 'success');
    this.load();
    // Refresh dashboard
    const page = location.hash.slice(1) || 'dashboard';
    if (page === 'dashboard' && typeof dashboard !== 'undefined') dashboard.loadSummary();
  },
};

// ==================== TRANSACTIONS ====================
const transactions = {
  currentType: 'expense',
  editingId: null,
  page: 1,
  perPage: 50,
  sortBy: 'date',
  sortOrder: 'desc',
  buildFilterParams() {
    const search = document.getElementById('tx-search')?.value || '';
    const type = document.getElementById('tx-type-filter')?.value || '';
    const catIds = txFilters.selectedCategories;
    const from = document.getElementById('tx-date-from')?.value || '';
    const to = document.getElementById('tx-date-to')?.value || '';

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (type) params.append('type', type);
    if (catIds.length > 0) params.append('category_ids', catIds.join(','));
    if (from) params.append('startDate', from);
    if (to) params.append('endDate', to);
    return params;
  },
  async load() {
    const table = document.getElementById('tx-table-body');
    if (table) table.classList.add('table-loading');

    // Build filter params for both data and summary requests
    const filterParams = this.buildFilterParams();
    filterParams.append('limit', this.perPage);
    filterParams.append('offset', (this.page - 1) * this.perPage);
    if (this.sortBy) filterParams.append('sort', this.sortBy);
    if (this.sortOrder) filterParams.append('order', this.sortOrder);

    // Fetch transactions and summary in parallel
    const [data, summary, settings] = await Promise.all([
      api(`/transactions?${filterParams}`),
      api(`/transactions/summary?${this.buildFilterParams()}`),
      api('/settings')
    ]);
    const currency = settings.local_currency || 'EUR';
    this.render(data, summary, currency);
  },
  renderSummary(summary, currency = 'EUR') {
    const bar = document.getElementById('tx-summary-bar');
    if (!bar) return;
    if (!summary || summary.count === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = `
      <div class="summary-item">
        <span class="summary-label">Total Amount</span>
        <span class="summary-value total">${formatCurrency(summary.total_amount || 0, currency)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <span class="summary-label">Income</span>
        <span class="summary-value income">+${formatCurrency(summary.total_income || 0, currency)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <span class="summary-label">Expenses</span>
        <span class="summary-value expense">-${formatCurrency(summary.total_expense || 0, currency)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item">
        <span class="summary-label">Transactions</span>
        <span class="summary-value count">${summary.count || 0}</span>
      </div>
    `;
  },
  render(data, summary, currency = 'EUR') {
    const tbody = document.getElementById('tx-table-body');
    if (tbody) tbody.classList.remove('table-loading');
    // Render summary bar
    this.renderSummary(summary, currency);
    if (!data.rows || data.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><p>No transactions found</p></div></td></tr>`;
      document.getElementById('tx-pagination-info').textContent = '0 transactions';
      document.getElementById('tx-pagination').innerHTML = '';
      return;
    }
    tbody.innerHTML = data.rows
      .map(
        (t) => `<tr>
      <td><input type="checkbox" class="tx-bulk-checkbox" value="${t.id}"></td>
      <td>${formatDate(t.date)}</td>
      <td><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.description) || '-'}</div></td>
      <td><span class="cat-dot" style="background:${t.category_color || '#6b7280'}"></span>${t.category_name || '-'}</td>
      <td>${t.type === 'expense' ? t.beneficiary || '-' : t.payor || '-'}</td>
      <td class="td-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${formatCurrency(t.amount_local || t.amount, currency)}</td>
      <td><span class="badge badge-${t.type}">${t.type}</span></td>
      <td class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="transactions.edit(${t.id})" title="Edit">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="transactions.delete(${t.id})" title="Delete">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    </tr>`
      )
      .join('');

    const total = data.total || 0;
    const pages = Math.ceil(total / this.perPage);
    document.getElementById('tx-pagination-info').textContent =
      `${total} transaction${total !== 1 ? 's' : ''} (page ${this.page}/${pages})`;
    document.getElementById('tx-pagination').innerHTML =
      pages > 1
        ? `
      <button class="btn btn-ghost btn-sm" ${this.page <= 1 ? 'disabled' : ''} onclick="transactions.goPage(${this.page - 1})">&laquo;</button>
      ${Array.from({ length: Math.min(5, pages) }, (_, i) => {
        const p = i + Math.max(1, this.page - 2);
        return p <= pages
          ? `<button class="btn btn-sm ${p === this.page ? 'btn-primary' : 'btn-secondary'}" onclick="transactions.goPage(${p})">${p}</button>`
          : '';
      }).join('')}
      <button class="btn btn-ghost btn-sm" ${this.page >= pages ? 'disabled' : ''} onclick="transactions.goPage(${this.page + 1})">&raquo;</button>
    `
        : '';
  },
  goPage(p) {
    this.page = p;
    this.load();
  },
  search() {
    this.page = 1;
    this.load();
  },
  clearFilters() {
    ['tx-search', 'tx-type-filter', 'tx-date-from', 'tx-date-to'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('tx-year-filter').value = '';
    document.getElementById('tx-month-filter').value = '';
    txFilters.selectedCategories = [];
    txFilters.updateLabel();
    const allCheckbox = document.getElementById('tx-cat-all');
    if (allCheckbox) allCheckbox.checked = true;
    const checkboxes = document.querySelectorAll('.tx-cat-checkbox');
    checkboxes.forEach((cb) => { cb.checked = false; });
    txFilters.setPreset('month');
    this.page = 1;
    this.sortBy = 'date';
    this.sortOrder = 'desc';
    this.updateSortHeaders();
    this.load();
  },
  setType(type) {
    this.currentType = type;
    document
      .querySelectorAll('#tx-type-selector button')
      .forEach((b) => b.classList.remove('active'));
    document.querySelector(`#tx-type-selector button.${type}`).classList.add('active');
  },
  sortByColumn(col) {
    if (this.sortBy === col) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = col;
      this.sortOrder = 'asc';
    }
    this.updateSortHeaders();
    this.page = 1;
    this.load();
  },
  updateSortHeaders() {
    const headers = document.querySelectorAll('#tx-table-sortable th[data-sort]');
    headers.forEach((th) => {
      const col = th.dataset.sort;
      const arrow = th.querySelector('.sort-arrow');
      if (col === this.sortBy) {
        th.classList.add('sorted');
        if (arrow) arrow.innerHTML = this.sortOrder === 'asc'
          ? ' &#9650;' : ' &#9660;';
      } else {
        th.classList.remove('sorted');
        if (arrow) arrow.innerHTML = ' &#9660;&#9650;';
      }
    });
  },
  async openModal(id = null) {
    this.editingId = id;
    document.getElementById('tx-modal-title').textContent = id
      ? 'Edit Transaction'
      : 'Add Transaction';

    // Load categories
    const catsRes = await api('/categories');
    const cats = (catsRes && catsRes.rows) ? catsRes.rows : (Array.isArray(catsRes) ? catsRes : []);
    const catSelect = document.getElementById('tx-category');
    catSelect.innerHTML =
      '<option value="">Select category...</option>' +
      cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    if (id) {
      const t = await api(`/transactions/${id}`).catch(() => null);
      if (t && !t.error) {
        document.getElementById('tx-id').value = t.id;
        document.getElementById('tx-description').value = t.description || '';
        document.getElementById('tx-amount').value = t.amount || '';
        document.getElementById('tx-date').value = t.date || '';
        document.getElementById('tx-beneficiary').value = t.beneficiary || '';
        document.getElementById('tx-payor').value = t.payor || '';
        document.getElementById('tx-category').value = t.category_id || '';
        document.getElementById('tx-currency').value = t.currency || 'USD';
        document.getElementById('tx-amount-local').value = t.amount_local || '';
        document.getElementById('tx-exchange-rate').value = t.exchange_rate || 1;
        document.getElementById('tx-means').value = t.means_of_payment || '';
        document.getElementById('tx-notes').value = t.notes || '';
        this.setType(t.type || 'expense');
      }
    } else {
      document.getElementById('tx-form').reset();
      document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('tx-exchange-rate').value = 1;
      this.setType('expense');
    }
    modal.open('tx-modal');
  },
  async edit(id) {
    await this.openModal(id);
  },
  validate() {
    let valid = true;
    const clearErrors = () => {
      document.querySelectorAll('#tx-form .form-group.is-invalid').forEach((el) => {
        el.classList.remove('is-invalid');
        const err = el.querySelector('.field-error');
        if (err) err.remove();
      });
    };
    clearErrors();

    const setError = (fieldId, msg) => {
      const field = document.getElementById(fieldId);
      if (!field) return;
      const group = field.closest('.form-group');
      if (!group) return;
      group.classList.add('is-invalid');
      const span = document.createElement('span');
      span.className = 'field-error';
      span.textContent = msg;
      group.appendChild(span);
      valid = false;
    };

    const desc = document.getElementById('tx-description').value.trim();
    if (!desc) setError('tx-description', 'Description is required');

    const amt = document.getElementById('tx-amount').value;
    if (!amt || isNaN(parseFloat(amt))) setError('tx-amount', 'Amount is required');
    else if (parseFloat(amt) <= 0) setError('tx-amount', 'Amount must be greater than zero');

    const date = document.getElementById('tx-date').value;
    if (!date) setError('tx-date', 'Date is required');

    const rate = document.getElementById('tx-exchange-rate').value;
    if (rate && rate !== '' && parseFloat(rate) <= 0)
      setError('tx-exchange-rate', 'Exchange rate must be greater than zero');

    return valid;
  },
  async save() {
    const btn = document.getElementById('tx-save-btn');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    btn.classList.add('loading');
    if (!this.validate()) {
      btn.textContent = origText;
      btn.classList.remove('loading');
      return;
    }
    try {
      const id = document.getElementById('tx-id').value;
      const data = {
        description: document.getElementById('tx-description').value,
        amount: parseFloat(document.getElementById('tx-amount').value),
        date: document.getElementById('tx-date').value,
        beneficiary: document.getElementById('tx-beneficiary').value,
        payor: document.getElementById('tx-payor').value,
        category_id: document.getElementById('tx-category').value || null,
        currency: document.getElementById('tx-currency').value,
        amount_local: parseFloat(document.getElementById('tx-amount-local').value) || null,
        means_of_payment: document.getElementById('tx-means').value,
        exchange_rate: parseFloat(document.getElementById('tx-exchange-rate').value) || 1,
        type: this.currentType,
        notes: document.getElementById('tx-notes').value,
      };
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/transactions/${id}` : '/transactions';
      const result = await api(url, { method, body: data });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(id ? 'Transaction updated' : 'Transaction added', 'success');
      modal.close('tx-modal');
      this.load();
      if (typeof dashboard !== 'undefined') dashboard.load();
    } finally {
      btn.textContent = origText;
      btn.classList.remove('loading');
    }
  },
  async delete(id) {
    if (!confirm('Delete this transaction?')) return;
    const result = await api(`/transactions/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Transaction deleted', 'success');
    this.load();
    if (typeof dashboard !== 'undefined') dashboard.load();
  },
  pendingMappings: [],

  async openAutoMapModal() {
    document.getElementById('automap-status').textContent = 'Analyzing uncategorized transactions...';
    document.getElementById('automap-list').innerHTML = '';
    modal.open('automap-modal');

    try {
      const result = await api('/categories/auto-map', { method: 'POST', body: {} });
      this.pendingMappings = result.mappings || [];

      if (this.pendingMappings.length === 0) {
        document.getElementById('automap-status').textContent = 'No uncategorized transactions found.';
        return;
      }

      document.getElementById('automap-status').textContent =
        `Found ${result.mapped} of ${result.total} transactions that can be auto-categorized.`;

      const list = document.getElementById('automap-list');
      list.innerHTML = this.pendingMappings.map((m, i) => `
        <div class="automap-item" style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border);">
          <input type="checkbox" class="automap-checkbox" data-index="${i}" checked style="flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.description)}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
              <span style="color:var(--text-muted);">Current:</span> ${escapeHtml(m.current_category || 'Uncategorized')}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
            <span class="cat-dot" style="background:${m.proposed_category_color || '#6b7280'}"></span>
            <span style="font-weight:500;">${escapeHtml(m.proposed_category_name)}</span>
          </div>
          <div style="flex-shrink:0;width:40px;text-align:right;">
            <span class="confidence-badge" style="background:${m.confidence >= 0.8 ? 'var(--success)' : m.confidence >= 0.5 ? '#f59e0b' : 'var(--border)'};color:white;font-size:11px;padding:2px 6px;border-radius:10px;">
              ${Math.round(m.confidence * 100)}%
            </span>
          </div>
        </div>
      `).join('');
    } catch (e) {
      toast('Failed to analyze transactions: ' + e.message, 'error');
      modal.close('automap-modal');
    }
  },

  async applyAutoMappings() {
    const checkboxes = document.querySelectorAll('.automap-checkbox:checked');
    const selectedMappings = [];

    checkboxes.forEach(cb => {
      const idx = parseInt(cb.dataset.index);
      const mapping = this.pendingMappings[idx];
      if (mapping) {
        selectedMappings.push({
          transaction_id: mapping.transaction_id,
          category_id: mapping.proposed_category_id,
          pattern: mapping.description,
        });
      }
    });

    if (selectedMappings.length === 0) {
      toast('No mappings selected', 'error');
      return;
    }

    try {
      const result = await api('/categories/apply-mappings', {
        method: 'POST',
        body: { mappings: selectedMappings }
      });

      if (result.ok) {
        toast(`Updated ${result.updated} transactions`, 'success');
        modal.close('automap-modal');
        this.load();
        if (typeof dashboard !== 'undefined') dashboard.load();
      } else {
        toast(result.error || 'Failed to apply mappings', 'error');
      }
    } catch (e) {
      toast('Failed to apply mappings: ' + e.message, 'error');
    }
  },
};
