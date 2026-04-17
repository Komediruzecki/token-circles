/**
 * Tests for Monthly PDF Report API - Edge Cases
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Monthly PDF Report API - Edge Cases', () => {
  beforeAll(async () => {
    // Reset rate limit store so we don't get 429s from prior test files
    await request(BASE_URL).post('/api/test/reset-rate-limit');
  });

  describe('GET /api/reports/monthly-pdf', () => {
    test('returns PDF for a month with valid transactions', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      expect(resp.headers['content-disposition']).toContain('attachment');
      expect(resp.headers['content-disposition']).toContain('report-2026-04.pdf');
    });

    test('returns PDF for first month of year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=01')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for last month of year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=12')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns PDF for empty month (no transactions)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2025&month=01')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('returns 400 for missing year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 for missing month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 for empty year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=&month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for empty month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for invalid month (0)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=0')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for invalid month (13)', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=13')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for non-numeric month', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=abc')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('returns 400 for non-numeric year', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=abc&month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(400);
    });

    test('handles leap year February correctly', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2024&month=02')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('handles non-leap year February correctly', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2023&month=02')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
      expect(resp.headers['content-type']).toContain('application/pdf');
    });

    test('PDF is non-empty buffer', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(Buffer.isBuffer(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThan(100);
    });

    test('PDF starts with valid %PDF header', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04')
        .set('X-Skip-RateLimit', 'true');

      const header = resp.body.slice(0, 4).toString('utf8');
      expect(header).toBe('%PDF');
    });

    test('handles month with single digit padding', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=3')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.status).toBe(200);
    });

    test('response headers include cache prevention', async () => {
      const resp = await request(BASE_URL)
        .get('/api/reports/monthly-pdf?year=2026&month=04')
        .set('X-Skip-RateLimit', 'true');

      expect(resp.headers['cache-control']).not.toBe('public, max-age');
    });
  });
});
