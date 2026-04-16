// ==================== QUICK-ADD ====================
const quickAdd = {
  async open() {
    modal.open('quickadd-modal');
    document.getElementById('qa-amount').value = '';
    document.getElementById('qa-description').value = '';
    document.getElementById('qa-date').value = new Date().toISOString().split('T')[0];
    const cats = await api('/categories');
    document.getElementById('qa-category').innerHTML =
      '<option value="">Select category...</option>' +
      cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    setTimeout(() => document.getElementById('qa-amount').focus(), 50);
  },
  async save() {
    const amount = parseFloat(document.getElementById('qa-amount').value);
    const description = document.getElementById('qa-description').value;
    const category_id = document.getElementById('qa-category').value || null;
    const date = document.getElementById('qa-date').value;
    if (!amount || !date) {
      toast('Amount and date are required', 'error');
      return;
    }
    const cats = await api('/categories');
    const cat = cats.find((c) => String(c.id) === String(category_id));
    const type = cat ? cat.type : 'expense';
    const result = await api('/transactions', {
      method: 'POST',
      body: { description, amount, date, category_id, type },
    });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Transaction added', 'success');
    modal.close('quickadd-modal');
    // Refresh current page data
    const page = location.hash.slice(1) || 'dashboard';
    if (page === 'transactions') transactions.load();
    else if (page === 'dashboard') dashboard.load();
  },
};
window.quickAdd = quickAdd;

// Keyboard shortcut: Ctrl/Cmd+Shift+T opens quick-add
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    if (typeof quickAdd !== 'undefined') quickAdd.open();
  }
  if (e.key === 'Escape') {
    const m = document.getElementById('quickadd-modal');
    if (m && m.classList.contains('show')) modal.close('quickadd-modal');
  }
});
