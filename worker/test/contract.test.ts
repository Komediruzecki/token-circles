import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { mcpRoutes } from '../src/mcp';
import { unsent, type Hit, type RouteKey } from '../../shared/contract/guard';
import { outbound } from '../../shared/contract/outbound';
import { CONTRACT_ROUTES, UNCOVERED, WORKER_ONLY } from '../../shared/contract/routes';
import { SCENARIOS } from '../../shared/contract/scenarios';
import type {
  ContractApi,
  Expect,
  Method,
  Owned,
  Reply,
  StoredKind,
} from '../../shared/contract/types';

// The CRUD contract (shared/contract) against the Worker and a real D1. Local-first runs the same
// scenarios in frontend/src/core/storage/__tests__/contract.test.ts. The last block checks that
// the scenarios sent every contract route, and that every route the Worker serves is on a list.

declare global {
  interface ImportMeta {
    glob<T>(
      pattern: string,
      options: { eager: true; query?: string; import?: string }
    ): Record<string, T>;
  }
}

// The Worker's own requests to other services (a price feed, a spreadsheet) are answered from
// shared/contract/outbound.ts, so no scenario reaches the network; anything else fails it.
beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
    outbound(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  );
});
afterAll(() => {
  vi.restoreAllMocks();
});

const hits: Hit[] = [];
let people = 0;
let ran = 0;
const total = Object.values(SCENARIOS).reduce((n, list) => n + list.length, 0);

/** Which profile headers a request carries: the active profile's, both of the household's, none. */
type Scope = 'active' | 'household' | 'none';

function apiFor(
  cookie: string,
  profile: number,
  partner: () => ContractApi,
  scope: Scope = 'active'
): ContractApi {
  const send = async (method: Method, path: string, body?: unknown): Promise<Reply> => {
    const form = body instanceof FormData;
    const res = await SELF.fetch(`https://example.com${path}`, {
      method,
      headers: {
        Cookie: cookie,
        // A form sets its own multipart type, boundary included.
        ...(form ? {} : { 'Content-Type': 'application/json' }),
        ...(scope === 'none' ? {} : { 'X-Profile-Id': String(profile) }),
        ...(scope === 'household'
          ? { 'X-Profile-Ids': JSON.stringify([profile, partner().profile]) }
          : {}),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the scenario gets the text.
    }
    hits.push({ method, path, status: res.status });
    return { status: res.status, body: parsed, type: res.headers.get('Content-Type') ?? '' };
  };
  const api: ContractApi = {
    runtime: 'worker',
    profile,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
    get other() {
      return partner();
    },
    as: (id) => apiFor(cookie, id, () => api),
    get unscoped() {
      return apiFor(cookie, profile, partner, 'none');
    },
    get household() {
      return apiFor(cookie, profile, partner, 'household');
    },
    stored,
  };
  return api;
}

/** Each profile-scoped kind `stored` counts, by its table. */
const PROFILE_TABLES: Partial<Record<StoredKind, string>> = {
  accounts: 'accounts',
  bills: 'bills',
  budgets: 'budgets',
  categories: 'categories',
  'category mappings': 'category_mappings',
  goals: 'savings_goals',
  holdings: 'portfolio_holdings',
  housing: 'housings',
  'import logs': 'import_logs',
  'import sources': 'import_sources',
  loans: 'loans',
  receipts: 'receipts',
  recurring: 'recurring_transactions',
  'retirement goals': 'retirement_goals',
  'tag rules': 'tag_rules',
  tags: 'tags',
  transactions: 'transactions',
};

/** What D1 holds for a profile (ContractApi.stored). */
async function stored(profile: number, owned: Owned = {}): Promise<Record<StoredKind, number>> {
  const count = async (sql: string, ...values: unknown[]) =>
    (await env.DB.prepare(sql)
      .bind(...values)
      .first<{ n: number }>())!.n;
  // The ids are the scenario's own numbers; an empty list matches nothing. D1 gives no id out twice
  // (AUTOINCREMENT), so a row counted here never hangs off another profile's loan, account or
  // transaction; one whose parent is gone still counts.
  const ids = (list: readonly number[] = []) => (list.length ? list.map(Number).join(',') : 'NULL');
  const counts: Partial<Record<StoredKind, number>> = {};
  for (const [kind, table] of Object.entries(PROFILE_TABLES)) {
    counts[kind as StoredKind] = await count(
      `SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`,
      profile
    );
  }
  counts['retirement settings'] = await count(
    "SELECT COUNT(*) AS n FROM settings WHERE profile_id = ? AND key = 'retirement_settings'",
    profile
  );
  counts['loan rate periods'] = await count(
    `SELECT COUNT(*) AS n FROM loan_rate_periods WHERE loan_id IN (${ids(owned.loans)})`
  );
  counts['loan extra payments'] = await count(
    `SELECT COUNT(*) AS n FROM loan_prepayments WHERE loan_id IN (${ids(owned.loans)})`
  );
  counts['balance history'] = await count(
    `SELECT COUNT(*) AS n FROM account_balance_history WHERE account_id IN (${ids(owned.accounts)})`
  );
  counts['transaction tags'] = await count(
    `SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id IN (${ids(owned.transactions)})`
  );
  return counts as Record<StoredKind, number>;
}

/**
 * A new person with two profiles, signed in. Every scenario gets its own, so none sees another's
 * rows. Local-first has no plans, so the person holds the plan with every feature: a scenario
 * compares what the runtimes do with data, and what a plan sells is tested on its own
 * (plan-gates.test.ts).
 */
async function person(): Promise<ContractApi> {
  people += 1;
  const user = 990_000 + people;
  const me = user * 10 + 1;
  const partner = user * 10 + 2;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, ?, 'password', 1, 'ultimate')"
    ).bind(user, `contract-${user}@example.com`),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Me')").bind(me, user),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Partner')").bind(
      partner,
      user
    ),
  ]);
  const cookie = (await issueSessionCookie(user, 'password', env)).split(';')[0];
  const mine: ContractApi = apiFor(cookie, me, () => theirs);
  const theirs: ContractApi = apiFor(cookie, partner, () => mine);
  return mine;
}

