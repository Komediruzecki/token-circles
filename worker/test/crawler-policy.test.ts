/**
 * The API is not a page. Every response says so.
 *
 * Search Console reported api.dev.tokencircles.com/ as a 404 — it had crawled an API host, most
 * likely found through certificate-transparency logs, because nothing told it not to. The 404 was
 * correct (there is no root route) but the crawl should never have happened. These pin the two
 * signals that stop it: an `X-Robots-Tag` on every response, including the ones no handler wrote
 * (404s from notFound, 500s from onError), and a `/robots.txt` that disallows everything.
 */
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const NOINDEX = 'noindex, nofollow';

describe('crawler policy', () => {
  it('stamps X-Robots-Tag on a normal response', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
  });

  it('stamps it on the 404 the notFound handler builds — the response Search Console saw', async () => {
    const res = await SELF.fetch('https://example.com/');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
  });

  it('stamps it on an unauthenticated API rejection', async () => {
    // A handler-written non-2xx: the middleware must not depend on the handler succeeding.
    const res = await SELF.fetch('https://example.com/api/transactions');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
  });

  it('serves a robots.txt that disallows everything', async () => {
    const res = await SELF.fetch('https://example.com/robots.txt');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^User-agent: \*$/m);
    expect(body).toMatch(/^Disallow: \/$/m);
    expect(body).not.toMatch(/^Allow:/m);
    expect(res.headers.get('x-robots-tag')).toBe(NOINDEX);
  });
});
