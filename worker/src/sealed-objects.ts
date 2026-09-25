/**
 * Receipt objects in R2, sealed under the owner's key when they have one (field-crypto.ts, TCE1).
 * receipts.enc records which form each object is in — nothing infers it from the bytes.
 *
 * Sealed objects are stored as application/octet-stream: the bytes are no longer an image, and
 * the type to serve comes from receipts.file_type, which every read path already uses.
 */
import type { DataKeyring } from './data-keys';
import {
  openBytes,
  openObjectStream,
  sealBytes,
  sealedObjectLength,
  sealObjectStream,
  SealedValueError,
} from './field-crypto';

const contextFor = (userId: number) => ({ kind: 'receipt' as const, userId });

/**
 * What a sealed object is stored with. `plainSize` is the opened length, so a download can declare
 * its Content-Length up front: the decrypting stream itself has no known length, and a sealed
 * receipt would otherwise always be sent chunked, with no progress for the client to show.
 */
function sealedMetadata(plainSize: number): R2PutOptions {
  return {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { sealed: 'tce1', plainSize: String(plainSize) },
  };
}

/** The plaintext length recorded when the object was sealed, or null if it carries none. */
function plainSizeOf(obj: R2Object): number | null {
  const raw = obj.customMetadata?.plainSize;
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Store a receipt. Sealed when the owner has a key, and a File is streamed through the cipher
 * into R2, so a 50 MB receipt never sits in memory beside its own ciphertext (a Worker has
 * 128 MB). With no key it is stored exactly as before this module existed.
 * Returns the enc value the receipts row must record for this object.
 */
export async function putReceipt(
  ring: DataKeyring,
  ownerId: number | null,
  bucket: R2Bucket,
  key: string,
  body: File | Uint8Array,
  contentType: string
): Promise<0 | 1> {
  const dek = ownerId === null ? null : await ring.forWrite(ownerId);
  if (!dek || ownerId === null) {
    await bucket.put(key, body instanceof File ? await body.arrayBuffer() : body, {
      httpMetadata: { contentType },
    });
    return 0;
  }
  if (body instanceof File) {
    const { readable, writable } = new FixedLengthStream(sealedObjectLength(body.size));
    const pumped = body
      .stream()
      .pipeThrough(sealObjectStream(dek, contextFor(ownerId)))
      .pipeTo(writable);
    await Promise.all([bucket.put(key, readable, sealedMetadata(body.size)), pumped]);
  } else {
    await bucket.put(
      key,
      await sealBytes(dek, body, contextFor(ownerId)),
      sealedMetadata(body.length)
    );
  }
  return 1;
}

/** The body to serve: the object as stored for enc 0, through the decrypting stream for enc 1. */
export async function receiptStream(
  ring: DataKeyring,
  ownerId: number | null,
  obj: R2ObjectBody,
  enc: unknown
): Promise<ReadableStream> {
  if (enc !== 1) return obj.body;
  if (ownerId === null) throw new SealedValueError('receipt object: sealed, but nobody owns it');
  const dek = await ring.forRead(ownerId);
  const opened = (obj.body as ReadableStream<Uint8Array>).pipeThrough(
    openObjectStream(dek, contextFor(ownerId))
  );
  // A FixedLengthStream is what gives a streamed Response its Content-Length. If the opened bytes
  // ever came out a different length, it errors the stream rather than send a wrong one.
  const size = plainSizeOf(obj);
  return size === null ? opened : opened.pipeThrough(new FixedLengthStream(size));
}

/** The whole object, opened — for the backup export, which base64s it anyway. */
export async function receiptBytes(
  ring: DataKeyring,
  ownerId: number | null,
  obj: R2ObjectBody,
  enc: unknown
): Promise<Uint8Array> {
  const stored = new Uint8Array(await obj.arrayBuffer());
  if (enc !== 1) return stored;
  if (ownerId === null) throw new SealedValueError('receipt object: sealed, but nobody owns it');
  return openBytes(await ring.forRead(ownerId), stored, contextFor(ownerId));
}

/**
 * Re-store an existing plaintext object sealed, under a NEW key — for the backfill. Streamed, and
 * to a fresh key so a failure midway leaves the original intact; the caller swaps the row's
 * storage_path by compare-and-set and only then deletes the original.
 */
export async function resealReceipt(
  ring: DataKeyring,
  ownerId: number,
  bucket: R2Bucket,
  fromKey: string,
  toKey: string
): Promise<boolean> {
  const obj = await bucket.get(fromKey);
  if (!obj) return false;
  const dek = await ring.forWrite(ownerId);
  if (!dek) return false;
  const { readable, writable } = new FixedLengthStream(sealedObjectLength(obj.size));
  const pumped = (obj.body as ReadableStream<Uint8Array>)
    .pipeThrough(sealObjectStream(dek, contextFor(ownerId)))
    .pipeTo(writable);
  await Promise.all([bucket.put(toKey, readable, sealedMetadata(obj.size)), pumped]);
  return true;
}
