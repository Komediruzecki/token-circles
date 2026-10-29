import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureUnsubToken } from '../src/reminders';

// A reminder mail's unsubscribe link carries the account's token, minted the first time a mail
// needs one. A cron that fires twice runs two senders that both see no token yet.

async function stored(id: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT unsubscribe_token FROM users WHERE id = ?')
    .bind(id)
    .first<{ unsubscribe_token: string | null }>();
  return row?.unsubscribe_token ?? null;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider, token_version) VALUES (95, 'token@example.com', 'password', 1)"
  ).run();
});

describe('the unsubscribe token', () => {
  it('is the same for two senders that both found none, and it is the one stored', async () => {
    const [a, b] = await Promise.all([
      ensureUnsubToken(env, { id: 95, unsubscribe_token: null }),
      ensureUnsubToken(env, { id: 95, unsubscribe_token: null }),
    ]);

    expect(a).toBe(b);
    expect(await stored(95)).toBe(a);
  });

  it('keeps a token already stored, even for a sender that read none', async () => {
    await env.DB.prepare("UPDATE users SET unsubscribe_token = 'tok-kept' WHERE id = 95").run();

    expect(await ensureUnsubToken(env, { id: 95, unsubscribe_token: null })).toBe('tok-kept');
    expect(await stored(95)).toBe('tok-kept');
  });

  it('refuses an account that is gone, rather than handing out a token nobody stored', async () => {
    await expect(ensureUnsubToken(env, { id: 4242, unsubscribe_token: null })).rejects.toThrow(
      /no user 4242/
    );
  });
});
