import { createMemo, createSignal, For, Show } from 'solid-js'
import formStyles from '../components/Form.module.css'
import styles from '../components/ImportPage.module.css'
import tabsStyles from '../components/Tabs.module.css'
import { apiPost, showToast } from '../utils/api'

// -- Types
type ImportResult = {
  status: 'idle' | 'uploading' | 'previewing' | 'importing' | 'success' | 'error'
  message?: string
  errors?: string[]
}

type TabType = 'file' | 'sheets'
type StepType = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

// 12 mappable fields
const IMPORT_FIELDS = [
  { id: 'date', label: 'Date', required: true },
  { id: 'description', label: 'Description', required: true },
  { id: 'amount', label: 'Amount', required: true },
  { id: 'category', label: 'Category', required: false },
  { id: 'currency', label: 'Currency', required: false },
  { id: 'beneficiary', label: 'Beneficiary', required: false },
  { id: 'payor', label: 'Payor', required: false },
  { id: 'amount_local', label: 'Local Amount', required: false },
  { id: 'means_of_payment', label: 'Payment Means', required: false },
  { id: 'exchange_rate', label: 'Exchange Rate', required: false },
  { id: 'type', label: 'Type (income/expense)', required: false },
  { id: 'notes', label: 'Notes', required: false },
]

