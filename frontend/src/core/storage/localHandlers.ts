/**
 * Local API Handlers — barrel re-export from domain handler modules
 *
 * All handler implementations live in src/core/storage/handlers/.
 * This file re-exports them for the local API router.
 */

// Auth
export { authCheck, authLogin, authLogout, authMe } from './handlers/auth'

// Profiles
export {
  profileResetData,
  profilesCreate,
  profilesDelete,
  profilesGet,
  profilesList,
  profilesUpdate,
} from './handlers/profiles'

// Settings
export { settingsGet, settingsUpdate, storageModeGet, storageModeSet } from './handlers/settings'

// Transactions
export {
  reconcileBatch,
  reconcileBulk,
  reconcileSummary,
  reconcileToggle,
  transactionsBulk,
  transactionsCreate,
  transactionsDelete,
  transactionsExport,
  transactionsGet,
  transactionsList,
  transactionsSummary,
  transactionsUpdate,
} from './handlers/transactions'

// Categories
export {
  categoriesApplyMappings,
  categoriesAutoMap,
  categoriesCreate,
  categoriesDelete,
  categoriesGet,
  categoriesList,
  categoriesUpdate,
} from './handlers/categories'

// Accounts
export {
  accountsCreate,
  accountsDelete,
  accountsGet,
  accountsHistory,
  accountsHistoryDelete,
  accountsHistoryRecord,
  accountsList,
  accountsReconciliationSummary,
  accountsTimeline,
  accountsUpdate,
} from './handlers/accounts'

// Goals
export {
  goalsContribute,
  goalsCreate,
  goalsDelete,
  goalsGet,
  goalsList,
  goalsUpdate,
} from './handlers/goals'

// Loans
export {
  loanPrepaymentAdd,
  loanPrepayments,
  loanPrepaymentsDelete,
  loanRateDelete,
  loanRates,
  loanRatesAdd,
  loanRateUpdate,
  loansCalculate,
  loansCreate,
  loansDelete,
  loansGet,
  loansList,
  loansUpdate,
} from './handlers/loans'

// Housing
export {
  housingCalculate,
  housingCreate,
  housingDelete,
  housingGet,
  housingList,
  housingUpdate,
} from './handlers/housing'

// Bills
export {
  billsCalendar,
  billsCreate,
  billsDelete,
  billsGet,
  billsList,
  billsPayOrMarkPaid,
  billsUpcoming,
  billsUpdate,
} from './handlers/bills'

// Tags
export {
  tagsCreate,
  tagsDelete,
  tagsGetTransactions,
  tagsList,
  tagsUpdate,
  transactionsByTag,
  transactionTagsGet,
  transactionTagsSet,
} from './handlers/tags'

// Category Mappings
export {
  categoryMappingsCreate,
  categoryMappingsDelete,
  categoryMappingsList,
} from './handlers/categoryMappings'

// Recurring
export {
  recurringCreate,
  recurringDelete,
  recurringGet,
  recurringList,
  recurringPopulate,
  recurringUpcoming,
  recurringUpdate,
} from './handlers/recurring'

// Import / Export / Dashboard
export {
  clearAll,
  dashboardCharts,
  dashboardMain,
  dashboardNetWorth,
  dashboardSummary,
  deleteAllCategories,
  deleteAllTransactions,
  exportAll,
  exportByType,
  importData,
  reseedDemoData,
} from './handlers/importExport'

// Analytics
export {
  analyticsCategoryTrends,
  analyticsDailyHeatmap,
  analyticsDistinctYears,
  analyticsSankey,
  analyticsWeeks,
  seedCategories,
  statsMonthly,
} from './handlers/analytics'

// Calculators
export {
  compoundInterest,
  emergencyFund,
  retirementCalculate,
  retirementGoalCreate,
  retirementGoalDelete,
  retirementGoalUpdate,
  retirementGoals,
  retirementProjection,
} from './handlers/calculators'

// Receipts
export {
  receiptsDelete,
  receiptsGet,
  receiptsGetByTransaction,
  receiptsGetFile,
  receiptsGetFileByName,
  receiptsUpload,
} from './handlers/receipts'

// Reports
export { reportHandler, reportsCustom } from './handlers/reports'

// Import Flow
export {
  importBulk,
  importExecute,
  importFileSheet,
  importGoogleSheet,
  importUpload,
} from './handlers/importFlow'

// Import session logs
export { importLogsCreate, importLogsList } from './handlers/importLogs'

// Exchange Rates
export { exchangeRates, exchangeRateSingle } from './handlers/exchangeRates'

// Portfolio
export {
  portfolioHoldingsCreate,
  portfolioHoldingsDelete,
  portfolioHoldingsList,
  portfolioHoldingsUpdate,
  portfolioPrices,
  portfolioSummary,
} from './handlers/portfolio'

// Counterparties
export { getCounterparties } from './handlers/counterparties'

// Budgets (split module)
export {
  budgetsAlerts,
  budgetsAllocate,
  budgetsCreate,
  budgetsBackfillFromSpending,
  budgetsDelete,
  budgetsDuplicateLast,
  budgetsForecast,
  budgetsFromExpenses,
  budgetsGet,
  budgetsHistory,
  budgetsImprovements,
  budgetsList,
  budgetsRollover,
  budgetsSummary,
  budgetsUpdate,
  budgetsZeroBased,
  budgetsZeroBasedSummary,
} from './handlers/budgets'

// Logs (split module)
export { logsClear, logsCreate, logsList } from './handlers/logs'
