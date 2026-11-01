/**
 * Requests that change data (POST, PUT, PATCH and DELETE) are taken from the app's own pages, with
 * a JSON body. The rule runs before any route (index.ts), so a request it does not take reaches no
 * route and changes nothing.
 *
 * A request is the app's when what the browser says about it agrees:
 *
 * - Sec-Fetch-Site, which a browser sets to say where the page that sent the request is. The app
 *   is on the same site as this API (tokencircles.com and api.tokencircles.com; one origin behind
 *   the dev server's proxy), so a request is taken when it says same-origin, same-site or none, or
 *   says nothing (APP_SITES). Any other value is not taken.
 * - Origin, which a browser sets on every request that changes data. When there is one, it has to
 *   be one of the app's origins (isAppOrigin). Scripts, tests and other servers send none.
 * - Content-Type. Every route here reads a JSON body or none, apart from the uploads in UPLOADS,
 *   which read multipart/form-data. A body has to say it is application/json, or
 *   multipart/form-data on an upload. A body that says neither is not taken, and neither is one
 *   that says nothing.
 *
 * A few routes are called from elsewhere by design and check each request themselves, without the
 * session: CALLED_FROM_ELSEWHERE lists them, each with why. Mail-in (statements forwarded to the
 * import address) reaches the Worker's `email` handler (index.ts), not `fetch`, so it needs no
 * entry here.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './index';

/** What a request that is not the app's is answered, with 403. */
export const APP_REQUESTS_ONLY =
  'Changes are taken from the Token Circles app only. Open the app and try again.';

/** The methods that change data. */
const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * What Sec-Fetch-Site says on a request from the app's pages. A request that says nothing is taken
 * too: scripts and tests send no Sec-Fetch-Site, and neither do browsers that predate it.
 */
const APP_SITES = new Set(['same-origin', 'same-site', 'none']);

interface Route {
  /** Any method when absent. */
  method?: string;
  path: string;
  /** `path` is a prefix: every path under it. */
  prefix?: true;
}

/** Routes called from elsewhere by design. Each checks its own requests, without the session. */
const CALLED_FROM_ELSEWHERE: readonly Route[] = [
  // Stripe's servers post billing events here, as JSON with no Origin. The Stripe-Signature
  // header, checked against the raw body, says the event is Stripe's (routes/billing.ts).
  { method: 'POST', path: '/api/billing/webhook' },
  // The token API. Scripts and other apps call it with an API token, or upload a statement through
  // a signed link the MCP server hands out (routes/v1.ts). Neither is the app's session.
  { path: '/api/v1/', prefix: true },
  // The MCP server. Its clients post JSON with an API token in the Authorization header
  // (mcp/index.ts).
  { path: '/mcp' },
  // One-click unsubscribe. Mail providers post `List-Unsubscribe=One-Click` from their own servers
  // (RFC 8058). The Unsubscribe button on the page at GET /api/notifications/unsubscribe posts an
  // empty form from this host, which a browser sends with `Origin: null`: the page's
  // Referrer-Policy is no-referrer (index.ts). The token in the link says whose reminder mails stop
  // (routes/notifications.ts).
  { method: 'POST', path: '/api/notifications/unsubscribe' },
];

/**
 * The uploads, which read multipart/form-data: a statement in the import wizard
 * (routes/imports.ts) and a receipt (routes/receipts.ts). Sec-Fetch-Site and Origin apply to them
 * as to every other route.
 */
const UPLOADS: readonly Route[] = [
  { method: 'POST', path: '/api/import/upload' },
  { method: 'POST', path: '/api/receipts/upload' },
  { method: 'POST', path: '/api/receipts' },
];

