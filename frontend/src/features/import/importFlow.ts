/**
 * Headless import flow controller — every piece of state and every action of the
 * import pipeline (method tabs, file/sheet/paste/bank ingestion, column mapping,
 * category review, preview selection, execute) with no rendering attached.
 *
 * The Import page and the onboarding wizard both create one of these and hand it
 * to the shared step components (ImportDataEntry / ImportMappingStep /
 * ImportPreviewStep), so the two surfaces stay behaviorally identical. Must be
 * called inside a component (it creates memos owned by the caller).
 */

import { createMemo, createSignal } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { toast } from '../../core/api'
import { apiFetch } from '../../core/apiFetch'
import {
  detectBank,
  loadCategoryRules,
  loadRuleGroup,
  loadTransferRules,
  processFiles,
  resetBankImportRules,
  resolveTargetAccount,
  saveCategoryRules,
  saveTransferRules,
  toDetectInput,
} from '../../core/bankImport'
import { loadBankImportMemory, rememberBankImportChoice } from '../../core/bankImport/memory'
import { classifyCategory } from '../../core/categoryClassifier'
import { autoDetectMapping } from '../../core/importMapping'
import type { BankId, CategoryRuleSet, StatementMeta, TransferRuleSet } from '../../core/bankImport'

/**
 * Indices of rows whose full (trimmed) content is identical to an earlier row in the
 * same import — within-batch duplicates, e.g. the same transaction appearing in two
 * overlapping statement periods uploaded together. The first occurrence is kept; every
 * later identical copy is returned. (Duplicates against already-imported data are
 * handled separately by the server on execute.)
 */
export function computeRowDuplicates(rows: string[][]): number[] {
  const seen = new Set<string>()
  const dups: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].map((c) => (c ?? '').trim()).join('\x01')
    if (seen.has(key)) dups.push(i)
    else seen.add(key)
  }
  return dups
}

export interface UploadResult {
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

export interface SheetResult {
  headers: string[]
  rows: string[][]
  sheetNames: string[]
  selectedSheet: string
  duplicateCount?: number
  duplicateIndices?: number[]
}

export type ImportStep = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

export type ImportTab = 'google-sheets' | 'file-upload' | 'paste-csv' | 'bank-imports'

export interface ImportLogEntry {
  id: number
  source: string
  imported: number
  duplicates_skipped: number
  accounts_created: number
  categories_created: number
  details: string | null
  created_at: string
}

export interface BankFileRow {
  file: File
  bytes: Uint8Array
  bankId: BankId | null
  confidence: number
  meta: StatementMeta
  targetAccount: string
}

export interface ImportSummary {
  imported: number
  /** Rows rejected as invalid (bad date/amount). */
  skipped: number
  /**
   * Rows NOT imported because they already exist (in stored data or earlier in
   * the same import) — the batch dups the user deselected plus the ones the
   * dedup pass caught at execute time.
   */
  duplicatesSkipped: number
  createdAccounts: string[]
  createdCategories: string[]
  source: string
}

export interface ImportFlowOptions {
  /** Tab preselected on the data-entry step (page default: google-sheets). */
  initialTab?: ImportTab
  /**
   * The page resets to a fresh upload step 3s after a successful import; an
   * embedding wizard advances its own step instead, so it turns this off.
   */
  autoResetAfterImport?: boolean
  /** Fired once per successful (non-dry-run) execute with the result summary. */
  onImported?: (summary: ImportSummary) => void
}

export function createImportFlow(opts: ImportFlowOptions = {}) {
  const [activeImportTab, setActiveImportTab] = createSignal<ImportTab>(
    opts.initialTab ?? 'google-sheets'
  )

  const profileHeaders = () => {
    const pid = localStorage.getItem('currentProfileId') || '1'
    return { 'X-Profile-Id': pid }
  }

  // Step state
  const [activeStep, setActiveStep] = createSignal<ImportStep>('upload')
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
  const [ruleGroup, setRuleGroup] = createSignal(loadRuleGroup())
  const [categoryRuleDraft, setCategoryRuleDraft] = createStore<
    { category: string; keywords: string }[]
  >([])
  const [transferKeywordDraft, setTransferKeywordDraft] = createSignal('')
  const [counterpartDraft, setCounterpartDraft] = createStore<
    { signature: string; account: string }[]
  >([])
  // Existing category names — powers the category-rule combobox (datalist).
  const [bankCategories, setBankCategories] = createSignal<string[]>([])

  // Column mapping
  const [columnMapping, setColumnMapping] = createSignal<Record<string, number>>({})
  const [categoryTypes, setCategoryTypes] = createSignal<
    Record<string, 'income' | 'expense' | 'account'>
  >({})
  const [accountTypes, setAccountTypes] = createSignal<Record<string, string>>({})
  const [accountBalances, setAccountBalances] = createSignal<Record<string, string>>({})
  const [accountBalanceDates, setAccountBalanceDates] = createSignal<Record<string, string>>({})
  const [universalStartDate, setUniversalStartDate] = createSignal('')

  // Preview state
  const [_rows, setRows] = createSignal<string[][]>([])
  const [_headers, setHeaders] = createSignal<string[]>([])
  const [selectedRows, setSelectedRows] = createSignal<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = createSignal(1)
  const [rowsPerPage, setRowsPerPage] = createSignal(50)
  const [duplicateIndices, setDuplicateIndices] = createSignal<number[]>([])
  // Category-column values with no matching existing category (from the preview's
  // dry-run). The user confirms which to create; unchecked names import uncategorized (B5).
  const [newCategories, setNewCategories] = createSignal<string[]>([])
  const [approvedCategories, setApprovedCategories] = createSignal<Set<string>>(new Set())
  // From the same dry-run: how many rows the dedup pass would skip because they
  // already exist (stored earlier, or repeated within this import). null = the
  // dry-run didn't run / failed, so the preview makes no claim.
  const [existingDuplicates, setExistingDuplicates] = createSignal<number | null>(null)

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

  const goToPreview = async () => {
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
    await fetchDryRunPreview()
  }

  // Dry-run the import so the preview can warn honestly: which category-column
  // values would be newly created (B5, user confirms), and how many rows the
  // dedup pass will skip because they already exist — so a re-import of the
  // same statement reads "nothing new here", not a silent 0.
  const fetchDryRunPreview = async () => {
    setExistingDuplicates(null)
    try {
      const res = await apiFetch('/api/import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...profileHeaders() },
        body: JSON.stringify({
          rows: currentRows(),
          mapping: columnMapping(),
          categoryTypes: categoryTypes(),
          dry_run: true,
        }),
      })
      const data = await res.json()
      const list: string[] = Array.isArray(data?.new_categories) ? data.new_categories : []
      setNewCategories(list)
      setApprovedCategories(new Set(list))
      setExistingDuplicates(typeof data?.duplicates === 'number' ? data.duplicates : null)
    } catch {
      // Non-fatal: fall back to auto-create-all (no approvedCategories sent on
      // import) and no duplicate claim.
      setNewCategories([])
      setApprovedCategories(new Set<string>())
      setExistingDuplicates(null)
    }
  }

