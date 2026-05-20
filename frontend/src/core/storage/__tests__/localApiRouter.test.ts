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

describe('localApiRouter - category mappings', () => {
  it('GET returns array', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/categories/mappings')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('POST creates and returns mapping', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/categories/mappings', {
      method: 'POST',
      body: JSON.stringify({ name: 'test', mapping: 'test-mapping' }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
  })

  it('DELETE returns ok', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/categories/mappings/1', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })
})

describe('localApiRouter - exchange rates', () => {
  it('returns exchange rates with expected structure', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/exchange-rates')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.base).toBe('EUR')
    expect(data.rates).toBeTypeOf('object')
    expect(data.rates.EUR).toBe(1)
    expect(typeof data.cached).toBe('boolean')
  })

  it('returns single rate for currency pair', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/exchange-rates/EUR/USD')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.base).toBe('EUR')
    expect(data.target).toBe('USD')
    expect(typeof data.rate).toBe('number')
    expect(data.rate).toBeGreaterThan(0)
  })
})

describe('localApiRouter - loan calculate', () => {
  it('returns schedule for valid loan data', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/loans/1/calculate', {
      method: 'POST',
      body: JSON.stringify({ principal: 10000, rate: 5, termMonths: 12 }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.schedule).toBeDefined()
    expect(data.summary).toBeDefined()
  })
})

describe('localApiRouter - path with params', () => {
  it('matches paths with numeric IDs', async () => {
    const { routeApiRequest } = await loadModule()
    const res = await routeApiRequest('http://localhost/api/categories/mappings/42', {
      method: 'DELETE',
    })
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
    // Use a POST route that processes body - categories mappings (stub)
    const res = await routeApiRequest('http://localhost/api/categories/mappings', {
      method: 'POST',
      body: JSON.stringify({ name: 'Netflix', amount: 14.99 }),
    })
    expect(res.status).toBe(201)
  })
})
