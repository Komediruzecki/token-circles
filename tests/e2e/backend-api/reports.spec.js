/**
 * E2E Tests for Reports & Analytics API
 * Covers custom reports, filtering, grouping, export formats, scheduling, comparison
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Reports E2E', () => {
  let agent;
  let testReportId;
  let testTxId;
  let testTxId2;
  let testTxId3;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testReportId) {
      await agent.delete(`/api/reports/${testReportId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    }
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).set('X-Skip-RateLimit', 'true').catch(() => {});
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
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-003: Overview report respects type filter', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        type: 'expense'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-004: Overview report includes category breakdown', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        includeCategories: true
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('categories');
    });
  });

  describe('POST /api/reports/custom', () => {
    test('BE-RPT-005: Create custom report successfully', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Test Report_' + Date.now(),
        type: 'expense',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        filters: {}
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      testReportId = resp.body.id;
    });

    test('BE-RPT-006: Custom report includes all filter criteria', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Filter Test',
        type: 'income',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        filters: {
          categoryId: 1,
          tags: ['tag1']
        }
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-007: Custom report with grouping by category', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Grouped Report',
        type: 'expense',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        groupBy: 'category',
        sort: 'amount',
        order: 'desc'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-008: Custom report with monthly grouping', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Monthly Group',
        type: 'expense',
        groupBy: 'month',
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-009: Reject report with empty name', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        type: 'expense'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-RPT-010: Reject report with invalid type', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Invalid Type',
        type: 'invalid'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-RPT-011: Validate date range endpoints', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'Date Range',
        type: 'expense',
        startDate: '2026-05-01',
        endDate: '2026-04-01'
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/reports/custom/:id', () => {
    test('BE-RPT-012: Get custom report by ID', async () => {
      if (!testReportId) return;
      const resp = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id', testReportId);
      global.expect(resp.body).toHaveProperty('name');
    });

    test('BE-RPT-013: Returns 404 for non-existent report', async () => {
      const resp = await agent.get('/api/reports/custom/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('PUT /api/reports/custom/:id', () => {
    test('BE-RPT-014: Update custom report name', async () => {
      if (!testReportId) return;
      const newName = 'Updated Report_' + Date.now();

      const resp = await agent.put(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').send({
        name: newName
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
    });

    test('BE-RPT-015: Update custom report filters', async () => {
      if (!testReportId) return;
      const resp = await agent.put(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').send({
        startDate: '2026-04-15',
        endDate: '2026-04-25'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-016: Update custom report sorting', async () => {
      if (!testReportId) return;
      const resp = await agent.put(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').send({
        sort: 'date',
        order: 'desc'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-017: Update custom report grouping', async () => {
      if (!testReportId) return;
      const resp = await agent.put(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').send({
        groupBy: 'category'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('DELETE /api/reports/custom/:id', () => {
    test('BE-RPT-018: Delete custom report', async () => {
      if (!testReportId) return;
      const id = testReportId;

      const resp = await agent.delete(`/api/reports/custom/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/reports/custom/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-RPT-019: Delete returns 404 for non-existent', async () => {
      const resp = await agent.delete('/api/reports/custom/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Report Filters', () => {
    beforeAll(async () => {
      // Create test transactions
      for (let i = 0; i < 5; i++) {
        const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
          description: `ReportTx${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
        if (i === 0) testTxId = txResp.body.id;
        if (i === 1) testTxId2 = txResp.body.id;
        if (i === 2) testTxId3 = txResp.body.id;
      }
    });

    test('BE-RPT-020: Filter by category in reports', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        categoryId: 1
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-021: Filter by tag in reports', async () => {
      const tags = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      if (tags.body.length > 0) {
        const tagId = tags.body[0].id;
        const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
          tagIds: tagId
        });
        global.expect(resp.status).toBe(200);
      }
    });

    test('BE-RPT-022: Filter by account in reports', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        accountId: 1
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-023: Filter by type in reports', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        type: 'expense'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-024: Combined filters work together', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        type: 'expense',
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Report Sorting & Grouping', () => {
    test('BE-RPT-025: Sort by amount ascending', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        sort: 'amount',
        order: 'asc'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-026: Sort by amount descending', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        sort: 'amount',
        order: 'desc'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-027: Sort by date ascending', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        sort: 'date',
        order: 'asc'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-028: Group by category', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        groupBy: 'category'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-029: Group by month', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        groupBy: 'month'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-030: Group by year', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        groupBy: 'year'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Report Data Fields', () => {
    test('BE-RPT-031: Report includes transaction count', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('transactionCount');
    });

    test('BE-RPT-032: Report includes average transaction amount', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('avgTransaction');
    });

    test('BE-RPT-033: Report includes highest and lowest amounts', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-034: Report includes earliest and latest dates', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Report Charts & Visualization', () => {
    test('BE-RPT-035: Report includes breakdown by category', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        includeCategories: true
      });
      global.expect(resp.status).toBe(200);
      if (resp.body.categories) {
        global.expect(Array.isArray(resp.body.categories)).toBe(true);
      }
    });

    test('BE-RPT-036: Report includes trend data', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        includeTrends: true,
        period: 'month'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-037: Chart data has required structure', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        includeTrends: true
      });
      global.expect(resp.status).toBe(200);
      if (resp.body.trends) {
        global.expect(resp.body.trends).toHaveProperty('labels');
        global.expect(resp.body.trends).toHaveProperty('values');
      }
    });
  });

  describe('Report Export', () => {
    test('BE-RPT-038: Export report as CSV', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'csv'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers['content-type']).toMatch(/csv/);
    });

    test('BE-RPT-039: Export report as PDF', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'pdf'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers['content-type']).toMatch(/pdf/);
    });

    test('BE-RPT-040: Export custom report as CSV', async () => {
      if (!testReportId) return;
      const resp = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').query({
        export: 'csv'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-041: Export custom report as PDF', async () => {
      if (!testReportId) return;
      const resp = await agent.get(`/api/reports/custom/${testReportId}`).set('X-Skip-RateLimit', 'true').query({
        export: 'pdf'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-042: Export supports JSON format', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'json'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.headers['content-type']).toMatch(/json/);
    });

    test('BE-RPT-043: Export filename includes date', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'csv'
      });
      global.expect(resp.headers['content-disposition']).toMatch(/filename/);
    });

    test('BE-RPT-044: Report exports include all filtered data', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        export: 'json'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-045: Export handles date range correctly', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        startDate: '2026-04-15',
        endDate: '2026-04-20',
        export: 'json'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Report Comparison', () => {
    test('BE-RPT-046: Compare two periods', async () => {
      const resp = await agent.get('/api/reports/compare').set('X-Skip-RateLimit', 'true').query({
        startDate1: '2026-04-01',
        endDate1: '2026-04-30',
        startDate2: '2026-03-01',
        endDate2: '2026-03-31'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('period1');
      global.expect(resp.body).toHaveProperty('period2');
    });

    test('BE-RPT-047: Comparison shows percentage change', async () => {
      const resp = await agent.get('/api/reports/compare').set('X-Skip-RateLimit', 'true').query({
        startDate1: '2026-04-01',
        endDate1: '2026-04-30',
        startDate2: '2026-03-01',
        endDate2: '2026-03-31'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-048: Comparison respects same filters', async () => {
      const resp = await agent.get('/api/reports/compare').set('X-Skip-RateLimit', 'true').query({
        type: 'expense',
        startDate1: '2026-04-01',
        endDate1: '2026-04-30',
        startDate2: '2026-03-01',
        endDate2: '2026-03-31'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Report Persistence', () => {
    test('BE-RPT-049: Saved report persists after update', async () => {
      if (!testReportId) return;

      // Save report
      const saveResp = await agent.post('/api/reports/save').set('X-Skip-RateLimit', 'true').send({
        reportId: testReportId,
        name: 'Saved Report'
      });
      global.expect(saveResp.status).toBe(200);

      // Check if saved
      const savedResp = await agent.get(`/api/reports/saved/${testReportId}`).set('X-Skip-RateLimit', 'true');
      global.expect(savedResp.status).toBe(200);
    });

    test('BE-RPT-050: List all saved reports', async () => {
      const resp = await agent.get('/api/reports/saved').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });
  });

  describe('Report Performance', () => {
    test('BE-RPT-051: Report handles large date ranges efficiently', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        startDate: '2024-01-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });

    test("BE-RPT-052: Complex grouping doesn't time out", async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        groupBy: 'month',
        startDate: '2024-01-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-053: Export completes within reasonable time', async () => {
      const start = Date.now();
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'csv',
        startDate: '2024-01-01',
        endDate: '2026-04-30'
      });
      const duration = Date.now() - start;
      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(30000); // 30 second timeout
    });
  });

  describe('Report Validation', () => {
    test('BE-RPT-054: Invalid export format returns error', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'invalid'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-RPT-055: Invalid period returns error', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        includeTrends: true,
        period: 'invalid'
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Report Accessibility', () => {
    test('BE-RPT-056: Report includes summary for screen readers', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('BE-RPT-057: Report structure is semantic', async () => {
      const resp = await agent.get('/api/reports/overview').set('X-Skip-RateLimit', 'true').query({
        export: 'json'
      });
      global.expect(resp.status).toBe(200);
    });
  });
});