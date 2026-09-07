/**
 * The marketing loop: a 1200x630 card rendered client-side from the medallion SVG. Web Share
 * with a file where the platform has it, a PNG download otherwise. Nothing is uploaded.
 */
import { medallionSvg } from '../../components/BadgeMedallion'
import { achievementById, BANDS } from './definitions'
import type {AchievementId} from './definitions';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function shareCardSvg(id: AchievementId): string {
  const def = achievementById(id)
  const medal = medallionSvg(id, def.band, 400, 'share')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
  const glyphColor = def.band === 'mastery' ? '#f0a860' : '#e8edff'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Georgia, 'Times New Roman', serif">
<defs>
<radialGradient id="bg-glow" cx="0.78" cy="0.5" r="0.6"><stop offset="0" stop-color="#3b6fe0" stop-opacity=".45"/><stop offset=".6" stop-color="#f0a860" stop-opacity=".12"/><stop offset="1" stop-color="#0a0e1c" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1200" height="630" fill="#0a0e1c"/>
<rect width="1200" height="630" fill="url(#bg-glow)"/>
<g fill="none" stroke="#6e9bff" opacity=".35"><circle cx="900" cy="315" r="300" stroke-dasharray="2 8"/><circle cx="900" cy="315" r="360" stroke-width=".8"/></g>
<text x="84" y="150" font-family="ui-monospace, Menlo, monospace" font-size="18" letter-spacing="4" fill="#93b4ff">TOKEN CIRCLES · ${esc(BANDS[def.band].label.toUpperCase())}</text>
<text x="84" y="270" font-size="96" font-weight="600" fill="#e8edff" letter-spacing="-2">${esc(def.name)}</text>
<foreignObject x="84" y="300" width="520" height="160"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: system-ui, sans-serif; font-size: 30px; line-height: 1.3; color: #c3ccf0;">${esc(def.share)}</div></foreignObject>
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
      canvas.toBlob((b) => { b ? resolve(b) : reject(new Error('toBlob failed')); }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function shareBadge(id: AchievementId): Promise<'shared' | 'downloaded'> {
  const def = achievementById(id)
  const png = await toPng(shareCardSvg(id))
  const file = new File([png], `token-circles-${id}.png`, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
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
