/**
 * The marketing loop: a 1200x630 card rendered client-side from the medallion SVG. Web Share
 * with a file where the platform has it, a PNG download otherwise. Nothing is uploaded.
 *
 * Two rules this file has to keep, because the card is rasterised by handing the SVG to an
 * `<img>` and drawing that on a canvas:
 *
 * 1. **It must be well-formed XML.** An SVG loaded as an image is parsed strictly, so anything
 *    HTML forgives — a valueless attribute, an unclosed tag — fails the whole document and the
 *    image never loads.
 * 2. **No `<foreignObject>`.** Chrome taints the canvas when the drawn SVG carries one, and
 *    `toBlob` then throws a SecurityError. Text is wrapped into tspans here instead.
 *
 * Both of those shipped at once and every Share ended in "Could not build the share card".
 */
import { medallionSvg } from '../../components/BadgeMedallion'
import { achievementById, BANDS } from './definitions'
import type { AchievementId } from './definitions'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Greedy word wrap to a character budget. Crude on purpose: the strings are ours, they are one
 * sentence each, and the alternative — measuring text — needs a DOM this function does not have.
 */
export function wrapShare(text: string, perLine = 34): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line === '') line = word
    else if (`${line} ${word}`.length <= perLine) line = `${line} ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

export function shareCardSvg(id: AchievementId): string {
  const def = achievementById(id)
  const medal = medallionSvg(id, def.band, 400, 'share')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  const glyphColor =
    def.band === 'legacy' ? '#f5c777' : def.band === 'mastery' ? '#f0a860' : '#e8edff'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Georgia, 'Times New Roman', serif">
<defs>
<radialGradient id="bg-glow" cx="0.78" cy="0.5" r="0.6"><stop offset="0" stop-color="#3b6fe0" stop-opacity=".45"/><stop offset=".6" stop-color="#f0a860" stop-opacity=".12"/><stop offset="1" stop-color="#0a0e1c" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1200" height="630" fill="#0a0e1c"/>
<rect width="1200" height="630" fill="url(#bg-glow)"/>
<g fill="none" stroke="#6e9bff" opacity=".35"><circle cx="900" cy="315" r="300" stroke-dasharray="2 8"/><circle cx="900" cy="315" r="360" stroke-width=".8"/></g>
<text x="84" y="150" font-family="ui-monospace, Menlo, monospace" font-size="18" letter-spacing="4" fill="#93b4ff">TOKEN CIRCLES · ${esc(BANDS[def.band].label.toUpperCase())}</text>
<text x="84" y="270" font-size="96" font-weight="600" fill="#e8edff" letter-spacing="-2">${esc(def.name)}</text>
<text x="84" y="340" font-family="system-ui, sans-serif" font-size="30" fill="#c3ccf0">${wrapShare(
    def.share
  )
    .map((line, i) => `<tspan x="84" dy="${i === 0 ? 0 : 40}">${esc(line)}</tspan>`)
    .join('')}</text>
<text x="84" y="530" font-family="ui-monospace, Menlo, monospace" font-size="20" letter-spacing="1" fill="#93b4ff">tokencircles.com</text>
<svg x="700" y="115" width="400" height="400" viewBox="0 0 220 220" color="${glyphColor}">${medal}</svg>
</svg>`
}

async function toPng(svg: string): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        resolve()
      }
      img.onerror = () => {
        reject(new Error('share card did not render'))
      }
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas context')
    ctx.drawImage(img, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('toBlob failed'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function shareBadge(id: AchievementId): Promise<'shared' | 'downloaded'> {
  const def = achievementById(id)
  const png = await toPng(shareCardSvg(id))
  const file = new File([png], `token-circles-${id}.png`, { type: 'image/png' })
  const nav = window.navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: def.name, text: def.share })
    return 'shared'
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(png)
  a.download = file.name
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(a.href)
  }, 10_000)
  return 'downloaded'
}
