import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// One-click unsubscribe from email footers: must flip the user's flag and render a
// human-readable confirmation page (the old link pointed at the SPA host and did
// neither). Unknown/missing tokens get a distinct error page, not a fake success.

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider, token_version, unsubscribe_token) VALUES (90, 'unsub@example.com', 'password', 1, 'tok-abc-123')"
  ).run();
});

describe('GET /api/notifications/unsubscribe', () => {
  it('unsubscribes the matching user and shows a confirmation page', async () => {
    const res = await SELF.fetch(
      'https://example.com/api/notifications/unsubscribe?token=tok-abc-123'
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are unsubscribed');
    expect(html).toContain('Settings');

    const row = await env.DB.prepare(
      'SELECT notifications_unsubscribed FROM users WHERE id = 90'
    ).first<{ notifications_unsubscribed: number }>();
    expect(row?.notifications_unsubscribed).toBe(1);
  });

  it('rejects an unknown token without unsubscribing anyone', async () => {
    const res = await SELF.fetch(
      'https://example.com/api/notifications/unsubscribe?token=wrong-token'
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not recognized');

    const row = await env.DB.prepare(
      'SELECT notifications_unsubscribed FROM users WHERE id = 90'
    ).first<{ notifications_unsubscribed: number | null }>();
    expect(row?.notifications_unsubscribed ?? 0).toBe(0);
  });

  it('rejects a missing token', async () => {
    const res = await SELF.fetch('https://example.com/api/notifications/unsubscribe');
    expect(res.status).toBe(400);
  });
});
