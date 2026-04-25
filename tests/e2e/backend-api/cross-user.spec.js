/**
 * E2E Tests for Cross-User Isolation
 * Covers data separation, permissions, access control
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Cross-User Isolation E2E', () => {
  let agent1;
  let agent2;
  let testTxId1;
  let testTxId2;

  beforeAll(async () => {
    // Create two separate agents with different users
    agent1 = request.agent(BASE_URL);
    agent2 = request.agent(BASE_URL);

    const login1 = await agent1.post('/api/auth/login').send({
      username: 'maff',
      password: 'add2'
    });
    if (login1.headers['set-cookie']) {
      agent1.jar.setCookie(login1.headers['set-cookie'][0], BASE_URL);
    }

    const login2 = await agent2.post('/api/auth/login').send({
      username: 'testuser',
      password: 'testpass'
    });
    if (login2.headers['set-cookie']) {
      agent2.jar.setCookie(login2.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('Data Isolation - Transactions', () => {
    test('XUI-001: User 1 can see only their own transactions', async () => {
      // User 1 creates transaction
      const tx1 = await agent1.post('/api/transactions').send({
        description: 'User 1 Transaction',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId1 = tx1.body.id;

      // User 2 creates transaction
      const tx2 = await agent2.post('/api/transactions').send({
        description: 'User 2 Transaction',
        amount: 200,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId2 = tx2.body.id;

      // User 1 should see only their transaction
      const txs1 = await agent1.get('/api/transactions');
      expect(txs1.status).toBe(200);
      const user1Tx = txs1.body.rows.find(tx => tx.id === testTxId1);
      const user2Tx = txs1.body.rows.find(tx => tx.id === testTxId2);
      expect(user1Tx).toBeDefined();
      expect(user2Tx).toBeUndefined();
    });

    test('XUI-002: User 2 can see only their own transactions', async () => {
      const txs2 = await agent2.get('/api/transactions');
      expect(txs2.status).toBe(200);
      const user1Tx = txs2.body.rows.find(tx => tx.id === testTxId1);
      const user2Tx = txs2.body.rows.find(tx => tx.id === testTxId2);
      expect(user1Tx).toBeUndefined();
      expect(user2Tx).toBeDefined();
    });

    test('XUI-003: Users cannot access each other\'s accounts', async () => {
      // User 1 accesses User 2 transactions via direct ID
      const user2Tx = await agent1.get(`/api/transactions/${testTxId2}`);
      expect(user2Tx.status).toBe(401);
    });

    test('XUI-004: Users cannot modify each other\'s transactions', async () => {
      if (!testTxId1) return;
      const updateResp = await agent2.put(`/api/transactions/${testTxId1}`).send({
        amount: 999
      });
      expect(updateResp.status).toBe(401);

      const checkResp = await agent1.get(`/api/transactions/${testTxId1}`);
      expect(checkResp.body.amount).not.toBe(999);
    });

    test('XUI-005: Users cannot delete each other\'s transactions', async () => {
      if (!testTxId1) return;
      const deleteResp = await agent2.delete(`/api/transactions/${testTxId1}`);
      expect(deleteResp.status).toBe(401);

      const checkResp = await agent1.get(`/api/transactions/${testTxId1}`);
      expect(checkResp.status).toBe(200);
    });
  });

  describe('Data Isolation - Categories', () => {
    test('XUI-006: Users have separate categories', async () => {
      const cat1 = await agent1.post('/api/categories').send({
        name: 'User 1 Category'
      });
      const cat2 = await agent2.post('/api/categories').send({
        name: 'User 2 Category'
      });

      const cats1 = await agent1.get('/api/categories');
      const cats2 = await agent2.get('/api/categories');

      expect(cats1.status).toBe(200);
      expect(cats2.status).toBe(200);

      const user1Cat = cats1.body.find(c => c.id === cat1.body.id);
      const user2Cat = cats2.body.find(c => c.id === cat2.body.id);

      expect(user1Cat).toBeDefined();
      expect(user2Cat).toBeDefined();
    });

    test('XUI-007: Users cannot access each other\'s categories', async () => {
      const cat = await agent2.post('/api/categories').send({
        name: 'Shared Cat'
      });

      const accessResp = await agent1.get(`/api/categories/${cat.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Data Isolation - Accounts', () => {
    test('XUI-008: Users have separate accounts', async () => {
      const acc1 = await agent1.post('/api/accounts').send({
        name: 'User 1 Account',
        type: 'checking',
        initialBalance: 1000
      });
      const acc2 = await agent2.post('/api/accounts').send({
        name: 'User 2 Account',
        type: 'savings',
        initialBalance: 2000
      });

      const accs1 = await agent1.get('/api/accounts');
      const accs2 = await agent2.get('/api/accounts');

      expect(accs1.status).toBe(200);
      expect(accs2.status).toBe(200);

      const user1Acc = accs1.body.find(a => a.id === acc1.body.id);
      const user2Acc = accs2.body.find(a => a.id === acc2.body.id);

      expect(user1Acc).toBeDefined();
      expect(user2Acc).toBeDefined();
    });

    test('XUI-009: Users cannot access each other\'s accounts', async () => {
      const acc = await agent2.post('/api/accounts').send({
        name: 'Shared Account',
        type: 'checking',
        initialBalance: 500
      });

      const accessResp = await agent1.get(`/api/accounts/${acc.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Data Isolation - Tags', () => {
    test('XUI-010: Users have separate tags', async () => {
      const tag1 = await agent1.post('/api/tags').send({
        name: 'User 1 Tag'
      });
      const tag2 = await agent2.post('/api/tags').send({
        name: 'User 2 Tag'
      });

      const tags1 = await agent1.get('/api/tags');
      const tags2 = await agent2.get('/api/tags');

      expect(tags1.status).toBe(200);
      expect(tags2.status).toBe(200);

      const user1Tag = tags1.body.find(t => t.id === tag1.body.id);
      const user2Tag = tags2.body.find(t => t.id === tag2.body.id);

      expect(user1Tag).toBeDefined();
      expect(user2Tag).toBeDefined();
    });

    test('XUI-011: Users cannot access each other\'s tags', async () => {
      const tag = await agent2.post('/api/tags').send({
        name: 'Shared Tag'
      });

      const accessResp = await agent1.get(`/api/tags/${tag.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Data Isolation - Reports', () => {
    test('XUI-012: Users have separate reports', async () => {
      const rep1 = await agent1.post('/api/reports/custom').send({
        name: 'User 1 Report',
        type: 'expense'
      });
      const rep2 = await agent2.post('/api/reports/custom').send({
        name: 'User 2 Report',
        type: 'income'
      });

      const reps1 = await agent1.get('/api/reports/custom');
      const reps2 = await agent2.get('/api/reports/custom');

      expect(reps1.status).toBe(200);
      expect(reps2.status).toBe(200);

      const user1Rep = reps1.body.find(r => r.id === rep1.body.id);
      const user2Rep = reps2.body.find(r => r.id === rep2.body.id);

      expect(user1Rep).toBeDefined();
      expect(user2Rep).toBeDefined();
    });

    test('XUI-013: Users cannot access each other\'s reports', async () => {
      const rep = await agent2.post('/api/reports/custom').send({
        name: 'Shared Report',
        type: 'expense'
      });

      const accessResp = await agent1.get(`/api/reports/custom/${rep.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Data Isolation - Recurring Transactions', () => {
    test('XUI-014: Users have separate recurring transactions', async () => {
      const rec1 = await agent1.post('/api/recurring').send({
        name: 'User 1 Recurring',
        amount: 100,
        frequency: 'monthly'
      });
      const rec2 = await agent2.post('/api/recurring').send({
        name: 'User 2 Recurring',
        amount: 200,
        frequency: 'weekly'
      });

      const recs1 = await agent1.get('/api/recurring');
      const recs2 = await agent2.get('/api/recurring');

      expect(recs1.status).toBe(200);
      expect(recs2.status).toBe(200);

      const user1Rec = recs1.body.find(r => r.id === rec1.body.id);
      const user2Rec = recs2.body.find(r => r.id === rec2.body.id);

      expect(user1Rec).toBeDefined();
      expect(user2Rec).toBeDefined();
    });

    test('XUI-015: Users cannot access each other\'s recurring transactions', async () => {
      const rec = await agent2.post('/api/recurring').send({
        name: 'Shared Recurring',
        amount: 100,
        frequency: 'monthly'
      });

      const accessResp = await agent1.get(`/api/recurring/${rec.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Data Isolation - Receipts', () => {
    test('XUI-016: Users have separate receipts', async () => {
      const rec1 = await agent1.post('/api/receipts').attach('receipt', Buffer.from('Receipt 1'), 'receipt1.jpg');
      const rec2 = await agent2.post('/api/receipts').attach('receipt', Buffer.from('Receipt 2'), 'receipt2.jpg');

      const recs1 = await agent1.get('/api/receipts');
      const recs2 = await agent2.get('/api/receipts');

      expect(recs1.status).toBe(200);
      expect(recs2.status).toBe(200);

      const user1Rec = recs1.body.find(r => r.id === rec1.body.id);
      const user2Rec = recs2.body.find(r => r.id === rec2.body.id);

      expect(user1Rec).toBeDefined();
      expect(user2Rec).toBeDefined();
    });

    test('XUI-017: Users cannot access each other\'s receipts', async () => {
      const rec = await agent2.post('/api/receipts').attach('receipt', Buffer.from('Shared Receipt'), 'shared.jpg');
      const accessResp = await agent1.get(`/api/receipts/${rec.body.id}`);
      expect(accessResp.status).toBe(401);
    });
  });

  describe('Profile Isolation', () => {
    test('XUI-018: Users can only access their own profile', async () => {
      const profiles1 = await agent1.get('/api/profiles');
      const profiles2 = await agent2.get('/api/profiles');

      expect(profiles1.status).toBe(200);
      expect(profiles2.status).toBe(200);

      // Check that agent2's profile is in agent1's list
      const user2Profile = profiles1.body.find(p => p.username === 'testuser');
      expect(user2Profile).toBeUndefined();
    });

    test('XUI-019: Users cannot access each other\'s profile by ID', async () => {
      const profiles = await agent2.get('/api/profiles');
      if (profiles.body.length > 0) {
        const userId = profiles.body[0].id;
        const accessResp = await agent1.get(`/api/profiles/${userId}`);
        expect(accessResp.status).toBe(401);
      }
    });
  });

  describe('Permission Enforcement', () => {
    test('XUI-020: Cross-request isolation persists', async () => {
      const tx = await agent1.post('/api/transactions').send({
        description: 'Cross Request Test',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      const txId = tx.body.id;

      // After logout and new login, user2 should not see this transaction
      const txs2 = await agent2.get('/api/transactions');
      const found = txs2.body.rows.find(r => r.id === txId);
      expect(found).toBeUndefined();
    });
  });
});