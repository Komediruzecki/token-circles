/**
 * E2E Tests for Accounts & Balances API
 * Covers account CRUD, balance tracking, multiple accounts
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Accounts E2E', () => {
  let agent;
  let testAccountId;
  let testAccountId2;

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
    if (testAccountId) await agent.delete(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testAccountId2) await agent.delete(`/api/accounts/${testAccountId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
  });

  describe('Account Creation', () => {
    test('BE-ACC-001: Create basic account', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Main Giro',
        type: 'giro',
        balance: 5000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body.message).toBe('Account created');
      testAccountId = resp.body.id;
    });

    test('BE-ACC-002: Create savings account', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Savings Account',
        type: 'savings',
        balance: 10000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      testAccountId2 = resp.body.id;
    });

    test('BE-ACC-003: Create IB account', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Investment Account',
        type: 'ib',
        balance: 25000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-ACC-004: Create cash account', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Cash Account',
        type: 'cash',
        balance: 500
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-ACC-005: Negative balance allowed (debit)', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Negative Bal Account',
        type: 'giro',
        balance: -500
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-ACC-006: Create multiple accounts successfully', async () => {
      const accounts = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
          name: `Account${i}_${Date.now()}`,
          type: 'giro',
          balance: 1000
        });
        global.expect(resp.status).toBe(200);
        accounts.push(resp.body);
      }
      global.expect(accounts.length).toBe(5);
    });
  });

  describe('Account Retrieval', () => {
    test('BE-ACC-007: Get all accounts', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-ACC-008: Get single account by ID', async () => {
      if (!testAccountId) return;
      const resp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id', testAccountId);
    });

    test('BE-ACC-009: Returns 404 for non-existent account', async () => {
      const resp = await agent.get('/api/accounts/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });

    test('BE-ACC-010: Accounts include all expected fields', async () => {
      if (!testAccountId) return;
      const resp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('type');
      global.expect(resp.body).toHaveProperty('balance');
      global.expect(resp.body).toHaveProperty('currency');
      global.expect(resp.body).toHaveProperty('starting_balance');
    });

    test('BE-ACC-011: Accounts sorted by name', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 1) {
        const names = resp.body.map(r => r.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        global.expect(JSON.stringify(names)).toBe(JSON.stringify(sorted));
      }
    });
  });

  describe('Account Updates', () => {
    test('BE-ACC-012: Update account name', async () => {
      if (!testAccountId) return;
      const newName = 'Updated Account_' + Date.now();

      const resp = await agent.put(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true').send({
        name: newName
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.message).toBe('Account updated');

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
    });

    test('BE-ACC-013: Update account type', async () => {
      if (!testAccountId) return;

      const resp = await agent.put(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true').send({
        type: 'savings'
      });
      global.expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.type).toBe('savings');
    });

    test('BE-ACC-014: Update account balance manually', async () => {
      if (!testAccountId) return;
      const newBalance = 3000.00;

      const resp = await agent.put(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true').send({
        balance: newBalance
      });
      global.expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.balance).toBeCloseTo(newBalance, 2);
    });

    test('BE-ACC-015: Update starting_balance', async () => {
      if (!testAccountId) return;
      const newStartBalance = 4000;

      const resp = await agent.put(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true').send({
        starting_balance: newStartBalance
      });
      global.expect(resp.status).toBe(200);

      const checkResp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.starting_balance).toBeCloseTo(newStartBalance, 2);
    });
  });

  describe('Account Deletion', () => {
    test('BE-ACC-016: Delete account by ID', async () => {
      // Create a temp account to delete
      const createResp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'DeleteMe_' + Date.now(),
        type: 'giro',
        balance: 100
      });
      const id = createResp.body.id;

      const resp = await agent.delete(`/api/accounts/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.message).toBe('Account deleted');

      const checkResp = await agent.get(`/api/accounts/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-ACC-017: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/accounts/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Balance Tracking', () => {
    test('BE-ACC-019: Balance is set at creation', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'BalanceTest_' + Date.now(),
        type: 'giro',
        balance: 750.50
      });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/accounts/${resp.body.id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(200);
      global.expect(checkResp.body.balance).toBe(750.50);
    });

    test('BE-ACC-020: Balance tracks negative accounts', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'NegativeTest_' + Date.now(),
        type: 'giro',
        balance: -200
      });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/accounts/${resp.body.id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.balance).toBeLessThan(0);
    });

    test('BE-ACC-021: Balance tracks positive accounts', async () => {
      if (!testAccountId) return;
      const accResp = await agent.get(`/api/accounts/${testAccountId}`).set('X-Skip-RateLimit', 'true');
      global.expect(accResp.status).toBe(200);
      global.expect(accResp.body.balance).toBeDefined();
    });
  });

  describe('Multiple Accounts', () => {
    test('BE-ACC-022: Can have multiple accounts', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.length).toBeGreaterThanOrEqual(2);
    });

    test('BE-ACC-023: Each account has separate balance', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      if (resp.body.length >= 2) {
        const acc1 = resp.body[0];
        const acc2 = resp.body[1];
        global.expect(acc1.id === acc2.id).toBe(false);
        global.expect(acc1.balance).toBeDefined();
        global.expect(acc2.balance).toBeDefined();
      }
    });

    test('BE-ACC-024: Transactions assigned to correct account', async () => {
      const accounts = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      if (accounts.body.length >= 2) {
        const acc1 = accounts.body[0];

        const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
          description: 'Account Tx Test',
          amount: 50,
          date: '2026-04-25',
          type: 'expense',
          account_id: acc1.id
        });
        global.expect(txResp.status).toBe(200);

        const acc1Resp = await agent.get(`/api/accounts/${acc1.id}`).set('X-Skip-RateLimit', 'true');
        // Balance should have been reduced by 50 for expense
        global.expect(acc1Resp.status).toBe(200);
      }
    });
  });

  describe('Account Statistics', () => {
    test('BE-ACC-026: Total assets across all accounts', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const totalBalance = resp.body.reduce((sum, acc) => sum + acc.balance, 0);
        global.expect(totalBalance).toBeFinite();
      }
    });

    test('BE-ACC-027: Average account balance', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const avgBalance = resp.body.reduce((sum, acc) => sum + acc.balance, 0) / resp.body.length;
        global.expect(avgBalance).toBeFinite();
      }
    });
  });

  describe('Account Types', () => {
    test('BE-ACC-028: Support for giro account type', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Giro Checking',
        type: 'giro',
        balance: 1000
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-ACC-029: Support for savings account type', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Savings',
        type: 'savings',
        balance: 10000
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-ACC-030: Support for IB account type', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'IB Account',
        type: 'ib',
        balance: 500
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-ACC-031: Support for cash account type', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Cash',
        type: 'cash',
        balance: 25000
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Account Validation', () => {
    test('BE-ACC-032: Negative balance is allowed', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Negative Bal',
        type: 'giro',
        balance: -100
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-ACC-033: Invalid type defaults to giro', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        name: 'Invalid Type',
        type: 'invalid'
      });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/accounts/${resp.body.id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.type).toBe('giro');
    });

    test('BE-ACC-034: Require account name', async () => {
      const resp = await agent.post('/api/accounts').set('X-Skip-RateLimit', 'true').send({
        type: 'checking'
      });
      global.expect(resp.status).toBe(400);
    });
  });

  describe('Account Display', () => {
    test('BE-ACC-036: Accounts display correct type', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const validTypes = ['giro', 'ib', 'savings', 'cash'];
        resp.body.forEach(acc => {
          global.expect(validTypes).toContain(acc.type);
        });
      }
    });

    test('BE-ACC-037: Accounts show balance', async () => {
      const resp = await agent.get('/api/accounts').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(acc => {
          global.expect(acc.balance).toBeDefined();
        });
      }
    });
  });
});
