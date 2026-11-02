/**
 * worker/scripts/send-sample-mails.ts, the command that mails a sample of every mail to one inbox:
 * what it accepts, and what it does with the key. The command runs here with a stub fetch and its
 * output kept (main's Io), so nothing here can send a mail. The keys are fake.
 */
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from '../scripts/send-sample-mails';

const refused = (reason: string) => ({ error: expect.stringContaining(reason) });

describe('send-sample-mails', () => {
  it('refuses to run without --to, a dry run too', () => {
    expect(parseArgs([])).toEqual(refused('--to is required'));
    expect(parseArgs(['--dry-run', 'samples'])).toEqual(refused('--to is required'));
  });

  it('refuses a --to that is not an address, an option it does not know, and a flag without its value', () => {
    expect(parseArgs(['--to', 'nobody'])).toEqual(refused('is not an address'));
    expect(parseArgs(['--to', 'a@example.com', '--send-all'])).toEqual(
      refused('Unknown option --send-all')
    );
    expect(parseArgs(['--to'])).toEqual(refused('--to needs a value'));
    expect(parseArgs(['--to', 'a@example.com', '--dry-run', '--only', 'welcome'])).toEqual(
      refused('--dry-run needs a value')
    );
  });

  it('takes an origin, not a page, for the app and the assets', () => {
    expect(
      parseArgs(['--to', 'a@example.com', '--asset-origin', 'https://x.example/email'])
    ).toEqual(refused('--asset-origin takes an origin'));
  });

  it('reads the address, the dry-run folder, the samples to send and the origins', () => {
    expect(
      parseArgs([
        '--to',
        'a@example.com',
        '--dry-run',
        'samples',
        '--only',
        'welcome,login-code',
        '--app-url',
        'https://dev.tokencircles.com',
        '--asset-origin',
        'https://dev.tokencircles.com',
      ])
    ).toEqual({
      to: 'a@example.com',
      dryRun: 'samples',
      only: ['welcome', 'login-code'],
      appUrl: 'https://dev.tokencircles.com',
      assetOrigin: 'https://dev.tokencircles.com',
    });
    expect(parseArgs(['--to', 'a@example.com'])).toEqual({
      to: 'a@example.com',
      dryRun: null,
      only: null,
      appUrl: 'https://tokencircles.com',
      assetOrigin: undefined,
    });
  });
});

/** Run the command with a stub fetch and the output kept, so nothing reaches the network. */
async function run(key: string | undefined, fetchImpl?: typeof fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const code = await main({
    argv: ['--to', 'sample@example.com', '--only', 'welcome'],
    env: { RESEND_API_KEY: key },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      if (fetchImpl) return fetchImpl(input, init);
      return Response.json({ id: 'msg_1' });
    }) as typeof fetch,
  });
  return { code, out: out.join(''), err: err.join(''), calls };
}

describe('send-sample-mails, the key', () => {
  for (const [name, key] of [
    ['a line break', 're_FAKE_first\nsecondline'],
    ['a carriage return', 're_FAKE_first\rsecondline'],
    ['a NUL', 're_FAKE_first\0secondline'],
    ['a space inside', 're_FAKE_first secondline'],
  ] as const) {
    it(`refuses a key with ${name}, sends nothing and prints none of it`, async () => {
      const { code, out, err, calls } = await run(key);

      expect(code).toBe(2);
      expect(calls).toEqual([]);
      expect(err).toContain(
        'RESEND_API_KEY is not one line of letters, digits, _ or -, so nothing was sent.'
      );
      for (const part of ['FAKE', 'first', 'secondline', 're_']) {
        expect(out + err).not.toContain(part);
      }
    });
  }

  it('takes a key with a line break at the end, as a secret manager may hand it over', async () => {
    const { code, out, calls } = await run('re_FAKE_trailing\n');

    expect(code).toBe(0);
    expect(calls).toEqual(['https://api.resend.com/emails']);
    expect(out).toBe('welcome msg_1\n');
  });

  it('prints [key] in place of the key when an error quotes it', async () => {
    const key = 're_FAKE_quoted_in_the_error';
    const { code, out, err } = await run(key, () =>
      Promise.reject(new Error(`Headers.append: "Bearer ${key}" is not accepted, ${key}`))
    );

    expect(code).toBe(1);
    expect(out).toBe('welcome error: Headers.append: "Bearer [key]" is not accepted, [key]\n');
    expect(out + err).not.toContain('FAKE');
  });

  it("prints [key] in place of the key when Resend's answer quotes it", async () => {
    const key = 're_FAKE_quoted_by_resend';
    const { code, out } = await run(key, () =>
      Promise.resolve(Response.json({ message: `API key ${key} is invalid` }, { status: 401 }))
    );

    expect(code).toBe(1);
    expect(out).toBe('welcome error: Resend 401: API key [key] is invalid\n');
  });
});

describe('send-sample-mails, the headers', () => {
  /** The Resend request body for each named sample, from a stub fetch. */
  async function bodies(only: string): Promise<Record<string, unknown>[]> {
    const sent: Record<string, unknown>[] = [];
    const code = await main({
      argv: ['--to', 'sample@example.com', '--only', only],
      env: { RESEND_API_KEY: 're_FAKE_headers' },
      out: () => {},
      err: () => {},
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ id: 'msg_1' });
      }) as typeof fetch,
    });
    expect(code).toBe(0);
    return sent;
  }

  it('sends the List-Unsubscribe pair with a mail that has an unsubscribe link, as the Worker does', async () => {
    const [budget, dayTwo] = await bodies('budget-alert,week-one-day-2');

    expect(budget.headers).toEqual({
      'List-Unsubscribe': expect.stringMatching(
        /^<https:\/\/.+\/api\/notifications\/unsubscribe\?token=/
      ),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect((dayTwo.headers as Record<string, string>)['List-Unsubscribe']).toContain(
      'list=week-one'
    );
  });

  it('sends no headers with a mail that has none', async () => {
    const [welcome] = await bodies('welcome');

    expect(welcome).not.toHaveProperty('headers');
  });
});
