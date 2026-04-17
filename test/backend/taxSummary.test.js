/**
 * Tests for Year-End Tax Summary API
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';
const req = request.agent(BASE_URL).set('X-Skip-RateLimit', 'true');

describe('Year-End Tax Summary API', () => {
  beforeAll(async () => {
    await request(BASE_URL).post('/api/test/reset-rate-limit')
      .set('X-Skip-RateLimit', 'true');
  });

  describe('GET /api/reports/tax-summary', () => {
    test('returns JSON with correct structure for a valid year', async () => {
      const resp = await req.get('/api/reports/tax-summary?year=2026');

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('year', 2026);
      expect(resp.body).toHaveProperty('taxDeductibleTotal');
      expect(resp.body).toHaveProperty('nonDeductibleTotal');
      expect(resp.body).toHaveProperty('totalExpenses');
      expect(resp.body).toHaveProperty('taxDeductibleCategories');
      expect(resp.body).toHaveProperty('nonDeductibleCategories');
      expect(resp.body).toHaveProperty('transactionCount');
      expect(typeof resp.body.taxDeductibleTotal).toBe('number');
      expect(typeof resp.body.nonDeductibleTotal).toBe('number');
      expect(typeof resp.body.totalExpenses).toBe('number');
      expect(resp.body.taxDeductibleTotal + resp.body.nonDeductibleTotal).toBeCloseTo(resp.body.totalExpenses, 2);
    });

    test('returns 400 when year is missing', async () => {
      const resp = await req.get('/api/reports/tax-summary');
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when year param is empty', async () => {
      const resp = await req.get('/api/reports/tax-summary?year=');
      expect(resp.status).toBe(400);
    });

    test('returns valid response for a year with no transactions', async () => {
      const resp = await req.get('/api/reports/tax-summary?year=2020');

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('year', 2020);
      expect(resp.body.taxDeductibleTotal).toBe(0);
      expect(resp.body.nonDeductibleTotal).toBe(0);
      expect(resp.body.totalExpenses).toBe(0);
      expect(resp.body.transactionCount).toBe(0);
    });
  });

  describe('GET /api/reports/tax-summary-pdf', () => {
    test('returns PDF content-type with attachment disposition', async () => {
      const resp = await req.get('/api/reports/tax-summary-pdf?year=2026');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      expect(resp.headers['content-disposition']).toContain('attachment');
      expect(resp.headers['content-disposition']).toContain('tax-summary-2026.pdf');
      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThan(0);
    });

    test('PDF starts with valid PDF header', async () => {
      const resp = await req.get('/api/reports/tax-summary-pdf?year=2026');

      expect(resp.status).toBe(200);
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns 400 when year is missing', async () => {
      const resp = await req.get('/api/reports/tax-summary-pdf');
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/categories/:id - tax_deductible field', () => {
    test('can update category tax_deductible to true', async () => {
      // First create a category
      const create = await req.post('/api/categories')
        .send({ name: 'TestTaxCategory', color: '#ef4444', type: 'expense' });

      expect(create.status).toBe(200);
      const catId = create.body.id;

      // Update with tax_deductible = true
      const update = await req.put(`/api/categories/${catId}`)
        .send({ name: 'TestTaxCategory', color: '#ef4444', type: 'expense', tax_deductible: true });

      expect(update.status).toBe(200);

      // Verify it was saved
      const get = await req.get('/api/categories');
      const updated = get.body.find(c => c.id === catId);
      expect(updated.tax_deductible).toBe(1);
    });

    test('can update category tax_deductible to false', async () => {
      // Create and update back to false
      const create = await req.post('/api/categories')
        .send({ name: 'TestTaxCategory2', color: '#f97316', type: 'expense', tax_deductible: true });

      const catId = create.body.id;

      const update = await req.put(`/api/categories/${catId}`)
        .send({ name: 'TestTaxCategory2', color: '#f97316', type: 'expense', tax_deductible: false });

      expect(update.status).toBe(200);

      const get = await req.get('/api/categories');
      const updated = get.body.find(c => c.id === catId);
      expect(updated.tax_deductible).toBe(0);
    });
  });
});
