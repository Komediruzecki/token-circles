/**
 * E2E Tests for Categories API
 * Covers CRUD operations, hierarchy, mappings, auto-tagging
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Categories E2E', () => {
  let agent;
  let testCategoryId;
  let testCategoryId2;
  let testTxId;
  let testTxId2;
  let testTxId3;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent
      .post('/api/auth/login')
      .set('X-Skip-RateLimit', 'true')
      .send({ username: 'person', password: 'something-like-this' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    const idsToDelete = [];
    if (testCategoryId) idsToDelete.push(`/api/categories/${testCategoryId}`);
    if (testCategoryId2) idsToDelete.push(`/api/categories/${testCategoryId2}`);
    if (testTxId) idsToDelete.push(`/api/transactions/${testTxId}`);
    if (testTxId2) idsToDelete.push(`/api/transactions/${testTxId2}`);
    if (testTxId3) idsToDelete.push(`/api/transactions/${testTxId3}`);

    for (const path of idsToDelete) {
      try {
        await agent.delete(path).set('X-Skip-RateLimit', 'true');
      } catch (e) {
        // Ignore errors (already deleted or not found)
      }
    }
  });

  describe('Category Creation', () => {
    test('BE-CAT-001: Create category with auto-assigned color', async () => {
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'TestCategory_' + Date.now()
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('color');
      testCategoryId = resp.body.id;
    });

    test('BE-CAT-002: Create category with custom color', async () => {
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'CustomColor_' + Date.now(),
        color: '#ff0000'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.color).toBe('#ff0000');
      testCategoryId2 = resp.body.id;
    });

    test('BE-CAT-003: Default color is valid hex code', async () => {
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'Random_' + Date.now()
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('color');
      // Color should be a valid hex code (the backend defaults to #6b7280)
      global.expect(/^#?[0-9a-fA-F]{6}$/i.test(resp.body.color)).toBe(true);
    });

    test('BE-CAT-004: Reject category with empty name', async () => {
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name: '' });
      global.expect(resp.status).toBe(400);
    });

    test('BE-CAT-005: Reject category with existing name', async () => {
      const name = 'DuplicateCat_' + Date.now();
      await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name });
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({ name });
      global.expect(resp.status).toBe(400);
    });

    test('BE-CAT-006: Create multiple categories', async () => {
      const categories = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
          name: `Cat${i}_${Date.now()}`
        });
        global.expect(resp.status).toBe(200);
        categories.push(resp.body);
      }
      global.expect(categories.length).toBe(5);
    });
  });

  describe('Category Retrieval', () => {
    test('BE-CAT-007: Get all categories for current profile', async () => {
      const resp = await agent.get('/api/categories').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-CAT-008: Category includes all expected fields', async () => {
      if (!testCategoryId) return;
      const resp = await agent.get(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
      global.expect(resp.body).toHaveProperty('name');
      global.expect(resp.body).toHaveProperty('color');
    });

    test('BE-CAT-009: Get category by ID', async () => {
      const resp = await agent.get(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.id).toBe(testCategoryId);
    });

    test('BE-CAT-010: Returns 404 for non-existent category', async () => {
      const resp = await agent.get('/api/categories/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Category Updates', () => {
    test('BE-CAT-011: Update category name', async () => {
      const newName = 'NewName_' + Date.now();

      // Create a new category and capture its ID directly
      const createResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'OldName_' + Date.now()
      });
      const id = createResp.body.id;

      const resp = await agent.put(`/api/categories/${id}`).set('X-Skip-RateLimit', 'true').send({ name: newName });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toBe(newName);
    });

    test('BE-CAT-012: Update category color', async () => {
      if (!testCategoryId) return;
      const newColor = '#00ff00';

      const resp = await agent.put(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true').send({ color: newColor });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-CAT-013: Update both name and color', async () => {
      if (!testCategoryId) return;

      const resp = await agent.put(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true').send({
        name: 'BothUpdate_' + Date.now(),
        color: '#ffff00'
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${testCategoryId}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.body.name).toMatch(/BothUpdate/);
      global.expect(checkResp.body.color).toBe('#ffff00');
    });
  });

  describe('Category Deletion', () => {
    test('BE-CAT-014: Delete category by ID', async () => {
      // Create a fresh category to delete
      const createResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'DeleteMe_' + Date.now()
      });
      const id = createResp.body.id;

      const resp = await agent.delete(`/api/categories/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${id}`).set('X-Skip-RateLimit', 'true');
      global.expect(checkResp.status).toBe(404);
    });

    test('BE-CAT-015: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/categories/999999999').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(404);
    });
  });

  describe('Category Hierarchy', () => {
    test('BE-CAT-016: Create parent category', async () => {
      const resp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'Parent_' + Date.now()
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('id');
    });

    test('BE-CAT-017: Create child category with parent', async () => {
      const parentResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'Parent_' + Date.now()
      });
      const parentId = parentResp.body.id;

      const childResp = await agent.post('/api/categories').set('X-Skip-RateLimit', 'true').send({
        name: 'Child_' + Date.now(),
        parentId
      });
      global.expect(childResp.status).toBe(200);
      global.expect(childResp.body.parentId).toBe(parentId);
    });

    test('BE-CAT-018: Get all categories includes hierarchy', async () => {
      const resp = await agent.get('/api/categories').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      resp.body.forEach(cat => {
        global.expect(cat).toHaveProperty('name');
        global.expect(cat).toHaveProperty('parentId');
      });
    });
  });

  describe('Transaction Category Assignment', () => {
    beforeAll(async () => {
      const txResp = await agent.post('/api/transactions').set('X-Skip-RateLimit', 'true').send({
        description: 'Cat Tx Test',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId = txResp.body.id;
    });

    test('BE-CAT-019: Transaction includes category field', async () => {
      const resp = await agent.get(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('category');
    });

    test('BE-CAT-020: PUT transaction updates category_id', async () => {
      const resp = await agent.put(`/api/transactions/${testTxId}`).set('X-Skip-RateLimit', 'true').send({
        category_id: 1
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body.ok).toBe(true);
    });

    test('BE-CAT-021: Filter transactions by category', async () => {
      const resp = await agent.get('/api/transactions').set('X-Skip-RateLimit', 'true').query({
        category_id: 1
      });
      global.expect(resp.status).toBe(200);
    });
  });

  describe('Category Mappings', () => {
    test('BE-CAT-022: Create category mapping', async () => {
      const categories = await agent.get('/api/categories').set('X-Skip-RateLimit', 'true');
      if (categories.body.length >= 2) {
        const cat2 = categories.body[1].id;

        const resp = await agent.post('/api/categories/mappings').set('X-Skip-RateLimit', 'true').send({
          pattern: 'TestPattern_' + Date.now(),
          category_id: cat2
        });
        global.expect(resp.status).toBe(200);
      }
    });

    test('BE-CAT-023: Get all category mappings', async () => {
      const resp = await agent.get('/api/categories/mappings').set('X-Skip-RateLimit', 'true');
      global.expect(resp.status).toBe(200);
      global.expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-CAT-024: Delete category mapping', async () => {
      const mappings = await agent.get('/api/categories/mappings').set('X-Skip-RateLimit', 'true');
      if (mappings.body.length > 0) {
        const mappingId = mappings.body[0].id;

        const resp = await agent.delete(`/api/categories/mappings/${mappingId}`).set('X-Skip-RateLimit', 'true');
        global.expect(resp.status).toBe(200);
      }
    });
  });

  describe('Category Auto-Map', () => {
    test('BE-CAT-025: Auto-map transaction description to category', async () => {
      const resp = await agent.post('/api/categories/auto-map').set('X-Skip-RateLimit', 'true').send({
        description: 'Netflix subscription',
        amount: 15.99
      });
      global.expect(resp.status).toBe(200);
      global.expect(resp.body).toHaveProperty('mappings');
    });
  });
});
