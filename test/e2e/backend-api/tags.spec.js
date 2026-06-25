/**
 * E2E Tests for Tags API
 * Covers CRUD operations, transaction assignment, filtering
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Tags E2E', () => {
  let agent;
  let testTagId;
  let testTagId2;
  let testTxId;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'person', password: 'something-like-this' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testTagId) await agent.delete(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTagId2) await agent.delete(`/api/tags/${testTagId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
  });

  describe('Tag Creation', () => {
    test('BE-T-001: Create tag with auto-assigned color', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'TestTag_' + Date.now() });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('color');
      testTagId = resp.body.id;
    });

    test('BE-T-002: Create tag with custom color', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'TestTagColor_' + Date.now(), color: '#ff0000' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.color).toBe('#ff0000');
      testTagId2 = resp.body.id;
    });

    test('BE-T-003: Auto-generate color from tag name', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'random_' + Date.now() });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('color');
      global.expect(/^#[0-9a-fA-F]{6}$/.test(resp.body.color)).toBe(true);
    });

    test('BE-T-004: Create tag with whitespace trimmed', async () => {
      const suffix = Date.now();
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: '  TagWithSpaces_' + suffix + '  ' });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.name).toBe('TagWithSpaces_' + suffix);
    });

    test('BE-T-005: Reject tag with empty name', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: '' });
      global.expect(resp.status).toBe(400);
    });

    test('BE-T-006: Reject tag with only whitespace name', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: '   ' });
      global.expect(resp.status).toBe(400);
    });

    test('BE-T-007: Reject tag with existing name', async () => {
      const name = 'DuplicateTag_' + Date.now();
      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name });
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name });
      global.expect(resp.status).toBe(400);
    });

    test('BE-T-008: Create multiple tags successfully', async () => {
      const tags = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: `Tag${i}_${Date.now()}` });
        global.expect(resp.status).toBe(200);
        tags.push(resp.body);
      }
      global.expect(tags.length).toBe(5);
    });
  });

  describe('Tag Retrieval', () => {
    test('BE-T-009: Get all tags for current profile', async () => {
      const resp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-T-010: Tag includes all expected fields', async () => {
      if (!testTagId) return;
      const resp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('color');
      global.expect(resp.body).toHaveProperty('created_at');
    });

    test('BE-T-011: Get single tag by ID', async () => {
      const resp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.id).toBe(testTagId);
    });

    test('BE-T-012: Returns 404 for non-existent tag', async () => {
      const resp = await agent.get('/api/tags/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });

    test('BE-T-013: Tags are sorted by name', async () => {
      const resp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      if (resp.body.length > 1) {
        // Verify tags are returned in some order (binary/case-sensitive as SQLite default)
        const names = resp.body.map(t => t.name);
        const binarySorted = [...names].sort();
        global.expect(JSON.stringify(names)).toBe(JSON.stringify(binarySorted));
      }
    });
  });

  describe('Tag Updates', () => {
    test('BE-T-019: Update tag name', async () => {
      const newName = 'NewName_' + Date.now();
      const resp = await agent.put(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true').send({ name: newName });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
    });

    test('BE-T-020: Update tag color', async () => {
      const newColor = '#00ff00';
      const getResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      const resp = await agent.put(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true')
        .send({ name: getResp.body.name, color: newColor });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-T-021: Update both name and color', async () => {
      const newName = 'BothNew_' + Date.now();
      const newColor = '#ffff00';
      const resp = await agent.put(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true')
        .send({ name: newName, color: newColor });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
      global.expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-T-022: Update tag keeps default color if not specified', async () => {
      const resp = await agent.put(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true')
        .send({ name: 'Updated_' + Date.now() });
      global.expect(resp.status).toBe(200);
      const checkResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBeDefined();
      global.expect(checkResp.body.color).toBeDefined();
    });
  });

  describe('Tag Deletion', () => {
    test('BE-T-023: Delete tag by ID', async () => {
      if (!testTagId2) return;
      const id = testTagId2;
      const resp = await agent.delete(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);
      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-T-026: Delete non-existent tag returns 404', async () => {
      const resp = await agent.delete('/api/tags/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Transaction Tag Assignment', () => {
    beforeAll(async () => {
      const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Transaction for Tags',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId = txResp.body.id;
    });

    test('BE-T-028: GET /api/transactions/:id includes tags array', async () => {
      const resp = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body.tags)).toBe(true);
    });

    test('BE-T-029: PUT /api/transactions/:id/tags clears all tags', async () => {
      const resp = await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      global.expect(resp.status).toBe(200);
      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(0);
    });

    test('BE-T-030: PUT /api/transactions/:id/tags assigns single tag', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      const tagResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'SingleTag_' + Date.now() });
      const tagId = tagResp.body.id;
      const resp = await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });
      global.expect(resp.status).toBe(200);
      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(1);
      global.expect(tx.body.tags[0].id).toBe(tagId);
    });

    test('BE-T-031: PUT /api/transactions/:id/tags assigns multiple tags', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      const tag1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagMulti1_' + Date.now() });
      const tag2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagMulti2_' + Date.now() });
      const resp = await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true')
        .send({ tagIds: [tag1.body.id, tag2.body.id] });
      global.expect(resp.status).toBe(200);
      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(2);
    });

    test('BE-T-032: PUT /api/transactions/:id/tags replaces existing tags', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      const tag1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagReplace1_' + Date.now() });
      const tag2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagReplace2_' + Date.now() });
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag1.body.id] });
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag2.body.id] });
      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(1);
      global.expect(tx.body.tags[0].id).toBe(tag2.body.id);
    });

    test('BE-T-033: GET /api/transactions/by-tag/:tagId returns matching transactions', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'FilterTag_' + Date.now() });
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag.body.id] });
      const resp = await agent.get(`/api/transactions/by-tag/${tag.body.id}`).set('X-Skip-RateLimit', 'true').query({ limit: 100 });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('total');
    });

    test('BE-T-035: Filter transactions by tag_ids query param', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'FilterQuery_' + Date.now() });
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag.body.id] });
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({ tag_ids: tag.body.id, limit: 100 });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.rows.length).toBeGreaterThan(0);
    });

    test('BE-T-037: Tags preserve case in name', async () => {
      const prefix = 'MixedCaseTag_' + Date.now();
      const tagResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: prefix });
      const resp = await agent.get(`/api/tags/${tagResp.body.id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.body.name).toBe(prefix);
    });

    test('BE-T-042: Tag linked transactions tracked via by-tag endpoint', async () => {
      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'StatTag_' + Date.now() });
      for (let i = 0; i < 3; i++) {
        const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
          description: `StatTx${i}_${Date.now()}`, amount: 100, date: '2026-04-25', type: 'expense'
        });
        await agent.put(`/api/transactions/${txResp.body.id}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag.body.id] });
      }
      const byTagResp = await agent.get(`/api/transactions/by-tag/${tag.body.id}`).set('X-Skip-RateLimit', 'true').query({ limit: 100 });
      global.expect(byTagResp.status).toBe(200);
      global.expect(byTagResp.body.total).toBeGreaterThanOrEqual(3);
    });
  });
});
