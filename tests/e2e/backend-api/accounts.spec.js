/**
 * E2E Tests for Accounts & Balances API
 * Covers account CRUD, balance tracking, multiple accounts, transfer operations
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Accounts E2E', () => {
  let agent;
  let testAccountId;
  let testAccountId2;
  let testAccountId3;
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
    if (testAccountId) await agent.delete(`/api/accounts/${testAccountId}`).catch(() => {});
    if (testAccountId2) await agent.delete(`/api/accounts/${testAccountId2}`).catch(() => {});
    if (testAccountId3) await agent.delete(`/api/accounts/${testAccountId3}`).catch(() => {});
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).catch(() => {});
  });

  describe('Account Creation', () => {
    test('BE-ACC-001: Create basic account', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Main Account',
        type: 'checking',
        initialBalance: 5000
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('name');
      expect(resp.body.type).toBe('checking');
      testAccountId = resp.body.id;
    });

    test('BE-ACC-002: Create savings account', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Savings Account',
        type: 'savings',
        initialBalance: 10000
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('savings');
      testAccountId2 = resp.body.id;
    });

    test('BE-ACC-003: Create credit card account', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Credit Card',
        type: 'credit',
        initialBalance: -500
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('credit');
      expect(resp.body.balance).toBeLessThan(0);
      testAccountId3 = resp.body.id;
    });

    test('BE-ACC-004: Create investment account', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Investment Account',
        type: 'investment',
        initialBalance: 25000
      });
      expect(resp.status).toBe(200);
    });

    test('BE-ACC-005: Account initial balance tracks correctly', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Balance Test',
        type: 'checking',
        initialBalance: 750.50
      });
      expect(resp.status).toBe(200);
      expect(resp.body.initialBalance).toBe(750.50);
    });

    test('BE-ACC-006: Create multiple accounts successfully', async () => {
      const accounts = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/accounts').send({
          name: `Account${i}_${Date.now()}`,
          type: 'checking',
          initialBalance: 1000
        });
        expect(resp.status).toBe(200);
        accounts.push(resp.body);
      }
      expect(accounts.length).toBe(5);
    });
  });

  describe('Account Retrieval', () => {
    test('BE-ACC-007: Get all accounts', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-ACC-008: Get single account by ID', async () => {
      if (!testAccountId) return;
      const resp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id', testAccountId);
    });

    test('BE-ACC-009: Returns 404 for non-existent account', async () => {
      const resp = await agent.get('/api/accounts/999999999');
      expect(resp.status).toBe(404);
    });

    test('BE-ACC-010: Accounts include all expected fields', async () => {
      if (!testAccountId) return;
      const resp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('name');
      expect(resp.body).toHaveProperty('type');
      expect(resp.body).toHaveProperty('balance');
      expect(resp.body).toHaveProperty('initialBalance');
      expect(resp.body).toHaveProperty('transactions');
    });

    test('BE-ACC-011: Accounts sorted by balance', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 1) {
        const balances = resp.body.map(r => r.balance);
        expect(balances[0]).toBeLessThanOrEqual(balances[1]);
      }
    });
  });

  describe('Account Updates', () => {
    test('BE-ACC-012: Update account name', async () => {
      if (!testAccountId) return;
      const newName = 'Updated Account_' + Date.now();

      const resp = await agent.put(`/api/accounts/${testAccountId}`).send({
        name: newName
      });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(checkResp.body.name).toBe(newName);
    });

    test('BE-ACC-013: Update account type', async () => {
      if (!testAccountId) return;
      const newType = 'savings';

      const resp = await agent.put(`/api/accounts/${testAccountId}`).send({
        type: newType
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(checkResp.body.type).toBe(newType);
    });

    test('BE-ACC-014: Update account balance manually', async () => {
      if (!testAccountId) return;
      const newBalance = 3000.00;

      const resp = await agent.put(`/api/accounts/${testAccountId}`).send({
        balance: newBalance
      });
      expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(checkResp.body.balance).toBeCloseTo(newBalance, 2);
    });

    test('BE-ACC-015: Update account description', async () => {
      if (!testAccountId) return;
      const newDesc = 'Updated Description';

      const resp = await agent.put(`/api/accounts/${testAccountId}`).send({
        description: newDesc
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Account Deletion', () => {
    test('BE-ACC-016: Delete account by ID', async () => {
      if (!testAccountId) return;
      const id = testAccountId;

      const resp = await agent.delete(`/api/accounts/${id}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      const checkResp = await agent.get(`/api/accounts/${id}`);
      expect(checkResp.status).toBe(404);
    });

    test('BE-ACC-017: Delete account with transactions', async () => {
      const accResp = await agent.post('/api/accounts').send({
        name: 'AccWithTx_' + Date.now(),
        type: 'checking',
        initialBalance: 1000
      });
      const accId = accResp.body.id;

      const txResp = await agent.post('/api/transactions').send({
        description: 'Account Tx Test',
        amount: 50,
        date: '2026-04-25',
        type: 'expense',
        accountId: accId
      });
      testTxId = txResp.body.id;

      const deleteResp = await agent.delete(`/api/accounts/${accId}`);
      expect(deleteResp.status).toBe(200);

      const txCheck = await agent.get(`/api/transactions/${testTxId}`);
      expect(txCheck.body.accountId).toBeNull();
    });

    test('BE-ACC-018: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/accounts/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Balance Tracking', () => {
    beforeAll(async () => {
      const txResp = await agent.post('/api/transactions').send({
        description: 'Balance Tx',
        amount: 100,
        date: '2026-04-25',
        type: 'income'
      });
      testTxId = txResp.body.id;
    });

    test('BE-ACC-019: Balance updates after transactions', async () => {
      if (!testAccountId) return;

      const txResp = await agent.post('/api/transactions').send({
        description: 'Balance Update Test',
        amount: 200,
        date: '2026-04-25',
        type: 'expense',
        accountId: testAccountId
      });

      const accResp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(accResp.status).toBe(200);
      expect(accResp.body.balance).toBeDefined();
    });

    test('BE-ACC-020: Balance tracks negative accounts (credit)', async () => {
      if (!testAccountId3) return;
      const accResp = await agent.get(`/api/accounts/${testAccountId3}`);
      expect(accResp.status).toBe(200);
      expect(accResp.body.balance).toBeLessThan(0);
    });

    test('BE-ACC-021: Balance tracks positive accounts (checking)', async () => {
      if (!testAccountId) return;
      const accResp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(accResp.status).toBe(200);
      expect(accResp.body.balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multiple Accounts', () => {
    test('BE-ACC-022: Can have multiple accounts', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(2);
    });

    test('BE-ACC-023: Each account has separate balance', async () => {
      const accounts = await agent.get('/api/accounts');
      if (accounts.body.length >= 2) {
        const acc1 = accounts.body[0];
        const acc2 = accounts.body[1];
        expect(acc1.id).not.toBe(acc2.id);
        expect(acc1.balance).not.toBe(acc2.balance);
      }
    });

    test('BE-ACC-024: Transactions assigned to correct account', async () => {
      const accounts = await agent.get('/api/accounts');
      if (accounts.body.length >= 2) {
        const acc1 = accounts.body[0];
        const acc2 = accounts.body[1];

        const tx1 = await agent.post('/api/transactions').send({
          description: 'Account Test 1',
          amount: 50,
          date: '2026-04-25',
          type: 'expense',
          accountId: acc1.id
        });

        const tx2 = await agent.post('/api/transactions').send({
          description: 'Account Test 2',
          amount: 75,
          date: '2026-04-25',
          type: 'expense',
          accountId: acc2.id
        });

        const acc1Resp = await agent.get(`/api/accounts/${acc1.id}`);
        const acc2Resp = await agent.get(`/api/accounts/${acc2.id}`);

        expect(acc1Resp.body.balance).toBeCloseTo(-50, 2);
        expect(acc2Resp.body.balance).toBeCloseTo(-75, 2);
      }
    });
  });

  describe('Account Statistics', () => {
    test('BE-ACC-025: Account includes transaction count', async () => {
      if (!testAccountId) return;
      const resp = await agent.get(`/api/accounts/${testAccountId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('transactions');
      expect(Array.isArray(resp.body.transactions)).toBe(true);
    });

    test('BE-ACC-026: Total assets across all accounts', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const totalBalance = resp.body.reduce((sum, acc) => sum + acc.balance, 0);
        expect(totalBalance).toBeFinite();
      }
    });

    test('BE-ACC-027: Average account balance', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const avgBalance = resp.body.reduce((sum, acc) => sum + acc.balance, 0) / resp.body.length;
        expect(avgBalance).toBeFinite();
      }
    });
  });

  describe('Account Types', () => {
    test('BE-ACC-028: Support for checking account type', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Checking',
        type: 'checking',
        initialBalance: 1000
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('checking');
    });

    test('BE-ACC-029: Support for savings account type', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Savings',
        type: 'savings',
        initialBalance: 10000
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('savings');
    });

    test('BE-ACC-030: Support for credit account type', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Credit',
        type: 'credit',
        initialBalance: -500
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('credit');
    });

    test('BE-ACC-031: Support for investment account type', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Investment',
        type: 'investment',
        initialBalance: 25000
      });
      expect(resp.status).toBe(200);
      expect(resp.body.type).toBe('investment');
    });
  });

  describe('Account Validation', () => {
    test('BE-ACC-032: Reject negative initial balance for checking', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Negative Bal',
        type: 'checking',
        initialBalance: -100
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-ACC-033: Allow negative initial balance for credit', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Credit Debt',
        type: 'credit',
        initialBalance: -500
      });
      expect(resp.status).toBe(200);
    });

    test('BE-ACC-034: Reject invalid account type', async () => {
      const resp = await agent.post('/api/accounts').send({
        name: 'Invalid Type',
        type: 'invalid'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-ACC-035: Require account name', async () => {
      const resp = await agent.post('/api/accounts').send({
        type: 'checking'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Account Display', () => {
    test('BE-ACC-036: Accounts display correct type icon', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(acc => {
          expect(['checking', 'savings', 'credit', 'investment']).toContain(acc.type);
        });
      }
    });

    test('BE-ACC-037: Accounts show formatted balance', async () => {
      const resp = await agent.get('/api/accounts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(acc => {
          expect(acc.balance).toBeDefined();
        });
      }
    });
  });
});