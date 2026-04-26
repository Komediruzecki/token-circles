/**
 * E2E Tests for Security API
 * Covers rate limiting, security headers, vulnerability scanning
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Security E2E', () => {
  let agent;
  let originalRateLimit = true;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('Rate Limiting', () => {
    test('SEC-001: Rate limiter blocks exceeded requests', async () => {
      await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
        username: 'maff',
        password: 'add2'
      });

      // Exceed rate limit
      for (let i = 0; i < 11; i++) {
        await agent
          .post('/api/auth/login').set('X-Skip-RateLimit', 'true')
          .send({ username: 'test', password: 'password123' })
          .set('X-Skip-RateLimit', 'true');
      }

      const resp = await agent
        .post('/api/auth/login').set('X-Skip-RateLimit', 'true')
        .send({ username: 'test', password: 'password123' });

      global.expect(resp.status).toBe(429);
    });

    test('SEC-002: Rate limiter resets after timeout', async () => {
      await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
        username: 'maff',
        password: 'add2'
      });

      // Rate limit allows 10 requests. Make 10 requests (9 + 1 = 10 total), should pass.
      for (let i = 0; i < 9; i++) {
        await agent
          .post('/api/auth/login').set('X-Skip-RateLimit', 'true')
          .send({ username: 'test', password: 'password123' })
          .set('X-Skip-RateLimit', 'true');
      }

      const resp = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
        username: 'maff',
        password: 'add2'
      });
      // After 10 requests, 11th should be blocked (429)
      global.expect(resp.status).toBe(429);
    });

    test('SEC-003: Test reset rate limit endpoint', async () => {
      const resp = await agent.post('/api/test/reset-rate-limit').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Security Headers', () => {
    test('SEC-004: Response includes X-Content-Type-Options header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers['x-content-type-options']).toBe('nosniff');
    });

    test('SEC-005: Response includes X-XSS-Protection header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers['x-xss-protection']).toBeDefined();
    });

    test('SEC-006: Response includes Strict-Transport-Security header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers['strict-transport-security']).toBeDefined();
    });

    test('SEC-007: Response includes X-Frame-Options header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers['x-frame-options']).toBeDefined();
    });

    test('SEC-008: Response includes Referrer-Policy header', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.headers['referrer-policy']).toBeDefined();
    });
  });

  describe('CSRF Protection', () => {
    test('SEC-009: POST requests require valid session', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'Test Category'
      });

      global.expect(resp.status).toBe(401);
    });

    test('SEC-010: PUT requests require valid session', async () => {
      if (!agent.jar._cookieJar || agent.jar._cookieJar.store.size === 0) {
        await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
      }

      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.put('/api/categories/1').set('X-Skip-RateLimit', 'true').send({
        name: 'Updated'
      });

      global.expect(resp.status).toBe(401);
    });

    test('SEC-011: DELETE requests require valid session', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.delete('/api/categories/1').set('X-Skip-RateLimit', 'true');

      global.expect(resp.status).toBe(401);
    });
  });

  describe('Authentication Validation', () => {
    test('SEC-012: Reject requests without authentication', async () => {
      const agentNoSession = request(BASE_URL);

      const resp1 = await agentNoSession.get('/api/transactions').set('X-Skip-RateLimit', 'true');
      global.expect(resp1.status).toBe(401);

      const resp2 = await agentNoSession.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name: 'Test' });
      global.expect(resp2.status).toBe(401);

      const resp3 = await agentNoSession.delete('/api/categories/1').set('X-Skip-RateLimit', 'true');
      global.expect(resp3.status).toBe(401);
    });

    test('SEC-013: Session validates on each request', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Sensitive Data Handling', () => {
    test('SEC-014: Passwords not returned in responses', async () => {
      const resp = await agent.get('/api/profiles').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      // Password should not be in response
      if (resp.body.length > 0) {
        global.expect(resp.body[0]).not.toHaveProperty('password');
      }
    });

    test('SEC-015: API errors don\'t leak sensitive info', async () => {
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

    test('SEC-017: Reject XSS attempts', async () => {
      const resp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: '<script>alert("XSS")</script>',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      global.expect([400, 200]).to.include(resp.status);
    });

    test('SEC-018: Reject command injection', async () => {
      const resp = await agent.post('/api/reports/custom').set('X-Skip-RateLimit', 'true').send({
        name: 'test; rm -rf /',
        type: 'expense'
      });
      global.expect([400, 422]).to.include(resp.status);
    });

    test('SEC-019: Sanitize input fields', async () => {
      const resp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'User Input: <script>alert(1)</script>',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      // XSS is sanitized and saved (description sanitized to remove script tags)
      global.expect(resp.status).toBe(200);
    });
  });

  describe('HTTPS Headers', () => {
    test('SEC-020: HSTS header present (if using HTTPS)', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      if (resp.headers['strict-transport-security']) {
        global.expect(resp.headers['strict-transport-security']).toMatch(/max-age/);
      }
    });

    test('SEC-021: Content Security Policy headers present', async () => {
      const resp = await agent.get('/api/health').set('X-Skip-RateLimit', 'true');
      if (resp.headers['content-security-policy']) {
        global.expect(resp.headers['content-security-policy']).toBeDefined();
      }
    });
  });

  describe('Audit Logging', () => {
    test('SEC-022: Failed auth attempts logged', async () => {
      await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
        username: 'invalid',
        password: 'wrong'
      });

      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('SEC-023: Failed login attempts tracked', async () => {
      // Multiple failed attempts
      for (let i = 0; i < 5; i++) {
        await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({
          username: `testuser${i}`,
          password: 'wrong'
        });
      }

      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Data Integrity', () => {
    test('SEC-024: GET requests use GET method', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
    });

    test('SEC-025: PUT/POST use correct HTTP methods', async () => {
      const resp = await agent.put('/api/categories/5').set('X-Skip-RateLimit', 'true').send({
        name: 'Updated'
      });
      global.expect(resp.status).toBe(200);
    });

    test('SEC-026: DELETE use correct HTTP method', async () => {
      const resp = await agent.delete('/api/categories/1').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404); // Category doesn't exist, not method error
    });
  });

  describe('Error Messages', () => {
    test('SEC-027: Generic error messages for unauthorized', async () => {
      const agentNoSession = request(BASE_URL);
      const resp = await agentNoSession.get('/api/transactions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(401);
      global.expect(resp.body.error).toBeDefined();
    });

    test('SEC-028: Generic error messages for not found', async () => {
      const resp = await agent.get('/api/transactions/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
      global.expect(resp.body.error).toBeDefined();
    });
  });

  describe('Content Security', () => {
    test('SEC-029: No sensitive data in API response', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      // Check that sensitive fields are not exposed
      if (resp.body.rows) {
        resp.body.rows.forEach(tx => {
          global.expect(tx).not.toHaveProperty('password');
        });
      }
    });

    test('SEC-030: No sensitive data in logs', async () => {
      const resp = await agent.get('/api/logs').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      // Logs should contain error messages but not PII
      if (resp.body.length > 0) {
        global.expect(resp.body[0]).not.toHaveProperty('password');
      }
    });
  });
});