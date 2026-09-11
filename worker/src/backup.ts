import type { Env } from './index';
import { HttpError } from './http';
import * as db from './db';
import { DataKeyring } from './data-keys';
import { openRows, sealForInsert, SEALED_COLUMNS, type SealedTable } from './sealed-rows';
import { putReceipt, receiptBytes as openedReceiptBytes } from './sealed-objects';

export const BACKUP_VERSION = '3.0.0';

type Row = Record<string, unknown>;

export interface ReceiptFileBackup {
  receipt_id: number;
  content_type: string;
  data_base64: string;
}

export interface BackupData {
  version: string;
  export_date: string;
  storage_mode: 'serverless' | 'self-hosted';
  profiles: Row[];
  categories: Row[];
  transactions: Row[];
  accounts: Row[];
  budgets: Row[];
  budgetsZeroBased: Row[];
  goals: Row[];
  retirementGoals: Row[];
  emergencyFundConfig: Row[];
  loans: Row[];
  loanRatePeriods: Row[];
  loanPrepayments: Row[];
  portfolioHoldings: Row[];
  bills: Row[];
  recurring: Row[];
  housings: Row[];
  tags: Row[];
  tagRules: Row[];
  transactionTags: Row[];
  categoryMappings: Row[];
  receipts: Row[];
  receiptFiles: ReceiptFileBackup[];
  balanceHistoryRows: Row[];
  importLogs: Row[];
  customReports: Row[];
  settingsRows: Row[];
  settings: Record<string, unknown>;
  /**
   * Receipts whose stored file could not be read, and which were therefore left out of this
   * backup entirely — metadata row included, so the file stays internally consistent and
   * restorable. Absent (not empty) when nothing was skipped, so an older backup is unchanged.
   */
  skippedReceipts?: SkippedReceipt[];
}

export interface SkippedReceipt {
  receipt_id: number;
  original_name: string;
  reason: 'storage_unavailable' | 'file_missing';
}

interface NormalizedBackup extends Omit<BackupData, 'receiptFiles'> {
  receiptFiles: ReceiptFileBackup[];
}

const PROFILE_SCOPED_KEYS = [
  'categories',
  'transactions',
  'accounts',
  'budgets',
  'budgetsZeroBased',
  'goals',
  'retirementGoals',
  'emergencyFundConfig',
  'loans',
  'portfolioHoldings',
  'bills',
  'recurring',
  'housings',
  'tags',
  'tagRules',
  'categoryMappings',
  'receipts',
  'importLogs',
  'settingsRows',
] as const;

const PROFILE_TABLES = [
  'receipts',
  'category_mappings',
  'import_logs',
  'recurring_transactions',
  'bills',
  'housings',
  'budgets_zero_based',
  'budgets',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'portfolio_holdings',
  'transactions',
  'tag_rules',
  'tags',
  'loans',
  'categories',
  'accounts',
  'settings',
] as const;

function rows(value: unknown, field: string): Row[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object')) {
    throw new HttpError(422, `Backup field "${field}" must be an array of objects`);
  }
  return value as Row[];
}

function numericId(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(422, `Backup field "${field}" must be a positive integer`);
  }
  return parsed;
}

function uniqueIds(source: Row[], field: string): Set<number> {
  const result = new Set<number>();
  for (let index = 0; index < source.length; index++) {
    const id = numericId(source[index]!.id, `${field}[${index}].id`);
    if (result.has(id)) throw new HttpError(422, `Duplicate id ${id} in "${field}"`);
    result.add(id);
  }
  return result;
}

function settingValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizeBackup(input: unknown): NormalizedBackup {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid backup payload');
  const data = input as Record<string, unknown>;
  const profiles = rows(data.profiles, 'profiles');
  if (profiles.length === 0) throw new HttpError(422, 'A backup must contain at least one profile');

  const loans = rows(data.loans, 'loans');
  let loanRatePeriods = rows(data.loanRatePeriods, 'loanRatePeriods');
  let loanPrepayments = rows(data.loanPrepayments, 'loanPrepayments');
  if (loanRatePeriods.length === 0) {
    loanRatePeriods = loans.flatMap((loan) =>
      rows(loan.rate_periods, 'loans[].rate_periods').map((period) => ({
        ...period,
        loan_id: loan.id,
      }))
    );
  }
  if (loanPrepayments.length === 0) {
    loanPrepayments = loans.flatMap((loan) =>
      rows(loan.prepayments, 'loans[].prepayments').map((prepayment) => ({
        ...prepayment,
        loan_id: loan.id,
      }))
    );
  }

  const transactions = rows(data.transactions, 'transactions');
  let transactionTags = rows(data.transactionTags, 'transactionTags');
  if (transactionTags.length === 0) {
    transactionTags = transactions.flatMap((transaction) => {
      const tagIds = Array.isArray(transaction.tag_ids) ? transaction.tag_ids : [];
      return tagIds.map((tagId) => ({
        transaction_id: transaction.id,
        tag_id: tagId,
      }));
    });
  }

  let settingsRows = rows(data.settingsRows, 'settingsRows');
  const settings =
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
  if (settingsRows.length === 0 && Object.keys(settings).length > 0) {
    const firstProfileId = numericId(profiles[0]!.id, 'profiles[0].id');
    settingsRows = Object.entries(settings).map(([key, value]) => ({
      key,
      value: settingValue(value),
      profile_id: firstProfileId,
    }));
  }

  const receiptFilesRaw = data.receiptFiles;
  const receiptFiles =
    receiptFilesRaw === undefined || receiptFilesRaw === null
      ? []
      : rows(receiptFilesRaw, 'receiptFiles').map((file, index) => {
          if (typeof file.data_base64 !== 'string') {
            throw new HttpError(422, `receiptFiles[${index}].data_base64 must be a string`);
          }
          return {
            receipt_id: numericId(file.receipt_id, `receiptFiles[${index}].receipt_id`),
            content_type:
              typeof file.content_type === 'string'
                ? file.content_type
                : 'application/octet-stream',
            data_base64: file.data_base64,
          };
        });

  return {
    version: typeof data.version === 'string' ? data.version : '2.0.0',
    export_date: typeof data.export_date === 'string' ? data.export_date : new Date().toISOString(),
    storage_mode: data.storage_mode === 'serverless' ? 'serverless' : 'self-hosted',
    profiles,
    categories: rows(data.categories, 'categories'),
    transactions,
    accounts: rows(data.accounts, 'accounts'),
    budgets: rows(data.budgets, 'budgets'),
    budgetsZeroBased: rows(data.budgetsZeroBased, 'budgetsZeroBased'),
    goals: rows(data.goals, 'goals'),
    retirementGoals: rows(data.retirementGoals, 'retirementGoals'),
    emergencyFundConfig: rows(data.emergencyFundConfig, 'emergencyFundConfig'),
    loans,
    loanRatePeriods,
    loanPrepayments,
    portfolioHoldings: rows(data.portfolioHoldings, 'portfolioHoldings'),
    bills: rows(data.bills, 'bills'),
    recurring: rows(data.recurring, 'recurring'),
    housings: rows(data.housings, 'housings'),
    tags: rows(data.tags, 'tags'),
    tagRules: rows(data.tagRules, 'tagRules'),
    transactionTags,
    categoryMappings: rows(data.categoryMappings, 'categoryMappings'),
    receipts: rows(data.receipts, 'receipts'),
    receiptFiles,
    balanceHistoryRows: rows(
      data.balanceHistoryRows ?? (Array.isArray(data.balanceHistory) ? data.balanceHistory : []),
      'balanceHistoryRows'
    ),
    importLogs: rows(data.importLogs, 'importLogs'),
    customReports: rows(data.customReports, 'customReports'),
    settingsRows,
    settings,
  };
}

function requireReference(
  row: Row,
  field: string,
  targetIds: Set<number>,
  context: string,
  nullable = true
): void {
  const value = row[field];
  if ((value === null || value === undefined || value === '') && nullable) return;
  const id = numericId(value, `${context}.${field}`);
  if (!targetIds.has(id)) {
    throw new HttpError(422, `${context}.${field} references missing id ${id}`);
  }
}

