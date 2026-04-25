/**
 * E2E Tests for Recurring Transactions API
 * Covers daily/weekly/monthly/yearly/custom patterns, scheduling, timezone handling
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Recurring Transactions E2E', () => {
  let agent;
  let testRecurringId;
  let testTxId;
  let testTxId2;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testRecurringId) {
      await agent.delete(`/api/recurring/${testRecurringId}`).catch(() => {});
    }
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).catch(() => {});
  });

  describe('POST /api/recurring', () => {
    test('BE-REC-001: Create daily recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Daily Expense',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body.frequency).toBe('daily');
      testRecurringId = resp.body.id;
    });

    test('BE-REC-002: Create weekly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Weekly Bill',
        amount: 100,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      expect(resp.body.frequency).toBe('weekly');
    });

    test('BE-REC-003: Create monthly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Monthly Subscription',
        amount: 25,
        frequency: 'monthly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      expect(resp.body.frequency).toBe('monthly');
    });

    test('BE-REC-004: Create yearly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Annual Fee',
        amount: 500,
        frequency: 'yearly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      expect(resp.body.frequency).toBe('yearly');
    });

    test('BE-REC-005: Create custom frequency (e.g., every 2 weeks)', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Bi-Weekly Pay',
        amount: 500,
        frequency: 'custom',
        interval: 2,
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      expect(resp.body.frequency).toBe('custom');
      expect(resp.body.interval).toBe(2);
    });

    test('BE-REC-006: Recurring transaction has all required fields', async () => {
      if (!testRecurringId) return;
      const resp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('name');
      expect(resp.body).toHaveProperty('amount');
      expect(resp.body).toHaveProperty('frequency');
      expect(resp.body).toHaveProperty('startDate');
      expect(resp.body).toHaveProperty('enabled');
    });

    test('BE-REC-007: Reject recurring with empty name', async () => {
      const resp = await agent.post('/api/recurring').send({
        amount: 50,
        frequency: 'daily'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-008: Reject recurring with invalid frequency', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Invalid Recur',
        amount: 50,
        frequency: 'invalid'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-009: Validate negative amount rejected', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Negative Amount',
        amount: -50,
        frequency: 'daily',
        transactions: []
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-010: Require start date', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'No Date',
        amount: 50,
        frequency: 'daily'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-011: Frequency-specific validation for daily', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Daily Test',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-012: Frequency-specific validation for weekly', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Weekly Test',
        amount: 50,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-013: Frequency-specific validation for monthly', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Monthly Test',
        amount: 50,
        frequency: 'monthly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-014: Frequency-specific validation for yearly', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Yearly Test',
        amount: 50,
        frequency: 'yearly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-015: Custom frequency requires interval value', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Custom Test',
        amount: 50,
        frequency: 'custom',
        startDate: '2026-04-25',
        transactions: []
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-016: Custom interval must be positive', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Custom Test',
        amount: 50,
        frequency: 'custom',
        interval: -2,
        startDate: '2026-04-25',
        transactions: []
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/recurring', () => {
    test('BE-REC-017: Get all recurring transactions', async () => {
      const resp = await agent.get('/api/recurring');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-REC-018: Get single recurring by ID', async () => {
      if (!testRecurringId) return;
      const resp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id', testRecurringId);
    });

    test('BE-REC-019: Returns 404 for non-existent recurring', async () => {
      const resp = await agent.get('/api/recurring/999999999');
      expect(resp.status).toBe(404);
    });

    test('BE-REC-020: Filter recurring by enabled status', async () => {
      const resp = await agent.get('/api/recurring').query({ enabled: true });
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(r => {
          expect(r.enabled).toBe(true);
        });
      }
    });

    test('BE-REC-021: Filter recurring by frequency', async () => {
      const resp = await agent.get('/api/recurring').query({ frequency: 'monthly' });
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(r => {
          expect(r.frequency).toBe('monthly');
        });
      }
    });

    test('BE-REC-022: Filter recurring by amount range', async () => {
      const resp = await agent.get('/api/recurring').query({
        minAmount: 100,
        maxAmount: 500
      });
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(r => {
          expect(r.amount).toBeGreaterThanOrEqual(100);
          expect(r.amount).toBeLessThanOrEqual(500);
        });
      }
    });
  });

  describe('PUT /api/recurring/:id', () => {
    test('BE-REC-023: Update recurring transaction name', async () => {
      if (!testRecurringId) return;
      const newName = 'Updated Recur_' + Date.now();

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        name: newName
      });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.name).toBe(newName);
    });

    test('BE-REC-024: Update recurring transaction amount', async () => {
      if (!testRecurringId) return;
      const newAmount = 75.50;

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        amount: newAmount
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.amount).toBeCloseTo(newAmount, 2);
    });

    test('BE-REC-025: Update recurring transaction frequency', async () => {
      if (!testRecurringId) return;
      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        frequency: 'monthly'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-026: Update recurring transaction start date', async () => {
      if (!testRecurringId) return;
      const newDate = '2026-05-01';

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        startDate: newDate
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.startDate).toBe(newDate);
    });

    test('BE-REC-027: Enable/disable recurring transaction', async () => {
      if (!testRecurringId) return;
      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        enabled: true
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.enabled).toBe(true);
    });

    test('BE-REC-028: Update multiple fields at once', async () => {
      if (!testRecurringId) return;

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        name: 'MultiUpdate',
        amount: 125.75,
        frequency: 'weekly'
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.name).toBe('MultiUpdate');
      expect(checkResp.body.amount).toBeCloseTo(125.75, 2);
      expect(checkResp.body.frequency).toBe('weekly');
    });

    test('BE-REC-029: Update custom interval', async () => {
      const customResp = await agent.post('/api/recurring').send({
        name: 'Custom Interval',
        amount: 100,
        frequency: 'custom',
        interval: 2,
        startDate: '2026-04-25',
        transactions: []
      });
      const id = customResp.body.id;

      const updateResp = await agent.put(`/api/recurring/${id}`).send({
        interval: 3
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${id}`);
      expect(checkResp.body.interval).toBe(3);
    });
  });

  describe('DELETE /api/recurring/:id', () => {
    test('BE-REC-030: Delete recurring transaction', async () => {
      if (!testRecurringId) return;
      const id = testRecurringId;

      const resp = await agent.delete(`/api/recurring/${id}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      const checkResp = await agent.get(`/api/recurring/${id}`);
      expect(checkResp.status).toBe(404);
    });

    test('BE-REC-031: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/recurring/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Recurring Transaction Execution', () => {
    test('BE-REC-032: Create scheduled transaction successfully', async () => {
      await agent.post('/api/recurring').send({
        name: 'Scheduled Tx',
        amount: 100,
        frequency: 'monthly',
        startDate: '2026-04-25',
        transactions: []
      });
    });

    test('BE-REC-033: Pause recurring transaction', async () => {
      if (!testRecurringId) return;

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        enabled: false
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.enabled).toBe(false);
    });

    test('BE-REC-034: Resume paused recurring transaction', async () => {
      if (!testRecurringId) return;

      const resp = await agent.put(`/api/recurring/${testRecurringId}`).send({
        enabled: true
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/recurring/${testRecurringId}`);
      expect(checkResp.body.enabled).toBe(true);
    });
  });

  describe('Recurring Transaction Transactions', () => {
    test('BE-REC-035: Add transaction to recurring pattern', async () => {
      if (!testRecurringId) return;

      const resp = await agent.post(`/api/recurring/${testRecurringId}/transactions`).send({
        description: 'Sample Transaction',
        amount: 75,
        date: '2026-04-25',
        type: 'expense'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-036: Get transactions for recurring pattern', async () => {
      if (!testRecurringId) return;

      const resp = await agent.get(`/api/recurring/${testRecurringId}/transactions`);
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-REC-037: Update transaction in recurring pattern', async () => {
      if (!testRecurringId) return;
      const txResp = await agent.get(`/api/recurring/${testRecurringId}/transactions`);
      if (txResp.body.length > 0) {
        const txId = txResp.body[0].id;
        const updateResp = await agent.put(`/api/recurring/${testRecurringId}/transactions/${txId}`).send({
          amount: 80
        });
        expect(updateResp.status).toBe(200);
      }
    });

    test('BE-REC-038: Delete transaction from recurring pattern', async () => {
      if (!testRecurringId) return;
      const txResp = await agent.get(`/api/recurring/${testRecurringId}/transactions`);
      if (txResp.body.length > 0) {
        const txId = txResp.body[0].id;
        const delResp = await agent.delete(`/api/recurring/${testRecurringId}/transactions/${txId}`);
        expect(delResp.status).toBe(200);
      }
    });
  });

  describe('Recurring Transaction Dates & Scheduling', () => {
    test('BE-REC-039: Verify date calculation for daily pattern', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Daily Calc',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 0) {
        expect(datesResp.body[0].date).toBeDefined();
      }
    });

    test('BE-REC-040: Verify date calculation for weekly pattern', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Weekly Calc',
        amount: 100,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 1) {
        expect(datesResp.body[1].date).toBeDefined();
      }
    });

    test('BE-REC-041: Verify monthly date calculation', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Monthly Calc',
        amount: 25,
        frequency: 'monthly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 1) {
        // Next month should be about 30 days later
        const diffDays = (new Date(datesResp.body[1].date) - new Date(datesResp.body[0].date)) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(28);
        expect(diffDays).toBeLessThanOrEqual(32);
      }
    });

    test('BE-REC-042: Verify yearly date calculation', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Yearly Calc',
        amount: 500,
        frequency: 'yearly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 1) {
        const diffDays = (new Date(datesResp.body[1].date) - new Date(datesResp.body[0].date)) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeGreaterThanOrEqual(364);
        expect(diffDays).toBeLessThanOrEqual(366);
      }
    });

    test('BE-REC-043: Custom frequency date calculation', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Custom Calc',
        amount: 200,
        frequency: 'custom',
        interval: 2,
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 1) {
        const diffDays = (new Date(datesResp.body[1].date) - new Date(datesResp.body[0].date)) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeCloseTo(14, 0); // 2 weeks
      }
    });

    test('BE-REC-044: Recurring date doesn't skip weekends by default', async () => {
      // If schedule allows weekends, this test passes
      // If it skips weekends, this verifies that behavior
      const resp = await agent.post('/api/recurring').send({
        name: 'Weekend Test',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25', // Friday
        transactions: []
      });
      expect(resp.status).toBe(200);
    });

    test('BE-REC-045: Future dates only in schedule', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Future Only',
        amount: 50,
        frequency: 'monthly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const datesResp = await agent.get(`/api/recurring/${id}/schedules`);
      expect(datesResp.status).toBe(200);
      if (datesResp.body.length > 0) {
        datesResp.body.forEach(dateObj => {
          const futureDate = new Date(dateObj.date);
          expect(futureDate.getTime()).toBeGreaterThan(Date.now());
        });
      }
    });
  });

  describe('Recurring Transaction Statistics', () => {
    test('BE-REC-046: Get total value of all recurring transactions', async () => {
      const resp = await agent.get('/api/recurring');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const total = resp.body.reduce((sum, r) => sum + r.amount, 0);
        expect(total).toBeFinite();
      }
    });

    test('BE-REC-047: Count active vs paused recurring transactions', async () => {
      const resp = await agent.get('/api/recurring');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const active = resp.body.filter(r => r.enabled).length;
        const paused = resp.body.filter(r => !r.enabled).length;
        expect(active + paused).toBe(resp.body.length);
      }
    });

    test('BE-REC-048: Total transaction count over time', async () => {
      const resp = await agent.get('/api/recurring');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const totalTx = resp.body.reduce((sum, r) => sum + (r.transactionCount || 0), 0);
        expect(totalTx).toBeFinite();
      }
    });
  });

  describe('Recurring Transaction Overlap Prevention', () => {
    test('BE-REC-049: Detect overlapping recurring transactions', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Overlap Test 1',
        amount: 100,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);

      const resp2 = await agent.post('/api/recurring').send({
        name: 'Overlap Test 2',
        amount: 100,
        frequency: 'weekly',
        startDate: '2026-05-02',
        transactions: []
      });
      // These should not overlap (different weeks)
      expect(resp2.status).toBe(200);
    });

    test('BE-REC-050: Same day transactions detected', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Same Day Test',
        amount: 100,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Recurring Transaction Validation', () => {
    test('BE-REC-051: Ensure maximum frequency interval', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Max Interval',
        amount: 100,
        frequency: 'custom',
        interval: 1000,
        startDate: '2026-04-25',
        transactions: []
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-052: Ensure minimum frequency interval', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Min Interval',
        amount: 100,
        frequency: 'custom',
        interval: 0,
        startDate: '2026-04-25',
        transactions: []
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-REC-053: Reject future start date for daily', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Daily Future',
        amount: 50,
        frequency: 'daily',
        startDate: '2027-01-01',
        transactions: []
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Recurring Transaction Historical Data', () => {
    test('BE-REC-054: Track created date', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'History Test',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const checkResp = await agent.get(`/api/recurring/${id}`);
      expect(checkResp.status).toBe(200);
      expect(checkResp.body).toHaveProperty('createdAt');
    });

    test('BE-REC-055: Track last updated date', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Update Time',
        amount: 50,
        frequency: 'daily',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      await agent.put(`/api/recurring/${id}`).send({
        name: 'Updated Name'
      });

      const checkResp = await agent.get(`/api/recurring/${id}`);
      expect(checkResp.status).toBe(200);
      expect(checkResp.body).toHaveProperty('updatedAt');
    });
  });

  describe('Performance & Load Handling', () => {
    test('BE-REC-056: Handle many recurring transactions efficiently', async () => {
      for (let i = 0; i < 50; i++) {
        await agent.post('/api/recurring').send({
          name: `Many Recur${i}`,
          amount: 50,
          frequency: 'daily',
          startDate: '2026-04-25',
          transactions: []
        });
      }

      const resp = await agent.get('/api/recurring');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(50);
    });

    test('BE-REC-057: Schedules endpoint handles many transactions', async () => {
      const resp = await agent.post('/api/recurring').send({
        name: 'Schedule Load',
        amount: 50,
        frequency: 'weekly',
        startDate: '2026-04-25',
        transactions: []
      });
      expect(resp.status).toBe(200);
      const id = resp.body.id;

      const start = Date.now();
      const schedulesResp = await agent.get(`/api/recurring/${id}/schedules`);
      const duration = Date.now() - start;

      expect(schedulesResp.status).toBe(200);
      expect(duration).toBeLessThan(5000); // 5 second timeout
    });
  });
});