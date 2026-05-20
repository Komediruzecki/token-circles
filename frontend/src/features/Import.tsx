/**
 * Import Component - EARS Specification
 *
 * GIVEN: A user is on the Import page
 * WHEN: The page loads
 * THEN: File Upload and Google Sheets sections are displayed stacked vertically
 *
 * GIVEN: A user wants to import from a CSV/Excel file
 * WHEN: They drag-and-drop or browse for a file
 * THEN: The file content is processed and column mapping UI appears
 *
 * GIVEN: A user uploads a file with headers matching expected fields
 * WHEN: They proceed to mapping
 * THEN: Column select dropdowns auto-populate based on header matches
 *
 * GIVEN: A user maps columns
 * WHEN: They select which columns represent date, description, and amount
 * THEN: The preview table displays rows with mapped data
 *
 * GIVEN: A user uploads a file with duplicate rows
 * WHEN: They preview the data
 * THEN: Duplicate rows are flagged with a visual indicator
 *
 * GIVEN: A user maps category columns
 * WHEN: They select categories and select expense/income
 * THEN: Category type labels (expense/income) are shown next to each category
 *
 * GIVEN: A user wants to import data
 * WHEN: They click "Import all", "Import only new", or "Import selected"
 * THEN: Data is submitted to the backend and success message displays
 */

/**
 * Import Component
 * Handles CSV/Excel file and Google Sheets import with full 12-field column mapping, duplicate detection, and category type review
 */

import { createSignal, For, onMount, Show } from 'solid-js'
import { apiFetch } from '../core/apiFetch'
import { classifyCategory } from '../core/categoryClassifier'
import styles from './Import.module.css'

// Column field names for mapping
const FIELD_NAMES = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'currency', label: 'Currency', required: false },
  { key: 'beneficiary', label: 'Beneficiary', required: false },
  { key: 'payor', label: 'Payor', required: false },
  { key: 'means_of_payment', label: 'Means of Payment', required: false },
  { key: 'exchange_rate', label: 'Exchange Rate', required: false },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'type', label: 'Type', required: false },
  { key: 'amount_local', label: 'Amount Local', required: false },
] as const

// Header name variants for auto-detection
const HEADER_VARIANTS: Record<string, string[]> = {
  date: ['date', 'datum', 'trans date', 'transaction date'],
  description: ['description', 'desc', 'memo', 'note', 'narration', 'details'],
  amount: ['amount', 'sum', 'total', 'value', 'suma'],
  category: ['category', 'cat', 'kategoria'],
  currency: ['currency', 'waluta', 'curr'],
  beneficiary: ['beneficiary', 'beneficjent', 'recipient', 'payee'],
  payor: ['payor', 'payer', 'płatnik', 'from'],
  means_of_payment: ['payment', 'method', 'means', 'payment method'],
  exchange_rate: ['rate', 'exchange rate', 'kurs'],
  notes: ['notes', 'note', 'remark', 'comments'],
  type: ['type', 'typ', 'tx type', 'transaction type'],
  amount_local: [
    'amount local',
    'local amount',
    'amount pln',
    'amount in local currency',
    'local currency',
    'local curr',
    'amount (local)',
    'local value',
    'domestic amount',
  ],
} as const

interface UploadResult {
  fileId: string
  filename: string
  sheetName: string
  sheetNames: string[]
  headers: string[]
  rows: string[][]
  totalRows: number
  duplicateCount?: number
  duplicateIndices?: number[]
}

interface SheetResult {
  headers: string[]
  rows: string[][]
  sheetNames: string[]
  selectedSheet: string
  duplicateCount?: number
  duplicateIndices?: number[]
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

export default function Import() {
  // Import method tab
  type ImportTab = 'google-sheets' | 'file-upload' | 'paste-csv'
  const [activeImportTab, setActiveImportTab] = createSignal<ImportTab>('google-sheets')

  const profileHeaders = () => {
    const pid = localStorage.getItem('currentProfileId') || '1'
    return { 'X-Profile-Id': pid }
  }

  // Step state
  const [activeStep, setActiveStep] = createSignal<Step>('upload')

  // File upload state
  const [uploadResult, setUploadResult] = createSignal<UploadResult | null>(null)
  const [selectedSheet, setSelectedSheet] = createSignal<string>('')
  const [fileId, setFileId] = createSignal<string>('')

  // Google Sheets state
  const [sheetUrl, setSheetUrl] = createSignal<string>('')
  const [sheetResult, setSheetResult] = createSignal<SheetResult | null>(null)
  const [sheetNames, setSheetNames] = createSignal<string[]>([])

  // Paste CSV state
  const [pastedText, setPastedText] = createSignal('')
  const [pasteDelimiter, setPasteDelimiter] = createSignal<'auto' | 'comma' | 'tab'>('auto')

  const parsePastedData = (text: string) => {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      const delim = pasteDelimiter() === 'tab' ? '\t' : pasteDelimiter() === 'comma' ? ',' : ''
      const rows: string[][] = []
      const lines = text.trim().split('\n')
      for (const line of lines) {
        const cols: string[] = []
        let cur = ''
        let inQuotes = false
        for (const ch of line) {
          if (ch === '"') {
            inQuotes = !inQuotes
          } else if (
            (delim && ch === delim) ||
            (!delim && (ch === ',' || ch === '\t') && !inQuotes)
          ) {
            cols.push(cur.trim().replace(/^"|"$/g, ''))
            cur = ''
          } else cur += ch
        }
        cols.push(cur.trim().replace(/^"|"$/g, ''))
        rows.push(cols)
      }
      if (rows.length < 2) {
        setError('Need at least a header row and one data row')
        setLoading(false)
        return
      }
      const headers = rows[0]
      const dataRows = rows.slice(1).filter((r) => r.some((c) => c))
      setUploadResult({
        headers,
        rows: dataRows,
        filename: 'pasted-data.csv',
        fileId: `paste-${Date.now()}`,
        sheetName: 'Pasted',
        sheetNames: ['Pasted'],
        totalRows: dataRows.length,
        duplicateCount: 0,
        duplicateIndices: [],
      })
      setActiveStep('upload')
    } catch {
      setError('Failed to parse pasted data')
      setLoading(false)
    }
  }

