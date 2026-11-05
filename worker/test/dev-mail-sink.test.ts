/**
 * The development mail sink (email.ts devMailSink): a local Worker with no Resend key can hand its
 * mails to a mailbox on this machine (frontend/scripts/mailbox.mjs), so a test or a person reads
 * the mail a user would get. It is taken only when all three hold: no RESEND_API_KEY, APP_ENV
 * exactly 'development', and DEV_MAIL_SINK an http URL on a loopback host with no credentials.
 * Every other case behaves as before: Resend when there is a key, the DEV log line and a skip when
 * there is none.
 *
 * The mailbox gets the very body Resend would, and its answer reads as Resend's, so each caller
 * goes on as in production: a week-one mail the mailbox took keeps its claim and is not sent again.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { devMailSink, sendMail } from '../src/email';
import type { Env } from '../src/index';
import { runWeekOneMails } from '../src/weekOne';

const SINK = 'http://127.0.0.1:8797/emails';
const RESEND = 'https://api.resend.com/emails';

const realFetch = globalThis.fetch;
interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  redirect: RequestRedirect | undefined;
}
let calls: Call[] = [];
/** What the next fetch answers. */
let answer: () => Response | Promise<Response> = () => Response.json({ id: 'mb_1' });

beforeEach(() => {
  calls = [];
  answer = () => Response.json({ id: 'mb_1' });
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Every request this file's code makes is recorded and answered here: none leaves the test.
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
      redirect: init?.redirect,
    });
    const res = await answer();
    // As fetch does: a redirect is followed unless the caller says 'manual'. A 307 or 308 sends
    // the same request on to Location; 301, 302 and 303 send a GET with no body.
    const location = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && location && init?.redirect !== 'manual') {
      const to = new URL(location, url).href;
      return [307, 308].includes(res.status)
        ? fake(to, init)
        : fake(to, { ...init, method: 'GET', body: undefined });
    }
    return res;
  };
  globalThis.fetch = fake as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The test Worker's env with these vars, and no Resend key unless one is given. */
function envWith(vars: Partial<Env>): Env {
  return {
    ...(env as unknown as Env),
    RESEND_API_KEY: undefined,
    APP_ENV: 'development',
    DEV_MAIL_SINK: SINK,
    ...vars,
  };
}

/** A mail with every field the Resend body can carry. */
const send = (e: Env) =>
  sendMail(e, 'sink-test@example.test', 'A subject', '<p>Hello</p>', {
    text: 'Hello',
    replyTo: 'reply@example.test',
    listUnsubscribe: 'http://localhost:8787/api/notifications/unsubscribe?token=t&list=week-one',
  });

