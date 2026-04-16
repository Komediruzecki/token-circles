/**
 * Tests for Transaction API Validation
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Transaction API validation', () => {
  let authCookie;

  beforeAll(async () => {
    // Log in to get auth cookie
    const loginRes = await request(BASE_URL)
      .post('/api/auth/login')
      .send({ username: 'maff', password: 'add2' });
    authCookie = loginRes.headers['set-cookie'];
  });

  describe('POST /api/transactions', () => {
    test('returns 400 when description is empty', async () => {
      const resp = await request(BASE_URL)
        .post('/api/transactions')
        .set('Cookie', authCookie)
        .send({ description: '', amount: 100, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is zero', async () => {
      const resp = await request(BASE_URL)
        .post('/api/transactions')
        .set('Cookie', authCookie)
        .send({ description: 'Test', amount: 0, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is negative', async () => {
      const resp = await request(BASE_URL)
        .post('/api/transactions')
        .set('Cookie', authCookie)
        .send({ description: 'Test', amount: -50, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when date is missing', async () => {
      const resp = await request(BASE_URL)
        .post('/api/transactions')
        .set('Cookie', authCookie)
        .send({ description: 'Test', amount: 100, type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/transactions/:id', () => {
    let txId;

    beforeAll(async () => {
      // Create a transaction to update
      const createRes = await request(BASE_URL)
        .post('/api/transactions')
        .set('Cookie', authCookie)
        .send({ description: 'Update me', amount: 100, date: '2026-04-15', type: 'expense' });
      txId = createRes.body.id;
    });

    afterAll(async () => {
      // Clean up
      if (txId) {
        await request(BASE_URL)
          .delete(`/api/transactions/${txId}`)
          .set('Cookie', authCookie);
      }
    });

    test('returns 400 when description is empty', async () => {
      const resp = await request(BASE_URL)
        .put(`/api/transactions/${txId}`)
        .set('Cookie', authCookie)
        .send({ description: '', amount: 100, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is zero', async () => {
      const resp = await request(BASE_URL)
        .put(`/api/transactions/${txId}`)
        .set('Cookie', authCookie)
        .send({ description: 'Updated', amount: 0, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when amount is negative', async () => {
      const resp = await request(BASE_URL)
        .put(`/api/transactions/${txId}`)
        .set('Cookie', authCookie)
        .send({ description: 'Updated', amount: -50, date: '2026-04-15', type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when date is missing', async () => {
      const resp = await request(BASE_URL)
        .put(`/api/transactions/${txId}`)
        .set('Cookie', authCookie)
        .send({ description: 'Updated', amount: 100, type: 'expense' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });
});
