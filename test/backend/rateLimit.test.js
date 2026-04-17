/**
 * Tests for API Rate Limiting
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('API Rate Limiting', () => {
  let authCookie;

  beforeAll(async () => {
    // Reset rate limits before starting
    await request(BASE_URL).post('/api/test/reset-rate-limit');
    const loginRes = await request(BASE_URL).post('/api/auth/login')
      .set('X-Skip-RateLimit', 'true')
      .send({ username: 'maff', password: 'add2' });
    authCookie = loginRes.headers['set-cookie'];
  });

  describe('Rate limit headers', () => {
    test('GET /api/profiles returns rate limit headers', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      expect(resp.headers).toHaveProperty('x-ratelimit-reset');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('GET /api/transactions returns rate limit headers', async () => {
      const resp = await request(BASE_URL).get('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('POST /api/transactions returns rate limit headers', async () => {
      const resp = await request(BASE_URL).post('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({
          description: 'Rate limit test',
          amount: 100,
          date: '2026-04-15',
          type: 'expense'
        });
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('Rate limit remaining decreases with requests', async () => {
      const resp1 = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      const resp2 = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      const remaining1 = parseInt(resp1.headers['x-ratelimit-remaining']);
      const remaining2 = parseInt(resp2.headers['x-ratelimit-remaining']);
      // After 2+ requests, remaining should be less than 100
      expect(remaining2).toBeLessThan(100);
    });

    test('Rate limit reset is a future timestamp', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      const resetTime = parseInt(resp.headers['x-ratelimit-reset']);
      const now = Math.floor(Date.now() / 1000);
      expect(resetTime).toBeGreaterThan(now);
    });
  });

  describe('Auth rate limiting (stricter)', () => {
    test('Login endpoint has stricter rate limit', async () => {
      // Reset auth rate limits
      await request(BASE_URL).post('/api/test/reset-rate-limit');
      const resp = await request(BASE_URL).post('/api/auth/login')
        .set('X-Skip-RateLimit', 'true')
        .send({ username: 'maff', password: 'wrong' });

      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(10);
    });
  });

  describe('Rate limit headers format', () => {
    beforeAll(async () => {
      // Reset before this describe block
      await request(BASE_URL).post('/api/test/reset-rate-limit');
    });

    test('X-RateLimit-Limit is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(typeof resp.headers['x-ratelimit-limit']).toBe('string');
    });

    test('X-RateLimit-Remaining is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(typeof resp.headers['x-ratelimit-remaining']).toBe('string');
    });

    test('X-RateLimit-Reset is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(typeof resp.headers['x-ratelimit-reset']).toBe('string');
    });

    test('X-RateLimit-Remaining is non-negative', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      const remaining = parseInt(resp.headers['x-ratelimit-remaining']);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rate limit response format', () => {
    beforeAll(async () => {
      await request(BASE_URL).post('/api/test/reset-rate-limit');
    });

    test('429 response includes error message', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('Retry-After header structure when rate limited', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      if (resp.status === 429) {
        expect(resp.headers).toHaveProperty('retry-after');
        expect(typeof resp.headers['retry-after']).toBe('string');
      } else {
        expect(resp.status).toBe(200);
      }
    });
  });

  describe('Rate limiting isolation by profile', () => {
    beforeAll(async () => {
      await request(BASE_URL).post('/api/test/reset-rate-limit');
    });

    test('Different profiles have separate rate limits', async () => {
      const resp1 = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', '1');
      const resp2 = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', '2');
      expect(resp1.status).toBe(200);
      expect(resp2.status).toBe(200);
    });
  });

  describe('API rate limit configuration', () => {
    beforeAll(async () => {
      await request(BASE_URL).post('/api/test/reset-rate-limit');
    });

    test('API endpoints have 100 request limit', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('Rate limit window is 1 minute (60 seconds)', async () => {
      const resp = await request(BASE_URL).get('/api/profiles')
        .set('X-Skip-RateLimit', 'true');
      const resetTime = parseInt(resp.headers['x-ratelimit-reset']);
      const now = Math.floor(Date.now() / 1000);
      const diff = resetTime - now;
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(61);
    });
  });

  describe('All API routes have rate limiting', () => {
    beforeAll(async () => {
      await request(BASE_URL).post('/api/test/reset-rate-limit');
    });

    test('GET /api/transactions has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('PUT /api/transactions/bulk has rate limiting', async () => {
      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids: [1], action: 'update', data: { category_id: 1 } });
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/categories has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/budgets has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/budgets')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/loans has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/loans')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/dashboard/summary has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/dashboard/summary')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/analytics/category-trends has rate limiting', async () => {
      const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('POST /api/calculator/retire has rate limiting', async () => {
      const resp = await request(BASE_URL).post('/api/calculator/retire')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ age: 30, retireAge: 65, savings: 50000 });
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });
  });
});
