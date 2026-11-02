/**
 * A print shared as an image (core/prints/share.ts): the seal on paper at print detail, 1200 by
 * 1200, named for its months, through the share sheet where the platform takes files and a
 * download otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_SLOTS } from '../../../../shared/fixtures/sealSample'
import * as shareCard from '../achievements/shareCard'
import { PRINT_PX, printFileName, printImageSvg, sharePrint } from '../prints/share'

vi.mock('../achievements/shareCard', async (load) => {
  const actual = await load<typeof shareCard>()
  return { ...actual, toPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }
})

describe('the image', () => {
  it('is the print on paper, sized 1200 by 1200 for the canvas, and well-formed', () => {
    const svg = printImageSvg(SAMPLE_SLOTS)
    expect(
      svg.startsWith('<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"')
    ).toBe(true)
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    // Text, CSS variables and foreignObject cannot survive an <img> and a canvas.
    expect(svg).not.toMatch(/<text|<foreignObject|var\(/)
  })

  it('is named for the months it holds', () => {
    expect(printFileName('2025-10')).toBe('token-circles-print-2025-10-to-2026-09.png')
    expect(printFileName('2000-01')).toBe('token-circles-print-2000-01-to-2000-12.png')
  })
})

describe('sharePrint', () => {
  /** The navigator's share members, which jsdom lacks: set per test, removed after. */
  const nav = window.navigator as unknown as { share?: unknown; canShare?: unknown }
  beforeEach(() => {
    vi.mocked(shareCard.toPng).mockClear()
  })
  afterEach(() => {
    delete nav.share
    delete nav.canShare
    vi.unstubAllGlobals()
  })

  it('hands the share sheet the PNG, with the words for a first print', async () => {
    const share = vi.fn(async (_data: ShareData) => {})
    nav.share = share
    nav.canShare = () => true
    const how = await sharePrint({ from: '2025-10', slots: SAMPLE_SLOTS }, true)
    expect(how).toBe('shared')
    expect(shareCard.toPng).toHaveBeenCalledWith(printImageSvg(SAMPLE_SLOTS), PRINT_PX, PRINT_PX)
    const data = share.mock.calls[0][0] as { files: File[]; title: string; text: string }
    expect(data.files[0].name).toBe('token-circles-print-2025-10-to-2026-09.png')
    expect(data.files[0].type).toBe('image/png')
    expect(data.title).toBe('My first print')
    expect(data.text).toBe('Twelve months of my money, drawn as a seal by Token Circles.')
  })

  it('downloads it where there is no share sheet for files', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:print', revokeObjectURL: () => {} })
    const clicked: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.download)
    })
    const how = await sharePrint({ from: '2024-03', slots: SAMPLE_SLOTS }, false)
    expect(how).toBe('downloaded')
    expect(clicked).toEqual(['token-circles-print-2024-03-to-2025-02.png'])
    click.mockRestore()
  })
})
