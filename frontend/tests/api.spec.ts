import { expect, test } from '@playwright/test'

test.describe('API Endpoint Verification', () => {
  test.beforeEach(async ({ request }) => {
    // Authenticate the request context for all API tests
    await request.post('http://127.0.0.1:3847/api/auth/login', {
      data: { username: 'person', password: 'something-like-this' },
      headers: { 'x-skip-ratelimit': 'true' },
    })
  })

  test('verify accounts API endpoint', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/accounts')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('name')
      expect(data[0]).toHaveProperty('balance')
    }
  })

  test('verify accounts POST endpoint', async ({ request }) => {
    const response = await request.post('http://127.0.0.1:3847/api/accounts', {
      data: {
        name: 'Test Account',
        type: 'checking',
        bank_name: 'Test Bank',
        initial_balance: 1000.0,
        currency: 'USD',
      },
    })

    // May return 201 or 400 if account already exists
    expect([200, 201]).toContain(response.status())

    // Cleanup
    const data = await response.json()
    if (Array.isArray(data) && data.length > 0 && data[0].name === 'Test Account') {
      await request.delete(`http://127.0.0.1:3847/api/accounts/${data[0].id}`)
    }
  })

  test('verify accounts DELETE endpoint', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/accounts')
    const data = await response.json()

    if (Array.isArray(data) && data.length > 0) {
      const accountId = data[0].id
      const deleteResponse = await request.delete(`http://127.0.0.1:3847/api/accounts/${accountId}`)
      expect(deleteResponse.status()).toBe(200)

      // Verify deletion
      const listResponse = await request.get('http://127.0.0.1:3847/api/accounts')
      const listData = await listResponse.json()
      const stillExists = listData.some((a: any) => a.id === accountId)
      expect(stillExists).toBeFalsy()
    }
  })

  test('verify transactions summary API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/transactions/summary', {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    // The API contract is snake_case (what the frontend consumes)
    expect(data).toHaveProperty('count')
    expect(data).toHaveProperty('total_amount')
    expect(data).toHaveProperty('total_expense')
    expect(data).toHaveProperty('total_income')
    expect(data).toHaveProperty('total_expenses')
    expect(data).toHaveProperty('net_balance')
  })

  test('verify transactions API pagination', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/transactions?limit=20', {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data.rows)).toBeTruthy()
    expect(data.rows.length).toBeLessThanOrEqual(20)
  })

  test('verify transactions filter by date', async ({ request }) => {
    const response = await request.get(
      'http://127.0.0.1:3847/api/transactions?start_date=2026-01-01',
      { headers: { 'x-profile-id': '1' } }
    )
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data.rows)).toBeTruthy()
  })

  test('verify housing API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/housing')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('housings')
    expect(data).toHaveProperty('total_monthly')
  })

  test('verify loans API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/loans')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('name')
      expect(data[0]).toHaveProperty('principal')
    }
  })

  test('verify bills API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/bills')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('name')
      expect(data[0]).toHaveProperty('amount')
      expect(data[0]).toHaveProperty('frequency')
    }
  })

  test('verify goals API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/savings-goals')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('name')
      expect(data[0]).toHaveProperty('target_amount')
    }
  })

  test('verify categories API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/categories', {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('id')
      expect(data[0]).toHaveProperty('name')
      expect(data[0]).toHaveProperty('color')
      expect(data[0]).toHaveProperty('type')
    }
  })

  test('verify categories filter by type', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/categories?type=expense', {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data.every((cat: any) => cat.type === 'expense')).toBeTruthy()
    }
  })

  test('verify budgets API', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/budgets')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
  })

  test('verify backend is responding', async ({ page }) => {
    const response = await page.goto('http://127.0.0.1:3847/api/health')
    expect(response?.status()).toBe(200)
  })

  test('verify API has proper error handling', async ({ request }) => {
    // Test non-existent endpoint
    const response = await request.get('http://127.0.0.1:3847/api/non-existent')
    expect(response.status()).toBe(404)

    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('verify accounts search functionality', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/accounts?search=Checking')
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
  })

  test('verify API rate limiting headers', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/accounts', {
      headers: { 'x-test-rate-limit': 'true' },
    })
    expect(response.headers()['x-ratelimit-limit']).toBeDefined()
  })

  test('verify API CORS headers', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:3847/api/accounts')
    // In development, CORS is enabled via the cors() middleware which sets allow-credentials
    expect(response.headers()['access-control-allow-credentials']).toBe('true')
  })
})
