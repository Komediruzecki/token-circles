import { validateBody } from '../validation'
import * as h from './localHandlers'
import type { StorageMode } from './storageFactory'

// ── Route types ──────────────────────────────────────────────────────────────

interface RouteContext {
  method: string
  path: string
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}

type Handler = (ctx: RouteContext) => Promise<Response>

interface RouteDef {
  pattern: RegExp
  methods: string[]
  handler: Handler
}

// ── Response helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function methodNotAllowed(method: string, path: string): Response {
  return json({ error: `Method not allowed: ${method} ${path}` }, 405)
}

function notFound(path: string): Response {
  return json({ error: `Not found: ${path}` }, 404)
}

// Stub for routes that will be wired in later phases (LS7-LS14)
// Returns empty/mock data instead of 501 so pages don't error in serverless mode
function stub(_path: string): Handler {
  return dispatch({
    GET: () => Promise.resolve(json([])),
    POST: () => Promise.resolve(json({ id: 1 }, 201)),
    PUT: () => Promise.resolve(json({ ok: true })),
    DELETE: () => Promise.resolve(json({ ok: true })),
    PATCH: () => Promise.resolve(json({ ok: true })),
  })
}

function exchangeRatesStub(): Handler {
  return dispatch({
    GET: () => Promise.resolve(json({ rates: { EUR: 1, USD: 1.08, GBP: 0.85, JPY: 156.0 } })),
  })
}

function singleExchangeRateStub(): Handler {
  return dispatch({
    GET: () => Promise.resolve(json({ rate: 1.08 })),
  })
}

function reportsCustomStub(): Handler {
  return dispatch({
    POST: () => Promise.resolve(json({ report_url: '', generated: false })),
  })
}

function logsStub(): Handler {
  return dispatch({
    GET: () => Promise.resolve(json([])),
    POST: () => Promise.resolve(json({ ok: true })),
  })
}

// ── Dispatcher helper ────────────────────────────────────────────────────────

/** Create a handler that dispatches based on HTTP method to named handlers */
function dispatch(
  handlers: Partial<Record<string, (ctx: RouteContext) => Promise<Response>>>
): Handler {
  return (ctx: RouteContext) => {
    const fn = handlers[ctx.method]
    if (fn) return fn(ctx)
    return Promise.resolve(methodNotAllowed(ctx.method, ctx.path))
  }
}

// ── Route table ──────────────────────────────────────────────────────────────

