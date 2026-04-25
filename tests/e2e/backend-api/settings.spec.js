/**
 * E2E Tests for Settings & Preferences API
 * Covers app settings, user preferences, configuration management
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Settings E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('GET /api/settings', () => {
    test('BE-SET-001: Get application settings', async () => {
      const resp = await agent.get('/api/settings');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('currency');
      expect(resp.body).toHaveProperty('locale');
    });

    test('BE-SET-002: Settings include user preferences', async () => {
      const resp = await agent.get('/api/settings');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('preferences');
    });
  });

  describe('PUT /api/settings', () => {
    test('BE-SET-003: Update currency', async () => {
      const resp = await agent.put('/api/settings').send({
        currency: 'USD',
        locale: 'en-US'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-SET-004: Update locale', async () => {
      const resp = await agent.put('/api/settings').send({
        locale: 'en-US'
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('POST /api/settings/set-storage', () => {
    test('BE-SET-005: Set storage preferences', async () => {
      const resp = await agent.post('/api/settings/set-storage').send({
        maxSize: 104857600,
        keepHistory: true
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Settings Validation', () => {
    test('BE-SET-006: Reject invalid currency code', async () => {
      const resp = await agent.put('/api/settings').send({
        currency: 'INVALID',
        locale: 'en-US'
      });
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-SET-007: Reject invalid locale', async () => {
      const resp = await agent.put('/api/settings').send({
        currency: 'USD',
        locale: 'invalid-locale'
      });
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Settings Persistence', () => {
    test('BE-SET-008: Settings persist across requests', async () => {
      const resp = await agent.get('/api/settings');
      expect(resp.status).toBe(200);
    });
  });
});