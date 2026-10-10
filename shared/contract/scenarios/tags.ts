import { defaultTagColor, TAG_MESSAGES } from '../../tagSchema';
import { expectMoney, listTransactions, rowsOf, transactionForm } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** Adds a tag. Both runtimes answer 201 with the tag as stored: its id, name and colour. */
async function tag(api: ContractApi, expect: Expect, name: string, color = '#22aa66') {
  const reply = await api.post('/api/tags', { name, color });
  expectOk(expect, reply, 'POST /api/tags');
  expect(reply.status, 'POST /api/tags').toBe(201);
  expect(Object.keys(reply.body).sort(), 'POST /api/tags').toEqual(['color', 'id', 'name']);
  expect(reply.body.id).toEqual(expect.any(Number));
  return reply.body.id as number;
}

async function category(api: ContractApi, expect: Expect, name: string) {
  return added(api, expect, '/api/categories', {
    name,
    type: 'expense',
    color: '#aa5500',
    icon: 'tag',
  });
}

async function spend(api: ContractApi, expect: Expect, fields: Record<string, unknown>) {
  return added(api, expect, '/api/transactions', transactionForm(fields));
}

/** The names of a transaction's tags, as `GET /api/transactions/:id/tags` answers them. */
async function tagsOn(api: ContractApi, expect: Expect, id: number): Promise<string[]> {
  const reply = await api.get(`/api/transactions/${id}/tags`);
  expectOk(expect, reply, `GET /api/transactions/${id}/tags`);
  return (reply.body as Json[]).map((t) => t.name).sort();
}

