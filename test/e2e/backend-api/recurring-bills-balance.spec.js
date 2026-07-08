/**
 * E2E regression tests for recurring / bills account-balance integrity.
 *
 * Covers the atomic balance-update feature AND the two money-corruption bugs
 * fixed alongside it:
 *  - a transfer-type recurring must NOT one-legged-debit its account (money vanish),
 *    because the recurring model has no destination account;
 *  - a daily recurring must advance next_date on populate, so the idempotency guard
 *    engages and a second same-day populate is rejected (otherwise the account is
 *    debited again on every call).
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Recurring & Bills balance integrity E2E', () => {
  let agent;
  const today = new Date().toISOString().split('T')[0];

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const login = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
      username: 'person',
      password: 'something-like-this',
    });
    if (login.headers['set-cookie']) {
      agent.jar.setCookie(login.headers['set-cookie'][0], BASE_URL);
    }
  });

  async function createAccount(balance) {
    const resp = await agent
      .post('/api/accounts')
      .set('X-Skip-RateLimit', 'true')
      .send({ name: `Bal ${Date.now()}-${Math.random()}`, type: 'giro', balance });
    return resp.body.id;
  }

  async function balanceOf(id) {
    const resp = await agent.get(`/api/accounts/${id}`).set('X-Skip-RateLimit', 'true');
    return resp.body.balance;
  }

  test('REC-BAL-001: populating an expense recurring debits the linked account', async () => {
    const accId = await createAccount(1000);
    const rec = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
      description: 'Rent',
      amount: 50,
      type: 'expense',
      account_id: accId,
      frequency: 'monthly',
      next_date: today,
    });
    const pop = await agent
      .post(`/api/recurring/${rec.body.id}/populate`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(pop.status).toBe(200);
    global.expect(await balanceOf(accId)).toBe(950);
  });

  test('REC-BAL-002: a transfer recurring does not corrupt the balance (no one-legged debit)', async () => {
    const accId = await createAccount(1000);
    const rec = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
      description: 'Move',
      amount: 50,
      type: 'transfer',
      account_id: accId,
      frequency: 'monthly',
      next_date: today,
    });
    const pop = await agent
      .post(`/api/recurring/${rec.body.id}/populate`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(pop.status).toBe(200);
    // No destination account exists in the recurring model, so the balance must be
    // left untouched rather than debited into thin air.
    global.expect(await balanceOf(accId)).toBe(1000);
  });

  test('REC-BAL-003: a daily recurring advances next_date so a second same-day populate is a 409', async () => {
    const accId = await createAccount(1000);
    const rec = await agent.post('/api/recurring').set('X-Skip-RateLimit', 'true').send({
      description: 'Coffee',
      amount: 10,
      type: 'expense',
      account_id: accId,
      frequency: 'daily',
      next_date: today,
    });
    const first = await agent
      .post(`/api/recurring/${rec.body.id}/populate`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(first.status).toBe(200);
    global.expect(await balanceOf(accId)).toBe(990);

    // Without the daily/biweekly advance fix, next_date would stay at today and this
    // second call would populate again (balance 980). The guard must now reject it.
    const second = await agent
      .post(`/api/recurring/${rec.body.id}/populate`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(second.status).toBe(409);
    global.expect(await balanceOf(accId)).toBe(990);
  });

  test('REC-BAL-004: marking a bill paid debits the account once; a second mark-paid is a 409', async () => {
    const accId = await createAccount(1000);
    const bill = await agent.post('/api/bills').set('X-Skip-RateLimit', 'true').send({
      name: 'Electric',
      amount: 100,
      account_id: accId,
      frequency: 'monthly',
      dueDate: today,
    });
    const first = await agent
      .post(`/api/bills/${bill.body.id}/mark-paid`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(first.status).toBe(200);
    global.expect(await balanceOf(accId)).toBe(900);

    const second = await agent
      .post(`/api/bills/${bill.body.id}/mark-paid`)
      .set('X-Skip-RateLimit', 'true');
    global.expect(second.status).toBe(409);
    global.expect(await balanceOf(accId)).toBe(900);
  });
});