function validateBackup(data: NormalizedBackup): Map<number, Uint8Array> {
  const profileIds = uniqueIds(data.profiles, 'profiles');
  const profileNames = new Set<string>();
  for (let index = 0; index < data.profiles.length; index++) {
    const name = String(data.profiles[index]!.name ?? '').trim();
    if (!name) throw new HttpError(422, `profiles[${index}].name is required`);
    const key = name.toLowerCase();
    if (profileNames.has(key)) throw new HttpError(422, `Duplicate profile name "${name}"`);
    profileNames.add(key);
  }

  for (const key of PROFILE_SCOPED_KEYS) {
    for (let index = 0; index < data[key].length; index++) {
      requireReference(data[key][index]!, 'profile_id', profileIds, `${key}[${index}]`, false);
    }
  }

  const categoryIds = uniqueIds(data.categories, 'categories');
  const accountIds = uniqueIds(data.accounts, 'accounts');
  const loanIds = uniqueIds(data.loans, 'loans');
  const transactionIds = uniqueIds(data.transactions, 'transactions');
  const tagIds = uniqueIds(data.tags, 'tags');
  const receiptIds = uniqueIds(data.receipts, 'receipts');

  data.categories.forEach((row, index) =>
    requireReference(row, 'parent_id', categoryIds, `categories[${index}]`)
  );
  data.transactions.forEach((row, index) => {
    requireReference(row, 'category_id', categoryIds, `transactions[${index}]`);
    requireReference(row, 'account_id', accountIds, `transactions[${index}]`);
    requireReference(row, 'transfer_account_id', accountIds, `transactions[${index}]`);
    requireReference(row, 'receipt_id', receiptIds, `transactions[${index}]`);
  });
  data.budgets.forEach((row, index) =>
    requireReference(row, 'category_id', categoryIds, `budgets[${index}]`, false)
  );
  data.budgetsZeroBased.forEach((row, index) =>
    requireReference(row, 'category_id', categoryIds, `budgetsZeroBased[${index}]`, false)
  );
  data.goals.forEach((row, index) =>
    requireReference(row, 'category_id', categoryIds, `goals[${index}]`)
  );
  data.loanRatePeriods.forEach((row, index) =>
    requireReference(row, 'loan_id', loanIds, `loanRatePeriods[${index}]`, false)
  );
  data.loanPrepayments.forEach((row, index) =>
    requireReference(row, 'loan_id', loanIds, `loanPrepayments[${index}]`, false)
  );
  for (const [key, source] of [
    ['bills', data.bills],
    ['recurring', data.recurring],
  ] as const) {
    source.forEach((row, index) => {
      requireReference(row, 'category_id', categoryIds, `${key}[${index}]`);
      requireReference(row, 'account_id', accountIds, `${key}[${index}]`);
      requireReference(row, 'transfer_account_id', accountIds, `${key}[${index}]`);
    });
  }
  data.categoryMappings.forEach((row, index) =>
    requireReference(row, 'category_id', categoryIds, `categoryMappings[${index}]`, false)
  );
  data.balanceHistoryRows.forEach((row, index) =>
    requireReference(row, 'account_id', accountIds, `balanceHistoryRows[${index}]`, false)
  );
  data.transactionTags.forEach((row, index) => {
    requireReference(row, 'transaction_id', transactionIds, `transactionTags[${index}]`, false);
    requireReference(row, 'tag_id', tagIds, `transactionTags[${index}]`, false);
  });
  data.tagRules.forEach((row, index) =>
    requireReference(row, 'tag_id', tagIds, `tagRules[${index}]`, false)
  );
  data.receipts.forEach((row, index) =>
    requireReference(row, 'transaction_id', transactionIds, `receipts[${index}]`)
  );

  const fileByReceipt = new Map<number, Uint8Array>();
  for (let index = 0; index < data.receiptFiles.length; index++) {
    const file = data.receiptFiles[index]!;
    if (!receiptIds.has(file.receipt_id)) {
      throw new HttpError(
        422,
        `receiptFiles[${index}].receipt_id references missing id ${file.receipt_id}`
      );
    }
    let binary: string;
    try {
      binary = atob(file.data_base64);
    } catch {
      throw new HttpError(422, `receiptFiles[${index}] contains invalid base64 data`);
    }
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset++) {
      bytes[offset] = binary.charCodeAt(offset);
    }
    fileByReceipt.set(file.receipt_id, bytes);
  }
  if (data.receipts.length > 0 && data.receipts.some((row) => !fileByReceipt.has(Number(row.id)))) {
    throw new HttpError(422, 'Every receipt metadata row must include its file bytes');
  }
  return fileByReceipt;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * A backup file is plaintext by contract, whatever form the rows are stored in: sealed text is
 * opened under the user's key and the encryption markers (text_enc, receipts.enc) are left out,
 * so the file restores anywhere — another deployment, another key, no key at all. Every pid must
 * belong to userId (both callers check), since userId's key is the one that opens them.
 *
 * `ring` is optional so callers that have a request keyring can share it; otherwise one is made
 * for this call, which resolves the user's key once for the whole export.
 */
