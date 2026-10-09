/**
 * Local-first reads a file uploaded on the Import page off the page's thread, with a time limit.
 *
 * The page reads the file itself in local-first: there is no server to send it to. A large
 * workbook can take a while to read, so it is read on a thread of its own (workers/uploadReader.ts)
 * while the page stays usable, and given up on after UPLOAD_READ_LIMIT_MS: the thread is stopped,
 * and the file is refused at `file`, as a file that cannot be read is.
 */
import { IMPORT_UPLOAD_MESSAGES, readUploadedSheet } from '../../../../../shared/importUpload'
import type { UploadedFile, UploadedSheet } from '../../../../../shared/importUpload'
import type { Checked } from '../../../../../shared/refusal'

/** How long a file is given to be read. */
export const UPLOAD_READ_LIMIT_MS = 30_000

/** What the page sends the reading thread. */
export interface UploadRequest {
  file: UploadedFile
  requested?: string
}

/** A read under way: its answer, and a way to stop it. */
export interface Reading {
  answer: Promise<Checked<UploadedSheet>>
  stop: () => void
}

/** Starts reading `file`, and the sheet `requested` names. */
export type Reader = (file: UploadedFile, requested?: string) => Reading

const unreadable = (): Checked<UploadedSheet> => ({
  ok: false,
  fields: { file: IMPORT_UPLOAD_MESSAGES.unreadable },
})

/**
 * What `read` answers for `file`, or, past `limitMs`, a refusal at `file`. The reader is stopped
 * either way once there is an answer.
 */
export async function readUploadWithin(
  read: Reader,
  file: UploadedFile,
  requested?: string,
  limitMs = UPLOAD_READ_LIMIT_MS
): Promise<Checked<UploadedSheet>> {
  const reading = read(file, requested)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Checked<UploadedSheet>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, fields: { file: IMPORT_UPLOAD_MESSAGES.tooSlow } })
    }, limitMs)
  })
  try {
    return await Promise.race([reading.answer, late])
  } finally {
    clearTimeout(timer)
    reading.stop()
  }
}

/** Reads on this thread: where there are no Web Workers (a test's DOM), and nothing to stop. */
const readHere: Reader = (file, requested) => ({
  answer: import('xlsx').then((XLSX) => readUploadedSheet(XLSX, file, requested)),
  stop: () => {},
})

/** Reads on a thread of its own, one per file, stopped once it has answered or run out of time. */
const readOnItsOwnThread: Reader = (file, requested) => {
  const worker = new Worker(new URL('../../../workers/uploadReader.ts', import.meta.url), {
    type: 'module',
  })
  const answer = new Promise<Checked<UploadedSheet>>((resolve) => {
    worker.onmessage = (event: MessageEvent<Checked<UploadedSheet>>) => {
      resolve(event.data)
    }
    worker.onerror = () => {
      resolve(unreadable())
    }
    worker.onmessageerror = () => {
      resolve(unreadable())
    }
  })
  worker.postMessage({ file, requested } satisfies UploadRequest, [file.bytes.buffer])
  return {
    answer,
    stop: () => {
      worker.terminate()
    },
  }
}

/** The reader the upload handler uses. */
export function uploadReader(): Reader {
  return typeof Worker === 'undefined' ? readHere : readOnItsOwnThread
}
