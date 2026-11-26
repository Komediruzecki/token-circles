/**
 * When a Google Sheet cannot be read as CSV, POST /api/import/googlesheet answers 501, and the
 * Import page shows its `error` at the link. That sentence used to splice in the caught error's
 * message whatever it was, so a network failure's internal text reached the page; then it gave its
 * own reason ("got HTML instead of CSV", "HTTP 404") and an XLSX fallback the deployment lacks.
 * Now `error` says what local-first says of a sheet it cannot read, how to share it or upload it
 * (SHEET_UNREADABLE), and an empty sheet says it has no header row (SHEET_EMPTY). The reason goes
 * in `reason`: its own reasons as they are, anything else logged and replaced with a plain one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHEET_EMPTY, SHEET_UNREADABLE } from '../../shared/importSourceSchema';
import { fetchGoogleSheetRows } from '../src/routes/imports';

const SHEET = 'https://docs.google.com/spreadsheets/d/SHEET123/edit#gid=0';
let consoleError: ReturnType<typeof vi.spyOn>;

function serve(respond: () => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond())
  );
}

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

describe('fetchGoogleSheetRows failures', () => {
  it("does not put an unexpected error's text in the 501, and logs it instead", async () => {
    serve(() => {
      throw new Error('connect ECONNREFUSED 10.20.30.40:443 via egress-proxy-7');
    });
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body).toEqual({ error: SHEET_UNREADABLE, reason: 'the download did not complete' });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|egress-proxy/);

    const line = consoleError.mock.calls
      .map((args) => String(args[0]))
      .find((l) => l.includes('ECONNREFUSED'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!);
    expect(logged).toMatchObject({ level: 'error', source: 'google-sheet' });
    expect(typeof logged.stack).toBe('string');
    // The sheet URL is a share link: whoever holds it can read the sheet. It stays out of logs.
    expect(line).not.toContain('SHEET123');
  });

  it('says how to share a sheet that is not shared publicly, and keeps its own reason', async () => {
    serve(() => new Response('<!DOCTYPE html><html></html>', { status: 200 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body).toEqual({
      error: SHEET_UNREADABLE,
      reason: 'Sheet is not publicly accessible (got HTML instead of CSV)',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('says an empty sheet has no header row, and keeps its own reason', async () => {
    serve(() => new Response('', { status: 200 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body).toEqual({ error: SHEET_EMPTY, reason: 'No rows found' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says how to share a sheet Google refuses, and keeps Google's HTTP status as the reason", async () => {
    serve(() => new Response('not found', { status: 404 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body).toEqual({ error: SHEET_UNREADABLE, reason: 'HTTP 404' });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
