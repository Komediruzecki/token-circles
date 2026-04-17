// ==================== IMPORT ====================
const importData = {
  fileData: null,
  headers: null,
  rows: null,
  mapping: {},
  importLimit: 1000,
  columnTypes: {},     // detected column types with confidence
  duplicateIndices: [], // indices of duplicate rows
  skipDuplicates: true, // filter duplicates by default
  setImportLimit(n, btn) {
    this.importLimit = n;
    document.querySelectorAll('.import-limit-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.updatePreview();
  },
  getImportLimit() {
    return this.importLimit || this.rows.length;
  },
  switchTab(tab) {
    document
      .querySelectorAll('#import-tab-file, #import-tab-googlesheet')
      .forEach((el) => (el.style.display = 'none'));
    document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('active'));
    if (tab === 'file') {
      document.getElementById('import-tab-file').style.display = 'block';
      document.querySelector('.tabs .tab').classList.add('active');
    } else {
      document.getElementById('import-tab-googlesheet').style.display = 'block';
      document.querySelectorAll('.tabs .tab')[1].classList.add('active');
    }
    // Keep mapping section visible if data is loaded
  },
  async handleFile(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const spinner = document.getElementById('import-spinner');
    const dropIcon = document.getElementById('import-drop-icon');
    spinner.style.display = 'inline-block';
    dropIcon.style.display = 'none';
    toast('Parsing file...', 'info');
    try {
      const resp = await fetch(API + '/import/upload', { method: 'POST', body: fd });
      const data = await resp.json();
      spinner.style.display = '';
      dropIcon.style.display = '';
      if (data.error) {
        toast(data.error, 'error');
        return;
      }

      // If multiple sheets, show selector
      if (data.sheetNames && data.sheetNames.length > 1) {
        const sheetSelect = document.getElementById('import-sheet-select');
        if (sheetSelect) {
          sheetSelect.innerHTML = data.sheetNames
            .map((s) => `<option value="${s}">${s}</option>`)
            .join('');
          document.getElementById('import-sheet-selector').style.display = 'block';
        }
        toast(`${data.sheetNames.length} sheets found. Select one to import.`, 'info');
      }

      this.fileId = data.fileId;
      this.headers = data.headers;
      this.rows = data.rows;
      this.buildMapping(data);
    } catch (e) {
      spinner.style.display = '';
      dropIcon.style.display = '';
      toast('Failed to parse file: ' + e.message, 'error');
    }
  },
  async loadFileSheet() {
    const sheetSelect = document.getElementById('import-sheet-select');
    const sheetName = sheetSelect.value;
    if (!sheetName || !this.fileId) {
      toast('Please upload a file first', 'error');
      return;
    }
    toast('Loading sheet...', 'info');

    // Build current mapping to send to server for duplicate detection
    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'amount_local',
      'means_of_payment',
      'exchange_rate',
      'type',
      'notes',
    ];
    const mapping = {};
    fields.forEach((f) => {
      const sel = document.getElementById(`map-${f}`);
      if (sel && sel.value) mapping[f] = parseInt(sel.value);
    });

    try {
      const resp = await fetch(API + '/import/file-sheet', {
        method: 'POST',
        body: JSON.stringify({ fileId: this.fileId, sheetName, mapping }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      if (data.error) {
        toast(data.error, 'error');
        return;
      }
      this.headers = data.headers;
      this.rows = data.rows;
      // Use server-side duplicate detection if available
      if (data.duplicateCount !== undefined && data.duplicateIndices !== undefined) {
        this.duplicateIndices = data.duplicateIndices;
        this.renderDuplicateInfo();
      }
      this.buildMapping(data);
      toast(`Loaded sheet "${sheetName}"`, 'success');
    } catch (e) {
      toast('Failed to load sheet: ' + e.message, 'error');
    }
  },
    }
  },
  buildMapping(data) {
    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'amount_local',
      'means_of_payment',
      'exchange_rate',
      'type',
      'notes',
    ];
    const mapEl = document.getElementById('column-map');
    mapEl.innerHTML = fields
      .map(
        (f) => `<div class="column-map-item">
      <label>${f.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</label>
      <select class="form-control" id="map-${f}" onchange="dataImport.updatePreview()">
        <option value="">-- Skip --</option>
        ${data.headers.map((h, i) => `<option value="${i}">${h || `Column ${i + 1}`}</option>`).join('')}
      </select>
    </div>`
      )
      .join('');

    // Auto-map common column names
    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'amount_local',
      'means_of_payment',
      'exchange_rate',
      'type',
      'notes',
    ];
    data.headers.forEach((h, i) => {
      const lower = (h || '').toLowerCase().replace(/[^a-z]/g, '');
      if (lower.includes('description') || lower.includes('memo') || lower.includes('narrative'))
        document.getElementById('map-description').value = i;
      if (
        lower === 'amount' ||
        lower === 'sum' ||
        lower.includes('debit') ||
        lower.includes('credit')
      )
        document.getElementById('map-amount').value = i;
      if (lower.includes('date') || lower.includes('when') || lower === 'posted')
        document.getElementById('map-date').value = i;
      if (lower.includes('beneficiary') || lower.includes('payee') || lower.includes('to'))
        document.getElementById('map-beneficiary').value = i;
      if (lower.includes('payor') || lower.includes('from') || lower.includes('sender'))
        document.getElementById('map-payor').value = i;
      if (lower === 'category' || lower === 'cat')
        document.getElementById('map-category').value = i;
      if (lower === 'currency') document.getElementById('map-currency').value = i;
      if (lower.includes('local')) document.getElementById('map-amount_local').value = i;
      if (lower.includes('means') || lower.includes('method') || lower.includes('payment'))
        document.getElementById('map-means_of_payment').value = i;
      if (lower.includes('rate') || lower.includes('fx'))
        document.getElementById('map-exchange_rate').value = i;
      if (lower.includes('type') && !lower.includes('category'))
        document.getElementById('map-type').value = i;
      if (lower.includes('note')) document.getElementById('map-notes').value = i;
    });

    // Add confidence indicators to auto-mapped fields
    fields.forEach((f) => {
      const sel = document.getElementById(`map-${f}`);
      if (sel && sel.value !== '') {
        const colIdx = parseInt(sel.value);
        const detected = this.columnTypes[colIdx];
        const label = sel.closest('.column-map-item').querySelector('label');
        if (label && detected) {
          const confLabel = this.getConfidenceLabel(detected.confidence);
          label.innerHTML += `<span class="column-type-detected ${confLabel}" title="Auto-detected: ${detected.type}">✓ ${detected.type} (${confLabel})</span>`;
        }
      }
    });

    const limit = this.getImportLimit();
    document.getElementById('import-preview-info').textContent =
      `Previewing ${Math.min(10, Math.min(limit, data.rows.length))} of ${limit > 0 ? Math.min(limit, data.rows.length) : data.rows.length} rows${limit > 0 ? ` (import limit: ${limit.toLocaleString()})` : ''}`;
    this.updatePreview();

    // Run smart column type detection
    this.columnTypes = this.analyzeColumnTypes(data.headers, data.rows);

    // Build category review section — extract unique categories and auto-detect types
    this.detectedCategories = {};
    const catIdx = parseInt(document.getElementById('map-category')?.value);
    if (!isNaN(catIdx) && catIdx >= 0) {
      const seen = new Set();
      data.rows.forEach((row) => {
        const name = (row[catIdx] || '').toString().trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          this.detectedCategories[name] = this.autoDetectCategoryType(name);
        }
      });
    }
    this.renderCategoryReview();

    // Find duplicates based on current mapping
    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'amount_local',
      'means_of_payment',
      'exchange_rate',
      'type',
      'notes',
    ];
    const mapping = {};
    fields.forEach((f) => {
      const sel = document.getElementById(`map-${f}`);
      if (sel && sel.value) mapping[f] = parseInt(sel.value);
    });
    this.duplicateIndices = this.findDuplicates(data.rows, mapping);
    this.renderDuplicateInfo();

    document.getElementById('import-mapping-section').style.display = 'block';
  },
  renderDuplicateInfo() {
    const container = document.getElementById('import-duplicate-section');
    if (!container) return;
    const count = this.duplicateIndices.length;
    if (count === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div class="card" style="margin-top:12px;background:#fffbeb;border:1px solid #f59e0b;">
      <div style="padding:12px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <span class="row-duplicate-badge">${count} potential duplicate${count !== 1 ? 's' : ''}</span>
            <span style="font-size:12px;color:#92400e;margin-left:8px;">Same date + amount + description</span>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="skip-duplicates" ${this.skipDuplicates ? 'checked' : ''} onchange="dataImport.toggleSkipDuplicates(this.checked)">
            <span>Skip duplicates</span>
          </label>
        </div>
      </div>
    </div>`;
  },
  toggleSkipDuplicates(checked) {
    this.skipDuplicates = checked;
    this.updatePreview();
  },
  // ==================== SMART COLUMN TYPE DETECTION ====================
  analyzeColumnTypes(headers, rows) {
    const SAMPLE_SIZE = Math.min(10, rows.length);
    const samples = rows.slice(0, SAMPLE_SIZE);
    const detected = {};

    headers.forEach((header, colIdx) => {
      const values = samples.map(r => r[colIdx] !== undefined ? String(r[colIdx] || '') : '').filter(v => v.trim());
      if (values.length === 0) return;

      // Detect Date column
      let dateScore = 0;
      values.forEach(v => {
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) dateScore += 2;
        if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v)) dateScore += 2;
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)/i.test(v)) dateScore += 1.5;
        if (!isNaN(Date.parse(v)) && v.length >= 8) dateScore += 1;
      });
      if (dateScore / values.length >= 0.5) detected[colIdx] = { type: 'date', confidence: dateScore / values.length };

      // Detect Amount column
      let amountScore = 0;
      values.forEach(v => {
        if (/^[\-\+]?[\d,]+\.?\d*$/.test(v.trim())) amountScore += 2;
        if (/^[\$\€\£]/.test(v.trim())) amountScore += 1.5;
        if (/[\d]+\.[\d]{2}$/.test(v.trim())) amountScore += 1;
        if (v.includes(',') && !v.includes('/')) amountScore += 0.5;
      });
      if (amountScore / values.length >= 0.4) {
        const existing = detected[colIdx];
        if (!existing || amountScore > (existing._score || 0)) {
          detected[colIdx] = { type: 'amount', confidence: amountScore / values.length };
        }
      }

      // Detect Description column
      let descScore = 0;
      values.forEach(v => {
        if (v.length > 10 && /^[A-Za-z]/.test(v.trim())) descScore += 2;
        if (!/^\d/.test(v.trim()) && /[A-Za-z]{3,}/.test(v)) descScore += 1;
      });
      if (descScore / values.length >= 0.5) {
        const existing = detected[colIdx];
        if (!existing) {
          detected[colIdx] = { type: 'description', confidence: descScore / values.length };
        }
      }

      // Detect Category column
      const lower = (header || '').toLowerCase();
      if (lower.includes('category') || lower.includes('cat') || lower.includes('type')) {
        detected[colIdx] = { type: 'category', confidence: 0.9 };
      }

      // Detect Notes column
      if (lower.includes('note') || lower.includes('comment') || lower.includes('memo') || lower.includes('reference')) {
        detected[colIdx] = { type: 'notes', confidence: 0.9 };
      }

      // Detect Account column
      if (lower.includes('account') || lower.includes('iban') || lower.includes('number') || lower.includes('card')) {
        detected[colIdx] = { type: 'account', confidence: 0.85 };
      }
    });

    return detected;
  },
  getConfidenceLabel(confidence) {
    if (confidence >= 0.7) return 'high';
    if (confidence >= 0.4) return 'medium';
    return 'low';
  },
  // ==================== DUPLICATE DETECTION ====================
  findDuplicates(rows, mapping) {
    const seen = new Map();
    const duplicateIndices = [];

    rows.forEach((row, idx) => {
      const descIdx = mapping.description !== undefined ? mapping.description : -1;
      const amountIdx = mapping.amount !== undefined ? mapping.amount : -1;
      const dateIdx = mapping.date !== undefined ? mapping.date : -1;

      if (descIdx < 0 || amountIdx < 0 || dateIdx < 0) return;

      const desc = (row[descIdx] || '').toString().toLowerCase().trim();
      const amount = (row[amountIdx] || '').toString().trim();
      const date = (row[dateIdx] || '').toString().trim();

      if (!desc && !amount && !date) return;

      const key = `${date}|${amount}|${desc}`;
      if (seen.has(key)) {
        duplicateIndices.push(idx);
        // Also mark the original
        if (!duplicateIndices.includes(seen.get(key))) {
          duplicateIndices.push(seen.get(key));
        }
      } else {
        seen.set(key, idx);
      }
    });

    // Sort indices for consistent display
    return duplicateIndices.sort((a, b) => a - b);
  },
  autoDetectCategoryType(name) {
    const lower = name.toLowerCase();
    if (/\b(current|giro|rev|revolut)\b/.test(lower)) return 'account';
    if (/\b(ib|investments?|investement|brokerage)\b/.test(lower)) return 'ib';
    if (/\b(income|salary|passive.?income|reimbursements?)\b/.test(lower)) return 'income';
    return 'expense';
  },
  renderCategoryReview() {
    const container = document.getElementById('category-review-section');
    if (!container) return;
    const cats = Object.entries(this.detectedCategories || {});
    if (cats.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div class="card" style="margin-top:16px;">
      <div class="card-header"><div><div class="card-title">Category Types</div><div class="card-subtitle">Review and adjust category types before importing</div></div></div>
      <div style="max-height:200px;overflow:auto;">
        <table style="width:100%;font-size:13px;">
          <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);">Category</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);">Type</th></tr></thead>
          <tbody>${cats
            .map(
              ([name, type]) => `<tr>
            <td style="padding:6px 8px;">${name}</td>
            <td style="padding:6px 8px;">
              <select class="form-control" id="cat-type-${btoa(name)}" style="font-size:12px;max-width:160px;">
                <option value="expense"${type === 'expense' ? ' selected' : ''}>Expense</option>
                <option value="income"${type === 'income' ? ' selected' : ''}>Income</option>
                <option value="ib"${type === 'ib' ? ' selected' : ''}>Investment</option>
                <option value="account"${type === 'account' ? ' selected' : ''}>Account</option>
              </select>
            </td>
          </tr>`
            )
            .join('')}</tbody>
        </table>
      </div>
    </div>`;
  },
  updatePreview() {
    if (!this.rows) return;

    // Re-detect categories when category column changes
    const catIdx = parseInt(document.getElementById('map-category')?.value);
    if (!isNaN(catIdx) && catIdx >= 0) {
      const seen = new Set();
      const newCats = {};
      this.rows.forEach((row) => {
        const name = (row[catIdx] || '').toString().trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          newCats[name] = this.autoDetectCategoryType(name);
        }
      });
      this.detectedCategories = newCats;
      this.renderCategoryReview();
    }

    // Re-compute duplicates when mapping changes
    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'type',
    ];
    const mapping = {};
    fields.forEach((f) => {
      const sel = document.getElementById(`map-${f}`);
      if (sel && sel.value) mapping[f] = parseInt(sel.value);
    });
    this.duplicateIndices = this.findDuplicates(this.rows, mapping);
    this.renderDuplicateInfo();

    // Apply skip duplicates filter
    let previewRows = this.rows.slice(0, 10);
    if (this.skipDuplicates && this.duplicateIndices.length > 0) {
      const skipSet = new Set(this.duplicateIndices);
      previewRows = previewRows.filter((_, idx) => !skipSet.has(idx));
    }

    const preview = document.getElementById('import-preview');
    preview.innerHTML = `<table><thead><tr>${fields.map((f) => `<th>${f}</th>`).join('')}</tr></thead><tbody>
    ${previewRows
      .map((row, rowIdx) => {
        const origIdx = this.rows.indexOf(row);
        const isDup = this.duplicateIndices.includes(origIdx);
        return `<tr${isDup ? ' class="row-duplicate"' : ''}>${fields
          .map((f) => {
            const sel = document.getElementById(`map-${f}`);
            const idx = sel ? parseInt(sel.value) : -1;
            const val = idx >= 0 ? (row[idx] !== undefined ? row[idx] : '') : '-';
            return `<td>${val}</td>`;
          })
          .join('')}</tr>`;
      })
      .join('')}
    </tbody></table>`;
  },
  async execute() {
    let limit = this.getImportLimit();
    // Adjust limit if we're skipping duplicates
    if (this.skipDuplicates && this.duplicateIndices.length > 0) {
      const skipSet = new Set(this.duplicateIndices);
      const rowsToCheck = this.rows.slice(0, limit);
      const filteredCount = rowsToCheck.filter((_, idx) => !skipSet.has(idx)).length;
      if (filteredCount < rowsToCheck.length) {
        const dupCount = this.duplicateIndices.filter(i => i < limit).length;
        if (!confirm(`Skip ${dupCount} duplicate row${dupCount !== 1 ? 's' : ''}? Will import ${filteredCount} unique transactions.`)) {
          return;
        }
      }
    }

    const limitAfterSkip = this.skipDuplicates && this.duplicateIndices.length > 0
      ? this.rows.slice(0, limit).filter((_, idx) => !new Set(this.duplicateIndices).has(idx)).length
      : limit;
    const rowCount = limitAfterSkip > 0 ? Math.min(limitAfterSkip, this.rows.length) : this.rows.length;

    if (rowCount === 0) {
      toast('No transactions to import after skipping duplicates', 'warning');
      return;
    }

    if (
      !confirm(`Import ${rowCount} transaction${rowCount !== 1 ? 's' : ''}? This will add new transactions to your profile.`)
    )
      return;

    const fields = [
      'description',
      'amount',
      'date',
      'beneficiary',
      'payor',
      'category',
      'currency',
      'amount_local',
      'means_of_payment',
      'exchange_rate',
      'type',
      'notes',
    ];
    const mapping = {};
    fields.forEach((f) => {
      const sel = document.getElementById(`map-${f}`);
      if (sel && sel.value) mapping[f] = parseInt(sel.value);
    });
    if (mapping.amount === undefined) {
      toast('Please map the Amount column', 'error');
      return;
    }

    const btn = document.getElementById('import-execute-btn');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner"></span> Importing...';
    btn.classList.add('loading');
    try {
      // Collect category type overrides from the review section
      const categoryTypes = {};
      if (this.detectedCategories) {
        Object.keys(this.detectedCategories).forEach((name) => {
          const sel = document.getElementById(`cat-type-${btoa(name)}`);
          if (sel) categoryTypes[name] = sel.value;
        });
      }

      let rowsToImport = limit > 0 ? this.rows.slice(0, limit) : this.rows;
      // Filter out duplicates if skip is enabled
      if (this.skipDuplicates && this.duplicateIndices.length > 0) {
        const skipSet = new Set(this.duplicateIndices);
        rowsToImport = rowsToImport.filter((_, idx) => !skipSet.has(idx));
      }

      const result = await api('/import/execute', {
        method: 'POST',
        body: { rows: rowsToImport, mapping, categoryTypes },
      });
      if (result.error) {
        toast(result.error, 'error');
        return;
      }
      toast(result.message, 'success');
      this.reset();
      if (typeof transactions !== 'undefined') transactions.load();
      if (typeof dashboard !== 'undefined') dashboard.load();
    } finally {
      btn.textContent = origText;
      btn.classList.remove('loading');
    }
  },
  async fetchGoogleSheet() {
    const url = document.getElementById('gs-url').value;
    const id = document.getElementById('gs-id').value;
    if (!url && !id) {
      toast('Please enter a URL or Sheet ID', 'error');
      return;
    }

    // If user has a specific sheet selected, fetch that sheet
    const sheetSelect = document.getElementById('gs-sheet-select');
    const selectedSheet = sheetSelect && sheetSelect.value ? sheetSelect.value : null;

    toast('Fetching Google Sheet...', 'info');
    try {
      const result = await api('/import/googlesheet', {
        method: 'POST',
        body: {
          url: url || `https://docs.google.com/spreadsheets/d/${id}`,
          sheetName: selectedSheet,
        },
      });

      if (result.error) {
        toast(result.error, 'error');
        return;
      }

      // If multiple sheets returned, let user pick
      if (result.sheetNames && result.sheetNames.length > 1 && !result.headers) {
        const selector = document.getElementById('gs-sheet-selector');
        const select = document.getElementById('gs-sheet-select');
        select.innerHTML = result.sheetNames
          .map(
            (s) =>
              `<option value="${s}"${s === result.selectedSheet ? ' selected' : ''}>${s}</option>`
          )
          .join('');
        selector.style.display = 'block';
        toast(`Found ${result.sheetNames.length} sheets. Select one and fetch again.`, 'info');
        return;
      }

      if (!result.headers || result.rows.length === 0) {
        toast('No data found in this sheet', 'error');
        return;
      }

      this.headers = result.headers;
      this.rows = result.rows;
      this.buildMapping({ headers: result.headers, rows: result.rows });
      toast(
        `Loaded "${result.selectedSheet}" with ${result.rows.length} rows! Map columns below.`,
        'success'
      );
    } catch (e) {
      toast('Failed to fetch sheet: ' + e.message, 'error');
    }
  },
  reset() {
    document.getElementById('import-mapping-section').style.display = 'none';
    document.getElementById('import-file-input').value = '';
    document.getElementById('gs-url').value = '';
    document.getElementById('gs-id').value = '';
    document.getElementById('gs-sheet-selector').style.display = 'none';
    document.getElementById('import-sheet-selector').style.display = 'none';
    document.getElementById('column-map').innerHTML = '';
    document.getElementById('import-preview').innerHTML = '';
    document.getElementById('category-review-section').innerHTML = '';
    document.getElementById('import-duplicate-section').innerHTML = '';
    this.fileId = null;
    this.fileData = null;
    this.headers = null;
    this.rows = null;
    this.mapping = {};
    this.detectedCategories = null;
    this.columnTypes = {};
    this.duplicateIndices = [];
    this.skipDuplicates = true;
    this.importLimit = 1000;
    document.querySelectorAll('.import-limit-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('.import-limit-btn:nth-child(3)')?.classList.add('active');
  },
};
window.dataImport = importData;
