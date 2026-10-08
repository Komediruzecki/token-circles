import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/contract-sheet/edit#gid=0';

/** The body Connected Sources saves for a new sheet (features/import/ConnectedSources.tsx, addSource). */
export function sourceForm(fields: Record<string, unknown> = {}) {
  return {
    kind: 'google_sheet',
    label: 'Bank ledger',
    config: { url: SHEET_URL, sheetName: 'Sheet1' },
    // The mapping is kept by header name, so it survives the sheet's columns moving.
    mapping: { date: 'Date', description: 'Description', amount: 'Amount', category: 'Category' },
    schedule: 'manual',
    ...fields,
  };
}

async function addSource(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  const reply = await api.post('/api/import-sources', sourceForm(fields));
  expectOk(expect, reply, 'POST /api/import-sources');
  expect(reply.status).toBe(201);
  return reply.body;
}

async function sources(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/import-sources');
  expectOk(expect, reply, 'GET /api/import-sources');
  return reply.body as Json[];
}

export const importSources = [
  scenario('a connected sheet is saved, read back, synced and removed', async (api, expect) => {
    const saved = await addSource(api, expect);
    const asSaved = {
      id: expect.any(Number),
      kind: 'google_sheet',
      label: 'Bank ledger',
      config: { url: SHEET_URL, sheetName: 'Sheet1' },
      mapping: { date: 'Date', description: 'Description', amount: 'Amount', category: 'Category' },
      category_types: null,
      default_account_id: null,
      schedule: 'manual',
      last_synced_at: null,
      last_cursor: null,
    };
    expect(saved).toMatchObject(asSaved);
    const id = saved.id as number;
    expect(await sources(api, expect)).toEqual([expect.objectContaining({ ...asSaved, id })]);

    // After an import from it, the page stamps the sync time and nothing else.
    const syncedAt = '2026-10-08T09:30:00.000Z';
    const synced = await api.put(`/api/import-sources/${id}`, { last_synced_at: syncedAt });
    expectOk(expect, synced, 'PUT the sync time');
    expect(synced.body).toMatchObject({ ...asSaved, id, last_synced_at: syncedAt });
    expect(await sources(api, expect)).toEqual([
      expect.objectContaining({ ...asSaved, id, last_synced_at: syncedAt }),
    ]);

    // A change sends only the fields it changes; the rest stay as they were.
    const everyday = await account(api, expect, 'Everyday', 1000);
    const changed = await api.put(`/api/import-sources/${id}`, {
      label: 'Joint ledger',
      category_types: { Savings: 'account' },
      default_account_id: everyday,
    });
    expectOk(expect, changed, 'PUT the label and account');
    const asChanged = {
      ...asSaved,
      id,
      label: 'Joint ledger',
      category_types: { Savings: 'account' },
      default_account_id: everyday,
      last_synced_at: syncedAt,
    };
    expect(changed.body).toMatchObject(asChanged);
    expect(await sources(api, expect)).toEqual([expect.objectContaining(asChanged)]);

    const removed = await api.delete(`/api/import-sources/${id}`);
    expectOk(expect, removed, 'DELETE the source');
    expect(removed.body).toEqual({ deleted: true });
    expect(await sources(api, expect)).toEqual([]);
    expect((await api.delete(`/api/import-sources/${id}`)).status).toBe(404);
    expect((await api.put(`/api/import-sources/${id}`, { label: 'Gone' })).status).toBe(404);
  }),

  scenario("another profile's connected sheet is not changed or removed", async (api, expect) => {
    const { id } = await addSource(api, expect);
    const other = api.other;
    expect(await sources(other, expect)).toEqual([]);
    expect((await other.put(`/api/import-sources/${id}`, { label: 'Theirs' })).status).toBe(404);
    expect((await other.delete(`/api/import-sources/${id}`)).status).toBe(404);
    expect(await sources(api, expect)).toEqual([
      expect.objectContaining({ id, label: 'Bank ledger', last_synced_at: null }),
    ]);
  }),

  scenario('connected sheets are listed newest first', async (api, expect) => {
    const first = (await addSource(api, expect, { label: 'First' })).id;
    const second = (await addSource(api, expect, { label: 'Second' })).id;
    const third = (await addSource(api, expect, { label: 'Third' })).id;
    await addSource(api.other, expect, { label: 'Theirs' });
    expect((await sources(api, expect)).map((s) => s.id)).toEqual([third, second, first]);
  }),
];