export async function exportBackup(
  env: Env,
  userId: number,
  pids: number[],
  ring: DataKeyring = new DataKeyring(env),
  // false: the caller throws receipt bytes away (the v1 snapshot), so check each object exists —
  // the same skip rules as a backup — but never fetch or open it.
  opts: { receiptBytes?: boolean } = {}
): Promise<BackupData> {
  const inClause = pids.map(() => '?').join(',');
  const scoped = (table: string, order = '') =>
    db.all<Row>(
      env.DB,
      `SELECT * FROM ${table} WHERE profile_id IN (${inClause}) ${order}`,
      ...pids
    );
  const child = (table: string, parentTable: string, foreignKey: string) =>
    db.all<Row>(
      env.DB,
      `SELECT child.* FROM ${table} child
       JOIN ${parentTable} parent ON parent.id = child.${foreignKey}
       WHERE parent.profile_id IN (${inClause})`,
      ...pids
    );

  const [
    profiles,
    categories,
    storedTransactions,
    storedAccounts,
    budgets,
    budgetsZeroBased,
    storedGoals,
    storedRetirementGoals,
    emergencyFundConfig,
    loans,
    loanRatePeriods,
    storedLoanPrepayments,
    storedPortfolioHoldings,
    storedBills,
    storedRecurring,
    storedHousings,
    tags,
    storedTagRules,
    transactionTags,
    storedCategoryMappings,
    receipts,
    balanceHistoryRows,
    importLogs,
    customReports,
    settingsRows,
  ] = await Promise.all([
    db.all<Row>(
      env.DB,
      `SELECT id, name, user_id, created_at FROM profiles
       WHERE user_id = ? AND id IN (${inClause}) ORDER BY id`,
      userId,
      ...pids
    ),
    scoped('categories'),
    scoped('transactions', 'ORDER BY date DESC'),
    scoped('accounts'),
    scoped('budgets'),
    scoped('budgets_zero_based'),
    scoped('savings_goals'),
    scoped('retirement_goals'),
    scoped('emergency_fund_config'),
    scoped('loans'),
    child('loan_rate_periods', 'loans', 'loan_id'),
    child('loan_prepayments', 'loans', 'loan_id'),
    scoped('portfolio_holdings'),
    scoped('bills'),
    scoped('recurring_transactions'),
    scoped('housings'),
    scoped('tags'),
    scoped('tag_rules'),
    db.all<Row>(
      env.DB,
      `SELECT tt.* FROM transaction_tags tt
       JOIN transactions t ON t.id = tt.transaction_id
       WHERE t.profile_id IN (${inClause})`,
      ...pids
    ),
    scoped('category_mappings'),
    scoped('receipts'),
    child('account_balance_history', 'accounts', 'account_id'),
    scoped('import_logs'),
    db.all<Row>(env.DB, 'SELECT * FROM custom_reports WHERE user_id = ? ORDER BY id', userId),
    scoped('settings'),
  ]);

  // Opened before anything below reads them; openRows also drops text_enc from every row. A row
  // that fails to open fails the export — a backup never carries ciphertext in place of text.
  const transactions = await openRows(ring, userId, 'transactions', storedTransactions);
  const bills = await openRows(ring, userId, 'bills', storedBills);
  const recurring = await openRows(ring, userId, 'recurring_transactions', storedRecurring);
  const accounts = await openRows(ring, userId, 'accounts', storedAccounts);
  const goals = await openRows(ring, userId, 'savings_goals', storedGoals);
  const retirementGoals = await openRows(ring, userId, 'retirement_goals', storedRetirementGoals);
  const loanPrepayments = await openRows(ring, userId, 'loan_prepayments', storedLoanPrepayments);
  const portfolioHoldings = await openRows(
    ring,
    userId,
    'portfolio_holdings',
    storedPortfolioHoldings
  );
  const housings = await openRows(ring, userId, 'housings', storedHousings);
  const tagRules = await openRows(ring, userId, 'tag_rules', storedTagRules);
  const categoryMappings = await openRows(
    ring,
    userId,
    'category_mappings',
    storedCategoryMappings
  );

  // One unreadable receipt used to fail the whole export with a 503 — no backup file at all,
  // because one image out of hundreds was missing from storage. That is the worst possible failure
  // mode for a backup: it withholds the data at the exact moment the data is proving fragile, and
  // no amount of retrying fixes a blob that is simply gone.
  //
  // Skip it instead, and drop its metadata row with it. Dropping the row is what keeps the file
  // restorable: `validateBackup` requires every receipt to carry its bytes, so a backup listing a
  // receipt with no file would be rejected on the way back in. What was left out is reported in
  // `skippedReceipts` and by the route, so it is a stated omission rather than a silent one.
  const receiptFiles: ReceiptFileBackup[] = [];
  const includedReceipts: Row[] = [];
  const skippedReceipts: SkippedReceipt[] = [];
  const skip = (receipt: Row, reason: SkippedReceipt['reason']) =>
    skippedReceipts.push({
      receipt_id: Number(receipt.id),
      original_name: String(receipt.original_name ?? receipt.id),
      reason,
    });

  for (const receipt of receipts) {
    if (!env.RECEIPTS) {
      skip(receipt, 'storage_unavailable');
      continue;
    }
    const path = String(receipt.storage_path ?? '');
    const { enc, ...metadata } = receipt;
    if (opts.receiptBytes === false) {
      if (await env.RECEIPTS.head(path)) includedReceipts.push(metadata);
      else skip(receipt, 'file_missing');
      continue;
    }
    const object = await env.RECEIPTS.get(path);
    if (!object) {
      skip(receipt, 'file_missing');
      continue;
    }
    // Opened, not skipped, when sealed: an object that will not open is a key fault or tampering,
    // and either fails the export rather than shipping ciphertext as if it were the image.
    const bytes = await openedReceiptBytes(ring, userId, object, enc);
    includedReceipts.push(metadata);
    receiptFiles.push({
      receipt_id: Number(receipt.id),
      // A sealed object is stored as application/octet-stream; its real type is the row's.
      content_type:
        (enc === 1 ? undefined : object.httpMetadata?.contentType) ??
        String(receipt.file_type ?? 'application/octet-stream'),
      data_base64: toBase64(bytes),
    });
  }

  // A transaction pointing at a receipt that is not in the backup would restore as a dangling
  // reference. The transaction itself is kept — losing a purchase because its photo is missing
  // would be a far worse trade — with the pointer cleared.
  if (skippedReceipts.length > 0) {
    const gone = new Set(skippedReceipts.map((r) => r.receipt_id));
    for (const row of transactions) {
      if (row.receipt_id != null && gone.has(Number(row.receipt_id))) row.receipt_id = null;
    }
  }

  const settings: Record<string, unknown> = {};
  for (const row of settingsRows) {
    if (Number(row.profile_id) === pids[0]) settings[String(row.key)] = row.value;
  }

  return {
    version: BACKUP_VERSION,
    export_date: new Date().toISOString(),
    storage_mode: 'self-hosted',
    profiles,
    categories,
    transactions,
    accounts,
    budgets,
    budgetsZeroBased,
    goals,
    retirementGoals,
    emergencyFundConfig,
    loans,
    loanRatePeriods,
    loanPrepayments,
    portfolioHoldings,
    bills,
    recurring,
    housings,
    tags,
    tagRules,
    transactionTags,
    categoryMappings,
    receipts: includedReceipts,
    receiptFiles,
    balanceHistoryRows,
    importLogs,
    customReports,
    settingsRows,
    settings,
    ...(skippedReceipts.length > 0 ? { skippedReceipts } : {}),
  };
}

