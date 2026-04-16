/**
 * Tests for Year-End P&L Summary API
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Year-End P&L Summary API', () => {
  describe('GET /api/reports/pl-summary', () => {
    test('returns JSON with correct structure for a valid year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary?year=2026');

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('year', 2026);
      expect(resp.body).toHaveProperty('income');
      expect(resp.body).toHaveProperty('expenses');
      expect(resp.body).toHaveProperty('netSavings');
      expect(resp.body).toHaveProperty('savingsRate');
      expect(resp.body).toHaveProperty('transactionCount');
      expect(typeof resp.body.income.total).toBe('number');
      expect(typeof resp.body.expenses.total).toBe('number');
    });

    test('income and expenses totals match the sum of byCategory', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary?year=2026');

      const incomeSum = Object.values(resp.body.income.byCategory)
        .reduce((s, c) => s + c.total, 0);
      const expenseSum = Object.values(resp.body.expenses.byCategory)
        .reduce((s, c) => s + c.total, 0);

      expect(incomeSum).toBeCloseTo(resp.body.income.total, 2);
      expect(expenseSum).toBeCloseTo(resp.body.expenses.total, 2);
    });

    test('netSavings equals income minus expenses', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary?year=2026');

      expect(resp.body.netSavings).toBeCloseTo(
        resp.body.income.total - resp.body.expenses.total, 2
      );
    });

    test('savingsRate is calculated correctly', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary?year=2026');

      const income = resp.body.income.total;
      const expense = resp.body.expenses.total;
      const expected = income > 0
        ? parseFloat(((income - expense) / income * 100).toFixed(1))
        : 0;
      expect(resp.body.savingsRate).toBe(expected);
    });

    test('returns 400 when year is missing', async () => {
      const resp = await request(BASE_URL).get('/api/reports/pl-summary');
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when year param is empty', async () => {
      const resp = await request(BASE_URL).get('/api/reports/pl-summary?year=');
      expect(resp.status).toBe(400);
    });

    test('returns valid response for a year with no transactions', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary?year=2020');

      expect(resp.status).toBe(200);
      expect(resp.body.year).toBe(2020);
      expect(resp.body.income.total).toBe(0);
      expect(resp.body.expenses.total).toBe(0);
      expect(resp.body.netSavings).toBe(0);
      expect(resp.body.savingsRate).toBe(0);
      expect(resp.body.transactionCount).toBe(0);
    });
  });

  describe('GET /api/reports/pl-summary-pdf', () => {
    test('returns PDF content-type with attachment disposition', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary-pdf?year=2026');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      expect(resp.headers['content-disposition']).toContain('attachment');
      expect(resp.headers['content-disposition']).toContain('pl-summary-2026.pdf');
      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThan(0);
    });

    test('PDF starts with valid PDF header', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/pl-summary-pdf?year=2026');

      expect(resp.status).toBe(200);
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns 400 when year is missing', async () => {
      const resp = await request(BASE_URL).get('/api/reports/pl-summary-pdf');
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });
});
