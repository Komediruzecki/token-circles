/**
 * Field and object encryption at rest — the pure primitives, no database and no environment.
 *
 * Server-side encryption: the Worker holds the keys and decrypts to compute, so every feature
 * keeps working. What it protects is a leaked database export or bucket, not the data from the
 * operator. Design, threat model and rollout: docs/plans/field-encryption.md.
 *
 * Two formats, both AES-256-GCM under a per-user data key (data-keys.ts):
 *
 *   Text   `tc1.<b64url iv>.<b64url ciphertext+tag>` — one value, one fresh 96-bit IV.
 *
 *   Bytes  header `TCE1 | chunkSize u32be | noncePrefix 8B`, then fixed-size chunks, each sealed
 *          with IV = noncePrefix || u32be(index). The header, the chunk index and a final-chunk
 *          flag are in every chunk's additional data, so an object that is reordered, truncated
 *          at a chunk boundary, or given another header fails to open rather than opening wrong.
 *          Chunked because a receipt can be 50 MB and a Worker has 128 MB: an upload streams
 *          through a 1 MiB window instead of sitting in memory beside its own ciphertext.
 *
 * Additional data binds every value to where it lives — table, column, owning user — so a value
 * copied into another column or another user's row fails authentication instead of decrypting.
 * It does NOT bind the row id, which the INSERT storing the value is what assigns.
 */
import { b64urlDecode, b64urlEncode } from './auth';

const utf8 = new TextEncoder();
// fatal: a plaintext that is not valid UTF-8 means the wrong bytes were decrypted, not a string
// with a few replacement characters in it. ignoreBOM: true keeps a leading U+FEFF as content —
// the default strips it, so a description that happened to start with one (a CSV import can do
// that) would come back one character shorter than it went in.
const utf8Strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** UTF-8 bytes, typed as ArrayBuffer-backed for WebCrypto. */
function bytesOf(s: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(utf8.encode(s));
}

/** A value that is present but cannot be opened: tampered, truncated, or sealed elsewhere. */
export class SealedValueError extends Error {
  statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = 'SealedValueError';
  }
}

// ── Text ─────────────────────────────────────────────────────────────────────

export const TEXT_PREFIX = 'tc1.';

export interface FieldContext {
  table: string;
  column: string;
  userId: number;
}

function textAad(ctx: FieldContext): Uint8Array<ArrayBuffer> {
  return bytesOf(`tc1|${ctx.table}|${ctx.column}|u${ctx.userId}`);
}

