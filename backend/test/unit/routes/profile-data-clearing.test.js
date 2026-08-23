/**
 * In-process integration test for POST /api/profiles/reseed-demo.
 *
 * Regression coverage for two defects that fed each other:
 *
 * 1. The endpoint deleted a hand-written list of seven tables, while seedThreeTierProfiles()
 *    inserts holdings, recurring rows, goals and the rest unconditionally. portfolio_holdings
 *    and recurring_transactions were never in the list, so each call appended another full copy
 *    (a profile reseeded four times held SPY x4 and VTI x4) while the response still said
 *    "Demo data has been restored".
 *
 * 2. It cleared only the ACTIVE profile but re-seeded all three demo profiles. The seeder skips
 *    a profile that still has transactions, so "restore the three example profiles" restored
 *    whichever one happened to be active — and any demo profile that had been emptied some other
 *    way got a second copy of its accounts, holdings and goals stacked on top of the old ones.
 *
 * The endpoint and scripts/nuke-demo.js now clear the tables listed in lib/profileTables.js, so
 * the two lists cannot drift apart again; the first test below fails if schema.sql grows a
 * per-profile table that nobody added to that list.
 *
 * Uses the real database module (NODE_ENV=test => db/test.db) because the whole point is to run
 * the REAL seeder against the REAL delete list. Assertions compare row counts before and after
 * rather than absolute numbers, so the test does not care what the database already held.
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const Database = require('better-sqlite3');
const { initRepositories } = require('../../../repositories');
const profilesRouter = require('../../../routes/profiles');
const { PROFILE_DATA_TABLES, PROFILE_CHILD_TABLES } = require('../../../lib/profileTables');

const SCHEMA_PATH = path.join(__dirname, '../../../schema.sql');
const DEMO_IDS = [1, 2, 3];

describe('lib/profileTables — covers every per-profile table in the schema', () => {
  test('PROFILE_DATA_TABLES lists exactly the tables with a profile_id column', () => {
    const db = new Database(':memory:');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
      .filter((name) =>
        db
          .prepare(`PRAGMA table_info(${name})`)
          .all()
          .some((c) => c.name === 'profile_id')
      );
    db.close();

    // `settings` is per-profile configuration, not data, so it is handled separately by
    // clearDataForProfile({ includeSettings }) instead of living in the data list.
    expect([...PROFILE_DATA_TABLES, 'settings'].sort()).toEqual(tables.sort());
  });

  test('PROFILE_CHILD_TABLES reach their rows through a parent that is itself per-profile', () => {
    for (const child of PROFILE_CHILD_TABLES) {
      expect(PROFILE_DATA_TABLES).toContain(child.parent);
    }
  });
});

describe('POST /api/profiles/reseed-demo', () => {
  // The real seeder writes tens of thousands of rows across the three profiles; on a cold test
  // database the beforeAll seed plus several reseeds needs room on a slow disk.
  jest.setTimeout(300000);

  let app;
  let db;
  let ownerId;
  let randomSpy;

  const buildApp = (userId) => {
    const passthrough = (_req, _res, next) => next();
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      req.session = { userId };
      req.repos = initRepositories(db);
      next();
    });
    a.use(
      profilesRouter({
        apiRateLimiter: passthrough,
        requireAuth: passthrough,
        logError: () => {},
        seedThreeTierProfiles: db.seedThreeTierProfiles,
        demoProfileIds: DEMO_IDS,
      })
    );
    // eslint-disable-next-line no-unused-vars
    a.use((err, _req, res, _next) =>
      res.status(err.statusCode || err.status || 500).json({ error: err.message })
    );
    return a;
  };

  const reseed = () => request(app).post('/api/profiles/reseed-demo').set('X-Profile-Id', '1');

  const countIn = (table, pid) =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE profile_id = ?`).get(pid).c;

  const tickersIn = (pid) =>
    db
      .prepare('SELECT ticker FROM portfolio_holdings WHERE profile_id = ?')
      .all(pid)
      .map((r) => r.ticker);

  const countsByProfile = (table) =>
    Object.fromEntries(
      db
        .prepare(`SELECT profile_id, COUNT(*) AS c FROM ${table} GROUP BY profile_id`)
        .all()
        .map((r) => [r.profile_id, r.c])
    );

  const snapshot = () => {
    const rows = {};
    for (const table of [...PROFILE_DATA_TABLES, 'settings']) rows[table] = countsByProfile(table);
    for (const child of PROFILE_CHILD_TABLES) {
      rows[child.table] = db.prepare(`SELECT COUNT(*) AS c FROM ${child.table}`).get().c;
    }
    return rows;
  };

  beforeAll(() => {
    db = require('../../../database');
    // Per-connection only; the seeder inserts row by row, and fsync per INSERT is what makes
    // this endpoint take ~30s on CI runners.
    db.pragma('synchronous = OFF');
    // Amounts, and the NUMBER of dining/lunch/health/shopping transactions, come from
    // Math.random(). Pin it so "same counts" is an exact assertion rather than a range.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    // Guarantee demo profiles 1-3 exist whatever state db/test.db is in.
    db.seedThreeTierProfiles();
    ownerId = db.prepare('SELECT user_id FROM profiles WHERE id = 1').get().user_id;
    app = buildApp(ownerId);
  });

  afterAll(() => {
    if (randomSpy) randomSpy.mockRestore();
  });

  test('every table holds the same number of rows after the second call as after the first', async () => {
    const first = await reseed();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, message: 'Demo data has been restored' });
    const afterFirst = snapshot();

    const second = await reseed();
    expect(second.status).toBe(200);
    const afterSecond = snapshot();

    expect(afterSecond).toEqual(afterFirst);
    // Guard against a green run on an endpoint that seeded nothing at all.
    expect(afterFirst.portfolio_holdings[1]).toBeGreaterThan(0);
    expect(afterFirst.transactions[1]).toBeGreaterThan(0);
  });

  test('a reseeded profile holds one holding per ticker, not one per reseed', async () => {
    await reseed().expect(200);
    for (const pid of DEMO_IDS) {
      const tickers = tickersIn(pid);
      expect(tickers.length).toBe(new Set(tickers).size);
    }
  });

  test('rebuilds a demo profile emptied some other way instead of doubling it', async () => {
    // The state the old endpoint turned into duplicates: profile 2 lost its transactions but kept
    // its holdings, so the seeder re-seeded it while the clear (active profile only) never
    // reached it.
    db.prepare('DELETE FROM transactions WHERE profile_id = 2').run();
    await reseed().expect(200);

    const tickers = tickersIn(2);
    expect(tickers.length).toBe(new Set(tickers).size);
    expect(countIn('transactions', 2)).toBeGreaterThan(0);
  });

  test('restores every demo profile, not only the active one', async () => {
    // A row that only a reseed OF PROFILE 3 can remove: the old endpoint cleared just the active
    // profile, and the seeder skips a profile that still has transactions, so this survived.
    db.prepare(
      `INSERT INTO portfolio_holdings (ticker, shares, purchase_price, purchase_date, profile_id)
       VALUES ('STALE', 1, 1, '2020-01-01', 3)`
    ).run();

    await reseed().expect(200);

    const stale = db
      .prepare(
        "SELECT COUNT(*) AS c FROM portfolio_holdings WHERE profile_id = 3 AND ticker = 'STALE'"
      )
      .get().c;
    expect(stale).toBe(0);
  });

  test('refuses callers who own none of the demo profiles, leaving their data alone', async () => {
    const before = countIn('transactions', 1);
    const stranger = buildApp(ownerId + 90210); // a user id that owns no demo profile

    const res = await request(stranger).post('/api/profiles/reseed-demo').set('X-Profile-Id', '1');

    expect(res.status).toBe(403);
    expect(countIn('transactions', 1)).toBe(before);
  });
});

describe('DELETE /api/profile/data', () => {
  // Shares the seeded database above; the reseed suite leaves all three demo profiles full.
  jest.setTimeout(300000);

  // Profile 2, so this cannot disturb the profile the reseed suite asserts against.
  const PID = 2;

  let app;
  let db;
  let probeSeq = 0;

  // db/test.db is reused between runs, and a run that fails mid-way leaves probe rows behind.
  // Tagging them per process keeps the NEXT run from dying on a UNIQUE collision in beforeAll
  // and reporting a broken test instead of the broken code that caused it.
  const PROBE = `probe-${process.pid}`;

  /**
   * Insert one row into `table` for `pid`, filling only the columns SQLite insists on.
   *
   * Driven by PRAGMA rather than a hand-written list: a per-profile table added to schema.sql
   * later is probed automatically, so "clear leaves nothing behind" keeps meaning all of it
   * rather than all of it as of the day this was written.
   */
  const insertProbe = (table, pid) => {
    const seq = ++probeSeq;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const pkCols = cols.filter((c) => c.pk > 0);
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    const child = PROFILE_CHILD_TABLES.find((c) => c.table === table);

    // Child rows have to hang off a parent of THIS profile, or clearing the profile would
    // rightly leave them alone and the probe would accuse the code of a bug it does not have.
    // loan_rate_periods and loan_prepayments declare no foreign key, so the child list is the
    // only place that link is written down.
    const parentOf = (col) => {
      if (child && col === child.key) return { table: child.parent, to: 'id' };
      const fk = fks.find((f) => f.from === col);
      return fk ? { table: fk.table, to: fk.to || 'id' } : null;
    };

    const names = [];
    const values = [];
    for (const c of cols) {
      // A lone INTEGER PRIMARY KEY is the rowid alias; let SQLite assign it.
      if (c.pk > 0 && pkCols.length === 1 && /INT/i.test(c.type)) continue;
      if (c.name === 'profile_id') {
        names.push(c.name);
        values.push(pid);
        continue;
      }
      const required = (c.notnull === 1 && c.dflt_value === null) || c.pk > 0;
      if (!required) continue;

      const parent = parentOf(c.name);
      names.push(c.name);
      if (parent) {
        const row = db
          .prepare(`SELECT ${parent.to} AS id FROM ${parent.table} WHERE profile_id = ? LIMIT 1`)
          .get(pid);
        if (!row) throw new Error(`no ${parent.table} row for profile ${pid} to hang ${table} off`);
        values.push(row.id);
      } else if (/INT|REAL|NUM/i.test(c.type)) {
        values.push(seq);
      } else {
        values.push(`${PROBE}-${seq}`);
      }
    }

    const placeholders = names.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`).run(
      ...values
    );
  };

  const countIn = (table, pid) =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE profile_id = ?`).get(pid).c;

  const countChild = (child, pid) =>
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ${child.table}
         WHERE ${child.key} IN (SELECT id FROM ${child.parent} WHERE profile_id = ?)`
      )
      .get(pid).c;

  const clearData = () => request(app).delete('/api/profile/data').set('X-Profile-Id', String(PID));

  beforeAll(() => {
    db = require('../../../database');
    const passthrough = (_req, _res, next) => next();
    const ownerId = db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(PID).user_id;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: ownerId };
      req.repos = initRepositories(db);
      next();
    });
    app.use(
      profilesRouter({
        apiRateLimiter: passthrough,
        requireAuth: passthrough,
        logError: () => {},
        seedThreeTierProfiles: db.seedThreeTierProfiles,
        demoProfileIds: DEMO_IDS,
      })
    );
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) =>
      res.status(err.statusCode || err.status || 500).json({ error: err.message })
    );

    // Guarantee the profile has rows everywhere, including the tables the seeder never fills.
    db.seedThreeTierProfiles();
    for (const table of PROFILE_DATA_TABLES) insertProbe(table, PID);
    for (const child of PROFILE_CHILD_TABLES) insertProbe(child.table, PID);
  });

  test('every per-profile table is populated before the clear, or the test proves nothing', () => {
    const empty = [];
    for (const table of PROFILE_DATA_TABLES) if (countIn(table, PID) === 0) empty.push(table);
    for (const child of PROFILE_CHILD_TABLES)
      if (countChild(child, PID) === 0) empty.push(child.table);
    expect(empty).toEqual([]);
  });

  test('leaves no row behind in any per-profile table', async () => {
    await clearData().expect(200);

    // Named rather than counted, so a failure says WHICH table the delete list forgot — the
    // exact defect this covers (portfolio_holdings and recurring_transactions were missing).
    const leftover = {};
    for (const table of PROFILE_DATA_TABLES) {
      if (table === 'categories') continue; // deliberately re-seeded with the defaults below
      const rows = countIn(table, PID);
      if (rows > 0) leftover[table] = rows;
    }
    for (const child of PROFILE_CHILD_TABLES) {
      const rows = countChild(child, PID);
      if (rows > 0) leftover[child.table] = rows;
    }
    expect(leftover).toEqual({});
  });

  test('replaces the categories with the defaults rather than leaving the old ones', () => {
    const names = db
      .prepare('SELECT name FROM categories WHERE profile_id = ? ORDER BY name')
      .all(PID)
      .map((r) => r.name);
    expect(names).toContain('Housing');
    expect(names.filter((n) => n.startsWith('probe-'))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });

  test('keeps the profile settings, which are configuration rather than data', async () => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)').run(
      'currency',
      'EUR',
      PID
    );

    await clearData().expect(200);

    const kept = db
      .prepare('SELECT value FROM settings WHERE key = ? AND profile_id = ?')
      .get('currency', PID);
    expect(kept).toEqual({ value: 'EUR' });
  });

  test('deleting the profile outright takes its settings with it', () => {
    const repos = initRepositories(db);
    const ownerId = db.prepare('SELECT user_id FROM profiles WHERE id = ?').get(PID).user_id;
    const created = db
      .prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)')
      .run(`${PROBE}-profile`, ownerId);
    const pid = created.lastInsertRowid;
    db.prepare('INSERT INTO settings (key, value, profile_id) VALUES (?, ?, ?)').run(
      'currency',
      'USD',
      pid
    );

    repos.profiles.deleteAllDataForProfile(pid);

    expect(db.prepare('SELECT COUNT(*) AS c FROM settings WHERE profile_id = ?').get(pid).c).toBe(
      0
    );
    expect(db.prepare('SELECT COUNT(*) AS c FROM profiles WHERE id = ?').get(pid).c).toBe(0);
  });
});
