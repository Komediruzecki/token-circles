/**
 * Import Component - EARS Specification
 *
 * GIVEN: A user is on the Import page
 * WHEN: The page loads
 * THEN: Two tabs are visible: "File" and "Google Sheets"
 *
 * GIVEN: A user wants to import from a CSV/Excel file
 * WHEN: They select the File tab and upload a file
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
  category: ['category', 'cat', 'type', 'kategoria'],
  currency: ['currency', 'waluta', 'curr'],
  beneficiary: ['beneficiary', 'beneficjent', 'recipient', 'payee'],
  payor: ['payor', 'payer', 'płatnik', 'from'],
  means_of_payment: ['payment', 'method', 'means', 'payment method'],
  exchange_rate: ['rate', 'exchange rate', 'kurs'],
  notes: ['notes', 'note', 'remark', 'comments'],
  type: ['type', 'typ', 'tx type', 'transaction type'],
  amount_local: ['amount local', 'local amount', 'amount pln'],
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
  // Tab state
  const [activeTab, setActiveTab] = createSignal<'file' | 'sheets'>('file')

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

  // Column mapping
  const [columnMapping, setColumnMapping] = createSignal<Record<string, number>>({})
  const [categoryTypes, setCategoryTypes] = createSignal<Record<string, 'income' | 'expense'>>({})

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
    if (activeTab() === 'file' && uploadResult()) return uploadResult()!.headers
    if (activeTab() === 'sheets' && sheetResult()) return sheetResult()!.headers
    return []
  }

  const currentRows = () => {
    if (activeTab() === 'file' && uploadResult()) return uploadResult()!.rows
    if (activeTab() === 'sheets' && sheetResult()) return sheetResult()!.rows
    return []
  }

  const hasDuplicateCount = () => {
    if (activeTab() === 'file' && uploadResult()) return uploadResult()!.duplicateCount
    if (activeTab() === 'sheets' && sheetResult()) return sheetResult()!.duplicateCount
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
      const catIdx = columnMapping()[currentHeaders()[0]]
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
    setColumnMapping(autoDetectMapping(headers))
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
      const getProfileHeaders = () => {
        const pid = localStorage.getItem('currentProfileId') || '1'
        return { 'X-Profile-Id': pid }
      }

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/import/upload', {
        method: 'POST',
        headers: getProfileHeaders(),
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
      const getProfileHeaders = () => {
        const pid = localStorage.getItem('currentProfileId') || '1'
        return { 'X-Profile-Id': pid }
      }

      const response = await fetch('/api/import/googlesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProfileHeaders() },
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
      const newCategoryTypes: Record<string, 'income' | 'expense'> = {}
      const allCategories = detectCategories()
      allCategories.forEach((cat) => {
        // Default to expense unless type is explicitly set
        newCategoryTypes[cat] = 'expense'
      })
      setCategoryTypes(newCategoryTypes)
    }
  }

  // Category type toggle
  const handleCategoryTypeToggle = (category: string, type: 'income' | 'expense') => {
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

      const getProfileHeaders = () => {
        const pid = localStorage.getItem('currentProfileId') || '1'
        return { 'X-Profile-Id': pid }
      }

      // Server-side duplicate detection for new-only mode
      const dupCount = hasDuplicateCount() ?? 0
      if (mode === 'new' && dupCount > 0) {
        const previewResponse = await fetch('/api/import/file-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getProfileHeaders() },
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

      const response = await fetch('/api/import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProfileHeaders() },
        body: JSON.stringify({
          rows: rowsToImport,
          mapping,
          categoryTypes: types,
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Import failed')

      setResultMessage({
        type: 'success',
        text:
          data.message ||
          `Successfully imported ${data.imported || rowsToImport.length} transactions`,
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
    const types: Record<string, 'income' | 'expense'> = {}
    categories.forEach((cat) => {
      types[cat] = 'expense'
    })
    setCategoryTypes(types)
  })

  // File upload step
  const fileUploadStep = () => (
    <div class={styles.uploadArea}>
      {/* Tabs */}
      <div class={styles.tabBar}>
        <button
          class={`${styles.tab} ${activeTab() === 'file' ? styles.active : ''}`}
          onClick={() => setActiveTab('file')}
        >
          File Upload
        </button>
        <button
          class={`${styles.tab} ${activeTab() === 'sheets' ? styles.active : ''}`}
          onClick={() => setActiveTab('sheets')}
        >
          Google Sheets
        </button>
      </div>

      {/* File Tab */}
      {activeTab() === 'file' && (
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

          {/* Sheet selector if multiple sheets */}
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

          {/* Upload data button */}
          {uploadResult() && (
            <button class={`${styles.btn} ${styles.btnPrimary}`} onClick={goToMapping}>
              Continue to Mapping
            </button>
          )}

          {/* Template download */}
          <div class={styles.templateSection}>
            <p class={styles.dropzoneHint}>Need a template?</p>
            <a
              href="#"
              class={`${styles.btn} ${styles.btnOutline}`}
              onClick={(e) => {
                e.preventDefault()
              }}
            >
              Download Sample Template
            </a>
          </div>
        </>
      )}

      {/* Sheets Tab */}
      {activeTab() === 'sheets' && (
        <>
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

          {/* Sheet tabs from first fetch */}
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
          <h3 class={styles.categoryReviewTitle}>Category Types</h3>
          <div class={styles.categoryChips}>
            <For each={detectCategories()}>
              {(category) => (
                <div class={styles.categoryChip}>
                  <span class={styles.categoryChipName}>{category}</span>
                  <select
                    class={styles.categoryChipSelect}
                    value={categoryTypes()[category] || 'expense'}
                    onChange={(e) => {
                      handleCategoryTypeToggle(category, e.target.value as 'income' | 'expense')
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
        {/* Stats */}
        <div class={styles.previewHeader}>
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
          <div class={styles.previewActions}>
            <button class={`${styles.btn} ${styles.btnOutline}`} onClick={resetForm}>
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

        {/* Import actions */}
        <div class={styles.actionBar}>
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
          </div>
        </div>
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
      <Show when={activeStep() === 'upload'}>{fileUploadStep()}</Show>
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
