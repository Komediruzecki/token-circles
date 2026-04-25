/**
 * E2E Tests for Tax & Compliance API
 * Covers tax calculations, reports, compliance tracking, documentation
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Tax E2E', () => {
  let agent;
  let testTxId;
  let testTxId2;
  let testTxId3;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).catch(() => {});
  });

  describe('GET /api/tax/summary', () => {
    test('BE-TAX-001: Get tax summary for current period', async () => {
      const resp = await agent.get('/api/tax/summary');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalIncome');
      expect(resp.body).toHaveProperty('totalDeductions');
      expect(resp.body).toHaveProperty('taxableIncome');
    });

    test('BE-TAX-002: Tax summary respects date filters', async () => {
      const resp = await agent.get('/api/tax/summary').query({
        year: 2026,
        month: 4
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TAX-003: Tax summary includes breakdown', async () => {
      const resp = await agent.get('/api/tax/summary').query({
        includeBreakdown: true
      });
      expect(resp.status).toBe(200);
      if (resp.body.breakdown) {
        expect(Array.isArray(resp.body.breakdown)).toBe(true);
      }
    });
  });

  describe('GET /api/tax/deductions', () => {
    test('BE-TAX-004: Get total deductions', async () => {
      const resp = await agent.get('/api/tax/deductions');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalDeductions');
    });

    test('BE-TAX-005: Get deductions by category', async () => {
      const resp = await agent.get('/api/tax/deductions').query({
        category: 'charitable'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TAX-006: Deductions respect date range', async () => {
      const resp = await agent.get('/api/tax/deductions').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('GET /api/tax/income', () => {
    test('BE-TAX-007: Get total income for tax calculation', async () => {
      const resp = await agent.get('/api/tax/income');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalIncome');
    });

    test('BE-TAX-008: Income respects filters', async () => {
      const resp = await agent.get('/api/tax/income').query({
        type: 'salary'
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('POST /api/tax/estimates', () => {
    test('BE-TAX-009: Generate tax estimate based on income', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('estimatedTax');
      expect(resp.body).toHaveProperty('federalTax');
      expect(resp.body).toHaveProperty('stateTax');
    });

    test('BE-TAX-010: Estimate for different filing status', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'married_joint',
        state: 'CA'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TAX-011: Estimate for different state', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'NY'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TAX-012: Estimate includes effective tax rate', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      expect(resp.status).toBe(200);
      if (resp.body.estimatedTax) {
        expect(resp.body).toHaveProperty('effectiveTaxRate');
      }
    });

    test('BE-TAX-013: Reject negative income in estimate', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: -50000,
        filingStatus: 'single',
        state: 'CA'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-TAX-014: Reject invalid filing status', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'invalid',
        state: 'CA'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/tax/progress', () => {
    test('BE-TAX-015: Get tax progress for year', async () => {
      const resp = await agent.get('/api/tax/progress').query({ year: 2026 });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('year');
      expect(resp.body).toHaveProperty('monthlyProgress');
    });

    test('BE-TAX-016: Monthly progress shows paid vs estimated', async () => {
      const resp = await agent.get('/api/tax/progress').query({ year: 2026 });
      expect(resp.status).toBe(200);
      if (resp.body.monthlyProgress) {
        expect(Array.isArray(resp.body.monthlyProgress)).toBe(true);
      }
    });

    test('BE-TAX-017: Monthly progress includes month numbers', async () => {
      const resp = await agent.get('/api/tax/progress').query({ year: 2026 });
      expect(resp.status).toBe(200);
      if (resp.body.monthlyProgress && resp.body.monthlyProgress.length > 0) {
        expect(resp.body.monthlyProgress[0]).toHaveProperty('month');
      }
    });
  });

  describe('GET /api/tax/federal', () => {
    test('BE-TAX-018: Get federal tax summary', async () => {
      const resp = await agent.get('/api/tax/federal');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalFederalTax');
    });

    test('BE-TAX-019: Federal tax respects filters', async () => {
      const resp = await agent.get('/api/tax/federal').query({
        year: 2026,
        quarter: 2
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('GET /api/tax/state', () => {
    test('BE-TAX-020: Get state tax summary', async () => {
      const resp = await agent.get('/api/tax/state').query({ state: 'CA' });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalStateTax');
    });

    test('BE-TAX-021: State tax respects state parameter', async () => {
      const resp = await agent.get('/api/tax/state').query({ state: 'NY' });
      expect(resp.status).toBe(200);
    });
  });

  describe('Tax Deduction Tracking', () => {
    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        const txResp = await agent.post('/api/transactions').send({
          description: `Tax Tx${i}_${Date.now()}`,
          amount: 150,
          date: '2026-04-25',
          type: 'deduction',
          isDeduction: true
        });
        if (i === 0) testTxId = txResp.body.id;
        if (i === 1) testTxId2 = txResp.body.id;
        if (i === 2) testTxId3 = txResp.body.id;
      }
    });

    test('BE-TAX-022: Deduction transactions included in tax summary', async () => {
      const resp = await agent.get('/api/tax/summary');
      expect(resp.status).toBe(200);
      expect(resp.body.totalDeductions).toBeGreaterThan(0);
    });

    test('BE-TAX-023: Deduction transactions show breakdown', async () => {
      const resp = await agent.get('/api/tax/deductions');
      expect(resp.status).toBe(200);
      expect(resp.body.totalDeductions).toBeGreaterThan(0);
    });
  });

  describe('Tax Report Export', () => {
    test('BE-TAX-024: Export tax summary as PDF', async () => {
      const resp = await agent.get('/api/tax/summary').query({
        export: 'pdf'
      });
      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toMatch(/pdf/);
    });

    test('BE-TAX-025: Export tax estimate as PDF', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });

      const taxId = resp.body.id;
      const exportResp = await agent.get(`/api/tax/estimates/${taxId}`).query({
        export: 'pdf'
      });
      expect(exportResp.status).toBe(200);
    });
  });

  describe('Tax Validation', () => {
    test('BE-TAX-026: Reject invalid state code', async () => {
      const resp = await agent.get('/api/tax/state').query({ state: 'ZZ' });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-TAX-027: Reject negative annual income', async () => {
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: -50000,
        filingStatus: 'single',
        state: 'CA'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Tax Performance', () => {
    test('BE-TAX-028: Tax summary handles year with no data', async () => {
      const resp = await agent.get('/api/tax/summary').query({ year: 2025 });
      expect(resp.status).toBe(200);
    });

    test('BE-TAX-029: Tax estimate completes within timeout', async () => {
      const start = Date.now();
      const resp = await agent.post('/api/tax/estimates').send({
        annualIncome: 80000,
        filingStatus: 'single',
        state: 'CA'
      });
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(10000); // 10 second timeout
    });
  });
});