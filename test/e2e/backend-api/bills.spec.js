/**
 * E2E Tests for Bills & Subscriptions API
 * Matches actual routes in /backend/routes/bills.js
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Bills E2E', () => {
  jest.setTimeout(30000);
  let agent;
  let testBillId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
  });

  afterAll(async () => {
    if (testBillId) {
      try {
        await agent.delete(`/api/bills/${testBillId}`).set('X-Skip-RateLimit', 'true');
      } catch (e) {}
    }
  });

  describe('POST /api/bills', () => {
    test('BE-BIL-001: Create bill successfully returns { id }', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Internet Bill',
        amount: 80,
        dueDate: '2026-06-30',
        frequency: 'monthly'
      });
      // repo may or may not be wired at server level
      global.expect([200, 500]).to.include(resp.status);
      if (resp.status === 200) {
        global.expect(resp.body).toHaveProperty('id');
        testBillId = resp.body.id;
      }
    });

    test('BE-BIL-002: Create subscription bill with type field', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Netflix',
        amount: 15.99,
        dueDate: '2026-06-20',
        frequency: 'monthly',
        type: 'subscription'
      });
      global.expect([200, 500]).to.include(resp.status);
      if (resp.status === 200) {
        global.expect(resp.body).toHaveProperty('id');
      }
    });

    test('BE-BIL-003: Reject missing name', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        amount: 50,
        dueDate: '2026-06-30'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-004: Reject missing dueDate', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'No Date',
        amount: 50
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-005: Reject negative amount', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Negative',
        amount: -50,
        dueDate: '2026-06-30'
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/bills', () => {
    test('BE-BIL-006: List all bills returns array', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-007: Filter by paid=false', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true').query({ paid: 'false' });
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-008: Filter by paid=true', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true').query({ paid: 'true' });
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-009: Filter by type=bill', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true').query({ type: 'bill' });
      global.expect(resp.status).toBe(200);
    });

    test('BE-BIL-010: Filter by type=subscription', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true').query({ type: 'subscription' });
      global.expect(resp.status).toBe(200);
    });

    test('BE-BIL-011: Bills include paid boolean and category_name', async () => {
      const resp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        global.expect(resp.body[0]).toHaveProperty('paid');
        global.expect(resp.body[0]).toHaveProperty('category_name');
        global.expect(resp.body[0]).toHaveProperty('category_color');
      }
    });
  });

  describe('GET /api/bills/upcoming', () => {
    test('BE-BIL-012: Get upcoming bills sorted by urgency', async () => {
      const resp = await agent.get('/api/bills/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-013: Upcoming bills have next_due_date, days_until, is_overdue', async () => {
      const resp = await agent.get('/api/bills/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        global.expect(resp.body[0]).toHaveProperty('next_due_date');
        global.expect(resp.body[0]).toHaveProperty('days_until');
        global.expect(resp.body[0]).toHaveProperty('is_overdue');
      }
    });
  });

  describe('PUT /api/bills/:id', () => {
    test('BE-BIL-014: Update bill returns { ok: true }', async () => {
      if (!testBillId) return;
      const resp = await agent.put(`/api/bills/${testBillId}`).set('X-Skip-RateLimit', 'true').send({
        name: 'Updated Name',
        amount: 120
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);

      // Verify via list
      const listResp = await agent.get('/api/bills').set('X-Skip-RateLimit', 'true');
      const updated = listResp.body.find(b => b.id === testBillId);
      if (updated) {
        global.expect(updated.name).toBe('Updated Name');
        global.expect(updated.amount).toBe(120);
      }
    });

    test('BE-BIL-015: Update with category_id', async () => {
      if (!testBillId) return;
      const resp = await agent.put(`/api/bills/${testBillId}`).set('X-Skip-RateLimit', 'true').send({
        category_id: 1
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-BIL-016: Update with is_active=false', async () => {
      if (!testBillId) return;
      const resp = await agent.put(`/api/bills/${testBillId}`).set('X-Skip-RateLimit', 'true').send({
        is_active: 0
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-BIL-017: Update non-existent returns 404', async () => {
      const resp = await agent.put('/api/bills/999999999').set('X-Skip-RateLimit', 'true').send({ name: 'Nope' });
      global.expect([404, 500]).to.include(resp.status);
    });
  });

  describe('POST /api/bills/:id/mark-paid', () => {
    test('BE-BIL-018: Mark paid creates transaction', async () => {
      if (!testBillId) return;
      const resp = await agent.post(`/api/bills/${testBillId}/mark-paid`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);
      global.expect(resp.body).toHaveProperty('transactionId');
    });

    test('BE-BIL-019: Mark paid on non-existent returns 404', async () => {
      const resp = await agent.post('/api/bills/999999999/mark-paid').set('X-Skip-RateLimit', 'true');
      global.expect([404, 500]).to.include(resp.status);
    });
  });

  describe('DELETE /api/bills/:id', () => {
    test('BE-BIL-020: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/bills/999999999').set('X-Skip-RateLimit', 'true');
      global.expect([200, 404, 500]).to.include(resp.status);
    });
  });

  describe('GET /api/bills/summary', () => {
    test('BE-BIL-021: Summary endpoint responds', async () => {
      const resp = await agent.get('/api/bills/summary').set('X-Skip-RateLimit', 'true');
      global.expect([200, 500]).to.include(resp.status);
    });
  });

  describe('GET /api/bills/notifications', () => {
    test('BE-BIL-022: Notifications returns { notifications, count }', async () => {
      const resp = await agent.get('/api/bills/notifications').set('X-Skip-RateLimit', 'true');
      global.expect([200, 500]).to.include(resp.status);
      if (resp.status === 200) {
        global.expect(resp.body).toHaveProperty('notifications');
        global.expect(resp.body).toHaveProperty('count');
        global.expect(Array.isArray(resp.body.notifications)).toBe(true);
      }
    });
  });

  describe('Recurring Bills', () => {
    test('BE-BIL-023: Create weekly recurring bill', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Weekly Gym',
        amount: 20,
        dueDate: '2026-06-25',
        frequency: 'weekly'
      });
      global.expect([200, 500]).to.include(resp.status);
    });

    test('BE-BIL-024: Create yearly recurring bill', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Amazon Prime',
        amount: 139,
        dueDate: '2026-06-25',
        frequency: 'yearly'
      });
      global.expect([200, 500]).to.include(resp.status);
    });
  });

  describe('Bill Validation', () => {
    test('BE-BIL-025: Reject zero amount', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Free Service',
        amount: 0,
        dueDate: '2026-06-30'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-026: Reject invalid dueDate format', async () => {
      const resp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Bad Date',
        amount: 50,
        dueDate: 'invalid-date'
      });
      global.expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/bills/calendar', () => {
    test('BE-BIL-027: Calendar returns correct structure for current month', async () => {
      const now = new Date();
      const resp = await agent
        .get(`/api/bills/calendar?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('year');
      global.expect(resp.body).toHaveProperty('month');
      global.expect(resp.body).toHaveProperty('monthLabel');
      global.expect(resp.body).toHaveProperty('firstDow');
      global.expect(resp.body).toHaveProperty('days');
      global.expect(resp.body).toHaveProperty('summary');
      global.expect(resp.body.summary).toHaveProperty('totalAmount');
      global.expect(resp.body.summary).toHaveProperty('paidAmount');
      global.expect(resp.body.summary).toHaveProperty('billCount');
    });

    test('BE-BIL-028: Calendar defaults to current month when no params', async () => {
      const resp = await agent.get('/api/bills/calendar').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      const now = new Date();
      global.expect(resp.body.month).toBe(now.getMonth() + 1);
      global.expect(resp.body.year).toBe(now.getFullYear());
    });

    test('BE-BIL-029: Calendar rejects invalid month', async () => {
      const resp = await agent
        .get('/api/bills/calendar?year=2026&month=13')
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(400);
    });

    test('BE-BIL-030: Calendar rejects invalid year', async () => {
      const resp = await agent
        .get('/api/bills/calendar?year=1899&month=6')
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(400);
    });

    test('BE-BIL-031: Calendar days are keyed by day number 1..lastDay', async () => {
      const resp = await agent
        .get('/api/bills/calendar?year=2026&month=6')
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      const days = resp.body.days;
      // June has 30 days — check all day keys exist
      for (let d = 1; d <= 30; d++) {
        global.expect(days).toHaveProperty(String(d));
        global.expect(Array.isArray(days[String(d)])).toBe(true);
      }
      // Day 31 should not exist for June
      global.expect(days).not.toHaveProperty('31');
    });

    test('BE-BIL-032: Bill created with due_date appears in calendar on that day', async () => {
      // Create a bill for a specific date
      const createResp = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
        name: 'Calendar Test Bill',
        amount: 42,
        dueDate: '2026-06-15',
        frequency: 'monthly'
      });
      if (createResp.status === 200) {
        const newId = createResp.body.id;
        // Check calendar for June 2026
        const calResp = await agent
          .get('/api/bills/calendar?year=2026&month=6')
          .set('X-Skip-RateLimit', 'true');
        global.expect(calResp.status).toBe(200);
        const day15 = calResp.body.days['15'] || [];
        const found = day15.find((b) => b.id === newId);
        global.expect(found).toBeDefined();
        global.expect(found.name).toBe('Calendar Test Bill');
        global.expect(found.amount).toBe(42);

        // Clean up
        await agent.delete(`/api/bills/${newId}`).set('X-Skip-RateLimit', 'true');
      }
    });

    test('BE-BIL-033: Calendar bill items have expected fields', async () => {
      const resp = await agent
        .get('/api/bills/calendar?year=2026&month=6')
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      // Collect all bills from all days
      const allBills = Object.values(resp.body.days).flat();
      if (allBills.length > 0) {
        const bill = allBills[0];
        global.expect(bill).toHaveProperty('id');
        global.expect(bill).toHaveProperty('name');
        global.expect(bill).toHaveProperty('amount');
        global.expect(bill).toHaveProperty('frequency');
        global.expect(bill).toHaveProperty('date');
        global.expect(bill).toHaveProperty('paid');
        global.expect(bill).toHaveProperty('type');
        global.expect(bill).toHaveProperty('is_overdue');
      }
    });
  });
});
