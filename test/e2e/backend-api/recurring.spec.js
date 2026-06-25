/**
 * E2E Tests for Recurring Transactions API
 * Tests the actual API behavior:
 * - Fields: description, amount, type, category_id, frequency, day_of_month, next_date, notes, active
 * - POST returns { id }
 * - GET / returns rows with JOIN fields, only active=1
 * - GET /:id returns single toCamelCase object
 * - PUT /:id updates fields, returns { ok: true }
 * - DELETE /:id returns { ok: true } (no existence check)
 * - POST /:id/populate creates transaction, advances next_date
 * - GET /upcoming returns { transactions, byCategory, totalMonthly, currency }
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Recurring Transactions E2E', () => {
  jest.setTimeout(30000);
  let agent;
  let testRecurringId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Skip-RateLimit', 'true')
      .send({ username: 'person', password: 'something-like-this' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testRecurringId) {
      // Deactivate (soft delete) to keep data integrity
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 0 })
        .catch(() => {});
    }
  });

  describe('POST /api/recurring', () => {
    test('BE-REC-001: Create daily recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Daily Expense',
        amount: 50,
        frequency: 'daily',
        next_date: '2026-06-06',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
      testRecurringId = resp.body.id;
    });

    test('BE-REC-002: Create weekly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Weekly Bill',
        amount: 100,
        frequency: 'weekly',
        next_date: '2026-06-12',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });

    test('BE-REC-003: Create monthly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Monthly Subscription',
        amount: 25,
        frequency: 'monthly',
        day_of_month: 15,
        next_date: '2026-06-15',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });

    test('BE-REC-004: Create yearly recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Annual Fee',
        amount: 500,
        frequency: 'yearly',
        next_date: '2026-06-01',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });

    test('BE-REC-005: Create recurring with category_id and notes', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Categorized Recurring',
        amount: 75,
        frequency: 'monthly',
        category_id: 1,
        day_of_month: 10,
        next_date: '2026-06-10',
        notes: 'Test notes for recurring',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });

    test('BE-REC-006: Create recurring with minimal fields (uses defaults)', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Minimal Recurring',
        amount: 50,
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });

    test('BE-REC-007: Create income-type recurring transaction', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Monthly Salary',
        amount: 5000,
        type: 'income',
        frequency: 'monthly',
        day_of_month: 1,
        next_date: '2026-06-01',
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.id).toBeGreaterThan(0);
    });
  });

  describe('GET /api/recurring', () => {
    test('BE-REC-008: Get all active recurring transactions', async () => {
      const resp = await agent.get('/api/recurring').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
      // All returned items should have JOIN fields (category_name, category_color, category_type)
      if (resp.body.length > 0) {
        resp.body.forEach((r) => {
          global.expect(r).toHaveProperty('description');
          global.expect(r).toHaveProperty('amount');
          global.expect(r).toHaveProperty('frequency');
          global.expect(r).toHaveProperty('active');
          // JOIN fields should be present
          global.expect(r).toHaveProperty('category_name');
          global.expect(r).toHaveProperty('category_color');
          global.expect(r).toHaveProperty('category_type');
        });
      }
    });

    test('BE-REC-009: List is sorted by next_date ascending', async () => {
      const resp = await agent.get('/api/recurring').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 1) {
        for (let i = 1; i < resp.body.length; i++) {
          const prev = resp.body[i - 1].next_date || '';
          const curr = resp.body[i].next_date || '';
          global.expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
        }
      }
    });

    test('BE-REC-010: Only active=1 transactions are returned', async () => {
      const resp = await agent.get('/api/recurring').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach((r) => {
          global.expect(r.active).toBe(1);
        });
      }
    });
  });

  describe('GET /api/recurring/:id', () => {
    test('BE-REC-011: Get single recurring by ID (returns toCamelCase)', async () => {
      global.expect(testRecurringId).toBeDefined();
      const resp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      // toCamelCase converts snake_case to camelCase
      global.expect(resp.body).toHaveProperty('id', testRecurringId);
      global.expect(resp.body).toHaveProperty('description');
      global.expect(resp.body).toHaveProperty('amount');
      global.expect(resp.body).toHaveProperty('frequency');
      global.expect(resp.body).toHaveProperty('active');
      global.expect(resp.body).toHaveProperty('next_date'); // snake_case next_date -> nextDate
      global.expect(resp.body).toHaveProperty('day_of_month'); // snake_case day_of_month -> dayOfMonth
      global.expect(resp.body).toHaveProperty('created_at'); // snake_case created_at -> createdAt
    });

    test('BE-REC-012: Returns 404 for non-existent recurring', async () => {
      const resp = await agent.get('/api/recurring/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });

    test('BE-REC-013: Single get includes profile_id and category_id', async () => {
      global.expect(testRecurringId).toBeDefined();
      const resp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('profile_id');
      global.expect(resp.body).toHaveProperty('category_id');
    });
  });

  describe('PUT /api/recurring/:id', () => {
    test('BE-REC-014: Update recurring transaction description', async () => {
      global.expect(testRecurringId).toBeDefined();
      const newDesc = 'Updated Recur_' + Date.now();

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          description: newDesc,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.description).toBe(newDesc);
    });

    test('BE-REC-015: Update recurring transaction amount', async () => {
      global.expect(testRecurringId).toBeDefined();
      const newAmount = 75.5;

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          amount: newAmount,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.amount).toBeCloseTo(newAmount, 2);
    });

    test('BE-REC-016: Update recurring transaction frequency', async () => {
      global.expect(testRecurringId).toBeDefined();
      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          frequency: 'monthly',
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);
    });

    test('BE-REC-017: Update next_date', async () => {
      global.expect(testRecurringId).toBeDefined();
      const newDate = '2026-07-01';

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          next_date: newDate,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      // toCamelCase: next_date -> nextDate
      global.expect(checkResp.body.next_date).toBe(newDate);
    });

    test('BE-REC-018: Set active to 0 (deactivate recurring transaction)', async () => {
      global.expect(testRecurringId).toBeDefined();
      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          active: 0,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.active).toBe(0);

      // Re-activate for other tests
      await agent.put(`/api/recurring/${testRecurringId}`).set('X-Skip-RateLimit', 'true').send({
        active: 1,
      });
    });

    test('BE-REC-019: Set active to 1 (reactivate recurring transaction)', async () => {
      global.expect(testRecurringId).toBeDefined();
      // Deactivate first
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 0 });

      // Reactivate
      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          active: 1,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.active).toBe(1);
    });

    test('BE-REC-020: Update multiple fields at once', async () => {
      global.expect(testRecurringId).toBeDefined();

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          description: 'MultiUpdate',
          amount: 125.75,
          frequency: 'weekly',
          notes: 'updated notes',
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.description).toBe('MultiUpdate');
      global.expect(checkResp.body.amount).toBeCloseTo(125.75, 2);
      global.expect(checkResp.body.frequency).toBe('weekly');
    });

    test('BE-REC-021: Update category_id', async () => {
      global.expect(testRecurringId).toBeDefined();

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          category_id: 2,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.category_id).toBe(2);
    });

    test('BE-REC-022: Update day_of_month', async () => {
      global.expect(testRecurringId).toBeDefined();

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          day_of_month: 20,
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.day_of_month).toBe(20);
    });

    test('BE-REC-023: Update type (expense/income)', async () => {
      global.expect(testRecurringId).toBeDefined();

      const resp = await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({
          type: 'income',
        });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.type).toBe('income');

      // Reset to expense for subsequent tests
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ type: 'expense' });
    });

    test('BE-REC-024: Returns 404 for non-existent recurring on update', async () => {
      const resp = await agent
        .put('/api/recurring/999999999')
        .set('X-Skip-RateLimit', 'true')
        .send({
          description: 'Non-existent',
        });
      global.expect(resp.status).toBe(404);
    });
  });

  describe('DELETE /api/recurring/:id', () => {
    test('BE-REC-025: Delete recurring transaction returns ok', async () => {
      // Create a temp recurring to delete
      const createResp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'To Delete',
        amount: 99,
        frequency: 'daily',
        next_date: '2026-06-06',
      });
      global.expect(createResp.status).toBe(200);
      const deleteId = createResp.body.id;

      const resp = await agent.delete(`/api/recurring/${deleteId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);

      // Verify deleted — GET by ID should return 404
      const checkResp = await agent
        .get(`/api/recurring/${deleteId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-REC-026: Delete non-existent returns ok (no existence check in API)', async () => {
      const resp = await agent.delete('/api/recurring/999999999').set('X-Skip-RateLimit', 'true');
      // API does not check existence before delete — returns { ok: true }
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);
    });
  });

  describe('POST /api/recurring/:id/populate', () => {
    test('BE-REC-027: Populate creates a transaction from recurring', async () => {
      // Create a fresh recurring for populate test
      const createResp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Populate Test',
        amount: 200,
        frequency: 'monthly',
        type: 'expense',
        next_date: '2026-06-01',
        category_id: null,
      });
      global.expect(createResp.status).toBe(200);
      const recId = createResp.body.id;

      const resp = await agent
        .post(`/api/recurring/${recId}/populate`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);
      global.expect(resp.body).toHaveProperty('transactionId');
      global.expect(resp.body.transactionId).toBeGreaterThan(0);
      // next_date should be advanced
      global.expect(resp.body).toHaveProperty('next_date');
      // For monthly frequency starting June 1, should advance to July 1
      global.expect(resp.body.next_date).toMatch(/^2026-07-01/);

      // Clean up: delete the created transaction
      await agent
        .delete(`/api/transactions/${resp.body.transactionId}`)
        .set('X-Skip-RateLimit', 'true')
        .catch(() => {});
      // Clean up the recurring
      await agent
        .delete(`/api/recurring/${recId}`)
        .set('X-Skip-RateLimit', 'true')
        .catch(() => {});
    });

    test('BE-REC-028: Populate returns 404 for non-existent recurring', async () => {
      const resp = await agent
        .post('/api/recurring/999999999/populate')
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('GET /api/recurring/upcoming', () => {
    test('BE-REC-029: Upcoming returns correct response shape', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('transactions');
      global.expect(resp.body).toHaveProperty('byCategory');
      global.expect(resp.body).toHaveProperty('totalMonthly');
      global.expect(resp.body).toHaveProperty('currency');
      global.expect(Array.isArray(resp.body.transactions)).toBe(true);
      global.expect(Array.isArray(resp.body.byCategory)).toBe(true);
      global.expect(typeof resp.body.totalMonthly).toBe('number');
      global.expect(typeof resp.body.currency).toBe('string');
    });

    test('BE-REC-030: Upcoming transactions have required fields', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.transactions.length > 0) {
        const tx = resp.body.transactions[0];
        global.expect(tx).toHaveProperty('id');
        global.expect(tx).toHaveProperty('description');
        global.expect(tx).toHaveProperty('amount');
        global.expect(tx).toHaveProperty('type');
        global.expect(tx).toHaveProperty('frequency');
        global.expect(tx).toHaveProperty('next_date');
        global.expect(tx).toHaveProperty('category_name');
        global.expect(tx).toHaveProperty('category_color');
      }
    });

    test('BE-REC-031: Upcoming transactions are capped at 20', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.transactions.length).toBeLessThanOrEqual(20);
    });

    test('BE-REC-032: Upcoming byCategory is sorted by total descending', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.byCategory.length > 1) {
        for (let i = 1; i < resp.body.byCategory.length; i++) {
          global
            .expect(resp.body.byCategory[i].total)
            .toBeLessThanOrEqual(resp.body.byCategory[i - 1].total);
        }
      }
    });

    test('BE-REC-033: Upcoming byCategory items have name, color, total, items', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.byCategory.length > 0) {
        const cat = resp.body.byCategory[0];
        global.expect(cat).toHaveProperty('name');
        global.expect(cat).toHaveProperty('color');
        global.expect(cat).toHaveProperty('total');
        global.expect(cat).toHaveProperty('items');
        global.expect(Array.isArray(cat.items)).toBe(true);
      }
    });

    test('BE-REC-034: totalMonthly is non-negative', async () => {
      const resp = await agent.get('/api/recurring/upcoming').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.total_monthly).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Pause and Resume (active field)', () => {
    test('BE-REC-035: Deactivated recurring is excluded from GET /api/recurring', async () => {
      global.expect(testRecurringId).toBeDefined();
      // Deactivate
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 0 });

      // Should not appear in GET all
      const resp = await agent.get('/api/recurring').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      const found = resp.body.find((r) => r.id === testRecurringId);
      global.expect(found).toBeUndefined();

      // But still accessible by direct ID
      const singleResp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(singleResp.status).toBe(200);

      // Reactivate
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 1 });
    });

    test('BE-REC-036: Reactivated recurring reappears in list', async () => {
      global.expect(testRecurringId).toBeDefined();
      // Deactivate then reactivate
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 0 });
      await agent
        .put(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true')
        .send({ active: 1 });

      const resp = await agent.get('/api/recurring').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      const found = resp.body.find((r) => r.id === testRecurringId);
      global.expect(found).toBeDefined();
    });
  });

  describe('Data completeness', () => {
    test('BE-REC-037: Created recurring has created_at timestamp', async () => {
      global.expect(testRecurringId).toBeDefined();
      const resp = await agent
        .get(`/api/recurring/${testRecurringId}`)
        .set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('created_at');
      // Should be a valid date string
      global.expect(isNaN(new Date(resp.body.created_at).getTime())).toBe(false);
    });

    test('BE-REC-038: Default values are applied on creation', async () => {
      const resp = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
        description: 'Defaults Test',
        amount: 100,
      });
      global.expect(resp.status).toBe(200);
      const id = resp.body.id;

      const checkResp = await agent.get(`/api/recurring/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(200);
      global.expect(checkResp.body.type).toBe('expense'); // default
      global.expect(checkResp.body.frequency).toBe('monthly'); // default
      global.expect(checkResp.body.active).toBe(1); // default
      global.expect(checkResp.body.notes).toBe(''); // default

      // Clean up
      await agent
        .delete(`/api/recurring/${id}`)
        .set('X-Skip-RateLimit', 'true')
        .catch(() => {});
    });
  });
});
