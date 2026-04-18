/**
 * Unit tests for health check endpoint
 */
const request = require('supertest');
const express = require('express');
const session = require('express-session');

// Create a test app with health check endpoint
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Health check endpoint (no auth required)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

describe('Health Check API', () => {
  test('GET /api/health should return ok status', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('GET /api/health should be accessible without authentication', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  test('GET /api/health should return JSON', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});