/**
 * Tests for Transaction CRUD - including single transaction GET
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Transaction API - GET single transaction', () => {
  let testTxId;

  beforeAll(async () => {
    // Create a test transaction
    const createResp = await request(BASE_URL)
      .post('/api/transactions')
      .send({
        description: 'Test Transaction for GET',
        amount: 100.50,
        date: '2026-04-16',
        type: 'expense',
        category_id: 1
      });
    testTxId = createResp.body.id;
  });

  afterAll(async () => {
    // Clean up - delete the test transaction
    if (testTxId) {
      await request(BASE_URL).delete(`/api/transactions/${testTxId}`);
    }
  });

  describe('GET /api/transactions/:id', () => {
    test('returns a single transaction by ID', async () => {
      const resp = await request(BASE_URL).get(`/api/transactions/${testTxId}`);

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id', testTxId);
      expect(resp.body).toHaveProperty('description');
      expect(resp.body).toHaveProperty('amount');
      expect(resp.body).toHaveProperty('date');
    });

    test('includes category info when category_id is set', async () => {
      const resp = await request(BASE_URL).get(`/api/transactions/${testTxId}`);

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('category_name');
      expect(resp.body).toHaveProperty('category_color');
    });

    test('returns 404 for non-existent transaction ID', async () => {
      const resp = await request(BASE_URL).get('/api/transactions/999999999');

      expect(resp.status).toBe(404);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 404 for invalid ID format', async () => {
      const resp = await request(BASE_URL).get('/api/transactions/invalid');

      expect(resp.status).toBe(404);
    });
  });
});
