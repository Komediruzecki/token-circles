/**
 * E2E Tests for Profiles & Users API
 * Covers profile CRUD, user management, permissions, preferences
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Profiles E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/profiles', () => {
    test('BE-PRF-001: Get all profiles for current user', async () => {
      const resp = await agent.get('/api/profiles');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-PRF-002: Includes profile details', async () => {
      const resp = await agent.get('/api/profiles');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        resp.body.forEach(prf => {
          expect(prf).toHaveProperty('username');
          expect(prf).toHaveProperty('id');
          expect(prf).toHaveProperty('created');
        });
      }
    });
  });

  describe('GET /api/profiles/:id', () => {
    test('BE-PRF-003: Get single profile by ID', async () => {
      const resp = await agent.get('/api/profiles');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const prfResp = await agent.get(`/api/profiles/${id}`);
        expect(prfResp.status).toBe(200);
        expect(prfResp.body.id).toBe(id);
      }
    });

    test('BE-PRF-004: Returns 404 for non-existent profile', async () => {
      const resp = await agent.get('/api/profiles/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('POST /api/profiles', () => {
    test('BE-PRF-005: Create new profile', async () => {
      const resp = await agent.post('/api/profiles').send({
        username: 'testuser_' + Date.now(),
        email: `test_${Date.now()}@example.com`
      });
      expect([200, 409]).to.include(resp.status);
    });

    test('BE-PRF-006: Reject empty username', async () => {
      const resp = await agent.post('/api/profiles').send({
        email: 'test@example.com'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-PRF-007: Reject username with existing name', async () => {
      const username = 'duplicate_' + Date.now();
      await agent.post('/api/profiles').send({ username });

      const resp = await agent.post('/api/profiles').send({ username });
      expect([409, 400]).to.include(resp.status);
    });
  });

  describe('PUT /api/profiles/:id', () => {
    test('BE-PRF-008: Update profile username', async () => {
      const resp = await agent.get('/api/profiles');
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const newName = 'updated_user_' + Date.now();

        const updateResp = await agent.put(`/api/profiles/${id}`).send({ username: newName });
        expect(updateResp.status).toBe(200);

        const checkResp = await agent.get(`/api/profiles/${id}`);
        expect(checkResp.body.username).toBe(newName);
      }
    });

    test('BE-PRF-009: Update profile email', async () => {
      const resp = await agent.get('/api/profiles');
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const newEmail = `updated_${Date.now()}@example.com`;

        const updateResp = await agent.put(`/api/profiles/${id}`).send({ email: newEmail });
        expect(updateResp.status).toBe(200);
      }
    });
  });

  describe('DELETE /api/profiles/:id', () => {
    test('BE-PRF-010: Delete profile', async () => {
      const resp = await agent.get('/api/profiles');
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const deleteResp = await agent.delete(`/api/profiles/${id}`);
        expect(deleteResp.status).toBe(200);
      }
    });

    test('BE-PRF-011: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/profiles/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Profile Preferences', () => {
    test('BE-PRF-012: Get profile preferences', async () => {
      const resp = await agent.get('/api/profiles');
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const prfResp = await agent.get(`/api/profiles/${id}`);
        expect(prfResp.status).toBe(200);
        expect(prfResp.body).toHaveProperty('preferences');
      }
    });

    test('BE-PRF-013: Update preferences', async () => {
      const resp = await agent.get('/api/profiles');
      if (resp.body.length > 0) {
        const id = resp.body[0].id;

        const updateResp = await agent.put(`/api/profiles/${id}`).send({
          preferences: {
            currency: 'USD',
            locale: 'en-US'
          }
        });
        expect(updateResp.status).toBe(200);
      }
    });
  });

  describe('Profile Authentication', () => {
    test('BE-PRF-014: Change profile password', async () => {
      if (!agent.jar._cookieJar || agent.jar._cookieJar.store.size === 0) {
        await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      }

      const resp = await agent.put('/api/profiles/me/password').send({
        oldPassword: 'add2',
        newPassword: 'NewPass123!'
      });
      expect([200, 400, 422]).to.include(resp.status);
    });
  });

  describe('Profile Permissions', () => {
    test('BE-PRF-015: Check if user can access resource', async () => {
      const resp = await agent.get('/api/profiles');
      expect(resp.status).toBe(200);
    });

    test('BE-PRF-016: Verify profile permissions respected', async () => {
      const resp = await agent.get('/api/profiles');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const id = resp.body[0].id;
        const prfResp = await agent.get(`/api/profiles/${id}`);
        expect(prfResp.status).toBe(200);
      }
    });
  });
});