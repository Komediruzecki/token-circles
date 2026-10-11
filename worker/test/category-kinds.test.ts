/**
 * Migration 0036 gives categories a kind and the choice of whether each is needed every month, and
 * the Worker's defaults carry their kinds (shared/guidance/kinds.ts).
 *
 * The columns are added with no default and no rewrite: a category stored before them reads NULL
 * for both, which the app reads as "go by the name". What the routes store and answer for them is
 * the CRUD contract's (shared/contract/scenarios/categories.ts), in both runtimes.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/profileData';
import { kindForName } from '../../shared/guidance/kinds';

interface Column {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}

describe('migration 0036', () => {
  it('adds kind as text and essential as an integer, both nullable and with no default', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(categories)').all<Column>();
    const column = (name: string) => results.find((c) => c.name === name);
    expect(column('kind')).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
    expect(column('essential')).toMatchObject({ type: 'INTEGER', notnull: 0, dflt_value: null });
  });

  it('leaves a category written without them reading NULL for both', async () => {
    const id = 936001;
    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    await env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type) VALUES (?, 1, 'Old row', 'expense')"
    )
      .bind(id)
      .run();
    const row = await env.DB.prepare('SELECT kind, essential FROM categories WHERE id = ?')
      .bind(id)
      .first();
    expect(row).toEqual({ kind: null, essential: null });
    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  });
});

describe("the Worker's default categories", () => {
  it('give each expense category the kind its name suggests, and income ones none', () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.kind, category.name).toBe(
        category.type === 'expense' ? kindForName(category.name) : null
      );
    }
  });

  it('have Groceries and Eating out, and no Food', () => {
    const names = DEFAULT_CATEGORIES.map((category) => category.name as string);
    expect(names).toContain('Groceries');
    expect(names).toContain('Eating out');
    expect(names).not.toContain('Food');
  });
});
