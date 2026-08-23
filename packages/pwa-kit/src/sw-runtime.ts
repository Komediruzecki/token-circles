/**
 * sw-runtime — every caching rule a service worker built on this kit follows.
 *
 * The worker file itself (the app's `sw.ts`) owns the globals — `self`, `clients`, `skipWaiting`,
 * `__WB_MANIFEST` — and nothing else. The rules live here so they can be run against a fake
 * CacheStorage in a unit test rather than only against a real browser, because "what does the
 * worker serve after a deploy" is the question that decides whether the app opens at all.
 *
 * The model is a **precached shell, one build at a time**:
 *
 *   install   fetch the shell document, refuse it unless every script it references is in *this*
 *             build's manifest, then store it alongside the assets it needs to boot. A previous
 *             build's cache is copied forward first, so an unchanged chunk costs nothing.
 *   fetch     navigations answer from that cached shell without touching the network; assets
 *             answer cache-first from this build's cache only.
 *   activate  drop the other builds' caches.
 *
 * So a visitor keeps running one complete, self-consistent build until they accept an update.
 * That is the difference between this and a network-first design: network-first keeps the HTML
 * fresh and pays for it, because a page entered mid-deploy pairs new HTML with chunks the edge
 * has already dropped.
 *
 * Two hazards shape the details:
 *
 * 1. A static host configured to answer unknown paths with the SPA shell returns index.html and
 *    a 200 for a deleted chunk, not a 404. Nothing enters a cache unless its content type matches
 *    what its extension claims, and a hashed chunk answered with HTML is converted into a 503 so
 *    it fails as a load error — a shape an app's chunk-error recovery already handles — instead of
 *    a syntax error inside the page.
 * 2. A shell document from one deploy served next to another deploy's chunk map reproduces
 *    `vite:preloadError` forever. Hence the build check on every shell that is stored *or* served:
 *    the entry scripts the HTML names must be URLs this build shipped.
 *
 * Nothing outside the manifest is ever stored. Cross-origin requests are not touched at all.
 */

/** Injected by vite-plugin-pwa's `injectManifest` into `self.__WB_MANIFEST`. */
export interface SwPrecacheEntry {
  url: string;
  revision: string | null;
}

/**
 * Posted by the page when the user accepts an update.
 *
 * The three message names are module constants rather than options: both halves of the handshake
 * import them from here, so they cannot drift apart. A configurable prefix would buy nothing —
 * service-worker messages never leave their own registration — and would add a way to get it
 * wrong.
 */
export const SKIP_WAITING_MESSAGE = 'pwa-kit:skip-waiting';

/**
 * Asked by the page before it prompts: a waiting worker built from the commit the page is already
 * running has nothing to announce.
 */
export const BUILD_ID_MESSAGE = 'pwa-kit:build-id';

/**
 * Posted *to* the pages when a request proves this build is no longer the one being served. That
 * is the moment an update check is worth making — the page has just asked for something the
 * origin no longer has.
 */
export const STALE_BUILD_MESSAGE = 'pwa-kit:stale-build';

/** What a build id falls back to when no git or CI sha was available. */
export const UNKNOWN_BUILD_ID = 'unknown';

/**
 * What each extension is allowed to answer with. A response whose type does not match is the SPA
 * fallback (or an error page) wearing an asset URL, and caching it is hazard 1 above.
 */
