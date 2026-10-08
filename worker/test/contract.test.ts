import { env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { mcpRoutes } from '../src/mcp';
import { unsent, type Hit, type RouteKey } from '../../shared/contract/guard';
import { outbound } from '../../shared/contract/outbound';
import { CONTRACT_ROUTES, UNCOVERED, WORKER_ONLY } from '../../shared/contract/routes';
import { SCENARIOS } from '../../shared/contract/scenarios';
import type { ContractApi, Expect, Method, Reply } from '../../shared/contract/types';

// The CRUD contract (shared/contract) against the Worker and a real D1. Local-first runs the same
// scenarios in frontend/src/core/storage/__tests__/contract.test.ts. The last block checks that
// the scenarios sent every contract route, and that every route the Worker serves is on a list.

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true }): Record<string, T>;
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

function apiFor(cookie: string, profile: number, partner: () => ContractApi): ContractApi {
  const send = async (method: Method, path: string, body?: unknown): Promise<Reply> => {
    const form = body instanceof FormData;
    const res = await SELF.fetch(`https://example.com${path}`, {
      method,
      headers: {
        Cookie: cookie,
        // A form sets its own multipart type, boundary included.
        ...(form ? {} : { 'Content-Type': 'application/json' }),
        'X-Profile-Id': String(profile),
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
    return { status: res.status, body: parsed };
  };
  return {
    runtime: 'worker',
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    delete: (path) => send('DELETE', path),
    get other() {
      return partner();
    },
  };
}

/** A new person with two profiles, signed in. Every scenario gets its own, so none sees another's rows. */
async function person(): Promise<ContractApi> {
  people += 1;
  const user = 990_000 + people;
  const me = user * 10 + 1;
  const partner = user * 10 + 2;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, ?, 'password', 1)"
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

/** Every route the Worker serves: each routes module, the MCP server, and index.ts's own two. */
function workerRoutes(): Set<string> {
  const modules = import.meta.glob<Record<string, unknown>>('../src/routes/*.ts', { eager: true });
  const apps = [...Object.values(modules).flatMap((m) => Object.values(m)), mcpRoutes].filter(
    (v): v is { routes: { method: string; path: string }[] } =>
      typeof v === 'object' && v !== null && Array.isArray((v as { routes?: unknown }).routes)
  );
  const keys = new Set(['GET /api/health', 'GET /robots.txt']);
  for (const app of apps) {
    for (const r of app.routes) if (r.method !== 'ALL') keys.add(`${r.method} ${r.path}`);
  }
  return keys;
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

describe('contract: every route', () => {
  it('sends every contract route, and each answers 2xx', (ctx) => {
    // A filtered or failed run sent fewer routes than a full one: it proves nothing here.
    if (ran < total) ctx.skip();
    const missing = unsent(CONTRACT_ROUTES, hits);
    expect(
      missing.filter((k) => !UNCOVERED.includes(k)),
      'no scenario sends these'
    ).toEqual([]);
    expect(
      UNCOVERED.filter((k) => !missing.includes(k)),
      'a scenario sends these now: take them off UNCOVERED'
    ).toEqual([]);
  });

  it('serves every contract route, and lists every route it serves', () => {
    const served = workerRoutes();
    expect(
      CONTRACT_ROUTES.filter((k) => !served.has(k)),
      'contract routes the Worker does not serve'
    ).toEqual([]);
    expect(
      [...served].filter((k) => !CONTRACT_ROUTES.includes(k as RouteKey) && !(k in WORKER_ONLY)),
      'routes on no list in shared/contract/routes.ts'
    ).toEqual([]);
  });
});
