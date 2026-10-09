/**
 * The tag list names each tag's profile, as the local store's rows do.
 *
 * The Transactions page keeps a list of tags and offers only the active profile's in its form and
 * its bulk-tag modal: just after a profile switch, the list on screen is still the other profile's.
 * The Worker listed tags without `profile_id`, so the page could not tell them apart in cloud mode.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionCookie } from './helpers/session';

const USER = 9302;
const PROFILE = 93020;
const OTHER = 93021;
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tags WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'tag-owner@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Personal'
    ),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      OTHER,
      USER,
      'Family'
    ),
    env.DB.prepare("INSERT INTO tags (name, color, profile_id) VALUES ('work', '#6e9bff', ?)").bind(
      PROFILE
    ),
    env.DB.prepare("INSERT INTO tags (name, color, profile_id) VALUES ('trip', '#e0708a', ?)").bind(
      PROFILE
    ),
    env.DB.prepare(
      "INSERT INTO tags (name, color, profile_id) VALUES ('school', '#84cc16', ?)"
    ).bind(OTHER),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

describe('GET /api/tags', () => {
  it("lists the active profile's tags, each with its profile_id", async () => {
    const res = await SELF.fetch('https://example.com/api/tags', {
      headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
    });

    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string; profile_id?: unknown }[];
    expect(rows.map((t) => [t.name, t.profile_id])).toEqual([
      ['trip', PROFILE],
      ['work', PROFILE],
    ]);
  });
});
