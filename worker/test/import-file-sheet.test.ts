import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

// POST /api/import/file-sheet is retired. The old Import page uploaded a workbook, got a fileId
// back, and asked for one of its sheets by that id; the workbook stayed in the server's memory,
// which a stateless Worker does not have. The page now uploads the file again with the sheet's
// name, and this route answers 410 Gone, so a page cached from before learns why instead of
// meeting a 404.

let cookie = '';

function fileSheet(session: string | null) {
  return SELF.fetch('https://example.com/api/import/file-sheet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session === null ? {} : { Cookie: session }),
    },
    body: JSON.stringify({ fileId: 'upload-1', sheetName: 'March' }),
  });
}

beforeEach(async () => {
  for (const table of ['profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (97, 'sheets@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (970, 97, 'Main')"),
  ]);
  cookie = (await sessionCookie(97, 'password', env)).split(';')[0];
});

describe('POST /api/import/file-sheet', () => {
  it('answers 410 Gone, and says to upload the file again with the sheet named', async () => {
    const res = await fileSheet(cookie);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: 'Re-upload via /api/import/upload with a sheetName field (stateless Worker flow).',
    });
  });

  it('asks for a session first, like every import route', async () => {
    expect((await fileSheet(null)).status).toBe(401);
  });
});
