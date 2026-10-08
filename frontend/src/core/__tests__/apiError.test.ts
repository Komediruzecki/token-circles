/**
 * One error type from both client surfaces: `ApiError` (core/apiError.ts).
 *
 * The typed `api.*` client reads answers in `request()`, the raw `apiGet/apiPost/apiPut/apiDelete`
 * helpers in `parseJsonResponse()`. They used to build a bare Error from the answer's `error` and
 * drop everything else, so the per-field reasons a refusal carries never reached a form, and the
 * two disagreed about everything else: a Cloudflare 502 page was "HTTP 502" on one surface and
 * "Invalid response format", with no status, on the other. A network failure was the browser's
 * "Failed to fetch" on both. Every case here runs through both surfaces.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, apiDelete, apiGet, apiPost, apiPut, errorStatus } from '../api'
import { ApiError, plainMessage } from '../apiError'
import { apiFetch } from '../apiFetch'
import type * as ApiFetchModule from '../apiFetch'

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Each client surface, sending one write. */
const SURFACES: [string, () => Promise<unknown>][] = [
  ['the typed client', () => api.updateTag(1, 'Bills', '#6e9bff')],
  ['apiPost', () => apiPost('/api/categories', { name: '' })],
  ['apiPut', () => apiPut('/api/categories/1', { name: '' })],
  ['apiGet', () => apiGet('/api/categories')],
  ['apiDelete', () => apiDelete('/api/categories/1')],
]

const REFUSAL = {
  error: 'Give the category a name. Choose Expense or Income.',
  fields: { name: 'Give the category a name.', type: 'Choose Expense or Income.' },
}

describe.each(SURFACES)('%s', (_name, send) => {
  it('throws an ApiError carrying the status, the summary and the fields', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(REFUSAL, 400))

    const error = await send().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe(REFUSAL.error)
    expect((error as ApiError).fields).toEqual(REFUSAL.fields)
    expect(errorStatus(error)).toBe(400)
  })

  it('has no fields when the answer names none, as an older Worker answers', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Category name is required' }, 400))

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('Category name is required')
    expect(error.fields).toEqual({})
  })

  it('ignores field entries that are not sentences', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse({ error: 'No.', fields: { name: 'Give the category a name.', type: 3 } }, 400)
    )

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error.fields).toEqual({ name: 'Give the category a name.' })
  })

  it('says something a person can act on for a page that is not JSON', async () => {
    apiFetchMock.mockResolvedValue(
      new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    )

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(502)
    expect(error.message).toBe("Token Circles isn't answering right now. Try again in a moment.")
  })

  it('passes a network failure on as the ApiError apiFetch made of it', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(0, 'You are offline.'))

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
  })

  // The Worker's sign-in gate answers {error: 'Unauthorized'} (worker/src/auth.ts requireAuth).
  // A dialog showed that word and stayed open.
  it('says a 401 from the sign-in gate as a session that has ended', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(401)
    expect(error.message).toBe('Your session has ended. Sign in again to carry on.')
  })

  it('keeps the words of a 401 that has its own', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'That code did not match' }, 401))

    const error = (await send().catch((e: unknown) => e)) as ApiError

    expect(error.message).toBe('That code did not match')
  })
})

describe('a write the session ended under', () => {
  const asked = vi.fn()
  beforeEach(() => {
    window.addEventListener('auth:required', asked)
  })
  afterEach(() => {
    window.removeEventListener('auth:required', asked)
    asked.mockReset()
  })

  // App opens sign-in on 'auth:required'. The typed client asked for it; the raw helpers, which
  // the category dialogs save through, did not.
  it.each(SURFACES.filter(([name]) => name !== 'apiGet'))(
    'asks to sign in again: %s',
    async (_, send) => {
      apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))

      await send().catch(() => undefined)

      expect(asked).toHaveBeenCalledTimes(1)
    }
  )

  it('leaves a read to the page that made it, as the typed client does', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))

    await apiGet('/api/categories').catch(() => undefined)

    expect(asked).not.toHaveBeenCalled()
  })

  it('leaves a 401 from /auth/ to its own form: a wrong password is not an ended session', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'Invalid email or password' }, 401))

    await apiPost('/api/auth/login', { email: 'a@example.com' }).catch(() => undefined)

    expect(asked).not.toHaveBeenCalled()
  })
})

describe('the words for an answer with none of its own', () => {
  it.each([
    [401, 'Your session has ended. Sign in again to carry on.'],
    [403, "You don't have access to that."],
    [404, "That isn't there any more. It may have been deleted."],
    [409, 'That changed somewhere else. Reload to see the latest, then try again.'],
    [413, "That's too large to send."],
    [429, "That's a lot of requests in a row. Wait a moment and try again."],
    [500, 'Something went wrong on our side. Try again in a moment.'],
    [503, "Token Circles isn't answering right now. Try again in a moment."],
    [418, "That didn't work. Try again."],
  ])('%i', async (status, message) => {
    apiFetchMock.mockResolvedValue(new Response('', { status }))

    const error = (await apiPost('/api/x', {}).catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(status)
    expect(error.message).toBe(message)
  })
})

describe('plainMessage', () => {
  it('is an ApiError’s own words, and the fallback for anything else', () => {
    expect(plainMessage(new ApiError(400, 'Give the category a name.'), 'Fallback.')).toBe(
      'Give the category a name.'
    )
    expect(plainMessage(new TypeError('x is undefined'), 'Fallback.')).toBe('Fallback.')
    expect(plainMessage('nope', 'Fallback.')).toBe('Fallback.')
  })
})

describe('apiFetch on a network failure', () => {
  let realApiFetch: typeof apiFetch

  beforeAll(async () => {
    realApiFetch = (await vi.importActual<typeof ApiFetchModule>('../apiFetch')).apiFetch
  })

  beforeEach(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
  })

  afterEach(() => {
    localStorage.removeItem('finance_storage_mode')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws an ApiError with status 0 and a sentence for being offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)

    const error = (await realApiFetch('/api/categories').catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.message).toBe("You're offline. Reconnect and try again.")
  })

  it('says the app could not be reached when the device thinks it is online', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const error = (await realApiFetch('/api/categories').catch((e: unknown) => e)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe("Couldn't reach Token Circles. Check your connection and try again.")
  })

  it('leaves an abort alone', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))

    const error = await realApiFetch('/api/categories').catch((e: unknown) => e)

    expect(error).toBe(abort)
  })

  it('leaves a request that is not for the API alone', async () => {
    const failure = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))

    const error = await realApiFetch('https://cdn.example.com/x.json').catch((e: unknown) => e)

    expect(error).toBe(failure)
  })
})
