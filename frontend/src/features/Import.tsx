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

import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { createStore, produce, reconcile } from 'solid-js/store'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import {
  detectBank,
  listAdapters,
  loadCategoryRules,
  loadTransferRules,
  processFiles,
  resetBankImportRules,
  resolveTargetAccount,
  saveCategoryRules,
  saveTransferRules,
  toDetectInput,
} from '../core/bankImport'
import { loadBankImportMemory, rememberBankImportChoice } from '../core/bankImport/memory'
import { classifyCategory } from '../core/categoryClassifier'
import { autoDetectMapping, FIELD_NAMES } from '../core/importMapping'
import styles from './Import.module.css'
import type { BankId, CategoryRuleSet, StatementMeta, TransferRuleSet } from '../core/bankImport'

/**
 * Indices of rows whose full (trimmed) content is identical to an earlier row in the
 * same import — within-batch duplicates, e.g. the same transaction appearing in two
 * overlapping statement periods uploaded together. The first occurrence is kept; every
 * later identical copy is returned. (Duplicates against already-imported data are
 * handled separately by the server on execute.)
 */
function computeRowDuplicates(rows: string[][]): number[] {
  const seen = new Set<string>()
  const dups: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].map((c) => (c ?? '').trim()).join('\x01')
    if (seen.has(key)) dups.push(i)
    else seen.add(key)
  }
  return dups
}

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

interface ImportLogEntry {
  id: number
  source: string
  imported: number
  duplicates_skipped: number
  accounts_created: number
  categories_created: number
  details: string | null
  created_at: string
}

