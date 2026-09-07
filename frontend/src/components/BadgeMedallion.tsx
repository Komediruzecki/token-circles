/**
 * The badge recipe: a glass face, the band's rings (one, two, three), one glyph. Three SVG
 * layers on one CSS perspective so an interactive medallion tilts with parallax and orbs take
 * the dashed orbit. Gradient ids are per instance so several medallions can share a page.
 * Recipe and glyphs match the gallery page in disjoint-colliders
 * (packages/showcase-gallery/gallery-viewer/token-circles-badges.html).
 */
import { createUniqueId  } from 'solid-js'
import { BADGE_GLYPHS } from './badgeGlyphs'
import styles from './BadgeMedallion.module.css'
import type {JSX} from 'solid-js';
import type { AchievementId, Band } from '../core/achievements/definitions'

const RINGS: Record<Band, Array<{ r: number; w: number }>> = {
  beginnings: [{ r: 84, w: 2.2 }],
  building: [
    { r: 84, w: 2.2 },
    { r: 72, w: 1.6 },
  ],
  mastery: [
    { r: 84, w: 2.4 },
    { r: 73, w: 1.8 },
    { r: 63, w: 1.3 },
  ],
}
const ORB: Record<Band, string> = { beginnings: '#93b4ff', building: '#93b4ff', mastery: '#f0a860' }

const orbAt = (r: number, deg: number, size: number, color: string): string => {
  const t = (deg * Math.PI) / 180
  return `<circle cx="${(110 + r * Math.cos(t)).toFixed(2)}" cy="${(110 + r * Math.sin(t)).toFixed(2)}" r="${size}" fill="${color}"/>`
}

const defs = (uid: string): string => `<defs>
<linearGradient id="${uid}-azure" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93b4ff"/><stop offset="1" stop-color="#3b6fe0"/></linearGradient>
<linearGradient id="${uid}-mastery" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93b4ff"/><stop offset=".5" stop-color="#6e9bff"/><stop offset="1" stop-color="#f0a860"/></linearGradient>
<radialGradient id="${uid}-face" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset=".55" stop-color="#6e9bff" stop-opacity=".06"/><stop offset="1" stop-color="#6e9bff" stop-opacity=".02"/></radialGradient>
</defs>`

function baseMarkup(uid: string, band: Band): string {
  const paint = `url(#${uid}-${band === 'mastery' ? 'mastery' : 'azure'})`
  const rings = RINGS[band]
    .map(
      (r) =>
        `<circle data-ring cx="110" cy="110" r="${r.r}" fill="none" stroke="${paint}" stroke-width="${r.w}"/>`
    )
    .join('')
  return `${defs(uid)}<circle cx="110" cy="110" r="80" fill="url(#${uid}-face)" stroke="rgba(147,180,255,.22)"/><circle cx="110" cy="110" r="93" fill="none" stroke="${paint}" stroke-width="1.2" stroke-dasharray="1.6 4.4" opacity=".55"/>${rings}`
}

const glyphMarkup = (id: AchievementId): string =>
  `<g transform="translate(110 110) scale(1.55) translate(-24 -24)" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${BADGE_GLYPHS[id]}</g>`

const orbsMarkup = (band: Band): string =>
  `<g class="${styles.orbit}">${[0, 120, 240].map((a) => orbAt(93, a, 3.2, ORB[band])).join('')}</g><g class="${styles.orbit} ${styles.ccw}">${[60, 240].map((a) => orbAt(104, a, 2, ORB[band])).join('')}</g>`

/** One static SVG (base + glyph) as a string, for the share card. */
export function medallionSvg(id: AchievementId, band: Band, size: number, uid = 'm'): string {
  const color = band === 'mastery' ? '#f0a860' : '#e8edff'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="${size}" height="${size}" color="${color}">${baseMarkup(uid, band)}${glyphMarkup(id)}</svg>`
}

export interface BadgeMedallionProps {
  id: AchievementId
  band: Band
  /** Pixels. The chip uses 22, a toast 40, the panel 104, the share card 400. */
  size?: number
  /** Unlit renders desaturated and dim. */
  lit?: boolean
  /** Tilt to the pointer and run the orbs on hover/focus. */
  interactive?: boolean
  class?: string
  label?: string
}

const MAX_TILT = 16

export default function BadgeMedallion(props: BadgeMedallionProps): JSX.Element {
  const uid = createUniqueId()
  let el!: HTMLDivElement
  const onMove = (e: PointerEvent): void => {
    if (!props.interactive || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    el.style.setProperty('--ry', `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--rx', `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
  }
  const onLeave = (): void => {
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--mx', '50%')
    el.style.setProperty('--my', '50%')
  }
  return (
    <div
      ref={el}
      class={`${styles.medal} ${props.class ?? ''}`}
      style={{ '--size': `${props.size ?? 48}px` }}
      data-band={props.band}
      data-lit={props.lit === false ? 'false' : 'true'}
      data-interactive={props.interactive ? 'true' : 'false'}
      role="img"
      aria-label={props.label ?? `${props.id} badge`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      <svg
        class={styles.base}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={baseMarkup(uid, props.band)}
      />
      <svg
        class={styles.glyph}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={glyphMarkup(props.id)}
      />
      <svg
        class={styles.orbs}
        viewBox="0 0 220 220"
        aria-hidden="true"
        innerHTML={orbsMarkup(props.band)}
      />
      <div class={styles.shine} />
    </div>
  )
}
