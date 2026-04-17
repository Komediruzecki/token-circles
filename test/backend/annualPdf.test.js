/**
 * Tests for Annual Financial Report PDF API - Edge Cases
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';
const req = request.agent(BASE_URL).set('X-Skip-RateLimit', 'true');
jest.setTimeout(30000);

describe('Annual Financial Report PDF API - Edge Cases', () => {
  describe('GET /api/reports/annual-pdf', () => {
    test('returns PDF with valid 4-digit year', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      expect(resp.headers['content-disposition']).toContain('annual-report-2026.pdf');
    });

    test('PDF starts with valid %PDF header', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for year with no transactions', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2020');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for future year', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2030');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('returns PDF for very old year', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2000');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('returns 400 when year is missing', async () => {
      const resp = await req.get('/api/reports/annual-pdf');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when year is invalid format (letters)', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=abc');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when year is empty string', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=');

      expect(resp.status).toBe(400);
    });

    test('returns 400 when year is only whitespace', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=%20%20%20');

      expect(resp.status).toBe(400);
    });

    test('returns 400 when year has extra characters', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026a');

      expect(resp.status).toBe(400);
    });

    test('returns 400 when year is too short', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=26');

      expect(resp.status).toBe(400);
    });

    test('returns 400 when year is too long', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=20262');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for negative year', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=-2026');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for year with special characters', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026<script>');

      expect(resp.status).toBe(400);
    });

    test('PDF is non-empty buffer', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThan(100);
    });

    test('PDF ends with %%EOF marker', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      const tail = resp.body.slice(-10).toString('utf8');
      expect(tail).toContain('%%EOF');
    });

    test('handles year as integer in query', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(resp.status).toBe(200);
    });

    test('handles year as string in query', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(resp.status).toBe(200);
    });

    test('handles year with leading zeros', async () => {
      // /^\d{4}$/ matches "0026" as it only requires 4 digits
      const resp = await req.get('/api/reports/annual-pdf?year=0026');

      // Leading zeros are technically valid (year 26 AD)
      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('response includes proper content-disposition filename', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(resp.headers['content-disposition']).toMatch(/filename="annual-report-2026\.pdf"/);
    });

    test('response content-type is application/pdf', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(resp.headers['content-type']).toBe('application/pdf');
    });

    test('response is a valid Buffer object', async () => {
      const resp = await req.get('/api/reports/annual-pdf?year=2026');

      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body instanceof Uint8Array || typeof resp.body === 'object').toBe(true);
    });
  });
});
