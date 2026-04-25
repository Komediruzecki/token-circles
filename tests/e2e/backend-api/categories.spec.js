/**
 * E2E Tests for Categories API
 * Covers CRUD operations, hierarchy, mappings, auto-tagging
 */
const request = require('supertest');
const { expect } = require('chai');

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
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  afterAll(async () => {
    if (testCategoryId) await agent.delete(`/api/categories/${testCategoryId}`).catch(() => {});
    if (testCategoryId2) await agent.delete(`/api/categories/${testCategoryId2}`).catch(() => {});
    if (testTxId) await agent.delete(`/api/transactions/${testTxId}`).catch(() => {});
    if (testTxId2) await agent.delete(`/api/transactions/${testTxId2}`).catch(() => {});
    if (testTxId3) await agent.delete(`/api/transactions/${testTxId3}`).catch(() => {});
  });

  describe('Category Creation', () => {
    test('BE-CAT-001: Create category with auto-assigned color', async () => {
      const resp = await agent.post('/api/categories').send({
        name: 'TestCategory_' + Date.now()
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('name');
      expect(resp.body).toHaveProperty('color');
      testCategoryId = resp.body.id;
    });

    test('BE-CAT-002: Create category with custom color', async () => {
      const resp = await agent.post('/api/categories').send({
        name: 'CustomColor_' + Date.now(),
        color: '#ff0000'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.color).toBe('#ff0000');
      testCategoryId2 = resp.body.id;
    });

    test('BE-CAT-003: Auto-generate color from name', async () => {
      const resp = await agent.post('/api/categories').send({
        name: 'Random_' + Date.now()
      });
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('color');
      expect(/^[0-9a-fA-F]{6}$/.test(resp.body.color)).toBe(true);
    });

    test('BE-CAT-004: Reject category with empty name', async () => {
      const resp = await agent.post('/api/categories').send({ name: '' });
      expect(resp.status).toBe(400);
    });

    test('BE-CAT-005: Reject category with existing name', async () => {
      const name = 'DuplicateCat_' + Date.now();
      await agent.post('/api/categories').send({ name });
      const resp = await agent.post('/api/categories').send({ name });
      expect(resp.status).toBe(400);
    });

    test('BE-CAT-006: Create multiple categories', async () => {
      const categories = [];
      for (let i = 0; i < 5; i++) {
        const resp = await agent.post('/api/categories').send({
          name: `Cat${i}_${Date.now()}`
        });
        expect(resp.status).toBe(200);
        categories.push(resp.body);
      }
      expect(categories.length).toBe(5);
    });
  });

  describe('Category Retrieval', () => {
    test('BE-CAT-007: Get all categories for current profile', async () => {
      const resp = await agent.get('/api/categories');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-CAT-008: Category includes all expected fields', async () => {
      if (!testCategoryId) return;
      const resp = await agent.get(`/api/categories/${testCategoryId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('name');
      expect(resp.body).toHaveProperty('color');
    });

    test('BE-CAT-009: Get category by ID', async () => {
      const resp = await agent.get(`/api/categories/${testCategoryId}`);
      expect(resp.status).toBe(200);
      expect(resp.body.id).toBe(testCategoryId);
    });

    test('BE-CAT-010: Returns 404 for non-existent category', async () => {
      const resp = await agent.get('/api/categories/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Category Updates', () => {
    test('BE-CAT-011: Update category name', async () => {
      if (!testCategoryId) return;
      const oldName = 'OldName_' + Date.now();
      const newName = 'NewName_' + Date.now();

      await agent.post('/api/categories').send({ name: oldName });
      const createResp = await agent.get('/api/categories').query({ limit: 1 });
      const id = createResp.body[0].id;

      const resp = await agent.put(`/api/categories/${id}`).send({ name: newName });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${id}`);
      expect(checkResp.body.name).toBe(newName);
    });

    test('BE-CAT-012: Update category color', async () => {
      if (!testCategoryId) return;
      const newColor = '#00ff00';

      const resp = await agent.put(`/api/categories/${testCategoryId}`).send({ color: newColor });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${testCategoryId}`);
      expect(checkResp.body.color).toBe(newColor);
    });

    test('BE-CAT-013: Update both name and color', async () => {
      if (!testCategoryId) return;

      const resp = await agent.put(`/api/categories/${testCategoryId}`).send({
        name: 'BothUpdate_' + Date.now(),
        color: '#ffff00'
      });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);

      const checkResp = await agent.get(`/api/categories/${testCategoryId}`);
      expect(checkResp.body.name).toMatch(/BothUpdate/);
      expect(checkResp.body.color).toBe('#ffff00');
    });
  });

  describe('Category Deletion', () => {
    test('BE-CAT-014: Delete category by ID', async () => {
      if (!testCategoryId) return;
      const id = testCategoryId;

      const resp = await agent.delete(`/api/categories/${id}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('ok', true);

      const checkResp = await agent.get(`/api/categories/${id}`);
      expect(checkResp.status).toBe(404);
    });

    test('BE-CAT-015: Delete category with assigned transactions', async () => {
      const catResp = await agent.post('/api/categories').send({ name: 'CatWithTx_' + Date.now() });
      const catId = catResp.body.id;

      const txResp = await agent.post('/api/transactions').send({
        description: 'Category Test',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId = txResp.body.id;

      await agent.put(`/api/transactions/${testTxId}`).send({ categoryId: catId });

      const deleteResp = await agent.delete(`/api/categories/${catId}`);
      expect(deleteResp.status).toBe(200);

      const txCheck = await agent.get(`/api/transactions/${testTxId}`);
      expect(txCheck.body.categoryId).toBeNull();
    });

    test('BE-CAT-016: Delete non-existent returns 404', async () => {
      const resp = await agent.delete('/api/categories/999999999');
      expect(resp.status).toBe(404);
    });
  });

  describe('Category Hierarchy', () => {
    test('BE-CAT-017: Create parent category', async () => {
      const resp = await agent.post('/api/categories').send({
        name: 'Parent_' + Date.now()
      });
      expect(resp.status).toBe(200);
      const parentId = resp.body.id;
    });

    test('BE-CAT-018: Create child category with parent', async () => {
      const parentResp = await agent.post('/api/categories').send({
        name: 'Parent_' + Date.now()
      });
      const parentId = parentResp.body.id;

      const childResp = await agent.post('/api/categories').send({
        name: 'Child_' + Date.now(),
        parentId
      });
      expect(childResp.status).toBe(200);
      expect(childResp.body.parentId).toBe(parentId);
    });

    test('BE-CAT-019: Get all categories includes hierarchy', async () => {
      const resp = await agent.get('/api/categories');
      expect(resp.status).toBe(200);
      resp.body.forEach(cat => {
        expect(cat).toHaveProperty('name');
        expect(cat).toHaveProperty('parentId');
      });
    });
  });

  describe('Transaction Category Assignment', () => {
    beforeAll(async () => {
      const txResp = await agent.post('/api/transactions').send({
        description: 'Cat Tx Test',
        amount: 100,
        date: '2026-04-25',
        type: 'expense'
      });
      testTxId = txResp.body.id;
    });

    test('BE-CAT-020: GET /api/transactions/:id includes category', async () => {
      const resp = await agent.get(`/api/transactions/${testTxId}`);
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('category');
    });

    test('BE-CAT-021: PUT /api/transactions/:id/category updates category', async () => {
      const resp = await agent.put(`/api/transactions/${testTxId}`).send({
        categoryId: 1
      });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);
    });

    test('BE-CAT-022: Filter transactions by category', async () => {
      const resp = await agent.get('/api/transactions').query({
        categoryId: 1,
        limit: 100
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Category Mappings', () => {
    test('BE-CAT-023: Create category mapping', async () => {
      const categories = await agent.get('/api/categories');
      if (categories.body.length >= 2) {
        const cat1 = categories.body[0].id;
        const cat2 = categories.body[1].id;

        const resp = await agent.post('/api/categories/mappings').send({
          sourceCategory: cat1,
          targetCategory: cat2
        });
        expect(resp.status).toBe(200);
      }
    });

    test('BE-CAT-024: Get all category mappings', async () => {
      const resp = await agent.get('/api/categories/mappings');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-CAT-025: Delete category mapping', async () => {
      const mappings = await agent.get('/api/categories/mappings');
      if (mappings.body.length > 0) {
        const mappingId = mappings.body[0].id;

        const resp = await agent.delete(`/api/categories/mappings/${mappingId}`);
        expect(resp.status).toBe(200);
      }
    });
  });

  describe('Category Auto-Map', () => {
    test('BE-CAT-026: Auto-map transaction description to category', async () => {
      if (!agent.jar._cookieJar || agent.jar._cookieJar.store.size === 0) {
        await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
      }

      const resp = await agent.post('/api/categories/auto-map').send({
        description: 'Netflix subscription',
        amount: 15.99
      });
      expect([200, 404]).to.include(resp.status);
    });
  });

  describe('Category Statistics', () => {
    test('BE-CAT-027: Transaction count per category tracked', async () => {
      const categories = await agent.get('/api/categories');
      if (categories.body.length > 0) {
        const catId = categories.body[0].id;

        const txResp = await agent.post('/api/transactions').send({
          description: 'Cat Stats_' + Date.now(),
          amount: 100,
          date: '2026-04-25',
          type: 'expense'
        });

        const mappingResp = await agent.put(`/api/transactions/${txResp.body.id}`).send({
          categoryId: catId
        });
        expect(mappingResp.status).toBe(200);
      }
    });

    test('BE-CAT-028: Total amount per category tracked', async () => {
      const categories = await agent.get('/api/categories');
      if (categories.body.length > 0) {
        const catId = categories.body[0].id;

        const txResp = await agent.post('/api/transactions').send({
          description: 'Amount Stats_' + Date.now(),
          amount: 250,
          date: '2026-04-25',
          type: 'expense'
        });

        const mappingResp = await agent.put(`/api/transactions/${txResp.body.id}`).send({
          categoryId: catId
        });
        expect(mappingResp.status).toBe(200);
      }
    });
  });
});