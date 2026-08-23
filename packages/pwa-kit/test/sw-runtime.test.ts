/**
 * These tests are the reason the caching rules live outside the worker file. Every case here is a
 * thing that happened, or would have: a deploy landing between two fetches, a chunk answered with
 * index.html and a 200, a cache surviving from a build whose chunks are gone. In a browser each of
 * them needs a deployment to reproduce; here they are a fake CacheStorage and a fake fetch.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SwPrecacheEntry, SwStaleBuildNotice } from '../src/sw-runtime';
import {
  BUILD_ID_MESSAGE,
  SKIP_WAITING_MESSAGE,
  STALE_BUILD_MESSAGE,
  createServiceWorkerRuntime,
  extensionOf,
  firstPaintAssets,
  htmlBelongsToBuild,
  manifestRevision,
} from '../src/sw-runtime';

const ORIGIN = 'https://app.test';
const BASE_URL = `${ORIGIN}/`;
const BUILD_ID = 'abc1234';
const SHELL_KEY = '/';
const CACHE_PREFIX = 'test-assets-';

const ENTRY_JS = '/assets/index-AAAAAAAA.js';
const ENTRY_CSS = '/assets/index-BBBBBBBB.css';
const LAZY_JS = '/assets/Reports-CCCCCCCC.js';
const FOREIGN_JS = '/assets/index-D3adB33f.js';

const MANIFEST: SwPrecacheEntry[] = [
  { url: ENTRY_JS, revision: null },
  { url: ENTRY_CSS, revision: null },
  { url: LAZY_JS, revision: null },
  { url: '/manifest.webmanifest', revision: null },
  { url: '/icon-192.png', revision: null },
];

const ALLOWED = new Set(MANIFEST.map((entry) => entry.url));

/** Extra documents this app ships beside the shell, plus the API. */
const STANDALONE = ['/export.html', '/export-monthly.html'];

function shellHtml(entry = ENTRY_JS): string {
  return [
    '<!doctype html><html><head>',
    `<link rel="stylesheet" href="${ENTRY_CSS}">`,
    '<link rel="icon" href="/icon-192.png">',
    '</head><body><div id="root"></div>',
    `<script type="module" crossorigin src="${entry}"></script>`,
    '</body></html>',
  ].join('');
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const javascript = (body = 'export default 1'): Response =>
  new Response(body, { headers: { 'content-type': 'application/javascript' } });
const stylesheet = (): Response =>
  new Response('.a{}', { headers: { 'content-type': 'text/css' } });
const image = (): Response => new Response('png', { headers: { 'content-type': 'image/png' } });
const json = (): Response =>
  new Response('{}', { headers: { 'content-type': 'application/manifest+json' } });

/** A request object with only the members the runtime reads. */
function request(
  path: string,
  init: { method?: string; mode?: string; headers?: HeadersInit } = {}
): Request {
  return {
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'no-cors',
    headers: new Headers(init.headers),
  } as unknown as Request;
}

const navigation = (path: string): Request => request(path, { mode: 'navigate' });

function pathOf(key: RequestInfo | URL): string {
  const raw = typeof key === 'string' ? key : key instanceof URL ? key.href : (key as Request).url;
  return new URL(raw, BASE_URL).pathname;
}

class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    // Real Cache hands out a fresh body every time; without the clone the second read in a test
    // would throw instead of the assertion failing.
    return Promise.resolve(this.entries.get(pathOf(key))?.clone());
  }

  async put(key: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(pathOf(key), response);
    return Promise.resolve();
  }

  async keys(): Promise<Request[]> {
    return Promise.resolve(
      [...this.entries.keys()].map((path) => ({ url: `${ORIGIN}${path}` }) as unknown as Request)
    );
  }

  async delete(key: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(pathOf(key)));
  }
}

class FakeCacheStorage {
  readonly opened = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    const existing = this.opened.get(name);
    if (existing !== undefined) return Promise.resolve(existing);
    const created = new FakeCache();
    this.opened.set(name, created);
    return Promise.resolve(created);
  }

  async keys(): Promise<string[]> {
    return Promise.resolve([...this.opened.keys()]);
  }

  async delete(name: string): Promise<boolean> {
    return Promise.resolve(this.opened.delete(name));
  }
}

