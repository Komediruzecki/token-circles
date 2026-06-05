/**
 * E2E Tests for Reports API
 * Covers overview, custom reports CRUD, comparison, saved reports
 */
const request = require('supertest');
const BASE_URL = 'http://localhost:3847';

describe('Reports E2E', () => {
  let agent;
  let testReportId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testReportId) {
      await agent.delete(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    }
  });

  describe('GET /api/reports/overview', () => {
    test('BE-RPT-001: Get overview report returns summary', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalIncome');
      global.expect(resp.body).toHaveProperty('totalExpenses');
      global.expect(resp.body).toHaveProperty('netBalance');
      global.expect(resp.body).toHaveProperty('transactionCount');
    });

    test('BE-RPT-002: Overview report respects date filters', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        startDate: '2026-04-01', endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-003: Overview report respects type filter', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({ type: 'expense' });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-004: Overview report includes category breakdown', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({ includeCategories: 'true' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('categoryBreakdown');
      global.expect(Array.isArray(resp.body.categoryBreakdown)).toBe(true);
    });
  });

  describe('Custom Reports CRUD', () => {
    test('BE-RPT-005: Create custom report successfully', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Test Report_' + Date.now(), type: 'expense'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      testReportId = resp.body.id;
    });

    test('BE-RPT-006: Empty name defaults to Custom Report', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({ type: 'expense' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.name).toBe('Custom Report');
    });

    test('BE-RPT-007: Default type is custom', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({ name: 'Test' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.type).toBe('custom');
    });

    test('BE-RPT-008: Custom reports get unique IDs', async () => {
      const r1 = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({ name: 'A' });
      const r2 = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({ name: 'B' });
      global.expect(r1.body.id).not.toBe(r2.body.id);
    });

    test('BE-RPT-009: GET custom report by ID', async () => {
      if (!testReportId) return;
      const resp = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.id).toBe(testReportId);
    });

    test('BE-RPT-010: GET non-existent custom report returns 404', async () => {
      const resp = await agent.get('/api/reports/custom/999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });

    test('BE-RPT-011: PUT update custom report name', async () => {
      if (!testReportId) return;
      const newName = 'Updated_' + Date.now();
      const resp = await agent.put(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').send({ name: newName });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.name).toBe(newName);
    });

    test('BE-RPT-012: PUT non-existent report returns 404', async () => {
      const resp = await agent.put('/api/reports/custom/999999').set('X-Skip-RateLimit', 'true').send({ name: 'Ghost' });
      global.expect(resp.status).toBe(404);
    });

    test('BE-RPT-013: DELETE custom report', async () => {
      if (!testReportId) return;
      const resp = await agent.delete(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);
      const check = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(check.status).toBe(404);
      testReportId = null;
    });

    test('BE-RPT-014: DELETE non-existent returns 404', async () => {
      const resp = await agent.delete('/api/reports/custom/999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Report Comparison', () => {
    test('BE-RPT-015: Compare returns 3 recent months', async () => {
      const resp = await agent.get('/api/reports/compare').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('comparison');
      global.expect(Array.isArray(resp.body.comparison)).toBe(true);
      global.expect(resp.body.comparison.length).toBe(3);
    });

    test('BE-RPT-016: Comparison entries have month/income/expenses/net', async () => {
      const resp = await agent.get('/api/reports/compare').set('X-Skip-RateLimit', 'true');
      resp.body.comparison.forEach(entry => {
        global.expect(entry).toHaveProperty('month');
        global.expect(entry).toHaveProperty('income');
        global.expect(entry).toHaveProperty('expenses');
        global.expect(entry).toHaveProperty('net');
      });
    });
  });

  describe('Saved Reports', () => {
    test('BE-RPT-017: Save report returns ok', async () => {
      const resp = await agent.post('/api/reports/save').set('X-Skip-RateLimit', 'true').send({
        name: 'Saved Report', type: 'expense', params: {}
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-RPT-018: Save without name returns 400', async () => {
      const resp = await agent.post('/api/reports/save').set('X-Skip-RateLimit', 'true').send({ type: 'expense' });
      global.expect(resp.status).toBe(400);
    });

    test('BE-RPT-019: List saved reports returns reports array', async () => {
      const resp = await agent.get('/api/reports/saved').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('reports');
      global.expect(Array.isArray(resp.body.reports)).toBe(true);
    });
  });
});
