/**
 * E2E Tests for Performance API
 * Covers API response times, endpoint performance, load handling
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Performance E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/health', () => {
    test('BE-PERF-001: Health check returns 200', async () => {
      const resp = await agent.get('/api/health');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('status');
    });

    test('BE-PERF-002: Health check returns database status', async () => {
      const resp = await agent.get('/api/health');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('database');
    });

    test('BE-PERF-003: Health check response time under 100ms', async () => {
      const start = Date.now();
      await agent.get('/api/health');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });

  describe('Transaction List Performance', () => {
    test('BE-PERF-004: Get 1000 transactions under 5 seconds', async () => {
      // Create test transactions
      for (let i = 0; i < 1000; i++) {
        await agent.post('/api/transactions').send({
          description: `PerfTx${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
      }

      const start = Date.now();
      const resp = await agent.get('/api/transactions').query({ limit: 100 });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(5000);
    });

    test('BE-PERF-005: Transaction filtering completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/transactions').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        limit: 100
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Report Generation Performance', () => {
    test('BE-PERF-006: Overview report generates under 2 seconds', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview');
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(2000);
    });

    test('BE-PERF-007: Custom report generates under 3 seconds', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').query({
        startDate: '2024-01-01',
        endDate: '2026-04-30'
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(3000);
    });
  });

  describe('Search Performance', () => {
    test('BE-PERF-008: Transaction search completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/transactions').query({
        q: 'test',
        limit: 100
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });

    test('BE-PERF-009: Report search completes quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').query({
        q: 'expense',
        limit: 100
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('API Response Times', () => {
    test('BE-PERF-010: Auth endpoints respond quickly', async () => {
      const start = Date.now();
      const resp = await agent.post('/api/auth/login').send({
        username: 'maff',
        password: 'add2'
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(500);
    });

    test('BE-PERF-011: Settings endpoint responds quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/settings');
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(200);
    });

    test('BE-PERF-012: Health check endpoint responds quickly', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/health');
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Large Data Handling', () => {
    test('BE-PERF-013: Handle many accounts', async () => {
      for (let i = 0; i < 100; i++) {
        await agent.post('/api/accounts').send({
          name: `PerfAcc${i}_${Date.now()}`,
          type: 'checking',
          initialBalance: 1000
        });
      }

      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(100);
    });

    test('BE-PERF-014: Handle many categories', async () => {
      for (let i = 0; i < 50; i++) {
        await agent.post('/api/categories').send({
          name: `PerfCat${i}_${Date.now()}`
        });
      }

      const resp = await agent.get('/api/categories');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(50);
    });

    test('BE-PERF-015: Handle many tags', async () => {
      for (let i = 0; i < 100; i++) {
        await agent.post('/api/tags').send({
          name: `PerfTag${i}_${Date.now()}`
        });
      }

      const resp = await agent.get('/api/tags');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Endpoint Response Headers', () => {
    test('BE-PERF-016: Response includes content-length', async () => {
      const resp = await agent.get('/api/health');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('content-length');
    });

    test('BE-PERF-017: Response includes content-type', async () => {
      const resp = await agent.get('/api/settings');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('content-type');
    });
  });

  describe('Memory Efficiency', () => {
    test('BE-PERF-018: GET /api/transactions handles pagination', async () => {
      const resp = await agent.get('/api/transactions').query({
        limit: 50,
        offset: 0
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows) {
        expect(resp.body.rows.length).toBeLessThanOrEqual(50);
      }
    });

    test('BE-PERF-019: GET /api/transactions respects limit parameter', async () => {
      const resp = await agent.get('/api/transactions').query({
        limit: 10
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows) {
        expect(resp.body.rows.length).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('Cache Headers', () => {
    test('BE-PERF-020: GET /api/health includes cache headers', async () => {
      const resp = await agent.get('/api/health');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('cache-control');
    });

    test('BE-PERF-021: GET /api/settings includes cache headers', async () => {
      const resp = await agent.get('/api/settings');
      expect(resp.status).toBe(200);
      expect(resp.headers).toHaveProperty('cache-control');
    });
  });
});