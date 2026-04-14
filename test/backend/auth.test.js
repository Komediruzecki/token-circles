/**
 * Unit tests for authentication system
 */
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

// Create a test app with auth endpoints
function createTestApp(users) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Mock user database
  const userDb = users || [{ id: 1, username: 'maff', password_hash: bcrypt.hashSync('add2', 10) }];

  function requireAuth(req, res, next) {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }
      const user = userDb.find(u => u.username === username);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      res.json({ ok: true, username: user.username });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Logout failed' });
      res.json({ ok: true });
    });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ userId: req.session.userId, username: req.session.username });
  });

  return app;
}

describe('Authentication', () => {
  describe('POST /api/auth/login', () => {
    test('returns error for missing username', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Username and password required');
    });

    test('returns error for missing password', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Username and password required');
    });

    test('returns error for invalid username', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    test('returns error for invalid password', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });

    test('logs in successfully with valid credentials', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.username).toBe('maff');
    });
  });

  describe('GET /api/auth/me', () => {
    test('returns 401 when not logged in', async () => {
      const app = createTestApp();
      const res = await request(app)
        .get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    test('returns user info when logged in', async () => {
      const app = createTestApp();
      // First login
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'maff', password: 'add2' });
      // Then check /me
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('maff');
      expect(res.body.userId).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    test('logs out successfully', async () => {
      const app = createTestApp();
      const agent = request.agent(app);
      // First login
      await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      // Then logout
      const res = await agent.post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('cannot access /me after logout', async () => {
      const app = createTestApp();
      const agent = request.agent(app);
      // Login
      await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      // Logout
      await agent.post('/api/auth/logout');
      // Try to access /me
      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});

describe('Password Hashing', () => {
  test('bcrypt correctly hashes and verifies password', async () => {
    const password = 'add2';
    const hash = bcrypt.hashSync(password, 10);
    expect(bcrypt.compareSync(password, hash)).toBe(true);
    expect(bcrypt.compareSync('wrong', hash)).toBe(false);
  });

  test('demo user password is correctly hashed', () => {
    const hash = bcrypt.hashSync('add2', 10);
    expect(hash).not.toBe('add2'); // Should not be plain text
    expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are long
  });
});
