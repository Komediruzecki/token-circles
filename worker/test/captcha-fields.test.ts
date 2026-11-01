/**
 * A Cloudflare Turnstile check counts when it was solved on the app's own pages, for the form
 * being sent (worker/src/turnstile.ts).
 *
 * Cloudflare's siteverify answer names the host the widget was on (`hostname`) and the form it was
 * drawn for (`action`, shared/captchaActions.ts). Every route behind the captcha counts a passed
 * check only when that host is one of the app's (CORS_ORIGIN and APP_ORIGINS, and the local app in
 * development) and the action is one the route takes. An answer that names no action still counts from
 * the app's host, since builds from before the action was named send none; the Worker notes each
 * one so a later change can require it.
 *
 * siteverify is stubbed with an answer each test sets.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { LOGIN_CHECK_COOKIE } from '../src/login-check';
import { CAPTCHA_ACTIONS, type CaptchaAction } from '../../shared/captchaActions';

const APP_HOST = 'tokencircles.com';
const base = env as unknown as Env;
/** A deployed environment with the captcha on, as production has it. */
const DEPLOYED: Env = {
  ...base,
  APP_ENV: 'production',
  TURNSTILE_SECRET: 'test-turnstile-key',
  CORS_ORIGIN: `https://${APP_HOST}`,
  APP_ORIGINS: `https://${APP_HOST}`,
  SUPPORT_EMAIL: 'support@example.com',
};
const REFUSED = { error: 'Captcha verification failed. Please try again.' };

/** What siteverify answers next: a passed check, with these fields when they are set. */
let answer: Record<string, unknown>;
/** The HTTP status siteverify answers with. */
let status = 200;
/** How many times siteverify was asked. */
let asked = 0;
/** A fresh network address per request, so no limit is what refuses it. */
let ipCounter = 0;

beforeEach(async () => {
  asked = 0;
  answer = {};
  status = 200;
  await env.DB.prepare('DELETE FROM rate_limits').run();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('challenges.cloudflare.com')) {
      asked += 1;
      return Response.json(
        {
          success: true,
          'error-codes': [],
          challenge_ts: new Date().toISOString(),
          ...answer,
        },
        { status }
      );
    }
    if (url.includes('api.resend.com')) return Response.json({ id: 're_1' });
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Route {
  path: string;
  /** The actions the route takes. */
  accepted: CaptchaAction[];
  /** A body the route refuses on its own checks once the captcha counts, so nothing is sent. */
  body: Record<string, unknown>;
  /** The status the route answers that body with once the captcha counts. */
  past: number;
}

const { signIn, confirmLink, emailCode, support } = CAPTCHA_ACTIONS;

const routes: Route[] = [
  {
    path: '/api/auth/register',
    accepted: [signIn],
    body: { email: 'not-an-address', password: 'x' },
    past: 400,
  },
  {
    path: '/api/auth/login',
    accepted: [signIn],
    body: { email: 'nobody-captcha-fields@example.com', password: 'wrong-guess-123' },
    past: 401,
  },
  {
    path: '/api/auth/forgot-password',
    accepted: [signIn],
    body: { email: 'not-an-address' },
    past: 400,
  },
  {
    path: '/api/auth/verify-email/resend',
    accepted: [confirmLink, signIn],
    body: { email: 'not-an-address' },
    past: 400,
  },
  {
    path: '/api/auth/email-code/request',
    accepted: [emailCode],
    body: { email: 'not-an-address' },
    past: 400,
  },
  {
    path: '/api/support/contact',
    accepted: [support],
    body: { email: 'not-an-address', message: 'hello there' },
    past: 400,
  },
];

/** POST `body` with a token to `path`, the way the app sends it. */
async function send(path: string, body: Record<string, unknown>, e: Env = DEPLOYED) {
  ipCounter += 1;
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://api.${APP_HOST}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': `198.51.100.${ipCounter % 250}`,
      },
      body: JSON.stringify({ turnstileToken: 'a-token', ...body }),
    }),
    e,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** The notes the Worker wrote for a check that named no form. */
function notesOfNoAction(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (line): line is Record<string, unknown> =>
        line !== null && line.event === 'captcha_without_action'
    );
}

/** Every action a route takes, with its route: one case each. */
const takes = routes.flatMap((route) => route.accepted.map((action) => ({ ...route, action })));
/** Every action a route does not take, with its route: one case each. */
const takesNot = routes.flatMap((route) =>
  Object.values(CAPTCHA_ACTIONS)
    .filter((action) => !route.accepted.includes(action))
    .map((action) => ({ ...route, action }))
);

describe.each(takes)('a captcha on $path, made for $action', (route) => {
  it("counts a check solved on the app's page for a form the route takes", async () => {
    answer = { hostname: APP_HOST, action: route.action };
    const res = await send(route.path, route.body);
    expect(asked).toBe(1);
    expect(res.status).toBe(route.past);
  });
});

