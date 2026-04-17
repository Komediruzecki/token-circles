/**
 * Tests for Retirement Calculator API endpoint
 */
const request = require('supertest');

// Test against the actual server
const BASE_URL = 'http://localhost:3847';

describe('Retirement Calculator API', () => {
  beforeAll(async () => {
    // Reset rate limit store so we don't get 429s from prior test files
    await request(BASE_URL).post('/api/test/reset-rate-limit')
      .set('X-Skip-RateLimit', 'true');
  });

  test('POST /api/calculator/retire returns required fields', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 1000,
        annualExpenses: 30000
      });

    expect(resp.status).toBe(200);
    const body = resp.body;

    // Check all required fields exist
    expect(body).toHaveProperty('fireNumber');
    expect(body).toHaveProperty('fireAge');
    expect(body).toHaveProperty('fireMonth');
    expect(body).toHaveProperty('monthsToFire');
    expect(body).toHaveProperty('currentNWAtFire');
    expect(body).toHaveProperty('traditionalRetirementAge');
    expect(body).toHaveProperty('savingsAtRetirement');
    expect(body).toHaveProperty('timeline');
    expect(body).toHaveProperty('withdrawalTimeline');
    expect(body).toHaveProperty('scenarios');
    expect(body).toHaveProperty('inputs');
  });

  test('POST /api/calculator/retire calculates correct FIRE number', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 0,
        monthlyContribution: 0,
        annualExpenses: 30000,
        withdrawalRate: 4 // 4% = 25x expenses
      });

    expect(resp.status).toBe(200);
    // 30000 / 0.04 = 750000
    expect(resp.body.fireNumber).toBe(750000);
  });

  test('POST /api/calculator/retire scenarios have reached/savingsAtFire/shortfall', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 1000
      });

    expect(resp.status).toBe(200);
    const scenarios = resp.body.scenarios;

    expect(scenarios).toHaveLength(3);

    // Each scenario should have reached, savingsAtFire, shortfall
    scenarios.forEach(s => {
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('return');
      expect(s).toHaveProperty('fireNumber');
      expect(s).toHaveProperty('fireAge');
      expect(s).toHaveProperty('reached');
      expect(s).toHaveProperty('savingsAtFire');
      expect(s).toHaveProperty('shortfall');
      expect(typeof s.reached).toBe('boolean');
      expect(typeof s.savingsAtFire).toBe('number');
      expect(typeof s.shortfall).toBe('number');
    });
  });

  test('POST /api/calculator/retire handles country cost-of-living adjustment', async () => {
    // Croatia has 0.6x cost of living, so 30000 * 0.6 = 18000 expenses
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 0,
        monthlyContribution: 0,
        annualExpenses: 30000,
        country: 'croatia'
      });

    expect(resp.status).toBe(200);
    // 18000 / 0.04 = 450000
    expect(resp.body.fireNumber).toBe(450000);
  });

  test('POST /api/calculator/retire timeline contains year/age/savings', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 1000
      });

    expect(resp.status).toBe(200);
    const timeline = resp.body.timeline;

    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.length).toBeGreaterThan(0);

    // Check timeline entries have required fields
    timeline.forEach(t => {
      expect(t).toHaveProperty('year');
      expect(t).toHaveProperty('age');
      expect(t).toHaveProperty('savings');
    });
  });

  test('POST /api/calculator/retire withdrawalTimeline has balance field', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({
        currentAge: 30,
        retirementAge: 65,
        currentSavings: 100000,
        monthlyContribution: 2000
      });

    expect(resp.status).toBe(200);
    const withdrawal = resp.body.withdrawalTimeline;

    expect(Array.isArray(withdrawal)).toBe(true);

    if (withdrawal.length > 0) {
      withdrawal.forEach(w => {
        expect(w).toHaveProperty('year');
        expect(w).toHaveProperty('savings');
        expect(w).toHaveProperty('balance');
      });
    }
  });

  test('POST /api/calculator/retire with defaults does not error', async () => {
    const resp = await request(BASE_URL)
      .post('/api/calculator/retire')
      .set('X-Skip-RateLimit', 'true')
      .send({});

    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty('fireNumber');
    expect(resp.body).toHaveProperty('scenarios');
  });
});