/**
 * The hosts a local app is served from, on any port: `pnpm dev` at :3800, the E2E suite at
 * E2E_PORT, the screenshot runs at :3900 and the tour walk at BASE_URL. Taken with
 * APP_ENV=development only (isAppOrigin).
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const matches = (route: Route, method: string, path: string): boolean =>
  (route.method === undefined || route.method === method) &&
  (route.prefix ? path.startsWith(route.path) : path === route.path);

/** `value` as an origin (scheme, host and port), or null when it is not a URL with one. */
function originOf(value: string): string | null {
  if (value === '') return null;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** The origins the app is deployed at: CORS_ORIGIN and every origin in APP_ORIGINS. */
export function appOrigins(env: Env): Set<string> {
  const origins = new Set<string>();
  for (const entry of [env.CORS_ORIGIN ?? '', ...(env.APP_ORIGINS ?? '').split(',')]) {
    const origin = originOf(entry.trim());
    if (origin !== null) origins.add(origin);
  }
  return origins;
}

/** Whether `origin` is http on a loopback host (LOOPBACK), on any port, as a browser writes it. */
function isLoopback(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOOPBACK.has(url.hostname) && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Whether `origin` is one of the app's: one it is deployed at (appOrigins), or, with
 * APP_ENV=development, a local app on any loopback port.
 */
export function isAppOrigin(origin: string, env: Env): boolean {
  return appOrigins(env).has(origin) || (env.APP_ENV === 'development' && isLoopback(origin));
}

/**
 * Whether `hostname` is a host the app is served from: the host of one of the origins it is
 * deployed at (appOrigins), or, with APP_ENV=development, a loopback host (LOOPBACK). Cloudflare's
 * siteverify answer names the host a captcha was solved on in this form, with no scheme or port
 * (turnstile.ts). The name is taken as it comes, with only ASCII letters lower-cased: a URL's host
 * is ASCII (punycode), so nothing else is folded to match one.
 */
export function isAppHostname(hostname: string, env: Env): boolean {
  const host = hostname.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (host === '') return false;
  if (env.APP_ENV === 'development' && LOOPBACK.has(host)) return true;
  for (const origin of appOrigins(env)) {
    if (new URL(origin).hostname === host) return true;
  }
  return false;
}

/** The media type a Content-Type names, lower case, or null when there is none. */
function mediaType(header: string | null): string | null {
  const type = (header ?? '').split(';')[0]!.trim().toLowerCase();
  return type === '' ? null : type;
}

/** Whether the request carries a body. */
function carriesBody(request: Request): boolean {
  const length = request.headers.get('Content-Length');
  // The app's POSTs that send nothing (a new confirm link, Sign out everywhere and others) arrive
  // with Content-Length: 0, and workerd hands them an empty body stream, not a null body. So the
  // length decides when there is one, and the stream only when there is none.
  if (length !== null) return length.trim() !== '0';
  return request.body !== null;
}

/** Which check a request that changes data does not pass, or null when it is the app's. */
export type NotTheApp = 'site' | 'origin' | 'body';

/** Which check `request` does not pass, or null when it is the app's. `upload`: an UPLOADS route. */
export function notTheApp(request: Request, env: Env, upload: boolean): NotTheApp | null {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && !APP_SITES.has(site.trim().toLowerCase())) return 'site';
  const origin = request.headers.get('Origin');
  if (origin !== null && !isAppOrigin(origin.trim(), env)) return 'origin';
  const type = mediaType(request.headers.get('Content-Type'));
  if (type === null) return carriesBody(request) ? 'body' : null;
  if (type === 'application/json') return null;
  if (type === 'multipart/form-data' && upload) return null;
  return 'body';
}

/**
 * Takes a request that changes data when it is the app's (notTheApp), or when its route is called
 * from elsewhere by design (CALLED_FROM_ELSEWHERE); answers anything else 403 before any route
 * runs. Reads and CORS preflights go on untouched.
 */
export const requireAppRequest: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  if (!CHANGES.has(method) || CALLED_FROM_ELSEWHERE.some((r) => matches(r, method, path))) {
    await next();
    return;
  }
  const upload = UPLOADS.some((r) => matches(r, method, path));
  const check = notTheApp(c.req.raw, c.env, upload);
  if (check === null) {
    await next();
    return;
  }
  // Which check, and what the request said, so a refused request from the app itself (a new
  // origin not yet in APP_ORIGINS, say) is a quick look at the log rather than a hunt. Level and
  // request id (cf-ray) as errorlog.ts writes them.
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'request_not_taken',
      check,
      method,
      path,
      origin: c.req.header('Origin') ?? null,
      fetchSite: c.req.header('Sec-Fetch-Site') ?? null,
      contentType: mediaType(c.req.header('Content-Type') ?? null),
      requestId: c.req.header('cf-ray') ?? null,
    })
  );
  return c.json({ error: APP_REQUESTS_ONLY }, 403);
};
