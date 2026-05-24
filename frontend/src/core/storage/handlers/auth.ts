/**
 * Auth handlers — IndexedDB-backed implementations
 */
import { json, ok } from './helpers'

export async function authLogin(body: unknown): Promise<Response> {
  if (body && typeof body === 'object' && 'username' in body) {
    return json({ id: 1, username: (body as Record<string, unknown>).username, role: 'admin' })
  }
  return json({ error: 'Missing credentials' }, 400)
}

export async function authCheck(): Promise<Response> {
  return json({ authenticated: true, user: { id: 1, username: 'local', role: 'admin' } })
}

export async function authLogout(): Promise<Response> {
  return ok()
}

export async function authMe(): Promise<Response> {
  return json({ id: 1, username: 'local', role: 'admin' })
}
