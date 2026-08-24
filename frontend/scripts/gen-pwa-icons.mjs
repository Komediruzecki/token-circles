// ============================================================
// gen-pwa-icons — rasterize the manifest icons from their SVG masters.
//
//   cd frontend && npm run pwa:icons
//
// Needs `rsvg-convert` (librsvg) on PATH. It is NOT run in CI: the PNGs are committed, because
// a build that rasterizes its own icons fails on any machine without the tool, and the icons
// change roughly once a year. Re-run this after editing either SVG and commit the result.
//
// Why a maskable variant exists at all: Android applies its own mask (circle, squircle,
// teardrop, depending on the launcher) to the icon it installs. Given only `purpose: "any"`
// icons, Chrome does not mask ours — it shrinks the whole square into a white circle, so the
// installed app shows a small dark tile floating in white. A `maskable` icon is drawn to be
// masked: background to the edges, artwork inside the 80% safe circle.
// ============================================================
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))

/** [source svg, output png, size] — every raster the manifest declares. */
const TARGETS = [
  ['icon-192.svg', 'icon-192.png', 192],
  ['icon-512.svg', 'icon-512.png', 512],
  ['icon-maskable-512.svg', 'icon-maskable-192.png', 192],
  ['icon-maskable-512.svg', 'icon-maskable-512.png', 512],
]

function ensureRsvg() {
  try {
    execFileSync('rsvg-convert', ['--version'], { stdio: 'pipe' })
  } catch {
    console.error(
      'rsvg-convert not found. Install librsvg (Arch: `pacman -S librsvg`, Debian: ' +
        '`apt install librsvg2-bin`, macOS: `brew install librsvg`) and run this again.'
    )
    process.exit(1)
  }
}

ensureRsvg()
for (const [src, out, size] of TARGETS) {
  execFileSync('rsvg-convert', [
    '-w',
    String(size),
    '-h',
    String(size),
    PUBLIC + src,
    '-o',
    PUBLIC + out,
  ])
  console.log(`${out}  ${size}x${size}  ${statSync(PUBLIC + out).size} bytes`)
}
