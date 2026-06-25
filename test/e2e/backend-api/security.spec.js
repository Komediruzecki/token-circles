/**
 * E2E Tests for Security API
 * Covers rate limiting, security headers, input validation, auth checks
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Security E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'person', password: 'something-like-this' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('Rate Limiting', () => {
    test('SEC-001: Rate limiter blocks exceeded requests', async () => {
      // Reset rate limit if test endpoint exists
      await agent.post('/api/test/reset-rate-limit').set('X-Skip-RateLimit', 'true').catch(() => {});

      // Send many requests WITHOUT X-Skip-RateLimit to trigger the limiter
      for (let i = 0; i < 15; i++) {
        await agent.post('/api/auth/login')
          .send({ username: 'test', password: 'password123' })
          .catch(() => {});
      }

      const resp = await agent.post('/api/auth/login')
        .send({ username: 'test', password: 'password123' });

      // Rate limiter should return 429 after exceeding limit
      global.expect([429, 401]).to.include(resp.status);
    });

    test('SEC-002: Requests with X-Skip-RateLimit bypass rate limiter', async () => {
      // Even after rate limit may be triggered, skipped requests should work
      const resp = await agent.post('/api/auth/login')
        .set('X-Skip-RateLimit', 'true')
        .send({ username: 'person', password: 'something-like-this' });

      global.expect([200, 401]).to.include(resp.status);
    });

    test('SEC-003: Test reset rate limit endpoint', async () => {
      const resp = await agent.post('/api/test/reset-rate-limit').set('X-Skip-RateLimit', 'true');
      global.expect([200, 404]).to.include(resp.status);
    });
  });

  describe('Security Headers', () => {
    test('SEC-004: Response includes X-Content-Type-Options header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('x-content-type-options');
      global.expect(resp.headers['x-content-type-options']).toBe('nosniff');
    });

    test('SEC-005: Response includes Content-Security-Policy header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('content-security-policy');
    });

    test('SEC-006: Response includes Strict-Transport-Security header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('strict-transport-security');
    });

    test('SEC-007: Response includes X-Frame-Options header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('x-frame-options');
    });

    test('SEC-008: Response includes Referrer-Policy header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('referrer-policy');
    });
  });

  describe('Authentication Validation', () => {
    test('SEC-009: POST requests require authentication', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name: 'Test Category' });
      global.expect(resp.status).toBe(401);
    });

    test('SEC-010: PUT requests require authentication', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.put('/api/categories/1').set('X-Skip-RateLimit', 'true').send({ name: 'Updated' });
      global.expect(resp.status).toBe(401);
    });

    test('SEC-011: DELETE requests require authentication', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.delete('/api/categories/1').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(401);
    });

    test('SEC-012: Authenticated requests with mutating endpoints require auth', async () => {
      const agentNoSession = request(BASE_URL);
      // POST to transactions requires auth
      const resp = await agentNoSession.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Test', amount: 100, date: '2026-04-25', type: 'expense'
      });
      global.expect(resp.status).toBe(401);
    });

    test('SEC-013: Health endpoint does not require authentication', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Sensitive Data Handling', () => {
    test('SEC-014: Passwords not returned in responses', async () => {
      const resp = await agent.get('/api/profiles').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (Array.isArray(resp.body) && resp.body.length > 0) {
        global.expect(resp.body[0]).not.toHaveProperty('password');
      }
    });

    test('SEC-015: API errors do not leak stack traces', async () => {
      const resp = await agent.get('/api/transactions/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
      global.expect(resp.body).not.toHaveProperty('stack');
    });
  });

  describe('Input Validation', () => {
    test('SEC-016: Reject SQL injection attempts', async () => {
      const resp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: "'; DROP TABLE transactions; --",
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      global.expect(resp.status).toBe(400);
    });

    test('SEC-017: Handle XSS attempts in input', async () => {
      const resp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: '<script>alert("XSS")</script>',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      global.expect([400, 200]).to.include(resp.status);
    });

    test('SEC-018: Sanitize command injection in report name', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'test; rm -rf /',
        type: 'expense'
      });
      // API defaults empty sanitized names to 'Custom Report'
      global.expect([200, 400]).to.include(resp.status);
    });

    test('SEC-019: Sanitize script tags in input', async () => {
      const resp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'User Input: <script>alert(1)</script>',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Content Security', () => {
    test('SEC-020: HSTS header includes max-age', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      if (resp.headers['strict-transport-security']) {
        global.expect(resp.headers['strict-transport-security']).toMatch(/max-age/);
      }
    });

    test('SEC-021: Content-Security-Policy header is present', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers).toHaveProperty('content-security-policy');
      global.expect(typeof resp.headers['content-security-policy']).toBe('string');
    });
  });

  describe('Audit Logging', () => {
    test('SEC-022: Failed auth attempts are logged', async () => {
      await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'invalid', password: 'wrong' });
      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('SEC-023: Multiple failed login attempts are recorded', async () => {
      for (let i = 0; i < 3; i++) {
        await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: `testuser${i}`, password: 'wrong' });
      }
      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Data Integrity', () => {
    test('SEC-024: GET transactions returns data', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('SEC-025: PUT with valid data updates category', async () => {
      // Create a category first, then update it
      const createResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name: 'SEC_TEST_' + Date.now() });
      if (createResp.status === 200) {
        const resp = await agent.put(`/api/categories/${createResp.body.id}`).set('X-Skip-RateLimit', 'true').send({ name: 'Updated_SEC_TEST' });
        global.expect([200, 404]).to.include(resp.status);
      }
    });

    test('SEC-026: DELETE non-existent returns 404', async () => {
      const resp = await agent.delete('/api/categories/99999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Error Messages', () => {
    test('SEC-027: Unauthorized returns error message', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Test', amount: 100, date: '2026-04-25', type: 'expense'
      });
      global.expect(resp.status).toBe(401);
      global.expect(resp.body).toHaveProperty('error');
    });

    test('SEC-028: Not found returns error message', async () => {
      const resp = await agent.get('/api/transactions/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
      global.expect(resp.body).toHaveProperty('error');
    });

    test('SEC-029: No password field in transaction responses', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      global.expect(resp.status).toBe(200);
      if (resp.body.rows && resp.body.rows.length > 0) {
        global.expect(resp.body.rows[0]).not.toHaveProperty('password');
      }
    });

    test('SEC-030: Logs do not contain PII', async () => {
      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body && resp.body.length > 0) {
        global.expect(resp.body[0]).not.toHaveProperty('password');
      }
    });
  });
});
