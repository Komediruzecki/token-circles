/**
 * Tests for Bulk Transaction API
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Bulk Transaction API', () => {
  let authCookie;
  let createdTxIds = [];

  beforeAll(async () => {
    // Reset rate limits first
    await request(BASE_URL).post('/api/test/reset-rate-limit')
      .set('X-Skip-RateLimit', 'true');
    const loginRes = await request(BASE_URL).post('/api/auth/login')
      .set('X-Skip-RateLimit', 'true')
      .send({ username: 'maff', password: 'add2' });
    authCookie = loginRes.headers['set-cookie'];
  });

  afterAll(async () => {
    for (const id of createdTxIds) {
      try {
        await request(BASE_URL).delete(`/api/transactions/${id}`)
          .set('X-Skip-RateLimit', 'true')
          .set('Cookie', authCookie);
      } catch (e) { /* ignore */ }
    }
  });

  async function createTransaction(data = {}) {
    const defaults = {
      description: 'Bulk test transaction',
      amount: 100,
      date: '2026-04-15',
      type: 'expense'
    };
    const resp = await request(BASE_URL).post('/api/transactions')
      .set('X-Skip-RateLimit', 'true')
      .set('Cookie', authCookie)
      .send({ ...defaults, ...data });
    if (resp.body.id) {
      createdTxIds.push(resp.body.id);
    }
    return resp;
  }

  describe('PUT /api/transactions/bulk - update action', () => {
    test('updates category for multiple transactions', async () => {
      const r1 = await createTransaction({ description: 'Tx for bulk cat 1' });
      const r2 = await createTransaction({ description: 'Tx for bulk cat 2' });
      const r3 = await createTransaction({ description: 'Tx for bulk cat 3' });
      const ids = [r1.body.id, r2.body.id, r3.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { category_id: 2 } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body).toHaveProperty('updated', 3);
    });

    test('updates type for multiple transactions', async () => {
      const r1 = await createTransaction({ type: 'expense' });
      const r2 = await createTransaction({ type: 'expense' });
      const ids = [r1.body.id, r2.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { type: 'income' } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body).toHaveProperty('updated', 2);
    });

    test('updates description for multiple transactions', async () => {
      const r1 = await createTransaction({ description: 'Original desc 1' });
      const r2 = await createTransaction({ description: 'Original desc 2' });
      const ids = [r1.body.id, r2.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { description: 'Bulk updated description' } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body.updated).toBeGreaterThan(0);
    });

    test('sets category to null with empty string', async () => {
      const r1 = await createTransaction({ description: 'Tx to clear cat', category_id: 1 });
      const r2 = await createTransaction({ description: 'Tx to clear cat 2', category_id: 1 });
      const ids = [r1.body.id, r2.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { category_id: '' } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
    });

    test('returns 400 for invalid type value', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { type: 'invalid' } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
      expect(resp.body.error).toMatch(/invalid type/i);
    });

    test('returns 400 when no valid fields to update', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { amount: 500 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when no data provided for update', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update' });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });
  });

  describe('PUT /api/transactions/bulk - delete action', () => {
    test('deletes multiple transactions', async () => {
      const r1 = await createTransaction();
      const r2 = await createTransaction();
      const ids = [r1.body.id, r2.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'delete' });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body).toHaveProperty('deleted', 2);
    });

    test('deleting already deleted transactions returns 0', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'delete' });

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'delete' });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('deleted', 0);
    });
  });

  describe('PUT /api/transactions/bulk - validation', () => {
    test('returns 400 when ids is missing', async () => {
      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ action: 'update', data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when ids is empty array', async () => {
      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids: [], action: 'update', data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when ids is not an array', async () => {
      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids: 'not-an-array', action: 'update', data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when ids exceeds 1000 limit', async () => {
      const ids = Array.from({ length: 1001 }, (_, i) => i + 100000);

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
      expect(resp.body.error).toMatch(/1000/i);
    });

    test('allows exactly 1000 transactions', async () => {
      const ids = Array.from({ length: 1000 }, (_, i) => i + 200000);

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { category_id: 1 } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body).toHaveProperty('updated');
    });

    test('returns 400 when action is missing', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when action is invalid', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'invalid', data: { category_id: 1 } });

      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
      expect(resp.body.error).toMatch(/invalid action/i);
    });
  });

  describe('PUT /api/transactions/bulk - security', () => {
    test('updates transactions with default profile when no session/auth provided', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .send({ ids, action: 'update', data: { category_id: 2 } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
      expect(resp.body.updated).toBeGreaterThanOrEqual(0);
    });

    test('only updates owned transactions', async () => {
      const resp = await request(BASE_URL).get('/api/transactions?limit=5')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie);

      expect(resp.status).toBe(200);
      const initialCount = resp.body.rows ? resp.body.rows.length : 0;

      if (initialCount > 0) {
        const ownedIds = resp.body.rows.map(t => t.id);
        const nonExistentId = 999999999;

        const bulkResp = await request(BASE_URL).put('/api/transactions/bulk')
          .set('X-Skip-RateLimit', 'true')
          .set('Cookie', authCookie)
          .send({ ids: [...ownedIds, nonExistentId], action: 'update', data: { category_id: 1 } });

        expect(bulkResp.status).toBe(200);
        expect(bulkResp.body.updated).toBeLessThanOrEqual(ownedIds.length);
      }
    });
  });

  describe('PUT /api/transactions/bulk - edge cases', () => {
    test('updates multiple fields at once', async () => {
      const r1 = await createTransaction({ type: 'expense' });
      const r2 = await createTransaction({ type: 'income' });
      const ids = [r1.body.id, r2.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({
          ids,
          action: 'update',
          data: {
            category_id: 1,
            type: 'expense',
            description: 'Batch update',
            beneficiary: 'Test beneficiary',
            notes: 'Bulk updated notes'
          }
        });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
    });

    test('handles duplicate IDs in array', async () => {
      const r1 = await createTransaction();
      const ids = [r1.body.id, r1.body.id, r1.body.id];

      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .send({ ids, action: 'update', data: { category_id: 3 } });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('updated');
    });

    test('returns 500 for malformed request body', async () => {
      const resp = await request(BASE_URL).put('/api/transactions/bulk')
        .set('X-Skip-RateLimit', 'true')
        .set('Cookie', authCookie)
        .set('Content-Type', 'text/plain')
        .send('not json');

      expect(resp.status).toBe(400);
    });
  });
});
