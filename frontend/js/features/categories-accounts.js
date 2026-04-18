// ==================== CATEGORIES ====================
const categories = {
  currentType: 'expense',
  async load() {
    const cats = await api('/categories');
    const expenseCats = cats.filter((c) => c.type === 'expense');
    const incomeCats = cats.filter((c) => c.type === 'income');

    const renderCats = (arr, type) =>
      arr
        .map(
          (c) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:12px;height:12px;border-radius:50%;background:${c.color}"></span>
          <span style="font-size:14px;">${escapeHtml(c.name)}</span>
          ${c.tax_deductible ? '<span style="font-size:10px;padding:1px 6px;background:#dcfce7;color:#16a34a;border-radius:4px;">Tax</span>' : ''}
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="categories.edit(${c.id})">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="categories.delete(${c.id})">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `
        )
        .join('');

    document.getElementById('expense-categories').innerHTML = expenseCats.length
      ? renderCats(expenseCats, 'expense')
      : '<div class="empty-state"><p>No expense categories</p></div>';
    document.getElementById('income-categories').innerHTML = incomeCats.length
      ? renderCats(incomeCats, 'income')
      : '<div class="empty-state"><p>No income categories</p></div>';

    // Trigger loading of multi-select category filter in transactions page
    if (typeof txFilters !== 'undefined' && txFilters.loadCategories) {
      txFilters.loadCategories();
    }
  },
  setType(type) {
    this.currentType = type;
    document
      .querySelectorAll('#cat-type-selector button')
      .forEach((b) => b.classList.remove('active'));
    document.querySelector(`#cat-type-selector button.${type}`).classList.add('active');
  },
  async openModal(id = null) {
    document.getElementById('cat-id').value = id || '';
    document.getElementById('cat-modal-title').textContent = id ? 'Edit Category' : 'Add Category';
    if (id) {
      const cats = await api('/categories');
      const c = cats.find((x) => x.id === id);
      if (c) {
        document.getElementById('cat-name').value = c.name;
        document.getElementById('cat-color').value = c.color;
        document.getElementById('cat-tax').checked = !!c.tax_deductible;
        this.setType(c.type);
        this.updateColorPalette(c.color);
      }
    } else {
      document.getElementById('cat-form').reset();
      document.getElementById('cat-tax').checked = false;
      document.getElementById('cat-color').value = '#6b7280';
      this.setType('expense');
      this.updateColorPalette('#6b7280');
    }
    modal.open('cat-modal');
  },
  selectColor(btn) {
    const color = btn.dataset.color;
    document.getElementById('cat-color').value = color;
    this.updateColorPalette(color);
  },
  updateColorPalette(selectedColor) {
    document.querySelectorAll('.color-swatch').forEach((s) => {
      s.classList.toggle('selected', s.dataset.color === selectedColor);
    });
  },
  async edit(id) {
    this.openModal(id);
  },
  async save() {
    const btn = document.getElementById('cat-save-btn');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    btn.classList.add('loading');
    try {
      const id = document.getElementById('cat-id').value;
      const data = {
        name: document.getElementById('cat-name').value,
        color: document.getElementById('cat-color').value,
        type: this.currentType,
        tax_deductible: document.getElementById('cat-tax').checked,
      };
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/categories/${id}` : '/categories';
      const result = await api(url, { method, body: data });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(id ? 'Category updated' : 'Category added', 'success');
      modal.close('cat-modal');
      this.load();
    } finally {
      btn.textContent = origText;
      btn.classList.remove('loading');
    }
  },
  async delete(id) {
    if (!confirm('Delete this category?')) return;
    const result = await api(`/categories/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Category deleted', 'success');
    this.load();
  },
  async deleteAll() {
    if (!confirm('Delete ALL categories? This cannot be undone.')) return;
    const typed = prompt('Type DELETE to confirm:');
    if (typed !== 'DELETE') {
      toast('Cancelled', 'info');
      return;
    }
    try {
      const result = await api('/categories', { method: 'DELETE' });
      toast(result.message || 'All categories deleted', 'success');
      this.load();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  },
};

// ==================== ACCOUNTS ====================
const accounts = {
  async load() {
    const data = await api('/accounts');
    this.render(data);
  },
  render(data) {
    const container = document.getElementById('accounts-content');
    if (!data || data.length === 0) {
      container.innerHTML = `<div class="card"><div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
        <p>No accounts yet</p><p style="font-size:12px;color:var(--text-secondary);">Add your first account to get started</p></div></div>`;
      return;
    }
    const groups = {
      ib: { name: 'Investment', accounts: [] },
      giro: { name: 'Giro / Current', accounts: [] },
      savings: { name: 'Savings', accounts: [] },
    };
    data.forEach((a) => {
      if (groups[a.type]) groups[a.type].accounts.push(a);
    });
    let html = '';
    for (const [type, g] of Object.entries(groups)) {
      if (g.accounts.length === 0) continue;
      html += `<div class="card" style="margin-bottom:16px;">
        <div class="card-header"><div class="card-title">${g.name}</div></div>
        <div class="grid-3">${g.accounts
          .map(
            (a) => `
          <div class="account-card">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
              <div style="font-weight:600;">${a.name}</div>
              <span class="badge badge-${type === 'ib' ? 'primary' : type === 'savings' ? 'success' : 'secondary'}">${type.toUpperCase()}</span>
            </div>
            <div style="font-size:24px;font-weight:700;margin-bottom:4px;">${formatCurrency(a.balance, a.currency)}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${a.currency}</div>
            ${a.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${a.notes}</div>` : ''}
            <div style="display:flex;gap:4px;margin-top:12px;">
              <button class="btn btn-ghost btn-sm" onclick="accounts.openModal(${a.id})" style="flex:1;">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                Edit
              </button>
              <button class="btn btn-ghost btn-sm" onclick="accounts.viewBalanceHistory(${a.id}, '${escapeHtml(a.name)}')" title="View Balance History">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm" onclick="accounts.delete(${a.id})" style="color:var(--danger);">
                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>`
          )
          .join('')}
        </div>
      </div>`;
    }
    container.innerHTML = html;
  },
  async openModal(id = null) {
    document.getElementById('account-id').value = id || '';
    document.getElementById('account-modal-title').textContent = id
      ? 'Edit Account'
      : 'Add Account';
    if (id) {
      const data = await api('/accounts');
      const acc = data.find((a) => a.id == id);
      if (acc) {
        document.getElementById('account-name').value = acc.name || '';
        document.getElementById('account-type').value = acc.type || 'giro';
        document.getElementById('account-currency').value = acc.currency || 'USD';
        document.getElementById('account-balance').value = acc.balance || 0;
        document.getElementById('account-notes').value = acc.notes || '';
      }
    } else {
      document.getElementById('account-name').value = '';
      document.getElementById('account-type').value = 'giro';
      document.getElementById('account-currency').value = 'USD';
      document.getElementById('account-balance').value = 0;
      document.getElementById('account-notes').value = '';
    }
    modal.open('account-modal');
  },
  async save() {
    const id = document.getElementById('account-id').value;
    const data = {
      name: document.getElementById('account-name').value,
      type: document.getElementById('account-type').value,
      currency: document.getElementById('account-currency').value || 'USD',
      balance: document.getElementById('account-balance').value,
      notes: document.getElementById('account-notes').value,
    };
    if (!data.name) {
      toast('Account name is required', 'error');
      return;
    }
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/accounts/${id}` : '/accounts';
    const result = await api(url, { method, body: data });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(id ? 'Account updated' : 'Account created', 'success');
    modal.close('account-modal');
    this.load();
  },
  async delete(id) {
    if (!confirm('Delete this account?')) return;
    const result = await api(`/accounts/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Account deleted', 'success');
    this.load();
  },
  async viewBalanceHistory(id, name) {
    document.getElementById('bh-account-name').textContent = name;
    document.getElementById('bh-account-id').value = id;
    try {
      const history = await api(`/accounts/${id}/history`);
      const list = document.getElementById('balance-history-list');
      if (!history || history.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No balance history recorded.</p></div>';
      } else {
        const settings = await api('/settings');
        const currency = settings.local_currency || 'EUR';
        list.innerHTML = history
          .map(
            (h) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <div style="font-size:13px;color:var(--text-secondary);">${formatDate(h.recorded_at)}</div>
              <div style="font-weight:600;">${formatCurrency(h.balance, currency)}</div>
              <button class="btn btn-ghost btn-sm" onclick="accounts.deleteBalanceEntry(${id}, ${h.id})" style="color:var(--danger);padding:2px 6px;">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          `
          )
          .join('');
      }
      modal.open('balance-history-modal');
    } catch (e) {
      toast('Failed to load balance history: ' + e.message, 'error');
    }
  },
  async recordBalance() {
    const id = parseInt(document.getElementById('bh-account-id').value);
    if (!id) {
      toast('No account selected', 'error');
      return;
    }
    // Get current account balance from the API
    const accountsData = await api('/accounts');
    const acc = accountsData.find((a) => a.id === id);
    const amount = acc ? parseFloat(acc.balance) : parseFloat(prompt('Enter current balance:'));
    if (isNaN(amount) && !acc) return;
    try {
      await api(`/accounts/${id}/history`, {
        method: 'POST',
        body: { balance: amount },
      });
      toast('Balance recorded', 'success');
      // Refresh the list
      await this.viewBalanceHistory(id, acc ? acc.name : '');
    } catch (e) {
      toast('Failed to record balance: ' + e.message, 'error');
    }
  },
  async deleteBalanceEntry(accountId, entryId) {
    if (!confirm('Delete this entry?')) return;
    try {
      await api(`/accounts/${accountId}/history/${entryId}`, { method: 'DELETE' });
      toast('Entry deleted', 'success');
      const history = await api(`/accounts/${accountId}/history`);
      const list = document.getElementById('balance-history-list');
      const settings = await api('/settings');
      const currency = settings.local_currency || 'EUR';
      if (!history || history.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>No balance history recorded.</p></div>';
      } else {
        list.innerHTML = history
          .map(
            (h) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
              <div style="font-size:13px;color:var(--text-secondary);">${formatDate(h.recorded_at)}</div>
              <div style="font-weight:600;">${formatCurrency(h.balance, currency)}</div>
              <button class="btn btn-ghost btn-sm" onclick="accounts.deleteBalanceEntry(${accountId}, ${h.id})" style="color:var(--danger);padding:2px 6px;">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          `
          )
          .join('');
      }
    } catch (e) {
      toast('Failed to delete entry: ' + e.message, 'error');
    }
  },
};

// Register with FM singleton (moved to app-singleton.js for better initialization order)
