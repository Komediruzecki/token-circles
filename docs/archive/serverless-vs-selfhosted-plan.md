# Serverless vs Self-Hosted Architecture Plan

## Executive Summary

This document outlines the architecture plan for supporting two deployment modes:
1. **Serverless Mode (Client-Side Only)**: All data stored in browser localStorage
2. **Self-Hosted Mode (Server-Side)**: Centralized backend with SQLite database

The goal is to enable users to start with client-side-only operation and seamlessly migrate to self-hosted mode when needed.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Abstraction Layer](#data-abstraction-layer)
3. [API Specification](#api-specification)
4. [Data Export Format](#data-export-format)
5. [Migration Strategy](#migration-strategy)
6. [Currency System](#currency-system)
7. [Backup and Versioning](#backup-and-versioning)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Effort Estimation](#effort-estimation)

---

## Architecture Overview

### Current State

```
┌─────────────┐         ┌─────────────┐
│  Frontend   │────────▶│  Backend    │
│  (SolidJS)  │  API    │  (Express)  │
└─────────────┘         └──────┬──────┘
                                │
                                ▼
                          ┌─────────────┐
                          │  SQLite DB  │
                          │  (File)     │
                          └─────────────┘
```

### Target State (Dual Mode)

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                            │
│  ┌──────────────────┐         ┌──────────────────────┐    │
│  │  Serverless API  │◄────────│  Storage Adapter     │    │
│  │  (Mock/LocalStorage) │         │  ┌──────────────┐  │    │
│  └──────────────────┘         │  │ LocalStorage │  │    │
│                               │  └──────────────┘  │    │
│  ┌──────────────────┐         │  ┌──────────────┐  │    │
│  │  Self-Hosted API │◄────────│  │ SQLite DB    │  │    │
│  │  (Real Backend)  │         │  │ (File/Container)│ │    │
│  └──────────────────┘         └──────────────┘  │    │
│                                                 │    │
│  ┌───────────────────────────────────────────┐ │    │
│  │         Storage Mode Selector             │ │    │
│  └───────────────────────────────────────────┘ │    │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **API Compatibility**: Same API surface for both modes
2. **Transparent Migration**: No data loss during mode switch
3. **Backward Compatible**: Existing features work in both modes
4. **Extensible**: Easy to add new storage backends (PostgreSQL, etc.)

---

## Data Abstraction Layer

### Storage Interface

```typescript
// types/storage.ts
export interface StorageAdapter {
  // Authentication
  getCurrentProfileId(): Promise<number>;
  createProfile(name: string): Promise<number>;
  updateProfile(id: number, name: string): Promise<void>;
  deleteProfile(id: number): Promise<void>;

  // Transactions
  listTransactions(filters?: TransactionFilters): Promise<Transaction[]>;
  createTransaction(tx: Transaction): Promise<number>;
  updateTransaction(id: number, tx: Partial<Transaction>): Promise<void>;
  deleteTransaction(id: number): Promise<void>;
  deleteAllTransactions(): Promise<void>;

  // Categories
  listCategories(type?: 'income' | 'expense'): Promise<Category[]>;
  createCategory(category: Category): Promise<number>;
  updateCategory(id: number, category: Partial<Category>): Promise<void>;
  deleteCategory(id: number): Promise<void>;
  deleteAllCategories(): Promise<void>;

  // Accounts
  listAccounts(): Promise<Account[]>;
  createAccount(account: Account): Promise<number>;
  updateAccount(id: number, account: Partial<Account>): Promise<void>;
  deleteAccount(id: number): Promise<void>;

  // Budgets
  listBudgets(): Promise<Budget[]>;
  createBudget(budget: Budget): Promise<number>;
  updateBudget(id: number, budget: Partial<Budget>): Promise<void>;
  deleteBudget(id: number): Promise<void>;

  // Goals
  listGoals(): Promise<Goal[]>;
  createGoal(goal: Goal): Promise<number>;
  updateGoal(id: number, goal: Partial<Goal>): Promise<void>;
  deleteGoal(id: number): Promise<void>;

  // Loans
  listLoans(): Promise<Loan[]>;
  createLoan(loan: Loan): Promise<number>;
  updateLoan(id: number, loan: Partial<Loan>): Promise<void>;
  deleteLoan(id: number): Promise<void>;

  // Transactions History
  getBalanceHistory(accountId: number): Promise<BalanceEntry[]>;
  recordBalance(accountId: number, balance: number): Promise<number>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<Settings>): Promise<void>;

  // Write-Intensive Operations
  transaction(callback: (tx: StorageAdapter) => Promise<any>): Promise<any>;

  // Data Export/Import
  exportData(): Promise<ExportData>;
  importData(data: ExportData): Promise<void>;

  // Cleanup
  clearAllData(): Promise<void>;
}

export interface TransactionFilters {
  date_from?: string;    // YYYY-MM-DD
  date_to?: string;      // YYYY-MM-DD
  category_id?: number;
  type?: 'income' | 'expense';
  search?: string;
}
```

### Storage Implementations

#### 1. LocalStorage Adapter (Serverless Mode)

```typescript
// frontend/src/core/storage/localStorage.ts
export class LocalStorageAdapter implements StorageAdapter {
  private readonly PROFILE_ID_KEY = 'finance_profile_id';
  private readonly SELECTED_PROFILE_IDS_KEY = 'finance_selected_profile_ids';

  // Parsed data cache
  private data: DataStore = {
    profiles: {},
    categories: {},
    transactions: {},
    accounts: {},
    budgets: {},
    goals: {},
    loans: {},
    settings: {}
  };

  constructor() {
    this.loadData();
  }

  private loadData() {
    const stored = localStorage.getItem('finance_data');
    if (stored) {
      this.data = JSON.parse(stored);
    }
  }

  private saveData() {
    localStorage.setItem('finance_data', JSON.stringify(this.data));
  }

  // Authentication methods
  async getCurrentProfileId(): Promise<number> {
    const id = localStorage.getItem(this.PROFILE_ID_KEY);
    return id ? parseInt(id, 10) : 1;
  }

  // ... other methods implement using this.data
}
```

#### 2. SQLite Adapter (Self-Hosted Mode)

```typescript
// backend/storage/sqlite.ts
export class SQLiteAdapter implements StorageAdapter {
  private db: Database;

  constructor(dbPath: string = './db/finance-manager.db') {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    // Same schema as current backend, using the interface
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        profile_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#6b7280',
        tax_deductible INTEGER DEFAULT 0,
        FOREIGN KEY (profile_id) REFERENCES profiles(id)
      );

      -- Similar tables for transactions, accounts, budgets, etc.
    `);
  }

  // ... other methods
}
```

#### 3. Transaction Manager (ACID Compliance)

```typescript
// utils/transaction.ts
export class TransactionManager {
  constructor(private storage: StorageAdapter) {}

  async execute<T>(callback: (storage: StorageAdapter) => Promise<T>): Promise<T> {
    if (this.storage instanceof SQLiteAdapter) {
      // SQLite supports explicit transactions
      return this.storage.transaction(callback);
    } else if (this.storage instanceof LocalStorageAdapter) {
      // For localStorage, we'll use optimistic locking
      return this.executeLocalStorageTransaction(callback);
    }
  }
}
```

---

## API Specification

### Shared API Layer

```typescript
// frontend/src/core/api/base.ts
export interface ApiConfig {
  baseUrl: string;
  mode: 'serverless' | 'self-hosted';
}

export class BaseApi {
  protected config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  protected async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.config.mode === 'self-hosted'
      ? `${this.config.baseUrl}${endpoint}`
      : await this.mockRequest<T>(endpoint, options);

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }

  private async mockRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Map API calls to storage adapter methods
    const storage = await StorageFactory.getAdapter();
    const parts = endpoint.replace('/api/', '').split('/');

    switch (parts[0]) {
      case 'profiles':
        return this.handleProfiles(parts, options, storage);
      case 'transactions':
        return this.handleTransactions(parts, options, storage);
      // ... handle other endpoints
    }
  }
}
```

### Storage Factory

```typescript
// frontend/src/core/storage/factory.ts
export class StorageFactory {
  private static currentAdapter: StorageAdapter | null = null;

  static async getAdapter(): Promise<StorageAdapter> {
    if (this.currentAdapter) {
      return this.currentAdapter;
    }

    const mode = localStorage.getItem('storage_mode') as 'serverless' | 'self-hosted' || 'serverless';
    const baseUrl = localStorage.getItem('api_base_url') || 'http://localhost:3847/api';

    if (mode === 'serverless') {
      this.currentAdapter = new LocalStorageAdapter();
    } else {
      this.currentAdapter = await this.createSelfHostedAdapter(baseUrl);
    }

    return this.currentAdapter;
  }

  private static async createSelfHostedAdapter(baseUrl: string): Promise<StorageAdapter> {
    // Create a proxy that wraps real backend calls
    return new SelfHostedAdapter(baseUrl);
  }

  static async setStorageMode(mode: 'serverless' | 'self-hosted'): Promise<void> {
    localStorage.setItem('storage_mode', mode);

    // Clear cached adapter
    this.currentAdapter = null;

    if (mode === 'self-hosted') {
      const baseUrl = localStorage.getItem('api_base_url') || 'http://localhost:3847/api';
      await this.createSelfHostedAdapter(baseUrl);
    }
  }

  static async setApiBaseUrl(url: string): Promise<void> {
    localStorage.setItem('api_base_url', url);
    if (this.currentAdapter?.constructor.name === 'SelfHostedAdapter') {
      (this.currentAdapter as any).baseUrl = url;
    }
  }
}
```

---

## Data Export Format

### Export Structure

```typescript
// types/export.ts
export interface ExportData {
  version: string;                    // "2.0"
  export_date: string;                // ISO 8601
  storage_mode: 'serverless' | 'self-hosted';

  profiles: ExportProfile[];
  categories: ExportCategory[];
  transactions: ExportTransaction[];
  accounts: ExportAccount[];
  budgets: ExportBudget[];
  goals: ExportGoal[];
  loans: ExportLoan[];

  settings: ExportSettings;
}

export interface ExportProfile {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ExportCategory {
  id: number;
  profile_id: number;
  type: 'income' | 'expense';
  name: string;
  color: string;
  tax_deductible: boolean;
}

export interface ExportTransaction {
  id: number;
  profile_id: number;
  type: 'income' | 'expense' | 'transfer';
  description: string;
  amount: number;
  currency: string;
  local_currency: string;
  exchange_rate: number;
  category_id?: number;
  account_id?: number;
  beneficiary: string;
  payor: string;
  date: string;                      // ISO date
  means: string;
  notes: string;
  tags: string[];
}

export interface ExportAccount {
  id: number;
  profile_id: number;
  name: string;
  type: 'giro' | 'ib' | 'savings';
  currency: string;
  balance: number;
  notes: string;
}

export interface ExportBudget {
  id: number;
  profile_id: number;
  category_id: number;
  amount: number;
  period: 'monthly' | 'weekly' | 'yearly';
  start_date: string;
  end_date?: string;
  rollover_enabled: boolean;
  rollover_amount: number;
}

export interface ExportGoal {
  id: number;
  profile_id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string;
  notes: string;
}

export interface ExportLoan {
  id: number;
  profile_id: number;
  name: string;
  principal: number;
  start_date: string;
  term_months: number;
  rate_periods: ExportLoanRatePeriod[];
  prepayments: ExportLoanPrepayment[];
}

export interface ExportLoanRatePeriod {
  rate: number;
  start_month: number;
  end_month?: number;
}

export interface ExportLoanPrepayment {
  month: number;
  amount: number;
  note: string;
}

export interface ExportSettings {
  theme: 'light' | 'dark';
  language: string;
  currency: string;
  primary_currency: string;
}
```

### Export Formats

```typescript
// utils/export-formats.ts
export class ExportManager {
  // CSV Export
  static toCSV(data: ExportData): string {
    const rows = this.generateCSVRows(data);
    return [this.getCSVHeaders(data), ...rows].map(r => this.escapeCSV(r)).join('\n');
  }

  // JSON Export
  static toJSON(data: ExportData): string {
    return JSON.stringify(data, null, 2);
  }

  // XLSX Export (using open-source library)
  static toXLSX(data: ExportData, filename: string): void {
    const workbook = XLSX.utils.book_new();

    // Add sheets for each data type
    this.addSheet(workbook, data.profiles, 'Profiles');
    this.addSheet(workbook, data.categories, 'Categories');
    this.addSheet(workbook, data.transactions, 'Transactions');
    // ... add other sheets

    XLSX.writeFile(workbook, filename);
  }

  private static getCSVHeaders(data: ExportData): string[] {
    // Generate headers based on export structure
  }

  private static generateCSVRows(data: ExportData): string[][] {
    // Generate rows for each data type
  }

  private static escapeCSV(value: string): string {
    // Escape CSV cells containing commas, quotes, or newlines
  }
}
```

---

## Migration Strategy

### Migration Scenarios

#### Scenario 1: Serverless → Self-Hosted

```typescript
// frontend/src/core/migration/serverless-to-hosted.ts
export class ServerlessToHostedMigration {
  async migrate(backupData: ExportData): Promise<void> {
    // 1. Validate backup data
    this.validateExportData(backupData);

    // 2. Create backup before migration
    await this.createBackup();

    // 3. Switch to self-hosted mode
    await StorageFactory.setStorageMode('self-hosted');

    // 4. Import data
    const adapter = await StorageFactory.getAdapter();
    if (adapter instanceof SelfHostedAdapter) {
      await adapter.importData(backupData);
    }

    // 5. Verify migration
    await this.verifyMigration();
  }

  private async validateExportData(data: ExportData): Promise<void> {
    // Validate all required fields
    // Check for circular references
    // Verify data integrity
  }

  private async createBackup(): Promise<void> {
    const adapter = await StorageFactory.getAdapter();
    const backup = await adapter.exportData();

    // Save backup to localStorage for recovery
    const backupKey = `migration_backup_${Date.now()}`;
    localStorage.setItem(backupKey, JSON.stringify(backup));
    localStorage.setItem('last_migration', backupKey);
  }

  private async verifyMigration(): Promise<boolean> {
    // Compare counts between modes
    const serverlessCount = await this.getServerlessCount();
    const hostedCount = await this.getHostedCount();

    return serverlessCount === hostedCount;
  }
}
```

#### Scenario 2: Self-Hosted → Serverless (Export & Import)

```typescript
// frontend/src/core/migration/hosted-to-serverless.ts
export class HostedToServerlessMigration {
  async migrate(): Promise<void> {
    // 1. Export data from self-hosted
    const adapter = await StorageFactory.getAdapter();
    if (!(adapter instanceof SelfHostedAdapter)) {
      throw new Error('Not in self-hosted mode');
    }

    const exportData = await adapter.exportData();

    // 2. Export to file (CSV/JSON/XLSX)
    const file = this.exportToFile(exportData);

    // 3. Save backup of hosted data
    this.saveHostedBackup(exportData);

    // 4. Switch to serverless mode
    await StorageFactory.setStorageMode('serverless');

    // 5. Import data
    const localAdapter = new LocalStorageAdapter();
    await localAdapter.importData(exportData);

    // 6. Notify user
    this.showMigrationComplete();
  }
}
```

### Migration UI

```svelte
<!-- frontend/src/components/MigrationDialog.svelte -->
<script lang="ts">
import { createSignal } from 'solid-js';

let showMigrationDialog = false;
let migrationMode: 'serverless-to-hosted' | 'hosted-to-serverless' | null = null;
let step = 0;
let progress = 0;
let message = '';

const ServerlessToHosted = new ServerlessToHostedMigration();
const HostedToServerless = new HostedToServerlessMigration();

const steps = [
  { id: 'backup', label: 'Creating backup...' },
  { id: 'export', label: 'Exporting data...' },
  { id: 'migrate', label: 'Migrating data...' },
  { id: 'verify', label: 'Verifying migration...' },
  { id: 'complete', label: 'Migration complete!' }
];

function openMigrationDialog(mode: 'serverless-to-hosted' | 'hosted-to-serverless') {
  migrationMode = mode;
  step = 0;
  message = '';
  showMigrationDialog = true;
  runMigration();
}

async function runMigration() {
  try {
    if (migrationMode === 'serverless-to-hosted') {
      await ServerlessToHosted.migrate();
    } else {
      await HostedToServerless.migrate();
    }

    step = 4; // complete
  } catch (error) {
    message = (error as Error).message;
  }
}
</script>

<div class="modal-overlay">
  <div class="modal">
    {migrationMode && (
      <div class="migration-content">
        <h2>Migration to Self-Hosted Mode</h2>

        {step < steps.length && (
          <>
            <div class="progress-bar">
              <div class="progress-fill" style={{ width: `${(step / 4) * 100}%` }}></div>
            </div>

            <h3>{steps[step].label}</h3>
            {message && <p class="error">{message}</p>}
          </>
        )}

        {step >= steps.length && (
          <div class="migration-complete">
            <p>Migration completed successfully!</p>
            <p class="info">
              Your data is now stored on the server and synced across devices.
            </p>
            <button onclick={() => showMigrationDialog = false}>Close</button>
          </div>
        )}
      </div>
    )}
  </div>
</div>
```

---

## Currency System

### Main World Currencies

```typescript
// types/currency.ts
export const MAIN_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', locale: 'ja-JP', decimals: 0 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', locale: 'en-AU', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', locale: 'de-CH', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', locale: 'zh-CN', decimals: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN', decimals: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG', decimals: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', locale: 'zh-HK', decimals: 2 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', locale: 'ko-KR', decimals: 0 },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$', locale: 'es-MX', decimals: 2 },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', locale: 'pt-BR', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', locale: 'ru-RU', decimals: 2 }
] as const;

