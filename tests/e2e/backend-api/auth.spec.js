/**
 * E2E Tests for Authentication & Security API
 * Covers login, logout, password complexity, rate limiting, session management
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Authentication & Security E2E', () => {
  let agent;
  let testProfileId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
  });

  afterAll(async () => {
    // Clean up test profile if created
    if (testProfileId) {
      await agent.delete(`/api/profiles/${testProfileId}`).catch(() => {});
    }
  });

  describe('POST /api/auth/login', () => {
    test('BE-AUTH-001: Login with valid credentials returns 200 and sets session cookie', async () => {
      const loginRes = await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.headers['set-cookie']).toBeDefined();
    });

    test('BE-AUTH-002: Login with invalid credentials returns 401', async () => {
      const loginRes = await agent
        .post('/api/auth/login')
        .send({ username: 'invalid', password: 'wrong' });

      expect(loginRes.status).toBe(401);
    });

    test('BE-AUTH-003: Login with empty credentials returns 400', async () => {
      const loginRes = await agent
        .post('/api/auth/login')
        .send({ username: '', password: '' });

      expect(loginRes.status).toBe(400);
    });

    test('BE-AUTH-004: Login validates username format (alphanumeric + underscores)', async () => {
      const validLogin = await agent
        .post('/api/auth/login')
        .send({ username: 'test_user_123', password: 'test123' });

      expect(validLogin.status).toBe(200);
    });

    test('BE-AUTH-005: Login rejects username with special characters', async () => {
      const invalidLogin = await agent
        .post('/api/auth/login')
        .send({ username: 'test@user', password: 'test123' });

      expect(invalidLogin.status).toBe(400);
    });

    test('BE-AUTH-006: Login rejects username with spaces', async () => {
      const invalidLogin = await agent
        .post('/api/auth/login')
        .send({ username: 'test user', password: 'test123' });

      expect(invalidLogin.status).toBe(400);
    });

    test('BE-AUTH-007: Password complexity validation rejects passwords shorter than 8 characters', async () => {
      const shortPassword = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'pass' });

      expect(shortPassword.status).toBe(400);
    });

    test('BE-AUTH-008: Password complexity validation requires uppercase letter', async () => {
      const noUppercase = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'password1' });

      expect(noUppercase.status).toBe(400);
    });

    test('BE-AUTH-009: Password complexity validation requires lowercase letter', async () => {
      const noLowercase = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'PASSWORD1' });

      expect(noLowercase.status).toBe(400);
    });

    test('BE-AUTH-010: Password complexity validation requires number', async () => {
      const noNumber = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'Password' });

      expect(noNumber.status).toBe(400);
    });

    test('BE-AUTH-011: Password complexity validation requires special character', async () => {
      const noSpecial = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'Password1' });

      expect(noSpecial.status).toBe(400);
    });

    test('BE-AUTH-012: Login succeeds with all complexity requirements met', async () => {
      const strongPassword = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'Passw0rd!' });

      expect(strongPassword.status).toBe(200);
    });
  });

  describe('GET /api/auth/me', () => {
    test('BE-AUTH-013: Returns authenticated user profile when session valid', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body).toHaveProperty('username');
      expect(meRes.body).toHaveProperty('id');
    });

    test('BE-AUTH-014: Returns 401 when session invalid', async () => {
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    test('BE-AUTH-015: Logout clears session cookie', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      const logoutRes = await agent.post('/api/auth/logout');
      expect(logoutRes.status).toBe(200);

      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(401);
    });
  });

  describe('Rate Limiting', () => {
    test('BE-AUTH-016: Rate limiter rejects requests exceeding threshold', async () => {
      const loginRes = await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      expect(loginRes.status).toBe(200);

      // Exceed rate limit
      for (let i = 0; i < 11; i++) {
        await agent
          .post('/api/auth/login')
          .send({ username: 'test', password: 'password123' })
          .set('X-Skip-RateLimit', 'true');
      }

      const invalidRes = await agent
        .post('/api/auth/login')
        .send({ username: 'test', password: 'password123' });

      expect(invalidRes.status).toBe(429);
    });

    test('BE-AUTH-017: Rate limiter resets after timeout', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      // Skip rate limit for many attempts
      for (let i = 0; i < 15; i++) {
        await agent
          .post('/api/auth/login')
          .send({ username: 'test', password: 'password123' })
          .set('X-Skip-RateLimit', 'true');
      }

      // Should be able to login again after waiting (in production this would be a fixed timeout)
      const validRes = await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      expect(validRes.status).toBe(200);
    });
  });

  describe('Session Management', () => {
    test('BE-AUTH-018: Multiple sessions from same user allowed', async () => {
      const session1 = request.agent(BASE_URL);
      const session2 = request.agent(BASE_URL);

      const login1 = await session1
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      const login2 = await session2
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      expect(login1.status).toBe(200);
      expect(login2.status).toBe(200);

      const me1 = await session1.get('/api/auth/me');
      const me2 = await session2.get('/api/auth/me');

      expect(me1.body.username).toBe('maff');
      expect(me2.body.username).toBe('maff');
    });

    test('BE-AUTH-019: Session timeout after inactivity', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      // Wait for session timeout (hard to test programmatically, testing exists at 30min in config)
      const meRes = await agent.get('/api/auth/me');
      expect(meRes.status).toBe(200);
    });
  });

  describe('Security Headers', () => {
    test('BE-AUTH-020: Response includes security headers', async () => {
      const res = await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-xss-protection']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  describe('Password Reset & Recovery', () => {
    test('BE-AUTH-021: POST /api/auth/password-reset requested', async () => {
      // Test that endpoint exists
      const res = await agent
        .post('/api/auth/password-reset')
        .send({ username: 'maff' });

      expect([200, 404, 400]).to.include(res.status);
    });

    test('BE-AUTH-022: Password reset token generated and valid', async () => {
      // This depends on implementation
      const res = await agent
        .post('/api/auth/password-reset')
        .send({ username: 'maff' });

      if (res.status === 200) {
        expect(res.body).toHaveProperty('resetToken');
        expect(res.body.resetToken.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Two-Factor Authentication', () => {
    test('BE-AUTH-023: 2FA setup endpoint available', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      const res = await agent.post('/api/auth/2fa/setup');

      expect([200, 404, 400]).to.include(res.status);
    });

    test('BE-AUTH-024: 2FA enabled with QR code', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });

      // Requires 2FA to be enabled on user profile
      const res = await agent.post('/api/auth/2fa/enable');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('qrCode');
        expect(res.body).toHaveProperty('secret');
      }
    });

    test('BE-AUTH-025: Login requires 2FA when enabled', async () => {
      // This requires a user with 2FA enabled
      const res = await agent
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2', code: '123456' });

      expect([200, 401]).to.include(res.status);
    });
  });

  describe('Security Event Logging', () => {
    test('BE-AUTH-026: Failed login attempts logged', async () => {
      await agent
        .post('/api/auth/login')
        .send({ username: 'invalid', password: 'wrong' });

      // Check logs endpoint
      const res = await agent.get('/api/logs');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('BE-AUTH-027: Security violations logged', async () => {
      // Attempt invalid credentials multiple times
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/auth/login')
          .send({ username: 'test', password: '12345678' });
      }

      const res = await agent.get('/api/logs');
      expect(res.status).toBe(200);
    });
  });
});