export default function Import() {
  // Import method tab
  type ImportTab = 'google-sheets' | 'file-upload' | 'paste-csv' | 'bank-imports'
  const [activeImportTab, setActiveImportTab] = createSignal<ImportTab>('google-sheets')

  const profileHeaders = () => {
    const pid = localStorage.getItem('currentProfileId') || '1'
    return { 'X-Profile-Id': pid }
  }

  // Step state
  const [activeStep, setActiveStep] = createSignal<Step>('upload')
  // Opt-in: after import, set each historical month's budgets to its spending
  const [setBudgetsFromSpending, setSetBudgetsFromSpending] = createSignal(false)

  // Import session log (what past imports created; written after each successful import)
  const [importLogs, setImportLogs] = createSignal<ImportLogEntry[]>([])
  const loadImportLogs = async () => {
    try {
      const res = await apiFetch('/api/import-logs', { headers: profileHeaders() })
      if (res.ok) {
        const rows = await res.json()
        if (Array.isArray(rows)) setImportLogs(rows as ImportLogEntry[])
      }
    } catch {
      // Log section simply stays empty
    }
  }

  // File upload state
  const [uploadResult, setUploadResult] = createSignal<UploadResult | null>(null)
  const [selectedSheet, setSelectedSheet] = createSignal<string>('')
  // Getter unused since duplicate detection moved client-side (it was only read by
  // the removed /api/import/file-sheet call); the setter still records the upload id.
  const [_fileId, setFileId] = createSignal<string>('')

  // Google Sheets state
  const [sheetUrl, setSheetUrl] = createSignal<string>('')
  const [sheetResult, setSheetResult] = createSignal<SheetResult | null>(null)
  const [sheetNames, setSheetNames] = createSignal<string[]>([])

  // Paste CSV state
  const [pastedText, setPastedText] = createSignal('')
  const [pasteDelimiter, setPasteDelimiter] = createSignal<'auto' | 'comma' | 'tab'>('auto')

  // Bank Imports state
  interface BankFileRow {
    file: File
    bytes: Uint8Array
    bankId: BankId | null
    confidence: number
    meta: StatementMeta
    targetAccount: string
  }
  const [bankFiles, setBankFiles] = createSignal<BankFileRow[]>([])
  const [bankAccounts, setBankAccounts] = createSignal<
    { id: number; name: string; bank_name?: string | null }[]
  >([])
  const [bankWarnings, setBankWarnings] = createSignal<string[]>([])

  // Editable categorization + transfer rules (persisted per profile). Keywords are
  // edited as comma-separated strings for a friendlier input, split on save.
  const [showBankRules, setShowBankRules] = createSignal(false)
  // Stores (not signals) so editing one row's field updates it in place — a signal
  // + .map() would replace the row object and make <For> recreate the DOM node,
  // dropping input focus on every keystroke.
  const [categoryRuleDraft, setCategoryRuleDraft] = createStore<
    { category: string; keywords: string }[]
  >([])
  const [transferKeywordDraft, setTransferKeywordDraft] = createSignal('')
  const [counterpartDraft, setCounterpartDraft] = createStore<
    { signature: string; account: string }[]
  >([])
  // Existing category names — powers the category-rule combobox (datalist).
  const [bankCategories, setBankCategories] = createSignal<string[]>([])

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
    } finally {
      // Missing on the success path before — the "Processing..." overlay stayed up
      // forever and kept "Continue to Preview" disabled after a successful parse.
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
  const [duplicateIndices, setDuplicateIndices] = createSignal<number[]>([])

  // Loading/error
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // Stable id for the current import so a retry after a failed/partial /execute is idempotent
  // server-side (the worker removes rows already inserted for this id). Cleared on reset.
  const [importId, setImportId] = createSignal('')
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

  // Rows flagged as within-batch duplicates (identical to an earlier row in this
  // import), memoized as a Set for O(1) lookup in the preview table.
  const duplicateSet = createMemo(() => new Set(duplicateIndices()))

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
    // Bank imports precompute duplicates from the RAW statement rows (per-second
    // timestamps / balance intact), so two distinct same-day transactions aren't
    // flagged; other sources fall back to a full canonical-row hash.
    const dups =
      bankFiles().length > 0 ? (uploadResult()?.duplicateIndices ?? []) : computeRowDuplicates(rows)
    setDuplicateIndices(dups)
    const dupSet = new Set(dups)
    // Skip duplicates by default: select every row except the duplicate copies. The
    // user can re-check a duplicate row (or use "Import All") to include it anyway.
    setSelectedRows(new Set<number>(rows.map((_, i) => i).filter((i) => !dupSet.has(i))))
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
    setImportId('')
    // Clear Bank Imports state so a fresh import doesn't inherit stale files/warnings
    // and the preview's rules editor is gated correctly by bankFiles().length.
    setBankFiles([])
    setBankWarnings([])
    setShowBankRules(false)
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

  // ---- Bank Imports ----
  const loadBankAccounts = async () => {
    try {
      const res = await apiFetch('/api/accounts', { headers: profileHeaders() })
      if (!res.ok) return
      const list = await res.json()
      if (Array.isArray(list)) {
        setBankAccounts(
          list.map((a: Record<string, unknown>) => ({
            id: a.id as number,
            name: a.name as string,
            bank_name: (a.bank_name as string) ?? null,
          }))
        )
      }
    } catch {
      // Account picker simply falls back to manual entry
    }
  }

  // Detect the bank + sniff metadata for one file, then best-effort resolve the
  // target account (remembered choice → IBAN/name heuristic).
  const analyzeBankFile = async (file: File): Promise<BankFileRow> => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const det = detectBank(toDetectInput(file.name, bytes))
    let meta: StatementMeta = {}
    if (det) {
      try {
        meta = (await det.adapter.parse(bytes, file.name)).meta
      } catch {
        // Metadata is best-effort; parsing runs again at process time
      }
    }
    const targetAccount = det
      ? (resolveTargetAccount(
          det.adapter.id,
          meta,
          file.name,
          bankAccounts(),
          loadBankImportMemory()
        ) ?? '')
      : ''
    return {
      file,
      bytes,
      bankId: det?.adapter.id ?? null,
      confidence: det?.confidence ?? 0,
      meta,
      targetAccount,
    }
  }

  const addBankFiles = async (files: FileList | File[]) => {
    setError(null)
    const analyzed = await Promise.all(Array.from(files).map(analyzeBankFile))
    // Functional update: two quick drops both await here, so read the latest list
    // at commit time rather than a stale snapshot (else the second drop clobbers
    // the first).
    setBankFiles((prev) => [...prev, ...analyzed])
  }

  const handleBankFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement
    if (target.files?.length) void addBankFiles(target.files)
    target.value = ''
  }

  const handleBankDrop = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer?.files?.length) void addBankFiles(event.dataTransfer.files)
  }

  const updateBankFile = (idx: number, patch: Partial<BankFileRow>) => {
    setBankFiles(bankFiles().map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const removeBankFile = (idx: number) => {
    setBankFiles(bankFiles().filter((_, i) => i !== idx))
  }

  // Parse + transform every recognized file into the canonical table, then hand
  // off to the existing mapping step (which the user confirms/remaps).
  // Core bank transform shared by "Process" (upload) and "Recalculate" (preview):
  // validate the recognized files, run the adapters through the given rules (or the
  // persisted ones), and return the canonical table. Returns null on validation
  // failure (after surfacing the error). Throws propagate to the caller's try.
  const runBankTransform = async (rulesOverride?: {
    categoryRules: CategoryRuleSet
    transferRules: TransferRuleSet
  }) => {
    const recognized = bankFiles().filter((r) => r.bankId)
    if (recognized.length === 0) {
      setError('None of the files were recognized as a supported bank statement')
      return null
    }
    if (recognized.some((r) => !r.targetAccount)) {
      setError('Choose a target account for every recognized file')
      return null
    }
    const knownAccounts = bankAccounts().map((a) => a.name)
    const categoryRules = rulesOverride?.categoryRules ?? loadCategoryRules()
    const stored = rulesOverride?.transferRules ?? loadTransferRules()
    // The user's own account names always count as transfer endpoints, on top of
    // whatever they configured in the rules editor.
    const transferRules = {
      ...stored,
      ownAccounts: Array.from(new Set([...stored.ownAccounts, ...knownAccounts])),
    }
    const result = await processFiles(
      recognized.map((r) => ({
        filename: r.file.name,
        bytes: r.bytes,
        bankId: r.bankId!,
        targetAccount: r.targetAccount,
      })),
      { categoryRules, transferRules, knownAccounts }
    )
    const filename =
      recognized.length === 1 ? recognized[0].file.name : `${recognized.length} statements`
    return { result, recognized, filename }
  }

  const bankUploadResult = (
    result: { headers: string[]; rows: string[][]; duplicateIndices: number[] },
    filename: string
  ) => ({
    headers: result.headers,
    rows: result.rows,
    filename,
    fileId: `bank-${Date.now()}`,
    sheetName: 'Bank Import',
    sheetNames: ['Bank Import'],
    totalRows: result.rows.length,
    duplicateCount: result.duplicateIndices.length,
    duplicateIndices: result.duplicateIndices,
  })

  const processBankFiles = async () => {
    setLoading(true)
    setError(null)
    setBankWarnings([])
    try {
      const outcome = await runBankTransform()
      if (!outcome) return
      const { result, recognized, filename } = outcome
      setBankWarnings(result.warnings)
      // Remember each account choice so the next matching statement auto-routes.
      recognized.forEach((r) => {
        rememberBankImportChoice(r.bankId!, r.meta, r.file.name, r.targetAccount)
      })
      if (result.rows.length === 0) {
        setError('No transactions were found in the selected files')
        return
      }
      setUploadResult(bankUploadResult(result, filename))
      setSheetResult(null)
      setHeaders(result.headers)
      setRows(result.rows)
      goToMapping()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process bank files')
    } finally {
      setLoading(false)
    }
  }

  // ---- Bank import rules editor ----
  const loadBankRules = () => {
    setCategoryRuleDraft(
      reconcile(
        loadCategoryRules().map((r) => ({ category: r.category, keywords: r.keywords.join(', ') }))
      )
    )
    const t = loadTransferRules()
    setTransferKeywordDraft(t.keywords.join(', '))
    setCounterpartDraft(
      reconcile(
        Object.entries(t.counterparts).map(([signature, account]) => ({ signature, account }))
      )
    )
  }

  const loadBankCategories = async () => {
    try {
      const res = await apiFetch('/api/categories', { headers: profileHeaders() })
      if (!res.ok) return
      const list = await res.json()
      if (Array.isArray(list)) {
        const names = list
          .map((c: Record<string, unknown>) => (typeof c.name === 'string' ? c.name : ''))
          .filter(Boolean)
        setBankCategories([...new Set<string>(names)].sort((a, b) => a.localeCompare(b)))
      }
    } catch {
      // Combobox simply offers no suggestions
    }
  }

  // Build rule sets from the editor drafts, persist them, and return them so the
  // caller (Save or Recalculate) can use the exact same values immediately.
  const persistBankRulesFromDraft = (): {
    categoryRules: CategoryRuleSet
    transferRules: TransferRuleSet
  } => {
    const categoryRules = categoryRuleDraft
      .map((r) => ({
        category: r.category.trim(),
        keywords: r.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }))
      .filter((r) => r.category && r.keywords.length > 0)
    saveCategoryRules(categoryRules)

    const keywords = transferKeywordDraft()
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    const counterparts: Record<string, string> = {}
    for (const c of counterpartDraft) {
      const sig = c.signature.trim().toLowerCase()
      if (sig && c.account) counterparts[sig] = c.account
    }
    const transferRules: TransferRuleSet = {
      ownAccounts: loadTransferRules().ownAccounts,
      keywords,
      counterparts,
    }
    saveTransferRules(transferRules)
    return { categoryRules, transferRules }
  }

  const saveBankRules = () => {
    persistBankRulesFromDraft()
    loadBankRules()
    setResultMessage({ type: 'success', text: 'Bank import rules saved.' })
  }

  const resetBankRules = () => {
    resetBankImportRules()
    loadBankRules()
    setResultMessage({ type: 'success', text: 'Bank import rules reset to defaults.' })
  }

  // Re-run the transform with the just-saved edited rules and refresh the preview in
  // place, preserving the user's manual income/expense/account type choices.
  const recalculateBankPreview = async () => {
    setLoading(true)
    setError(null)
    setBankWarnings([])
    try {
      const rules = persistBankRulesFromDraft()
      loadBankRules()
      const outcome = await runBankTransform(rules)
      if (!outcome) return
      const { result, filename } = outcome
      setBankWarnings(result.warnings)
      if (result.rows.length === 0) {
        setError('No transactions after recalculation — check your rules')
        return
      }
      setUploadResult(bankUploadResult(result, filename))
      setSheetResult(null)
      setHeaders(result.headers)
      setRows(result.rows)
      // Headers are unchanged (fixed canonical set), so keep the user's column
      // mapping rather than reverting a manual remap; only auto-detect if none set.
      let mapping = columnMapping()
      if (Object.keys(mapping).length === 0) {
        mapping = autoDetectMapping(result.headers)
        setColumnMapping(mapping)
      }
      if (mapping['category'] !== undefined) {
        const existing = categoryTypes()
        const merged: Record<string, 'income' | 'expense' | 'account'> = {}
        for (const cat of detectCategories()) {
          merged[cat] = existing[cat] ?? classifyCategory(cat)
        }
        setCategoryTypes(merged)
      }
      goToPreview()
      setResultMessage({ type: 'success', text: 'Preview recalculated from your rules.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate the preview')
    } finally {
      setLoading(false)
    }
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

      // "Import only new" skips the within-batch duplicate rows detected on preview.
      // (Duplicates against already-imported data are skipped by the server on execute
      // regardless of mode.)
      const dupCount = duplicateIndices().length
      if (mode === 'new' && dupCount > 0) {
        const dupSet = duplicateSet()
        rowsToImport = rowsToImport.filter((_, i) => !dupSet.has(i))
      }

      // Reuse a stable id across retries so the worker can de-dupe a re-run of the same import.
      let iid = importId()
      if (!iid) {
        iid = window.crypto.randomUUID()
        setImportId(iid)
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
          importId: iid,
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

      // Record the session in the import log (best-effort; the import itself succeeded)
      const source =
        activeImportTab() === 'file-upload'
          ? uploadResult()?.filename || 'File upload'
          : activeImportTab() === 'google-sheets'
            ? `Google Sheet${selectedSheet() ? ` (${selectedSheet()})` : ''}`
            : activeImportTab() === 'bank-imports'
              ? uploadResult()?.filename || 'Bank statements'
              : 'Pasted CSV'
      apiFetch('/api/import-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...profileHeaders() },
        body: JSON.stringify({
          import_id: iid,
          source,
          imported: data.imported ?? 0,
          duplicates_skipped: mode === 'new' ? dupCount : 0,
          accounts_created: data.accounts_created ?? 0,
          categories_created: data.categories_created ?? 0,
          details: JSON.stringify({
            mode,
            created_accounts: data.created_accounts ?? [],
            created_categories: data.created_categories ?? [],
            rows_skipped_invalid: data.skipped ?? 0,
          }),
        }),
      })
        .then(() => loadImportLogs())
        .catch((e: unknown) => {
          console.error('Failed to record import log:', e)
        })

      // Opt-in: set each historical month's budgets to that month's spending so the
      // budget-vs-spent charts aren't empty for imported history.
      if (setBudgetsFromSpending() && (data.imported ?? 0) > 0) {
        try {
          const bf = await apiFetch('/api/budgets/backfill-from-spending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...profileHeaders() },
            body: JSON.stringify({}),
          })
          const bfData = await bf.json()
          if (bfData?.ok) {
            toast(
              `Set budgets for ${bfData.months} month${bfData.months === 1 ? '' : 's'} from spending`,
              'success'
            )
          }
        } catch (e) {
          console.error('Failed to backfill budgets after import:', e)
        }
      }

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
    void loadImportLogs()
    void loadBankAccounts()
    void loadBankCategories()
    loadBankRules()
  })

  // The Bank Imports categorization + transfer rules editor. Rendered on the upload
  // tab, and on the preview step with a Recalculate button that re-runs the transform.
  const bankRulesEditor = (opts: { onRecalculate?: () => void } = {}) => (
    <div style={{ 'margin-top': '16px' }}>
      <button
        class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
        onClick={() => setShowBankRules(!showBankRules())}
      >
        {showBankRules() ? 'Hide' : 'Edit'} categorization &amp; transfer rules
      </button>

      <Show when={showBankRules()}>
        <div
          style={{
            'margin-top': '10px',
            border: '1px solid var(--border)',
            'border-radius': '8px',
            padding: '12px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '14px',
          }}
        >
          <div>
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '6px' }}>
              Category keyword rules
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              A transaction gets the category whose longest matching keyword appears in its
              description (most specific wins). Pick an existing category or type a new one;
              comma-separate keywords.
            </p>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <For each={categoryRuleDraft}>
                {(rule, i) => (
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      'align-items': 'center',
                      'flex-wrap': 'wrap',
                    }}
                  >
                    <input
                      class={styles.ruleField}
                      style={{ flex: '0 0 160px' }}
                      list="bankCategoryList"
                      placeholder="Category (pick or type)"
                      value={rule.category}
                      onInput={(e) => {
                        setCategoryRuleDraft(i(), 'category', e.currentTarget.value)
                      }}
                    />
                    <input
                      class={styles.ruleField}
                      style={{ flex: '1 1 220px' }}
                      placeholder="keyword1, keyword2, ..."
                      value={rule.keywords}
                      onInput={(e) => {
                        setCategoryRuleDraft(i(), 'keywords', e.currentTarget.value)
                      }}
                    />
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        setCategoryRuleDraft(
                          produce((d) => {
                            d.splice(i(), 1)
                          })
                        )
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
              <datalist id="bankCategoryList">
                <For each={bankCategories()}>{(c) => <option value={c} />}</For>
              </datalist>
            </div>
            <button
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                setCategoryRuleDraft(
                  produce((d) => {
                    d.push({ category: '', keywords: '' })
                  })
                )
              }}
            >
              Add category rule
            </button>
          </div>

          <div>
            <p class={styles.mappingLabel} style={{ 'margin-bottom': '6px' }}>
              Transfer rules
            </p>
            <p class={styles.dropzoneHint} style={{ 'margin-bottom': '8px' }}>
              A movement is treated as a transfer when its text contains one of these keywords or
              one of your account names. Map a counterpart signature (a keyword or a card's last 4
              digits) to the account it represents so both sides are linked.
            </p>
            <input
              class={styles.ruleField}
              style={{ width: '100%', 'margin-bottom': '8px' }}
              placeholder="Transfer keywords: top-up, transfer, ibkr, ..."
              value={transferKeywordDraft()}
              onInput={(e) => {
                setTransferKeywordDraft(e.currentTarget.value)
              }}
            />
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
              <For each={counterpartDraft}>
                {(cp, i) => (
                  <div
                    style={{
                      display: 'flex',
                      gap: '6px',
                      'align-items': 'center',
                      'flex-wrap': 'wrap',
                    }}
                  >
                    <input
                      class={styles.ruleField}
                      style={{ flex: '0 0 150px' }}
                      placeholder="Signature (e.g. 1399)"
                      value={cp.signature}
                      onInput={(e) => {
                        setCounterpartDraft(i(), 'signature', e.currentTarget.value)
                      }}
                    />
                    <span style="color: var(--text-secondary);">→</span>
                    <select
                      class={styles.mappingSelect}
                      style={{ flex: '0 0 170px' }}
                      value={cp.account}
                      onChange={(e) => {
                        setCounterpartDraft(i(), 'account', e.currentTarget.value)
                      }}
                    >
                      <option value="">Account…</option>
                      <For each={bankAccounts()}>
                        {(a) => <option value={a.name}>{a.name}</option>}
                      </For>
                    </select>
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        setCounterpartDraft(
                          produce((d) => {
                            d.splice(i(), 1)
                          })
                        )
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>
            <button
              class={`${styles.btn} ${styles.btnOutline} ${styles.btnSm}`}
              style={{ 'margin-top': '8px' }}
              onClick={() => {
                setCounterpartDraft(
                  produce((d) => {
                    d.push({ signature: '', account: '' })
                  })
                )
              }}
            >
              Add counterpart
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            <Show when={opts.onRecalculate}>
              <button
                class={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                disabled={loading()}
                onClick={() => {
                  opts.onRecalculate?.()
                }}
              >
                Recalculate preview
              </button>
            </Show>
            <button
              class={`${styles.btn} ${opts.onRecalculate ? styles.btnOutline : styles.btnPrimary} ${styles.btnSm}`}
              onClick={saveBankRules}
            >
              Save rules
            </button>
            <button
              class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              onClick={resetBankRules}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </Show>
    </div>
  )

  // Data entry step (with tabs for Google Sheets, File Upload, Paste CSV)
  const dataEntryStep = () => (
    <div class={styles.uploadArea}>
      {/* Import method tabs */}
      <div class={styles.tabBar} data-tour="import-methods">
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
        <button
          class={`${styles.tab} ${activeImportTab() === 'bank-imports' ? styles.active : ''}`}
          onClick={() => setActiveImportTab('bank-imports')}
        >
          Bank Imports
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

      {/* Bank Imports Tab */}
      {activeImportTab() === 'bank-imports' && (
        <>
          <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
            Upload bank statements (Revolut, Erste, PBZ). We detect the bank, map each statement to
            one of your accounts and convert it into the standard import table — which you confirm
            on the next step. CSV and XLS supported.
          </p>
          <div
            class={`${styles.dropzone} ${loading() ? styles.disabled : ''}`}
            onDragOver={handleDragOver}
            onDrop={handleBankDrop}
          >
            <input
              type="file"
              id="bank-file-input"
              accept=".csv,.xls,.xlsx"
              multiple
              class={styles.fileInput}
              disabled={loading()}
              onChange={handleBankFileSelect}
            />
            <label for="bank-file-input" class={styles.uploadLabel}>
              <svg
                class={styles.dropzoneIcon}
                width="48"
                height="48"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-6h6v6M8 12h.01M16 12h.01" />
              </svg>
              <p class={styles.dropzoneTitle}>Click or drag bank statements here</p>
              <p class={styles.dropzoneHint}>
                Revolut / Erste (CSV), PBZ (XLS) — multiple files OK
              </p>
            </label>
          </div>

          {bankAccounts().length === 0 && (
            <p class={styles.error} style={{ 'margin-top': '8px' }}>
              You have no accounts yet. Create an account first so statements can be linked to it.
            </p>
          )}

          <Show when={bankFiles().length > 0}>
            <div
              style={{
                'margin-top': '12px',
                display: 'flex',
                'flex-direction': 'column',
                gap: '8px',
              }}
            >
              <For each={bankFiles()}>
                {(row, i) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '8px',
                      'flex-wrap': 'wrap',
                      border: '1px solid var(--border)',
                      'border-radius': '8px',
                      padding: '8px 10px',
                    }}
                  >
                    <span
                      style={{
                        flex: '1 1 180px',
                        'font-size': '13px',
                        'overflow-wrap': 'anywhere',
                      }}
                    >
                      {row.file.name}
                      {row.meta.iban ? (
                        <span style="color: var(--text-secondary);"> · {row.meta.iban}</span>
                      ) : null}
                    </span>
                    <select
                      class={styles.mappingSelect}
                      style={{ 'max-width': '130px' }}
                      value={row.bankId ?? ''}
                      onChange={(e) => {
                        updateBankFile(i(), {
                          bankId: (e.currentTarget.value || null) as BankId | null,
                        })
                      }}
                    >
                      <option value="">Unknown</option>
                      <For each={listAdapters()}>
                        {(a) => <option value={a.id}>{a.label}</option>}
                      </For>
                    </select>
                    <select
                      class={styles.mappingSelect}
                      style={{ 'max-width': '170px' }}
                      value={row.targetAccount}
                      onChange={(e) => {
                        updateBankFile(i(), { targetAccount: e.currentTarget.value })
                      }}
                    >
                      <option value="">Choose account…</option>
                      <For each={bankAccounts()}>
                        {(a) => <option value={a.name}>{a.name}</option>}
                      </For>
                    </select>
                    <button
                      class={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => {
                        removeBankFile(i())
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>

            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              style={{ 'margin-top': '12px' }}
              onClick={processBankFiles}
              disabled={loading()}
            >
              Process &amp; Continue to Mapping
            </button>
          </Show>

          <Show when={bankWarnings().length > 0}>
            <ul
              style={{ 'margin-top': '10px', color: 'var(--text-secondary)', 'font-size': '12px' }}
            >
              <For each={bankWarnings()}>{(w) => <li>{w}</li>}</For>
            </ul>
          </Show>

          {bankRulesEditor()}
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
    // Getters (not plain consts) so the stats stay reactive — e.g. after
    // Recalculate, which refreshes rows/selection/duplicates without remounting
    // the preview (Show doesn't re-run previewStep on a preview→preview change).
    const total = () => currentRows().length
    const selected = () => selectedRows().size
    const duplicates = () => duplicateIndices().length

    return (
      <>
        {/* Stats + Import actions */}
        <div class={styles.actionBar}>
          <div class={styles.previewStats}>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Total Rows</span>
              <span class={styles.statValue}>{total()}</span>
            </div>
            <div class={styles.statItem}>
              <span class={styles.statLabel}>Selected</span>
              <span class={styles.statValue}>{selected()}</span>
            </div>
            {duplicates() > 0 && (
              <div class={styles.statItem}>
                <span class={styles.statLabel}>Duplicates</span>
                <span class={`${styles.statValue} ${duplicates() > 0 ? styles.duplicate : ''}`}>
                  {duplicates()}
                </span>
              </div>
            )}
          </div>
          {duplicates() > 0 && (
            <p style={{ margin: '0 0 12px', 'font-size': '12px', color: 'var(--text-secondary)' }}>
              {duplicates()} duplicate row{duplicates() === 1 ? '' : 's'} (identical to an earlier
              row in this import) unselected by default — check a row, or use "Import All", to
              include it.
            </p>
          )}
          <label
            style={{
              display: 'flex',
              'align-items': 'flex-start',
              gap: '8px',
              margin: '4px 0 14px',
              'font-size': '13px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={setBudgetsFromSpending()}
              onChange={(e) => setSetBudgetsFromSpending(e.currentTarget.checked)}
              style={{ 'margin-top': '2px' }}
            />
            <span>
              Set each month's budget to what was spent that month (fills the budget charts for
              imported history; overwrites existing budgets).
            </span>
          </label>
          <div class={styles.importButtons}>
            <button
              class={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => handleImport('selected')}
              disabled={selectedRows().size === 0}
            >
              Import Selected ({selected()})
            </button>
            {duplicates() > 0 && (
              <button
                class={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => handleImport('new')}
              >
                Import Only New (Skip {duplicates()} Duplicates)
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

        {/* Bank-statement rules: tweak categorization/transfers and recalculate in place */}
        <Show when={bankFiles().length > 0}>
          {bankRulesEditor({ onRecalculate: recalculateBankPreview })}
        </Show>

        {/* Table */}
        <div class={styles.tableWrapper}>
          <table class={styles.previewTable}>
            <thead>
              <tr>
                <th class={styles.selectCol}>
                  <input
                    type="checkbox"
                    checked={selected() === total()}
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
                  const isDuplicate = () => duplicateSet().has(actualIndex)
                  return (
                    <tr
                      classList={{ [styles.duplicate]: isDuplicate() }}
                      title={
                        isDuplicate() ? 'Duplicate of an earlier row in this import' : undefined
                      }
                    >
                      <td class={styles.selectCol}>
                        <input
                          type="checkbox"
                          checked={selectedRows().has(actualIndex)}
                          onChange={() => {
                            toggleRow(actualIndex)
                          }}
                        />
                        <Show when={isDuplicate()}>
                          <span class={styles.dupBadge}>dup</span>
                        </Show>
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
        {total() > rowsPerPage() && (
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
        <h1 data-tour="import-header">Import Transactions</h1>
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

      {/* Import history */}
      <Show when={importLogs().length > 0 && activeStep() === 'upload'}>
        <div class={styles.settingsCard} style={{ 'margin-top': '24px' }}>
          <h2 class={styles.settingsCardTitle}>Recent Imports</h2>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
            <For each={importLogs()}>
              {(log) => {
                const details = (() => {
                  try {
                    return log.details
                      ? (JSON.parse(log.details) as {
                          created_accounts?: string[]
                          created_categories?: string[]
                          rows_skipped_invalid?: number
                        })
                      : null
                  } catch {
                    return null
                  }
                })()
                return (
                  <details
                    style={{
                      border: '1px solid var(--border)',
                      'border-radius': '8px',
                      padding: '10px 14px',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', 'font-size': '14px' }}>
                      <strong>{log.source || 'Import'}</strong>
                      <span style={{ color: 'var(--text-secondary)', 'margin-left': '8px' }}>
                        {new Date(log.created_at).toLocaleString()} — {log.imported} imported
                        {log.duplicates_skipped > 0 &&
                          `, ${log.duplicates_skipped} duplicates skipped`}
                      </span>
                    </summary>
                    <div
                      style={{
                        'font-size': '13px',
                        color: 'var(--text-secondary)',
                        'margin-top': '8px',
                        display: 'flex',
                        'flex-direction': 'column',
                        gap: '4px',
                      }}
                    >
                      <span>Transactions imported: {log.imported}</span>
                      <span>Duplicates skipped: {log.duplicates_skipped}</span>
                      <span>
                        Accounts created: {log.accounts_created}
                        {details?.created_accounts?.length
                          ? ` (${details.created_accounts.join(', ')})`
                          : ''}
                      </span>
                      <span>
                        Categories created: {log.categories_created}
                        {details?.created_categories?.length
                          ? ` (${details.created_categories.join(', ')})`
                          : ''}
                      </span>
                      {(details?.rows_skipped_invalid ?? 0) > 0 && (
                        <span>Rows skipped as invalid: {details!.rows_skipped_invalid}</span>
                      )}
                    </div>
                  </details>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