describe('a development Worker with a loopback DEV_MAIL_SINK', () => {
  it('posts the mailbox the body Resend would get, and reads its answer as Resend is read', async () => {
    const result = await send(envWith({}));
    expect(result).toEqual({ sent: true, id: 'mb_1' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(SINK);
    expect(call.method).toBe('POST');
    expect(call.headers.get('Content-Type')).toBe('application/json');
    // The key stays with Resend: the mailbox is sent no Authorization at all.
    expect(call.headers.get('Authorization')).toBeNull();

    // The same mail with a key goes to Resend, with the very same body.
    calls = [];
    await send(envWith({ RESEND_API_KEY: 're_test' }));
    expect(calls.map((c) => c.url)).toEqual([RESEND]);
    expect(calls[0].body).toBe(call.body);
    expect(JSON.parse(call.body)).toEqual({
      from: 'Token Circles <hello@tokencircles.com>',
      to: 'sink-test@example.test',
      subject: 'A subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      reply_to: 'reply@example.test',
      headers: {
        'List-Unsubscribe':
          '<http://localhost:8787/api/notifications/unsubscribe?token=t&list=week-one>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  });

  it.each(['http://127.0.0.1:8797/emails', 'http://localhost:8797/emails', 'http://[::1]:8797/'])(
    'takes %s',
    async (url) => {
      expect(await send(envWith({ DEV_MAIL_SINK: url }))).toMatchObject({ sent: true });
      expect(calls.map((c) => c.url)).toEqual([new URL(url).href]);
    }
  );

  it('answers a refusal with its status, as a Resend refusal is', async () => {
    answer = () => new Response('no', { status: 422 });
    expect(await send(envWith({}))).toEqual({
      sent: false,
      error: 'DEV mailbox 422',
      status: 422,
    });
  });

  it.each([301, 302, 303, 307, 308])(
    'refuses a %s and sends the mail nowhere else',
    async (status) => {
      // The first answer points elsewhere; anything after it would take the mail.
      let first = true;
      answer = () => {
        if (!first) return Response.json({ id: 'taken-elsewhere' });
        first = false;
        return new Response(null, {
          status,
          headers: { Location: 'http://127.0.0.2:3840/emails' },
        });
      };
      expect(await send(envWith({}))).toEqual({
        sent: false,
        error: `DEV mailbox ${String(status)}`,
        status,
      });
      expect(calls.map((c) => c.url)).toEqual([SINK]);
      expect(calls[0].redirect).toBe('manual');
    }
  );

  it('throws when the mailbox is down, as a network failure to Resend does', async () => {
    answer = () => {
      throw new TypeError('fetch failed');
    };
    await expect(send(envWith({}))).rejects.toThrow('fetch failed');
  });
});

describe('the sink is not used', () => {
  it('when there is a Resend key: the mail goes to Resend only', async () => {
    expect(await send(envWith({ RESEND_API_KEY: 're_test' }))).toMatchObject({ sent: true });
    expect(calls.map((c) => c.url)).toEqual([RESEND]);
    expect(devMailSink(envWith({ RESEND_API_KEY: 're_test' }))).toBeNull();
  });

  it.each([['dev'], ['production'], ['Development'], [undefined]])(
    'with APP_ENV %s',
    async (appEnv) => {
      expect(await send(envWith({ APP_ENV: appEnv }))).toEqual({ sent: false, skipped: true });
      expect(calls).toEqual([]);
      expect(devMailSink(envWith({ APP_ENV: appEnv }))).toEqual({
        refused: 'APP_ENV is not development',
      });
    }
  );

  it.each([
    // Not this machine.
    'http://example.com/emails',
    'http://10.0.0.1/emails',
    'http://127.0.0.1.evil.test/emails',
    'http://localhost.evil.test/emails',
    // The host here is evil.test: what comes before the @ is a user name.
    'http://127.0.0.1@evil.test/emails',
    'http://[::ffff:127.0.0.1]/emails',
    'https://evil.test/emails',
    // This machine, but not a plain http URL.
    'https://127.0.0.1:8797/emails',
    'http://user:secret@127.0.0.1:8797/emails',
    'ftp://127.0.0.1/emails',
    'file:///tmp/emails',
    // Not a URL at all.
    'not a url',
    '//127.0.0.1:8797/emails',
    'javascript:alert(1)',
  ])('for DEV_MAIL_SINK %s', async (url) => {
    expect(await send(envWith({ DEV_MAIL_SINK: url }))).toEqual({ sent: false, skipped: true });
    expect(calls).toEqual([]);
    expect(devMailSink(envWith({ DEV_MAIL_SINK: url }))).toHaveProperty('refused');
  });

  it('when none is set', async () => {
    expect(await send(envWith({ DEV_MAIL_SINK: undefined }))).toEqual({
      sent: false,
      skipped: true,
    });
    expect(calls).toEqual([]);
    expect(devMailSink(envWith({ DEV_MAIL_SINK: undefined }))).toBeNull();
  });
});

describe('a caller behind the sink', () => {
  const ID = 97610;
  const EMAIL = 'sink-week-one-97610@example.test';

  async function remove(): Promise<void> {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reminder_dedup WHERE user_id = ?').bind(ID),
      env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(ID),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(ID),
    ]);
  }

  beforeEach(async () => {
    await remove();
    // Confirmed two days and an hour ago, nothing imported: the day-2 mail is due.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, auth_provider, email_verified, token_version, plan)
         VALUES (?, ?, 'password', 1, 1, 'free')`
      ).bind(ID, EMAIL),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Sink')").bind(ID, ID),
      env.DB.prepare(
        "INSERT INTO reminder_dedup (user_id, dedup_key, sent_at) VALUES (?, 'welcome', datetime('now', '-2 days', '-1 hour'))"
      ).bind(ID),
    ]);
  });

  afterEach(remove);

  const mailsTo = () =>
    calls.filter((c) => (JSON.parse(c.body) as { to: string }).to === EMAIL).map((c) => c.url);

  it('keeps a week-one claim the mailbox took, as one Resend took: the next run sends nothing', async () => {
    const e = envWith({});
    await runWeekOneMails('30 8 * * *', e);
    await runWeekOneMails('30 8 * * *', e);
    expect(mailsTo()).toEqual([SINK]);
    const claimed = await env.DB.prepare(
      "SELECT 1 FROM reminder_dedup WHERE user_id = ? AND dedup_key = 'week-one:day2'"
    )
      .bind(ID)
      .first();
    expect(claimed).not.toBeNull();
  });
});