const routes: RouteDef[] = [
  // ── Health & app info ──
  {
    pattern: /^\/health$/,
    methods: ['GET'],
    handler: () => Promise.resolve(json({ status: 'ok', timestamp: new Date().toISOString() })),
  },
  {
    pattern: /^\/app-info$/,
    methods: ['GET'],
    handler: () =>
      Promise.resolve(
        json({
          name: 'Finance Manager',
          version: '4.0.0',
          mode: 'serverless',
          storage: 'indexeddb',
        })
      ),
  },

  // ── Auth ──
  {
    pattern: /^\/auth\/login$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.authLogin(ctx.body) }),
  },
  {
    pattern: /^\/auth\/check$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.authCheck() }),
  },
  {
    pattern: /^\/auth\/logout$/,
    methods: ['POST'],
    handler: dispatch({ POST: () => h.authLogout() }),
  },
  {
    pattern: /^\/auth\/me$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.authMe() }),
  },

  // ── Profiles ──
  {
    pattern: /^\/profiles$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.profilesList(),
      POST: (ctx) => h.profilesCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/profiles\/(\d+)$/,
    methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.profilesGet(ctx.params),
      PUT: (ctx) => h.profilesUpdate(ctx.params, ctx.body),
      PATCH: (ctx) => h.profilesUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.profilesDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/profile\/data$/,
    methods: ['DELETE'],
    handler: dispatch({ DELETE: () => h.profileResetData() }),
  },
  {
    pattern: /^\/profiles\/reseed-demo$/,
    methods: ['POST'],
    handler: dispatch({ POST: () => h.reseedDemoData() }),
  },

  // ── Settings ──
  {
    pattern: /^\/settings$/,
    methods: ['GET', 'PUT'],
    handler: dispatch({
      GET: () => h.settingsGet(),
      PUT: (ctx) => h.settingsUpdate(ctx.body),
    }),
  },
  {
    pattern: /^\/settings\/set-storage$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.storageModeSet(ctx.body) }),
  },
  {
    pattern: /^\/storage-mode$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.storageModeGet(),
      POST: (ctx) => h.storageModeSet(ctx.body),
    }),
  },

  // ── Dashboard (LS7) ──
  {
    pattern: /^\/dashboard$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.dashboardMain(ctx.query) }),
  },
  {
    pattern: /^\/dashboard\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.dashboardSummary(ctx.query) }),
  },
  {
    pattern: /^\/dashboard\/charts$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.dashboardCharts(ctx.query) }),
  },
  {
    pattern: /^\/dashboard\/net-worth$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.dashboardNetWorth() }),
  },

  // ── Analytics (LS8) ──
  {
    pattern: /^\/analytics$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.analyticsCategoryTrends(ctx.query) }),
  },
  {
    pattern: /^\/analytics\/category-trends$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.analyticsCategoryTrends(ctx.query) }),
  },
  {
    pattern: /^\/analytics\/daily-heatmap$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.analyticsDailyHeatmap(ctx.query) }),
  },
  {
    pattern: /^\/analytics\/sankey$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.analyticsSankey(ctx.query) }),
  },
  {
    pattern: /^\/analytics\/weeks$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.analyticsWeeks(ctx.query) }),
  },
  {
    pattern: /^\/analytics\/distinct-years$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.analyticsDistinctYears() }),
  },

  // ── Transactions ──
  { pattern: /^\/transactions\/summary$/, methods: ['GET'], handler: dispatch({ GET: () => h.transactionsSummary() }) },
  {
    pattern: /^\/transactions$/,
    methods: ['GET', 'POST', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.transactionsList(ctx.query),
      POST: (ctx) => h.transactionsCreate(ctx.body),
      DELETE: () => h.deleteAllTransactions(),
    }),
  },
  {
    pattern: /^\/transactions\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.transactionsGet(ctx.params),
      PUT: (ctx) => h.transactionsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.transactionsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/transactions\/(\d+)\/reconcile$/,
    methods: ['PATCH'],
    handler: dispatch({ PATCH: (ctx) => h.reconcileToggle(ctx.params) }),
  },
  {
    pattern: /^\/transactions\/reconcile\/bulk$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.reconcileBulk(ctx.body) }),
  },
  {
    pattern: /^\/transactions\/reconcile\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.reconcileSummary() }),
  },
  {
    pattern: /^\/transactions\/reconcile-batch$/,
    methods: ['PUT'],
    handler: dispatch({ PUT: (ctx) => h.reconcileBatch(ctx.body) }),
  },
  {
    pattern: /^\/transactions\/export$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.transactionsExport(ctx.query) }),
  },
  {
    pattern: /^\/transactions\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.transactionsSummary() }),
  },

  // ── Categories ──
  {
    pattern: /^\/categories$/,
    methods: ['GET', 'POST', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.categoriesList(ctx.query),
      POST: (ctx) => h.categoriesCreate(ctx.body),
      DELETE: () => h.deleteAllCategories(),
    }),
  },
  {
    pattern: /^\/categories\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.categoriesGet(ctx.params),
      PUT: (ctx) => h.categoriesUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.categoriesDelete(ctx.params),
    }),
  },

  // ── Accounts ──
  {
    pattern: /^\/accounts$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.accountsList(),
      POST: (ctx) => h.accountsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/accounts\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.accountsGet(ctx.params),
      PUT: (ctx) => h.accountsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.accountsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/accounts\/(\d+)\/history$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: (ctx) => h.accountsHistory(ctx.params),
      POST: (ctx) => h.accountsHistoryRecord(ctx.params, ctx.body),
    }),
  },
  {
    pattern: /^\/accounts\/(\d+)\/history\/(\d+)$/,
    methods: ['DELETE'],
    handler: dispatch({ DELETE: (ctx) => h.accountsHistoryDelete(ctx.params) }),
  },

  // ── Budgets ──
  {
    pattern: /^\/budgets$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.budgetsList(),
      POST: (ctx) => h.budgetsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/budgets\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.budgetsGet(ctx.params),
      PUT: (ctx) => h.budgetsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.budgetsDelete(ctx.params),
    }),
  },
  // Budget computations
  {
    pattern: /^\/budgets\/alerts$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsAlerts(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/forecast$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsForecast(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/history$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsHistory(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/improvements$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsImprovements(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsSummary(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/zero-based$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsZeroBased(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/zero-based\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.budgetsZeroBasedSummary(ctx.query) }),
  },
  {
    pattern: /^\/budgets\/allocate$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.budgetsAllocate(ctx.query, ctx.body) }),
  },
  {
    pattern: /^\/budgets\/duplicate-last$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.budgetsDuplicateLast(ctx.body) }),
  },
  {
    pattern: /^\/budgets\/from-expenses$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.budgetsFromExpenses(ctx.body) }),
  },
  {
    pattern: /^\/budgets\/(\d+)\/rollover$/,
    methods: ['PUT'],
    handler: dispatch({ PUT: (ctx) => h.budgetsRollover(ctx.params, ctx.body) }),
  },

  // ── Savings goals ──
  {
    pattern: /^\/savings-goals$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.goalsList(),
      POST: (ctx) => h.goalsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/savings-goals\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.goalsGet(ctx.params),
      PUT: (ctx) => h.goalsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.goalsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/savings-goals\/(\d+)\/contribute$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.goalsContribute(ctx.params, ctx.body) }),
  },

  // ── Loans ──
  {
    pattern: /^\/loans$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.loansList(),
      POST: (ctx) => h.loansCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/loans\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.loansGet(ctx.params),
      PUT: (ctx) => h.loansUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.loansDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/loans\/(\d+)\/rate-periods$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.loanRates(ctx.params) }),
  },
  {
    pattern: /^\/loans\/(\d+)\/rate$/,
    methods: ['PUT'],
    handler: dispatch({ PUT: (ctx) => h.loanRateUpdate(ctx.params, ctx.body) }),
  },
  {
    pattern: /^\/loans\/(\d+)\/rates$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: (ctx) => h.loanRates(ctx.params),
      POST: (ctx) => h.loanRatesAdd(ctx.params, ctx.body),
    }),
  },
  {
    pattern: /^\/loans\/(\d+)\/rates\/(\d+)$/,
    methods: ['PUT', 'DELETE'],
    handler: dispatch({
      PUT: (ctx) => h.loanRateUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.loanRateDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/loans\/(\d+)\/prepayment$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.loanPrepaymentAdd(ctx.params, ctx.body) }),
  },
  {
    pattern: /^\/loans\/(\d+)\/prepayments$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: (ctx) => h.loanPrepayments(ctx.params),
      POST: (ctx) => h.loanPrepaymentAdd(ctx.params, ctx.body),
    }),
  },
  {
    pattern: /^\/loans\/(\d+)\/prepayments\/(\d+)$/,
    methods: ['DELETE'],
    handler: dispatch({ DELETE: (ctx) => h.loanPrepaymentsDelete(ctx.params) }),
  },

  // ── Export / Import / Clear ──
  { pattern: /^\/export$/, methods: ['GET'], handler: dispatch({ GET: () => h.exportAll() }) },
  {
    pattern: /^\/export\/([a-z-]+)$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.exportByType(ctx.params, ctx.query) }),
  },
  {
    pattern: /^\/import$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importData(ctx.body) }),
  },
  {
    pattern: /^\/clear-all$/,
    methods: ['DELETE'],
    handler: dispatch({ DELETE: () => h.clearAll() }),
  },

  // ── Seed ──
  {
    pattern: /^\/categories\/seed$/,
    methods: ['POST'],
    handler: dispatch({ POST: () => h.seedCategories() }),
  },

  // ── Stubs for not-yet-implemented routes (LS11-LS14) ──
  // Transactions (extra): tags, by-tag, bulk
  {
    pattern: /^\/transactions\/(\d+)\/tags$/,
    methods: ['GET', 'POST', 'PUT'],
    handler: stub('/api/transactions/:id/tags'),
  },
  {
    pattern: /^\/transactions\/by-tag\/(\d+)$/,
    methods: ['GET'],
    handler: stub('/api/transactions/by-tag'),
  },
  { pattern: /^\/transactions\/bulk$/, methods: ['PUT'], handler: stub('/api/transactions/bulk') },

  // Categories: mappings, auto-map
  {
    pattern: /^\/categories\/mappings$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: (ctx) => h.categoryMappingsList(ctx.query),
      POST: (ctx) => h.categoryMappingsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/categories\/mappings\/(\d+)$/,
    methods: ['DELETE'],
    handler: dispatch({
      DELETE: (ctx) => h.categoryMappingsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/categories\/auto-map$/,
    methods: ['POST'],
    handler: stub('/api/categories/auto-map'),
  },
  {
    pattern: /^\/categories\/apply-mappings$/,
    methods: ['POST'],
    handler: stub('/api/categories/apply-mappings'),
  },

  // Accounts: timeline, reconciliation-summary
  {
    pattern: /^\/accounts\/history\/timeline$/,
    methods: ['GET'],
    handler: stub('/api/accounts/history/timeline'),
  },
  {
    pattern: /^\/accounts\/(\d+)\/reconciliation-summary$/,
    methods: ['GET'],
    handler: stub('/api/accounts/:id/reconciliation-summary'),
  },

  // Loans: calculate (client-only: returns empty amortization)
  {
    pattern: /^\/loans\/(\d+)\/calculate$/,
    methods: ['POST'],
    handler: dispatch({
      POST: () =>
        Promise.resolve(
          json({
            schedule: [],
            summary: { totalPaid: 0, totalInterest: 0, payoffDate: null, interestSaved: 0 },
          })
        ),
    }),
  },

  // Bills
  {
    pattern: /^\/bills$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: (ctx) => h.billsList(ctx.query),
      POST: (ctx) => h.billsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/bills\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.billsGet(ctx.params),
      PUT: (ctx) => h.billsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.billsDelete(ctx.params),
    }),
  },
  { pattern: /^\/bills\/upcoming$/, methods: ['GET'], handler: dispatch({ GET: () => h.billsUpcoming() }) },
  {
    pattern: /^\/bills\/(\d+)\/(pay|mark-paid)$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.billsPayOrMarkPaid(ctx.params) }),
  },

  // Tags
  {
    pattern: /^\/tags$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.tagsList(),
      POST: (ctx) => h.tagsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/tags\/(\d+)\/transactions$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.tagsGetTransactions(ctx.params) }),
  },

  // Recurring
  {
    pattern: /^\/recurring$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.recurringList(),
      POST: (ctx) => h.recurringCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/recurring\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: () => h.recurringList(),
      PUT: (ctx) => h.recurringUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.recurringDelete(ctx.params),
    }),
  },
  { pattern: /^\/recurring\/upcoming$/, methods: ['GET'], handler: dispatch({ GET: () => h.recurringUpcoming() }) },
  {
    pattern: /^\/recurring\/(\d+)\/populate$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.recurringPopulate(ctx.params) }),
  },

  // Receipts
  {
    pattern: /^\/receipts\/upload$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.receiptsUpload(ctx.body) }),
  },
  {
    pattern: /^\/receipts\/transaction\/(\d+)$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.receiptsGetByTransaction(ctx.params) }),
  },
  {
    pattern: /^\/receipts\/file\/(.+)$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.receiptsGetFileByName(ctx.params) }),
  },
  {
    pattern: /^\/receipts\/(\d+)\/file$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.receiptsGetFile(ctx.params) }),
  },
  {
    pattern: /^\/receipts\/(\d+)$/,
    methods: ['GET', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.receiptsGet(ctx.params),
      DELETE: (ctx) => h.receiptsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/receipts$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.receiptsUpload(ctx.body) }),
  },

  // Import (LS13)
  {
    pattern: /^\/import\/upload$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importUpload(ctx.body) }),
  },
  {
    pattern: /^\/import\/googlesheet$/,
    methods: ['POST'],
    handler: dispatch({ POST: () => h.importGoogleSheet() }),
  },
  {
    pattern: /^\/import\/file-sheet$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importFileSheet(ctx.body) }),
  },
  {
    pattern: /^\/import\/execute$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importExecute(ctx.body) }),
  },
  {
    pattern: /^\/import\/preview$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importBulk(ctx.body) }),
  },
  {
    pattern: /^\/import$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.importUpload(ctx.body) }),
  },

  // Exchange rates (client-only: returns mock rates)
  { pattern: /^\/exchange-rates$/, methods: ['GET'], handler: exchangeRatesStub() },
  {
    pattern: /^\/exchange-rates\/([A-Z]{3})\/([A-Z]{3})$/,
    methods: ['GET'],
    handler: singleExchangeRateStub(),
  },

  // Calculators (LS10)
  { pattern: /^\/retirement$/, methods: ['POST'], handler: stub('/api/retirement') },
  {
    pattern: /^\/retirement\/projection$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.retirementProjection(ctx.query) }),
  },
  {
    pattern: /^\/retirement-goals$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.retirementGoals(),
      POST: (ctx) => h.retirementGoalCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/retirement-goals\/(\d+)$/,
    methods: ['PUT', 'DELETE'],
    handler: dispatch({
      PUT: (ctx) => h.retirementGoalUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.retirementGoalDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/housing$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.housingList(),
      POST: (ctx) => h.housingCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/housing\/(\d+)$/,
    methods: ['GET', 'PUT', 'DELETE'],
    handler: dispatch({
      GET: (ctx) => h.housingGet(ctx.params),
      PUT: (ctx) => h.housingUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.housingDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/housing\/calculate$/,
    methods: ['POST'],
    handler: dispatch({
      POST: () => Promise.resolve(json({ affordable: true, max_price: 300000, monthly_payment: 1200 })),
    }),
  },
  {
    pattern: /^\/calculator\/compound-interest$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.compoundInterest(ctx.body) }),
  },
  {
    pattern: /^\/calculator\/retire$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.retirementCalculate(ctx.body) }),
  },
  {
    pattern: /^\/calculator\/emergency-fund$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.emergencyFund() }),
  },

  // Reports
  {
    pattern:
      /^\/reports\/(annual-pdf|monthly-pdf|pl-summary|pl-summary-pdf|tax-summary|tax-summary-pdf)$/,
    methods: ['GET'],
    handler: dispatch({ GET: (ctx) => h.reportHandler(ctx) }),
  },
  { pattern: /^\/reports\/custom$/, methods: ['POST'], handler: reportsCustomStub() },

  // Stats
  { pattern: /^\/stats\/monthly$/, methods: ['GET'], handler: dispatch({ GET: (ctx) => h.statsMonthly(ctx.query) }) },

  // Logs (client-only: returns empty lists)
  {
    pattern: /^\/logs$/,
    methods: ['GET', 'POST'],
    handler: logsStub(),
  },
  { pattern: /^\/logs\/clear$/, methods: ['POST'], handler: logsStub() },

  // ── Counterparties ──
  {
    pattern: /^\/counterparties$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.getCounterparties() }),
  },

  // ── Portfolio ──
  {
    pattern: /^\/portfolio\/holdings$/,
    methods: ['GET', 'POST'],
    handler: dispatch({
      GET: () => h.portfolioHoldingsList(),
      POST: (ctx) => h.portfolioHoldingsCreate(ctx.body),
    }),
  },
  {
    pattern: /^\/portfolio\/holdings\/(\d+)$/,
    methods: ['PUT', 'DELETE'],
    handler: dispatch({
      PUT: (ctx) => h.portfolioHoldingsUpdate(ctx.params, ctx.body),
      DELETE: (ctx) => h.portfolioHoldingsDelete(ctx.params),
    }),
  },
  {
    pattern: /^\/portfolio\/summary$/,
    methods: ['GET'],
    handler: dispatch({ GET: () => h.portfolioSummary() }),
  },
  {
    pattern: /^\/portfolio\/prices$/,
    methods: ['POST'],
    handler: dispatch({ POST: (ctx) => h.portfolioPrices(ctx.body) }),
  },
]

// ── Router ───────────────────────────────────────────────────────────────────

function extractParams(pattern: RegExp, path: string): Record<string, string> | null {
  const match = path.match(pattern)
  if (!match) return null

  const params: Record<string, string> = {}
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) {
      params[`p${i}`] = match[i]
    }
  }
  return params
}

export async function routeApiRequest(url: string, init?: RequestInit): Promise<Response> {
  const urlObj = new URL(url, window.location.origin)
  const method = init?.method ?? 'GET'
  const path = urlObj.pathname.replace(/^\/api/, '') || '/'

  const query = urlObj.searchParams

  let body: unknown = null
  if (init?.body) {
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else {
      body = init.body
    }
  }

  for (const route of routes) {
    const params = extractParams(route.pattern, path)
    if (params === null) continue

    if (!route.methods.includes(method)) {
      return methodNotAllowed(method, `/api${path}`)
    }

    // Validate request body against Zod schemas
    if (body !== null && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      const validationError = validateBody(method, `/api${path}`, body)
      if (validationError) return validationError
    }

    return route.handler({ method, path: `/api${path}`, params, query, body })
  }

  return notFound(`/api${path}`)
}

export function setStorageMode(_mode: StorageMode): void {
  // Will be wired in LS15 (data migration)
}
