// ==================== BILLS ====================
const financeBills = {
  async load() {
    const container = document.getElementById('bills-list');
    if (!container) return;

    container.innerHTML = '<div class="loading-spinner dark"></div>';

    try {
      const [upcoming, settings] = await Promise.all([
        api('/bills/upcoming'),
        api('/settings'),
      ]);
      const currency = settings.local_currency || 'EUR';

      if (!upcoming || upcoming.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            <p>No bills yet</p>
            <p style="font-size:13px;color:var(--text-secondary);">Add your recurring bills to track due dates</p>
          </div>`;
        return;
      }

      const overdue = upcoming.filter(b => b.is_overdue);
      const dueSoon = upcoming.filter(b => !b.is_overdue && b.days_until !== null && b.days_until <= 3);
      const upcomingBills = upcoming.filter(b => !b.is_overdue && (b.days_until === null || b.days_until > 3));

      let html = '';

      if (overdue.length > 0) {
        html += this.renderSection('OVERDUE', overdue, currency, 'overdue');
      }
      if (dueSoon.length > 0) {
        html += this.renderSection('DUE SOON', dueSoon, currency, 'due-soon');
      }
      if (upcomingBills.length > 0) {
        html += this.renderSection('UPCOMING', upcomingBills, currency, 'upcoming');
      }

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Failed to load bills</p></div>`;
      console.error(err);
    }
  },

  renderSection(title, items, currency, status) {
    const iconMap = { overdue: '&#9888;', 'due-soon': '&#128197;', upcoming: '&#10003;' };
    const icon = iconMap[status] || '&#128197;';
    return `
      <div class="bills-section">
        <div class="bills-section-header ${status}">
          <span class="bills-section-icon">${icon}</span>
          <span class="bills-section-title">${title}</span>
        </div>
        ${items.map(b => this.renderItem(b, currency)).join('')}
      </div>
    `;
  },

  renderItem(b, currency) {
    const daysLabel = b.is_overdue
      ? `${Math.abs(b.days_until)} days overdue`
      : b.days_until === 0
        ? 'Due today'
        : b.days_until === 1
          ? '1 day'
          : `${b.days_until} days`;
    const catDot = b.category_color
      ? `<span class="cat-dot" style="background:${b.category_color}"></span>`
      : '';
    const dueDate = b.next_due_date ? formatDate(b.next_due_date) : 'Not set';

    return `
      <div class="bills-item">
        <div class="bills-item-left">
          ${catDot}
          <div class="bills-item-info">
            <div class="bills-item-name">${escapeHtml(b.name)}</div>
            <div class="bills-item-meta">${dueDate} &bull; ${b.frequency}</div>
          </div>
        </div>
        <div class="bills-item-right">
          <span class="bills-item-amount">${formatCurrency(b.amount, currency)}</span>
          <span class="bills-item-days ${b.is_overdue ? 'overdue' : b.days_until <= 3 ? 'due-soon' : ''}">${daysLabel}</span>
          <button class="btn btn-sm ${b.is_overdue ? 'btn-danger' : 'btn-secondary'}" onclick="financeBills.markPaid(${b.id})" title="Mark as paid">
            Pay
          </button>
          <button class="btn btn-ghost btn-sm" onclick="financeBills.openModal(${b.id})" title="Edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="financeBills.delete(${b.id})" title="Delete">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `;
  },

  async openModal(id = null) {
    document.getElementById('bills-modal-id').value = id || '';
    document.getElementById('bills-modal-title').textContent = id ? 'Edit Bill' : 'Add Bill';

    // Load categories
    const catsRes = await api('/categories');
    const cats = (catsRes && catsRes.rows) ? catsRes.rows : (Array.isArray(catsRes) ? catsRes : []);
    document.getElementById('bills-category').innerHTML =
      '<option value="">Select category...</option>' +
      cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    if (id) {
      const billsList = await api('/bills');
      const b = billsList.find(x => String(x.id) === String(id));
      if (b) {
        document.getElementById('bills-modal-id').value = b.id;
        document.getElementById('bills-name').value = b.name || '';
        document.getElementById('bills-amount').value = b.amount || '';
        document.getElementById('bills-frequency').value = b.frequency || 'monthly';
        document.getElementById('bills-day').value = b.day_of_month || '';
        document.getElementById('bills-category').value = b.category_id || '';
        document.getElementById('bills-notes').value = b.notes || '';
      }
    } else {
      document.getElementById('bills-form').reset();
    }
    if (typeof modal !== 'undefined') modal.open('bills-modal');
  },

  async save() {
    const id = document.getElementById('bills-modal-id').value;
    const data = {
      name: document.getElementById('bills-name').value,
      amount: parseFloat(document.getElementById('bills-amount').value),
      frequency: document.getElementById('bills-frequency').value,
      day_of_month: parseInt(document.getElementById('bills-day').value) || null,
      category_id: parseInt(document.getElementById('bills-category').value) || null,
      notes: document.getElementById('bills-notes').value,
    };

    if (!data.name || isNaN(data.amount)) {
      toast('Name and amount are required', 'error');
      return;
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/bills/${id}` : '/bills';
    const result = await api(url, { method, body: data });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast(id ? 'Bill updated' : 'Bill added', 'success');
    if (typeof modal !== 'undefined') modal.close('bills-modal');
    this.load();
  },

  async markPaid(id) {
    if (!confirm('Mark this bill as paid? This will create a transaction for today.')) return;
    const result = await api(`/bills/${id}/mark-paid`, { method: 'POST' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Bill marked as paid', 'success');
    this.load();
    // Refresh dashboard if needed
    const page = location.hash.slice(1) || 'dashboard';
    if (page === 'dashboard' && typeof dashboard !== 'undefined') dashboard.loadSummary();
  },

  async delete(id) {
    if (!confirm('Delete this bill?')) return;
    const result = await api(`/bills/${id}`, { method: 'DELETE' });
    if (result.error) {
      toast(result.error, 'error');
      return;
    }
    toast('Bill deleted', 'success');
    this.load();
  },
};
