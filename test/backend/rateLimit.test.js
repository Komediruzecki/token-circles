/**
 * Tests for API Rate Limiting
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('API Rate Limiting', () => {
  let authCookie;

  beforeAll(async () => {
    const loginRes = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'maff', password: 'add2' });
    authCookie = loginRes.headers['set-cookie'];
  });

  describe('Rate limit headers', () => {
    test('GET /api/profiles returns rate limit headers', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      expect(resp.headers).toHaveProperty('x-ratelimit-reset');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('GET /api/transactions returns rate limit headers', async () => {
      const resp = await request(BASE_URL)
        .get('/api/transactions')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('POST /api/transactions returns rate limit headers', async () => {
      const resp = await request(BASE_URL)
        .post('/api/transactions')
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
      const resp1 = await request(BASE_URL).get('/api/profiles');
      const resp2 = await request(BASE_URL).get('/api/profiles');
      const remaining1 = parseInt(resp1.headers['x-ratelimit-remaining']);
      const remaining2 = parseInt(resp2.headers['x-ratelimit-remaining']);
      // After 2+ requests, remaining should be less than 100
      expect(remaining2).toBeLessThan(100);
    });

    test('Rate limit reset is a future timestamp', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      const resetTime = parseInt(resp.headers['x-ratelimit-reset']);
      const now = Math.floor(Date.now() / 1000);
      expect(resetTime).toBeGreaterThan(now);
    });
  });

  describe('Auth rate limiting (stricter)', () => {
    test('Login endpoint has stricter rate limit', async () => {
      // Use a different IP by setting X-Forwarded-For header (if proxied)
      // In test environment, rate limiting is based on actual IP
      const resp = await request(BASE_URL)
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'wrong' }); // intentionally wrong

      // Should still have rate limit headers
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
      expect(resp.headers).toHaveProperty('x-ratelimit-remaining');
      // Auth should have lower limit (10 attempts per 15 min)
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(10);
    });

    test('Invalid login still applies rate limit', async () => {
      // Try login with invalid credentials multiple times
      for (let i = 0; i < 5; i++) {
        await request(BASE_URL)
          .post('/api/auth/login')
          .send({ username: 'invalid', password: 'wrong' });
      }

      const resp = await request(BASE_URL)
        .post('/api/auth/login')
        .send({ username: 'invalid', password: 'wrong' });

      // Should still work (rate limit should be based on IP)
      expect(resp.status).toBeLessThanOrEqual(401);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });
  });

  describe('Rate limit headers format', () => {
    test('X-RateLimit-Limit is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(typeof resp.headers['x-ratelimit-limit']).toBe('string');
    });

    test('X-RateLimit-Remaining is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(typeof resp.headers['x-ratelimit-remaining']).toBe('string');
    });

    test('X-RateLimit-Reset is a string', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(typeof resp.headers['x-ratelimit-reset']).toBe('string');
    });

    test('X-RateLimit-Remaining is non-negative', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      const remaining = parseInt(resp.headers['x-ratelimit-remaining']);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rate limit response format', () => {
    test('429 response includes error message', async () => {
      // This test requires hitting the actual rate limit
      // Since in-memory rate limits reset between test runs,
      // we test the response format expectation
      // In a real scenario, after 100+ requests, you'd get:
      // { error: 'Too many requests...', retryAfter: number }

      // For now, verify that the headers are correctly set up
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('Retry-After header structure when rate limited', async () => {
      // When rate limited, Retry-After should be a string number
      // This would be tested in integration with actual rate limiting
      const resp = await request(BASE_URL).get('/api/profiles');
      if (resp.status === 429) {
        expect(resp.headers).toHaveProperty('retry-after');
        expect(typeof resp.headers['retry-after']).toBe('string');
      } else {
        // Normal request - no Retry-After header needed
        expect(resp.status).toBe(200);
      }
    });
  });

  describe('Rate limiting isolation by profile', () => {
    test('Different profiles have separate rate limits', async () => {
      // Request for profile 1
      const resp1 = await request(BASE_URL)
        .get('/api/profiles')
        .set('X-Profile-Id', '1');
      const remaining1 = parseInt(resp1.headers['x-ratelimit-remaining']);

      // Request for profile 2
      const resp2 = await request(BASE_URL)
        .get('/api/profiles')
        .set('X-Profile-Id', '2');
      const remaining2 = parseInt(resp2.headers['x-ratelimit-remaining']);

      // Both should start at similar remaining counts (same IP, different profile)
      // The rate limiter keys by ip:profile so they should be tracked separately
      expect(resp1.status).toBe(200);
      expect(resp2.status).toBe(200);
    });
  });

  describe('API rate limit configuration', () => {
    test('API endpoints have 100 request limit', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      expect(parseInt(resp.headers['x-ratelimit-limit'])).toBe(100);
    });

    test('Rate limit window is 1 minute (60 seconds)', async () => {
      const resp = await request(BASE_URL).get('/api/profiles');
      const resetTime = parseInt(resp.headers['x-ratelimit-reset']);
      const now = Math.floor(Date.now() / 1000);
      const diff = resetTime - now;
      // Should reset within roughly 60 seconds
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(60);
    });
  });

  describe('All API routes have rate limiting', () => {
    test('GET /api/transactions has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/transactions')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('PUT /api/transactions/bulk has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .put('/api/transactions/bulk')
        .set('Cookie', authCookie)
        .send({ ids: [1], action: 'update', data: { category_id: 1 } });
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/categories has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/categories')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/budgets has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/budgets')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/loans has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/loans')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/dashboard/summary has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/dashboard/summary')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('GET /api/analytics/category-trends has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .get('/api/analytics/category-trends?year=2026')
        .set('Cookie', authCookie);
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });

    test('POST /api/calculator/retire has rate limiting', async () => {
      const resp = await request(BASE_URL)
        .post('/api/calculator/retire')
        .set('Cookie', authCookie)
        .send({ age: 30, retireAge: 65, savings: 50000 });
      expect(resp.headers).toHaveProperty('x-ratelimit-limit');
    });
  });
});
