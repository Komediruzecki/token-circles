/**
 * Tests for Tag API endpoints
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Tag API', () => {
  let agent;
  let testTagId;
  let testTagId2;
  let testTxId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL).set('X-Skip-RateLimit', 'true');
    // Log in
    const loginRes = await agent.post('/api/auth/login').send({ username: 'person', password: 'something-like-this' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    // Clean up test tag
    if (testTagId) {
      await agent.delete(`/api/tags/${testTagId}`).catch(() => {});
    }
    if (testTagId2) {
      await agent.delete(`/api/tags/${testTagId2}`).catch(() => {});
    }
    // Clean up test transaction
    if (testTxId) {
      await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    }
  });

  describe('GET /api/tags', () => {
    test('returns tags for the current profile', async () => {
      const resp = await agent.get('/api/tags');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });
  });

  describe('POST /api/tags', () => {
    test('creates a new tag with auto-assigned color', async () => {
      const resp = await agent
        .post('/api/tags')
        .send({ name: 'TestTag_' + Date.now() });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('name');
      expect(resp.body).toHaveProperty('color');
      testTagId = resp.body.id;
    });

    test('creates a tag with a custom color', async () => {
      const resp = await agent
        .post('/api/tags')
        .send({ name: 'TestTagColor_' + Date.now(), color: '#ff0000' });
      expect(resp.status).toBe(200);
      expect(resp.body.color).toBe('#ff0000');
      testTagId2 = resp.body.id;
    });

    test('returns 400 when name is empty', async () => {
      const resp = await agent
        .post('/api/tags')
        .send({ name: '' });
      expect(resp.status).toBe(400);
      expect(resp.body).toHaveProperty('error');
    });

    test('returns 400 when tag already exists', async () => {
      // Create a tag first
      const name = 'DuplicateTag_' + Date.now();
      await agent.post('/api/tags').send({ name });
      // Try to create again
      const resp = await agent.post('/api/tags').send({ name });
      expect(resp.status).toBe(400);
      expect(resp.body.error).toMatch(/already exists/i);
    });
  });

  describe('DELETE /api/tags/:id', () => {
    test('deletes a tag by ID', async () => {
      // Create a tag to delete
      const create = await agent.post('/api/tags').send({ name: 'TagToDelete_' + Date.now() });
      const id = create.body.id;

      const resp = await agent.delete(`/api/tags/${id}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);
    });

    test('returns 404 for non-existent tag', async () => {
      const resp = await agent.delete('/api/tags/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('PUT /api/tags/:id', () => {
    test('updates a tag name and color', async () => {
      const create = await agent.post('/api/tags').send({ name: 'OldName_' + Date.now() });
      const id = create.body.id;

      const resp = await agent.put(`/api/tags/${id}`).send({ name: 'NewName_' + Date.now(), color: '#00ff00' });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      // Clean up
      await agent.delete(`/api/tags/${id}`);
    });
  });

  describe('Transaction tags integration', () => {
    beforeAll(async () => {
      // Create a test transaction
      const tx = await agent
        .post('/api/transactions')
        .send({ description: 'Tag Test Transaction', amount: 50, date: '2026-04-15', type: 'expense' });
      testTxId = tx.body.id;
    });

    test('GET /api/transactions includes tags array', async () => {
      const resp = await agent.get('/api/transactions').query({ limit: 1 });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('rows');
      expect(Array.isArray(resp.body.rows)).toBe(true);
      expect(resp.body.rows.length).toBeGreaterThan(0);
      expect(resp.body.rows[0]).toHaveProperty('tags');
      expect(Array.isArray(resp.body.rows[0].tags)).toBe(true);
    });

    test('GET /api/transactions/:id includes tags array', async () => {
      const resp = await agent.get(`/api/transactions/${testTxId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id', testTxId);
      expect(resp.body).toHaveProperty('tags');
      expect(Array.isArray(resp.body.tags)).toBe(true);
    });

    test('PUT /api/transactions/:id/tags updates tags', async () => {
      const resp = await agent
        .put(`/api/transactions/${testTxId}/tags`)
        .send({ tagIds: [] });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      // Verify tags are cleared
      const tx = await agent.get(`/api/transactions/${testTxId}`);
      expect(tx.body.tags).toHaveLength(0);
    });

    test('PUT /api/transactions/:id/tags assigns tags to transaction', async () => {
      if (!testTagId) {
        // Create a tag if we don't have one
        const tag = await agent.post('/api/tags').send({ name: 'TxTag_' + Date.now() });
        testTagId = tag.body.id;
      }

      const resp = await agent
        .put(`/api/transactions/${testTxId}/tags`)
        .send({ tagIds: [testTagId] });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      // Verify tag is attached
      const tx = await agent.get(`/api/transactions/${testTxId}`);
      expect(tx.body.tags).toHaveLength(1);
      expect(tx.body.tags[0].id).toBe(testTagId);
    });

    test('PUT /api/transactions/:id/tags returns 400 for non-array tagIds', async () => {
      const resp = await agent
        .put(`/api/transactions/${testTxId}/tags`)
        .send({ tagIds: 'not-an-array' });
      expect(resp.status).toBe(400);
    });

    test('PUT /api/transactions/:id/tags returns 404 for non-existent transaction', async () => {
      const resp = await agent
        .put('/api/transactions/999999999/tags')
        .send({ tagIds: [] });
      expect(resp.status).toBe(404);
    });

    test('GET /api/transactions filters by tag_ids', async () => {
      if (!testTagId) return;

      // Get total count
      const allResp = await agent.get('/api/transactions').query({ limit: 1, reconciled: 'all' });
      const totalCount = allResp.body.total || 0;

      // Get count filtered by our tag
      const filteredResp = await agent.get('/api/transactions').query({
        tag_ids: testTagId,
        limit: 100,
        reconciled: 'all'
      });
      expect(filteredResp.status).toBe(200);
      expect(filteredResp.body).toHaveProperty('rows');
      // Should be less than or equal to total
      expect(filteredResp.body.total).toBeLessThanOrEqual(totalCount);
      // Each returned transaction should have our tag
      for (const tx of filteredResp.body.rows) {
        expect(tx.tags.some(t => t.id === testTagId)).toBe(true);
      }
    });
  });
});
