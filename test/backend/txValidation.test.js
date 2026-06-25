/**
 * Tests for Transaction API Validation
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

// Use a single agent with rate limit bypass
const api = request.agent(BASE_URL).set('X-Skip-RateLimit', 'true');

describe('Transaction API validation', () => {
  beforeAll(async () => {
    // Log in to get auth cookie
    const loginRes = await api.post('/api/auth/login').send({ username: 'person', password: 'something-like-this' });
    // Set the cookie on the agent so it persists
    if (loginRes.headers['set-cookie']) {
      api.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('POST /api/transactions', () => {
    test('returns 400 when description is empty', async () => {
      const resp = await api
        .post('/api/transactions')
        .send({ description: '', amount: 100, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is zero', async () => {
      const resp = await api
        .post('/api/transactions')
        .send({ description: 'Test', amount: 0, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is negative', async () => {
      const resp = await api
        .post('/api/transactions')
        .send({ description: 'Test', amount: -50, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when date is missing', async () => {
      const resp = await api
        .post('/api/transactions')
        .send({ description: 'Test', amount: 100, type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/transactions/:id', () => {
    let txId;

    beforeAll(async () => {
      // Create a transaction to update
      const createRes = await api
        .post('/api/transactions')
        .send({ description: 'Update me', amount: 100, date: '2026-04-15', type: 'expense' });
      txId = createRes.body.id;
    });

    afterAll(async () => {
      // Clean up
      if (txId) {
        await api.delete(`/api/transactions/${txId}`);
      }
    });

    test('returns 400 when description is empty', async () => {
      const resp = await api
        .put(`/api/transactions/${txId}`)
        .send({ description: '', amount: 100, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is zero', async () => {
      const resp = await api
        .put(`/api/transactions/${txId}`)
        .send({ description: 'Updated', amount: 0, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is negative', async () => {
      const resp = await api
        .put(`/api/transactions/${txId}`)
        .send({ description: 'Updated', amount: -50, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when date is missing', async () => {
      const resp = await api
        .put(`/api/transactions/${txId}`)
        .send({ description: 'Updated', amount: 100, type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });
});