describe.each(takesNot)('a captcha on $path, made for $action', (route) => {
  it('counts only a check made for a form the route takes', async () => {
    answer = { hostname: APP_HOST, action: route.action };
    const res = await send(route.path, route.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });
});

describe.each(routes)('a captcha on $path', (route) => {
  const action = route.accepted[0]!;

  it("counts only a check solved on one of the app's own hosts", async () => {
    answer = { hostname: `other.${APP_HOST}`, action };
    const res = await send(route.path, route.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });

  it('counts only an answer that names its host', async () => {
    answer = { action };
    const res = await send(route.path, route.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });

  it("counts a check that names no form, from the app's host, and notes it once", async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    answer = { hostname: APP_HOST, action: '' };
    const res = await send(route.path, route.body);
    expect(res.status).toBe(route.past);
    const notes = notesOfNoAction(info);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ accepted: route.accepted, path: route.path });
  });

  it("counts an answer with no action field at all, from the app's host", async () => {
    answer = { hostname: APP_HOST };
    const res = await send(route.path, route.body);
    expect(res.status).toBe(route.past);
  });
});

describe("the app's hosts", () => {
  it('include every origin in APP_ORIGINS', async () => {
    answer = { hostname: 'app.example.net', action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body, {
      ...DEPLOYED,
      APP_ORIGINS: `https://${APP_HOST}, https://app.example.net`,
    });
    expect(res.status).toBe(400);
  });

  it('are matched by the whole host name', async () => {
    answer = { hostname: `${APP_HOST}.example.net`, action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(403);
  });

  it('include the local app in development', async () => {
    answer = { hostname: 'localhost', action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body, {
      ...DEPLOYED,
      APP_ENV: 'development',
    });
    expect(res.status).toBe(400);
  });

  it('count a host name as it comes, with no space trimmed', async () => {
    answer = { hostname: ` ${APP_HOST} `, action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });

  it('count a host name with its ASCII letters in any case', async () => {
    answer = { hostname: APP_HOST.toUpperCase(), action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(400);
  });

  it('count only ASCII letters as the same letter in another case', async () => {
    // U+212A KELVIN SIGN, which toLowerCase() turns into an ASCII k.
    answer = { hostname: APP_HOST.replace('k', '\u212A'), action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });

  it('include the local app in development only', async () => {
    answer = { hostname: 'localhost', action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(403);
  });
});

describe('the action field', () => {
  it.each([7, null, { name: CAPTCHA_ACTIONS.signIn }, [CAPTCHA_ACTIONS.signIn]])(
    'counts only a string that names a form the route takes, not %j',
    async (action) => {
      answer = { hostname: APP_HOST, action };
      const res = await send('/api/auth/register', routes[0]!.body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(REFUSED);
    }
  );
});

describe("siteverify's answer", () => {
  it('counts only when siteverify answers with a 2xx status', async () => {
    status = 500;
    answer = { hostname: APP_HOST, action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(asked).toBe(1);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
  });

  it('still names a TURNSTILE_SECRET Cloudflare answers with a 400', async () => {
    // How siteverify answers a key it does not know (measured 2026-11-01).
    status = 400;
    answer = { success: false, 'error-codes': ['invalid-input-secret'] };
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'captcha_not_configured' });
  });
});

describe('local development', () => {
  it('leaves the gate off with TURNSTILE_SECRET unset, as before', async () => {
    const res = await send('/api/auth/register', routes[0]!.body, {
      ...DEPLOYED,
      APP_ENV: 'development',
      TURNSTILE_SECRET: undefined,
    });
    expect(asked).toBe(0);
    expect(res.status).toBe(400);
  });

  // Cloudflare's public test key pair answers for example.com and names no action
  // (measured 2026-11-01), whatever page the widget was on.
  const TEST_PAIR_ANSWER = { hostname: 'example.com', metadata: { result_with_testing_key: true } };

  it("counts Cloudflare's test pair in development", async () => {
    answer = TEST_PAIR_ANSWER;
    const res = await send('/api/auth/register', routes[0]!.body, {
      ...DEPLOYED,
      APP_ENV: 'development',
    });
    expect(res.status).toBe(400);
  });

  it("counts Cloudflare's test pair in development only", async () => {
    answer = TEST_PAIR_ANSWER;
    const res = await send('/api/auth/register', routes[0]!.body);
    expect(res.status).toBe(403);
  });
});

describe('the login check', () => {
  /** The login check cookie the answer leaves, or null. */
  const leftCheck = (res: Response) =>
    res.headers
      .getSetCookie()
      .find((line) => line.startsWith(`${LOGIN_CHECK_COOKIE}=`) && !/Max-Age=0/.test(line)) ?? null;

  it("starts from a check solved on the app's sign-in form", async () => {
    answer = { hostname: APP_HOST, action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/login', routes[1]!.body);
    expect(res.status).toBe(401);
    expect(leftCheck(res)).not.toBeNull();
  });

  it("starts from a check that names no form, from the app's host", async () => {
    answer = { hostname: APP_HOST, action: '' };
    const res = await send('/api/auth/login', routes[1]!.body);
    expect(res.status).toBe(401);
    expect(leftCheck(res)).not.toBeNull();
  });

  it("starts only from a check solved on one of the app's own hosts", async () => {
    answer = { hostname: `other.${APP_HOST}`, action: CAPTCHA_ACTIONS.signIn };
    const res = await send('/api/auth/login', routes[1]!.body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(REFUSED);
    expect(leftCheck(res)).toBeNull();
  });

  it.each([CAPTCHA_ACTIONS.support, CAPTCHA_ACTIONS.emailCode, CAPTCHA_ACTIONS.confirmLink])(
    'starts only from a check made for the sign-in forms, not %s',
    async (action) => {
      answer = { hostname: APP_HOST, action };
      const res = await send('/api/auth/login', routes[1]!.body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(REFUSED);
      expect(leftCheck(res)).toBeNull();
    }
  );
});
