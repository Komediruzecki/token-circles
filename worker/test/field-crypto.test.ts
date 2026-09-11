/**
 * The encryption primitives in isolation (src/field-crypto.ts): no database, no environment.
 * These carry the whole weight of "a leaked database is useless", so every property the format
 * claims — fresh IVs, binding to column and owner, detection of tampering, truncation and
 * reordering — has a test that fails if the property stops holding.
 */
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode } from '../src/auth';
import {
  CHUNK_SIZE,
  openBytes,
  openField,
  openObjectStream,
  openText,
  sealBytes,
  sealedObjectLength,
  sealField,
  sealObjectStream,
  sealText,
  SealedValueError,
  TEXT_PREFIX,
} from '../src/field-crypto';

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

const DESC = { table: 'transactions', column: 'description', userId: 7 };
const RC = { kind: 'receipt' as const, userId: 7 };

describe('sealed text', () => {
  it('round-trips plain, accented, CJK and astral-plane text', async () => {
    const key = await aesKey();
    for (const s of [
      'LIDL HR 0123 ZAGREB',
      'Čevapčići — Đakovo, Ž',
      '東京駅 コンビニ',
      'clef \u{1D11E} end',
      '\uFEFFled by a byte-order mark',
      'x'.repeat(5000),
    ]) {
      const sealed = await sealText(key, s, DESC);
      expect(sealed.startsWith(TEXT_PREFIX)).toBe(true);
      expect(sealed).not.toContain(s.slice(0, 8));
      expect(await openText(key, sealed, DESC)).toBe(s);
    }
  });

  it('uses a fresh IV every time, so equal text never seals to equal ciphertext', async () => {
    const key = await aesKey();
    const a = await sealText(key, 'Rent', DESC);
    const b = await sealText(key, 'Rent', DESC);
    expect(a).not.toBe(b);
  });

  it('is bound to its column: a description does not open as notes', async () => {
    const key = await aesKey();
    const sealed = await sealText(key, 'Pharmacy', DESC);
    await expect(openText(key, sealed, { ...DESC, column: 'notes' })).rejects.toBeInstanceOf(
      SealedValueError
    );
  });

  it('is bound to its table', async () => {
    const key = await aesKey();
    const sealed = await sealText(key, 'Gym', DESC);
    await expect(
      openText(key, sealed, { ...DESC, table: 'recurring_transactions' })
    ).rejects.toBeInstanceOf(SealedValueError);
  });

  it("is bound to its owner: user 7's value does not open as user 8's", async () => {
    const key = await aesKey();
    const sealed = await sealText(key, 'Salary', DESC);
    await expect(openText(key, sealed, { ...DESC, userId: 8 })).rejects.toBeInstanceOf(
      SealedValueError
    );
  });

  it('rejects a single flipped bit', async () => {
    const key = await aesKey();
    const sealed = await sealText(key, 'Doctor', DESC);
    const [iv, ct] = sealed.slice(TEXT_PREFIX.length).split('.');
    const bytes = b64urlDecode(ct);
    bytes[0] ^= 0x01;
    const tampered = `${TEXT_PREFIX}${iv}.${b64urlEncode(bytes)}`;
    await expect(openText(key, tampered, DESC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it('rejects the wrong key', async () => {
    const sealed = await sealText(await aesKey(), 'Bank fee', DESC);
    await expect(openText(await aesKey(), sealed, DESC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it('turns every malformed value into a SealedValueError, never a raw crypto or decode error', async () => {
    const key = await aesKey();
    for (const bad of [
      'Lunch',
      'tc1.',
      'tc1.abc',
      'tc1..abc',
      'tc1.abc.',
      'tc1.!!!.@@@',
      'tc1.AAAA.AAAA',
    ]) {
      await expect(openText(key, bad, DESC)).rejects.toBeInstanceOf(SealedValueError);
    }
  });

  it('stores NULL and empty as they are, and seals everything else', async () => {
    const key = await aesKey();
    expect(await sealField(key, null, DESC)).toBeNull();
    expect(await sealField(key, undefined, DESC)).toBeUndefined();
    expect(await sealField(key, '', DESC)).toBe('');
    expect(await openField(key, null, DESC)).toBeNull();
    expect(await openField(key, '', DESC)).toBe('');
    const sealed = (await sealField(key, 'Cinema', DESC)) as string;
    expect(await openField(key, sealed, DESC)).toBe('Cinema');
  });

  it('refuses to open a non-text value found in a sealed row', async () => {
    await expect(openField(await aesKey(), 42, DESC)).rejects.toBeInstanceOf(SealedValueError);
  });
});

function pattern(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

/** Push `input` through a transform in pieces of the given sizes (cycled), collect the output. */
async function through(
  ts: TransformStream<Uint8Array, Uint8Array>,
  input: Uint8Array,
  pieces: number[]
): Promise<Uint8Array> {
  const writer = ts.writable.getWriter();
  const out: Uint8Array[] = [];
  const reading = (async () => {
    const reader = ts.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
  })();
  const writing = (async () => {
    let offset = 0;
    let i = 0;
    while (offset < input.length) {
      const size = pieces[i++ % pieces.length];
      await writer.write(input.slice(offset, offset + size));
      offset += size;
    }
    await writer.close();
  })();
  // Both sides together: a transform that errors rejects the writer AND the reader, and awaiting
  // only one leaves the other's rejection unhandled.
  await Promise.all([writing, reading]);
  const total = out.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of out) {
    joined.set(p, at);
    at += p.length;
  }
  return joined;
}

// A 64-byte chunk size exercises every chunk-boundary case in microseconds; one test below uses
// the real 1 MiB default so the constant itself is covered.
const SMALL = 64;
const SIZES = [0, 1, SMALL - 1, SMALL, SMALL + 1, SMALL * 2, SMALL * 3 + 5];

describe('sealed receipt objects', () => {
  it.each(SIZES)('round-trips %i bytes buffered, at exactly the predicted length', async (n) => {
    const key = await aesKey();
    const plain = pattern(n);
    const sealed = await sealBytes(key, plain, RC, SMALL);
    expect(sealed.length).toBe(sealedObjectLength(n, SMALL));
    expect(await openBytes(key, sealed, RC)).toEqual(plain);
  });

  it.each(SIZES)('stream and buffer formats are interchangeable at %i bytes', async (n) => {
    const key = await aesKey();
    const plain = pattern(n);
    for (const pieces of [[1], [7], [SMALL], [SMALL + 1], [1000], [3, 64, 1, 90]]) {
      const streamed = await through(sealObjectStream(key, RC, SMALL), plain, pieces);
      expect(streamed.length).toBe(sealedObjectLength(n, SMALL));
      expect(await openBytes(key, streamed, RC)).toEqual(plain);

      const buffered = await sealBytes(key, plain, RC, SMALL);
      expect(await through(openObjectStream(key, RC), buffered, pieces)).toEqual(plain);
    }
  });

  it('seals an exact multiple of the chunk size to that many chunks, not one more', () => {
    expect(sealedObjectLength(SMALL * 2, SMALL)).toBe(16 + SMALL * 2 + 2 * 16);
    expect(sealedObjectLength(0, SMALL)).toBe(16 + 16);
  });

  it('detects an object truncated at a chunk boundary', async () => {
    const key = await aesKey();
    const sealed = await sealBytes(key, pattern(SMALL * 3 + 5), RC, SMALL);
    const cut = sealed.slice(0, 16 + 3 * (SMALL + 16)); // drops the whole final chunk
    await expect(openBytes(key, cut, RC)).rejects.toBeInstanceOf(SealedValueError);
    await expect(through(openObjectStream(key, RC), cut, [50])).rejects.toThrow(
      /failed authentication|truncated/
    );
  });

  it('detects a single dropped byte', async () => {
    const key = await aesKey();
    const sealed = await sealBytes(key, pattern(200), RC, SMALL);
    await expect(openBytes(key, sealed.slice(0, -1), RC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it('detects reordered chunks', async () => {
    const key = await aesKey();
    const sealed = await sealBytes(key, pattern(SMALL * 3), RC, SMALL);
    const full = SMALL + 16;
    const swapped = sealed.slice();
    swapped.set(sealed.subarray(16 + full, 16 + 2 * full), 16);
    swapped.set(sealed.subarray(16, 16 + full), 16 + full);
    await expect(openBytes(key, swapped, RC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it('detects a changed header, whether chunk size or nonce', async () => {
    const key = await aesKey();
    const sealed = await sealBytes(key, pattern(150), RC, SMALL);
    const nonce = sealed.slice();
    nonce[10] ^= 0xff;
    await expect(openBytes(key, nonce, RC)).rejects.toBeInstanceOf(SealedValueError);
    const size = sealed.slice();
    size[7] ^= 0x01; // chunk size 64 -> 65
    await expect(openBytes(key, size, RC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it("is bound to its owner: user 7's receipt does not open as user 8's", async () => {
    const key = await aesKey();
    const sealed = await sealBytes(key, pattern(100), RC, SMALL);
    await expect(openBytes(key, sealed, { ...RC, userId: 8 })).rejects.toBeInstanceOf(
      SealedValueError
    );
  });

  it('refuses a raw, never-sealed upload', async () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pattern(100));
    await expect(openBytes(await aesKey(), png, RC)).rejects.toBeInstanceOf(SealedValueError);
  });

  it('round-trips at the real 1 MiB chunk size, across three chunks', async () => {
    const key = await aesKey();
    const plain = pattern(CHUNK_SIZE * 2 + 12345);
    const streamed = await through(sealObjectStream(key, RC), plain, [65536]);
    expect(streamed.length).toBe(sealedObjectLength(plain.length));
    expect(await through(openObjectStream(key, RC), streamed, [65536])).toEqual(plain);
  });
});
