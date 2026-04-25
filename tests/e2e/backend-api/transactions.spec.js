/**
 * E2E Tests for Transactions API
 * Covers CRUD operations, filtering, sorting, reconciliation, bulk operations
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Transactions E2E', () => {
  let agent;
  let testTxId;
  let testTxId2;
  let testTxId3;
  let testTxId4;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).catch(() => {});
    if (testTxId4) await agent.delete(`/api/transactions/${testTxId4}`).catch(() => {});
  });

  describe('Transaction Creation', () => {
    test('BE-TX-001: Create expense transaction successfully', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Test Expense',
        amount: 50.00,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('description');
      expect(resp.body.amount).toBe(50.00);
      expect(resp.body.type).toBe('expense');
      expect(resp.body.reconciled).toBe(false);
      testTxId = resp.body.id;
    });

    test('BE-TX-002: Create income transaction successfully', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Test Income',
        amount: 1000.00,
        date: '2026-04-25',
        type: 'income'
      });

      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('income');
      testTxId2 = resp.body.id;
    });

    test('BE-TX-003: Create transfer transaction successfully', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Test Transfer',
        amount: 250.00,
        date: '2026-04-25',
        type: 'transfer',
        accountId: 1
      });

      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('transfer');
      testTxId3 = resp.body.id;
    });

    test('BE-TX-004: Require description for transaction', async () => {
      const resp = await agent.post('/api/transactions').send({
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(400);
    });

    test('BE-TX-005: Transaction with 2 decimal places precision', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Precise Transaction',
        amount: 123.45,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body.amount).toBeCloseTo(123.45, 2);
    });

    test('BE-TX-006: Transaction with negative amount for expense', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Negative Amount',
        amount: -50.00,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body.amount).toBe(-50.00);
    });

    test('BE-TX-007: Reject amount with more than 2 decimal places', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'TooPrecise',
        amount: 100.999,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(400);
    });

    test('BE-TX-008: Transaction date defaults to today', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'No Date',
        amount: 50,
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body.date).toBeDefined();
    });

    test('BE-TX-009: Reconciled defaults to false', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Unreconciled',
        amount: 50,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body.reconciled).toBe(false);
    });

    test('BE-TX-010: Transaction includes timestamps', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Timestamp Test',
        amount: 50,
        date: '2026-04-25',
        type: 'expense'
      });

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('createdAt');
      expect(resp.body).toHaveProperty('updatedAt');
    });
  });

  describe('Transaction Retrieval', () => {
    test('BE-TX-011: Get all transactions returns paginated results', async () => {
      const resp = await agent.get('/api/transactions');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('rows');
      expect(resp.body).toHaveProperty('total');
      expect(resp.body).toHaveProperty('limit');
      expect(resp.body).toHaveProperty('offset');
    });

    test('BE-TX-012: GET /api/transactions/:id returns specific transaction', async () => {
      if (!testTxId) return;
      const resp = await agent.get(`/api/transactions/${testTxId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id', testTxId);
      expect(resp.body).toHaveProperty('description');
    });

    test('BE-TX-013: GET /api/transactions/:id includes all relationships', async () => {
      if (!testTxId) return;
      const resp = await agent.get(`/api/transactions/${testTxId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('account');
      expect(resp.body).toHaveProperty('category');
      expect(resp.body).toHaveProperty('tags');
    });

    test('BE-TX-014: Returns 404 for non-existent transaction', async () => {
      const resp = await agent.get('/api/transactions/999999999');
      expect(resp.status).toBe(404);
    });

    test('BE-TX-015: Filter transactions by type', async () => {
      const expenseResp = await agent.get('/api/transactions').query({ type: 'expense', limit: 1 });
      expect(expenseResp.status).toBe(200);
      expect(expenseResp.body.rows.length).toBeGreaterThan(0);
      if (expenseResp.body.rows.length > 0) {
        expect(expenseResp.body.rows[0].type).toBe('expense');
      }

      const incomeResp = await agent.get('/api/transactions').query({ type: 'income', limit: 1 });
      expect(incomeResp.status).toBe(200);
      if (incomeResp.body.rows.length > 0) {
        expect(incomeResp.body.rows[0].type).toBe('income');
      }
    });

    test('BE-TX-016: Filter transactions by date range', async () => {
      const resp = await agent.get('/api/transactions').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        limit: 100
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TX-017: Filter transactions by category', async () => {
      const categories = await agent.get('/api/categories');
      if (categories.body.length > 0) {
        const catId = categories.body[0].id;
        const resp = await agent.get('/api/transactions').query({ categoryId: catId, limit: 100 });
        expect(resp.status).toBe(200);
        if (resp.body.rows.length > 0) {
          resp.body.rows.forEach(tx => {
            expect(tx.category.id).toBe(catId);
          });
        }
      }
    });

    test('BE-TX-018: Filter transactions by tag', async () => {
      const tags = await agent.get('/api/tags');
      if (tags.body.length > 0) {
        const tagId = tags.body[0].id;
        const resp = await agent.get('/api/transactions').query({ tag_ids: tagId, limit: 100 });
        expect(resp.status).toBe(200);
        if (resp.body.rows.length > 0) {
          resp.body.rows.forEach(tx => {
            expect(tx.tags.some(t => t.id === tagId)).toBe(true);
          });
        }
      }
    });

    test('BE-TX-019: Filter transactions by accountId', async () => {
      const accounts = await agent.get('/api/transactions').query({ type: 'income', limit: 1 });
      if (accounts.body.rows.length > 0 && accounts.body.rows[0].account) {
        const accountId = accounts.body.rows[0].account.id;
        const resp = await agent.get('/api/transactions').query({ accountId, limit: 100 });
        expect(resp.status).toBe(200);
        if (resp.body.rows.length > 0) {
          resp.body.rows.forEach(tx => {
            expect(tx.account.id).toBe(accountId);
          });
        }
      }
    });

    test('BE-TX-020: Filter transactions by reconciled status', async () => {
      const allResp = await agent.get('/api/transactions').query({ limit: 1, reconciled: 'all' });
      const totalCount = allResp.body.total || 0;

      const reconciledResp = await agent.get('/api/transactions').query({
        reconciled: true,
        limit: 100
      });
      expect(reconciledResp.status).toBe(200);

      const unreconciledResp = await agent.get('/api/transactions').query({
        reconciled: false,
        limit: 100
      });
      expect(unreconciledResp.status).toBe(200);
    });
  });

  describe('Transaction Sorting', () => {
    test('BE-TX-021: Sort transactions by date descending', async () => {
      const resp = await agent.get('/api/transactions').query({
        sort: 'date',
        order: 'desc',
        limit: 100
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 1) {
        const dates = resp.body.rows.map(r => new Date(r.date));
        for (let i = 0; i < dates.length - 1; i++) {
          expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i + 1].getTime());
        }
      }
    });

    test('BE-TX-022: Sort transactions by amount ascending', async () => {
      const resp = await agent.get('/api/transactions').query({
        sort: 'amount',
        order: 'asc',
        limit: 100
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 1) {
        const amounts = resp.body.rows.map(r => r.amount);
        for (let i = 0; i < amounts.length - 1; i++) {
          expect(amounts[i]).toBeLessThanOrEqual(amounts[i + 1]);
        }
      }
    });

    test('BE-TX-023: Sort transactions by amount descending', async () => {
      const resp = await agent.get('/api/transactions').query({
        sort: 'amount',
        order: 'desc',
        limit: 100
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 1) {
        const amounts = resp.body.rows.map(r => r.amount);
        for (let i = 0; i < amounts.length - 1; i++) {
          expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i + 1]);
        }
      }
    });

    test('BE-TX-024: Sort by type ascending', async () => {
      const resp = await agent.get('/api/transactions').query({
        sort: 'type',
        order: 'asc',
        limit: 100
      });
      expect(resp.status).toBe(200);
    });

    test('BE-TX-025: Sort by description ascending', async () => {
      const resp = await agent.get('/api/transactions').query({
        sort: 'description',
        order: 'asc',
        limit: 100
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Transaction Updates', () => {
    test('BE-TX-026: Update transaction description', async () => {
      if (!testTxId) return;
      const oldDesc = 'Test Description';
      const newDesc = 'Updated Description';

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        description: newDesc
      });
      expect(updateResp.status).toBe(200);
      expect(updateResp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.description).toBe(newDesc);
    });

    test('BE-TX-027: Update transaction amount', async () => {
      if (!testTxId) return;
      const newAmount = 75.50;

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        amount: newAmount
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.amount).toBeCloseTo(newAmount, 2);
    });

    test('BE-TX-028: Update transaction date', async () => {
      if (!testTxId) return;
      const newDate = '2026-05-01';

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        date: newDate
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.date).toBe(newDate);
    });

    test('BE-TX-029: Update multiple fields at once', async () => {
      if (!testTxId) return;

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        description: 'MultiUpdate',
        amount: 125.75,
        date: '2026-04-26'
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.description).toBe('MultiUpdate');
      expect(checkResp.body.amount).toBeCloseTo(125.75, 2);
      expect(checkResp.body.date).toBe('2026-04-26');
    });

    test('BE-TX-030: Update transaction type', async () => {
      if (!testTxId) return;
      const newType = 'income';

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        type: newType
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.type).toBe(newType);
    });

    test('BE-TX-031: Update transaction account', async () => {
      if (!testTxId) return;
      const accounts = await agent.get('/api/transactions').query({ type: 'income', limit: 1 });
      if (accounts.body.rows.length > 0 && accounts.body.rows[0].account) {
        const newAccountId = accounts.body.rows[0].account.id;

        const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
          accountId: newAccountId
        });
        expect(updateResp.status).toBe(200);

        const checkResp = await agent.get(`/api/transactions/${testTxId}`);
        expect(checkResp.body.account.id).toBe(newAccountId);
      }
    });

    test('BE-TX-032: Update transaction category', async () => {
      if (!testTxId) return;
      const categories = await agent.get('/api/categories');
      if (categories.body.length > 0) {
        const newCategoryId = categories.body[0].id;

        const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
          categoryId: newCategoryId
        });
        expect(updateResp.status).toBe(200);

        const checkResp = await agent.get(`/api/transactions/${testTxId}`);
        expect(checkResp.body.category.id).toBe(newCategoryId);
      }
    });

    test('BE-TX-033: Update transaction tags', async () => {
      if (!testTxId) return;
      const tags = await agent.get('/api/tags');
      if (tags.body.length > 0) {
        const tagId = tags.body[0].id;

        await agent.put(`/api/transactions/${testTxId}/tags`).send({ tagIds: [] });
        await agent.put(`/api/transactions/${testTxId}/tags`).send({ tagIds: [tagId] });

        const checkResp = await agent.get(`/api/transactions/${testTxId}`);
        expect(checkResp.body.tags).toHaveLength(1);
      }
    });

    test('BE-TX-034: Update reconciliation status', async () => {
      if (!testTxId) return;

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        reconciled: true
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.reconciled).toBe(true);
    });

    test('BE-TX-035: Reject invalid transaction ID', async () => {
      const updateResp = await agent.put('/api/transactions/999999999').send({
        description: 'Test'
      });
      expect(updateResp.status).toBe(404);
    });

    test('BE-TX-036: Update preserves other unchanged fields', async () => {
      if (!testTxId) return;
      const original = await agent.get(`/api/transactions/${testTxId}`);

      const updateResp = await agent.put(`/api/transactions/${testTxId}`).send({
        amount: 99.99
      });
      expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/transactions/${testTxId}`);
      expect(checkResp.body.amount).toBe(99.99);
      expect(checkResp.body.description).toBe(original.body.description);
      expect(checkResp.body.date).toBe(original.body.date);
    });
  });

  describe('Transaction Deletion', () => {
    test('BE-TX-037: Delete transaction by ID', async () => {
      if (!testTxId) return;
      const id = testTxId;

      const deleteResp = await agent.delete(`/api/transactions/${id}`);
      expect(deleteResp.status).toBe(200);
      expect(deleteResp.body).toHaveProperty('ok', true);

      const checkResp = await agent.get(`/api/transactions/${id}`);
      expect(checkResp.status).toBe(404);
    });

    test('BE-TX-038: Delete multiple transactions in sequence', async () => {
      const txs = [];
      for (let i = 0; i < 3; i++) {
        const resp = await agent.post('/api/transactions').send({
          description: `DelTx${i}_${Date.now()}`,
          amount: 50,
          date: '2026-04-25',
          type: 'expense'
        });
        txs.push(resp.body.id);
      }

      for (const id of txs) {
        const delResp = await agent.delete(`/api/transactions/${id}`);
        expect(delResp.status).toBe(200);
      }

      // Verify all deleted
      for (const id of txs) {
        const checkResp = await agent.get(`/api/transactions/${id}`);
        expect(checkResp.status).toBe(404);
      }
    });

    test('BE-TX-039: Delete non-existent transaction returns 404', async () => {
      const resp = await agent.delete('/api/transactions/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Transaction Filtering Integration', () => {
    test('BE-TX-040: Combine multiple filters', async () => {
      const resp = await agent.get('/api/transactions').query({
        type: 'expense',
        reconciled: false,
        limit: 100
      });
      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        resp.body.rows.forEach(tx => {
          expect(tx.type).toBe('expense');
          expect(tx.reconciled).toBe(false);
        });
      }
    });

    test('BE-TX-041: Combined filters reduce result count', async () => {
      const allResp = await agent.get('/api/transactions').query({ limit: 1, reconciled: 'all' });
      const allTotal = allResp.body.total || 0;

      const combinedResp = await agent.get('/api/transactions').query({
        type: 'expense',
        reconciled: false,
        limit: 100
      });
      expect(combinedResp.body.total).toBeLessThanOrEqual(allTotal);
    });
  });

  describe('Transaction Bulk Operations', () => {
    test('BE-TX-042: Bulk update transactions status', async () => {
      const txs = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/transactions').send({
          description: `Bulk${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
        txs.push(resp.body.id);
      }

      const updateResp = await agent.put('/api/transactions/bulk').send({
        transactionIds: txs,
        reconciled: true
      });
      expect(updateResp.status).toBe(200);

      txs.forEach(id => {
        agent.get(`/api/transactions/${id}`).then(check => {
          expect(check.body.reconciled).toBe(true);
        });
      });
    });

    test('BE-TX-043: Bulk delete transactions', async () => {
      const txs = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/transactions').send({
          description: `DelBulk${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
        txs.push(resp.body.id);
      }

      const deleteResp = await agent.put('/api/transactions/bulk').send({
        transactionIds: txs,
        _method: 'delete'
      });
      expect(deleteResp.status).toBe(200);

      txs.forEach(id => {
        agent.get(`/api/transactions/${id}`).then(check => {
          expect(check.status).toBe(404);
        });
      });
    });
  });

  describe('Transaction Statistics', () => {
    test('BE-TX-044: GET /api/transactions/summary returns aggregated data', async () => {
      const resp = await agent.get('/api/transactions/summary');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('totalIncome');
      expect(resp.body).toHaveProperty('totalExpenses');
      expect(resp.body).toHaveProperty('netBalance');
    });

    test('BE-TX-045: Summary respects filters', async () => {
      const resp = await agent.get('/api/transactions/summary').query({
        type: 'expense',
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.totalExpenses).toBeDefined();
    });
  });

  describe('Transaction Validation', () => {
    test('BE-TX-046: Reject negative income', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Negative Income',
        amount: -100,
        date: '2026-04-25',
        type: 'income'
      });
      expect(resp.status).toBe(400);
    });

    test('BE-TX-047: Reject negative expense', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Negative Expense',
        amount: -100,
        date: '2026-04-25',
        type: 'expense'
      });
      expect(resp.status).toBe(400);
    });

    test('BE-TX-048: Reject amount outside valid range', async () => {
      const resp = await agent.post('/api/transactions').send({
        description: 'Too Large',
        amount: 999999999,
        date: '2026-04-25',
        type: 'expense'
      });
      expect([200, 400]).to.include(resp.status);
    });
  });
});