interface Harness {
  runtime: ReturnType<typeof createServiceWorkerRuntime>;
  caches: FakeCacheStorage;
  fetched: string[];
  notices: SwStaleBuildNotice[];
  respond: (path: string, factory: () => Response) => void;
  cacheEntries: () => Promise<string[]>;
}

function harness(
  options: {
    manifest?: SwPrecacheEntry[];
    buildId?: string;
    routes?: Record<string, () => Response>;
    caches?: FakeCacheStorage;
  } = {}
): Harness {
  const cacheStorage = options.caches ?? new FakeCacheStorage();
  const fetched: string[] = [];
  const notices: SwStaleBuildNotice[] = [];
  const routes = new Map<string, () => Response>(Object.entries(options.routes ?? {}));

  const runtime = createServiceWorkerRuntime({
    manifest: options.manifest ?? MANIFEST,
    buildId: options.buildId ?? BUILD_ID,
    baseUrl: BASE_URL,
    cachePrefix: CACHE_PREFIX,
    standaloneDocumentPaths: STANDALONE,
    stableShellAssets: ['/manifest.webmanifest', '/icon-192.png'],
    env: {
      caches: cacheStorage as unknown as CacheStorage,
      fetch: async (input) => {
        const path = pathOf(input as RequestInfo);
        fetched.push(path);
        const route = routes.get(path);
        if (route === undefined) return Promise.reject(new Error(`unrouted fetch: ${path}`));
        return Promise.resolve(route());
      },
      notifyClients: (message) => notices.push(message),
    },
  });

  return {
    runtime,
    caches: cacheStorage,
    fetched,
    notices,
    respond: (path, factory) => routes.set(path, factory),
    cacheEntries: async () => {
      const cache = await cacheStorage.open(runtime.cacheName);
      return [...cache.entries.keys()].sort();
    },
  };
}

/** Everything a healthy deploy answers. */
function healthyRoutes(): Record<string, () => Response> {
  return {
    [SHELL_KEY]: () => html(shellHtml()),
    [ENTRY_JS]: () => javascript(),
    [ENTRY_CSS]: () => stylesheet(),
    [LAZY_JS]: () => javascript(),
    '/manifest.webmanifest': () => json(),
    '/icon-192.png': () => image(),
  };
}

// ── The pure helpers ───────────────────────────────────────────────────────────────────────────

