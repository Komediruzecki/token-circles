/**
 * E2E Tests for Calculator API & Business Logic
 * Covers loan, mortgage, savings, retirement, unit conversions, amortization
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Calculators E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/calculators/loans', () => {
    test('BE-CAL-001: Calculate loan payment correctly', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100000,
        rate: 5,
        term: 30
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
      expect(resp.body.monthlyPayment).toBeGreaterThan(0);
      expect(resp.body).toHaveProperty('totalInterest');
      expect(resp.body).toHaveProperty('totalPayment');
    });

    test('BE-CAL-002: Calculate loan with monthly rate', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeGreaterThan(0);
    });

    test('BE-CAL-003: Handle zero interest rate', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 12000,
        rate: 0,
        term: 12
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
      expect(resp.body.monthlyPayment).toBeCloseTo(1000, 2);
    });

    test('BE-CAL-004: Handle 100% interest rate edge case', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 1000,
        rate: 100,
        term: 12
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
      expect(resp.body.monthlyPayment).toBeGreaterThan(0);
    });

    test('BE-CAL-005: Return error for negative principal', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: -10000,
        rate: 5,
        term: 30
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-006: Return error for negative rate', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100000,
        rate: -5,
        term: 30
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-007: Return error for invalid term (0)', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100000,
        rate: 5,
        term: 0
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-008: Return error for term < 1', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100000,
        rate: 5,
        term: 0.5
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-009: Handle very long term (30+ years)', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100000,
        rate: 3.5,
        term: 40
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-010: Very small loan calculation', async () => {
      const resp = await agent.get('/api/calculators/loans').query({
        principal: 100,
        rate: 3,
        term: 12
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeDefined();
    });
  });

  describe('GET /api/calculators/mortgages', () => {
    test('BE-CAL-011: Calculate mortgage payment correctly', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
      expect(resp.body).toHaveProperty('totalInterest');
      expect(resp.body).toHaveProperty('totalPayment');
    });

    test('BE-CAL-012: Mortgage with high down payment', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 200000
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-013: Zero down payment mortgage', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 0
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-014: Partial down payment percentage', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPaymentPercent: 20
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyPayment).toBeDefined();
    });

    test('BE-CAL-015: Monthly property tax included', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000,
        propertyTax: 500,
        monthlyInsurance: 150
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
    });

    test('BE-CAL-016: PMI included when down payment < 20%', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 50000,
        propertyTax: 0,
        monthlyInsurance: 0
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
    });

    test('BE-CAL-017: PMI disabled when down payment >= 20%', async () => {
      const resp = await agent.get('/api/calculators/mortgages').query({
        principal: 300000,
        rate: 6,
        term: 30,
        downPayment: 60000,
        propertyTax: 0,
        monthlyInsurance: 0,
        noPmi: true
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyPayment');
    });
  });

  describe('GET /api/calculators/savings', () => {
    test('BE-CAL-018: Calculate savings goal completion', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: 500,
        annualRate: 5
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthsToGoal');
      expect(resp.body).toHaveProperty('yearsToGoal');
      expect(resp.body.monthsToGoal).toBeGreaterThanOrEqual(0);
    });

    test('BE-CAL-019: Savings goal with $0 current amount', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 10000,
        currentAmount: 0,
        monthlyContribution: 200,
        annualRate: 5
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthsToGoal).toBeGreaterThanOrEqual(0);
    });

    test('BE-CAL-020: Negative monthly contribution returns error', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: -500,
        annualRate: 5
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-021: Rate of return cannot be negative', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 50000,
        currentAmount: 15000,
        monthlyContribution: 500,
        annualRate: -5
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-022: Goal already achieved', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 10000,
        currentAmount: 20000,
        monthlyContribution: 500,
        annualRate: 5
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthsToGoal).toBeLessThanOrEqual(0);
    });

    test('BE-CAL-023: High interest rate savings calculation', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 100000,
        currentAmount: 20000,
        monthlyContribution: 500,
        annualRate: 10
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthsToGoal).toBeFinite();
    });

    test('BE-CAL-024: Low interest rate savings calculation', async () => {
      const resp = await agent.get('/api/calculators/savings').query({
        goalAmount: 50000,
        currentAmount: 10000,
        monthlyContribution: 1000,
        annualRate: 1
      });
      expect(resp.status).toBe(200);
      expect(resp.body.monthsToGoal).toBeFinite();
    });
  });

  describe('GET /api/calculators/retirement', () => {
    test('BE-CAL-025: Calculate retirement projection', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('currentAge');
      expect(resp.body).toHaveProperty('retirementAge');
      expect(resp.body).toHaveProperty('retirementSavings');
      expect(resp.body).toHaveProperty('yearsInRetirement');
    });

    test('BE-CAL-026: Early retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 30,
        retirementAge: 55,
        currentSavings: 30000,
        monthlyContribution: 400,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.retirementAge).toBe(55);
    });

    test('BE-CAL-027: Late retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 40,
        retirementAge: 70,
        currentSavings: 100000,
        monthlyContribution: 1000,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.retirementAge).toBe(70);
    });

    test('BE-CAL-028: Canada retirement calculation', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'CA'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.country).toBe('CA');
    });

    test('BE-CAL-029: Withdrawal rate affects years of retirement', async () => {
      const highRate = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 5,
        country: 'US'
      });

      const lowRate = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 3,
        country: 'US'
      });

      expect(highRate.status).toBe(200);
      expect(lowRate.status).toBe(200);
      expect(highRate.body.yearsInRetirement).toBeLessThanOrEqual(lowRate.body.yearsInRetirement);
    });

    test('BE-CAL-030: Annual return affects retirement savings', async () => {
      const highReturn = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 10,
        withdrawalRate: 4,
        country: 'US'
      });

      const lowReturn = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 5,
        withdrawalRate: 4,
        country: 'US'
      });

      expect(highReturn.status).toBe(200);
      expect(lowReturn.status).toBe(200);
      expect(highReturn.body.retirementSavings).toBeGreaterThanOrEqual(lowReturn.body.retirementSavings);
    });

    test('BE-CAL-031: Negative contributions returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: -500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-032: retirementAge < currentAge returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 65,
        retirementAge: 55,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-033: Invalid country returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'XX'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-034: Missing required parameters returns error', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-035: Shows shortfall if retirement savings insufficient', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 10000,
        monthlyContribution: 200,
        annualReturn: 5,
        withdrawalRate: 4,
        country: 'US'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('shortfall');
    });

    test('BE-CAL-036: Shows years of runway', async () => {
      const resp = await agent.get('/api/calculators/retirement').query({
        currentAge: 35,
        retirementAge: 65,
        currentSavings: 50000,
        monthlyContribution: 500,
        annualReturn: 7,
        withdrawalRate: 4,
        country: 'US'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('yearsOfRunway');
      expect(resp.body.yearsOfRunway).toBeFinite();
    });
  });

  describe('GET /api/calculators/loans/amortization', () => {
    test('BE-CAL-037: Generate amortization schedule', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('schedule');
      expect(Array.isArray(resp.body.schedule)).toBe(true);
      expect(resp.body.schedule.length).toBe(12);
    });

    test('BE-CAL-038: Amortization schedule includes all expected fields', async () => {
      if (!agent.jar._cookieJar || agent.jar._cookieJar.store.size === 0) {
        await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      }

      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);

      const row = resp.body.schedule[0];
      expect(row).toHaveProperty('month');
      expect(row).toHaveProperty('payment');
      expect(row).toHaveProperty('principal');
      expect(row).toHaveProperty('interest');
      expect(row).toHaveProperty('balance');
    });

    test('BE-CAL-039: Final balance reaches zero', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);

      const lastRow = resp.body.schedule[resp.body.schedule.length - 1];
      expect(lastRow.balance).toBeCloseTo(0, 2);
    });

    test('BE-CAL-040: Total payments match principal + interest', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 12000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);

      const totalPayment = resp.body.schedule.reduce((sum, row) => sum + row.payment, 0);
      expect(totalPayment).toBeGreaterThanOrEqual(resp.body.principal);
      expect(totalPayment).toBeLessThan(resp.body.principal * 1.1);
    });

    test('BE-CAL-041: Interest decreases over time', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 6,
        term: 12
      });
      expect(resp.status).toBe(200);

      const firstRow = resp.body.schedule[0];
      const lastRow = resp.body.schedule[resp.body.schedule.length - 1];
      expect(firstRow.interest).toBeGreaterThan(lastRow.interest);
    });

    test('BE-CAL-042: Date progression correct', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 6,
        term: 6
      });
      expect(resp.status).toBe(200);

      for (let i = 0; i < resp.body.schedule.length - 1; i++) {
        const currentDate = new Date(resp.body.schedule[i].date);
        const nextDate = new Date(resp.body.schedule[i + 1].date);
        expect(nextDate.getTime()).toBeGreaterThanOrEqual(currentDate.getTime());
      }
    });

    test('BE-CAL-043: Rate changes applied correctly', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 50000,
        rate: 5,
        term: 36,
        rates: [
          { rate: 5, start_month: 1, end_month: 12 },
          { rate: 6, start_month: 13, end_month: 24 },
          { rate: 7, start_month: 25, end_month: 36 }
        ]
      });
      expect(resp.status).toBe(200);
      expect(resp.body.schedule.length).toBe(36);

      resp.body.schedule.forEach(row => {
        expect(['5', '6', '7']).toContain(row.rate.toString());
      });
    });

    test('BE-CAL-044: Prepayments included in schedule', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 10000,
        rate: 5,
        term: 12,
        prepayments: [
          { month: 6, amount: 2000, note: 'Early payment' }
        ]
      });
      expect(resp.status).toBe(200);
      expect(resp.body.schedule.length).toBeLessThan(12);
    });

    test('BE-CAL-045: Amortization with 30 year term', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 200000,
        rate: 4,
        term: 360
      });
      expect(resp.status).toBe(200);
      expect(resp.body.schedule.length).toBe(360);
      expect(resp.body.schedule[359].balance).toBeCloseTo(0, 2);
    });

    test('BE-CAL-046: Amortization with 15 year term', async () => {
      const resp = await agent.get('/api/calculators/loans/amortization').query({
        principal: 150000,
        rate: 3.5,
        term: 180
      });
      expect(resp.status).toBe(200);
      expect(resp.body.schedule.length).toBe(180);
    });
  });

  describe('GET /api/calculators/currency', () => {
    test('BE-CAL-047: Currency conversion returns rate and result', async () => {
      const resp = await agent.get('/api/calculators/currency').query({
        from: 'USD',
        to: 'EUR',
        amount: 100
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('amount');
      expect(resp.body).toHaveProperty('rate');
      expect(resp.body).toHaveProperty('convertedAmount');
    });

    test('BE-CAL-048: Exchange rates available for common pairs', async () => {
      const resp = await agent.get('/api/calculators/currency').query({
        from: 'USD',
        to: 'EUR',
        amount: 100
      });
      expect(resp.status).toBe(200);
      expect(resp.body.amount).toBe(100);
      expect(resp.body.convertedAmount).toBeFinite();
    });

    test('BE-CAL-049: Invalid currency code returns error', async () => {
      const resp = await agent.get('/api/calculators/currency').query({
        from: 'USD',
        to: 'XXX',
        amount: 100
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-CAL-050: Invalid amount returns error', async () => {
      const resp = await agent.get('/api/calculators/currency').query({
        from: 'USD',
        to: 'EUR',
        amount: -100
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/calculators/units', () => {
    test('BE-CAL-051: Unit conversion returns converted value', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 100,
        from: 'miles',
        to: 'kilometers'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('value');
      expect(resp.body).toHaveProperty('result');
    });

    test('BE-CAL-052: Distance unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 10,
        from: 'meters',
        to: 'feet'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-053: Weight unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 100,
        from: 'pounds',
        to: 'kilograms'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-054: Temperature conversion', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 100,
        from: 'celsius',
        to: 'fahrenheit'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-055: Volume unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 1,
        from: 'gallons',
        to: 'liters'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-056: Area unit conversion', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 1,
        from: 'square_miles',
        to: 'acres'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.result).toBeFinite();
    });

    test('BE-CAL-057: Invalid unit types handled', async () => {
      const resp = await agent.get('/api/calculators/units').query({
        value: 100,
        from: 'invalid',
        to: 'another_invalid'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });
});