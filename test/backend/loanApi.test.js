/**
 * Integration tests for loan API — specifically rate column behavior
 */
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Create temp DB per test suite
const tmpDbPath = path.join(os.tmpdir(), `fm-loan-api-test-${Date.now()}.db`);
const db = new Database(tmpDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Seed schema + data
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    principal REAL NOT NULL,
    interest_rate REAL NOT NULL,
    start_date TEXT NOT NULL,
    term_months INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    profile_id INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS loan_rate_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    rate REAL NOT NULL,
    start_month INTEGER NOT NULL,
    end_month INTEGER
  );
  CREATE TABLE IF NOT EXISTS loan_prepayments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    month INTEGER NOT NULL,
    amount REAL NOT NULL,
    note TEXT DEFAULT ''
  );
  INSERT INTO profiles (id, name) VALUES (1, 'TestProfile');
  INSERT INTO users (id, username, password_hash) VALUES (1, 'testuser', '$2a$10$dummy');
`);

// Store references for tests
let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  app.locals.db = db;
});

// Helper: build rate periods the way the calculate endpoint does (BEFORE fix)
function oldBehaviorRatePeriods(loan, dbRatePeriods) {
  return dbRatePeriods.map(rp => ({
    rate: rp.rate,
    start_month: rp.start_month,
    end_month: rp.end_month
  }));
}

// Helper: build rate periods the way the calculate endpoint does (AFTER fix)
function newBehaviorRatePeriods(loan, dbRatePeriods) {
  const initialRatePeriod = [{ rate: loan.interest_rate, start_month: 1, end_month: undefined }];
  return [
    ...initialRatePeriod,
    ...dbRatePeriods.map(rp => ({ rate: rp.rate, start_month: rp.start_month, end_month: rp.end_month }))
  ];
}

describe('Loan Calculate — Rate Column Bug Fix', () => {
  let loanId;
  let db;

  beforeAll(() => {
    db = new Database(tmpDbPath);
    db.pragma('journal_mode = WAL');

    // Insert a loan with initial rate 3.3% and ONE rate period starting at month 12 with rate 2.8%
    const result = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Test Loan', 100000, 3.3, '2024-01-01', 50, 1);
    loanId = result.lastInsertRowid;

    // Insert a single rate change period: months 12+ at 2.8%
    db.prepare(`
      INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month)
      VALUES (?, ?, ?, ?)
    `).run(loanId, 2.8, 12, null);
  });

  afterAll(() => {
    db.close();
    try { fs.unlinkSync(tmpDbPath); } catch (e) {}
    try { fs.unlinkSync(tmpDbPath + '-wal'); } catch (e) {}
    try { fs.unlinkSync(tmpDbPath + '-shm'); } catch (e) {}
  });

  test('WITHOUT initial rate prepended, months before first rate change get wrong rate', () => {
    // Before the API fix, the calculate endpoint passed only user-set rate periods.
    // The loanCalculator would default to 0 when no rate period covers month 1,
    // simulating the broken state where the rate column was 0 before the first change.
    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(loanId);

    const ratePeriods = oldBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    // Without the initial rate period prepended, months before the first rate change
    // fall into the gap and get rate 0 (the loanCalculator fallback).
    // This is the symptom the bug report describes: rate shows wrong value.
    const month1 = schedule.find(r => r.month === 1);
    expect(month1.rate).toBe(0); // gap: no rate period covers month 1
  });

  test('FIX: new behavior (initial rate prepended) gives correct rate for months 1-11', () => {
    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(loanId);

    const ratePeriods = newBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    // With the fix, months 1-11 should show the loan's initial rate (3.3%)
    const month1 = schedule.find(r => r.month === 1);
    const month11 = schedule.find(r => r.month === 11);
    const month12 = schedule.find(r => r.month === 12);
    expect(month1.rate).toBe(3.3);
    expect(month11.rate).toBe(3.3);
    expect(month12.rate).toBe(2.8); // Rate change kicks in at month 12
  });

  test('FIX: rate column shows correct rates after rate change period starts', () => {
    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(loanId);

    const ratePeriods = newBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    // All months from 12 onwards should have the new rate (2.8%)
    const months12plus = schedule.filter(r => r.month >= 12);
    for (const row of months12plus) {
      expect(row.rate).toBe(2.8);
    }
  });

  test('rate column has exactly 2 distinct values (initial + changed rate)', () => {
    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(loanId);

    const ratePeriods = newBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    const uniqueRates = [...new Set(schedule.map(r => r.rate))];
    expect(uniqueRates).toEqual([3.3, 2.8]);
  });

  test('loan with no user-set rate periods uses only initial rate', () => {
    const result = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Fixed Rate Loan', 50000, 4.5, '2024-01-01', 24, 1);
    const fixedLoanId = result.lastInsertRowid;

    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(fixedLoanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(fixedLoanId);

    // With fix: initial rate period is added even when no user rate periods exist
    const ratePeriods = newBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    // All months should have the initial rate
    for (const row of schedule) {
      expect(row.rate).toBe(4.5);
    }
    expect(schedule.length).toBe(24);
  });

  test('loan with multiple rate changes shows all distinct rates', () => {
    const result = db.prepare(`
      INSERT INTO loans (name, principal, interest_rate, start_date, term_months, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Variable Rate Loan', 80000, 5.0, '2024-01-01', 36, 1);
    const varLoanId = result.lastInsertRowid;

    db.prepare(`INSERT INTO loan_rate_periods (loan_id, rate, start_month, end_month) VALUES (?,?,?,?)`)
      .run(varLoanId, 4.0, 13, null);

    const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(varLoanId);
    const dbRatePeriods = db.prepare('SELECT * FROM loan_rate_periods WHERE loan_id=?').all(varLoanId);

    const ratePeriods = newBehaviorRatePeriods(loan, dbRatePeriods);
    const schedule = require('../../backend/models/loanCalculator').calculateSchedule(
      loan.principal, loan.start_date, loan.term_months, ratePeriods, []
    );

    const uniqueRates = [...new Set(schedule.map(r => r.rate))];
    expect(uniqueRates).toEqual([5.0, 4.0]);

    // Verify month boundaries
    const month12 = schedule.find(r => r.month === 12);
    const month13 = schedule.find(r => r.month === 13);
    expect(month12.rate).toBe(5.0);
    expect(month13.rate).toBe(4.0);
  });
});
