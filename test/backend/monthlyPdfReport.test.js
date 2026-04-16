/**
 * Tests for Monthly PDF Report API endpoint
 */
const request = require('supertest');
const path = require('path');

const BASE_URL = 'http://localhost:3847';

describe('Monthly PDF Report API', () => {
  test('GET /api/reports/monthly-pdf returns PDF content-type', async () => {
    const resp = await request(BASE_URL)
      .get('/api/reports/monthly-pdf?year=2026&month=04');

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toContain('application/pdf');
    expect(resp.headers['content-disposition']).toContain('attachment');
    expect(resp.headers['content-disposition']).toContain('report-2026-04.pdf');
    expect(Buffer.isBuffer(resp.body)).toBe(true);
    expect(resp.body.length).toBeGreaterThan(0);
  });

  test('GET /api/reports/monthly-pdf requires year and month params', async () => {
    const resp = await request(BASE_URL).get('/api/reports/monthly-pdf');
    expect(resp.status).toBe(400);
    expect(resp.body).toHaveProperty('error');
  });

  test('GET /api/reports/monthly-pdf without year returns 400', async () => {
    const resp = await request(BASE_URL).get('/api/reports/monthly-pdf?month=04');
    expect(resp.status).toBe(400);
  });

  test('GET /api/reports/monthly-pdf without month returns 400', async () => {
    const resp = await request(BASE_URL).get('/api/reports/monthly-pdf?year=2026');
    expect(resp.status).toBe(400);
  });

  test('PDF response is a valid non-empty buffer', async () => {
    const resp = await request(BASE_URL)
      .get('/api/reports/monthly-pdf?year=2026&month=04');

    expect(resp.status).toBe(200);
    // PDF files start with %PDF
    const header = resp.body.slice(0, 4).toString('utf8');
    expect(header).toBe('%PDF');
  });

  test('GET /api/reports/monthly-pdf for empty month returns valid PDF with zeros', async () => {
    const resp = await request(BASE_URL)
      .get('/api/reports/monthly-pdf?year=2025&month=01');

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(resp.body)).toBe(true);
    // Still valid PDF even with no data
    const header = resp.body.slice(0, 4).toString('utf8');
    expect(header).toBe('%PDF');
  });
});