function dbValue(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

const columnCache = new Map<string, Promise<Set<string>>>();

async function columnsFor(DB: D1Database, table: string): Promise<Set<string>> {
  let pending = columnCache.get(table);
  if (!pending) {
    pending = DB.prepare(`PRAGMA table_info(${table})`)
      .all<{ name: string }>()
      .then((result) => new Set((result.results ?? []).map((column) => column.name)));
    columnCache.set(table, pending);
  }
  return pending;
}

// Which form a row's sealed text (text_enc) or a receipt's object (enc) is stored in. Never taken
// from a backup file — the file is plaintext by contract, and a marker copied out of it would
// describe a form the value is not in. The restore sets them itself, through `markers`.
const MARKER_COLUMNS = new Set(['text_enc', 'enc']);

async function prepareInsert(
  DB: D1Database,
  table: string,
  row: Row,
  omit: Set<string> = new Set(['id']),
  markers: Row = {}
): Promise<D1PreparedStatement> {
  const allowed = await columnsFor(DB, table);
  const entries = Object.entries(row).filter(
    ([key, value]) =>
      allowed.has(key) && !omit.has(key) && !MARKER_COLUMNS.has(key) && value !== undefined
  );
  for (const [key, value] of Object.entries(markers)) {
    if (!MARKER_COLUMNS.has(key)) throw new Error(`prepareInsert: ${key} is not a marker column`);
    if (allowed.has(key)) entries.push([key, value]);
    // A table read without the column (a column cache filled before migration 0031) would store a
    // sealed row under the DEFAULT 0, and every reader would then take its ciphertext for text.
    else if (value)
      throw new Error(`prepareInsert: ${table} has no ${key} column for a sealed row`);
  }
  if (entries.length === 0) throw new HttpError(422, `No restorable fields for table "${table}"`);
  const columnSql = entries.map(([key]) => `"${key}"`).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  return DB.prepare(`INSERT INTO ${table} (${columnSql}) VALUES (${placeholders})`).bind(
    ...entries.map(([, value]) => dbValue(value))
  );
}

async function runChunks(
  DB: D1Database,
  statements: D1PreparedStatement[],
  collectIds = false
): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; offset < statements.length; offset += 100) {
    const results = await DB.batch(statements.slice(offset, offset + 100));
    if (collectIds) {
      for (const result of results) ids.push(Number(result.meta.last_row_id));
    }
  }
  return ids;
}

function mapped(
  map: Map<number, number>,
  value: unknown,
  field: string,
  nullable = true
): number | null {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const oldId = numericId(value, field);
  const newId = map.get(oldId);
  if (!newId) throw new HttpError(422, `${field} references missing id ${oldId}`);
  return newId;
}

async function cleanupProfiles(DB: D1Database, profileIds: number[]): Promise<void> {
  if (profileIds.length === 0) return;
  const placeholders = profileIds.map(() => '?').join(',');
  const statements: D1PreparedStatement[] = [
    DB.prepare(
      `DELETE FROM account_balance_history WHERE account_id IN
       (SELECT id FROM accounts WHERE profile_id IN (${placeholders}))`
    ).bind(...profileIds),
    DB.prepare(
      `DELETE FROM transaction_tags WHERE transaction_id IN
       (SELECT id FROM transactions WHERE profile_id IN (${placeholders}))`
    ).bind(...profileIds),
    DB.prepare(
      `DELETE FROM loan_rate_periods WHERE loan_id IN
       (SELECT id FROM loans WHERE profile_id IN (${placeholders}))`
    ).bind(...profileIds),
    DB.prepare(
      `DELETE FROM loan_prepayments WHERE loan_id IN
       (SELECT id FROM loans WHERE profile_id IN (${placeholders}))`
    ).bind(...profileIds),
  ];
  for (const table of PROFILE_TABLES) {
    statements.push(
      DB.prepare(`DELETE FROM ${table} WHERE profile_id IN (${placeholders})`).bind(...profileIds)
    );
  }
  statements.push(
    DB.prepare(`DELETE FROM profiles WHERE id IN (${placeholders})`).bind(...profileIds)
  );
  await DB.batch(statements);
}

/**
 * A backup row with its sealed columns sealed under the restoring user's key, and the text_enc that
 * says so — or plaintext and 0 when there is no key. Values are coerced first exactly as dbValue
 * would bind them, so a sealed row opens to the text the plaintext insert would have stored.
 */
interface SealedRestoreRows {
  rows: Row[];
  markers: Row[];
}

async function sealRestoreRows(
  ring: DataKeyring,
  userId: number,
  table: SealedTable,
  source: Row[]
): Promise<SealedRestoreRows> {
  const rows: Row[] = [];
  const markers: Row[] = [];
  for (const row of source) {
    const values: Row = {};
    for (const column of SEALED_COLUMNS[table]) {
      if (row[column] !== undefined) values[column] = dbValue(row[column]);
    }
    const { text_enc, ...sealed } = await sealForInsert(ring, userId, table, values);
    rows.push({ ...row, ...sealed });
    markers.push({ text_enc });
  }
  return { rows, markers };
}

/**
 * `ring` is optional, as for exportBackup. Everything restored is sealed under userId's key — the
 * restoring user, never whoever wrote the file — and the staged profiles have no owner until the
 * cutover, so nothing here may look the owner up by profile.
 */
