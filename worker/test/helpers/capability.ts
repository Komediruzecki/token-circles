/**
 * The API token a capability names. The /api/v1 routes read it when a capability is used
 * (routes/v1.ts), so a test that signs one itself writes its token too: a row in api_tokens for
 * `tokenId`, owned by `userId`, and revoked when `revoked` says so.
 */
import { env } from 'cloudflare:test';

export async function apiTokenRow(tokenId: string, userId: number, revoked = false): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, hint, scopes, revoked_at)
     VALUES (?, ?, 'Capability test', ?, 'testhint', '["read","import"]', ?)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, revoked_at = excluded.revoked_at`
  )
    .bind(tokenId, userId, `capability-test-${tokenId}`, revoked ? new Date().toISOString() : null)
    .run();
}
