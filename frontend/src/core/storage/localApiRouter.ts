import type { StorageMode } from './storageFactory'

export async function routeApiRequest(
  _url: string,
  _init?: RequestInit
): Promise<Response> {
  return new Response(JSON.stringify({ error: 'Not implemented' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function setStorageMode(_mode: StorageMode): void {
  // Stub — will be wired in LS5+
}