  const toggleApprovedCategory = (name: string, checked: boolean) => {
    const next = new Set(approvedCategories())
    if (checked) next.add(name)
    else next.delete(name)
    setApprovedCategories(next)
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
    setNewCategories([])
    setApprovedCategories(new Set<string>())
    setExistingDuplicates(null)
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
    if (file) void handleFileUpload(file)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (file) void handleFileUpload(file)
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
    // Snapshot synchronously — a DataTransfer file list is only guaranteed
    // valid during the drop event.
    const snapshot = Array.from(files)
    if (snapshot.length === 0) return
    // Reading + sniffing a large statement takes a moment; show the loading
    // overlay instead of appearing to ignore the drop. allSettled + the catch
    // below also fix the original silent failure: a rejected analysis used to
    // vanish into a void'ed promise, so the UI simply never reacted and only a
    // second drop "worked".
    setLoading(true)
    try {
      const results = await Promise.allSettled(snapshot.map(analyzeBankFile))
      const analyzed = results
        .filter((r): r is PromiseFulfilledResult<BankFileRow> => r.status === 'fulfilled')
        .map((r) => r.value)
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? snapshot[i].name : null))
        .filter((name): name is string => name !== null)
      if (failed.length > 0) {
        setError(
          `Could not read ${failed.join(', ')} — try dropping the file${failed.length === 1 ? '' : 's'} again`
        )
      }
      if (analyzed.length > 0) {
        // Functional update: two quick drops both await here, so read the latest
        // list at commit time rather than a stale snapshot (else the second drop
        // clobbers the first).
        setBankFiles((prev) => [...prev, ...analyzed])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the dropped files')
    } finally {
      setLoading(false)
    }
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
      await goToPreview()
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
    void fetchGoogleSheet()
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
          // Only gate category creation when the preview surfaced new categories to
          // confirm; otherwise omit the field to keep auto-create-all (B5 backward-compat).
          ...(newCategories().length > 0 ? { approvedCategories: [...approvedCategories()] } : {}),
        }),
      })

      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Import failed')

      // Compose the outcome text ourselves (rather than trusting data.message)
      // so re-imports are honest in BOTH storage modes: rows the dedup pass
      // skipped as already-imported are named, and an all-duplicates run says
      // "nothing new" instead of a bare "Imported 0".
      const importedCount: number = data.imported ?? 0
      const alreadyExisted: number = data.duplicates ?? 0
      const invalidSkipped: number = data.skipped ?? 0
      let text: string
      if (importedCount === 0 && alreadyExisted > 0) {
        text = `No new transactions — all ${alreadyExisted} row${alreadyExisted === 1 ? ' was' : 's were'} already imported before (duplicates are detected and skipped automatically).`
      } else {
        const parts: string[] = []
        if (alreadyExisted > 0) parts.push(`${alreadyExisted} already imported, skipped`)
        if (invalidSkipped > 0) parts.push(`${invalidSkipped} invalid`)
        text = `Imported ${importedCount} transactions${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`
      }
      setResultMessage({ type: 'success', text })

      // Record the session in the import log (best-effort; the import itself succeeded)
      const source =
        activeImportTab() === 'file-upload'
          ? uploadResult()?.filename || 'File upload'
          : activeImportTab() === 'google-sheets'
            ? `Google Sheet${selectedSheet() ? ` (${selectedSheet()})` : ''}`
            : activeImportTab() === 'bank-imports'
              ? uploadResult()?.filename || 'Bank statements'
              : 'Pasted CSV'
      // Total duplicates avoided = batch dups the user left deselected (mode
      // 'new' filters them out client-side) + rows the execute-side dedup
      // skipped as already imported. Without the latter, a repeat import logged
      // "0 imported, 0 duplicates" and looked like data loss.
      const totalDuplicatesSkipped = alreadyExisted + (mode === 'new' ? dupCount : 0)
      apiFetch('/api/import-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...profileHeaders() },
        body: JSON.stringify({
          import_id: iid,
          source,
          imported: importedCount,
          duplicates_skipped: totalDuplicatesSkipped,
          accounts_created: data.accounts_created ?? 0,
          categories_created: data.categories_created ?? 0,
          details: JSON.stringify({
            mode,
            created_accounts: data.created_accounts ?? [],
            created_categories: data.created_categories ?? [],
            rows_skipped_invalid: invalidSkipped,
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

      opts.onImported?.({
        imported: importedCount,
        skipped: invalidSkipped,
        duplicatesSkipped: totalDuplicatesSkipped,
        createdAccounts: data.created_accounts ?? [],
        createdCategories: data.created_categories ?? [],
        source,
      })

      // Reset after delay
      if (opts.autoResetAfterImport !== false) {
        setTimeout(() => {
          resetForm()
        }, 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  // One-time data loads for a surface embedding the flow (page onMount / wizard
  // step open). Sync rule drafts immediately; network loads run in the background.
  const init = () => {
    loadBankRules()
    void loadImportLogs()
    void loadBankAccounts()
    void loadBankCategories()
  }

  return {
    // signals
    activeImportTab,
    setActiveImportTab,
    activeStep,
    setActiveStep,
    setBudgetsFromSpending,
    setSetBudgetsFromSpending,
    importLogs,
    uploadResult,
    selectedSheet,
    setSelectedSheet,
    sheetUrl,
    setSheetUrl,
    sheetResult,
    sheetNames,
    pastedText,
    setPastedText,
    pasteDelimiter,
    setPasteDelimiter,
    bankFiles,
    bankAccounts,
    bankWarnings,
    showBankRules,
    setShowBankRules,
    ruleGroup,
    setRuleGroup,
    categoryRuleDraft,
    setCategoryRuleDraft,
    transferKeywordDraft,
    setTransferKeywordDraft,
    counterpartDraft,
    setCounterpartDraft,
    bankCategories,
    columnMapping,
    categoryTypes,
    accountTypes,
    setAccountTypes,
    accountBalances,
    setAccountBalances,
    accountBalanceDates,
    setAccountBalanceDates,
    universalStartDate,
    selectedRows,
    currentPage,
    setCurrentPage,
    rowsPerPage,
    setRowsPerPage,
    duplicateIndices,
    newCategories,
    approvedCategories,
    existingDuplicates,
    loading,
    error,
    resultMessage,
    // derived
    currentHeaders,
    currentRows,
    duplicateSet,
    detectCategories,
    totalPages,
    startRow,
    endRow,
    // actions
    init,
    loadImportLogs,
    applyUniversalStartDate,
    parsePastedData,
    goToMapping,
    goToPreview,
    toggleApprovedCategory,
    resetForm,
    handleFileSelect,
    handleDragOver,
    handleDrop,
    loadBankAccounts,
    handleBankFileSelect,
    handleBankDrop,
    updateBankFile,
    removeBankFile,
    processBankFiles,
    loadBankRules,
    saveBankRules,
    resetBankRules,
    recalculateBankPreview,
    fetchGoogleSheet,
    handleSheetTabClick,
    handleColumnMappingChange,
    handleCategoryTypeToggle,
    toggleRow,
    toggleAll,
    handleImport,
  }
}

export type ImportFlow = ReturnType<typeof createImportFlow>
