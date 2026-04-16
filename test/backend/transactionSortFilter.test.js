/**
 * Tests for Transaction Sorting and Category Filtering
 */
const request = require('supertest');

const BASE_URL = 'http://localhost:3847';

describe('Transaction API - Sorting', () => {
  describe('GET /api/transactions with sort parameter', () => {
    test('returns 200 with valid sort fields', async () => {
      const sortFields = ['date', 'amount', 'description', 'category_name', 'type', 'beneficiary', 'payor'];
      for (const sort of sortFields) {
        const resp = await request(BASE_URL)
          .get(`/api/transactions?sort=${sort}&order=asc`);
        expect(resp.status).toBe(200);
        expect(resp.body).toHaveProperty('rows');
        expect(resp.body).toHaveProperty('total');
      }
    });

    test('sorting by category_name does not return empty results', async () => {
      const resp = await request(BASE_URL)
        .get(`/api/transactions?sort=category_name&order=asc&limit=50`);

      expect(resp.status).toBe(200);
      expect(resp.body.rows.length).toBeGreaterThan(0);
    });

    test('sorting by date returns transactions in date order', async () => {
      const ascResp = await request(BASE_URL)
        .get(`/api/transactions?sort=date&order=asc&limit=10`);
      const descResp = await request(BASE_URL)
        .get(`/api/transactions?sort=date&order=desc&limit=10`);

      expect(ascResp.status).toBe(200);
      expect(descResp.status).toBe(200);

      if (ascResp.body.rows.length > 1 && descResp.body.rows.length > 1) {
        // Ascending: oldest date first
        const ascFirst = new Date(ascResp.body.rows[0].date);
        const ascLast = new Date(ascResp.body.rows[ascResp.body.rows.length - 1].date);
        expect(ascFirst.getTime()).toBeLessThanOrEqual(ascLast.getTime());

        // Descending: newest date first
        const descFirst = new Date(descResp.body.rows[0].date);
        const descLast = new Date(descResp.body.rows[descResp.body.rows.length - 1].date);
        expect(descFirst.getTime()).toBeGreaterThanOrEqual(descLast.getTime());
      }
    });

    test('sorting by amount returns transactions in amount order', async () => {
      const ascResp = await request(BASE_URL)
        .get(`/api/transactions?sort=amount&order=asc&limit=10`);

      expect(ascResp.status).toBe(200);
      if (ascResp.body.rows.length > 1) {
        for (let i = 0; i < ascResp.body.rows.length - 1; i++) {
          const curr = parseFloat(ascResp.body.rows[i].amount);
          const next = parseFloat(ascResp.body.rows[i + 1].amount);
          expect(curr).toBeLessThanOrEqual(next);
        }
      }
    });

    test('invalid sort field defaults to date', async () => {
      const resp = await request(BASE_URL)
        .get(`/api/transactions?sort=invalid_field&order=asc`);

      expect(resp.status).toBe(200);
      // Should default to date sorting
    });

    test('sort works with pagination', async () => {
      const resp = await request(BASE_URL)
        .get(`/api/transactions?sort=date&order=desc&limit=5&offset=5`);

      expect(resp.status).toBe(200);
      expect(resp.body.rows.length).toBeLessThanOrEqual(5);
    });

    test('sort works with date range filter', async () => {
      const resp = await request(BASE_URL)
        .get(`/api/transactions?sort=date&order=desc&startDate=2025-01-01&endDate=2026-12-31`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        for (const row of resp.body.rows) {
          const date = new Date(row.date);
          expect(date.getFullYear()).toBeGreaterThanOrEqual(2025);
          expect(date.getFullYear()).toBeLessThanOrEqual(2026);
        }
      }
    });

    test('sort works with type filter', async () => {
      const resp = await request(BASE_URL)
        .get(`/api/transactions?sort=date&order=desc&type=expense`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        expect(resp.body.rows.every(r => r.type === 'expense')).toBe(true);
      }
    });
  });
});

describe('Transaction API - Category Filtering', () => {
  describe('GET /api/transactions with category_ids parameter', () => {
    test('returns 200 with valid category_ids', async () => {
      // First get some categories
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length === 0) {
        console.log('No categories found, skipping test');
        return;
      }

      const catId = catResp.body[0].id;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${catId}`);

      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('rows');
      expect(resp.body).toHaveProperty('total');
    });

    test('returns only transactions of specified categories', async () => {
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length === 0) {
        console.log('No categories found, skipping test');
        return;
      }

      const catId = catResp.body[0].id;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${catId}&limit=100`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        expect(resp.body.rows.every(r => r.category_id === catId)).toBe(true);
      }
    });

    test('handles multiple category_ids separated by comma', async () => {
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length < 2) {
        console.log('Less than 2 categories found, skipping test');
        return;
      }

      const ids = `${catResp.body[0].id},${catResp.body[1].id}`;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${ids}`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        const validIds = [catResp.body[0].id, catResp.body[1].id];
        expect(resp.body.rows.every(r => validIds.includes(r.category_id))).toBe(true);
      }
    });

    test('returns empty results for non-existent category', async () => {
      const resp = await request(BASE_URL)
        .get('/api/transactions?category_ids=999999');

      expect(resp.status).toBe(200);
      expect(resp.body.rows.length).toBe(0);
    });

    test('handles invalid category_ids gracefully', async () => {
      const resp = await request(BASE_URL)
        .get('/api/transactions?category_ids=abc,def');

      expect(resp.status).toBe(200);
      // Should return empty or all results depending on implementation
    });

    test('category_ids works with date range filter', async () => {
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length === 0) {
        console.log('No categories found, skipping test');
        return;
      }

      const catId = catResp.body[0].id;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${catId}&startDate=2025-01-01&endDate=2026-12-31`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 0) {
        for (const row of resp.body.rows) {
          expect(row.category_id).toBe(catId);
          const date = new Date(row.date);
          expect(date.getFullYear()).toBeGreaterThanOrEqual(2025);
        }
      }
    });

    test('category_ids works with sorting', async () => {
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length === 0) {
        console.log('No categories found, skipping test');
        return;
      }

      const catId = catResp.body[0].id;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${catId}&sort=date&order=desc`);

      expect(resp.status).toBe(200);
      if (resp.body.rows.length > 1) {
        const date0 = new Date(resp.body.rows[0].date);
        const date1 = new Date(resp.body.rows[1].date);
        expect(date0.getTime()).toBeGreaterThanOrEqual(date1.getTime());
      }
    });

    test('category_ids works with pagination', async () => {
      const catResp = await request(BASE_URL).get('/api/categories');
      if (catResp.body.length === 0) {
        console.log('No categories found, skipping test');
        return;
      }

      const catId = catResp.body[0].id;
      const resp = await request(BASE_URL)
        .get(`/api/transactions?category_ids=${catId}&limit=5&offset=0`);

      expect(resp.status).toBe(200);
      expect(resp.body.rows.length).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/transactions with empty category_ids', () => {
    test('returns all transactions when category_ids is empty', async () => {
      const allResp = await request(BASE_URL)
        .get('/api/transactions?limit=100');
      const filteredResp = await request(BASE_URL)
        .get('/api/transactions?category_ids=&limit=100');

      expect(allResp.status).toBe(200);
      expect(filteredResp.status).toBe(200);
      expect(filteredResp.body.rows.length).toBe(allResp.body.rows.length);
    });
  });
});
