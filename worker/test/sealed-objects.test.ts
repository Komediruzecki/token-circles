/**
 * Receipt objects (src/sealed-objects.ts) against the local R2 bucket. A sealed object records its
 * plain size so a download can declare its Content-Length: the decrypting stream has no length of
 * its own. The harness does not surface response headers for streamed bodies, so what is pinned
 * here is the mechanism: the opened stream runs through a FixedLengthStream of the recorded size.
 */
import { env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataKeyring } from '../src/data-keys';
import { putReceipt, receiptBytes, receiptStream } from '../src/sealed-objects';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const ring = () => new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
const USER = 57001;
const KEY = 'sealed-objects-test/receipt.bin';
const BYTES = crypto.getRandomValues(new Uint8Array(3000));

beforeAll(async () => {
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER).run();
  await env.DB.prepare(
    "INSERT INTO users (id, email, auth_provider) VALUES (?, 'sealed-objects@example.com', 'password')"
  )
    .bind(USER)
    .run();
});

afterAll(async () => {
  await env.RECEIPTS!.delete(KEY);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER).run();
});

async function read(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('sealed receipt objects', () => {
  it('record their plain size, and stream back exactly those bytes', async () => {
    expect(await putReceipt(ring(), USER, env.RECEIPTS!, KEY, BYTES, 'image/png')).toBe(1);
    const obj = (await env.RECEIPTS!.get(KEY))!;
    expect(obj.customMetadata).toMatchObject({ sealed: 'tce1', plainSize: String(BYTES.length) });
    expect(obj.size).toBeGreaterThan(BYTES.length);
    expect(await read(await receiptStream(ring(), USER, obj, 1))).toEqual(BYTES);
  });

  it('streams through a FixedLengthStream: a recorded size that does not match fails', async () => {
    const stored = new Uint8Array(await (await env.RECEIPTS!.get(KEY))!.arrayBuffer());
    await env.RECEIPTS!.put(KEY, stored, {
      customMetadata: { sealed: 'tce1', plainSize: String(BYTES.length + 1) },
    });
    const wrong = (await env.RECEIPTS!.get(KEY))!;
    await expect(read(await receiptStream(ring(), USER, wrong, 1))).rejects.toThrow();

    // With no recorded size it still opens, only without a declared length.
    await env.RECEIPTS!.put(KEY, stored, { customMetadata: { sealed: 'tce1' } });
    const unsized = (await env.RECEIPTS!.get(KEY))!;
    expect(await read(await receiptStream(ring(), USER, unsized, 1))).toEqual(BYTES);
  });

  it('records the size for a streamed File upload as well', async () => {
    const file = new File([BYTES], 'receipt.png', { type: 'image/png' });
    expect(await putReceipt(ring(), USER, env.RECEIPTS!, KEY, file, 'image/png')).toBe(1);
    const obj = (await env.RECEIPTS!.get(KEY))!;
    expect(obj.customMetadata?.plainSize).toBe(String(BYTES.length));
    expect(await receiptBytes(ring(), USER, obj, 1)).toEqual(BYTES);
  });
});