export async function restoreBackup(
  env: Env,
  userId: number,
  input: unknown,
  ring: DataKeyring = new DataKeyring(env)
): Promise<{ profiles_restored: number; rows_restored: number; first_profile_id: number }> {
  const data = normalizeBackup(input);
  const receiptBytes = validateBackup(data);
  if (data.receipts.length > 0 && !env.RECEIPTS) {
    throw new HttpError(503, 'Receipt storage is unavailable; restore aborted');
  }

  // Sealed before anything is staged: the transforms below are synchronous, and a key fault should
  // abort the restore before it has written a row.
  const sealedTransactions = await sealRestoreRows(ring, userId, 'transactions', data.transactions);
  const sealedBills = await sealRestoreRows(ring, userId, 'bills', data.bills);
  const sealedRecurring = await sealRestoreRows(
    ring,
    userId,
    'recurring_transactions',
    data.recurring
  );
  const sealedAccounts = await sealRestoreRows(ring, userId, 'accounts', data.accounts);
  const sealedGoals = await sealRestoreRows(ring, userId, 'savings_goals', data.goals);
  const sealedRetirementGoals = await sealRestoreRows(
    ring,
    userId,
    'retirement_goals',
    data.retirementGoals
  );
  const sealedLoanPrepayments = await sealRestoreRows(
    ring,
    userId,
    'loan_prepayments',
    data.loanPrepayments
  );
  const sealedPortfolioHoldings = await sealRestoreRows(
    ring,
    userId,
    'portfolio_holdings',
    data.portfolioHoldings
  );
  const sealedHousings = await sealRestoreRows(ring, userId, 'housings', data.housings);
  const sealedCategoryMappings = await sealRestoreRows(
    ring,
    userId,
    'category_mappings',
    data.categoryMappings
  );
  // Criteria are stored, and sealed, as JSON text. An object from an older file is written as its
  // JSON, and a rule with no criteria (null or missing) restores as `{}`, which matches nothing:
  // the column is NOT NULL, so passed through as null the whole restore would fail.
  const sealedTagRules = await sealRestoreRows(
    ring,
    userId,
    'tag_rules',
    data.tagRules.map((row) => ({
      ...row,
      criteria:
        typeof row.criteria === 'string' ? row.criteria : JSON.stringify(row.criteria ?? {}),
    }))
  );

  const DB = env.DB;
  const stagedProfileIds: number[] = [];
  const stagedReceiptKeys: string[] = [];
  const token = crypto.randomUUID();
  let rowsRestored = 0;

  try {
    const profileStatements = await Promise.all(
      data.profiles.map((profile, index) =>
        prepareInsert(DB, 'profiles', {
          name: `__restore_${token}_${index}`,
          user_id: null,
          created_at: profile.created_at ?? new Date().toISOString(),
        })
      )
    );
    stagedProfileIds.push(...(await runChunks(DB, profileStatements, true)));
    const profileMap = new Map<number, number>();
    data.profiles.forEach((profile, index) =>
      profileMap.set(Number(profile.id), stagedProfileIds[index]!)
    );

    const insertMappedRows = async (
      table: string,
      source: Row[],
      transform: (row: Row, index: number) => Row,
      markers?: Row[]
    ): Promise<Map<number, number>> => {
      if (source.length === 0) return new Map();
      const statements = await Promise.all(
        source.map((row, index) =>
          prepareInsert(DB, table, transform(row, index), undefined, markers?.[index])
        )
      );
      const insertedIds = await runChunks(DB, statements, true);
      const result = new Map<number, number>();
      source.forEach((row, index) => result.set(Number(row.id), insertedIds[index]!));
      rowsRestored += source.length;
      return result;
    };
    const insertRows = async (
      table: string,
      source: Row[],
      transform: (row: Row, index: number) => Row,
      markers?: Row[]
    ): Promise<void> => {
      if (source.length === 0) return;
      const statements = await Promise.all(
        source.map((row, index) =>
          prepareInsert(DB, table, transform(row, index), undefined, markers?.[index])
        )
      );
      await runChunks(DB, statements);
      rowsRestored += source.length;
    };
    const insertSealed = (
      table: string,
      sealed: SealedRestoreRows,
      transform: (row: Row, index: number) => Row
    ): Promise<void> => insertRows(table, sealed.rows, transform, sealed.markers);
    const withProfile = (row: Row, context: string): Row => ({
      ...row,
      profile_id: mapped(profileMap, row.profile_id, `${context}.profile_id`, false),
    });

    const categoryMap = await insertMappedRows('categories', data.categories, (row, index) => ({
      ...withProfile(row, `categories[${index}]`),
      parent_id: null,
    }));
    const accountMap = await insertMappedRows(
      'accounts',
      sealedAccounts.rows,
      (row, index) => withProfile(row, `accounts[${index}]`),
      sealedAccounts.markers
    );
    const loanMap = await insertMappedRows('loans', data.loans, (row, index) =>
      withProfile(row, `loans[${index}]`)
    );
    const tagMap = await insertMappedRows('tags', data.tags, (row, index) =>
      withProfile(row, `tags[${index}]`)
    );

    const parentUpdates = data.categories
      .filter((row) => row.parent_id !== null && row.parent_id !== undefined)
      .map((row) =>
        DB.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').bind(
          mapped(categoryMap, row.parent_id, 'categories.parent_id', false),
          mapped(categoryMap, row.id, 'categories.id', false)
        )
      );
    await runChunks(DB, parentUpdates);

    const transactionMap = await insertMappedRows(
      'transactions',
      sealedTransactions.rows,
      (row, index) => ({
        ...withProfile(row, `transactions[${index}]`),
        category_id: mapped(categoryMap, row.category_id, `transactions[${index}].category_id`),
        account_id: mapped(accountMap, row.account_id, `transactions[${index}].account_id`),
        transfer_account_id: mapped(
          accountMap,
          row.transfer_account_id,
          `transactions[${index}].transfer_account_id`
        ),
        receipt_id: null,
      }),
      sealedTransactions.markers
    );

    await insertRows('budgets', data.budgets, (row, index) => ({
      ...withProfile(row, `budgets[${index}]`),
      category_id: mapped(categoryMap, row.category_id, `budgets[${index}].category_id`, false),
    }));
    await insertRows('budgets_zero_based', data.budgetsZeroBased, (row, index) => ({
      ...withProfile(row, `budgetsZeroBased[${index}]`),
      category_id: mapped(
        categoryMap,
        row.category_id,
        `budgetsZeroBased[${index}].category_id`,
        false
      ),
    }));
    await insertSealed('savings_goals', sealedGoals, (row, index) => ({
      ...withProfile(row, `goals[${index}]`),
      category_id: mapped(categoryMap, row.category_id, `goals[${index}].category_id`),
    }));
    await insertSealed('retirement_goals', sealedRetirementGoals, (row, index) =>
      withProfile(row, `retirementGoals[${index}]`)
    );
    await insertRows('emergency_fund_config', data.emergencyFundConfig, (row, index) =>
      withProfile(row, `emergencyFundConfig[${index}]`)
    );
    await insertRows('loan_rate_periods', data.loanRatePeriods, (row, index) => ({
      ...row,
      loan_id: mapped(loanMap, row.loan_id, `loanRatePeriods[${index}].loan_id`, false),
    }));
    await insertSealed('loan_prepayments', sealedLoanPrepayments, (row, index) => ({
      ...row,
      loan_id: mapped(loanMap, row.loan_id, `loanPrepayments[${index}].loan_id`, false),
    }));
    await insertSealed('portfolio_holdings', sealedPortfolioHoldings, (row, index) =>
      withProfile(row, `portfolioHoldings[${index}]`)
    );
    await insertRows(
      'bills',
      sealedBills.rows,
      (row, index) => ({
        ...withProfile(row, `bills[${index}]`),
        category_id: mapped(categoryMap, row.category_id, `bills[${index}].category_id`),
        account_id: mapped(accountMap, row.account_id, `bills[${index}].account_id`),
      }),
      sealedBills.markers
    );
    await insertRows(
      'recurring_transactions',
      sealedRecurring.rows,
      (row, index) => ({
        ...withProfile(row, `recurring[${index}]`),
        category_id: mapped(categoryMap, row.category_id, `recurring[${index}].category_id`),
        account_id: mapped(accountMap, row.account_id, `recurring[${index}].account_id`),
        transfer_account_id: mapped(
          accountMap,
          row.transfer_account_id,
          `recurring[${index}].transfer_account_id`
        ),
      }),
      sealedRecurring.markers
    );
    await insertSealed('housings', sealedHousings, (row, index) =>
      withProfile(row, `housings[${index}]`)
    );
    await insertSealed('category_mappings', sealedCategoryMappings, (row, index) => ({
      ...withProfile(row, `categoryMappings[${index}]`),
      category_id: mapped(
        categoryMap,
        row.category_id,
        `categoryMappings[${index}].category_id`,
        false
      ),
    }));
    await insertRows('account_balance_history', data.balanceHistoryRows, (row, index) => ({
      ...row,
      account_id: mapped(
        accountMap,
        row.account_id,
        `balanceHistoryRows[${index}].account_id`,
        false
      ),
      recorded_at: row.recorded_at ?? row.date,
    }));
    await insertRows('transaction_tags', data.transactionTags, (row, index) => ({
      transaction_id: mapped(
        transactionMap,
        row.transaction_id,
        `transactionTags[${index}].transaction_id`,
        false
      ),
      tag_id: mapped(tagMap, row.tag_id, `transactionTags[${index}].tag_id`, false),
    }));
    // Criteria round-trip as the opaque JSON blob shared/tagRules.ts normalizes on read; they were
    // made text before sealing, above.
    await insertSealed('tag_rules', sealedTagRules, (row, index) => ({
      ...withProfile(row, `tagRules[${index}]`),
      tag_id: mapped(tagMap, row.tag_id, `tagRules[${index}].tag_id`, false),
    }));
    await insertRows('import_logs', data.importLogs, (row, index) =>
      withProfile(row, `importLogs[${index}]`)
    );
    await insertRows('settings', data.settingsRows, (row, index) => ({
      ...withProfile(row, `settingsRows[${index}]`),
      value: settingValue(row.value),
    }));

    const receiptRows: Row[] = [];
    const receiptMarkers: Row[] = [];
    for (let index = 0; index < data.receipts.length; index++) {
      const receipt = data.receipts[index]!;
      const oldReceiptId = numericId(receipt.id, `receipts[${index}].id`);
      const bytes = receiptBytes.get(oldReceiptId)!;
      const newProfileId = mapped(
        profileMap,
        receipt.profile_id,
        `receipts[${index}].profile_id`,
        false
      )!;
      const extension =
        String(receipt.original_name ?? '')
          .split('.')
          .pop()
          ?.toLowerCase()
          .replace(/[^a-z0-9]/g, '') || 'bin';
      const key = `${newProfileId}/${crypto.randomUUID()}.${extension}`;
      const file = data.receiptFiles.find((candidate) => candidate.receipt_id === oldReceiptId)!;
      // Staged before the put, so a put that fails midway is still cleaned up.
      stagedReceiptKeys.push(key);
      const enc = await putReceipt(ring, userId, env.RECEIPTS!, key, bytes, file.content_type);
      receiptMarkers.push({ enc });
      receiptRows.push({
        ...receipt,
        profile_id: newProfileId,
        transaction_id: mapped(
          transactionMap,
          receipt.transaction_id,
          `receipts[${index}].transaction_id`
        ),
        filename: key,
        storage_path: key,
        // The plaintext size, whatever the stored object's is.
        file_size: bytes.byteLength,
      });
    }
    const receiptMap = await insertMappedRows(
      'receipts',
      receiptRows,
      (row) => row,
      receiptMarkers
    );
    const receiptUpdates = data.transactions
      .filter((row) => row.receipt_id !== null && row.receipt_id !== undefined)
      .map((row) =>
        DB.prepare('UPDATE transactions SET receipt_id = ? WHERE id = ?').bind(
          mapped(receiptMap, row.receipt_id, 'transactions.receipt_id', false),
          mapped(transactionMap, row.id, 'transactions.id', false)
        )
      );
    await runChunks(DB, receiptUpdates);

    const oldProfiles = await db.all<{ id: number }>(
      DB,
      'SELECT id FROM profiles WHERE user_id = ?',
      userId
    );
    const oldProfileIds = oldProfiles.map((profile) => profile.id);
    const oldReceiptKeys =
      oldProfileIds.length === 0
        ? []
        : await db.all<{ storage_path: string }>(
            DB,
            `SELECT storage_path FROM receipts WHERE profile_id IN
             (${oldProfileIds.map(() => '?').join(',')})`,
            ...oldProfileIds
          );

    const finalStatements: D1PreparedStatement[] = [];
    if (oldProfileIds.length > 0) {
      const placeholders = oldProfileIds.map(() => '?').join(',');
      finalStatements.push(
        DB.prepare(
          `DELETE FROM account_balance_history WHERE account_id IN
           (SELECT id FROM accounts WHERE profile_id IN (${placeholders}))`
        ).bind(...oldProfileIds),
        DB.prepare(
          `DELETE FROM transaction_tags WHERE transaction_id IN
           (SELECT id FROM transactions WHERE profile_id IN (${placeholders}))`
        ).bind(...oldProfileIds),
        DB.prepare(
          `DELETE FROM loan_rate_periods WHERE loan_id IN
           (SELECT id FROM loans WHERE profile_id IN (${placeholders}))`
        ).bind(...oldProfileIds),
        DB.prepare(
          `DELETE FROM loan_prepayments WHERE loan_id IN
           (SELECT id FROM loans WHERE profile_id IN (${placeholders}))`
        ).bind(...oldProfileIds)
      );
      for (const table of PROFILE_TABLES) {
        finalStatements.push(
          DB.prepare(`DELETE FROM ${table} WHERE profile_id IN (${placeholders})`).bind(
            ...oldProfileIds
          )
        );
      }
      finalStatements.push(
        DB.prepare(`DELETE FROM profiles WHERE id IN (${placeholders})`).bind(...oldProfileIds)
      );
    }
    finalStatements.push(DB.prepare('DELETE FROM custom_reports WHERE user_id = ?').bind(userId));
    for (let index = 0; index < data.profiles.length; index++) {
      finalStatements.push(
        DB.prepare(
          'UPDATE profiles SET user_id = ?, name = ? WHERE id = ? AND user_id IS NULL'
        ).bind(userId, String(data.profiles[index]!.name).trim(), stagedProfileIds[index])
      );
    }
    for (const report of data.customReports) {
      finalStatements.push(
        await prepareInsert(DB, 'custom_reports', { ...report, user_id: userId })
      );
    }
    await DB.batch(finalStatements);

    if (env.RECEIPTS) {
      const oldKeys = oldReceiptKeys.map((row) => row.storage_path).filter(Boolean);
      for (let offset = 0; offset < oldKeys.length; offset += 1000) {
        await env.RECEIPTS.delete(oldKeys.slice(offset, offset + 1000)).catch((error: unknown) => {
          console.error('Old receipt cleanup after restore failed:', error);
        });
      }
    }

    return {
      profiles_restored: stagedProfileIds.length,
      rows_restored: rowsRestored,
      first_profile_id: stagedProfileIds[0]!,
    };
  } catch (error) {
    await cleanupProfiles(DB, stagedProfileIds).catch((cleanupError: unknown) => {
      console.error('Staged profile cleanup after failed restore failed:', cleanupError);
    });
    if (env.RECEIPTS && stagedReceiptKeys.length > 0) {
      await env.RECEIPTS.delete(stagedReceiptKeys).catch((cleanupError: unknown) => {
        console.error('Staged receipt cleanup after failed restore failed:', cleanupError);
      });
    }
    throw error;
  }
}