describe('manifestRevision', () => {
  it('names a set of URLs, not an order', () => {
    expect(manifestRevision(['/a.js', '/b.js'])).toBe(manifestRevision(['/b.js', '/a.js']));
  });

  it('changes when the shipped set changes', () => {
    expect(manifestRevision(['/a.js'])).not.toBe(manifestRevision(['/a.js', '/b.js']));
  });

  it('separates entries, so a shifted boundary is a different build', () => {
    expect(manifestRevision(['/ab', '/c'])).not.toBe(manifestRevision(['/a', '/bc']));
  });

  it('is eight hex characters, so the cache name stays readable', () => {
    expect(manifestRevision(['/a.js'])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('extensionOf', () => {
  it('reads the extension only when it belongs to the last segment', () => {
    expect(extensionOf('/assets/index-AAAA.js')).toBe('.js');
    // A dot in a directory name is not an extension on the file.
    expect(extensionOf('/v1.2/chunk')).toBe('');
    expect(extensionOf('/assets/INDEX.JS')).toBe('.js');
  });
});

describe('htmlBelongsToBuild', () => {
  it('accepts a shell whose scripts this build shipped', () => {
    expect(htmlBelongsToBuild(shellHtml(), ALLOWED, BASE_URL)).toBe(true);
  });

  it('rejects a shell naming an entry from another deploy', () => {
    expect(htmlBelongsToBuild(shellHtml(FOREIGN_JS), ALLOWED, BASE_URL)).toBe(false);
  });

  it('rejects a document with no build output at all', () => {
    // An error page, a placeholder, a captive portal's interstitial.
    expect(htmlBelongsToBuild('<html><body>Gateway timeout</body></html>', ALLOWED, BASE_URL)).toBe(
      false
    );
  });

  it('ignores stylesheets and preloads, which are not the chunk map', () => {
    const withStrayCss = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="/assets/from-another-deploy.css">',
      '<link rel="modulepreload" href="/assets/also-not-ours.js">',
      `</head><body><script type="module" src="${ENTRY_JS}"></script></body></html>`,
    ].join('');
    expect(htmlBelongsToBuild(withStrayCss, ALLOWED, BASE_URL)).toBe(true);
  });

  /**
   * The reason references are resolved rather than matched on a leading slash. Vite writes
   * `./assets/…` when `base` is relative and `/assets/…` when it is absolute — the same file, and
   * a worker that recognised only one of them would precache nothing and check nothing, silently.
   */
  it('recognises a relative reference, which a relative Vite base emits', () => {
    const relative = `<html><body><script type="module" src=".${ENTRY_JS}"></script></body></html>`;
    expect(htmlBelongsToBuild(relative, ALLOWED, BASE_URL)).toBe(true);
  });

  it('recognises an absolute URL on this origin', () => {
    const absolute = `<html><body><script src="${ORIGIN}${ENTRY_JS}"></script></body></html>`;
    expect(htmlBelongsToBuild(absolute, ALLOWED, BASE_URL)).toBe(true);
  });
});

describe('firstPaintAssets', () => {
  it('collects the shell subresources this build shipped', () => {
    expect(firstPaintAssets(shellHtml(), ALLOWED, BASE_URL).sort()).toEqual(
      [ENTRY_JS, ENTRY_CSS, '/icon-192.png'].sort()
    );
  });

  it('drops references the manifest does not list', () => {
    const withStray = `${shellHtml()}<script src="${FOREIGN_JS}"></script>`;
    expect(firstPaintAssets(withStray, ALLOWED, BASE_URL)).not.toContain(FOREIGN_JS);
  });

  it('deduplicates a URL referenced twice', () => {
    const twice = `${shellHtml()}<link rel="modulepreload" href="${ENTRY_JS}">`;
    expect(firstPaintAssets(twice, ALLOWED, BASE_URL).filter((p) => p === ENTRY_JS)).toHaveLength(
      1
    );
  });

  it('reads a relative reference the same as an absolute one', () => {
    const relative = `<html><head><link rel="stylesheet" href=".${ENTRY_CSS}"></head></html>`;
    expect(firstPaintAssets(relative, ALLOWED, BASE_URL)).toEqual([ENTRY_CSS]);
  });
});

// ── install ────────────────────────────────────────────────────────────────────────────────────

describe('install', () => {
  it('precaches the shell and what it needs to boot', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();

    expect(await h.cacheEntries()).toEqual(
      [SHELL_KEY, ENTRY_JS, ENTRY_CSS, '/icon-192.png', '/manifest.webmanifest'].sort()
    );
    // The lazy chunk is in the manifest but not referenced by the shell: it is fetched when it is
    // needed, not paid for up front.
    expect(h.fetched).not.toContain(LAZY_JS);
  });

  it('names the cache after the shipped set, so builds do not share one', () => {
    const a = harness({ routes: healthyRoutes() }).runtime.cacheName;
    const b = harness({
      manifest: [...MANIFEST, { url: '/assets/new-EEEEEEEE.js', revision: null }],
    }).runtime.cacheName;

    expect(a).toMatch(new RegExp(`^${CACHE_PREFIX}`));
    expect(a).not.toBe(b);
  });

  it('refuses a shell built from a different deploy', async () => {
    // The hazard: a deploy landing between the worker script and its shell fetch. Failing the
    // install leaves the visitor whole on the build they already have.
    const h = harness({
      routes: { ...healthyRoutes(), [SHELL_KEY]: () => html(shellHtml(FOREIGN_JS)) },
    });

    await expect(h.runtime.install()).rejects.toThrow(/different build/);
    expect(await h.cacheEntries()).not.toContain(SHELL_KEY);
  });

  it('refuses a shell request the origin did not answer with a document', async () => {
    const h = harness({
      routes: { ...healthyRoutes(), [SHELL_KEY]: () => new Response('nope', { status: 502 }) },
    });

    await expect(h.runtime.install()).rejects.toThrow(/did not answer with a document/);
  });

  it('fails rather than activating when the origin is unreachable', async () => {
    const h = harness({ routes: {} });
    await expect(h.runtime.install()).rejects.toThrow();
  });

  it('copies a previous build forward instead of re-downloading it', async () => {
    const caches = new FakeCacheStorage();
    const previous = await caches.open(`${CACHE_PREFIX}deadbeef`);
    await previous.put(ENTRY_CSS, stylesheet());

    const h = harness({ caches, routes: healthyRoutes() });
    await h.runtime.install();

    expect(await h.cacheEntries()).toContain(ENTRY_CSS);
    // Hashed names are content addresses, so the shared URL is byte-for-byte the same file.
    expect(h.fetched).not.toContain(ENTRY_CSS);
  });

  it('does not copy forward a URL this build no longer ships', async () => {
    const caches = new FakeCacheStorage();
    const previous = await caches.open(`${CACHE_PREFIX}deadbeef`);
    await previous.put(FOREIGN_JS, javascript());

    const h = harness({ caches, routes: healthyRoutes() });
    await h.runtime.install();

    expect(await h.cacheEntries()).not.toContain(FOREIGN_JS);
  });

  it('does not copy the previous shell, the one file whose URL never changes', async () => {
    const caches = new FakeCacheStorage();
    const previous = await caches.open(`${CACHE_PREFIX}deadbeef`);
    await previous.put(SHELL_KEY, html(shellHtml(FOREIGN_JS)));

    const h = harness({ caches, routes: healthyRoutes() });
    await h.runtime.install();

    const cache = await caches.open(h.runtime.cacheName);
    expect(await (await cache.match(SHELL_KEY))?.text()).toContain(ENTRY_JS);
  });

  it('ignores caches belonging to something else on the origin', async () => {
    const caches = new FakeCacheStorage();
    const stranger = await caches.open('some-other-app-v1');
    await stranger.put(ENTRY_CSS, stylesheet());

    const h = harness({ caches, routes: healthyRoutes() });
    await h.runtime.install();

    // Not adopted from, and — see activate — not deleted either.
    expect(h.fetched).toContain(ENTRY_CSS);
  });

  it('finishes even when a first-paint asset cannot be fetched', async () => {
    const routes = healthyRoutes();
    delete routes[ENTRY_CSS];
    const h = harness({ routes });

    await expect(h.runtime.install()).resolves.toBeUndefined();
    expect(await h.cacheEntries()).toContain(SHELL_KEY);
    expect(await h.cacheEntries()).not.toContain(ENTRY_CSS);
  });

  it('never stores a response whose type contradicts its URL', async () => {
    // The SPA fallback wearing an asset URL: a 200, text/html, under a .js path.
    const h = harness({ routes: { ...healthyRoutes(), [ENTRY_JS]: () => html('<html></html>') } });
    await h.runtime.install();

    expect(await h.cacheEntries()).not.toContain(ENTRY_JS);
  });

  it('revalidates stable names and trusts hashed ones', async () => {
    const seen: (RequestInit | undefined)[] = [];
    const caches = new FakeCacheStorage();
    const routes = healthyRoutes();
    const runtime = createServiceWorkerRuntime({
      manifest: MANIFEST,
      buildId: BUILD_ID,
      baseUrl: BASE_URL,
      cachePrefix: CACHE_PREFIX,
      stableShellAssets: ['/manifest.webmanifest'],
      env: {
        caches: caches as unknown as CacheStorage,
        fetch: async (input, init) => {
          const path = pathOf(input as RequestInfo);
          if (path !== SHELL_KEY) seen.push(init);
          const route = routes[path];
          if (route === undefined) return Promise.reject(new Error(`unrouted: ${path}`));
          return Promise.resolve(route());
        },
        notifyClients: () => undefined,
      },
    });
    await runtime.install();

    // Hashed build output: the filename is its revision, and the visit that installed this worker
    // has already downloaded these bytes — no revalidation round-trip.
    expect(seen.filter((init) => init === undefined).length).toBeGreaterThan(0);
    // A stable name can change under the same URL, so it always asks.
    expect(seen).toContainEqual({ cache: 'no-cache' });
  });
});

// ── activate ───────────────────────────────────────────────────────────────────────────────────

describe('activate', () => {
  it('drops the other builds and keeps this one', async () => {
    const caches = new FakeCacheStorage();
    await caches.open(`${CACHE_PREFIX}deadbeef`);
    await caches.open('some-other-app-v1');

    const h = harness({ caches, routes: healthyRoutes() });
    await h.runtime.install();
    await h.runtime.activate();

    const names = await caches.keys();
    expect(names).toContain(h.runtime.cacheName);
    expect(names).not.toContain(`${CACHE_PREFIX}deadbeef`);
    // Another app's cache on the same origin is none of this worker's business.
    expect(names).toContain('some-other-app-v1');
  });
});

// ── navigation ─────────────────────────────────────────────────────────────────────────────────

describe('navigation', () => {
  it('answers from the precache without touching the network', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();
    h.fetched.length = 0;

    const response = await h.runtime.handleFetch(navigation('/'))!;

    expect(await response.text()).toContain(ENTRY_JS);
    expect(h.fetched).toEqual([]);
  });

  it('serves the shell for a deep link, not just the root', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();
    h.fetched.length = 0;

    const response = await h.runtime.handleFetch(navigation('/reports/2026'))!;

    expect(await response.text()).toContain(ENTRY_JS);
    expect(h.fetched).toEqual([]);
  });

  it('falls back to the network before the first install finishes', async () => {
    const h = harness({ routes: healthyRoutes() });

    const response = await h.runtime.handleFetch(navigation('/'))!;

    expect(await response.text()).toContain(ENTRY_JS);
    // And it adopts what came back, so the next load is offline-capable.
    expect(await h.cacheEntries()).toContain(SHELL_KEY);
  });

  it('serves but never caches a document from another build', async () => {
    const h = harness({
      routes: { ...healthyRoutes(), [SHELL_KEY]: () => html(shellHtml(FOREIGN_JS)) },
    });

    const response = await h.runtime.handleFetch(navigation('/'))!;

    expect(response.status).toBe(200);
    expect(await h.cacheEntries()).not.toContain(SHELL_KEY);
  });

  it('discards a cached shell whose chunks this build does not have', async () => {
    const caches = new FakeCacheStorage();
    const h = harness({ caches, routes: healthyRoutes() });
    const cache = await caches.open(h.runtime.cacheName);
    // Only reachable if a cache outlived the naming scheme that produced it — but serving it costs
    // a white screen that no reload clears.
    await cache.put(SHELL_KEY, html(shellHtml(FOREIGN_JS)));

    const response = await h.runtime.handleFetch(navigation('/'))!;

    expect(await response.text()).toContain(ENTRY_JS);
    expect(h.fetched).toContain(SHELL_KEY);
  });

  it('passes an error page straight through without caching it', async () => {
    const h = harness({
      routes: { ...healthyRoutes(), [SHELL_KEY]: () => html('<h1>503</h1>', 503) },
    });

    const response = await h.runtime.handleFetch(navigation('/'))!;

    expect(response.status).toBe(503);
    expect(await h.cacheEntries()).not.toContain(SHELL_KEY);
  });

  it('hands a redirect back to the browser instead of following it', async () => {
    const redirected = html(shellHtml());
    Object.defineProperty(redirected, 'redirected', { value: true });
    Object.defineProperty(redirected, 'url', { value: `${ORIGIN}/login` });
    const h = harness({ routes: { ...healthyRoutes(), [SHELL_KEY]: () => redirected } });

    const response = await h.runtime.handleFetch(navigation('/'))!;

    // A redirect followed inside the worker keeps the requested URL in the address bar while
    // showing the target's content.
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('stays out of the way of the standalone documents', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();

    // Substituting the shell for one of these would silently serve the wrong page.
    for (const path of STANDALONE) {
      expect(h.runtime.handleFetch(navigation(path))).toBeUndefined();
    }
  });

  it('stays out of the way of the API', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();

    expect(h.runtime.handleFetch(navigation('/api/export'))).toBeUndefined();
  });
});

// ── assets ─────────────────────────────────────────────────────────────────────────────────────

describe('assets', () => {
  let h: Harness;

  beforeEach(async () => {
    h = harness({ routes: healthyRoutes() });
    await h.runtime.install();
    h.fetched.length = 0;
  });

  it('answers a precached chunk without a request', async () => {
    const response = await h.runtime.handleFetch(request(ENTRY_JS))!;

    expect(response.status).toBe(200);
    expect(h.fetched).toEqual([]);
  });

  it('fetches and stores a chunk that was not part of the first paint', async () => {
    const response = await h.runtime.handleFetch(request(LAZY_JS))!;

    expect(response.status).toBe(200);
    expect(await h.cacheEntries()).toContain(LAZY_JS);
  });

  it('turns the SPA fallback under a chunk URL into a load failure', async () => {
    h.respond(LAZY_JS, () => html('<html></html>'));

    const response = await h.runtime.handleFetch(request(LAZY_JS))!;

    // A 503 fails the load, which chunk-error recovery already handles. Returning the HTML would
    // put a document through a JavaScript parser — the crash this design exists to stop.
    expect(response.status).toBe(503);
    expect(h.notices).toEqual([{ type: STALE_BUILD_MESSAGE, path: LAZY_JS }]);
    expect(await h.cacheEntries()).not.toContain(LAZY_JS);
  });

  it("fails a previous build's chunk cleanly instead of serving HTML", async () => {
    h.respond(FOREIGN_JS, () => html('<html></html>'));

    const response = await h.runtime.handleFetch(request(FOREIGN_JS))!;

    expect(response.status).toBe(503);
    expect(h.notices).toEqual([{ type: STALE_BUILD_MESSAGE, path: FOREIGN_JS }]);
  });

  it("reports a previous build's chunk that 404s, and passes the 404 on", async () => {
    h.respond(FOREIGN_JS, () => new Response('', { status: 404 }));

    const response = await h.runtime.handleFetch(request(FOREIGN_JS))!;

    expect(response.status).toBe(404);
    expect(h.notices).toHaveLength(1);
  });

  it("leaves a previous build's chunk alone while it is still served", async () => {
    // Mid-deploy the edge may still have it; there is nothing stale to report.
    h.respond(FOREIGN_JS, () => javascript());

    const response = await h.runtime.handleFetch(request(FOREIGN_JS))!;

    expect(response.status).toBe(200);
    expect(h.notices).toEqual([]);
    expect(await h.cacheEntries()).not.toContain(FOREIGN_JS);
  });

  it('never stores an opaque response, which it cannot inspect', async () => {
    const opaque = javascript();
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    h.respond(LAZY_JS, () => opaque);

    await h.runtime.handleFetch(request(LAZY_JS))!;

    expect(await h.cacheEntries()).not.toContain(LAZY_JS);
  });

  it('never stores a response that came from somewhere else', async () => {
    const moved = javascript();
    Object.defineProperty(moved, 'redirected', { value: true });
    h.respond(LAZY_JS, () => moved);

    await h.runtime.handleFetch(request(LAZY_JS))!;

    expect(await h.cacheEntries()).not.toContain(LAZY_JS);
  });

  it('never stores a response that declares no type at all', async () => {
    h.respond(LAZY_JS, () => new Response('x'));

    await h.runtime.handleFetch(request(LAZY_JS))!;

    expect(await h.cacheEntries()).not.toContain(LAZY_JS);
  });

  it('serves the response even when it cannot be stored', async () => {
    const cache = await h.caches.open(h.runtime.cacheName);
    cache.put = () => Promise.reject(new Error('QuotaExceededError'));

    const response = await h.runtime.handleFetch(request(LAZY_JS))!;

    // A promise that rejects inside respondWith shows the browser's network-error page, which no
    // reload clears while the worker is installed.
    expect(response.status).toBe(200);
  });

  it('serves the network when storage refuses to answer at all', async () => {
    h.caches.open = () => Promise.reject(new Error('site data cleared'));

    const response = await h.runtime.handleFetch(request(ENTRY_JS))!;

    expect(response.status).toBe(200);
    expect(h.fetched).toContain(ENTRY_JS);
  });
});

// ── what it declines to handle ─────────────────────────────────────────────────────────────────

describe('what the worker declines to handle', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness({ routes: healthyRoutes() });
  });

  it('ignores anything that is not a GET', () => {
    expect(h.runtime.handleFetch(request(ENTRY_JS, { method: 'POST' }))).toBeUndefined();
  });

  it('ignores other origins', () => {
    expect(h.runtime.handleFetch(request('https://fonts.example/x.woff2'))).toBeUndefined();
  });

  it('ignores range requests, which a cache cannot satisfy', () => {
    expect(
      h.runtime.handleFetch(request(ENTRY_JS, { headers: { range: 'bytes=0-1' } }))
    ).toBeUndefined();
  });

  it('ignores anything off the manifest that is not build output', () => {
    // The version stamp, the API, an uploaded receipt: fetched normally, never stored.
    expect(h.runtime.handleFetch(request('/version.json'))).toBeUndefined();
    expect(h.runtime.handleFetch(request('/api/receipts/1/file'))).toBeUndefined();
  });
});