export const tags = [
  scenario('a tag is added, read back, renamed and removed', async (api, expect) => {
    const id = await tag(api, expect, 'Holiday', '#22aa66');
    expect((await api.get('/api/tags')).body).toContainEqual(
      expect.objectContaining({ id, name: 'Holiday', color: '#22aa66' })
    );

    // The Tags page sends the name and the colour on every edit.
    expectOk(
      expect,
      await api.put(`/api/tags/${id}`, { name: 'Trip', color: '#225588' }),
      'PUT the tag'
    );
    expect((await api.get('/api/tags')).body).toContainEqual(
      expect.objectContaining({ id, name: 'Trip', color: '#225588' })
    );

    expectOk(expect, await api.delete(`/api/tags/${id}`), 'DELETE the tag');
    expect(await rowsOf(api, expect, '/api/tags')).not.toContainEqual(
      expect.objectContaining({ id })
    );
  }),

  scenario(
    "another profile's tag is not read, changed, removed or attached",
    async (api, expect) => {
      const id = await tag(api, expect, 'Mine');
      const other = api.other;
      expect(await rowsOf(other, expect, '/api/tags')).not.toContainEqual(
        expect.objectContaining({ id })
      );
      expect(
        (await other.put(`/api/tags/${id}`, { name: 'Theirs', color: '#000000' })).status
      ).toBe(404);
      expect((await other.delete(`/api/tags/${id}`)).status).toBe(404);

      const theirs = await spend(other, expect, {});
      const attached = await other.put(`/api/transactions/${theirs}/tags`, { tagIds: [id] });
      expect(attached.status).toBe(400);
      expect(attached.body.fields).toEqual({ tagIds: TAG_MESSAGES.tagIds });
      expect(await tagsOn(other, expect, theirs)).toEqual([]);
      expect(
        (await other.post(`/api/tags/${id}/transactions`, { transactionIds: [theirs] })).status
      ).toBe(404);
      expect((await other.get(`/api/tags/${id}/summary`)).status).toBe(404);

      const mine = (await api.get('/api/tags')).body as Json[];
      expect(mine).toContainEqual(expect.objectContaining({ id, name: 'Mine', color: '#22aa66' }));
    }
  ),

  scenario(
    "a transaction's tags are set, replaced, listed by tag, and leave with the tag",
    async (api, expect) => {
      const alpha = await tag(api, expect, 'Alpha');
      const beta = await tag(api, expect, 'Beta');
      const first = await spend(api, expect, { description: 'First', date: '2026-03-01' });
      const second = await spend(api, expect, { description: 'Second', date: '2026-03-09' });

      expectOk(
        expect,
        await api.post(`/api/transactions/${first}/tags`, { tagIds: [alpha, beta] }),
        'POST the tags'
      );
      expect(await tagsOn(api, expect, first)).toEqual(['Alpha', 'Beta']);
      expectOk(
        expect,
        await api.put(`/api/transactions/${first}/tags`, { tagIds: [beta] }),
        'PUT the tags'
      );
      expect(await tagsOn(api, expect, first)).toEqual(['Beta']);
      expectOk(
        expect,
        await api.put(`/api/transactions/${second}/tags`, { tagIds: [beta] }),
        'PUT the tags'
      );

      // The list carries each row's tags.
      const listed = (await listTransactions(api, expect)).find((t) => t.id === first);
      expect(listed.tags).toEqual([expect.objectContaining({ id: beta, name: 'Beta' })]);

      // Newest first, narrowed and paged as the query asks.
      const byTag = async (query = '') => {
        const reply = await api.get(`/api/transactions/by-tag/${beta}${query}`);
        expectOk(expect, reply, `GET by tag${query}`);
        expect(reply.body.total).toBe(reply.body.rows.length);
        return (reply.body.rows as Json[]).map((t) => t.id);
      };
      expect(await byTag()).toEqual([second, first]);
      expect(await byTag('?startDate=2026-03-02&endDate=2026-03-31')).toEqual([second]);
      expect(await byTag('?type=income')).toEqual([]);
      expect(await byTag('?limit=1&offset=1')).toEqual([first]);
      expect(await byTag('?offset=1')).toEqual([first]);
      expect((await api.other.get(`/api/transactions/by-tag/${beta}`)).body.rows).toEqual([]);

      expectOk(expect, await api.delete(`/api/tags/${beta}`), 'DELETE the tag');
      expect(await tagsOn(api, expect, first)).toEqual([]);
      expect(await tagsOn(api, expect, second)).toEqual([]);
      expect((await api.get(`/api/transactions/by-tag/${beta}`)).body.rows).toEqual([]);
    }
  ),

  scenario(
    "tagging a selection adds and removes one tag, on this profile's rows only",
    async (api, expect) => {
      const id = await tag(api, expect, 'Work');
      const other = await tag(api, expect, 'Home');
      const a = await spend(api, expect, { description: 'Taxi' });
      const b = await spend(api, expect, { description: 'Lunch' });
      expectOk(
        expect,
        await api.put(`/api/transactions/${b}/tags`, { tagIds: [other] }),
        'tag b Home'
      );
      const theirs = await spend(api.other, expect, {});

      const tagged = await api.post(`/api/tags/${id}/transactions`, {
        transactionIds: [a, b, theirs],
        mode: 'add',
      });
      expectOk(expect, tagged, 'POST tag the selection');
      expect(tagged.body).toMatchObject({ ok: true, mode: 'add', matched: 2, added: 2 });
      const again = await api.post(`/api/tags/${id}/transactions`, {
        transactionIds: [a, b],
        mode: 'add',
      });
      expect(again.body).toMatchObject({ matched: 2, added: 0 });
      expect(await tagsOn(api, expect, b)).toEqual(['Home', 'Work']);

      const untagged = await api.post(`/api/tags/${id}/transactions`, {
        transactionIds: [a],
        mode: 'remove',
      });
      expect(untagged.body).toMatchObject({ ok: true, mode: 'remove', matched: 1, removed: 1 });
      expect(await tagsOn(api, expect, a)).toEqual([]);
      expect(await tagsOn(api, expect, b)).toEqual(['Home', 'Work']);
      expect(await tagsOn(api.other, expect, theirs)).toEqual([]);
    }
  ),

  scenario(
    'a tag rule is previewed, saved, applied to old rows, and tags new ones',
    async (api, expect) => {
      const coffee = await tag(api, expect, 'Coffee');
      const beans = await spend(api, expect, { description: 'Coffee beans', amount: 12 });
      const shop = await spend(api, expect, { description: 'coffee shop', amount: 4.5 });
      await spend(api, expect, { description: 'Rent', amount: 500 });
      const criteria = { description: 'coffee', descriptionMode: 'contains' };

      const preview = await api.post('/api/tags/rules/preview', { tag_id: coffee, criteria });
      expectOk(expect, preview, 'POST the preview');
      expect(preview.body).toMatchObject({ matched: 2, already_tagged: 0, new_matches: 2 });
      expect((preview.body.sample as Json[]).map((t) => t.id).sort()).toEqual([beans, shop].sort());

      const saved = await api.post('/api/tags/rules', {
        tag_id: coffee,
        name: 'Coffee runs',
        criteria,
        auto_apply: true,
      });
      expectOk(expect, saved, 'POST the rule');
      const rule = saved.body.id as number;
      expect(saved.body).toMatchObject({ tag_id: coffee, name: 'Coffee runs', auto_apply: true });
      expect(saved.body.criteria).toMatchObject(criteria);
      expect((await api.get('/api/tags/rules')).body).toEqual([
        expect.objectContaining({
          id: rule,
          tag_id: coffee,
          name: 'Coffee runs',
          auto_apply: true,
        }),
      ]);

      const applied = await api.post(`/api/tags/${coffee}/apply`, {});
      expectOk(expect, applied, 'POST apply');
      expect(applied.body).toMatchObject({ matched: 2, tagged: 2 });
      expect(await tagsOn(api, expect, beans)).toEqual(['Coffee']);
      const later = await spend(api, expect, { description: 'Coffee to go', amount: 3 });
      expect(await tagsOn(api, expect, later)).toEqual(['Coffee']);

      const other = api.other;
      expect((await other.get('/api/tags/rules')).body).toEqual([]);
      expect(
        (await other.put(`/api/tags/rules/${rule}`, { name: 'x', criteria, auto_apply: true }))
          .status
      ).toBe(404);
      expect((await other.delete(`/api/tags/rules/${rule}`)).status).toBe(404);
      expect((await other.post(`/api/tags/${coffee}/apply`, {})).status).toBe(404);

      expectOk(
        expect,
        await api.put(`/api/tags/rules/${rule}`, {
          name: 'Beans',
          criteria: { description: 'beans', descriptionMode: 'contains' },
          auto_apply: false,
        }),
        'PUT the rule'
      );
      const [edited] = (await api.get('/api/tags/rules')).body as Json[];
      expect(edited).toMatchObject({ id: rule, name: 'Beans', auto_apply: false });
      expect(edited.criteria).toMatchObject({ description: 'beans' });
      const unruled = await spend(api, expect, { description: 'More coffee beans', amount: 9 });
      expect(await tagsOn(api, expect, unruled)).toEqual([]);

      expectOk(expect, await api.delete(`/api/tags/rules/${rule}`), 'DELETE the rule');
      expect((await api.get('/api/tags/rules')).body).toEqual([]);
    }
  ),

  scenario('deleting a tag drops its rules, so they tag nothing more', async (api, expect) => {
    const id = await tag(api, expect, 'Gym');
    expectOk(
      expect,
      await api.post('/api/tags/rules', {
        tag_id: id,
        name: 'Gym',
        criteria: { description: 'gym' },
        auto_apply: true,
      }),
      'POST the rule'
    );
    expectOk(expect, await api.delete(`/api/tags/${id}`), 'DELETE the tag');
    expect((await api.get('/api/tags/rules')).body).toEqual([]);
    const later = await spend(api, expect, { description: 'Gym membership' });
    expect(await tagsOn(api, expect, later)).toEqual([]);
  }),

  scenario('the tag summaries total each tag by type, month and category', async (api, expect) => {
    const holiday = await tag(api, expect, 'Holiday');
    const work = await tag(api, expect, 'Work');
    const food = await category(api, expect, 'Food');
    const travel = await category(api, expect, 'Travel');
    const rows = [
      await spend(api, expect, { amount: 100, date: '2026-03-02', category_id: food }),
      await spend(api, expect, { amount: 50.5, date: '2026-04-10', category_id: travel }),
      await spend(api, expect, { type: 'income', amount: 20, date: '2026-04-11' }),
    ];
    for (const id of rows) {
      expectOk(expect, await api.put(`/api/transactions/${id}/tags`, { tagIds: [holiday] }), 'tag');
    }
    const commute = await spend(api, expect, { amount: 30, date: '2026-03-15' });
    expectOk(expect, await api.put(`/api/transactions/${commute}/tags`, { tagIds: [work] }), 'tag');

    const all = await api.get('/api/tags/summary');
    expectOk(expect, all, 'GET /api/tags/summary');
    const byName = (body: Json[], name: string) => body.find((t) => t.name === name);
    expect(byName(all.body, 'Holiday')).toMatchObject({ id: holiday, count: 3, rule_count: 0 });
    expectMoney(expect, byName(all.body, 'Holiday').expense, 150.5, 'Holiday expense');
    expectMoney(expect, byName(all.body, 'Holiday').income, 20, 'Holiday income');
    expectMoney(expect, byName(all.body, 'Holiday').net, -130.5, 'Holiday net');
    expectMoney(expect, byName(all.body, 'Work').expense, 30, 'Work expense');

    const april = await api.get('/api/tags/summary?startDate=2026-04-01&endDate=2026-04-30');
    expect(byName(april.body, 'Holiday')).toMatchObject({ count: 2 });
    expectMoney(expect, byName(april.body, 'Holiday').expense, 50.5, 'April expense');
    expect(byName(april.body, 'Work')).toMatchObject({ count: 0 });

    const detail = await api.get(`/api/tags/${holiday}/summary`);
    expectOk(expect, detail, 'GET the tag summary');
    expect(detail.body.tag).toMatchObject({ id: holiday, name: 'Holiday' });
    expect(detail.body.totals).toMatchObject({ count: 3 });
    expectMoney(expect, detail.body.totals.net, -130.5, 'net');
    expect(detail.body.monthly).toEqual([
      expect.objectContaining({ month: '2026-03', expense: 100, count: 1 }),
      expect.objectContaining({ month: '2026-04', expense: 50.5, income: 20, count: 2 }),
    ]);
    expect(detail.body.categories).toEqual([
      expect.objectContaining({ category_id: food, name: 'Food', type: 'expense', total: 100 }),
      expect.objectContaining({ category_id: travel, name: 'Travel', total: 50.5 }),
      expect.objectContaining({ category_id: null, name: 'Uncategorized', type: 'income' }),
    ]);
  }),

  scenario(
    "a tag without a colour takes the palette's next, an edit without one keeps it, and a name is the profile's once",
    async (api, expect) => {
      // The colour the Tags page offers a new tag: the palette's next, by the profile's tag count.
      const before = (await rowsOf(api, expect, '/api/tags')).length;
      const plain = await added(api, expect, '/api/tags', { name: 'Plain' });
      const listed = (await rowsOf(api, expect, '/api/tags')).find((t) => t.id === plain);
      expect(listed.color).toBe(defaultTagColor(before));

      const coloured = await tag(api, expect, 'Coloured', '#123456');
      expectOk(expect, await api.put(`/api/tags/${coloured}`, { name: 'Recoloured' }), 'rename');
      const renamed = (await rowsOf(api, expect, '/api/tags')).find((t) => t.id === coloured);
      expect(renamed).toMatchObject({ name: 'Recoloured', color: '#123456' });

      // Another tag's name, in any case, is refused at the name, on a create and on a rename.
      const taken = 'You already have a tag called "Plain". Choose another name.';
      for (const reply of [
        await api.put(`/api/tags/${coloured}`, { name: 'PLAIN', color: '#123456' }),
        await api.post('/api/tags', { name: ' plain ', color: '#123456' }),
      ]) {
        expect(reply.status).toBe(400);
        expect(reply.body).toEqual({ error: taken, fields: { name: taken } });
      }
      const names = (await rowsOf(api, expect, '/api/tags')).map((t) => t.name).sort();
      expect(names.filter((name: string) => name.toLowerCase() === 'plain')).toEqual(['Plain']);
    }
  ),
];
