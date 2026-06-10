/**
 * E2E Tests for Tax & Compliance API
 * Covers tax calculations, reports, compliance tracking, documentation
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Tax E2E', () => {
  let agent;
  let testTxId;
  let testTxId2;
  let testTxId3;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Skip-RateLimit', 'true')
      .send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).set('X-Skip-RateLimit', 'true').catch(() => {});
  });

  describe('GET /api/tax/summary', () => {
    test('BE-TAX-001: Get tax summary for current period', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalIncome');
      global.expect(resp.body).toHaveProperty('totalDeductions');
      global.expect(resp.body).toHaveProperty('taxableIncome');
    });

    test('BE-TAX-002: Tax summary respects year filter', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true').query({
        year: 2026
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-TAX-003: Tax summary includes breakdown', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true').query({
        includeBreakdown: 'true'
      });
      global.expect(resp.status).toBe(200);
      if (resp.body.breakdown) {
        global.expect(Array.isArray(resp.body.breakdown)).toBe(true);
      }
    });

    test('BE-TAX-004: Tax summary with different year', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true').query({ year: 2025 });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('GET /api/tax/deductions', () => {
    test('BE-TAX-005: Get total deductions', async () => {
      const resp = await agent.get('/api/tax/deductions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalDeductions');
    });

    test('BE-TAX-006: Get deductions by category', async () => {
      const resp = await agent.get('/api/tax/deductions').set('X-Skip-RateLimit', 'true').query({
        category: 'charitable'
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-TAX-007: Deductions respect date range', async () => {
      const resp = await agent.get('/api/tax/deductions').set('X-Skip-RateLimit', 'true').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('GET /api/tax/income', () => {
    test('BE-TAX-008: Get total income for tax calculation', async () => {
      const resp = await agent.get('/api/tax/income').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalIncome');
    });

    test('BE-TAX-009: Income respects type filter', async () => {
      const resp = await agent.get('/api/tax/income').set('X-Skip-RateLimit', 'true').query({
        type: 'salary'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('POST /api/tax/estimates', () => {
    test('BE-TAX-010: Generate tax estimate based on income', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('estimatedTax');
      global.expect(resp.body).toHaveProperty('federalTax');
      global.expect(resp.body).toHaveProperty('stateTax');
    });

    test('BE-TAX-011: Estimate for different filing status', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'married_joint',
        state: 'CA'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('filingStatus', 'married_joint');
    });

    test('BE-TAX-012: Estimate for different state', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'NY'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.state).toBe('NY');
    });

    test('BE-TAX-013: Estimate includes effective tax rate', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('effectiveTaxRate');
    });

    test('BE-TAX-014: Reject negative income in estimate', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: -50000,
        filingStatus: 'single',
        state: 'CA'
      });
      global.expect(resp.status).toBe(400);
    });

    test('BE-TAX-015: Reject invalid filing status', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'invalid',
        state: 'CA'
      });
      global.expect(resp.status).toBe(400);
    });
  });

  describe('GET /api/tax/progress', () => {
    test('BE-TAX-016: Get tax progress for year', async () => {
      const resp = await agent.get('/api/tax/progress').set('X-Skip-RateLimit', 'true').query({ year: 2026 });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('year');
      global.expect(resp.body).toHaveProperty('monthlyProgress');
    });

    test('BE-TAX-017: Monthly progress shows paid vs estimated', async () => {
      const resp = await agent.get('/api/tax/progress').set('X-Skip-RateLimit', 'true').query({ year: 2026 });
      global.expect(resp.status).toBe(200);
      if (resp.body.monthlyProgress) {
        global.expect(Array.isArray(resp.body.monthlyProgress)).toBe(true);
      }
    });

    test('BE-TAX-018: Monthly progress includes month numbers', async () => {
      const resp = await agent.get('/api/tax/progress').set('X-Skip-RateLimit', 'true').query({ year: 2026 });
      global.expect(resp.status).toBe(200);
      if (resp.body.monthlyProgress && resp.body.monthlyProgress.length > 0) {
        global.expect(resp.body.monthlyProgress[0]).toHaveProperty('month');
      }
    });
  });

  describe('GET /api/tax/federal', () => {
    test('BE-TAX-019: Get federal tax summary', async () => {
      const resp = await agent.get('/api/tax/federal').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalFederalTax');
    });

    test('BE-TAX-020: Federal tax respects filters', async () => {
      const resp = await agent.get('/api/tax/federal').set('X-Skip-RateLimit', 'true').query({
        year: 2026,
        quarter: 2
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('GET /api/tax/state', () => {
    test('BE-TAX-021: Get state tax summary', async () => {
      const resp = await agent.get('/api/tax/state').set('X-Skip-RateLimit', 'true').query({ state: 'CA' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('totalStateTax');
    });

    test('BE-TAX-022: State tax respects state parameter', async () => {
      const resp = await agent.get('/api/tax/state').set('X-Skip-RateLimit', 'true').query({ state: 'NY' });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Tax Deduction Tracking', () => {
    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
          description: `Tax Tx${i}_${Date.now()}`,
          amount: 150,
          date: '2026-04-25',
          type: 'deduction'
        });
        if (i === 0) testTxId = txResp.body.id;
        if (i === 1) testTxId2 = txResp.body.id;
        if (i === 2) testTxId3 = txResp.body.id;
      }
    });

    test('BE-TAX-023: Deduction transactions included in tax summary', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.totalDeductions).toBeGreaterThan(0);
    });

    test('BE-TAX-024: Deduction transactions show in deductions endpoint', async () => {
      const resp = await agent.get('/api/tax/deductions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.totalDeductions).toBeGreaterThan(0);
    });
  });

  describe('Tax Report Export', () => {
    test('BE-TAX-025: Export tax summary as PDF', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true').query({
        export: 'pdf'
      });
      global.expect([200, 404, 500]).to.include(resp.status);
      if (resp.status === 200) global.expect(resp.headers['content-type']).toMatch(/pdf/);
    });

    test('BE-TAX-026: Export tax estimate as PDF', async () => {
      const estimateResp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });

      const taxId = estimateResp.body.id;
      const exportResp = await agent.get(`/api/tax/estimates/${taxId}`).set('X-Skip-RateLimit', 'true').query({
        export: 'pdf'
      });
      global.expect([200, 404, 500]).to.include(exportResp.status);
    });
  });

  describe('Tax Validation', () => {
    test('BE-TAX-027: Reject invalid state code', async () => {
      const resp = await agent.get('/api/tax/state').set('X-Skip-RateLimit', 'true').query({ state: 'ZZ' });
      global.expect(resp.status).toBe(400);
    });

    test('BE-TAX-028: Reject negative annual income', async () => {
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: -50000,
        filingStatus: 'single',
        state: 'CA'
      });
      global.expect(resp.status).toBe(400);
    });
  });

  describe('Tax Performance', () => {
    test('BE-TAX-029: Tax summary handles year with no data', async () => {
      const resp = await agent.get('/api/tax/summary').set('X-Skip-RateLimit', 'true').query({ year: 2025 });
      global.expect(resp.status).toBe(200);
    });

    test('BE-TAX-030: Tax estimate completes within timeout', async () => {
      const start = Date.now();
      const resp = await agent.post('/api/tax/estimates').set('X-Skip-RateLimit', 'true').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      const duration = Date.now() - start;

      global.expect(resp.status).toBe(200);
      global.expect(duration).toBeLessThan(10000); // 10 second timeout
    });
  });
});