const CONTENT_TYPE_BY_EXTENSION = new Map<string, RegExp>([
  ['.js', /javascript|ecmascript/],
  ['.mjs', /javascript|ecmascript/],
  ['.css', /text\/css/],
  ['.webmanifest', /json|manifest/],
  ['.json', /json/],
  ['.png', /^image\//],
  ['.jpg', /^image\//],
  ['.jpeg', /^image\//],
  ['.webp', /^image\//],
  ['.svg', /svg|xml/],
  ['.ico', /icon|image\//],
  ['.woff', /font/],
  ['.woff2', /font/],
]);

/** Hashed build output: immutable, and the only thing a stale chunk can be. */
const VERSIONED_ASSET_EXTENSIONS = new Set(['.js', '.mjs', '.css']);

export function extensionOf(pathname: string): string {
  const lastDot = pathname.lastIndexOf('.');
  const lastSlash = pathname.lastIndexOf('/');
  return lastDot > lastSlash ? pathname.slice(lastDot).toLowerCase() : '';
}

function contentTypeMatchesUrl(pathname: string, response: Response): boolean {
  const expected = CONTENT_TYPE_BY_EXTENSION.get(extensionOf(pathname));
  // An extension with no rule is not something this worker knows how to validate, so it does not
  // get cached.
  if (expected === undefined) return false;
  const contentType = response.headers.get('content-type') ?? '';
  return expected.test(contentType.toLowerCase());
}

/**
 * A response is only allowed into a cache when it is unambiguously the bytes for the URL that was
 * asked for: not an error, not opaque (an opaque response cannot be inspected at all), not a
 * redirect to somewhere else, and carrying the content type its extension promises.
 */
export function isCacheableAsset(pathname: string, response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  if (response.redirected) return false;
  return contentTypeMatchesUrl(pathname, response);
}

export function isHtmlDocument(response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/**
 * Every `src`/`href` in the document, resolved to a pathname.
 *
 * Resolved rather than pattern-matched on a leading slash, because a Vite build with a relative
 * `base` writes `./assets/index-abc123.js` while an absolute base writes `/assets/index-abc123.js`
 * — the same file, and a worker that only recognised one of them would silently precache nothing
 * and check nothing.
 */
function referencedPaths(html: string, baseUrl: string, attribute: RegExp): string[] {
  const found: string[] = [];
  let match = attribute.exec(html);
  while (match !== null) {
    const raw = match[1];
    if (raw !== undefined) {
      try {
        found.push(new URL(raw, baseUrl).pathname);
      } catch {
        // A malformed reference is not something to resolve; it is also not something that can
        // name a build asset, so ignoring it is the whole handling.
      }
    }
    match = attribute.exec(html);
  }
  return found;
}

const ANY_SOURCE = /(?:src|href)="([^"]+)"/g;
const SCRIPT_SOURCE = /<script\b[^>]*\bsrc="([^"]+)"/g;

/**
 * The subresources the shell references — its entry modules, stylesheets and the preloads Vite
 * emits for the first paint. Read out of the shipped HTML instead of hardcoded, so the set cannot
 * drift from the build, and intersected with the manifest so a hand-edited HTML file cannot widen
 * it.
 */
export function firstPaintAssets(
  html: string,
  allowedPaths: ReadonlySet<string>,
  baseUrl = 'https://localhost/'
): string[] {
  const found = new Set<string>();
  for (const path of referencedPaths(html, baseUrl, new RegExp(ANY_SOURCE))) {
    if (allowedPaths.has(path)) found.add(path);
  }
  return [...found];
}

/**
 * Whether this HTML is *this* build's shell. The scripts a document loads are its chunk map: if
 * the shell names an entry this build did not ship, the two halves came from different deploys
 * and pairing them is hazard 2. Checked on the way into the cache and again on the way out, so
 * neither a deploy landing mid-install nor a cache surviving a scheme change can pin a visitor to
 * a shell whose chunks are gone.
 *
 * Only `<script src>` is checked, not every reference: it is the exact set that decides whether
 * the app boots, and it cannot be widened by a stylesheet or a preload hint the manifest happens
 * to omit.
 */
export function htmlBelongsToBuild(
  html: string,
  allowedPaths: ReadonlySet<string>,
  baseUrl = 'https://localhost/'
): boolean {
  const scripts = referencedPaths(html, baseUrl, new RegExp(SCRIPT_SOURCE));
  // A document with no build output in it is not the app shell — an error page, a placeholder, or
  // a captive portal's interstitial.
  if (scripts.length === 0) return false;
  return scripts.every((path) => allowedPaths.has(path));
}

/**
 * A stable name for a set of shipped URLs. Two deploys that shipped the same assets share a cache
 * (nothing to re-download, and their shells are interchangeable by definition); anything else gets
 * its own, so the previous build stays intact and complete until this one is adopted.
 *
 * FNV-1a rather than a crypto digest: it is synchronous, has no dependency, and the only property
 * needed is that a different asset list produces a different name.
 */
export function manifestRevision(paths: Iterable<string>): string {
  let hash = 0x811c9dc5;
  for (const path of [...paths].sort()) {
    for (let index = 0; index < path.length; index += 1) {
      hash = Math.imul(hash ^ path.charCodeAt(index), 0x01000193) >>> 0;
    }
    // Separator, so ['ab', 'c'] and ['a', 'bc'] cannot collide.
    hash = Math.imul(hash ^ 0x0a, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** What the page is told when a request proves this build is no longer served. */
export interface SwStaleBuildNotice {
  type: typeof STALE_BUILD_MESSAGE;
  path: string;
}

/** The worker globals the rules need, injected so tests can supply fakes. */
export interface SwRuntimeEnvironment {
  caches: CacheStorage;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Fire-and-forget; the app's `sw.ts` posts to every controlled page. */
  notifyClients: (message: SwStaleBuildNotice) => void;
}

/** Everything an app can vary. Every field has a default that suits a standard Vite SPA. */
export interface SwRuntimeConfig {
  /**
   * Prefix for this app's caches. It is what makes "every other build's cache" a set this worker
   * can find and delete without touching anything else on the origin — so it must not collide
   * with another app deployed to the same origin.
   */
  cachePrefix?: string;
  /**
   * Where the shell document is cached. The bare origin root by default, because that is
   * `start_url` in the manifest, and because `/index.html` is a redirect on some static hosts (a
   * redirected response is not a response to the URL that was asked for, so it must not be
   * cached).
   */
  shellKey?: string;
  /** Where hashed build output lives. Anything under it is treated as immutable. */
  assetPathPrefix?: string;
  /**
   * Paths that are their own HTML document rather than the app shell — extra Rollup inputs, and
   * any alias path a host rewrite maps onto one. Substituting the shell for one of these would
   * silently serve the wrong page, so the worker stays out of their way entirely.
   */
  standaloneDocumentPaths?: Iterable<string>;
  /** Small, stable files the installed app needs that the shell does not reference as a script. */
  stableShellAssets?: Iterable<string>;
  /** Path prefixes the worker never answers: the API, anything dynamic. */
  bypassPathPrefixes?: Iterable<string>;
}

export interface SwRuntimeOptions extends SwRuntimeConfig {
  manifest: readonly SwPrecacheEntry[];
  /** The commit this build came from, compared against the page's before prompting. */
  buildId: string;
  /** `self.location.href` — what manifest URLs and HTML references resolve against. */
  baseUrl: string;
  env: SwRuntimeEnvironment;
}

/** What the worker should do about a message; it owns the globals to do it. */
export type SwMessageAction = { kind: 'skip-waiting' } | { kind: 'build-id'; buildId: string };

export interface ServiceWorkerRuntime {
  readonly cacheName: string;
  readonly buildId: string;
  readonly allowedPaths: ReadonlySet<string>;
  /** Rejects rather than activating a worker that cannot form one build. */
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /** `undefined` means "not this worker's business" — let the browser do it. */
  handleFetch: (request: Request) => Promise<Response> | undefined;
  handleMessage: (data: unknown) => SwMessageAction | undefined;
}

export function createServiceWorkerRuntime(options: SwRuntimeOptions): ServiceWorkerRuntime {
  const { buildId, env } = options;
  const origin = new URL(options.baseUrl).origin;
  const cachePrefix = options.cachePrefix ?? 'pwa-kit-assets-';
  const shellKey = options.shellKey ?? '/';
  const assetPathPrefix = options.assetPathPrefix ?? '/assets/';
  const standaloneDocuments = new Set(options.standaloneDocumentPaths ?? []);
  const stableShellAssets = [...(options.stableShellAssets ?? [])];
  const bypassPrefixes = [...(options.bypassPathPrefixes ?? ['/api/'])];

  const allowedPaths: ReadonlySet<string> = new Set(
    options.manifest.map((entry) => new URL(entry.url, options.baseUrl).pathname)
  );
  const cacheName = cachePrefix + manifestRevision(allowedPaths);

  /**
   * A URL that can only be build output. Used to decide whether a path *absent* from this build's
   * manifest is a previous deploy's chunk — the one case where the worker has to intervene on a
   * URL it does not otherwise own.
   */
  const isVersionedAssetPath = (pathname: string): boolean =>
    pathname.startsWith(assetPathPrefix) && VERSIONED_ASSET_EXTENSIONS.has(extensionOf(pathname));

  const servesShell = (pathname: string): boolean =>
    !standaloneDocuments.has(pathname) && !bypassPrefixes.some((p) => pathname.startsWith(p));

  /**
   * Cache work that must never fail the request it belongs to. Storage can refuse — a full quota,
   * site data cleared mid-session — and a promise that rejects inside `respondWith` does not fall
   * back to the network: it shows the browser's network-error page, which no reload clears while
   * the worker is installed. Degrading to "as if no worker were here" is the only acceptable
   * answer.
   */
  const bestEffort = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  };

  /** Fetch one allowlisted URL and store it, but never fail the caller. */
  const warm = async (cache: Cache, pathname: string): Promise<void> => {
    if (!allowedPaths.has(pathname)) return;
    // Copied forward from the previous build, or already warmed this install.
    if ((await cache.match(pathname)) !== undefined) return;
    try {
      // Hashed build output is immutable — the filename is its revision — so let the HTTP cache
      // answer without a revalidation round-trip: the visit that installs this worker has just
      // downloaded these same files to render the page. Stable names (the manifest, the icons)
      // still revalidate with the server.
      const immutable = pathname.startsWith(assetPathPrefix);
      const response = await env.fetch(pathname, immutable ? undefined : { cache: 'no-cache' });
      if (isCacheableAsset(pathname, response)) await cache.put(pathname, response);
    } catch {
      // A cold install on a flaky connection must still finish; the runtime handler below fills in
      // whatever is missing on the next request.
    }
  };

  /**
   * Copy every still-valid entry out of the builds this one replaces. Hashed names are content
   * addresses, so a URL this build also ships is byte-for-byte the same file — copying it makes a
   * per-build cache cost one HTTP request per *changed* chunk instead of a fresh download of the
   * whole first-paint set. The shell is excluded: it is the one file whose URL does not change.
   */
  const adoptPreviousCaches = async (cache: Cache): Promise<void> => {
    const names = (await env.caches.keys()).filter(
      (name) => name.startsWith(cachePrefix) && name !== cacheName
    );
    for (const name of names) {
      const previous = await env.caches.open(name);
      const requests = await previous.keys();
      await Promise.all(
        requests.map(async (request) => {
          const { pathname } = new URL(request.url);
          if (pathname === shellKey) return;
          if (!allowedPaths.has(pathname)) return;
          if ((await cache.match(pathname)) !== undefined) return;
          const response = await previous.match(request);
          if (response === undefined) return;
          try {
            await cache.put(pathname, response);
          } catch {
            // Copying forward is an optimisation. If storage refuses — a full quota is the only
            // realistic reason — the URL is simply fetched when it is needed, and the build still
            // installs.
          }
        })
      );
    }
  };

  const install = async (): Promise<void> => {
    const cache = await env.caches.open(cacheName);
    await adoptPreviousCaches(cache);

    const shell = await env.fetch(shellKey, { cache: 'no-cache' });
    if (!isHtmlDocument(shell)) {
      throw new Error('sw: the shell request did not answer with a document');
    }
    const html = await shell.clone().text();
    if (!htmlBelongsToBuild(html, allowedPaths, options.baseUrl)) {
      // A deploy landed between this worker's script and its shell fetch. Failing the install
      // leaves the visitor on the build they already have, whole, and the browser retries on the
      // next update check.
      throw new Error('sw: the shell document belongs to a different build');
    }
    try {
      await cache.put(shellKey, shell);
    } catch {
      // Whether the shell can be *stored* is a storage question, not a correctness one: without it
      // this worker serves navigations from the network, which is what a network-first design does
      // for every visitor. Failing the install instead would strand someone with a full quota on a
      // build they can never leave.
    }
    await Promise.all(
      [...firstPaintAssets(html, allowedPaths, options.baseUrl), ...stableShellAssets].map((path) =>
        warm(cache, path)
      )
    );
  };

  /**
   * Every other build's cache goes. Only this prefix: another app's cache on the same origin is
   * none of this worker's business.
   */
  const activate = async (): Promise<void> => {
    const names = await env.caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
        .map((name) => env.caches.delete(name))
    );
  };

  /** The cached shell, if it is still this build's. */
  const readShell = async (cache: Cache): Promise<Response | undefined> => {
    const cached = await cache.match(shellKey);
    if (cached === undefined) return undefined;
    const html = await cached.clone().text();
    if (htmlBelongsToBuild(html, allowedPaths, options.baseUrl)) return cached;
    // Only reachable if a cache outlived the naming scheme that produced it. Dropping it costs one
    // network round-trip; serving it costs a white screen that no reload clears.
    await cache.delete(shellKey);
    return undefined;
  };

  const handleShellNavigation = async (request: Request): Promise<Response> => {
    const cache = await bestEffort(() => env.caches.open(cacheName));
    const shell = cache === undefined ? undefined : await bestEffort(() => readShell(cache));
    if (shell !== undefined) return shell;

    // No shell yet: the worker is controlling before its install finished, or its install failed.
    // Serve the network and adopt what comes back only if it is this build's.
    const response = await env.fetch(request);
    // A redirect followed *inside* the worker keeps the requested URL in the address bar while
    // showing the target's content. Hand it back and let the browser perform it, which is what
    // happens without a worker in the way.
    if (response.redirected) return Response.redirect(response.url, 302);
    if (cache !== undefined && isHtmlDocument(response)) {
      const html = await response.clone().text();
      if (htmlBelongsToBuild(html, allowedPaths, options.baseUrl)) {
        // Storing the shell is what makes the *next* load offline-capable. Failing this navigation
        // over it would turn a full quota into a blank page.
        await bestEffort(() => cache.put(shellKey, response.clone()));
      }
    }
    return response;
  };

  /**
   * The SPA fallback answering a chunk URL with a document. Returning it would put HTML through a
   * JavaScript parser inside the page — the crash this whole design exists to stop. A 503 fails
   * the load instead, which is what `vite:preloadError` and the update prompt are built on.
   */
  const staleAssetResponse = (pathname: string): Response => {
    env.notifyClients({ type: STALE_BUILD_MESSAGE, path: pathname });
    return new Response('', {
      status: 503,
      statusText: 'Stale build asset',
      headers: { 'cache-control': 'no-store' },
    });
  };

  /**
   * Cache-first, and only ever for a URL this build shipped. Hashed URLs are immutable, so a hit
   * is always correct and a miss is validated before it is stored.
   */
  const handleAsset = async (request: Request, pathname: string): Promise<Response> => {
    const cache = await bestEffort(() => env.caches.open(cacheName));
    const cached = cache === undefined ? undefined : await bestEffort(() => cache.match(pathname));
    if (cached !== undefined) return cached;

    const response = await env.fetch(request);
    if (isCacheableAsset(pathname, response)) {
      if (cache !== undefined) await bestEffort(() => cache.put(pathname, response.clone()));
      return response;
    }
    // In the manifest, but the edge no longer has it: this build is being replaced right now.
    if (isVersionedAssetPath(pathname) && isHtmlDocument(response)) {
      return staleAssetResponse(pathname);
    }
    return response;
  };

  /**
   * A hashed chunk this build never shipped — what a page still running a previous build asks for.
   * It is never cached and never served from cache; the only job here is to make sure the page
   * finds out it is stale instead of being handed a document.
   */
  const handleForeignAsset = async (request: Request, pathname: string): Promise<Response> => {
    const response = await env.fetch(request);
    if (isHtmlDocument(response)) return staleAssetResponse(pathname);
    if (!response.ok) env.notifyClients({ type: STALE_BUILD_MESSAGE, path: pathname });
    return response;
  };

  const handleFetch = (request: Request): Promise<Response> | undefined => {
    // Anything not a plain same-origin GET is none of this worker's business.
    if (request.method !== 'GET') return undefined;
    const url = new URL(request.url);
    if (url.origin !== origin) return undefined;

    if (request.mode === 'navigate') {
      if (!servesShell(url.pathname)) return undefined;
      return handleShellNavigation(request);
    }

    // Range requests are how media streams; a cache cannot satisfy a partial response, so they go
    // straight to the network.
    if (request.headers.has('range')) return undefined;

    if (allowedPaths.has(url.pathname)) return handleAsset(request, url.pathname);
    if (isVersionedAssetPath(url.pathname)) return handleForeignAsset(request, url.pathname);
    // The API, the version stamp, anything dynamic: fetched normally, never stored.
    return undefined;
  };

  const handleMessage = (data: unknown): SwMessageAction | undefined => {
    const type =
      typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined;
    if (type === SKIP_WAITING_MESSAGE) return { kind: 'skip-waiting' };
    if (type === BUILD_ID_MESSAGE) return { kind: 'build-id', buildId };
    return undefined;
  };

  return { cacheName, buildId, allowedPaths, install, activate, handleFetch, handleMessage };
}