export type CurrencyCode = typeof MAIN_CURRENCIES[number]['code'];
export type Currency = typeof MAIN_CURRENCIES[number];

// Exchange rate data
export interface ExchangeRate {
  source_currency: CurrencyCode;
  target_currency: CurrencyCode;
  rate: number;
  date: string;
}

// Currency converter service
export class CurrencyConverter {
  private static rates: Map<string, number> = new Map();

  // Initialize with base rates (update regularly)
  static initialize() {
    // USD-based rates (approximately)
    this.rates.set('USDEUR', 0.92);
    this.rates.set('USDGBP', 0.79);
    this.rates.set('USDCNY', 7.24);
    this.rates.set('USDJPY', 149.50);
    this.rates.set('USDAUD', 1.53);
    this.rates.set('USDCAD', 1.36);
    this.rates.set('USDCHF', 0.88);
    this.rates.set('USDRUB', 92.30);
    this.rates.set('USDBRL', 4.95);
    // ... add more rates
  }

  static async convert(
    amount: number,
    from: CurrencyCode,
    to: CurrencyCode
  ): Promise<number> {
    if (from === to) return amount;

    const rateKey = `${from}${to}`;
    const inverseKey = `${to}${from}`;

    if (this.rates.has(rateKey)) {
      return amount * this.rates.get(rateKey)!;
    }

    if (this.rates.has(inverseKey)) {
      return amount / this.rates.get(inverseKey)!;
    }

    // Use external API as fallback
    return await this.fetchRate(from, to, amount);
  }

