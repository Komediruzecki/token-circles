import { describe, expect, it } from 'vitest';
import { all, first, isTransientD1Error, run } from '../src/db';

// A minimal D1Database stand-in whose statement runs a provided step function, so a test can
// script transient failures followed by a success and assert the helper retried.
function mockDb(step: () => unknown): D1Database {
  const stmt = {
    bind: () => stmt,
    all: async () => step(),
    first: async () => step(),
    run: async () => step(),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

describe('isTransientD1Error', () => {
  it('flags the D1 export lock and connection blips', () => {
    expect(
      isTransientD1Error(new Error('D1_ERROR: Currently processing a long-running export.'))
    ).toBe(true);
    expect(isTransientD1Error(new Error('Network connection lost.'))).toBe(true);
  });

  it('does not flag ordinary errors', () => {
    expect(isTransientD1Error(new Error('UNIQUE constraint failed: profiles.name'))).toBe(false);
    expect(isTransientD1Error(new Error('no such table: foo'))).toBe(false);
    expect(isTransientD1Error(null)).toBe(false);
  });
});

describe('D1 helpers ride out the export lock', () => {
  it('retries a transient failure, then succeeds (all)', async () => {
    let calls = 0;
    const db = mockDb(() => {
      calls++;
      if (calls === 1) {
        throw new Error('D1_ERROR: Currently processing a long-running export.');
      }
      return { results: [{ year: '2026' }] };
    });
    const rows = await all<{ year: string }>(db, 'SELECT 1');
    expect(calls).toBe(2);
    expect(rows).toEqual([{ year: '2026' }]);
  });

  it('does not retry a non-transient error (first)', async () => {
    let calls = 0;
    const db = mockDb(() => {
      calls++;
      throw new Error('no such table: foo');
    });
    await expect(first(db, 'SELECT 1')).rejects.toThrow(/no such table/);
    expect(calls).toBe(1);
  });

  it('retries the export lock on a write, then succeeds (run)', async () => {
    let calls = 0;
    const db = mockDb(() => {
      calls++;
      if (calls === 1) {
        throw new Error('D1_ERROR: Currently processing a long-running export.');
      }
      return { success: true };
    });
    const res = await run(db, 'UPDATE t SET x = 1');
    expect(calls).toBe(2);
    expect(res).toEqual({ success: true });
  });

  it('does NOT retry a mid-write blip on a write (run) — avoids a double-apply', async () => {
    // A "Network connection lost" can strike after the write committed; retrying it could
    // duplicate the row, so writes retry only the (pre-commit) export lock.
    let calls = 0;
    const db = mockDb(() => {
      calls++;
      throw new Error('Network connection lost.');
    });
    await expect(run(db, 'INSERT INTO t (x) VALUES (1)')).rejects.toThrow(
      /Network connection lost/
    );
    expect(calls).toBe(1);
  });
});
