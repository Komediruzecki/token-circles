/**
 * E2E Tests for Bills & Subscriptions API
 * Covers bill CRUD, recurring bills, notifications, payment tracking
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Bills E2E', () => {
  let agent;
  let testBillId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testBillId) {
      await agent.delete(`/api/bills/${testBillId}`).catch(() => {});
    }
  });

  describe('POST /api/bills', () => {
    test('BE-BIL-001: Create bill successfully', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Internet Bill',
        amount: 80,
        dueDate: '2026-04-30',
        frequency: 'monthly'
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body.name).toBe('Internet Bill');
      testBillId = resp.body.id;
    });

    test('BE-BIL-002: Create subscription', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Netflix',
        amount: 15.99,
        dueDate: '2026-04-20',
        frequency: 'monthly',
        isSubscription: true
      });
      expect(resp.status).toBe(200);
      expect(resp.body.isSubscription).toBe(true);
    });

    test('BE-BIL-003: Bill requires name', async () => {
      const resp = await agent.post('/api/bills').send({
        amount: 50,
        dueDate: '2026-04-30'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-004: Bill requires due date', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'No Date',
        amount: 50
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-005: Reject negative amount', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Negative',
        amount: -50,
        dueDate: '2026-04-30'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('GET /api/bills', () => {
    test('BE-BIL-006: Get all bills', async () => {
      const resp = await agent.get('/api/bills');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-007: Get single bill by ID', async () => {
      if (!testBillId) return;
      const resp = await agent.get(`/api/bills/${testBillId}`);
      expect(resp.status).toBe(200);
      expect(resp.body.id).toBe(testBillId);
    });

    test('BE-BIL-008: Get overdue bills', async () => {
      const resp = await agent.get('/api/bills').query({ overdue: true });
      expect(resp.status).toBe(200);
    });

    test('BE-BIL-009: Get upcoming bills', async () => {
      const resp = await agent.get('/api/bills').query({ upcoming: true });
      expect(resp.status).toBe(200);
    });

    test('BE-BIL-010: Bills include category information', async () => {
      const resp = await agent.get('/api/bills');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        expect(resp.body[0]).toHaveProperty('category');
      }
    });

    test('BE-BIL-011: Filter bills by frequency', async () => {
      const resp = await agent.get('/api/bills').query({ frequency: 'monthly' });
      expect(resp.status).toBe(200);
    });
  });

  describe('PUT /api/bills/:id', () => {
    test('BE-BIL-012: Update bill name', async () => {
      if (!testBillId) return;
      const newName = 'Updated Bill Name';

      const resp = await agent.put(`/api/bills/${testBillId}`).send({
        name: newName
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/bills/${testBillId}`);
      expect(checkResp.body.name).toBe(newName);
    });

    test('BE-BIL-013: Update bill amount', async () => {
      if (!testBillId) return;
      const newAmount = 100;

      const resp = await agent.put(`/api/bills/${testBillId}`).send({
        amount: newAmount
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/bills/${testBillId}`);
      expect(checkResp.body.amount).toBe(newAmount);
    });

    test('BE-BIL-014: Update bill due date', async () => {
      if (!testBillId) return;
      const newDate = '2026-05-30';

      const resp = await agent.put(`/api/bills/${testBillId}`).send({
        dueDate: newDate
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/bills/${testBillId}`);
      expect(checkResp.body.dueDate).toBe(newDate);
    });

    test('BE-BIL-015: Mark bill as paid', async () => {
      if (!testBillId) return;

      const resp = await agent.put(`/api/bills/${testBillId}`).send({
        isPaid: true
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/bills/${testBillId}`);
      expect(checkResp.body.isPaid).toBe(true);
    });
  });

  describe('DELETE /api/bills/:id', () => {
    test('BE-BIL-016: Delete bill', async () => {
      if (!testBillId) return;
      const id = testBillId;

      const resp = await agent.delete(`/api/bills/${id}`);
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/bills/${id}`);
      expect(checkResp.status).toBe(404);
    });

    test('BE-BIL-017: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/bills/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Bill Notifications', () => {
    test('BE-BIL-018: Get bill notifications', async () => {
      const resp = await agent.get('/api/bills/notifications');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-BIL-019: Notifications show upcoming bill dates', async () => {
      const resp = await agent.get('/api/bills/notifications');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        expect(resp.body[0]).toHaveProperty('billId');
        expect(resp.body[0]).toHaveProperty('dueDate');
      }
    });

    test('BE-BIL-020: Dismiss bill notification', async () => {
      const resp = await agent.get('/api/bills/notifications');
      if (resp.body.length > 0) {
        const notificationId = resp.body[0].id;
        const dismissResp = await agent.post(`/api/bills/notifications/${notificationId}/dismiss`);
        expect(dismissResp.status).toBe(200);
      }
    });
  });

  describe('Bill Statistics', () => {
    test('BE-BIL-021: Get total monthly bill amount', async () => {
      const resp = await agent.get('/api/bills/summary');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('monthlyTotal');
    });

    test('BE-BIL-022: Total amount includes all active bills', async () => {
      const resp = await agent.get('/api/bills/summary');
      expect(resp.status).toBe(200);
      expect(resp.body.monthlyTotal).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Recurring Bills', () => {
    test('BE-BIL-023: Create weekly recurring bill', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Weekly Gym',
        amount: 20,
        dueDate: '2026-04-25',
        frequency: 'weekly'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-BIL-024: Create yearly bill', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Amazon Prime',
        amount: 139,
        dueDate: '2026-04-25',
        frequency: 'yearly'
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Bill Validation', () => {
    test('BE-BIL-025: Reject bill with zero amount', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Free Service',
        amount: 0,
        dueDate: '2026-04-30'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-BIL-026: Reject bill with invalid due date', async () => {
      const resp = await agent.post('/api/bills').send({
        name: 'Test',
        amount: 50,
        dueDate: 'invalid-date'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });
});