type RouteTable = { routes: { method: string; path: string }[] };

/**
 * Every route the Worker serves, as worker/src/index.ts builds the app: the routes it registers
 * itself, and those of each module it mounts (a routes module, or the MCP server). index.ts does
 * not export the app (its default export is the Worker's handlers), so it is read as text. A mount
 * under a prefix, or of a module this cannot read, is answered as unreadable: its routes would be
 * on no list.
 */
function workerRoutes(): { served: Set<string>; unreadable: string[] } {
  const modules = import.meta.glob<Record<string, unknown>>('../src/routes/*.ts', { eager: true });
  const tables = new Map<string, RouteTable>([['mcpRoutes', mcpRoutes]]);
  for (const module of Object.values(modules)) {
    for (const [name, value] of Object.entries(module)) {
      const routes = (value as Partial<RouteTable> | null)?.routes;
      if (Array.isArray(routes)) tables.set(name, value as RouteTable);
    }
  }
  const [index] = Object.values(
    import.meta.glob<string>('../src/index.ts', { query: '?raw', import: 'default', eager: true })
  );
  const served = new Set<string>();
  for (const [, method, path] of index.matchAll(
    /\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g
  )) {
    served.add(`${method.toUpperCase()} ${path}`);
  }
  const unreadable: string[] = [];
  for (const [mount, prefix, name] of index.matchAll(
    /\bapp\.route\(\s*['"`]([^'"`]*)['"`]\s*,\s*(\w+)\s*\)/g
  )) {
    const table = tables.get(name);
    if (prefix !== '/' || !table) unreadable.push(mount);
    else for (const r of table.routes) if (r.method !== 'ALL') served.add(`${r.method} ${r.path}`);
  }
  return { served, unreadable };
}

for (const [entity, list] of Object.entries(SCENARIOS)) {
  describe(`contract: ${entity}`, () => {
    for (const s of list) {
      it(s.name, async () => {
        expect.hasAssertions();
        await s.run(await person(), expect as unknown as Expect);
        ran += 1;
      });
    }
  });
}

function expectEveryRouteSent() {
  const missing = unsent(CONTRACT_ROUTES, hits);
  expect(
    missing.filter((k) => !UNCOVERED.includes(k)),
    'no scenario sends these'
  ).toEqual([]);
  expect(
    UNCOVERED.filter((k) => !missing.includes(k)),
    'a scenario sends these now: take them off UNCOVERED'
  ).toEqual([]);
}
let routesChecked = false;

// A shuffled run (--sequence.shuffle) can reach the check below before the scenarios, which then
// skips itself. This hook runs after every test in the file, so it makes the check instead.
afterAll(() => {
  if (ran === total && !routesChecked) expectEveryRouteSent();
});

describe('contract: every route', () => {
  it('sends every contract route, and each answers 2xx', (ctx) => {
    // A filtered or failed run sent fewer routes than a full one: it proves nothing here.
    if (ran < total) ctx.skip(`${ran} of ${total} scenarios had run`);
    routesChecked = true;
    expectEveryRouteSent();
  });

  it('serves every contract route, and lists every route it serves', () => {
    const { served, unreadable } = workerRoutes();
    expect(unreadable, 'mounts in index.ts whose routes this cannot read').toEqual([]);
    expect(
      CONTRACT_ROUTES.filter((k) => !served.has(k)),
      'contract routes the Worker does not serve'
    ).toEqual([]);
    expect(
      [...served].filter((k) => !CONTRACT_ROUTES.includes(k as RouteKey) && !(k in WORKER_ONLY)),
      'routes on no list in shared/contract/routes.ts'
    ).toEqual([]);
  });

  it('lists no route it does not serve', () => {
    const { served } = workerRoutes();
    expect(
      Object.keys(WORKER_ONLY).filter((k) => !served.has(k)),
      'routes WORKER_ONLY lists that the Worker does not serve'
    ).toEqual([]);
  });
});
