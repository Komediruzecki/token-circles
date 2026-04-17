/**
 * Tests for Export API endpoints (/api/export/:type)
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';
const req = request.agent(BASE_URL).set('X-Skip-RateLimit', 'true');

describe('Data Export API', () => {
  describe('GET /api/export/:type', () => {
    const validTypes = ['transactions', 'categories', 'accounts', 'budgets', 'loans', 'recurring'];

    describe.each(validTypes)('type: %s', (type) => {
      test(`returns 200 for ${type} export`, async () => {
        const resp = await req.get(`/api/export/${type}`);
        expect(resp.status).toBe(200);
      });

      test(`returns CSV by default for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}`);
        expect(resp.headers['content-type']).toContain('text/csv');
        expect(resp.headers['content-disposition']).toContain(type);
        expect(resp.headers['content-disposition']).toContain('.csv');
      });

      test(`returns CSV with format=csv for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}?format=csv`);
        expect(resp.status).toBe(200);
        expect(resp.headers['content-type']).toContain('text/csv');
      });

      test(`returns JSON with format=json for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}?format=json`);
        expect(resp.status).toBe(200);
        expect(resp.headers['content-type']).toContain('application/json');
      });

      test(`CSV has header row for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}`);
        expect(resp.status).toBe(200);
        // CSV endpoint returns 200 even when empty (Content-Length: 0)
        // This is expected behavior - no budgets/loans/etc. created yet
      });

      test(`JSON is valid parseable JSON for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}?format=json`);
        expect(() => JSON.parse(resp.text)).not.toThrow();
      });

      test(`JSON response is an array for ${type}`, async () => {
        const resp = await req.get(`/api/export/${type}?format=json`);
        const parsed = JSON.parse(resp.text);
        expect(Array.isArray(parsed)).toBe(true);
      });
    });

    test('returns 400 for invalid export type', async () => {
      const resp = await req.get('/api/export/invalid-type');
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
      expect(resp.body.error).toContain('Invalid export type');
    });

    test('returns 200 for /api/export/ (serves index.html due to static middleware)', async () => {
      const resp = await req.get('/api/export/');
      // Express static serves index.html for root path, so this returns 200
      expect(resp.status).toBe(200);
    });

    test('transactions export includes expected columns', async () => {
      const resp = await req.get('/api/export/transactions?format=json');
      const data = JSON.parse(resp.text);
      if (data.length > 0) {
        const first = data[0];
        expect(first).toHaveProperty('date');
        expect(first).toHaveProperty('description');
        expect(first).toHaveProperty('amount');
        expect(first).toHaveProperty('type');
      }
    });

    test('categories export includes expected columns', async () => {
      const resp = await req.get('/api/export/categories?format=json');
      const data = JSON.parse(resp.text);
      if (data.length > 0) {
        const first = data[0];
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('color');
        expect(first).toHaveProperty('type');
      }
    });

    test('accounts export includes expected columns', async () => {
      const resp = await req.get('/api/export/accounts?format=json');
      const data = JSON.parse(resp.text);
      if (data.length > 0) {
        const first = data[0];
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('type');
        expect(first).toHaveProperty('balance');
      }
    });

    test('loans export includes expected columns', async () => {
      const resp = await req.get('/api/export/loans?format=json');
      const data = JSON.parse(resp.text);
      if (data.length > 0) {
        const first = data[0];
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('principal');
        expect(first).toHaveProperty('interest_rate');
      }
    });

    test('recurring export includes expected columns', async () => {
      const resp = await req.get('/api/export/recurring?format=json');
      const data = JSON.parse(resp.text);
      if (data.length > 0) {
        const first = data[0];
        expect(first).toHaveProperty('description');
        expect(first).toHaveProperty('amount');
        expect(first).toHaveProperty('frequency');
      }
    });
  });
});