  private static async fetchRate(
    from: CurrencyCode,
    to: CurrencyCode,
    amount: number
  ): Promise<number> {
    try {
      // Using free currency API
      const response = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${from}`
      );
      const data = await response.json();
      return amount * (data.rates[to] || 1);
    } catch (error) {
      console.warn('Could not fetch exchange rate, using last known value');
      // Fallback to last known rate
      const rateKey = `${from}${to}`;
      return this.rates.get(rateKey) || amount; // If no rate, return original
    }
  }
}

// Exchange rates storage
export class ExchangeRatesStorage {
  static async saveRate(rate: ExchangeRate): Promise<void> {
    const key = `${rate.source_currency}_${rate.target_currency}`;
    localStorage.setItem(key, JSON.stringify(rate));
  }

  static getRate(source: CurrencyCode, target: CurrencyCode): number | null {
    const key = `${source}_${target}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).rate : null;
  }

  static async refreshRates(): Promise<void> {
    try {
      const response = await fetch(
        'https://api.exchangerate-api.com/v4/latest/USD'
      );
      const data = await response.json();

      for (const [code, rate] of Object.entries(data.rates)) {
        await ExchangeRatesStorage.saveRate({
          source_currency: 'USD' as CurrencyCode,
          target_currency: code as CurrencyCode,
          rate: rate as number,
          date: new Date().toISOString()
        });
      }
    } catch (error) {
      console.warn('Failed to refresh exchange rates:', error);
    }
  }
}
```

---

## Backup and Versioning

### Backup System

```typescript
// utils/backup.ts
export class BackupManager {
  // Create scheduled backups
  static async createScheduledBackup(profileId: number): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${profileId}-${timestamp}.json`;

    const adapter = await StorageFactory.getAdapter();
    const data = await adapter.exportData();

    // Compress data before storing
    const compressed = await this.compress(JSON.stringify(data));

    // Store in localStorage (with size limit)
    const backupKey = `backup_${timestamp}`;
    localStorage.setItem(backupKey, compressed);

    // Keep only last 30 backups per profile
    await this.cleanupOldBackups(profileId, 30);

    return filename;
  }

  // Create manual backup
  static createManualBackup(): string {
    // Similar to scheduled backup, but immediate
  }

  // Restore from backup
  static async restoreBackup(backupKey: string): Promise<void> {
    const compressed = localStorage.getItem(backupKey);
    if (!compressed) {
      throw new Error('Backup not found');
    }

    const json = await this.decompress(compressed);
    const data = JSON.parse(json) as ExportData;

    const adapter = await StorageFactory.getAdapter();
    await adapter.importData(data);
  }

  // List available backups
  static listBackups(profileId: number): BackupInfo[] {
    const backups: BackupInfo[] = [];
    let i = 0;

    while (true) {
      const key = `backup_${i}`;
      const data = localStorage.getItem(key);
      if (!data) break;

      const timestamp = parseInt(key.split('_')[1]);
      backups.push({
        key,
        timestamp: new Date(timestamp),
        size: new Blob([data]).size
      });

      i++;
    }

    // Sort by date, newest first
    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Delete backup
  static async deleteBackup(backupKey: string): Promise<void> {
    localStorage.removeItem(backupKey);
  }

  // Cleanup old backups
  private static async cleanupOldBackups(profileId: number, keep: number): Promise<void> {
    const backups = this.listBackups(profileId);
    const toDelete = backups.slice(keep);

    for (const backup of toDelete) {
      await this.deleteBackup(backup.key);
    }
  }

  // Data versioning
  static getCurrentDataVersion(): string {
    return localStorage.getItem('data_version') || '1.0';
  }

  static async setDataVersion(version: string): Promise<void> {
    localStorage.setItem('data_version', version);
  }

  // Diff between versions
  static async createDiff(fromVersion: string, toVersion: string): Promise<Diff> {
    // Compare storage state and create diff
  }
}

export interface BackupInfo {
  key: string;
  timestamp: Date;
  size: number;
  type: 'scheduled' | 'manual';
}
```

### Backup Storage Options

#### 1. Browser Storage (Default)

- **Pros**: Built-in, no server needed
- **Cons**: Limited by localStorage quota (~5-10MB)
- **Solution**: Use IndexedDB for larger storage

```typescript
// utils/indexeddb-storage.ts
export class IndexedDBBackupStorage {
  private dbName = 'FinanceManagerBackups';
  private db: IDBDatabase;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('backups')) {
          const store = db.createObjectStore('backups', { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async saveBackup(backup: Backup): Promise<void> {
    return this.db.transaction(['backups'], 'readwrite')
      .objectStore('backups')
      .put(backup);
  }

  async listBackups(): Promise<Backup[]> {
    return this.db.transaction(['backups'], 'readonly')
      .objectStore('backups')
      .getAll();
  }
}
```

#### 2. File Download (Manual Backup)

```svelte
<!-- frontend/src/components/BackupDialog.svelte -->
<script lang="ts">
import { createSignal } from 'solid-js';

let showBackupDialog = false;
let backupFormat: 'json' | 'csv' | 'xlsx' = 'json';
let showExportButton = true;
let exportFileName = '';

function generateBackup() {
  const adapter = await StorageFactory.getAdapter();
  const data = await adapter.exportData();

  let content: string;
  let filename: string;
  let type: string;

  switch (backupFormat) {
    case 'json':
      content = JSON.stringify(data, null, 2);
      filename = `finance-backup-${new Date().toISOString().split('T')[0]}.json`;
      type = 'application/json';
      break;
    case 'csv':
      content = ExportManager.toCSV(data);
      filename = `finance-backup-${new Date().toISOString().split('T')[0]}.csv`;
      type = 'text/csv';
      break;
    case 'xlsx':
      ExportManager.toXLSX(data, `finance-backup-${new Date().toISOString().split('T')[0]}.xlsx`);
      filename = `finance-backup-${new Date().toISOString().split('T')[0]}.xlsx`;
      showExportButton = false;
      return;
  }

  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

// ...
</script>
```

---

## Implementation Roadmap

### Phase 1: Foundation (2-3 weeks)

**Goal**: Create the abstraction layer and base API

- [ ] Define storage interface (`StorageAdapter`)
- [ ] Implement LocalStorageAdapter
- [ ] Implement basic SQLiteAdapter wrapper
- [ ] Create base API class
- [ ] Create StorageFactory for mode selection
- [ ] Basic tests for storage adapters

**Deliverables**:
- `types/storage.ts`
- `frontend/src/core/storage/localStorage.ts`
- `backend/storage/sqlite.ts`
- `frontend/src/core/api/base.ts`
- `frontend/src/core/storage/factory.ts`

### Phase 2: Data Export (1-2 weeks)

**Goal**: Enable data export in multiple formats

- [ ] Define ExportData structure
- [ ] Implement JSON export
- [ ] Implement CSV export
- [ ] Implement XLSX export (using xlsx library)
- [ ] Create export UI dialog
- [ ] Add backup storage to IndexedDB
- [ ] Tests for export functionality

**Deliverables**:
- `types/export.ts`
- `utils/export-formats.ts`
- `frontend/src/components/ExportDialog.svelte`
- `frontend/src/components/BackupDialog.svelte`
- `utils/indexeddb-storage.ts`

### Phase 3: Migration System (1-2 weeks)

**Goal**: Enable seamless migration between modes

- [ ] Implement serverless-to-selfhosted migration
- [ ] Implement hosted-to-serverless migration
- [ ] Create migration UI dialog
- [ ] Implement validation logic
- [ ] Add backup before migration
- [ ] Tests for migration scenarios

**Deliverables**:
- `frontend/src/core/migration/serverless-to-hosted.ts`
- `frontend/src/core/migration/hosted-to-serverless.ts`
- `frontend/src/components/MigrationDialog.svelte`
- Tests for migration

### Phase 4: Currency System (1 week)

**Goal**: Add comprehensive currency support

- [ ] Define main currencies list
- [ ] Implement currency converter service
- [ ] Add exchange rate storage
- [ ] Implement automatic rate refresh
- [ ] Add currency selector in transaction entry
- [ ] Update API to support all currencies

**Deliverables**:
- `types/currency.ts`
- `utils/currency.ts`
- `frontend/src/components/CurrencySelector.svelte`
- Updated `transaction form` to show multiple currencies

### Phase 5: Self-Hosted UI (2 weeks)

**Goal**: Add settings for mode selection

- [ ] Create Settings page component
- [ ] Add mode switcher UI
- [ ] Add API base URL configuration
- [ ] Show connection status indicator
- [ ] Add network error handling
- [ ] Add migration prompts

**Deliverables**:
- `frontend/src/pages/Settings.svelte`
- `frontend/src/components/StorageModeSelector.svelte`
- `frontend/src/components/ConnectionStatus.svelte`

### Phase 6: Self-Hosted Docker (1 week)

**Goal**: Create Docker container for self-hosted deployment

- [ ] Create Dockerfile for backend
- [ ] Create docker-compose.yml
- [ ] Add nginx configuration for serving frontend
- [ ] Create setup script
- [ ] Add health check endpoint
- [ ] Document Docker deployment

**Deliverables**:
- `docker/backend/Dockerfile`
- `docker-compose.yml`
- `docker/nginx/default.conf`
- `docker/README.md`
- Setup script

---

## Effort Estimation

### Total Effort: 7-8 weeks

| Phase | Duration | Effort | Complexity |
|-------|----------|--------|------------|
| Foundation | 2-3 weeks | 80 hours | Medium |
| Data Export | 1-2 weeks | 40 hours | Medium |
| Migration | 1-2 weeks | 40 hours | High |
| Currency | 1 week | 30 hours | Low |
| Self-Hosted UI | 2 weeks | 50 hours | Medium |
| Docker Setup | 1 week | 40 hours | Medium |
| Testing | 1 week | 30 hours | Medium |

### Resource Allocation

**Frontend Developer**: 400 hours
- Phases 1, 2, 3, 4, 5
- Testing and UI work

**Backend Developer**: 200 hours
- Phases 1, Docker setup
- API compatibility layer
- Testing

**DevOps / Docker**: 40 hours
- Docker containerization
- Deployment documentation

---

## Risk Assessment

### High Risk

1. **Data Migration Failures**
   - Mitigation: Thorough testing, validation, and rollback mechanisms

2. **LocalStorage Quota Limits**
   - Mitigation: Use IndexedDB for backups, implement data compression

### Medium Risk

1. **Exchange Rate API Reliability**
   - Mitigation: Fallback to known rates, implement caching

2. **Currency Conversion Edge Cases**
   - Mitigation: Comprehensive testing, error handling

### Low Risk

1. **UI/UX Changes for Dual Mode**
   - Mitigation: Minimal changes to existing UI, clear user guidance

---

## Success Criteria

1. **Functionality**
   - [ ] Users can start with serverless mode
   - [ ] Users can switch to self-hosted mode without data loss
   - [ ] Users can export data in JSON, CSV, and XLSX formats
   - [ ] Users can restore data from backups

2. **Performance**
   - [ ] LocalStorage mode handles 10,000 transactions
   - [ ] API latency < 500ms for typical requests
   - [ ] Migration completes in < 5 minutes for 1,000 transactions

3. **Reliability**
   - [ ] No data loss during migration
   - [ ] Backups can be restored successfully
   - [ ] Exchange rates remain accurate

4. **User Experience**
   - [ ] Mode switch is seamless and transparent
   - [ ] Users understand the implications of each mode
   - [ ] Clear error messages during migration