export async function sealText(
  key: CryptoKey,
  plaintext: string,
  ctx: FieldContext
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textAad(ctx) },
    key,
    utf8.encode(plaintext)
  );
  return `${TEXT_PREFIX}${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function openText(key: CryptoKey, sealed: string, ctx: FieldContext): Promise<string> {
  const where = `${ctx.table}.${ctx.column}`;
  if (!sealed.startsWith(TEXT_PREFIX)) throw new SealedValueError(`${where}: not a sealed value`);
  const body = sealed.slice(TEXT_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot <= 0 || dot === body.length - 1) {
    throw new SealedValueError(`${where}: malformed sealed value`);
  }
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    iv = new Uint8Array(b64urlDecode(body.slice(0, dot)));
    ct = new Uint8Array(b64urlDecode(body.slice(dot + 1)));
  } catch {
    throw new SealedValueError(`${where}: malformed sealed value`);
  }
  if (iv.length !== 12) throw new SealedValueError(`${where}: malformed sealed value`);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: textAad(ctx) },
      key,
      ct
    );
    return utf8Strict.decode(pt);
  } catch {
    throw new SealedValueError(`${where}: failed authentication`);
  }
}

/**
 * Seal a column value. NULL and the empty string are stored as they are: sealing them would hide
 * nothing worth hiding (only that the field is empty), and it keeps a column DEFAULT '' — which an
 * INSERT that omits the column gets from the database, unsealed — indistinguishable from a sealed
 * row's empty value.
 */
export async function sealField(
  key: CryptoKey,
  value: unknown,
  ctx: FieldContext
): Promise<unknown> {
  if (value === null || value === undefined || value === '') return value;
  return sealText(key, typeof value === 'string' ? value : String(value), ctx);
}

/** Inverse of sealField, for a value read from a row whose text_enc says it is sealed. */
export async function openField(
  key: CryptoKey,
  value: unknown,
  ctx: FieldContext
): Promise<unknown> {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value !== 'string') {
    throw new SealedValueError(`${ctx.table}.${ctx.column}: sealed row holds a non-text value`);
  }
  return openText(key, value, ctx);
}

// ── Bytes (receipt objects) ──────────────────────────────────────────────────

export const OBJECT_MAGIC = Uint8Array.of(0x54, 0x43, 0x45, 0x31); // "TCE1"
export const CHUNK_SIZE = 1024 * 1024;
// A header is only authenticated once the first chunk is opened, so bound the chunk size it may
// claim before trusting it to size a buffer.
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const HEADER_LEN = 16;
const TAG_LEN = 16;
const MAX_CHUNKS = 0xffffffff;

export interface ObjectContext {
  kind: 'receipt';
  userId: number;
}

/** Exact size of the sealed form of `plainLength` bytes — R2 needs it up front for a stream. */
export function sealedObjectLength(plainLength: number, chunkSize = CHUNK_SIZE): number {
  const chunks = Math.max(1, Math.ceil(plainLength / chunkSize));
  return HEADER_LEN + plainLength + chunks * TAG_LEN;
}

/** True when bytes begin with the sealed-object magic. A hint only: text_enc/enc is authoritative. */
export function looksSealedObject(firstBytes: Uint8Array): boolean {
  return firstBytes.length >= 4 && OBJECT_MAGIC.every((b, i) => firstBytes[i] === b);
}

function makeHeader(chunkSize: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
    throw new RangeError(`chunk size out of range: ${chunkSize}`);
  }
  const header = new Uint8Array(HEADER_LEN);
  header.set(OBJECT_MAGIC, 0);
  new DataView(header.buffer).setUint32(4, chunkSize);
  crypto.getRandomValues(header.subarray(8, 16));
  return header;
}

function readHeader(header: Uint8Array): number {
  if (header.length !== HEADER_LEN || !looksSealedObject(header)) {
    throw new SealedValueError('receipt object: not a sealed object');
  }
  const chunkSize = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(4);
  if (chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
    throw new SealedValueError('receipt object: implausible chunk size');
  }
  return chunkSize;
}

function chunkIv(header: Uint8Array, index: number): Uint8Array<ArrayBuffer> {
  if (index > MAX_CHUNKS) throw new RangeError('object too large to seal');
  const iv = new Uint8Array(12);
  iv.set(header.subarray(8, 16), 0);
  new DataView(iv.buffer).setUint32(8, index);
  return iv;
}

function chunkAad(
  ctx: ObjectContext,
  headerB64: string,
  index: number,
  final: boolean
): Uint8Array<ArrayBuffer> {
  return bytesOf(`tce1|${ctx.kind}|u${ctx.userId}|${headerB64}|${index}|${final ? 1 : 0}`);
}

async function sealChunk(
  key: CryptoKey,
  ctx: ObjectContext,
  header: Uint8Array,
  headerB64: string,
  index: number,
  final: boolean,
  plain: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: chunkIv(header, index),
      additionalData: chunkAad(ctx, headerB64, index, final),
    },
    key,
    plain
  );
  return new Uint8Array(ct);
}

async function openChunk(
  key: CryptoKey,
  ctx: ObjectContext,
  header: Uint8Array,
  headerB64: string,
  index: number,
  final: boolean,
  sealed: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: chunkIv(header, index),
        additionalData: chunkAad(ctx, headerB64, index, final),
      },
      key,
      sealed
    );
    return new Uint8Array(pt);
  } catch {
    throw new SealedValueError(`receipt object: chunk ${index} failed authentication`);
  }
}

/** Seal a whole buffer. Same format as sealObjectStream, so either side can open the other's. */
export async function sealBytes(
  key: CryptoKey,
  plain: Uint8Array,
  ctx: ObjectContext,
  chunkSize = CHUNK_SIZE
): Promise<Uint8Array<ArrayBuffer>> {
  const header = makeHeader(chunkSize);
  const headerB64 = b64urlEncode(header);
  const out = new Uint8Array(sealedObjectLength(plain.length, chunkSize));
  out.set(header, 0);
  const n = Math.max(1, Math.ceil(plain.length / chunkSize));
  let offset = HEADER_LEN;
  for (let i = 0; i < n; i++) {
    const piece = new Uint8Array(
      plain.subarray(i * chunkSize, Math.min(plain.length, (i + 1) * chunkSize))
    );
    const ct = await sealChunk(key, ctx, header, headerB64, i, i === n - 1, piece);
    out.set(ct, offset);
    offset += ct.length;
  }
  return out;
}

/** Open a whole sealed buffer. Throws SealedValueError on any tampering or truncation. */
export async function openBytes(
  key: CryptoKey,
  sealed: Uint8Array,
  ctx: ObjectContext
): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < HEADER_LEN + TAG_LEN) {
    throw new SealedValueError('receipt object: truncated');
  }
  const header = new Uint8Array(sealed.subarray(0, HEADER_LEN));
  const chunkSize = readHeader(header);
  const headerB64 = b64urlEncode(header);
  const body = sealed.subarray(HEADER_LEN);
  const full = chunkSize + TAG_LEN;
  const n = Math.max(1, Math.ceil(body.length / full));
  // Every chunk but the last is exactly `full` bytes; the last carries at least its tag.
  if (body.length - (n - 1) * full < TAG_LEN) {
    throw new SealedValueError('receipt object: truncated');
  }
  const out = new Uint8Array(body.length - n * TAG_LEN);
  let offset = 0;
  for (let i = 0; i < n; i++) {
    const piece = new Uint8Array(body.subarray(i * full, Math.min(body.length, (i + 1) * full)));
    const pt = await openChunk(key, ctx, header, headerB64, i, i === n - 1, piece);
    out.set(pt, offset);
    offset += pt.length;
  }
  return out;
}

/** FIFO of byte pieces that hands back exact-length copies. */
class ByteQueue {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    // Copied: a stream source is entitled to reuse the buffer behind a chunk it has handed over.
    this.parts.push(bytes.slice());
    this.length += bytes.length;
  }

  take(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const head = this.parts[0];
      const need = n - offset;
      if (head.length <= need) {
        out.set(head, offset);
        offset += head.length;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, need), offset);
        this.parts[0] = head.subarray(need);
        offset += need;
      }
    }
    this.length -= n;
    return out;
  }
}

/**
 * Streaming seal. A chunk is only known to be the last one when the input ends, so one full chunk
 * is always held back until either more input arrives (it was not last) or the stream closes (it
 * was) — which is also why an input of exactly k * chunkSize bytes seals to k chunks, not k + 1.
 */
export function sealObjectStream(
  key: CryptoKey,
  ctx: ObjectContext,
  chunkSize = CHUNK_SIZE
): TransformStream<Uint8Array, Uint8Array> {
  const header = makeHeader(chunkSize);
  const headerB64 = b64urlEncode(header);
  const queue = new ByteQueue();
  let index = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(header.slice());
    },
    async transform(chunk, controller) {
      queue.push(chunk);
      while (queue.length > chunkSize) {
        controller.enqueue(
          await sealChunk(key, ctx, header, headerB64, index++, false, queue.take(chunkSize))
        );
      }
    },
    async flush(controller) {
      controller.enqueue(
        await sealChunk(key, ctx, header, headerB64, index++, true, queue.take(queue.length))
      );
    },
  });
}

/** Streaming open, the inverse of sealObjectStream (and of sealBytes). */
export function openObjectStream(
  key: CryptoKey,
  ctx: ObjectContext
): TransformStream<Uint8Array, Uint8Array> {
  const queue = new ByteQueue();
  let header: Uint8Array<ArrayBuffer> | null = null;
  let headerB64 = '';
  let full = 0;
  let index = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      queue.push(chunk);
      if (!header) {
        if (queue.length < HEADER_LEN) return;
        header = queue.take(HEADER_LEN);
        full = readHeader(header) + TAG_LEN;
        headerB64 = b64urlEncode(header);
      }
      while (queue.length > full) {
        controller.enqueue(
          await openChunk(key, ctx, header, headerB64, index++, false, queue.take(full))
        );
      }
    },
    async flush(controller) {
      if (!header || queue.length < TAG_LEN) {
        throw new SealedValueError('receipt object: truncated');
      }
      controller.enqueue(
        await openChunk(key, ctx, header, headerB64, index++, true, queue.take(queue.length))
      );
    },
  });
}