export default function Import() {
  // -- State
  const [activeTab, setActiveTab] = createSignal<TabType>('file')
  const [activeStep, setActiveStep] = createSignal<StepType>('upload')
  const [importResult, setImportResult] = createSignal<ImportResult>({ status: 'idle' })

  // Upload/Sheet state
  const [_file, setFile] = createSignal<File | null>(null)
  const [sheetUrl, setSheetUrl] = createSignal('')
  const [fileId, setFileId] = createSignal<string>('')
  const [sheetNames, setSheetNames] = createSignal<string[]>([])
  const [selectedSheet, setSelectedSheet] = createSignal<string>('')

  // Data state
  const [headers, setHeaders] = createSignal<string[]>([])
  const [rows, setRows] = createSignal<any[][]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)

  // Mapping state
  const [columnMapping, setColumnMapping] = createSignal<Record<string, number | null>>({})

  // Preview State
  const [duplicateIndices, setDuplicateIndices] = createSignal<Set<number>>(new Set())
  const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set())
  const [categoryTypes, setCategoryTypes] = createSignal<Record<string, 'income' | 'expense'>>({})

  // Pagination
  const [currentPage, setCurrentPage] = createSignal(1)
  const [rowsPerPage, setRowsPerPage] = createSignal(50)

  // Derived state
  const totalPages = createMemo(() => Math.ceil(rows().length / rowsPerPage()))
  const startRow = createMemo(() => (currentPage() - 1) * rowsPerPage())
  const endRow = createMemo(() => Math.min(startRow() + rowsPerPage(), rows().length))

  // -- Step 1: Upload (File)
  const handleDrop = async (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer?.files.length) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }

  const handleFileSelect = async (f: File) => {
    setFile(f)
    setImportResult({ status: 'uploading', message: 'Uploading file...' })
    try {
      const formData = new FormData()
      formData.append('file', f)
      const res = await apiPost<any>('/api/import/upload', formData, false)

      setFileId(res.fileId)
      setSheetNames(res.sheetNames || [])
      setSelectedSheet(res.sheetNames?.[0] || '')
      setHeaders(res.headers || [])
      setRows(res.data || [])

      autoDetectMapping(res.headers || [])

      if (res.sheetNames && res.sheetNames.length > 1) {
        // keep on upload step to let user select sheet?
        // for now, just auto-select first sheet and proceed to mapping
      }

      setImportResult({ status: 'idle' })
      setActiveStep('mapping')
    } catch (err: any) {
      setImportResult({ status: 'error', message: err.message || 'File upload failed' })
    }
  }

  const handleSheetChange = async (e: Event) => {
    const sheetName = (e.target as HTMLSelectElement).value
    setSelectedSheet(sheetName)
    try {
      setImportResult({ status: 'uploading', message: `Loading sheet ${sheetName}...` })
      const res = await apiPost<any>('/api/import/file-sheet', { fileId: fileId(), sheetName })
      setHeaders(res.headers || [])
      setRows(res.data || [])
      autoDetectMapping(res.headers || [])
      setImportResult({ status: 'idle' })
    } catch (err: any) {
      setImportResult({ status: 'error', message: err.message })
    }
  }

  // -- Step 1: Upload (Google Sheets)
  const handleGoogleSheetsFetch = async () => {
    if (!sheetUrl()) return
    setImportResult({ status: 'uploading', message: 'Fetching Google Sheet...' })
    try {
      const res = await apiPost<any>('/api/import/googlesheet', { url: sheetUrl() })
      setSheetNames(res.sheetNames || [])
      setSelectedSheet(res.sheetNames?.[0] || '')
      setHeaders(res.headers || [])
      setRows(res.data || [])
      autoDetectMapping(res.headers || [])
      setImportResult({ status: 'idle' })
      setActiveStep('mapping')
    } catch (err: any) {
      setImportResult({ status: 'error', message: err.message || 'Google Sheets fetch failed' })
    }
  }

  // -- Step 2: Mapping
  const autoDetectMapping = (h: string[]) => {
    const map: Record<string, number | null> = {}
    IMPORT_FIELDS.forEach((f) => {
      map[f.id] = null
    })

    const lowerH = h.map((x) => (x ? String(x).toLowerCase().trim() : ''))

    const heuristics: Record<string, string[]> = {
      date: ['date', 'datum', 'trans date', 'transaction date'],
      description: ['description', 'desc', 'memo', 'note', 'narration', 'details', 'title'],
      amount: ['amount', 'sum', 'total', 'value', 'suma', 'kwota'],
      category: ['category', 'cat', 'type', 'kategoria'],
      currency: ['currency', 'waluta', 'curr'],
      beneficiary: ['beneficiary', 'beneficjent', 'recipient', 'payee'],
      payor: ['payor', 'payer', 'płatnik', 'from', 'sender'],
      means_of_payment: ['payment', 'method', 'means', 'payment method', 'source'],
      exchange_rate: ['rate', 'exchange rate', 'kurs'],
      notes: ['notes', 'note', 'remark', 'comments'],
      type: ['type', 'typ', 'tx type', 'transaction type', 'in/out'],
      amount_local: ['amount local', 'local amount', 'amount pln', 'kwota oryginalna'],
    }

    Object.entries(heuristics).forEach(([field, keywords]) => {
      for (const kw of keywords) {
        const idx = lowerH.findIndex((header) => header.includes(kw))
        if (idx !== -1) {
          map[field] = idx
          break
        }
      }
    })

    setColumnMapping(map)
  }

  const updateMapping = (fieldId: string, colIndexStr: string) => {
    const colIndex = colIndexStr === '' ? null : parseInt(colIndexStr, 10)
    setColumnMapping((prev) => ({ ...prev, [fieldId]: colIndex }))
  }

  const handlePreviewNext = async () => {
    // Validate required fields
    const reqFields = IMPORT_FIELDS.filter((f) => f.required)
    const missing = reqFields.filter((f) => columnMapping()[f.id] === null)
    if (missing.length > 0) {
      setImportResult({
        status: 'error',
        message: `Missing required fields: ${missing.map((f) => f.label).join(', ')}`,
      })
      return
    }

    setImportResult({
      status: 'previewing',
      message: 'Generating preview and checking duplicates...',
    })

    try {
      // Map rows based on columnMapping
      const mappedRows = rows().map((row) => {
        const mapped: Record<string, any> = {}
        Object.entries(columnMapping()).forEach(([fieldId, colIdx]) => {
          if (colIdx !== null) {
            mapped[fieldId] = row[colIdx]
          }
        })
        return mapped
      })

      // Send to preview endpoint for duplicate detection
      const res = await apiPost<any>('/api/import/preview', { transactions: mappedRows })

      const dups = new Set<number>()
      res.preview.forEach((p: any, idx: number) => {
        if (p.isDuplicate) dups.add(idx)
      })
      setDuplicateIndices(dups)

      // Initialize selected rows (select all by default)
      const selected = new Set<number>()
      rows().forEach((_, i) => selected.add(i))
      setSelectedRows(selected)

      // Extract unique categories to ask user for type
      const catIdx = columnMapping()['category']
      const uniqueCats = new Set<string>()
      if (catIdx !== null) {
        rows().forEach((r) => {
          const cat = r[catIdx] ? String(r[catIdx]).trim() : ''
          if (cat) uniqueCats.add(cat)
        })
      }

      const newCatTypes: Record<string, 'income' | 'expense'> = {}
      uniqueCats.forEach((c) => {
        newCatTypes[c] = 'expense'
      }) // default to expense
      setCategoryTypes(newCatTypes)

      setActiveStep('preview')
      setImportResult({ status: 'idle' })
    } catch (err: any) {
      setImportResult({ status: 'error', message: err.message || 'Preview generation failed' })
    }
  }

  // -- Step 3: Preview & Execution
  const toggleRow = (idx: number) => {
    const s = new Set(selectedRows())
    if (s.has(idx)) s.delete(idx)
    else s.add(idx)
    setSelectedRows(s)
  }

  const executeImport = async (mode: 'all' | 'new' | 'selected') => {
    let finalIndices: number[] = []

    if (mode === 'all') {
      finalIndices = rows().map((_, i) => i)
    } else if (mode === 'new') {
      finalIndices = rows()
        .map((_, i) => i)
        .filter((i) => !duplicateIndices().has(i))
    } else {
      finalIndices = Array.from(selectedRows())
    }

    if (finalIndices.length === 0) {
      showToast('No rows selected for import', 'error')
      return
    }

    setImportResult({ status: 'importing', message: 'Importing transactions...' })

    // Build the payload
    const mappedRows = finalIndices.map((idx) => {
      const row = rows()[idx]
      const mapped: Record<string, any> = {}
      Object.entries(columnMapping()).forEach(([fieldId, colIdx]) => {
        if (colIdx !== null) {
          mapped[fieldId] = row[colIdx]
        }
      })
      // inject resolved category type
      if (mapped.category && categoryTypes()[mapped.category]) {
        mapped.type = categoryTypes()[mapped.category]
      }
      return mapped
    })

    try {
      const res = await apiPost<any>('/api/import/execute', {
        transactions: mappedRows,
        categoryTypes: categoryTypes(),
      })
      showToast(
        `Successfully imported ${res.imported || mappedRows.length} transactions`,
        'success'
      )

      // Reset
      setActiveStep('upload')
      setFile(null)
      setSheetUrl('')
      setRows([])
      setHeaders([])
      setColumnMapping({})
      setImportResult({ status: 'idle' })
    } catch (err: any) {
      setImportResult({ status: 'error', message: err.message || 'Import failed' })
    }
  }

  const resetImport = () => {
    setActiveStep('upload')
    setFile(null)
    setSheetUrl('')
    setRows([])
    setHeaders([])
    setImportResult({ status: 'idle' })
  }

  return (
    <div class="page page-import page-enter">
      <div class={styles.pageHeader}>
        <h1>Import Transactions</h1>
        <p>Import transactions from CSV, Excel, or Google Sheets</p>
      </div>

      <Show when={importResult().status === 'error' || importResult().status === 'success'}>
        <div class={importResult().status === 'success' ? styles.toastSuccess : styles.toastError}>
          {importResult().message}
        </div>
      </Show>

      {/* STEP 1: UPLOAD */}
      <Show when={activeStep() === 'upload'}>
        <div class={styles.importUploadSection}>
          <div class={tabsStyles.tabsContainer} style={{ 'margin-bottom': '2rem' }}>
            <div class={tabsStyles.tabsList}>
              <button
                class={`${tabsStyles.tabButton} ${activeTab() === 'file' ? tabsStyles.active : ''}`}
                onClick={() => setActiveTab('file')}
              >
                File Upload
              </button>
              <button
                class={`${tabsStyles.tabButton} ${activeTab() === 'sheets' ? tabsStyles.active : ''}`}
                onClick={() => setActiveTab('sheets')}
              >
                Google Sheets
              </button>
            </div>
          </div>

          <Show when={activeTab() === 'file'}>
            <div
              class={`${styles.uploadDropzone} ${isDragOver() ? styles.dragOver : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                id="import-file-input"
                accept=".csv,.xlsx,.xls"
                class={styles.importFileInput}
                onChange={(e) => {
                  if (e.target.files?.length) handleFileSelect(e.target.files[0])
                }}
              />
              <label for="import-file-input" class={styles.uploadLabel}>
                <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p>Click or drag and drop your file here</p>
                <p class={styles.uploadHint}>Supported formats: CSV, XLSX, XLS</p>
              </label>
            </div>
          </Show>

          <Show when={activeTab() === 'sheets'}>
            <div class={styles.googleSheetsUpload}>
              <div class={formStyles.formGroup}>
                <label class={formStyles.formLabel}>Google Sheets URL or ID</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <input
                    type="text"
                    class={formStyles.formControl}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={sheetUrl()}
                    onInput={(e) => setSheetUrl(e.target.value)}
                  />
                  <button
                    class={styles.btnPrimary}
                    onClick={handleGoogleSheetsFetch}
                    disabled={!sheetUrl() || importResult().status === 'uploading'}
                  >
                    {importResult().status === 'uploading' ? 'Fetching...' : 'Fetch Sheet'}
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      {/* STEP 2: MAPPING */}
      <Show when={activeStep() === 'mapping'}>
        <div class={styles.mappingSection}>
          <h2>Map Columns</h2>
          <p>Match your file's columns to the required application fields.</p>

          <Show when={sheetNames().length > 1}>
            <div
              class={formStyles.formGroup}
              style={{ 'margin-bottom': '2rem', 'max-width': '300px' }}
            >
              <label class={formStyles.formLabel}>Select Sheet</label>
              <select
                class={formStyles.formControl}
                value={selectedSheet()}
                onChange={handleSheetChange}
              >
                <For each={sheetNames()}>{(name) => <option value={name}>{name}</option>}</For>
              </select>
            </div>
          </Show>

          <div class={styles.mappingGrid}>
            <For each={IMPORT_FIELDS}>
              {(field) => (
                <div class={styles.mappingRow}>
                  <div class={styles.mappingFieldLabel}>
                    {field.label}
                    {field.required && <span class={styles.requiredStar}>*</span>}
                  </div>
                  <select
                    class={formStyles.formControl}
                    value={
                      columnMapping()[field.id] !== null
                        ? columnMapping()[field.id]!.toString()
                        : ''
                    }
                    onChange={(e) => {
                      updateMapping(field.id, e.target.value)
                    }}
                  >
                    <option value="">-- Ignore --</option>
                    <For each={headers()}>
                      {(h, idx) => (
                        <option value={idx}>
                          {h} (Col {idx + 1})
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              )}
            </For>
          </div>

          <div class={styles.importActions} style={{ 'margin-top': '2rem' }}>
            <button class={styles.btnOutline} onClick={resetImport}>
              Cancel
            </button>
            <button class={styles.btnPrimary} onClick={handlePreviewNext}>
              {importResult().status === 'previewing' ? 'Generating...' : 'Next: Preview'}
            </button>
          </div>
        </div>
      </Show>

      {/* STEP 3: PREVIEW */}
      <Show when={activeStep() === 'preview'}>
        <div class={styles.importPreviewSection}>
          <Show when={Object.keys(categoryTypes()).length > 0}>
            <div class={styles.categoryReviewSection}>
              <h3>Review Categories</h3>
              <p>We found some new categories. Please classify them as income or expense.</p>
              <div class={styles.categoryChips}>
                <For each={Object.keys(categoryTypes())}>
                  {(cat) => (
                    <div class={styles.categoryChip}>
                      <span class={styles.categoryChipName}>{cat}</span>
                      <select
                        class={formStyles.formControl}
                        style={{ padding: '0.2rem', 'font-size': '0.85rem', height: 'auto' }}
                        value={categoryTypes()[cat]}
                        onChange={(e) => {
                          setCategoryTypes((prev) => ({
                            ...prev,
                            [cat]: e.target.value as 'income' | 'expense',
                          }))
                        }}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class={styles.previewHeader}>
            <div class={styles.previewStats}>
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Total</span>
                <span class={styles.statValue}>{rows().length}</span>
              </div>
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Duplicates</span>
                <span class={styles.statValue} style={{ color: 'var(--accent-warning)' }}>
                  {duplicateIndices().size}
                </span>
              </div>
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Selected</span>
                <span class={styles.statValue}>{selectedRows().size}</span>
              </div>
            </div>

            <div class={styles.previewActions}>
              <button
                class={styles.btnOutline}
                onClick={() => {
                  const s = new Set<number>()
                  rows().forEach((_, i) => s.add(i))
                  setSelectedRows(s)
                }}
              >
                Select All
              </button>
              <button class={styles.btnOutline} onClick={() => setSelectedRows(new Set())}>
                Deselect All
              </button>
            </div>
          </div>

          <div class={styles.previewTableContainer}>
            <table class={styles.dataTable}>
              <thead>
                <tr>
                  <th class={styles.selectCol}></th>
                  <th style={{ width: '40px' }}>Dup</th>
                  <For each={headers()}>
                    {(h, idx) => {
                      // is this header mapped to anything?
                      const mappedField = IMPORT_FIELDS.find((f) => columnMapping()[f.id] === idx)
                      return (
                        <th>
                          {h}
                          {mappedField && <div class={styles.mappedBadge}>{mappedField.label}</div>}
                        </th>
                      )
                    }}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={rows().slice(startRow(), endRow())}>
                  {(row, sliceIdx) => {
                    const realIdx = startRow() + sliceIdx
                    const isDup = duplicateIndices().has(realIdx)
                    return (
                      <tr
                        class={`${selectedRows().has(realIdx) ? styles.selectedRow : ''} ${isDup ? styles.duplicateRow : ''}`}
                      >
                        <td class={styles.selectCol}>
                          <input
                            type="checkbox"
                            checked={selectedRows().has(realIdx)}
                            onChange={() => {
                              toggleRow(realIdx)
                            }}
                          />
                        </td>
                        <td>
                          {isDup && (
                            <span
                              title="Possible Duplicate"
                              style={{ color: 'var(--accent-warning)', 'font-weight': 'bold' }}
                            >
                              !
                            </span>
                          )}
                        </td>
                        <For each={headers()}>
                          {(_, colIdx) => <td>{String(row[colIdx] ?? '')}</td>}
                        </For>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Show when={rows().length > rowsPerPage()}>
            <div class={styles.pagination}>
              <button
                class={`${styles.btnSm} ${styles.btnGhost}`}
                disabled={currentPage() === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span class={styles.pageInfo}>
                Page {currentPage()} of {totalPages()}
              </span>
              <button
                class={`${styles.btnSm} ${styles.btnGhost}`}
                disabled={currentPage() === totalPages()}
                onClick={() => setCurrentPage((p) => Math.min(totalPages(), p + 1))}
              >
                Next
              </button>
              <select
                class={`${formStyles.formControl} ${styles.pageSize}`}
                value={rowsPerPage()}
                onInput={(e) => {
                  setRowsPerPage(Number(e.target.value))
                  setCurrentPage(1)
                }}
              >
                <option value="10">10 per page</option>
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="100">100 per page</option>
              </select>
            </div>
          </Show>

          {/* Execution Buttons */}
          <div class={styles.importActions} style={{ 'margin-top': '2rem' }}>
            <button class={styles.btnOutline} onClick={resetImport}>
              Cancel
            </button>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                class={styles.btnOutline}
                onClick={() => executeImport('selected')}
                disabled={importResult().status === 'importing'}
              >
                Import Selected ({selectedRows().size})
              </button>
              <button
                class={styles.btnPrimary}
                onClick={() => executeImport('new')}
                disabled={importResult().status === 'importing'}
              >
                Import Only New ({rows().length - duplicateIndices().size})
              </button>
              <button
                class={styles.btnOutline}
                onClick={() => executeImport('all')}
                disabled={importResult().status === 'importing'}
                style={{ color: 'var(--accent-warning)', 'border-color': 'var(--accent-warning)' }}
              >
                Force Import All ({rows().length})
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
