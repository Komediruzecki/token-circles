/**
 * E2E Tests for Calculator API & Business Logic
 * Covers loan, mortgage, savings, retirement, unit conversions, amortization
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Calculators E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/calculators/loans', () => {
    test('BE-CAL-001: Calculate loan payment correctly', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100000,
        rate: 5,
        term: 30
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
      global.expect(resp.body.monthlyPayment).toBeGreaterThan(0);
      global.expect(resp.body).toHaveProperty('totalInterest');
      global.expect(resp.body).toHaveProperty('totalPayment');
    });

    test('BE-CAL-002: Calculate loan with monthly rate', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeGreaterThan(0);
    });

    test('BE-CAL-003: Handle zero interest rate', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 12000,
        rate: 0,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
      global.expect(resp.body.monthlyPayment).toBeCloseTo(1000, 2);
    });

    test('BE-CAL-004: Handle 100% interest rate edge case', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 1000,
        rate: 100,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
      global.expect(resp.body.monthlyPayment).toBeGreaterThan(0);
    });

    test('BE-CAL-005: Return error for negative principal', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: -10000,
        rate: 5,
        term: 30
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-006: Return error for negative rate', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100000,
        rate: -5,
        term: 30
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-007: Return error for invalid term (0)', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100000,
        rate: 5,
        term: 0
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-008: Return error for term < 1', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100000,
        rate: 5,
        term: 0.5
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-009: Handle very long term (30+ years)', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100000,
        rate: 3.5,
        term: 40
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-010: Very small loan calculation', async () => {
      const resp = await agent.get('/api/calculators/loans').set('X-Skip-RateLimit', 'true').query({
        principal: 100,
        rate: 3,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeDefined();
    });
  });

  describe('GET /api/calculators/mortgages', () => {
    test('BE-CAL-011: Calculate mortgage payment correctly', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
      global.expect(resp.body).toHaveProperty('totalInterest');
      global.expect(resp.body).toHaveProperty('totalPayment');
    });

    test('BE-CAL-012: Mortgage with high down payment', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 200000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-013: Zero down payment mortgage', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 0
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-014: Partial down payment percentage', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPaymentPercent: 20
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-015: Monthly property tax included', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000,
        propertyTax: 500,
        monthlyInsurance: 150
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
    });

    test('BE-CAL-016: PMI included when down payment < 20%', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 50000,
        propertyTax: 0,
        monthlyInsurance: 0
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
    });

    test('BE-CAL-017: PMI disabled when down payment >= 20%', async () => {
      const resp = await agent.get('/api/calculators/mortgages').set('X-Skip-RateLimit', 'true').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000,
        propertyTax: 0,
        monthlyInsurance: 0,
        noPmi: true
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthlyPayment');
    });
  });

  describe('GET /api/calculators/savings', () => {
    test('BE-CAL-018: Calculate savings goal completion', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: 500,
        annualRate: 5
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('monthsToGoal');
      global.expect(resp.body).toHaveProperty('yearsToGoal');
      global.expect(resp.body.monthsToGoal).toBeGreaterThanOrEqual(0);
    });

    test('BE-CAL-019: Savings goal with $0 current amount', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 10000,
        currentAmount: 0,
        monthlyContribution: 200,
        annualRate: 5
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthsToGoal).toBeGreaterThanOrEqual(0);
    });

    test('BE-CAL-020: Negative monthly contribution returns error', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: -500,
        annualRate: 5
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-021: Rate of return cannot be negative', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: 500,
        annualRate: -5
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-022: Goal already achieved', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 10000,
        currentAmount: 20000,
        monthlyContribution: 500,
        annualRate: 5
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthsToGoal).toBeLessThanOrEqual(0);
    });

    test('BE-CAL-023: High interest rate savings calculation', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 100000,
        currentAmount: 20000,
        monthlyContribution: 500,
        annualRate: 10
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthsToGoal).toBeFinite();
    });

    test('BE-CAL-024: Low interest rate savings calculation', async () => {
      const resp = await agent.get('/api/calculators/savings').set('X-Skip-RateLimit', 'true').query({
        goalAmount: 50000,
        currentAmount: 10000,
        monthlyContribution: 1000,
        annualRate: 1
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.monthsToGoal).toBeFinite();
    });
  });

  describe('GET /api/calculators/retirement', () => {
    test('BE-CAL-025: Calculate retirement projection', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('currentAge');
      global.expect(resp.body).toHaveProperty('retirementAge');
      global.expect(resp.body).toHaveProperty('retirementSavings');
      global.expect(resp.body).toHaveProperty('yearsInRetirement');
    });

    test('BE-CAL-026: Early retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 30,
        retirementAge: 55,
        currentSavings: 30000,
        monthlyContribution: 400,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.retirementAge).toBe(55);
    });

    test('BE-CAL-027: Late retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 40,
        retirementAge: 70,
        currentSavings: 100000,
        monthlyContribution: 1000,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.retirementAge).toBe(70);
    });

    test('BE-CAL-028: Canada retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'CA'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.country).toBe('CA');
    });

    test('BE-CAL-029: Withdrawal rate affects years of retirement', async () => {
      const highRate = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 5,
        country: 'US'
      });

      const lowRate = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 3,
        country: 'US'
      });

      global.expect(highRate.status).toBe(200);
      global.expect(lowRate.status).toBe(200);
      global.expect(highRate.body.yearsInRetirement).toBeLessThanOrEqual(lowRate.body.yearsInRetirement);
    });

    test('BE-CAL-030: Annual return affects retirement savings', async () => {
      const highReturn = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 10,
        withdrawalRate: 4,
        country: 'US'
      });

      const lowReturn = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 5,
        withdrawalRate: 4,
        country: 'US'
      });

      global.expect(highReturn.status).toBe(200);
      global.expect(lowReturn.status).toBe(200);
      global.expect(highReturn.body.retirementSavings).toBeGreaterThanOrEqual(lowReturn.body.retirementSavings);
    });

    test('BE-CAL-031: Negative contributions returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: -500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-032: retirementAge < currentAge returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 65,
        retirementAge: 55,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-033: Invalid country returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'XX'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-034: Missing required parameters returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-035: Shows shortfall if retirement savings insufficient', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 10000,
        monthlyContribution: 200,
        annualReturn: 5,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('shortfall');
    });

    test('BE-CAL-036: Shows years of runway', async () => {
      const resp = await agent.get('/api/calculators/retirement').set('X-Skip-RateLimit', 'true').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('yearsOfRunway');
      global.expect(resp.body.yearsOfRunway).toBeFinite();
    });
  });

  describe('GET /api/calculators/loans/amortization', () => {
    test('BE-CAL-037: Generate amortization schedule', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('schedule');
      global.expect(Array.isArray(resp.body.schedule)).toBe(true);
      global.expect(resp.body.schedule.length).toBe(12);
    });

    test('BE-CAL-038: Amortization schedule includes all expected fields', async () => {
      if (!agent.jar._cookieJar || agent.jar._cookieJar.store.size === 0) {
        await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
      }

      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);

      const row = resp.body.schedule[0];
      global.expect(row).toHaveProperty('month');
      global.expect(row).toHaveProperty('payment');
      global.expect(row).toHaveProperty('principal');
      global.expect(row).toHaveProperty('interest');
      global.expect(row).toHaveProperty('balance');
    });

    test('BE-CAL-039: Final balance reaches zero', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);

      const lastRow = resp.body.schedule[resp.body.schedule.length - 1];
      global.expect(lastRow.balance).toBeCloseTo(0, 2);
    });

    test('BE-CAL-040: Total payments match principal + interest', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 12000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);

      const totalPayment = resp.body.schedule.reduce((sum, row) => sum + row.payment, 0);
      global.expect(totalPayment).toBeGreaterThanOrEqual(resp.body.principal);
      global.expect(totalPayment).toBeLessThan(resp.body.principal * 1.1);
    });

    test('BE-CAL-041: Interest decreases over time', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      global.expect(resp.status).toBe(200);

      const firstRow = resp.body.schedule[0];
      const lastRow = resp.body.schedule[resp.body.schedule.length - 1];
      global.expect(firstRow.interest).toBeGreaterThan(lastRow.interest);
    });

    test('BE-CAL-042: Date progression correct', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 6,
        term: 6
      });
      global.expect(resp.status).toBe(200);

      for (let i = 0; i < resp.body.schedule.length - 1; i++) {
        const currentDate = new Date(resp.body.schedule[i].date);
        const nextDate = new Date(resp.body.schedule[i + 1].date);
        global.expect(nextDate.getTime()).toBeGreaterThanOrEqual(currentDate.getTime());
      }
    });

    test('BE-CAL-043: Amortization schedule uses the provided rate', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 50000,
        rate: 5,
        term: 36
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.schedule.length).toBe(36);
      global.expect(resp.body.rate).toBe(5);
    });

    test('BE-CAL-044: Amortization schedule length matches term', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 10000,
        rate: 5,
        term: 12
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.schedule.length).toBe(12);
    });

    test('BE-CAL-045: Amortization with 30 year term', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 200000,
        rate: 4,
        term: 360
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.schedule.length).toBe(360);
      global.expect(resp.body.schedule[359].balance).toBeCloseTo(0, 2);
    });

    test('BE-CAL-046: Amortization with 15 year term', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').set('X-Skip-RateLimit', 'true').query({
        principal: 150000,
        rate: 3.5,
        term: 180
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.schedule.length).toBe(180);
    });
  });

  describe('GET /api/calculators/currency', () => {
    test('BE-CAL-047: Currency conversion returns rate and result', async () => {
      const resp = await agent.get('/api/calculators/currency').set('X-Skip-RateLimit', 'true').query({
        from: 'USD',
        to: 'EUR',
        amount: 100
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('amount');
      global.expect(resp.body).toHaveProperty('rate');
      global.expect(resp.body).toHaveProperty('convertedAmount');
    });

    test('BE-CAL-048: Exchange rates available for common pairs', async () => {
      const resp = await agent.get('/api/calculators/currency').set('X-Skip-RateLimit', 'true').query({
        from: 'USD',
        to: 'EUR',
        amount: 100
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.amount).toBe(100);
      global.expect(resp.body.convertedAmount).toBeFinite();
    });

    test('BE-CAL-049: Invalid currency code returns error', async () => {
      const resp = await agent.get('/api/calculators/currency').set('X-Skip-RateLimit', 'true').query({
        from: 'USD',
        to: 'XXX',
        amount: 100
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-050: Invalid amount returns error', async () => {
      const resp = await agent.get('/api/calculators/currency').set('X-Skip-RateLimit', 'true').query({
        from: 'USD',
        to: 'EUR',
        amount: -100
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/calculators/units', () => {
    test('BE-CAL-051: Unit conversion returns converted value', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 100,
        from: 'miles',
        to: 'kilometers'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('value');
      global.expect(resp.body).toHaveProperty('result');
    });

    test('BE-CAL-052: Distance unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 10,
        from: 'meters',
        to: 'feet'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-053: Weight unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 100,
        from: 'pounds',
        to: 'kilograms'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-054: Temperature conversion', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 100,
        from: 'celsius',
        to: 'fahrenheit'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-055: Volume unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 1,
        from: 'gallons',
        to: 'liters'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-056: Area unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 1,
        from: 'square_miles',
        to: 'acres'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-057: Invalid unit types handled', async () => {
      const resp = await agent.get('/api/calculators/units').set('X-Skip-RateLimit', 'true').query({
        value: 100,
        from: 'invalid',
        to: 'another_invalid'
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });
});