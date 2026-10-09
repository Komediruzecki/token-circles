/**
 * Local-first reads an uploaded file off the page's thread, with a time limit
 * (handlers/uploadRead.ts). A read that has not answered by then is stopped, and the file is
 * refused at `file`; one that answers in time is the answer, and its reader is stopped after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_UPLOAD_MESSAGES as M } from '../../../../../shared/importUpload'
import { readUploadWithin, UPLOAD_READ_LIMIT_MS } from '../handlers/uploadRead'
import type { Reader } from '../handlers/uploadRead'

const FILE = { name: 'statement.xlsx', type: '', size: 3, bytes: new Uint8Array([1, 2, 3]) }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a file read off the page, with a time limit', () => {
  it('is refused at the file when the reader never answers, and the reader is stopped', async () => {
    const stop = vi.fn()
    const never: Reader = () => ({ answer: new Promise(() => {}), stop })
    const read = readUploadWithin(never, FILE)
    let settled = false
    void read.then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(UPLOAD_READ_LIMIT_MS - 1)
    expect(settled).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toEqual({ ok: false, fields: { file: M.tooSlow } })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('is what the reader answers in time, and the reader is stopped after', async () => {
    const stop = vi.fn()
    const answer = {
      ok: true as const,
      value: { headers: ['Date'], rows: [], selectedSheet: 'March', sheetNames: ['March'] },
    }
    const quick: Reader = (file, requested) => {
      expect([file, requested]).toEqual([FILE, 'March'])
      return { answer: Promise.resolve(answer), stop }
    }
    expect(await readUploadWithin(quick, FILE, 'March')).toEqual(answer)
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
