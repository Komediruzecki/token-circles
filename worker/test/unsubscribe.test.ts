import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// The unsubscribe link in a reminder mail's footer. Opening it (GET) only shows a page with one
// button; the button, or a mail app's own unsubscribe button (RFC 8058 one-click), POSTs to the
// same URL and that POST is what turns reminder mails off. A link that unsubscribed on a plain GET
// was followed by anything that fetches links in mail, without anyone pressing anything.

const URL_OK = 'https://example.com/api/notifications/unsubscribe?token=tok-abc-123';
const URL_WRONG = 'https://example.com/api/notifications/unsubscribe?token=wrong-token';
const URL_NONE = 'https://example.com/api/notifications/unsubscribe';

/** A mail provider's one-click request: form-encoded body, no cookie, from its own origin. */
const ONE_CLICK: RequestInit = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://mail.example.net',
  },
  body: 'List-Unsubscribe=One-Click',
};

async function unsubscribed(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT notifications_unsubscribed FROM users WHERE id = ?')
    .bind(id)
    .first<{ notifications_unsubscribed: number | null }>();
  return row?.notifications_unsubscribed ?? 0;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, unsubscribe_token) VALUES (90, 'unsub@example.com', 'password', 1, 'tok-abc-123')"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, unsubscribe_token) VALUES (91, 'stays@example.com', 'password', 1, 'tok-other-456')"
    ),
  ]);
});

describe('GET /api/notifications/unsubscribe', () => {
  it('shows a button that posts back to the same link, and changes nothing', async () => {
    const res = await SELF.fetch(URL_OK);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      '<form method="post" action="/api/notifications/unsubscribe?token=tok-abc-123">'
    );
    expect(html).toMatch(/<button type="submit"[^>]*>Unsubscribe<\/button>/);
    expect(html).toContain('reminder mails');

    expect(await unsubscribed(90)).toBe(0);
  });

  it('changes nothing when fetched twice or by HEAD, the way link scanners do', async () => {
    await SELF.fetch(URL_OK);
    await SELF.fetch(URL_OK, { method: 'HEAD' });
    await SELF.fetch(URL_OK);

    expect(await unsubscribed(90)).toBe(0);
  });

  it('says so, without a button, when reminder mails are already off', async () => {
    await env.DB.prepare('UPDATE users SET notifications_unsubscribed = 1 WHERE id = 90').run();

    const res = await SELF.fetch(URL_OK);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are unsubscribed');
    expect(html).not.toContain('<form');
  });

  it('rejects an unknown token with no button', async () => {
    const res = await SELF.fetch(URL_WRONG);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('not recognized');
    expect(html).not.toContain('<form');
  });

  it('rejects a missing token', async () => {
    const res = await SELF.fetch(URL_NONE);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('missing its token');
  });

  it('escapes the token it writes into the page', async () => {
    const odd = '"><script>x</script>';
    await env.DB.prepare('UPDATE users SET unsubscribe_token = ? WHERE id = 90').bind(odd).run();

    const res = await SELF.fetch(`${URL_NONE}?token=${encodeURIComponent(odd)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('<script>');
  });
});

describe('POST /api/notifications/unsubscribe', () => {
  it('unsubscribes the matching user, only that one, and shows the done page', async () => {
    // What the page's button sends: a same-origin form post with an empty body.
    const res = await SELF.fetch(URL_OK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('You are unsubscribed');
    expect(html).not.toContain('<form');

    expect(await unsubscribed(90)).toBe(1);
    expect(await unsubscribed(91)).toBe(0);
  });

  it('takes a one-click request from a mail provider: no cookie, foreign origin', async () => {
    const res = await SELF.fetch(URL_OK, ONE_CLICK);
    expect(res.status).toBe(200);

    expect(await unsubscribed(90)).toBe(1);
  });

  it('answers 200 again for a token that is already unsubscribed', async () => {
    expect((await SELF.fetch(URL_OK, ONE_CLICK)).status).toBe(200);
    const again = await SELF.fetch(URL_OK, ONE_CLICK);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain('You are unsubscribed');

    expect(await unsubscribed(90)).toBe(1);
  });

  it('rejects an unknown token without unsubscribing anyone', async () => {
    const res = await SELF.fetch(URL_WRONG, ONE_CLICK);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('not recognized');

    expect(await unsubscribed(90)).toBe(0);
    expect(await unsubscribed(91)).toBe(0);
  });

  it('rejects a missing token', async () => {
    const res = await SELF.fetch(URL_NONE, ONE_CLICK);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('missing its token');
  });
});

describe('cross-origin rules', () => {
  // The one-click POST needs no CORS answer (a mail provider posts from its server, and a form
  // post is a navigation), so nothing was opened for it. These pin that the app's own routes
  // still answer only the app origin.
  const preflight = (origin: string) =>
    SELF.fetch('https://example.com/api/notifications/settings', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

  it('does not allow a foreign origin on an authenticated route', async () => {
    const res = await preflight('https://mail.example.net');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://mail.example.net');
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('still allows the app origin, with credentials', async () => {
    const appOrigin = (env as unknown as { CORS_ORIGIN: string }).CORS_ORIGIN;
    const res = await preflight(appOrigin);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('gives the unsubscribe POST no CORS grant for a foreign origin either', async () => {
    const res = await SELF.fetch(URL_OK, ONE_CLICK);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://mail.example.net');
  });
});