  // Column mapping
  const [columnMapping, setColumnMapping] = createSignal<Record<string, number>>({})
  const [categoryTypes, setCategoryTypes] = createSignal<
    Record<string, 'income' | 'expense' | 'account'>
  >({})
  const [accountTypes, setAccountTypes] = createSignal<Record<string, string>>({})
  const [accountBalances, setAccountBalances] = createSignal<Record<string, string>>({})
  const [accountBalanceDates, setAccountBalanceDates] = createSignal<Record<string, string>>({})
  const [universalStartDate, setUniversalStartDate] = createSignal('')

  const applyUniversalStartDate = (date: string) => {
    setUniversalStartDate(date)
    if (!date) return
    const types = categoryTypes()
    const dates = { ...accountBalanceDates() }
    for (const cat of detectCategories()) {
      if (types[cat] === 'account') {
        dates[cat] = date
      }
    }
    setAccountBalanceDates(dates)
  }

  // Preview state
  const [_rows, setRows] = createSignal<string[][]>([])
  const [_headers, setHeaders] = createSignal<string[]>([])
  const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = createSignal(1)
  const [rowsPerPage, setRowsPerPage] = createSignal(50)
  const [duplicateIndices, _setDuplicateIndices] = createSignal<number[]>([])

  // Loading/error
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [resultMessage, setResultMessage] = createSignal<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const currentHeaders = () => {
    if (uploadResult()) return uploadResult()!.headers
    if (sheetResult()) return sheetResult()!.headers
    return []
  }

  const currentRows = () => {
    if (uploadResult()) return uploadResult()!.rows
    if (sheetResult()) return sheetResult()!.rows
    return []
  }

  const hasDuplicateCount = () => {
    if (uploadResult()) return uploadResult()!.duplicateCount
    if (sheetResult()) return sheetResult()!.duplicateCount
    return 0
  }

  // Calculate auto-detection mapping
  const autoDetectMapping = (headers: string[]) => {
    const mapping: Record<string, number> = {}
    FIELD_NAMES.forEach((field) => {
      const variants = HEADER_VARIANTS[field.key]
      const lowerHeaders = headers.map((h) => h.toLowerCase())
      const idx = lowerHeaders.findIndex((h) => variants.some((v) => h.includes(v.toLowerCase())))
      if (idx !== -1) {
        mapping[field.key] = idx
      }
    })
    return mapping
  }

  // Detect unique categories
  const detectCategories = () => {
    const categories = new Set<string>()
    currentRows().forEach((row) => {
      const catIdx = columnMapping()['category']
      if (catIdx !== undefined && row[catIdx]) {
        const catName = row[catIdx].trim()
        if (catName) categories.add(catName)
      }
    })
    return Array.from(categories)
  }

  // Step navigation
  const goToMapping = () => {
    const headers = currentHeaders()
    if (headers.length === 0) return
    setActiveStep('mapping')
    const mapping = autoDetectMapping(headers)
    setColumnMapping(mapping)

    // Initialize category types when category column is auto-detected
    if (mapping['category'] !== undefined) {
      const categories = detectCategories()
      const types: Record<string, 'income' | 'expense' | 'account'> = {}
      categories.forEach((cat) => {
        types[cat] = classifyCategory(cat)
      })
      setCategoryTypes(types)
    }
  }

  const goToPreview = () => {
    const rows = currentRows()
    if (rows.length === 0) return
    setActiveStep('preview')
    setSelectedRows(new Set<number>(rows.map((_, i) => i)))
    setCurrentPage(1)
  }

