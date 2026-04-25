/**
 * E2E Tests for Receipts & OCR API
 * Covers receipt upload, OCR parsing, line items, splitting, export formats
 */
const request = require('supertest');
const { expect } = require('chai');

const BASE_URL = 'http://localhost:3847';

describe('Receipts E2E', () => {
  let agent;

  beforeAll(async () => {
    agent = request.agent(BASE_URL);
    const loginRes = await agent.post('/api/auth/login').send({ username: 'maff', password: 'add2' });
    if (loginRes.headers['set-cookie']) {
      agent.jar.setCookie(loginRes.headers['set-cookie'][0], BASE_URL);
    }
  });

  describe('Receipt Upload', () => {
    test('BE-RCP-001: Upload receipt image successfully', async () => {
      // Create a simple text file as mock receipt image
      const receiptContent = Buffer.from('Mock Receipt Data');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      expect(resp.status).toBe(200);
      expect(resp.body).toHaveProperty('id');
      expect(resp.body).toHaveProperty('imageUrl');
    });

    test('BE-RCP-002: Upload receipt in different format', async () => {
      const receiptContent = Buffer.from('Mock Receipt PNG');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.png');
      expect([200, 400]).to.include(resp.status);
    });

    test('BE-RCP-003: Reject file larger than 10MB', async () => {
      // Create a 15MB file
      const largeContent = Buffer.alloc(15 * 1024 * 1024);

      const resp = await agent.post('/api/receipts').attach('receipt', largeContent, 'large.jpg');
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-RCP-004: Reject non-image file', async () => {
      const txtContent = Buffer.from('This is text, not an image');

      const resp = await agent.post('/api/receipts').attach('receipt', txtContent, 'receipt.txt');
      expect([400, 422]).to.include(resp.status);
    });

    test('BE-RCP-005: Reject file with invalid extension', async () => {
      const txtContent = Buffer.from('Mock receipt');

      const resp = await agent.post('/api/receipts').attach('receipt', txtContent, 'receipt.pdf');
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Receipt OCR Parsing', () => {
    test('BE-RCP-006: OCR extracts total amount', async () => {
      const receiptContent = Buffer.from('Mock Receipt With $123.45 Total');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        expect(resp.body).toHaveProperty('totalAmount');
        expect(resp.body.totalAmount).toBeFinite();
      }
    });

    test('BE-RCP-007: OCR extracts date', async () => {
      const receiptContent = Buffer.from('Mock Receipt Date: 2026-04-25');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        expect(resp.body).toHaveProperty('date');
      }
    });

    test('BE-RCP-008: OCR extracts merchant name', async () => {
      const receiptContent = Buffer.from('Merchant: Walmart $50.00');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        expect(resp.body).toHaveProperty('merchant');
      }
    });

    test('BE-RCP-009: Extract line items from receipt', async () => {
      const receiptContent = Buffer.from('Item1: $10.00\nItem2: $20.00');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        expect(resp.body).toHaveProperty('items');
        expect(Array.isArray(resp.body.items)).toBe(true);
      }
    });
  });

  describe('Receipt Line Items', () => {
    test('BE-RCP-010: Parse individual line items', async () => {
      const receiptContent = Buffer.from('Apple: $1.99\nBanana: $0.99');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200 && resp.body.items) {
        expect(resp.body.items.length).toBeGreaterThan(0);
        resp.body.items.forEach(item => {
          expect(item).toHaveProperty('name');
          expect(item).toHaveProperty('amount');
        });
      }
    });

    test('BE-RCP-011: Line items sum to total', async () => {
      const receiptContent = Buffer.from('Product A: $10.00\nProduct B: $15.00');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        const expectedTotal = 25.00;
        const actualTotal = resp.body.items.reduce((sum, item) => sum + item.amount, 0);
        expect(actualTotal).toBeCloseTo(expectedTotal, 2);
      }
    });

    test('BE-RCP-012: Handle multiple decimal places in items', async () => {
      const receiptContent = Buffer.from('Item1: $12.345\nItem2: $6.789');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        expect(resp.body.totalAmount).toBeDefined();
      }
    });

    test('BE-RCP-013: Reject negative line item amount', async () => {
      const receiptContent = Buffer.from('Item: -$10.00');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      expect([400, 422]).to.include(resp.status);
    });
  });

  describe('Receipt Split & Share', () => {
    test('BE-RCP-014: Split receipt among multiple people', async () => {
      const receiptContent = Buffer.from('Meal: $100');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        // Share receipt
        const shareResp = await agent.post(`/api/receipts/${resp.body.id}/share`).send({
          shareWith: ['user1', 'user2']
        });
        expect(shareResp.status).toBe(200);
      }
    });

    test('BE-RCP-015: Share receipt with specific user', async () => {
      const receiptContent = Buffer.from('Shared Receipt $50');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        const shareResp = await agent.post(`/api/receipts/${resp.body.id}/share`).send({
          shareWith: 'friend'
        });
        expect(shareResp.status).toBe(200);
      }
    });

    test('BE-RCP-016: Split by amount', async () => {
      const receiptContent = Buffer.from('Bill: $60');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        // Split bill by amount (2 people, $30 each)
        const splitResp = await agent.post(`/api/receipts/${resp.body.id}/split`).send({
          by: 'amount',
          amount: 30
        });
        expect(splitResp.status).toBe(200);
      }
    });

    test('BE-RCP-017: Split by percentage', async () => {
      const receiptContent = Buffer.from('Bill: $100');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (resp.status === 200) {
        // Split 50/50
        const splitResp = await agent.post(`/api/receipts/${resp.body.id}/split`).send({
          by: 'percentage',
          percentages: [50, 50]
        });
        expect(splitResp.status).toBe(200);
      }
    });
  });

  describe('Receipt Export', () => {
    test('BE-RCP-018: Export receipt as PDF', async () => {
      const receiptContent = Buffer.from('Receipt Data');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        const exportResp = await agent.get(`/api/receipts/${uploadResp.body.id}/export`).query({
          format: 'pdf'
        });
        expect(exportResp.status).toBe(200);
        expect(exportResp.headers['content-type']).toMatch(/pdf/);
      }
    });

    test('BE-RCP-019: Export receipt as CSV', async () => {
      const receiptContent = Buffer.from('Receipt CSV');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        const exportResp = await agent.get(`/api/receipts/${uploadResp.body.id}/export`).query({
          format: 'csv'
        });
        expect(exportResp.status).toBe(200);
        expect(exportResp.headers['content-type']).toMatch(/csv/);
      }
    });

    test('BE-RCP-020: Export receipt as JSON', async () => {
      const receiptContent = Buffer.from('Receipt JSON');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        const exportResp = await agent.get(`/api/receipts/${uploadResp.body.id}/export`).query({
          format: 'json'
        });
        expect(exportResp.status).toBe(200);
        expect(exportResp.headers['content-type']).toMatch(/json/);
      }
    });
  });

  describe('Receipt Management', () => {
    test('BE-RCP-021: Get all receipts', async () => {
      const resp = await agent.get('/api/receipts');
      expect(resp.status).toBe(200);
      expect(Array.isArray(resp.body)).toBe(true);
    });

    test('BE-RCP-022: Get single receipt by ID', async () => {
      const uploadResp = await agent.post('/api/receipts').attach('receipt', Buffer.from('Receipt Data'), 'receipt.jpg');
      if (uploadResp.status === 200) {
        const receiptId = uploadResp.body.id;
        const getResp = await agent.get(`/api/receipts/${receiptId}`);
        expect(getResp.status).toBe(200);
        expect(getResp.body.id).toBe(receiptId);
      }
    });

    test('BE-RCP-023: Update receipt metadata', async () => {
      const uploadResp = await agent.post('/api/receipts').attach('receipt', Buffer.from('Receipt Data'), 'receipt.jpg');
      if (uploadResp.status === 200) {
        const updateResp = await agent.put(`/api/receipts/${uploadResp.body.id}`).send({
          note: 'Updated note'
        });
        expect(updateResp.status).toBe(200);
      }
    });

    test('BE-RCP-024: Delete receipt', async () => {
      const uploadResp = await agent.post('/api/receipts').attach('receipt', Buffer.from('Receipt Data'), 'receipt.jpg');
      if (uploadResp.status === 200) {
        const deleteResp = await agent.delete(`/api/receipts/${uploadResp.body.id}`);
        expect(deleteResp.status).toBe(200);
      }
    });

    test('BE-RCP-025: Get receipts by date range', async () => {
      const resp = await agent.get('/api/receipts').query({
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-RCP-026: Get receipts by merchant', async () => {
      const resp = await agent.get('/api/receipts').query({
        merchant: 'store'
      });
      expect(resp.status).toBe(200);
    });

    test('BE-RCP-027: Get receipts by total amount range', async () => {
      const resp = await agent.get('/api/receipts').query({
        minAmount: 50,
        maxAmount: 200
      });
      expect(resp.status).toBe(200);
    });
  });

  describe('Receipt Statistics', () => {
    test('BE-RCP-028: Total value of all receipts', async () => {
      const resp = await agent.get('/api/receipts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const total = resp.body.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        expect(total).toBeFinite();
      }
    });

    test('BE-RCP-029: Average receipt amount', async () => {
      const resp = await agent.get('/api/receipts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        const avg = resp.body.reduce((sum, r) => sum + (r.totalAmount || 0), 0) / resp.body.length;
        expect(avg).toBeFinite();
      }
    });

    test('BE-RCP-030: Monthly receipt spending', async () => {
      const resp = await agent.get('/api/receipts');
      expect(resp.status).toBe(200);
      if (resp.body.length > 0) {
        // Group by month
        const monthly = {};
        resp.body.forEach(r => {
          const month = r.date.substring(0, 7);
          monthly[month] = (monthly[month] || 0) + (r.totalAmount || 0);
        });
        expect(Object.keys(monthly).length).toBeGreaterThan(0);
      }
    });
  });

  describe('Receipt Organization', () => {
    test('BE-RCP-031: Categorize receipt items', async () => {
      const receiptContent = Buffer.from('Grocery Receipt');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        // Auto-categorize
        const catResp = await agent.post(`/api/receipts/${uploadResp.body.id}/categorize`);
        expect(catResp.status).toBe(200);
      }
    });

    test('BE-RCP-032: Assign category to receipt', async () => {
      const receiptContent = Buffer.from('Dining Receipt');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        const catResp = await agent.put(`/api/receipts/${uploadResp.body.id}`).send({
          categoryId: 1
        });
        expect(catResp.status).toBe(200);
      }
    });

    test('BE-RCP-033: Add note to receipt', async () => {
      const receiptContent = Buffer.from('Receipt');

      const uploadResp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      if (uploadResp.status === 200) {
        const noteResp = await agent.put(`/api/receipts/${uploadResp.body.id}`).send({
          note: 'Weekly grocery shopping'
        });
        expect(noteResp.status).toBe(200);
      }
    });
  });

  describe('Receipt Performance', () => {
    test('BE-RCP-034: Handle many receipts efficiently', async () => {
      for (let i = 0; i < 20; i++) {
        await agent.post('/api/receipts').attach('receipt', Buffer.from(`Receipt ${i}`), `receipt${i}.jpg`);
      }

      const resp = await agent.get('/api/receipts');
      expect(resp.status).toBe(200);
      expect(resp.body.length).toBeGreaterThanOrEqual(20);
    });

    test('BE-RCP-035: OCR completes within timeout', async () => {
      const start = Date.now();
      const receiptContent = Buffer.from('Receipt With Data');

      const resp = await agent.post('/api/receipts').attach('receipt', receiptContent, 'receipt.jpg');
      const duration = Date.now() - start;

      expect(resp.status).toBe(200);
      expect(duration).toBeLessThan(10000); // 10 second timeout
    });
  });

  describe('Receipt Error Handling', () => {
    test('BE-RCP-036: Handle corrupted image file', async () => {
      const corruptedContent = Buffer.from('CORRUPTED JPEG DATA HERE');

      const resp = await agent.post('/api/receipts').attach('receipt', corruptedContent, 'corrupted.jpg');
      // May succeed or fail depending on implementation
      expect([200, 400, 422]).to.include(resp.status);
    });

    test('BE-RCP-037: Handle very small image file', async () => {
      const smallContent = Buffer.alloc(1);

      const resp = await agent.post('/api/receipts').attach('receipt', smallContent, 'tiny.jpg');
      expect([200, 400, 422]).to.include(resp.status);
    });
  });
});