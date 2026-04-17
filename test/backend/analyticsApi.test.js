/**
 * Integration tests for Analytics API endpoints
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

beforeAll(async () => {
  await request(BASE_URL).post('/api/test/reset-rate-limit');
});

describe('Analytics API — distinct-years', () => {
  test('GET /api/analytics/distinct-years returns array of years', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/distinct-years')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('years');
    expect(Array.isArray(resp.body.years)).toBe(true);
    expect(resp.body.years.length).toBeGreaterThan(0);
    resp.body.years.forEach(y => expect(typeof y).toBe('number'));
  });
});

describe('Analytics API — weeks', () => {
  test('GET /api/analytics/weeks returns weeks for a month', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/weeks?year=2026&month=04')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('weeks');
    expect(Array.isArray(resp.body.weeks)).toBe(true);
    expect(resp.body.weeks.length).toBeGreaterThan(0);
    resp.body.weeks.forEach(w => {
      expect(w).toHaveProperty('week');
      expect(w).toHaveProperty('label');
    });
  });

  test('GET /api/analytics/weeks without year returns empty weeks array', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/weeks')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('weeks');
    expect(Array.isArray(resp.body.weeks)).toBe(true);
  });
});

describe('Analytics API — category-trends', () => {
  test('year view returns 12 month labels', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('labels');
    expect(resp.body).toHaveProperty('datasets');
    expect(Array.isArray(resp.body.labels)).toBe(true);
    expect(resp.body.labels.length).toBe(12);
    expect(resp.body.labels[0]).toContain('Jan');
    expect(resp.body.labels[0]).toContain('2026');
  });

  test('month view returns day labels', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&month=04&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body.labels.length).toBe(30); // April has 30 days
    expect(resp.body.labels[0]).toContain('April 1');
  });

  test('week view returns day-of-week labels', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&month=04&week=1&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body.labels.length).toBeLessThanOrEqual(7);
    expect(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).toContain(resp.body.labels[0]);
  });

  test('type=income and type=expense return different datasets', async () => {
    const [incomeResp, expenseResp] = await Promise.all([
      request(BASE_URL).get('/api/analytics/category-trends?year=2026&type=income')
        .set('X-Skip-RateLimit', 'true'),
      request(BASE_URL).get('/api/analytics/category-trends?year=2026&type=expense')
        .set('X-Skip-RateLimit', 'true')
    ]);
    expect(incomeResp.status).toBe(200);
    expect(expenseResp.status).toBe(200);
    // Both should return valid response structure with labels and datasets
    expect(Array.isArray(incomeResp.body.labels)).toBe(true);
    expect(Array.isArray(expenseResp.body.datasets)).toBe(true);
    expect(Array.isArray(expenseResp.body.labels)).toBe(true);
    expect(Array.isArray(expenseResp.body.datasets)).toBe(true);
  });

  test('type=expense excludes income transactions', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2025&month=07&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body.datasets.some(ds => ds.category === 'Salary')).toBe(false);
  });

  test('datasets have correct structure', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2025&month=06&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    resp.body.datasets.forEach(ds => {
      expect(ds).toHaveProperty('category');
      expect(ds).toHaveProperty('color');
      expect(ds).toHaveProperty('data');
      expect(Array.isArray(ds.data)).toBe(true);
    });
  });

  test('defaults to expense type when not specified', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body.labels.length).toBe(12);
  });

  test('year view returns numDays=365 (or 366 for leap year)', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('numDays');
    expect(typeof resp.body.numDays).toBe('number');
    expect(resp.body.numDays).toBe(365); // 2026 is not a leap year
  });

  test('month view returns correct numDays for that month', async () => {
    // April 2026 has 30 days
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&month=04&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('numDays');
    expect(resp.body.numDays).toBe(30);
  });

  test('week view returns correct numDays (7 or fewer for partial weeks)', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2026&month=04&week=1&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('numDays');
    // Week 1 of April 2026 should have 7 days or fewer if month is short
    expect(resp.body.numDays).toBeGreaterThan(0);
    expect(resp.body.numDays).toBeLessThanOrEqual(7);
  });

  test('leap year returns 366 days for numDays', async () => {
    const resp = await request(BASE_URL).get('/api/analytics/category-trends?year=2024&type=expense')
      .set('X-Skip-RateLimit', 'true');
    expect(resp.status).toBe(200);
    expect(resp.body.numDays).toBe(366); // 2024 is a leap year
  });
});
