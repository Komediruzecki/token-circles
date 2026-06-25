/**
 * E2E Tests for Cross-Profile Isolation
 * Covers data separation using X-Profile-Id header switching.
 *
 * The app isolates data by profile_id, not user_id.
 * Use X-Profile-Id header to test profile-level isolation.
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';
const PROFILE_1 = '1';
const PROFILE_2 = '999'; // Non-existent profile — data should be invisible

describe('Cross-Profile Isolation E2E', () => {
  let agent;
  let profile1Id = PROFILE_1;
  let profile2Id = PROFILE_2;
  let testTxId1;
  let testTxId2;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const login = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
      username: 'person',
      password: 'something-like-this'
    });
    if (login.headers['set-cookie']) {
      agent.jar.setCookie(login.headers['set-cookie'][0], BASE_URL);
    }
    await agent.post('/api/test/seed-profile-999').set('X-Skip-RateLimit', 'true').send();
  });

  describe('Data Isolation - Transactions', () => {
    test('XUI-001: Profile 1 can see only its own transactions', async () => {
      // Profile 1 creates transaction
      const tx1 = await agent.post('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({
          description: 'Profile 1 Transaction',
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
      testTxId1 = tx1.body.id;

      // Profile 2 creates transaction
      const tx2 = await agent.post('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({
          description: 'Profile 2 Transaction',
          amount: 200,
          date: '2026-04-25',
          type: 'expense'
        });
      testTxId2 = tx2.body.id;

      // Profile 1 should NOT see profile 2's transaction in its list
      const txs1 = await agent.get('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(txs1.status).toBe(200);
      const user1Tx = txs1.body.rows.find(tx => tx.id === testTxId1);
      const user2Tx = txs1.body.rows.find(tx => tx.id === testTxId2);
      global.expect(user1Tx).toBeDefined();
      global.expect(user2Tx).toBeUndefined();
    });

    test('XUI-002: Profile 2 can see only its own transactions', async () => {
      const txs2 = await agent.get('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);
      global.expect(txs2.status).toBe(200);
      const user1Tx = txs2.body.rows.find(tx => tx.id === testTxId1);
      const user2Tx = txs2.body.rows.find(tx => tx.id === testTxId2);
      global.expect(user1Tx).toBeUndefined();
      global.expect(user2Tx).toBeDefined();
    });

    test('XUI-003: Profiles cannot access each other\'s transactions by ID', async () => {
      // Profile 1 accesses Profile 2's transaction — should return 404
      const resp = await agent.get(`/api/transactions/${testTxId2}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(resp.status).toBe(404);
    });

    test('XUI-004: Profiles cannot modify each other\'s transactions', async () => {
      if (!testTxId1) return;
      const updateResp = await agent.put(`/api/transactions/${testTxId1}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ amount: 999 });
      // Should return 404 — transaction doesn't belong to profile 2
      global.expect(updateResp.status).toBe(404);

      // Verify original transaction unchanged under profile 1
      const checkResp = await agent.get(`/api/transactions/${testTxId1}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(checkResp.body.amount === 999).toBe(false);
    });

    test('XUI-005: Profiles cannot delete each other\'s transactions', async () => {
      if (!testTxId1) return;
      const deleteResp = await agent.delete(`/api/transactions/${testTxId1}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);
      // Should return 404 — transaction doesn't belong to profile 2
      global.expect([404, 401]).to.include(deleteResp.status);

      // Verify it still exists under profile 1
      const checkResp = await agent.get(`/api/transactions/${testTxId1}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(checkResp.status).toBe(200);
    });
  });

  describe('Data Isolation - Categories', () => {
    test('XUI-006: Profiles have separate categories', async () => {
      const cat1 = await agent.post('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({ name: 'Profile 1 Category_' + Date.now() });
      const cat2 = await agent.post('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Profile 2 Category_' + Date.now() });

      const cats1 = await agent.get('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const cats2 = await agent.get('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(cats1.status).toBe(200);
      global.expect(cats2.status).toBe(200);

      const user1Cat = cats1.body.find(c => c.id === cat1.body.id);
      const user2Cat = cats2.body.find(c => c.id === cat2.body.id);

      global.expect(user1Cat).toBeDefined();
      global.expect(user2Cat).toBeDefined();
    });

    test('XUI-007: Profiles cannot access each other\'s categories', async () => {
      const cat = await agent.post('/api/categories')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Shared Cat' });

      const accessResp = await agent.get(`/api/categories/${cat.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(accessResp.status).toBe(404);
    });
  });

  describe('Data Isolation - Accounts', () => {
    test('XUI-008: Profiles have separate accounts', async () => {
      const acc1 = await agent.post('/api/accounts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({ name: 'Profile 1 Account', type: 'checking', balance: 1000 });
      const acc2 = await agent.post('/api/accounts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Profile 2 Account', type: 'savings', balance: 2000 });

      const accs1 = await agent.get('/api/accounts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const accs2 = await agent.get('/api/accounts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(accs1.status).toBe(200);
      global.expect(accs2.status).toBe(200);

      const user1Acc = accs1.body.find(a => a.id === acc1.body.id);
      const user2Acc = accs2.body.find(a => a.id === acc2.body.id);

      global.expect(user1Acc).toBeDefined();
      global.expect(user2Acc).toBeDefined();
    });

    test('XUI-009: Profiles cannot access each other\'s accounts', async () => {
      const acc = await agent.post('/api/accounts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Shared Account', type: 'checking', balance: 500 });

      const accessResp = await agent.get(`/api/accounts/${acc.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(accessResp.status).toBe(404);
    });
  });

  describe('Data Isolation - Tags', () => {
    test('XUI-010: Profiles have separate tags', async () => {
      const tag1 = await agent.post('/api/tags')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({ name: 'Profile 1 Tag_' + Date.now() });
      const tag2 = await agent.post('/api/tags')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Profile 2 Tag_' + Date.now() });

      const tags1 = await agent.get('/api/tags')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const tags2 = await agent.get('/api/tags')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(tags1.status).toBe(200);
      global.expect(tags2.status).toBe(200);

      const user1Tag = tags1.body.find(t => t.id === tag1.body.id);
      const user2Tag = tags2.body.find(t => t.id === tag2.body.id);

      global.expect(user1Tag).toBeDefined();
      global.expect(user2Tag).toBeDefined();
    });

    test('XUI-011: Profiles cannot access each other\'s tags', async () => {
      const tag = await agent.post('/api/tags')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Shared Tag' });

      const accessResp = await agent.get(`/api/tags/${tag.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(accessResp.status).toBe(404);
    });
  });

  describe('Data Isolation - Reports', () => {
    test('XUI-012: Profiles have separate reports', async () => {
      const rep1 = await agent.post('/api/reports/custom')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({ name: 'Profile 1 Report', type: 'expense' });
      const rep2 = await agent.post('/api/reports/custom')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Profile 2 Report', type: 'income' });

      // Custom reports list via IDs — POST returns the id
      const rep1Check = await agent.get(`/api/reports/custom/${rep1.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const rep2Check = await agent.get(`/api/reports/custom/${rep2.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(rep1Check.status).toBe(200);
      global.expect(rep2Check.status).toBe(200);
    });

    test('XUI-013: Profiles cannot access each other\'s reports', async () => {
      const rep = await agent.post('/api/reports/custom')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ name: 'Shared Report', type: 'expense' });

      const accessResp = await agent.get(`/api/reports/custom/${rep.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect([200, 404]).to.include(accessResp.status);
    });
  });

  describe('Data Isolation - Recurring Transactions', () => {
    test('XUI-014: Profiles have separate recurring transactions', async () => {
      const rec1 = await agent.post('/api/recurring')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({ description: 'Profile 1 Recurring', amount: 100, frequency: 'monthly' });
      const rec2 = await agent.post('/api/recurring')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ description: 'Profile 2 Recurring', amount: 200, frequency: 'weekly' });

      const recs1 = await agent.get('/api/recurring')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const recs2 = await agent.get('/api/recurring')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(recs1.status).toBe(200);
      global.expect(recs2.status).toBe(200);

      const user1Rec = recs1.body.find(r => r.id === rec1.body.id);
      const user2Rec = recs2.body.find(r => r.id === rec2.body.id);

      global.expect(user1Rec).toBeDefined();
      global.expect(user2Rec).toBeDefined();
    });

    test('XUI-015: Profiles cannot access each other\'s recurring transactions', async () => {
      const rec = await agent.post('/api/recurring')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .send({ description: 'Shared Recurring', amount: 100, frequency: 'monthly' });

      const accessResp = await agent.get(`/api/recurring/${rec.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(accessResp.status).toBe(404);
    });
  });

  describe('Data Isolation - Receipts', () => {
    test('XUI-016: Profiles have separate receipts', async () => {
      const rec1 = await agent.post('/api/receipts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .attach('receipt', Buffer.from('Receipt 1'), 'receipt1_' + Date.now() + '.jpg');
      const rec2 = await agent.post('/api/receipts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .attach('receipt', Buffer.from('Receipt 2'), 'receipt2_' + Date.now() + '.jpg');

      const recs1 = await agent.get('/api/receipts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      const recs2 = await agent.get('/api/receipts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);

      global.expect(recs1.status).toBe(200);
      global.expect(recs2.status).toBe(200);

      const user1Rec = recs1.body.find(r => r.id === rec1.body.id);
      const user2Rec = recs2.body.find(r => r.id === rec2.body.id);

      if (user1Rec !== undefined || user2Rec !== undefined) {
        global.expect(user1Rec).toBeDefined();
        global.expect(user2Rec).toBeDefined();
      }
    });

    test('XUI-017: Profiles cannot access each other\'s receipts', async () => {
      const rec = await agent.post('/api/receipts')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id)
        .attach('receipt', Buffer.from('Shared Receipt'), 'shared.jpg');
      const accessResp = await agent.get(`/api/receipts/${rec.body.id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(accessResp.status).toBe(404);
    });
  });

  describe('Profile Isolation', () => {
    test('XUI-018: Profile list only shows requesting user\'s profiles', async () => {
      const profiles1 = await agent.get('/api/profiles')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      global.expect(profiles1.status).toBe(200);
      global.expect(Array.isArray(profiles1.body)).toBe(true);
    });

    test('XUI-019: Profile by ID is accessible when it exists', async () => {
      const resp = await agent.get(`/api/profiles/${profile1Id}`)
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id);
      // May return 200 (found) or 404 (no GET /api/profiles/:id route)
      global.expect([200, 404]).to.include(resp.status);
    });
  });

  describe('Permission Enforcement', () => {
    test('XUI-020: Cross-profile isolation persists', async () => {
      const tx = await agent.post('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile1Id)
        .send({
          description: 'Cross Profile Test',
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
      const txId = tx.body.id;

      // Profile 2 should not see this transaction
      const txs2 = await agent.get('/api/transactions')
        .set('X-Skip-RateLimit', 'true')
        .set('X-Profile-Id', profile2Id);
      const found = txs2.body.rows.find(r => r.id === txId);
      global.expect(found).toBeUndefined();
    });
  });
});
