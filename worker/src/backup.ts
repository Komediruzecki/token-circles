import type { Env } from './index';
import { HttpError } from './http';
import * as db from './db';

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
  transactionTags: Row[];
  categoryMappings: Row[];
  receipts: Row[];
  receiptFiles: ReceiptFileBackup[];
  balanceHistoryRows: Row[];
  importLogs: Row[];
  customReports: Row[];
  settingsRows: Row[];
  settings: Record<string, unknown>;
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

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function exportBackup(env: Env, userId: number, pids: number[]): Promise<BackupData> {
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
    transactionTags,
    categoryMappings,
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

  const receiptFiles: ReceiptFileBackup[] = [];
  if (receipts.length > 0 && !env.RECEIPTS) {
    throw new HttpError(503, 'Receipt storage is unavailable; full backup aborted');
  }
  for (const receipt of receipts) {
    const object = await env.RECEIPTS!.get(String(receipt.storage_path ?? ''));
    if (!object) {
      throw new HttpError(
        503,
        `Receipt file "${String(receipt.original_name ?? receipt.id)}" is unavailable; full backup aborted`
      );
    }
    receiptFiles.push({
      receipt_id: Number(receipt.id),
      content_type:
        object.httpMetadata?.contentType ?? String(receipt.file_type ?? 'application/octet-stream'),
      data_base64: toBase64(await object.arrayBuffer()),
    });
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
    transactionTags,
    categoryMappings,
    receipts,
    receiptFiles,
    balanceHistoryRows,
    importLogs,
    customReports,
    settingsRows,
    settings,
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

async function prepareInsert(
  DB: D1Database,
  table: string,
  row: Row,
  omit: Set<string> = new Set(['id'])
): Promise<D1PreparedStatement> {
  const allowed = await columnsFor(DB, table);
  const entries = Object.entries(row).filter(
    ([key, value]) => allowed.has(key) && !omit.has(key) && value !== undefined
  );
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

export async function restoreBackup(
  env: Env,
  userId: number,
  input: unknown
): Promise<{ profiles_restored: number; rows_restored: number; first_profile_id: number }> {
  const data = normalizeBackup(input);
  const receiptBytes = validateBackup(data);
  if (data.receipts.length > 0 && !env.RECEIPTS) {
    throw new HttpError(503, 'Receipt storage is unavailable; restore aborted');
  }

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
      transform: (row: Row, index: number) => Row
    ): Promise<Map<number, number>> => {
      if (source.length === 0) return new Map();
      const statements = await Promise.all(
        source.map((row, index) => prepareInsert(DB, table, transform(row, index)))
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
      transform: (row: Row, index: number) => Row
    ): Promise<void> => {
      if (source.length === 0) return;
      const statements = await Promise.all(
        source.map((row, index) => prepareInsert(DB, table, transform(row, index)))
      );
      await runChunks(DB, statements);
      rowsRestored += source.length;
    };
    const withProfile = (row: Row, context: string): Row => ({
      ...row,
      profile_id: mapped(profileMap, row.profile_id, `${context}.profile_id`, false),
    });

    const categoryMap = await insertMappedRows('categories', data.categories, (row, index) => ({
      ...withProfile(row, `categories[${index}]`),
      parent_id: null,
    }));
    const accountMap = await insertMappedRows('accounts', data.accounts, (row, index) =>
      withProfile(row, `accounts[${index}]`)
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
      data.transactions,
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
      })
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
    await insertRows('savings_goals', data.goals, (row, index) => ({
      ...withProfile(row, `goals[${index}]`),
      category_id: mapped(categoryMap, row.category_id, `goals[${index}].category_id`),
    }));
    await insertRows('retirement_goals', data.retirementGoals, (row, index) =>
      withProfile(row, `retirementGoals[${index}]`)
    );
    await insertRows('emergency_fund_config', data.emergencyFundConfig, (row, index) =>
      withProfile(row, `emergencyFundConfig[${index}]`)
    );
    await insertRows('loan_rate_periods', data.loanRatePeriods, (row, index) => ({
      ...row,
      loan_id: mapped(loanMap, row.loan_id, `loanRatePeriods[${index}].loan_id`, false),
    }));
    await insertRows('loan_prepayments', data.loanPrepayments, (row, index) => ({
      ...row,
      loan_id: mapped(loanMap, row.loan_id, `loanPrepayments[${index}].loan_id`, false),
    }));
    await insertRows('portfolio_holdings', data.portfolioHoldings, (row, index) =>
      withProfile(row, `portfolioHoldings[${index}]`)
    );
    await insertRows('bills', data.bills, (row, index) => ({
      ...withProfile(row, `bills[${index}]`),
      category_id: mapped(categoryMap, row.category_id, `bills[${index}].category_id`),
      account_id: mapped(accountMap, row.account_id, `bills[${index}].account_id`),
    }));
    await insertRows('recurring_transactions', data.recurring, (row, index) => ({
      ...withProfile(row, `recurring[${index}]`),
      category_id: mapped(categoryMap, row.category_id, `recurring[${index}].category_id`),
      account_id: mapped(accountMap, row.account_id, `recurring[${index}].account_id`),
      transfer_account_id: mapped(
        accountMap,
        row.transfer_account_id,
        `recurring[${index}].transfer_account_id`
      ),
    }));
    await insertRows('housings', data.housings, (row, index) =>
      withProfile(row, `housings[${index}]`)
    );
    await insertRows('category_mappings', data.categoryMappings, (row, index) => ({
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
    await insertRows('import_logs', data.importLogs, (row, index) =>
      withProfile(row, `importLogs[${index}]`)
    );
    await insertRows('settings', data.settingsRows, (row, index) => ({
      ...withProfile(row, `settingsRows[${index}]`),
      value: settingValue(row.value),
    }));

    const receiptRows: Row[] = [];
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
      await env.RECEIPTS!.put(key, bytes, {
        httpMetadata: { contentType: file.content_type },
      });
      stagedReceiptKeys.push(key);
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
        file_size: bytes.byteLength,
      });
    }
    const receiptMap = await insertMappedRows('receipts', receiptRows, (row) => row);
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
