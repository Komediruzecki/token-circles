import { expect, test } from '@playwright/test'
import { E2E_BASE } from './e2e-constants'

// No sign-in step: the `request` fixture inherits the storageState the setup project saved, so
// these calls carry the session cookie already. They go through the app origin rather than
// straight at the Worker, which is also what the browser does — the vite dev server proxies /api.
test.describe('API Endpoint Verification', () => {
  test('verify accounts API endpoint', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/accounts`)
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
    const response = await request.post(`${E2E_BASE}/api/accounts`, {
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
      await request.delete(`${E2E_BASE}/api/accounts/${data[0].id}`)
    }
  })

  test('verify accounts DELETE endpoint', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/accounts`)
    const data = await response.json()

    if (Array.isArray(data) && data.length > 0) {
      const accountId = data[0].id
      const deleteResponse = await request.delete(`${E2E_BASE}/api/accounts/${accountId}`)
      expect(deleteResponse.status()).toBe(200)

      // Verify deletion
      const listResponse = await request.get(`${E2E_BASE}/api/accounts`)
      const listData = await listResponse.json()
      const stillExists = listData.some((a: any) => a.id === accountId)
      expect(stillExists).toBeFalsy()
    }
  })

  test('verify transactions summary API', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/transactions/summary`, {
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
    const response = await request.get(`${E2E_BASE}/api/transactions?limit=20`, {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data.rows)).toBeTruthy()
    expect(data.rows.length).toBeLessThanOrEqual(20)
  })

  test('verify transactions filter by date', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/transactions?start_date=2026-01-01`, {
      headers: { 'x-profile-id': '1' },
    })
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data.rows)).toBeTruthy()
  })

  test('verify housing API', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/housing`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('housings')
    expect(data).toHaveProperty('total_monthly')
  })

  test('verify loans API', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/loans`)
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
    const response = await request.get(`${E2E_BASE}/api/bills`)
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
    const response = await request.get(`${E2E_BASE}/api/savings-goals`)
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
    const response = await request.get(`${E2E_BASE}/api/categories`, {
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
    const response = await request.get(`${E2E_BASE}/api/categories?type=expense`, {
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
    const response = await request.get(`${E2E_BASE}/api/budgets`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
  })

  test('verify backend is responding', async ({ page }) => {
    const response = await page.goto(`${E2E_BASE}/api/health`)
    expect(response?.status()).toBe(200)
  })

  test('verify API has proper error handling', async ({ request }) => {
    // Test non-existent endpoint
    const response = await request.get(`${E2E_BASE}/api/non-existent`)
    expect(response.status()).toBe(404)

    const data = await response.json()
    expect(data).toHaveProperty('error')
  })

  test('verify accounts search functionality', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/accounts?search=Checking`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
  })

  test('a rate-limited response says how long to wait', async ({ request }) => {
    // `x-ratelimit-limit` came from express-rate-limit, on a server that no longer exists — the
    // Worker's limiter counts in D1 and answers a refusal with Retry-After. The export route has a
    // low enough cap (10 per 5 minutes) to reach without hammering anything.
    let limited: Awaited<ReturnType<typeof request.get>> | undefined
    for (let attempt = 0; attempt < 12 && !limited; attempt += 1) {
      const response = await request.get(`${E2E_BASE}/api/export`)
      if (response.status() === 429) limited = response
    }

    expect(limited, 'the export limiter never refused within 12 attempts').toBeTruthy()
    expect(Number(limited!.headers()['retry-after'])).toBeGreaterThan(0)
  })

  test('verify API CORS headers', async ({ request }) => {
    const response = await request.get(`${E2E_BASE}/api/accounts`)
    // In development, CORS is enabled via the cors() middleware which sets allow-credentials
    expect(response.headers()['access-control-allow-credentials']).toBe('true')
  })
})
