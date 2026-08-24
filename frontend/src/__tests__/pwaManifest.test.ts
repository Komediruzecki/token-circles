/**
 * The manifest against the files it names.
 *
 * Everything here fails silently in a browser. A `src` that does not resolve is a 404 the
 * install dialog swallows; a `sizes` that disagrees with the file is a screenshot Chrome drops
 * without a word; an icon set with no maskable member is not an error at all, just a small dark
 * tile floating in a white circle on someone's home screen. None of it shows up in a build log,
 * and none of it shows up in a test that only reads the manifest — so this reads the PNG headers
 * back off disk and compares them to what we claim.
 *
 * The numeric bounds are Chrome's own rules for install-dialog screenshots
 * (https://developer.chrome.com/docs/devtools/progressive-web-apps): every side between 320 and
 * 3840, the long side at most 2.3x the short one, and one consistent aspect ratio per form factor.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- see actualSize() below */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pwaManifest } from '../pwaManifest'

const PUBLIC = resolve(__dirname, '../../public')

const icons = pwaManifest.icons ?? []
const screenshots = (pwaManifest.screenshots ?? []) as {
  src: string
  sizes: string
  type: string
  form_factor?: string
  label?: string
}[]

/** Width and height straight out of the PNG IHDR chunk — no image library involved. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(buf.subarray(0, 8).equals(signature), `${file} is not a PNG`).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** The declared `width`/`height` of an SVG root element. */
function svgSize(file: string): { width: number; height: number } {
  const head = readFileSync(file, 'utf8').slice(0, 400)
  const width = /\bwidth="(\d+)"/.exec(head)
  const height = /\bheight="(\d+)"/.exec(head)
  expect(width && height, `${file} declares no width/height on its root element`).toBeTruthy()
  return { width: Number(width![1]), height: Number(height![1]) }
}

function declared(sizes: string): { width: number; height: number } {
  const [w, h] = sizes.split('x').map(Number)
  return { width: w, height: h }
}

function actualSize(src: string) {
  // Paths are built from a fixed directory and the manifest's own entries — the point of the
  // test is that those entries name real files, so the read has to be non-literal.
  const file = resolve(PUBLIC, src)
  return src.endsWith('.svg') ? svgSize(file) : pngSize(file)
}

describe('manifest icons', () => {
  it.each(icons.map((i) => [i.src, i] as const))('%s is the size it claims', (_src, icon) => {
    // `any` is the spec's value for a scalable icon: there is no pixel size to check, so the
    // assertion is only that the file is there and parses as the type we declared.
    if (icon.sizes === 'any') {
      expect(actualSize(icon.src).width).toBeGreaterThan(0)
      return
    }
    expect(actualSize(icon.src)).toEqual(declared(icon.sizes!))
  })

  it('ships a maskable icon, at both sizes', () => {
    const maskable = icons.filter((i) => i.purpose === 'maskable')
    // Without one Android does not mask ours: Chrome shrinks the whole square into a white
    // circle, and the installed app is a small dark tile with a white ring around it.
    expect(maskable.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512'])
  })

  it('states a purpose on every entry', () => {
    // An entry with no `purpose` defaults to `any`, which is fine — but leaving it implicit on
    // some entries and explicit on others is how a maskable icon ends up serving both roles.
    expect(icons.filter((i) => !i.purpose)).toEqual([])
  })

  it('keeps the maskable artwork inside the safe circle', () => {
    // The safe zone is the circle of diameter 0.8 x the canvas; anything outside it may be
    // cropped by the launcher's mask. The unscaled artwork reaches 207px from the centre of a
    // 512 canvas, just past the 204.8px safe radius, so the maskable master scales it down.
    // Asserting on the transform is what stops that being dropped in a later edit of the SVG.
    const svg = readFileSync(resolve(PUBLIC, 'icon-maskable-512.svg'), 'utf8')
    const scale = /scale\(([\d.]+)\)/.exec(svg)
    expect(scale, 'the maskable master no longer scales its artwork').toBeTruthy()
    const worstCaseRadius = 207.3 * Number(scale![1])
    expect(worstCaseRadius).toBeLessThan(0.4 * 512)
    // A rounded background would be masked a second time, into a rounded square inside a circle.
    expect(svg).not.toMatch(/<rect[^>]*\brx=/)
  })
})

describe('manifest screenshots', () => {
  it.each(screenshots.map((s) => [s.src, s] as const))('%s is the size it claims', (_src, shot) => {
    expect(actualSize(shot.src)).toEqual(declared(shot.sizes))
  })

  it('covers both form factors', () => {
    // Chrome shows the rich install dialog only with a wide entry, and falls back to the plain
    // one on phones without a narrow entry — so having only half of them is worse than obvious.
    const factors = new Set(screenshots.map((s) => s.form_factor))
    expect(factors.has('wide')).toBe(true)
    expect(factors.has('narrow')).toBe(true)
  })

  it('labels every screenshot', () => {
    // The label is the alt text in the install dialog.
    expect(screenshots.filter((s) => !s.label)).toEqual([])
  })

  it.each(['wide', 'narrow'])('%s screenshots share one aspect ratio', (factor) => {
    const ratios = screenshots
      .filter((s) => s.form_factor === factor)
      .map((s) => {
        const { width, height } = declared(s.sizes)
        return (width / height).toFixed(4)
      })
    expect(ratios.length).toBeGreaterThan(0)
    expect(new Set(ratios).size).toBe(1)
  })

  it.each(screenshots.map((s) => [s.src, s] as const))(
    '%s is within the dimensions Chrome accepts',
    (_src, shot) => {
      const { width, height } = declared(shot.sizes)
      for (const side of [width, height]) {
        expect(side).toBeGreaterThanOrEqual(320)
        expect(side).toBeLessThanOrEqual(3840)
      }
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2.3)
    }
  )
})
