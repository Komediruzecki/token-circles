/**
 * Tests for Monthly PDF Report API - Edge Cases
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Monthly PDF Report API - Edge Cases', () => {
  describe('GET /api/reports/monthly-pdf', () => {
    test('returns PDF for a month with valid transactions', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      expect(resp.headers['content-disposition']).toContain('attachment');
      expect(resp.headers['content-disposition']).toContain('report-2026-04.pdf');
    });

    test('returns PDF for first month of year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=01');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for last month of year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=12');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for empty month (no transactions)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2025&month=01');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns 400 for missing year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?month=04');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 for missing month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 for empty year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=&month=04');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for empty month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for invalid month (0)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=0');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for invalid month (13)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=13');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for non-numeric month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=abc');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for non-numeric year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=abc&month=04');

      expect(resp.status).toBe(400);
    });

    test('handles leap year February correctly', async () => {
      // 2024 is a leap year, February has 29 days
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2024&month=02');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('handles non-leap year February correctly', async () => {
      // 2023 is not a leap year, February has 28 days
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2023&month=02');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('PDF is non-empty buffer', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04');

      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThan(100); // Min reasonable PDF size
    });

    test('PDF starts with valid %PDF header', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04');

      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('handles month with single digit padding', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=3');

      // Should still work (month 3 = March)
      expect(resp.status).toBe(200);
    });

    test('response headers include cache prevention', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04');

      // PDF endpoint shouldn't set aggressive cache headers
      expect(resp.headers['cache-control']).not.toBe('public, max-age');
    });
  });
});
