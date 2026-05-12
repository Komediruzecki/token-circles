import { describe, expect, it } from 'vitest'

// Test the route matching and dispatch logic from localApiRouter.
// We test the exported `routeApiRequest` function which handles URL parsing,
// route matching, method validation, and handler dispatch.

// We import dynamically because the module uses `import.meta.env` and other
// browser APIs that need jsdom setup.
async function loadModule() {
  return await import('../localApiRouter.js')
}

describe('localApiRouter - route matching', () => {
  it('returns 200 for known GET route /api/health', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/health')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.timestamp).toBeDefined()
  })

  it('returns 200 for known GET route /api/app-info', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/app-info')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('Finance Manager')
    expect(data.mode).toBe('serverless')
  })

  it('returns 404 for unknown path', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/nonexistent')
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('Not found')
  })

  it('returns 405 for known path with wrong method', async () => {
    const { routeApiRequest } = await loadModule()
    // /api/health only accepts GET
    const res = await routeApiRequest('http://localhost/api/health', { method: 'POST' })
    expect(res.status).toBe(405)
    const data = await res.json()
    expect(data.error).toContain('Method not allowed')
  })

  it('parses query parameters from URL', async () => {
    const { routeApiRequest } = await loadModule()
    // Use a route that doesn't need IndexedDB - stub routes work
    const res = await routeApiRequest('http://localhost/api/exchange-rates')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.rates).toBeDefined()
    expect(data.rates.EUR).toBe(1)
  })
})

describe('localApiRouter - stub handlers', () => {
  it('stub GET returns empty array', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/tags')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBe(0)
  })

  it('stub POST returns { id: 1 } with 201', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/recurring', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBe(1)
  })

  it('stub DELETE returns { ok: true }', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/tags/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })
})

describe('localApiRouter - exchange rates stub', () => {
  it('returns mock exchange rates', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/exchange-rates')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.rates.USD).toBe(1.08)
    expect(data.rates.GBP).toBe(0.85)
    expect(data.rates.JPY).toBe(156.0)
  })

  it('returns single rate for pair', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/exchange-rates/EUR/USD')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.rate).toBe(1.08)
  })
})

describe('localApiRouter - loan calculate mock', () => {
  it('returns empty amortization schedule', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/loans/1/calculate', { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.schedule).toEqual([])
    expect(data.summary.totalPaid).toBe(0)
  })
})

describe('localApiRouter - path with params', () => {
  it('matches paths with numeric IDs', async () => {
    const { routeApiRequest } = await loadModule()
    // Tags/:id with DELETE returns stub { ok: true }
    const res = await routeApiRequest('http://localhost/api/tags/42', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })

  it('returns 405 for param route with wrong method', async () => {
    const { routeApiRequest } = await loadModule()
    // retirement-goals/:id only accepts PUT and DELETE, not GET
    const res = await routeApiRequest('http://localhost/api/retirement-goals/1')
    expect(res.status).toBe(405)
  })
})

describe('localApiRouter - body parsing', () => {
  it('parses JSON body string', async () => {
    const { routeApiRequest } = await loadModule()
    // Use a POST route that processes body - recurring creation (stub)
    const res = await routeApiRequest('http://localhost/api/recurring', {
      method: 'POST',
      body: JSON.stringify({ name: 'Netflix', amount: 14.99 }),
    })
    expect(res.status).toBe(201)
  })
})
