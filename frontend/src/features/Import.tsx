/**
 * Import Component
 * Handles CSV and Excel file import with preview and duplicate detection
 */

import { createSignal, createEffect, onMount, For } from 'solid-js'
import { api } from '../core/api.js'

// Load XLSX from global scope (built into the bundle)
const XLSX =
  (window as any).XLSX ||
  (() => {
    throw new Error('XLSX library not loaded')
  })

type ImportResult = {
  status: 'idle' | 'uploading' | 'previewing' | 'importing' | 'success' | 'error'
  message?: string
  errors?: string[]
}

interface PreviewData {
  headers: string[]
  rows: any[][]
  totalRows: number
  totalPages: number
  duplicates?: number
  estimatedImport?: number
}

export default function Import() {
  const [file, setFile] = createSignal<File | null>(null)
  const [fileContent, setFileContent] = createSignal<any[]>([])
  const [headers, setHeaders] = createSignal<string[]>([])
  const [previewData, setPreviewData] = createSignal<PreviewData | null>(null)
  const [importResult, setImportResult] = createSignal<ImportResult>({ status: 'idle' })
  const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = createSignal(1)
  const [rowsPerPage, setRowsPerPage] = createSignal(10)

  const [formData, setFormData] = createSignal({
    date: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    type: 'expense',
    category: '',
  })

  // Parse CSV content
  const parseCSV = (text: string): any[] => {
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
    const result: any[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''))
      const row: any = {}
      headers.forEach((header, index) => {
        let val = values[index] || ''
        // Try to parse numbers
        if (!isNaN(parseFloat(val))) {
          val = parseFloat(val)
        }
        row[header] = val
      })
      result.push(row)
    }

    return result
  }

  // Parse Excel content
  const parseExcel = async (binary: ArrayBuffer): Promise<any[]> => {
    try {
      const workbook = XLSX.read(binary, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
      return data
    } catch (err) {
      throw new Error('Failed to parse Excel file')
    }
  }

  // Handle file upload
  const handleFileUpload = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const uploadedFile = target.files?.[0]
    if (!uploadedFile) return

    setFile(uploadedFile)
    setImportResult({ status: 'uploading', message: 'Parsing file...' })
    setSelectedRows(new Set())

    try {
      const text = await uploadedFile.text()
      let data: any[]

      const ext = uploadedFile.name.toLowerCase().split('.').pop()
      if (ext === 'csv') {
        data = parseCSV(text)
      } else if (ext === 'xlsx' || ext === 'xls') {
        data = await parseExcel(await uploadedFile.arrayBuffer())
      } else {
        throw new Error('Unsupported file format. Please use CSV or Excel.')
      }

      if (data.length === 0) {
        setImportResult({ status: 'error', message: 'File appears to be empty or invalid' })
        return
      }

      setFileContent(data)
      setHeaders(Object.keys(data[0]))
      setCurrentPage(1)
      setImportResult({ status: 'previewing' })
    } catch (err) {
      setImportResult({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to parse file',
      })
    }
  }

  // Show/hide row toggle
  const toggleRow = (index: number) => {
    const newSelected = new Set(selectedRows())
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedRows(newSelected)
  }

  // Select/deselect all rows
  const toggleAll = (select: boolean) => {
    const allSelected = fileContent().length > 0
    if (select) {
      setSelectedRows(new Set(fileContent().map((_, i) => i)))
    } else {
      setSelectedRows(new Set())
    }
  }

  // Start import
  const startImport = async () => {
    setImportResult({ status: 'importing', message: 'Importing data...' })
    setSelectedRows(new Set())

    try {
      // Get selected rows
      const rowsToImport = fileContent().filter((_, i) => selectedRows().has(i))

      if (rowsToImport.length === 0) {
        setImportResult({ status: 'error', message: 'No rows selected for import' })
        return
      }

      // Transform data for API
      const apiData = {
        categories: [],
        accounts: [],
        transactions: rowsToImport.map((row) => ({
          date: row.date || formData().date,
          description: row.description || row.name || row.category || row.Transaction || 'Untitled',
          amount: parseFloat(row.amount || row.Amount || row.Money || row.Cost || 0),
          type: row.type || row.Type || row.CategoryType || 'expense',
          category_name: row.category || row.Category || row.CategoryName || '',
          notes: row.notes || row.Note || row.Description || '',
          means_of_payment: row.payment || row.Payment || row.Method || '',
        })),
      }

      // Check duplicates first
      const previewRes = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiData),
      })

      const preview = await previewRes.json()
      if (preview.duplicateTransactions > 0) {
        if (
          !confirm(
            `This import will add ${preview.newTransactions} new transactions and skip ${preview.duplicateTransactions} existing duplicates. Continue?`
          )
        ) {
          setImportResult({ status: 'idle' })
          return
        }
      }

      // Execute import
      const importRes = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiData),
      })

      const result = await importRes.json()

      if (importRes.ok) {
        setImportResult({
          status: 'success',
          message: `Successfully imported ${result.imported || apiData.transactions.length} transactions`,
        })
        // Clear file after successful import
        setFile(null)
        setFileContent([])
        setHeaders([])
        setPreviewData(null)
        setSelectedRows(new Set())
      } else {
        setImportResult({ status: 'error', message: result.error || 'Import failed' })
      }
    } catch (err) {
      setImportResult({
        status: 'error',
        message: err instanceof Error ? err.message : 'Import failed',
      })
    }
  }

  // Reset
  const resetImport = () => {
    setFile(null)
    setFileContent([])
    setHeaders([])
    setPreviewData(null)
    setImportResult({ status: 'idle' })
    setSelectedRows(new Set())
    setCurrentPage(1)
    setFormData({
      date: new Date().toISOString().split('T')[0],
      description: '',
      amount: '',
      type: 'expense',
      category: '',
    })
  }

  // Get pagination info
  const totalPages = () => {
    return Math.ceil(fileContent().length / rowsPerPage())
  }

  const startRow = () => {
    return (currentPage() - 1) * rowsPerPage()
  }

  const endRow = () => {
    return Math.min(startRow() + rowsPerPage(), fileContent().length)
  }

  onMount(() => {
    // Listen for data-action events
    window.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement
      const actionTrigger = target.closest('[data-action]') as HTMLElement
      if (!actionTrigger) return

      const action = actionTrigger.dataset.action
      if (action === 'import:start') {
        startImport()
      } else if (action === 'import:reset') {
        resetImport()
      }
    })
  })

  return (
    <div class="page page-import page-enter">
      <div class="page-header">
        <h1>Import Transactions</h1>
        <p>Import transactions from CSV or Excel files</p>
      </div>

      {/* Import Result */}
      {(importResult().status === 'success' || importResult().status === 'error') && (
        <div class={`toast toast-${importResult().status === 'success' ? 'success' : 'error'}`}>
          {importResult().message}
          {importResult().errors && importResult().errors.length > 0 && (
            <details>
              <summary>View errors</summary>
              <ul>
                {importResult().errors?.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* File Upload Section */}
      {!fileContent().length ? (
        <div class="import-upload-section">
          <div class="upload-dropzone" id="import-dropzone">
            <input
              type="file"
              id="import-file-input"
              accept=".csv,.xlsx,.xls"
              class="import-file-input"
              data-action="import:file"
            />
            <label for="import-file-input" class="upload-label">
              <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p>Click or drag and drop your file here</p>
              <p class="upload-hint">Supported formats: CSV, XLSX, XLS</p>
            </label>
          </div>

          {/* Sample Template */}
          <div class="import-template">
            <h3>Need a template?</h3>
            <p>Download a sample CSV file to get started:</p>
            <a href="#" class="btn btn-outline" data-action="import:download-template">
              Download Sample Template
            </a>
          </div>

          {/* Import Options */}
          <div class="import-options">
            <h3>Default Import Settings</h3>
            <div class="form-group">
              <label class="form-label">Default Date</label>
              <input
                type="date"
                class="form-control"
                value={formData().date}
                oninput={(e) => setFormData({ ...formData(), date: e.target.value })}
              />
            </div>
            <div class="form-group">
              <label class="form-label">Default Type</label>
              <select
                class="form-control"
                value={formData().type}
                oninput={(e) => setFormData({ ...formData(), type: e.target.value as any })}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Preview Section */}
          <div class="import-preview-section">
            <div class="preview-header">
              <div class="preview-stats">
                <div class="stat-item">
                  <span class="stat-label">Total Rows</span>
                  <span class="stat-value">{fileContent().length}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Selected</span>
                  <span class="stat-value">{selectedRows().size}</span>
                </div>
              </div>
              <div class="preview-actions">
                <button class="btn btn-outline" data-action="import:select-all" data-arg="all">
                  Select All
                </button>
                <button class="btn btn-outline" data-action="import:select-all" data-arg="none">
                  Deselect All
                </button>
                <button class="btn btn-outline" data-action="import:select-page">
                  Select Page
                </button>
                <button class="btn btn-outline" data-action="import:preview-template">
                  Change File
                </button>
              </div>
            </div>

            <div class="preview-table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th class="select-col">
                      <input
                        type="checkbox"
                        checked={
                          selectedRows().size === fileContent().length && fileContent().length > 0
                        }
                        onchange={(e) => toggleAll(e.currentTarget.checked)}
                      />
                    </th>
                    {headers().map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileContent()
                    .slice(startRow(), endRow())
                    .map((row, idx) => (
                      <tr
                        key={startRow() + idx}
                        class={selectedRows().has(startRow() + idx) ? 'selected' : ''}
                      >
                        <td class="select-col">
                          <input
                            type="checkbox"
                            checked={selectedRows().has(startRow() + idx)}
                            onchange={() => toggleRow(startRow() + idx)}
                          />
                        </td>
                        {headers().map((h) => (
                          <td key={h}>{String(row[h] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {fileContent().length > rowsPerPage() && (
              <div class="pagination">
                <button
                  class="btn btn-sm btn-ghost"
                  disabled={currentPage() === 1}
                  data-action="import:page"
                  data-arg="prev"
                >
                  Previous
                </button>
                <span class="page-info">
                  Page {currentPage()} of {totalPages()}
                </span>
                <button
                  class="btn btn-sm btn-ghost"
                  disabled={currentPage() === totalPages()}
                  data-action="import:page"
                  data-arg="next"
                >
                  Next
                </button>
                <select
                  class="form-control page-size"
                  value={rowsPerPage()}
                  oninput={(e) => {
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
            )}

            {/* Import Actions */}
            <div class="import-actions">
              <button class="btn btn-outline" data-action="import:reset">
                Cancel
              </button>
              <button class="btn btn-primary" data-action="import:start">
                Import {selectedRows().size} Transaction{selectedRows().size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