// ── messages ───────────────────────────────────────────────────────────────────────────────────

describe('messages', () => {
  const runtime = harness({ routes: healthyRoutes() }).runtime;

  it('recognises the accepted-update message', () => {
    expect(runtime.handleMessage({ type: SKIP_WAITING_MESSAGE })).toEqual({ kind: 'skip-waiting' });
  });

  it('answers the build-id question with what it was built from', () => {
    expect(runtime.handleMessage({ type: BUILD_ID_MESSAGE })).toEqual({
      kind: 'build-id',
      buildId: BUILD_ID,
    });
  });

  it('ignores anything else, including data with no shape at all', () => {
    expect(runtime.handleMessage({ type: 'something-else' })).toBeUndefined();
    expect(runtime.handleMessage(null)).toBeUndefined();
    expect(runtime.handleMessage('skip-waiting')).toBeUndefined();
    expect(runtime.handleMessage(undefined)).toBeUndefined();
  });
});

describe('the runtime it exposes to the worker', () => {
  it('reports the build and the allowlist it was created with', () => {
    const { runtime } = harness({ routes: healthyRoutes() });
    expect(runtime.buildId).toBe(BUILD_ID);
    expect([...runtime.allowedPaths].sort()).toEqual([...ALLOWED].sort());
  });

  it('resolves manifest URLs against the worker scope', () => {
    const runtime = createServiceWorkerRuntime({
      manifest: [{ url: 'assets/index-AAAAAAAA.js', revision: null }],
      buildId: BUILD_ID,
      baseUrl: BASE_URL,
      env: {
        caches: new FakeCacheStorage() as unknown as CacheStorage,
        fetch: () => Promise.reject(new Error('not used')),
        notifyClients: () => undefined,
      },
    });
    // A relative manifest entry — what a relative Vite base produces — must land on the same
    // pathname a request for it will carry.
    expect([...runtime.allowedPaths]).toEqual([ENTRY_JS]);
  });

  it('does not notify anyone when nothing is stale', async () => {
    const h = harness({ routes: healthyRoutes() });
    await h.runtime.install();
    await h.runtime.handleFetch(request(LAZY_JS))!;
    await h.runtime.handleFetch(navigation('/'))!;

    expect(h.notices).toEqual([]);
  });
});
