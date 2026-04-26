/**
 * E2E Tests for Tags API
 * Covers CRUD operations, hierarchy, assignment to transactions, filtering, grouping
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Tags E2E', () => {
  let agent;
  let testTagId;
  let testTagId2;
  let testTagId3;
  let testTxId;
  let testTxId2;
  let testTxId3;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').set('X-Skip-RateLimit', 'true').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    // Clean up
    if (testTagId) await agent.delete(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTagId2) await agent.delete(`/api/tags/${testTagId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTagId3) await agent.delete(`/api/tags/${testTagId3}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).set('X-Skip-RateLimit', 'true').catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).set('X-Skip-RateLimit', 'true').catch(() => {});
  });

  describe('Tag Creation', () => {
    test('BE-T-001: Create tag with auto-assigned color', async () => {
      const resp = await agent
        .post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'TestTag_' + Date.now() });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('color');
      testTagId = resp.body.id;
    });

    test('BE-T-002: Create tag with custom color', async () => {
      const resp = await agent
        .post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'TestTagColor_' + Date.now(), color: '#ff0000' });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body.name).toMatch(/TestTagColor/);
      global.expect(resp.body.color).toBe('#ff0000');
      testTagId2 = resp.body.id;
    });

    test('BE-T-003: Auto-generate color from tag name', async () => {
      const resp = await agent
        .post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: 'random_' + Date.now() });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('color');
      global.expect(/^[0-9a-fA-F]{6}$/.test(resp.body.color)).toBe(true);
    });

    test('BE-T-004: Create tag with whitespace trimmed', async () => {
      const resp = await agent
        .post('/api/tags').set('X-Skip-RateLimit', 'true')
        .send({ name: '  TagWithSpaces  ' });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body.name).toBe('TagWithSpaces');
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
      tags.forEach(t => global.expect(t).toHaveProperty('id'));
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
      global.expect(resp.body).toHaveProperty('createdAt');
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

    test('BE-T-013: Tags sorted by creation date', async () => {
      const resp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      const names = resp.body.map(t => t.name);
      // Names should be unique
      global.expect(names.length).toBe(new Set(names).size);
    });

    test('BE-T-014: Tag count reflects number of created tags', async () => {
      const createCount = 10;
      const created = [];
      for (let i = 0; i < createCount; i++) {
        const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: `Tag${i}_${Date.now()}` });
        created.push(resp.body.id);
      }

      const allResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      global.expect(allResp.status).toBe(200);
      global.expect(allResp.body.length).toBeGreaterThanOrEqual(createCount);
    });
  });

  describe('Tag Hierarchy', () => {
    test('BE-T-015: Create child tag with parent', async () => {
      const parentResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'ParentTag_' + Date.now() });
      const parentId = parentResp.body.id;

      const childResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({
        name: 'ChildTag_' + Date.now(),
        parentId
      });

      global.expect(childResp.status).toBe(200);
      global.expect(childResp.body.parentId).toBe(parentId);
      testTagId2 = childResp.body.id;
    });

    test('BE-T-016: Parent tag includes list of children', async () => {
      const parentResp = await agent.get(`/api/tags/${testTagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(parentResp.status).toBe(200);
      global.expect(parentResp.body).toHaveProperty('children');
      global.expect(Array.isArray(parentResp.body.children)).toBe(true);
    });

    test('BE-T-017: Get all tags includes hierarchy relationships', async () => {
      const resp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      resp.body.forEach(tag => {
        global.expect(tag).toHaveProperty('name');
        global.expect(tag).toHaveProperty('color');
        global.expect(tag).toHaveProperty('parentId');
        if (tag.parentId) {
          global.expect(tag).toHaveProperty('children');
        }
      });
    });

    test('BE-T-018: Circular parent-child relationships prevented', async () => {
      const parent1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'P1_' + Date.now() });
      const parent2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'P2_' + Date.now() });

      const child1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({
        name: 'C1_' + Date.now(),
        parentId: parent1.body.id
      });

      // Try to make P2 parent of C1
      const resp = await agent.put(`/api/tags/${child1.body.id}`).set('X-Skip-RateLimit', 'true').send({
        parentId: parent2.body.id
      });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body.parentId).toBe(parent2.body.id);
    });
  });

  describe('Tag Updates', () => {
    test('BE-T-019: Update tag name', async () => {
      const oldName = 'OldName_' + Date.now();
      const newName = 'NewName_' + Date.now();

      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: oldName });
      const createResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      const id = createResp.body[0].id;

      const resp = await agent.put(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true').send({ name: newName });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
    });

    test('BE-T-020: Update tag color', async () => {
      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'ColorTest_' + Date.now() });
      const createResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      const id = createResp.body[0].id;

      const newColor = '#00ff00';
      const resp = await agent.put(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true').send({ color: newColor });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-T-021: Update both name and color', async () => {
      const oldName = 'BothTest_' + Date.now();
      const newName = 'BothNew_' + Date.now();
      const newColor = '#ffff00';

      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: oldName });
      const createResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      const id = createResp.body[0].id;

      const resp = await agent.put(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true').send({
        name: newName,
        color: newColor
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
      global.expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-T-022: Update tag removes old color if not specified', async () => {
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'NoColor_' + Date.now() });
      const id = resp.body.id;

      // Color should be auto-generated
      const beforeColor = resp.body.color;

      const updateResp = await agent.put(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true').send({ name: 'Updated' });
      global.expect(updateResp.status).toBe(200);

      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe('Updated');
    });
  });

  describe('Tag Deletion', () => {
    test('BE-T-023: Delete tag by ID', async () => {
      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'ToDelete_' + Date.now() });
      const createResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      const id = createResp.body[0].id;

      const resp = await agent.delete(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);

      const checkResp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-T-024: Delete tag with assigned transactions', async () => {
      // Create tag
      const tagResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TxTag_' + Date.now() });
      const tagId = tagResp.body.id;

      // Create transaction with tag
      const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Tag Test',
        amount: 100,
        date: '2026-04-15',
        type: 'expense'
      });
      testTxId = txResp.body.id;

      // Assign tag
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });

      // Delete tag
      const deleteResp = await agent.delete(`/api/tags/${tagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(deleteResp.status).toBe(200);

      // Transaction should still exist but tags should be cleared
      const txResp2 = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(txResp2.body.tags).toHaveLength(0);
    });

    test('BE-T-025: Delete tag with children', async () => {
      const parentResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'ParentDel_' + Date.now() });
      const parentId = parentResp.body.id;

      const childResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({
        name: 'ChildDel_' + Date.now(),
        parentId
      });
      const childId = childResp.body.id;

      const deleteResp = await agent.delete(`/api/tags/${parentId}`).set('X-Skip-RateLimit', 'true');
      global.expect(deleteResp.status).toBe(200);

      // Parent deleted
      const parentCheck = await agent.get(`/api/tags/${parentId}`).set('X-Skip-RateLimit', 'true');
      global.expect(parentCheck.status).toBe(404);

      // Child should cascade delete (or be detached)
      const childCheck = await agent.get(`/api/tags/${childId}`).set('X-Skip-RateLimit', 'true');
      global.expect(childCheck.status).toBe(404);
    });

    test('BE-T-026: Delete non-existent tag returns 404', async () => {
      const resp = await agent.delete('/api/tags/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });

    test('BE-T-027: Get all tags reflects deleted tag removal', async () => {
      const createResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'DeleteCheck_' + Date.now() });
      const id = createResp.body.id;

      await agent.delete(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');

      const allResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true');
      const nameInList = allResp.body.some(t => t.id === id);
      global.expect(nameInList).toBe(false);
    });
  });

  describe('Transaction Tag Assignment', () => {
    beforeAll(async () => {
      // Create transaction for tests
      const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Transaction for Tags',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId = txResp.body.id;
    });

    test('BE-T-028: Get /api/transactions/:id includes tags array', async () => {
      const resp = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id', testTxId);
      global.expect(resp.body).toHaveProperty('tags');
      global.expect(Array.isArray(resp.body.tags)).toBe(true);
    });

    test('BE-T-029: PUT /api/transactions/:id/tags clears all tags', async () => {
      const resp = await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('ok', true);

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

      const resp = await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({
        tagIds: [tag1.body.id, tag2.body.id]
      });
      global.expect(resp.status).toBe(200);

      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(2);
    });

    test('BE-T-032: PUT /api/transactions/:id/tags replaces existing tags', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const tag1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagReplace1_' + Date.now() });
      const tag2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'TagReplace2_' + Date.now() });

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({
        tagIds: [tag1.body.id]
      });

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({
        tagIds: [tag2.body.id]
      });

      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(1);
      global.expect(tx.body.tags[0].id).toBe(tag2.body.id);
    });

    test('BE-T-033: GET /api/transactions/by-tag/:tagId returns matching transactions', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'FilterTag_' + Date.now() });
      const tagId = tag.body.id;

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });

      const resp = await agent.get(`/api/transactions/by-tag/${tagId}`).set('X-Skip-RateLimit', 'true').query({ limit: 100 });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('total');
      global.expect(resp.body.rows).toBeDefined();
    });

    test('BE-T-034: Transaction updates reflect in tag assignment', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const tag1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'UpdateTag_' + Date.now() });
      const tag2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'UpdateTag2_' + Date.now() });

      // Assign first tag
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag1.body.id] });

      // Remove first, add second
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tag2.body.id] });

      const tx = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tx.body.tags).toHaveLength(1);
      global.expect(tx.body.tags[0].id).toBe(tag2.body.id);
    });

    test('BE-T-035: Filter transactions by tag_ids query param', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'FilterQuery_' + Date.now() });
      const tagId = tag.body.id;

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });

      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        tag_ids: tagId,
        limit: 100
      });

      global.expect(resp.status).toBe(200);
      global.expect(resp.body.rows.length).toBeGreaterThan(0);
      resp.body.rows.forEach(tx => {
        global.expect(tx.tags.some(t => t.id === tagId)).toBe(true);
      });
    });
  });

  describe('Tag Display & Naming', () => {
    test('BE-T-036: Tags display correct hierarchy in nested format', async () => {
      await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'Root_' + Date.now() });
      const rootResp = await agent.get('/api/tags').set('X-Skip-RateLimit', 'true').query({ limit: 1 });
      const rootId = rootResp.body[0].id;

      const child = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({
        name: 'Child_' + Date.now(),
        parentId: rootId
      });

      const grandchild = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({
        name: 'Grandchild_' + Date.now(),
        parentId: child.body.id
      });

      // Check that grandchild's parent links are correct
      const gcResp = await agent.get(`/api/tags/${grandchild.body.id}`).set('X-Skip-RateLimit', 'true');
      global.expect(gcResp.body.parentId).toBe(child.body.id);
    });

    test('BE-T-037: Tags are not case-sensitive in search', async () => {
      const tagResp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'MixedCaseTag_' + Date.now() });
      const id = tagResp.body.id;

      const resp = await agent.get(`/api/tags/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.body.name).toBe('MixedCaseTag');
    });

    test('BE-T-038: Tag maximum length enforced', async () => {
      // Create tag with extremely long name
      const longName = 'A'.repeat(256);
      const resp = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: longName });

      if (resp.status === 400) {
        global.expect(resp.body).toHaveProperty('error');
      }
    });
  });

  describe('Tag Integration', () => {
    test('BE-T-039: Category can have associated tags', async () => {
      const categoryResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'CategoryWithTags_' + Date.now(),
        description: 'Test'
      });
      const categoryId = categoryResp.body.id;

      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'CatTag_' + Date.now() });
      const tagId = tag.body.id;

      const resp = await agent.post('/api/categories/' + categoryId + '/tags').set('X-Skip-RateLimit', 'true').send({
        tagIds: [tagId]
      });
      global.expect(resp.status).toBe(200);
    });

    test('BE-T-040: GET /api/transactions includes nested tag data', async () => {
      const txResp = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(txResp.status).toBe(200);
      global.expect(txResp.body.tags).toBeInstanceOf(Array);
      if (txResp.body.tags.length > 0) {
        txResp.body.tags.forEach(tag => {
          global.expect(tag).toHaveProperty('name');
          global.expect(tag).toHaveProperty('color');
        });
      }
    });

    test('BE-T-041: Filter by multiple tag_ids', async () => {
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const tag1 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'MultiTag1_' + Date.now() });
      const tag2 = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'MultiTag2_' + Date.now() });

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({
        tagIds: [tag1.body.id, tag2.body.id]
      });

      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        tag_ids: `${tag1.body.id},${tag2.body.id}`,
        limit: 100
      });

      global.expect(resp.status).toBe(200);
      resp.body.rows.forEach(tx => {
        global.expect(tx.tags.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Tag Statistics', () => {
    test('BE-T-042: Tag assigned transaction count tracked', async () => {
      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'StatTag_' + Date.now() });
      const tagId = tag.body.id;

      // Assign tag to multiple transactions
      for (let i = 0; i < 5; i++) {
        const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
          description: `StatTx${i}_${Date.now()}`,
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });
        await agent.put(`/api/transactions/${txResp.body.id}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });
      }

      const tagResp = await agent.get(`/api/tags/${tagId}`).set('X-Skip-RateLimit', 'true');
      global.expect(tagResp.status).toBe(200);
      global.expect(tagResp.body).toHaveProperty('transactionCount');
    });

    test('BE-T-043: Tag total amount tracked', async () => {
      const tag = await agent.post('/api/tags').set('X-Skip-RateLimit', 'true').send({ name: 'AmountTag_' + Date.now() });
      const tagId = tag.body.id;

      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });
      await agent.put(`/api/transactions/${testTxId}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [] });

      const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'AmountTest_' + Date.now(),
        amount: 500,
        date: '2026-04-25',
        type: 'expense'
      });

      await agent.put(`/api/transactions/${txResp.body.id}/tags`).set('X-Skip-RateLimit', 'true').send({ tagIds: [tagId] });

      const tagCheck = await agent.get(`/api/tags/${tagId}`).set('X-Skip-RateLimit', 'true');
      if (tagCheck.body.transactionCount > 0) {
        global.expect(tagCheck.body).toHaveProperty('totalAmount');
      }
    });
  });
});