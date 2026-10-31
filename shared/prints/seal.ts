/**
 * The seal: twelve months engraved as one rosette, the finance print (journey plan, section 3.1).
 *
 * Read it like a clock. Twelve slots run clockwise from the top, one petal each; a petal's length
 * is what its month spent. Outside the petals a woven band swells where a month kept money and
 * dips, in copper, where it spent more than came in. A slot with no month is left blank, so a
 * year shows filling in.
 *
 * Pure and deterministic: the same slots and options give the same SVG text in the browser, in
 * both storage modes, and in a Worker. No DOM, no clock, no randomness, no text, no fonts.
 *
 * It never sees an amount. Each month arrives as two whole numbers (`sealShares`, shares.ts):
 * `spent`, 0 to 100, its spending as a share of the heaviest month on the same seal, and `kept`,
 * -100 to 100, what it kept as a share of the most any month on the seal kept or overspent.
 * Anything else throws, so an amount wired in by mistake fails a test instead of drawing a petal
 * off the plate.
 */

/** Bumped when the drawing changes in a way a stored print would show (journey plan M3). */
export const SEAL_VERSION = 1;

/** A seal has twelve slots, one per month, clockwise from the top. */
export const SEAL_SLOTS = 12;

/** One month on a seal, as shares of the seal's own scale. */
export interface SealMonth {
  /** What the month spent: 0 to 100, a share of the heaviest month on the seal. */
  spent: number;
  /** What it kept: -100 to 100, a share of the most any month on the seal kept or overspent. */
  kept: number;
}

/** A slot holds a month, or null for one not tracked yet. */
export type SealSlot = SealMonth | null;

/**
 * Colours. A literal colour suits an image (a saved print, the mail); a `var(--token)` suits the
 * app, where the theme sets it. `ground` null draws no background.
 */
export interface SealPalette {
  ground: string | null;
  /** The disc in the middle, drawn over the petals' roots: the ground's colour. */
  hub: string;
  /** Petals, hour marks and the hub's rim. */
  ink: string;
  /** The woven band. */
  band: string;
  /** The border's rules and the fine ring. */
  rule: string;
  /** The band over a month that spent more than came in. */
  copper: string;
}

/** The print on its paper, as the mail and a saved image show it. */
export const PAPER: SealPalette = {
  ground: '#f5f2ea',
  hub: '#f5f2ea',
  ink: '#1d3170',
  band: '#3b6fe0',
  rule: '#8d9bc4',
  copper: '#c46a2c',
};

/** The plate in the app: the theme's tokens (orbit-dark.css, dawn-light.css). */
export const THEME: SealPalette = {
  ground: null,
  hub: 'var(--seal-hub)',
  ink: 'var(--seal-ink)',
  band: 'var(--seal-band)',
  rule: 'var(--seal-rule)',
  copper: 'var(--seal-copper)',
};

/**
 * How finely it is drawn, for the size it is shown at. Lines stay at least about one CSS pixel
 * wide and a few apart, so a small seal reads as engraving rather than grey moire.
 *
 * - `print`: 900 px and up (a saved image, the mail at 1200 px).
 * - `screen`: about 240 to 480 px (the shelf).
 * - `thumb`: under 160 px (earlier prints in a row).
 */
export type SealDetail = 'print' | 'screen' | 'thumb';

interface Grain {
  /** Points per full turn of the band. */
  turn: number;
  /** Lines in each of the band's two crossing families. */
  lines: number;
  /** Waves per turn. */
  waves: number;
  /** Nested lines per petal, the outline included. */
  petalLines: number;
  /** Points along one petal line. */
  petalPoints: number;
  /** Units per line width: the 1200-unit plate's strokes are multiplied by this. */
  weight: number;
  /** The border's fine waves and the ring between band and petals. */
  ornament: boolean;
  /** Decimals kept in coordinates. */
  places: number;
}

const GRAIN: Record<SealDetail, Grain> = {
  print: {
    turn: 2160,
    lines: 7,
    waves: 36,
    petalLines: 4,
    petalPoints: 160,
    weight: 1,
    ornament: true,
    places: 1,
  },
  screen: {
    turn: 1080,
    lines: 4,
    waves: 36,
    petalLines: 3,
    petalPoints: 64,
    weight: 2.4,
    ornament: true,
    places: 0,
  },
  thumb: {
    turn: 432,
    lines: 2,
    waves: 18,
    petalLines: 1,
    petalPoints: 32,
    weight: 7,
    ornament: false,
    places: 0,
  },
};

