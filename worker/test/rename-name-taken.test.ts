/**
 * Renaming a tag or a profile onto a name the profile (or the user) already uses broke a UNIQUE
 * constraint: tags(name, profile_id) and profiles(user_id, name). The create routes checked first;
 * the renames did not, so the D1 error reached the onError handler. Before #601 its text reached
 * the Tags page, Settings and onboarding verbatim; after, it read "Try again in a moment", which
 * can never work. A rename now answers what the create route answers, before the write.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

let cookie = '';

beforeEach(async () => {
  for (const t of ['error_logs', 'tags', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (92, 'rename@example.com', 'password', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (93, 'other@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (920, 92, 'Household')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (921, 92, 'Side business')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (930, 93, 'Travel')"),
    env.DB.prepare(
      "INSERT INTO tags (id, name, color, profile_id) VALUES (9201, 'Groceries', '#22c55e', 920)"
    ),
    env.DB.prepare(
      "INSERT INTO tags (id, name, color, profile_id) VALUES (9202, 'Takeaway', '#f97316', 920)"
    ),
    env.DB.prepare(
      "INSERT INTO tags (id, name, color, profile_id) VALUES (9211, 'Invoices', '#6b7280', 921)"
    ),
  ]);
  cookie = (await sessionCookie(92, 'password', env)).split(';')[0];
});

function send(path: string, method: string, body: unknown, profileId = 920): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(profileId),
    },
    body: JSON.stringify(body),
  });
}

async function nameOf(table: 'tags' | 'profiles', id: number): Promise<string | undefined> {
  const row = await env.DB.prepare(`SELECT name FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ name: string }>();
  return row?.name;
}

describe('PUT /api/tags/:id', () => {
  it("refuses a name another tag in the profile has, with the create route's answer", async () => {
    const res = await send('/api/tags/9202', 'PUT', { name: 'Groceries', color: '#f97316' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Tag already exists' });
    expect(await nameOf('tags', 9202)).toBe('Takeaway');
  });

  it('still saves a tag under its own name, so a colour change goes through', async () => {
    const res = await send('/api/tags/9201', 'PUT', { name: 'Groceries', color: '#000000' });
    expect(res.status).toBe(200);
  });

  it("allows a name that only another profile's tag has", async () => {
    const res = await send('/api/tags/9202', 'PUT', { name: 'Invoices' });
    expect(res.status).toBe(200);
    expect(await nameOf('tags', 9202)).toBe('Invoices');
  });
});

describe('renaming a profile', () => {
  for (const method of ['PUT', 'PATCH']) {
    it(`${method} refuses a name the user's other profile has`, async () => {
      const res = await send('/api/profiles/921', method, { name: 'Household' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'A profile with this name already exists' });
      expect(await nameOf('profiles', 921)).toBe('Side business');
    });
  }

  it('still saves a profile under its own name', async () => {
    const res = await send('/api/profiles/921', 'PUT', { name: 'Side business' });
    expect(res.status).toBe(200);
  });

  it("allows a name only another user's profile has", async () => {
    const res = await send('/api/profiles/921', 'PUT', { name: 'Travel' });
    expect(res.status).toBe(200);
    expect(await nameOf('profiles', 921)).toBe('Travel');
  });
});