  const resetForm = () => {
    setActiveStep('upload')
    setUploadResult(null)
    setSheetResult(null)
    setSelectedSheet('')
    setFileId('')
    setSheetUrl('')
    setColumnMapping({})
    setCategoryTypes({})
    setRows([])
    setHeaders([])
    setSelectedRows(new Set<number>())
    setCurrentPage(1)
    setError(null)
    setResultMessage(null)
  }

  // File upload
  const handleFileUpload = async (file: File) => {
    setLoading(true)
    setError(null)
    setResultMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await apiFetch('/api/import/upload', {
        method: 'POST',
        headers: profileHeaders(),
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Upload failed')

      setUploadResult(data)
      setSelectedSheet(data.sheetNames[0])
      setFileId(data.fileId)
      setHeaders(data.headers)
      setRows(
        data.rows.slice(1).filter((r: string[]) => r.some((c) => c !== undefined && c !== ''))
      )
      setActiveStep('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    if (file) handleFileUpload(file)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) handleFileUpload(file)
  }

  // Google Sheets fetch
  const fetchGoogleSheet = async () => {
    const url = sheetUrl()
    if (!url) {
      setError('Please enter a Google Sheets URL')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await apiFetch('/api/import/googlesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...profileHeaders() },
        body: JSON.stringify({ url, sheetName: selectedSheet() }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Failed to fetch Google Sheet')

      setSheetNames(data.sheetNames || [])
      setSheetResult({
        ...data,
        rows: data.rows || [],
        headers: data.headers || [],
        sheetNames: data.sheetNames || [],
        selectedSheet: data.selectedSheet,
      })
      setSelectedSheet(data.selectedSheet || data.sheetNames?.[0] || '')
      setHeaders(data.headers || [])
      setRows(data.rows || [])

      // If returning with specific sheet and we have headers, go to mapping
      if (selectedSheet() && data.headers && data.headers.length > 0) {
        goToMapping()
      } else {
        setActiveStep('upload')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Google Sheet')
    } finally {
      setLoading(false)
    }
  }

  const handleSheetTabClick = (sheetName: string) => {
    setSelectedSheet(sheetName)
    // Fetch the sheet data
    fetchGoogleSheet()
  }

  // Column mapping changes
  const handleColumnMappingChange = (field: string, index: number) => {
    const mapping = { ...columnMapping() }
    mapping[field] = index
    setColumnMapping(mapping)

    // Detect category types when category column changes
    if (field === 'category') {
      const newCategoryTypes: Record<string, 'income' | 'expense' | 'account'> = {}
      const allCategories = detectCategories()
      allCategories.forEach((cat) => {
        newCategoryTypes[cat] = classifyCategory(cat)
      })
      setCategoryTypes(newCategoryTypes)
    }
  }

  // Category type toggle
  const handleCategoryTypeToggle = (category: string, type: 'income' | 'expense' | 'account') => {
    const types = { ...categoryTypes() }
    types[category] = type
    setCategoryTypes(types)
  }

  // Preview actions
  const toggleRow = (index: number) => {
    const selected: Set<number> = new Set(selectedRows())
    if (selected.has(index)) {
      selected.delete(index)
    } else {
      selected.add(index)
    }
    setSelectedRows(selected)
  }

  const toggleAll = (select: boolean) => {
    const allSelected = new Set<number>()
    if (select) {
      currentRows().forEach((_, i) => allSelected.add(i))
    }
    setSelectedRows(allSelected)
  }

  const totalPages = () => {
    return Math.ceil(currentRows().length / rowsPerPage())
  }

  const startRow = () => {
    return (currentPage() - 1) * rowsPerPage()
  }

  const endRow = () => {
    return Math.min(startRow() + rowsPerPage(), currentRows().length)
  }

  // Import execution
  const handleImport = async (mode: 'all' | 'new' | 'selected') => {
    setLoading(true)
    setError(null)
    setResultMessage(null)

    try {
      const mapping = columnMapping()
      const types = categoryTypes()

      // Get rows to import
      let rowsToImport = currentRows()
      if (mode === 'selected') {
        rowsToImport = rowsToImport.filter((_, i) => selectedRows().has(i))
      }

      // Server-side duplicate detection for new-only mode
      const dupCount = hasDuplicateCount() ?? 0
      if (mode === 'new' && dupCount > 0) {
        const previewResponse = await apiFetch('/api/import/file-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...profileHeaders() },
          body: JSON.stringify({
            fileId: fileId(),
            sheetName: selectedSheet(),
            mapping,
          }),
        })

        const previewData = await previewResponse.json()
        if (previewData.duplicateIndices) {
          rowsToImport = rowsToImport.filter((_, i) => !previewData.duplicateIndices!.includes(i))
        }
      }

      const response = await apiFetch('/api/import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...profileHeaders() },
        body: JSON.stringify({
          rows: rowsToImport,
          mapping,
          categoryTypes: types,
          accountTypes: accountTypes(),
          accountBalances: accountBalances(),
          accountBalanceDates: accountBalanceDates(),
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Import failed')

      setResultMessage({
        type: 'success',
        text:
          data.message ||
          `Imported ${data.imported ?? 0} transactions${data.skipped ? ` (${data.skipped} skipped)` : ''}`,
      })

      // Reset after delay
      setTimeout(() => {
        resetForm()
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    // Initialize default category types with discovered categories
    const categories = detectCategories()
    const types: Record<string, 'income' | 'expense' | 'account'> = {}
    categories.forEach((cat) => {
      types[cat] = classifyCategory(cat)
    })
    setCategoryTypes(types)
  })

  // Data entry step (with tabs for Google Sheets, File Upload, Paste CSV)
  const dataEntryStep = () => (
    <div class={styles.uploadArea}>
      {/* Import method tabs */}
      <div class={styles.tabBar}>
        <button
          class={`${styles.tab} ${activeImportTab() === 'google-sheets' ? styles.active : ''}`}
          onClick={() => setActiveImportTab('google-sheets')}
        >
          Google Sheets
        </button>
        <button
          class={`${styles.tab} ${activeImportTab() === 'file-upload' ? styles.active : ''}`}
          onClick={() => setActiveImportTab('file-upload')}
        >
          File Upload
        </button>
        <button
          class={`${styles.tab} ${activeImportTab() === 'paste-csv' ? styles.active : ''}`}
          onClick={() => setActiveImportTab('paste-csv')}
        >
          Paste CSV
        </button>
      </div>

      {/* Google Sheets Tab */}
      {activeImportTab() === 'google-sheets' && (
        <>
          <div class={styles.settingsCard} style={{ 'margin-bottom': '16px' }}>
            <h3 class={styles.settingsCardTitle}>Expected Columns</h3>
            <div class={styles.tableWrapper} style={{ 'margin-bottom': 0 }}>
              <table class={styles.previewTable}>
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Required</th>
                    <th>Sample Data</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Date</td>
                    <td>Yes</td>
                    <td>2024-01-15</td>
                  </tr>
                  <tr>
                    <td>Description</td>
                    <td>Yes</td>
                    <td>Grocery Store Purchase</td>
                  </tr>
                  <tr>
                    <td>Amount</td>
                    <td>Yes</td>
                    <td>-45.99</td>
                  </tr>
                  <tr>
                    <td>Category</td>
                    <td>No</td>
                    <td>Groceries</td>
                  </tr>
                  <tr>
                    <td>Currency</td>
                    <td>No</td>
                    <td>EUR</td>
                  </tr>
                  <tr>
                    <td>Beneficiary</td>
                    <td>No</td>
                    <td>Supermarket Inc.</td>
                  </tr>
                  <tr>
                    <td>Payor</td>
                    <td>No</td>
                    <td>John Doe</td>
                  </tr>
                  <tr>
                    <td>Means of Payment</td>
                    <td>No</td>
                    <td>Credit Card</td>
                  </tr>
                  <tr>
                    <td>Exchange Rate</td>
                    <td>No</td>
                    <td>1.0</td>
                  </tr>
                  <tr>
                    <td>Notes</td>
                    <td>No</td>
                    <td>Weekly shopping</td>
                  </tr>
                  <tr>
                    <td>Type</td>
                    <td>No</td>
                    <td>expense</td>
                  </tr>
                  <tr>
                    <td>Amount Local</td>
                    <td>No</td>
                    <td>-45.99</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class={styles.sheetsInfo} style={{ 'margin-top': '12px', 'margin-bottom': 0 }}>
              Column names are auto-detected. Use the downloadable template below for guaranteed
              matching.
            </p>
          </div>

          <div class={styles.sheetsUrlRow}>
            <input
              type="text"
              class={styles.sheetsUrlInput}
              placeholder="Paste Google Sheets URL"
              value={sheetUrl()}
              onInput={(e) => setSheetUrl(e.target.value)}
            />
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={fetchGoogleSheet}
              disabled={loading()}
            >
              Fetch
            </button>
          </div>
          <p class={styles.sheetsInfo}>
            Google Sheets URL format: https://docs.google.com/spreadsheets/d/...
          </p>

          {sheetNames().length > 0 && !sheetResult() && (
            <div class={styles.sheetsUrlRow}>
              <label class={styles.sheetsInfo}>Available sheets:</label>
              <div class={styles.sheetTabs}>
                <For each={sheetNames()}>
                  {(name) => (
                    <button
                      class={`${styles.sheetTab} ${selectedSheet() === name ? styles.active : ''}`}
                      onClick={() => {
                        handleSheetTabClick(name)
                      }}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}

          {sheetResult() && (
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={goToMapping}
              style={{ 'margin-top': '16px' }}
            >
              Continue to Mapping
            </button>
          )}
        </>
      )}

      {/* File Upload Tab */}
      {activeImportTab() === 'file-upload' && (
        <>
          <div
            class={`${styles.dropzone} ${loading() ? styles.disabled : ''}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            id="import-dropzone"
          >
            <input
              type="file"
              id="import-file-input"
              accept=".csv,.xlsx,.xls"
              class={styles.fileInput}
              disabled={loading()}
              onChange={handleFileSelect}
            />
            <label for="import-file-input" class={styles.uploadLabel}>
              <svg
                class={styles.dropzoneIcon}
                width="48"
                height="48"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p class={styles.dropzoneTitle}>Click or drag and drop your file here</p>
              <p class={styles.dropzoneHint}>Supported formats: CSV, XLSX, XLS</p>
            </label>
          </div>

          {uploadResult() && uploadResult()!.sheetNames.length > 1 && (
            <div class={styles.sheetsUrlRow}>
              <label class={styles.sheetsInfo}>Available sheets:</label>
              <div class={styles.sheetTabs}>
                <For each={uploadResult()!.sheetNames}>
                  {(name) => (
                    <button
                      class={`${styles.sheetTab} ${selectedSheet() === name ? styles.active : ''}`}
                      onClick={() => setSelectedSheet(name)}
                    >
                      {name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}

          {uploadResult() && (
            <button class={`${styles.btn} ${styles.btnPrimary}`} onClick={goToMapping}>
              Continue to Mapping
            </button>
          )}

          <div class={styles.templateSection}>
            <p class={styles.dropzoneHint}>Need a template?</p>
            <button
              class={`${styles.btn} ${styles.btnOutline}`}
              onClick={() => {
                const header = [
                  'Date',
                  'Description',
                  'Amount',
                  'Category',
                  'Currency',
                  'Beneficiary',
                  'Payor',
                  'Means of Payment',
                  'Exchange Rate',
                  'Notes',
                  'Type',
                  'Amount Local',
                ]
                const rows: string[][] = [
                  [
                    '2024-01-01',
                    'Salary January',
                    '3200.00',
                    'Salary',
                    'EUR',
                    'Employer Inc.',
                    'Employer Inc.',
                    'Bank Transfer',
                    '1.0',
                    'Monthly salary',
                    'income',
                    '3200.00',
                  ],
                  [
                    '2024-01-02',
                    'Rent Payment',
                    '-950.00',
                    'Rent',
                    'EUR',
                    'Landlord Ltd.',
                    'John Doe',
                    'Bank Transfer',
                    '1.0',
                    'January rent',
                    'expense',
                    '-950.00',
                  ],
                  [
                    '2024-01-03',
                    'Grocery Store',
                    '-78.35',
                    'Groceries',
                    'EUR',
                    'Supermarket',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Weekly groceries',
                    'expense',
                    '-78.35',
                  ],
                  [
                    '2024-01-04',
                    'Electric Bill',
                    '-112.50',
                    'Utilities',
                    'EUR',
                    'Power Co.',
                    'John Doe',
                    'Direct Debit',
                    '1.0',
                    'January electricity',
                    'expense',
                    '-112.50',
                  ],
                  [
                    '2024-01-05',
                    'Gas Station',
                    '-55.00',
                    'Transport',
                    'EUR',
                    'Fuel Station',
                    'John Doe',
                    'Credit Card',
                    '1.0',
                    'Fuel for car',
                    'expense',
                    '-55.00',
                  ],
                  [
                    '2024-01-06',
                    'Internet Bill',
                    '-39.99',
                    'Utilities',
                    'EUR',
                    'ISP Provider',
                    'John Doe',
                    'Direct Debit',
                    '1.0',
                    'Monthly internet',
                    'expense',
                    '-39.99',
                  ],
                  [
                    '2024-01-07',
                    'Restaurant Dinner',
                    '-62.40',
                    'Dining',
                    'EUR',
                    'Bella Italia',
                    'John Doe',
                    'Credit Card',
                    '1.0',
                    'Dinner with friends',
                    'expense',
                    '-62.40',
                  ],
                  [
                    '2024-01-08',
                    'Gym Membership',
                    '-45.00',
                    'Health',
                    'EUR',
                    'FitLife Gym',
                    'John Doe',
                    'Direct Debit',
                    '1.0',
                    'Monthly gym fee',
                    'expense',
                    '-45.00',
                  ],
                  [
                    '2024-01-10',
                    'Freelance Work',
                    '450.00',
                    'Freelance',
                    'EUR',
                    'Client XYZ',
                    'Client XYZ',
                    'Bank Transfer',
                    '1.0',
                    'Website project',
                    'income',
                    '450.00',
                  ],
                  [
                    '2024-01-12',
                    'Phone Bill',
                    '-29.99',
                    'Utilities',
                    'EUR',
                    'Telecom Co.',
                    'John Doe',
                    'Direct Debit',
                    '1.0',
                    'Monthly phone plan',
                    'expense',
                    '-29.99',
                  ],
                  [
                    '2024-01-14',
                    'Pharmacy',
                    '-23.50',
                    'Health',
                    'EUR',
                    'City Pharmacy',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Vitamins and supplies',
                    'expense',
                    '-23.50',
                  ],
                  [
                    '2024-01-15',
                    'Cinema Tickets',
                    '-28.00',
                    'Entertainment',
                    'EUR',
                    'CineMax',
                    'John Doe',
                    'Credit Card',
                    '1.0',
                    'Movie night',
                    'expense',
                    '-28.00',
                  ],
                  [
                    '2024-01-17',
                    'Transfer to Savings',
                    '-500.00',
                    'Savings',
                    'EUR',
                    'My Savings Account',
                    'John Doe',
                    'Bank Transfer',
                    '1.0',
                    'Monthly savings',
                    'expense',
                    '-500.00',
                  ],
                  [
                    '2024-01-18',
                    'Grocery Store',
                    '-85.20',
                    'Groceries',
                    'EUR',
                    'Supermarket',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Weekly groceries',
                    'expense',
                    '-85.20',
                  ],
                  [
                    '2024-01-20',
                    'Clothing Purchase',
                    '-120.00',
                    'Shopping',
                    'EUR',
                    'Fashion Store',
                    'John Doe',
                    'Credit Card',
                    '1.0',
                    'Winter jacket',
                    'expense',
                    '-120.00',
                  ],
                  [
                    '2024-01-22',
                    'Car Insurance',
                    '-185.00',
                    'Insurance',
                    'EUR',
                    'AutoInsure Ltd.',
                    'John Doe',
                    'Bank Transfer',
                    '1.0',
                    'Quarterly payment',
                    'expense',
                    '-185.00',
                  ],
                  [
                    '2024-01-24',
                    'Grocery Store',
                    '-72.10',
                    'Groceries',
                    'EUR',
                    'Supermarket',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Weekly groceries',
                    'expense',
                    '-72.10',
                  ],
                  [
                    '2024-01-25',
                    'Online Course',
                    '-49.99',
                    'Education',
                    'EUR',
                    'EduPlatform',
                    'John Doe',
                    'Credit Card',
                    '1.0',
                    'Programming course',
                    'expense',
                    '-49.99',
                  ],
                  [
                    '2024-01-27',
                    'Haircut',
                    '-30.00',
                    'Personal Care',
                    'EUR',
                    'Barber Shop',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Monthly haircut',
                    'expense',
                    '-30.00',
                  ],
                  [
                    '2024-01-29',
                    'Restaurant Lunch',
                    '-18.50',
                    'Dining',
                    'EUR',
                    'Cafe Central',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Lunch break',
                    'expense',
                    '-18.50',
                  ],
                  [
                    '2024-01-31',
                    'Grocery Store',
                    '-68.75',
                    'Groceries',
                    'EUR',
                    'Supermarket',
                    'John Doe',
                    'Debit Card',
                    '1.0',
                    'Weekly groceries',
                    'expense',
                    '-68.75',
                  ],
                  [
                    '2024-02-01',
                    'Salary February',
                    '3200.00',
                    'Salary',
                    'EUR',
                    'Employer Inc.',
                    'Employer Inc.',
                    'Bank Transfer',
                    '1.0',
                    'Monthly salary',
                    'income',
                    '3200.00',
                  ],
                ]
                const csv = [header, ...rows].map((r) => r.join(',')).join('\n')
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'finance_import_template.csv'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download Sample Template
            </button>
          </div>
        </>
      )}

      {/* Paste CSV Tab */}
      {activeImportTab() === 'paste-csv' && (
        <>
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
            Paste tabular data directly from Excel, Google Sheets, or any spreadsheet application.
            Works guaranteed in serverless mode — no CORS restrictions.
          </p>
          <div
            style={{ 'margin-bottom': '8px', display: 'flex', gap: '8px', 'align-items': 'center' }}
          >
            <select
              class={styles.formControl}
              value={pasteDelimiter()}
              onchange={(e) => setPasteDelimiter(e.currentTarget.value as 'auto' | 'comma' | 'tab')}
              style={{ 'max-width': '140px' }}
            >
              <option value="auto">Auto-detect</option>
              <option value="comma">Comma (,)</option>
              <option value="tab">Tab</option>
            </select>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => {
                parsePastedData(pastedText())
              }}
              disabled={loading() || !pastedText().trim()}
            >
              Parse Pasted Data
            </button>
          </div>
          <textarea
            class={styles.formControl}
            placeholder="Paste CSV or TSV data here (include header row)&#10;Example:&#10;date,description,amount&#10;2024-01-15,Grocery Store,-45.99&#10;2024-01-16,Salary,3200.00"
            value={pastedText()}
            oninput={(e) => setPastedText(e.currentTarget.value)}
            rows={8}
            style={{ resize: 'vertical', 'font-family': 'monospace', 'font-size': '12px' }}
          />
          {uploadResult() && activeImportTab() === 'paste-csv' && (
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={goToMapping}
              style={{ 'margin-top': '12px' }}
            >
              Continue to Mapping
            </button>
          )}
        </>
      )}
    </div>
  )

  // Column mapping step
  const mappingStep = () => {
    const headers = currentHeaders()
    return (
      <>
        <div class={styles.mappingSection}>
          <h2 class={styles.mappingTitle}>Map Columns</h2>
          <p class={styles.mappingSubtitle}>
            Map your data columns to the 12 required fields. Fields in bold are required.
          </p>

          <div class={styles.mappingGrid}>
            {FIELD_NAMES.map((field) => (
              <div class={styles.mappingField}>
                <label class={styles.mappingLabel}>
                  {field.label}
                  {field.required && <span class={styles.required}>*</span>}
                </label>
                <select
                  class={styles.mappingSelect}
                  value={columnMapping()[field.key] ?? ''}
                  onChange={(e) => {
                    handleColumnMappingChange(field.key, parseInt(e.target.value))
                  }}
                >
                  <option value="">-- Select column --</option>
                  {headers.map((h, i) => (
                    <option value={i}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Category type review */}
        <div class={styles.categoryReview}>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '16px',
              'margin-bottom': '16px',
              'flex-wrap': 'wrap',
            }}
          >
            <h3 class={styles.categoryReviewTitle} style={{ margin: 0 }}>
              Category Types
            </h3>
            <label
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '6px',
                'font-size': '13px',
                color: 'var(--text-secondary)',
              }}
            >
              Tracking start date:
              <input
                type="date"
                value={universalStartDate()}
                onchange={(e) => {
                  applyUniversalStartDate(e.currentTarget.value)
                }}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  'border-radius': '4px',
                  'font-size': '13px',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                }}
              />
            </label>
          </div>
          <div style="max-height: 400px; overflow-y: auto;">
            <table class={styles.categoryTable}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th class={styles.categoryTableType}>Type</th>
                  <th class={styles.categoryTableConfig}>Account Setup</th>
                </tr>
              </thead>
              <tbody>
                <For each={detectCategories()}>
                  {(category) => {
                    const currentType = () => categoryTypes()[category] || 'expense'
                    const isAccount = () => currentType() === 'account'
                    return (
                      <tr>
                        <td class={styles.categoryTableName}>{category}</td>
                        <td class={styles.categoryTableType}>
                          <div class={styles.pillGroup}>
                            <button
                              class={`${styles.pill} ${currentType() === 'expense' ? styles.expenseActive : ''}`}
                              onClick={() => {
                                handleCategoryTypeToggle(category, 'expense')
                              }}
                            >
                              Expense
                            </button>
                            <button
                              class={`${styles.pill} ${currentType() === 'income' ? styles.incomeActive : ''}`}
                              onClick={() => {
                                handleCategoryTypeToggle(category, 'income')
                              }}
                            >
                              Income
                            </button>
                            <button
                              class={`${styles.pill} ${isAccount() ? styles.accountActive : ''}`}
                              onClick={() => {
                                handleCategoryTypeToggle(category, 'account')
                              }}
                            >
                              Account
                            </button>
                          </div>
                        </td>
                        <td class={styles.categoryTableConfig}>
                          {isAccount() ? (
                            <div class={styles.accountConfig}>
                              <select
                                class={styles.accountTypeSelect}
                                value={accountTypes()[category] || 'giro'}
                                onchange={(e) => {
                                  const v = { ...accountTypes() }
                                  v[category] = e.currentTarget.value
                                  setAccountTypes(v)
                                }}
                              >
                                <option value="giro">Giro</option>
                                <option value="savings">Savings</option>
                                <option value="ib">Investment</option>
                                <option value="cash">Cash</option>
                              </select>
                              <input
                                type="text"
                                inputmode="decimal"
                                class={styles.accountBalanceInput}
                                placeholder="Starting balance"
                                title="Account starting balance"
                                value={accountBalances()[category] || ''}
                                oninput={(e) => {
                                  const v = { ...accountBalances() }
                                  v[category] = e.currentTarget.value
                                  setAccountBalances(v)
                                }}
                              />
                              <input
                                type="date"
                                class={styles.accountDateInput}
                                placeholder="Start date"
                                title="Date the account was opened or when tracking began"
                                value={accountBalanceDates()[category] || ''}
                                onchange={(e) => {
                                  const v = { ...accountBalanceDates() }
                                  v[category] = e.currentTarget.value
                                  setAccountBalanceDates(v)
                                }}
                              />
                            </div>
                          ) : (
                            <span style="color:var(--text-secondary);font-size:12px;">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    )
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </div>

        <div class={styles.previewHeader}>
          <span>
            Total Rows: {currentRows().length} | Mapped: {Object.keys(columnMapping()).length}/12
          </span>
          <div class={styles.previewActions}>
            <button class={`${styles.btn} ${styles.btnOutline}`} onClick={resetForm}>
              Cancel
            </button>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={goToPreview}
              disabled={loading()}
            >
              Continue to Preview
            </button>
          </div>
        </div>
      </>
    )
  }

  // Preview step
  const previewStep = () => {
    const headers = currentHeaders()
    const total = currentRows().length
    const selected = selectedRows().size
    const duplicates = duplicateIndices().length

    return (
      <>
        {/* Stats + Import actions */}
        <div class={styles.actionBar}>
          <div class={styles.previewStats}>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Total Rows</span>
              <span class={styles.statValue}>{total}</span>
            </div>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Selected</span>
              <span class={styles.statValue}>{selected}</span>
            </div>
            {duplicates > 0 && (
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Duplicates</span>
                <span class={`${styles.statValue} ${duplicates > 0 ? styles.duplicate : ''}`}>
                  {duplicates}
                </span>
              </div>
            )}
          </div>
          <div class={styles.importButtons}>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => handleImport('selected')}
              disabled={selectedRows().size === 0}
            >
              Import Selected ({selected})
            </button>
            {duplicates > 0 && (
              <button
                class={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => handleImport('new')}
              >
                Import Only New (Skip {duplicates} Duplicates)
              </button>
            )}
            <button
              class={`${styles.btn} ${styles.btnOutline}`}
              onClick={() => handleImport('all')}
            >
              Import All
            </button>
            <button class={`${styles.btn} ${styles.btnGhost}`} onClick={resetForm}>
              Cancel
            </button>
          </div>
        </div>

        {/* Table */}
        <div class={styles.tableWrapper}>
          <table class={styles.previewTable}>
            <thead>
              <tr>
                <th class={styles.selectCol}>
                  <input
                    type="checkbox"
                    checked={selected === total}
                    onChange={(e) => {
                      toggleAll(e.currentTarget.checked)
                    }}
                  />
                </th>
                {headers.map((h) => (
                  <th>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <For each={currentRows().slice(startRow(), endRow())}>
                {(row, idx) => {
                  const actualIndex = startRow() + idx()
                  return (
                    <tr>
                      <td class={styles.selectCol}>
                        <input
                          type="checkbox"
                          checked={selectedRows().has(actualIndex)}
                          onChange={() => {
                            toggleRow(actualIndex)
                          }}
                        />
                      </td>
                      <For each={row}>{(cell) => <td>{cell ?? ''}</td>}</For>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > rowsPerPage() && (
          <div class={styles.pagination}>
            <button
              class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
              disabled={currentPage() === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              Previous
            </button>
            <span class={styles.pageInfo}>
              Page {currentPage()} of {totalPages()}
            </span>
            <button
              class={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
              disabled={currentPage() === totalPages()}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </button>
            <select
              class={styles.pageSize}
              value={rowsPerPage()}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value))
                setCurrentPage(1)
              }}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        )}
      </>
    )
  }

  return (
    <div class={`${styles.container} ${styles.pageImport}`}>
      <div class={styles.pageHeader}>
        <h1>Import Transactions</h1>
        <p>Import transactions from CSV, Excel, or Google Sheets</p>
      </div>

      {/* Error message */}
      <Show when={error()}>
        <div class={`${styles.resultMessage} ${styles.error}`}>{error()}</div>
      </Show>

      {/* Success message */}
      <Show when={resultMessage()}>
        <div class={`${styles.resultMessage} ${styles.success}`}>{resultMessage()!.text}</div>
      </Show>

      {/* Loading overlay */}
      <Show when={loading()}>
        <div class={styles.loadingOverlay}>
          <div class={styles.spinner}></div>
          <p class={styles.loadingText}>Processing...</p>
        </div>
      </Show>

      {/* Form content */}
      <Show when={activeStep() === 'upload'}>{dataEntryStep()}</Show>
      <Show when={activeStep() === 'mapping'}>{mappingStep()}</Show>
      <Show when={activeStep() === 'preview'}>{previewStep()}</Show>

      {/* Done state */}
      <Show when={activeStep() === 'done'}>
        <div class={styles.settingsCard}>
          <h2 class={styles.settingsCardTitle}>Import Complete!</h2>
          <p>Transactions have been successfully imported.</p>
          <button
            class={`${styles.btn} ${styles.btnPrimary} ${styles.settingsCardActions}`}
            onClick={resetForm}
          >
            Import More
          </button>
        </div>
      </Show>
    </div>
  )
}