export interface SealOptions {
  palette: SealPalette;
  detail?: SealDetail;
  /**
   * Marks each petal and each month of the band with its slot (`data-slot`, `--i`) so CSS can
   * engrave them in turn; the ones before this slot are marked as already drawn. The hour marks
   * get a class and their place too. Leave it out for an image.
   */
  engraveFrom?: number;
}

const TAU = Math.PI * 2;
const C = 600;

function checkShare(value: unknown, low: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > 100) {
    throw new RangeError(`A seal month's ${name} is a whole number from ${low} to 100.`);
  }
  return value;
}

/** The slots, checked: twelve, each null or two whole-number shares in range. */
export function checkSlots(slots: readonly unknown[]): SealSlot[] {
  if (!Array.isArray(slots) || slots.length !== SEAL_SLOTS) {
    throw new RangeError('A seal has twelve slots.');
  }
  return slots.map((slot) => {
    if (slot === null) return null;
    const month = slot as Partial<SealMonth>;
    return {
      spent: checkShare(month.spent, 0, 'spent'),
      kept: checkShare(month.kept, -100, 'kept'),
    };
  });
}

/** The angle at the start of slot `m`; the year starts at twelve o'clock and runs clockwise. */
const slotStart = (m: number): number => -Math.PI / 2 + (m / SEAL_SLOTS) * TAU;

/**
 * Slot `m`'s whole 30-degree sector on the 1200-unit plate, as a path from radius `inner` to
 * `outer`: by default from the hub's rim to the border's outer rule. The app lays these over a
 * seal as the months' tap targets, far wider than a petal's lines.
 */
export function sealSector(m: number, inner = 62, outer = 568): string {
  const pt = (r: number, a: number): string =>
    `${Math.round((C + r * Math.cos(a)) * 10) / 10} ${Math.round((C + r * Math.sin(a)) * 10) / 10}`;
  const a0 = slotStart(m);
  const a1 = slotStart(m + 1);
  return `M${pt(inner, a0)}L${pt(outer, a0)}A${outer} ${outer} 0 0 1 ${pt(outer, a1)}L${pt(inner, a1)}A${inner} ${inner} 0 0 0 ${pt(inner, a0)}Z`;
}

