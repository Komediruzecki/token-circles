/**
 * Bulk transaction edit functionality
 */

const bulkEdit = {
  selected: new Set(),

  toggleSelectAll() {
    const checked = document.getElementById('tx-bulk-select-all').checked;
    document.querySelectorAll('.tx-bulk-checkbox').forEach(cb => { cb.checked = checked; });
    if (checked) {
      document.querySelectorAll('.tx-bulk-checkbox').forEach(cb => this.selected.add(parseInt(cb.value)));
    } else {
      this.selected.clear();
    }
    this.updateBar();
  },

  toggle(id) {
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.updateHeaderCheckbox();
    this.updateBar();
  },

  updateHeaderCheckbox() {
    const allCheckboxes = document.querySelectorAll('.tx-bulk-checkbox');
    const checkedBoxes = document.querySelectorAll('.tx-bulk-checkbox:checked');
    const header = document.getElementById('tx-bulk-select-all');
    if (header) {
      header.checked = allCheckboxes.length > 0 && checkedBoxes.length === allCheckboxes.length;
      header.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < allCheckboxes.length;
    }
  },

  updateBar() {
    const bar = document.getElementById('tx-bulk-bar');
    const count = document.getElementById('tx-bulk-count');
    if (bar && count) {
      if (this.selected.size > 0) {
        bar.style.display = 'flex';
        count.textContent = `${this.selected.size} selected`;
      } else {
        bar.style.display = 'none';
      }
    }
  },

  clearSelection() {
    this.selected.clear();
    document.querySelectorAll('.tx-bulk-checkbox').forEach(cb => { cb.checked = false; });
    const header = document.getElementById('tx-bulk-select-all');
    if (header) { header.checked = false; header.indeterminate = false; }
    this.updateBar();
  },

  async openCategoryModal() {
    if (this.selected.size === 0) return;
    document.getElementById('bulk-cat-count').textContent = this.selected.size;
    const catsRes = await api('/categories');
    const cats = (catsRes && catsRes.rows) ? catsRes.rows : (Array.isArray(catsRes) ? catsRes : []);
    const sel = document.getElementById('bulk-category-select');
    sel.innerHTML = '<option value="">No Category</option>' +
      cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    modal.open('bulk-category-modal');
  },

  async applyCategory() {
    const catId = document.getElementById('bulk-category-select').value;
    const ids = Array.from(this.selected);
    const result = await api('/transactions/bulk', {
      method: 'PUT',
      body: { ids, action: 'update', data: { category_id: catId === '' ? null : parseInt(catId) } }
    });
    if (result.error) { toast(result.error, 'error'); return; }
    toast(`Updated ${result.updated} transactions`, 'success');
    modal.close('bulk-category-modal');
    this.clearSelection();
    transactions.load();
  },

  async openTypeModal() {
    if (this.selected.size === 0) return;
    document.getElementById('bulk-type-count').textContent = this.selected.size;
    modal.open('bulk-type-modal');
  },

  async applyType() {
    const type = document.getElementById('bulk-type-select').value;
    if (!type) {
      toast('Please select a type', 'error');
      return;
    }
    const ids = Array.from(this.selected);
    const result = await api('/transactions/bulk', {
      method: 'PUT',
      body: { ids, action: 'update', data: { type } }
    });
    if (result.error) { toast(result.error, 'error'); return; }
    toast(`Updated ${result.updated} transactions`, 'success');
    modal.close('bulk-type-modal');
    this.clearSelection();
    transactions.load();
  },

  async deleteSelected() {
    if (this.selected.size === 0) return;
    const count = this.selected.size;
    if (!confirm(`Delete ${count} selected transaction${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = Array.from(this.selected);
    const result = await api('/transactions/bulk', {
      method: 'PUT',
      body: { ids, action: 'delete' }
    });
    if (result.error) { toast(result.error, 'error'); return; }
    toast(`Deleted ${result.deleted} transactions`, 'success');
    this.clearSelection();
    transactions.load();
    dashboard.load();
  },

  async reconcileSelected() {
    if (this.selected.size === 0) return;
    const ids = Array.from(this.selected);
    const result = await api('/transactions/reconcile-batch', {
      method: 'PUT',
      body: { transaction_ids: ids }
    });
    if (result.error) { toast(result.error, 'error'); return; }
    toast(`Marked ${result.updated} transactions as reconciled`, 'success');
    this.clearSelection();
    transactions.load();
    transactions.initReconciliation();
  }
};
