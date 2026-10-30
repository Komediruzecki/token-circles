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
 *   says nothing.
 * - Origin, which a browser sets on every request that changes data. When there is one, it has to
 *   be one of the app's origins (appOrigins). Scripts, tests and other servers send none.
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

interface Route {
  /** Any method when absent. */
  method?: string;
  path: string;
  /** `path` is a prefix: every path under it. */
  prefix?: true;
}

/** Routes called from elsewhere by design. Each checks its own requests, without the session. */
const CALLED_FROM_ELSEWHERE: readonly Route[] = [
  // Stripe's servers post billing events here. The Stripe-Signature header, checked against the
  // raw body, says the event is Stripe's (routes/billing.ts).
  { method: 'POST', path: '/api/billing/webhook' },
  // The token API. Scripts and other apps call it with an API token, or upload through a signed
  // link the MCP server hands out (routes/v1.ts). Neither is the app's session.
  { path: '/api/v1/', prefix: true },
  // The MCP server. Its clients send an API token in the Authorization header (mcp/index.ts).
  { path: '/mcp' },
  // One-click unsubscribe. Mail providers post `List-Unsubscribe=One-Click` from their own servers
  // (RFC 8058), and the page at GET /api/notifications/unsubscribe posts its form from this host.
  // The token in the link says whose reminder mails stop (routes/notifications.ts).
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

/** The local app (`pnpm dev`, the E2E suite), under both names its dev server answers to. */
const LOCAL_APP = ['http://localhost:3800', 'http://127.0.0.1:3800'];

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

/**
 * The app's origins: CORS_ORIGIN and every origin in APP_ORIGINS. With APP_ENV=development the
 * local app at port 3800 is one too. A local app on another port is named in worker/.dev.vars
 * (CORS_ORIGIN or APP_ORIGINS), as passkeys already need.
 */
export function appOrigins(env: Env): Set<string> {
  const named = [env.CORS_ORIGIN ?? '', ...(env.APP_ORIGINS ?? '').split(',')];
  if (env.APP_ENV === 'development') named.push(...LOCAL_APP);
  const origins = new Set<string>();
  for (const entry of named) {
    const origin = originOf(entry.trim());
    if (origin !== null) origins.add(origin);
  }
  return origins;
}

/** The media type a Content-Type names, lower case, or null when there is none. */
function mediaType(header: string | null): string | null {
  const type = (header ?? '').split(';')[0]!.trim().toLowerCase();
  return type === '' ? null : type;
}

/** Whether the request carries a body. */
function carriesBody(request: Request): boolean {
  const length = request.headers.get('Content-Length');
  if (length !== null) return length.trim() !== '0';
  return request.body !== null;
}

/** Which check a request that changes data does not pass, or null when it is the app's. */
export type NotTheApp = 'site' | 'origin' | 'body';

/** Which check `request` does not pass, or null when it is the app's. `upload`: an UPLOADS route. */
export function notTheApp(request: Request, env: Env, upload: boolean): NotTheApp | null {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site.trim().toLowerCase() === 'cross-site') return 'site';
  const origin = request.headers.get('Origin');
  if (origin !== null && !appOrigins(env).has(origin.trim())) return 'origin';
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
  // origin not yet in APP_ORIGINS, say) is a quick look at the log rather than a hunt.
  console.warn(
    JSON.stringify({
      event: 'request_not_taken',
      check,
      method,
      path,
      origin: c.req.header('Origin') ?? null,
      fetchSite: c.req.header('Sec-Fetch-Site') ?? null,
      contentType: mediaType(c.req.header('Content-Type') ?? null),
    })
  );
  return c.json({ error: APP_REQUESTS_ONLY }, 403);
};
