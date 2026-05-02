/**
 * API Utilities
 * Centralized fetch helpers with error handling
 */

export interface ApiError {
  error: string
  details?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// Default fetch options
function getProfileHeader() {
  const id = localStorage.getItem('currentProfileId')
  return (id !== null ? parseInt(id, 10) : 1).toString()
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Profile-Id': getProfileHeader(),
  }
}

const DEFAULT_FETCH_OPTIONS = {
  credentials: 'include' as RequestCredentials,
}

/**
 * Check if response indicates an error
 */
function checkResponseStatus(response: Response): void {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
}

/**
 * Parse JSON response with error handling
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type')
  if (contentType !== null && contentType.includes('application/json')) {
    const data = (await response.json()) as T
    if (!response.ok) {
      const errorData = data as ApiError | undefined
      throw new Error(
        (errorData?.error ?? '') !== ''
          ? errorData?.error
          : `Request failed with status ${response.status}`
      )
    }
    return data
  }
  throw new Error('Invalid response format')
}

/**
 * GET request helper
 */
export async function apiGet<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, {
    ...DEFAULT_FETCH_OPTIONS,
    method: 'GET',
    headers: getHeaders(),
  })
  checkResponseStatus(response)
  return parseJsonResponse<T>(response)
}

/**
 * POST request helper
 */
export async function apiPost<T = unknown>(
  url: string,
  body: unknown,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...DEFAULT_FETCH_OPTIONS,
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
    ...options,
  })
  checkResponseStatus(response)
  return parseJsonResponse<T>(response)
}

/**
 * PUT request helper
 */
export async function apiPut<T = unknown>(
  url: string,
  body: unknown,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...DEFAULT_FETCH_OPTIONS,
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body),
    ...options,
  })
  checkResponseStatus(response)
  return parseJsonResponse<T>(response)
}

/**
 * DELETE request helper
 */
export async function apiDelete<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, {
    ...DEFAULT_FETCH_OPTIONS,
    method: 'DELETE',
    headers: getProfileHeader() !== '1' ? { 'X-Profile-Id': getProfileHeader() } : {},
  })
  checkResponseStatus(response)
  return parseJsonResponse<T>(response)
}

/**
 * Generic API request with error handling
 * Returns result object with success flag for easier error handling
 */
export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      headers: getHeaders(),
      ...options,
    })

    const contentType = response.headers.get('content-type')
    let data: T | undefined

    if (contentType !== null && contentType.includes('application/json')) {
      data = (await response.json()) as T
    }

    if (!response.ok) {
      const errorMsg =
        data !== undefined && 'error' in (data as object)
          ? (data as ApiError).error
          : `Request failed (${response.status})`
      return { success: false, error: errorMsg }
    }

    return { success: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error occurred'
    console.error('API request failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Toast notification helper (singleton pattern)
 */
let toastTimeout: ReturnType<typeof setTimeout> | null = null
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  // Remove existing toast
  const existing = document.querySelector('.toast-notification')
  if (existing !== null) existing.remove()

  // Create toast element
  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${type}`
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 6px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    animation: toastSlideIn 0.3s ease-out;
    background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : '#007bff'};
  `

  document.body.appendChild(toast)

  // Auto-remove after 4 seconds
  if (toastTimeout !== null) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease-out'
    setTimeout(() => {
      toast.remove()
    }, 300)
  }, 4000)
}
