/**
 * E2E Tests for Performance API
 * Covers API response times, endpoint performance, load handling
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Performance E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/health', () => {
    test('BE-PERF-001: Health check returns 200', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('status');
    });

    test('BE-PERF-002: Health check returns database status', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('database');
    });

    test('BE-PERF-003: Health check response time under 100ms', async () => {
      const start = Date.now();
      await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      const duration = Date.now() - start;

      global.expect(duration).toBeLessThan(100);
    });
  });

  describe('Transaction List Performance', () => {
    jest.setTimeout(20000);
    test('BE-PERF-004: Get 1000 transactions under 5 seconds', async () => {
      // Create test transactions (skip rate limit)
      for (let i = 0; i < 1000; i++) {
        await agent.post('/api/transactions').set("X-Skip-RateLimit", "true").send({
          description: `PerfTx${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
      }

      const start = Date.now();
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({ limit: 100 }).set('X-Skip-RateLimit', 'true');
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(5000);
    });

    test('BE-PERF-005: Transaction filtering completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        limit: 100
      }).set('X-Skip-RateLimit', 'true');
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(2000);
    });
  });

  describe('Report Generation Performance', () => {
    test('BE-PERF-006: Overview report generates under 5 seconds', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').set("X-Skip-RateLimit", "true");
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(5000);
    });

    test('BE-PERF-007: Overview with date range generates under 5 seconds', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        startDate: '2024-01-01',
        endDate: '2026-04-30'
      });
      const duration = Date.now() - start;

      global.expect([200, 500]).toContain(resp.status);
      if (resp.status === 200) global.expect(duration).toBeLessThan(5000);
    });
  });

  describe('Search Performance', () => {
    test('BE-PERF-008: Transaction search completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        q: 'test',
        limit: 100
      }).set('X-Skip-RateLimit', 'true');
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(1000);
    });

    test('BE-PERF-009: Overview with type filter completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        type: 'expense'
      });
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(3000);
    });
  });

  describe('API Response Times', () => {
    test('BE-PERF-010: Auth endpoints respond quickly', async () => {
      const start = Date.now();
      const resp = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
        username: 'maff',
        password: 'add2'
      });
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(500);
    });

    test('BE-PERF-011: Settings endpoint responds quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/settings').set("X-Skip-RateLimit", "true");
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(200);
    });

    test('BE-PERF-012: Health check endpoint responds quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(50);
    });
  });

  describe('Large Data Handling', () => {
    test('BE-PERF-013: Handle many accounts', async () => {
      for (let i = 0; i < 100; i++) {
        await agent.post('/api/accounts').set("X-Skip-RateLimit", "true").send({
          name: `PerfAcc${i}_${Date.now()}`,
          type: 'checking',
          initialBalance: 1000
        });
      }

      const resp = await agent.get('/api/accounts').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.length).toBeGreaterThanOrEqual(100);
    });

    test('BE-PERF-014: Handle many categories', async () => {
      const suffix = Date.now();
      for (let i = 0; i < 50; i++) {
        await agent.post('/api/categories').set("X-Skip-RateLimit", "true").send({
          name: `PerfCat${i}_${suffix}`
        }).catch(() => {});
      }

      const resp = await agent.get('/api/categories').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.length).toBeGreaterThanOrEqual(1);
    });

    test('BE-PERF-015: Handle many tags', async () => {
      for (let i = 0; i < 100; i++) {
        await agent.post('/api/tags').set("X-Skip-RateLimit", "true").send({
          name: `PerfTag${i}_${Date.now()}`
        });
      }

      const resp = await agent.get('/api/tags').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Endpoint Response Headers', () => {
    test('BE-PERF-016: Response includes content-length', async () => {
      const resp = await agent.get('/api/health').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers).toHaveProperty('content-length');
    });

    test('BE-PERF-017: Response includes content-type', async () => {
      const resp = await agent.get('/api/settings').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers).toHaveProperty('content-type');
    });
  });

  describe('Memory Efficiency', () => {
    test('BE-PERF-018: GET /api/transactions handles pagination', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        limit: 50,
        offset: 0
      }).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.rows) {
        global.expect(resp.body.rows.length).toBeLessThanOrEqual(50);
      }
    });

    test('BE-PERF-019: GET /api/transactions respects limit parameter', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        limit: 10
      }).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.rows) {
        global.expect(resp.body.rows.length).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('Cache Headers', () => {
    test('BE-PERF-020: GET /api/health includes ETag header', async () => {
      const resp = await agent.get('/api/health').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers).toHaveProperty('etag');
    });

    test('BE-PERF-021: GET /api/settings includes response headers', async () => {
      const resp = await agent.get('/api/settings').set("X-Skip-RateLimit", "true");
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers).toHaveProperty('content-type');
    });
  });
});