export function drawSeal(input: readonly SealSlot[], options: SealOptions): string {
  const slots = checkSlots(input);
  const g = GRAIN[options.detail ?? 'print'];
  const p = options.palette;
  const engrave = options.engraveFrom;
  const scale = 10 ** g.places;
  const n = (v: number): string => String(Math.round(v * scale) / scale);
  const xy = (r: number, a: number): string =>
    `${n(C + r * Math.cos(a))} ${n(C + r * Math.sin(a))}`;
  const line = (pts: string[], close: boolean): string => `M${pts.join('L')}${close ? 'Z' : ''}`;
  const w = (units: number): string => String(Math.round(units * g.weight * 100) / 100);
  const paint = (prop: string, value: string): string => `${prop}:${value}`;
  /**
   * A group's style and, when the seal is to be engraved, its slot: `--i` counts the slots still
   * to engrave, and the ones before `engraveFrom` are marked as drawn already.
   */
  const group = (style: string, slot: number): string =>
    engrave === undefined
      ? ` style="${style}"`
      : ` style="${style};--i:${Math.max(0, slot - engrave)}" data-slot="${slot}"${slot < engrave ? ' data-drawn="true"' : ''}`;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" data-seal="${SEAL_VERSION}">`;
  if (p.ground !== null)
    out += `<rect width="1200" height="1200" style="${paint('fill', p.ground)}"/>`;

  // The border: two rules, and in finer prints a wave between them; the same on every seal.
  out += `<g fill="none" style="${paint('stroke', p.rule)}" stroke-width="${w(1)}"><circle cx="${C}" cy="${C}" r="568"/><circle cx="${C}" cy="${C}" r="546"/>`;
  if (g.ornament) {
    const waves = g.weight > 1 ? 1 : 2;
    for (let k = 0; k < waves; k++) {
      const pts: string[] = [];
      const freq = g.weight > 1 ? 72 : 144;
      for (let i = 0; i < g.turn; i++) {
        const a = (i / g.turn) * TAU;
        pts.push(xy(557 + 6 * Math.sin((k ? -1 : 1) * freq * a), a));
      }
      out += `<path d="${line(pts, true)}" stroke-width="${w(0.6)}"/>`;
    }
  }
  out += '</g>';

  // Twelve hour marks on the inner rule, where each month starts. Marked in turn when the seal is
  // to be engraved, so an empty plate can engrave its marks.
  const hours = engrave === undefined ? '' : ' class="seal-hours"';
  out += `<g${hours} style="${paint('stroke', p.ink)}" stroke-width="${w(1.4)}">`;
  for (let m = 0; m < SEAL_SLOTS; m++) {
    const a = slotStart(m);
    const turn = engrave === undefined ? '' : ` style="--i:${m}"`;
    out += `<path d="M${xy(530, a)}L${xy(546, a)}"${turn}/>`;
  }
  out += '</g>';

  // The woven band: two families of waves crossing, the lattice of a guilloche, month by month.
  const kept = slots.map((s) => (s === null ? 0 : s.kept / 100));
  const keptAt = (a: number): number => {
    // Eased between month centres so the band's swells stay round.
    let u = (((a + Math.PI / 2) / TAU) * SEAL_SLOTS - 0.5) % SEAL_SLOTS;
    if (u < 0) u += SEAL_SLOTS;
    const i = Math.floor(u) % SEAL_SLOTS;
    const f = u - Math.floor(u);
    const s = (1 - Math.cos(Math.PI * f)) / 2;
    return kept[i] + (kept[(i + 1) % SEAL_SLOTS] - kept[i]) * s;
  };
  const perMonth = g.turn / SEAL_SLOTS;
  for (let m = 0; m < SEAL_SLOTS; m++) {
    const month = slots[m];
    if (month === null) continue;
    const red = month.kept < 0;
    out += `<g class="seal-band" fill="none" stroke-width="${w(red ? 1.5 : 1.3)}"${group(paint('stroke', red ? p.copper : p.band), m)}>`;
    for (const sign of [1, -1]) {
      for (let i = 0; i < g.lines; i++) {
        const pts: string[] = [];
        for (let j = 0; j <= perMonth; j++) {
          const a = slotStart(m) + (j / perMonth) * (TAU / SEAL_SLOTS);
          const mid = 420 + 46 * keptAt(a);
          const phase = (TAU * i) / g.lines + (sign < 0 ? Math.PI / g.lines : 0);
          pts.push(xy(mid + 52 * Math.sin(sign * g.waves * a + phase), a));
        }
        out += `<path d="${line(pts, false)}"/>`;
      }
    }
    out += '</g>';
  }

  // A fine ring between band and petals.
  if (g.ornament) {
    out += `<g fill="none" style="${paint('stroke', p.rule)}" stroke-width="${w(0.7)}">`;
    for (const sign of g.weight > 1 ? [1] : [1, -1]) {
      const pts: string[] = [];
      for (let j = 0; j < g.turn; j++) {
        const a = (j / g.turn) * TAU;
        pts.push(xy(318 + 5 * Math.sin(sign * (g.weight > 1 ? 48 : 96) * a), a));
      }
      out += `<path d="${line(pts, true)}"/>`;
    }
    out += '</g>';
  }

  // Petals: one per month, as long as the month's spending, engraved as nested lines. Length runs
  // in proportion from the hub's edge, so a petal twice as long is a month that spent twice as
  // much; a month that spent nothing keeps a stub, so it never reads as a slot left blank.
  for (let m = 0; m < SEAL_SLOTS; m++) {
    const month = slots[m];
    if (month === null) continue;
    const reach = Math.max(18, 270 * (month.spent / 100));
    const centre = slotStart(m) + Math.PI / SEAL_SLOTS;
    out += `<g class="seal-petal"${group(paint('stroke', p.ink), m)}>`;
    for (let q = 0; q < g.petalLines; q++) {
      const pts: string[] = [];
      const width = 0.21 - q * (g.petalLines > 1 ? 0.18 / g.petalLines : 0);
      const inset = q * (reach / (g.petalLines * 4.8));
      for (let j = 0; j <= g.petalPoints; j++) {
        const u = (j / g.petalPoints) * 2 - 1;
        const r = 72 + (reach - inset) * Math.cos((u * Math.PI) / 2) ** 0.9;
        pts.push(xy(r, centre + u * width));
      }
      const outline = q === 0;
      out += `<path d="${line(pts, outline)}"${engrave === undefined ? '' : ' pathLength="1"'} style="${paint('fill', outline ? p.ink : 'none')}" fill-opacity="${outline ? 0.08 : 0}" stroke-width="${w(outline ? 2.4 : 1)}" stroke-opacity="${outline ? 1 : 0.7}"/>`;
    }
    out += '</g>';
  }

  out += `<circle cx="${C}" cy="${C}" r="62" style="${paint('fill', p.hub)};${paint('stroke', p.ink)}" stroke-width="${w(1.4)}"/>`;
  if (g.ornament) {
    out += `<circle cx="${C}" cy="${C}" r="54" fill="none" style="${paint('stroke', p.rule)}" stroke-width="${w(0.8)}"/>`;
  }
  return `${out}</svg>`;
}
