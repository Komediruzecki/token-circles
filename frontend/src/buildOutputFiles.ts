/**
 * Files a build writes into its output folder itself, outside the bundle:
 *   - the standalone export documents (`export.html`, `export-monthly.html` and the Chart.js they
 *     load), copied as they are from the frontend folder;
 *   - `version.json`, which the app polls to notice a new deployment (core/appVersion.ts).
 *
 * Both write to the build's resolved `outDir`, never to a hard-coded `dist/`: with
 * `vite build --outDir X` they used to land in `dist/` (or fail with ENOENT when there was none),
 * and X shipped without them.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is Vite's resolved outDir
   or the frontend folder, joined with a literal file name; nothing here comes from outside the
   build. */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/** Documents with their own scripts, served beside the app rather than bundled into it. */
export const STANDALONE_FILES = ['export.html', 'export-monthly.html', 'chart.umd.min.js'] as const

const resolvedOutDir = (config: ResolvedConfig): string =>
  path.resolve(config.root, config.build.outDir)

/** Copy the standalone export documents from `sourceDir` into the build's outDir. */
export function standaloneFilesPlugin(sourceDir: string): Plugin {
  let outDir = ''
  return {
    name: 'copy-export-html',
    apply: 'build',
    configResolved(config) {
      outDir = resolvedOutDir(config)
    },
    writeBundle() {
      for (const file of STANDALONE_FILES) {
        const src = path.join(sourceDir, file)
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(outDir, file))
        }
      }
    },
  }
}

export interface BuildIdentity {
  version: string
  gitSha: string
}

/**
 * Emit a tiny, never-cached version.json (served no-cache via _headers). The app polls it to
 * detect a new deployment and reload at a safe moment — see core/appVersion.ts.
 */
export function versionJsonPlugin(identity: BuildIdentity): Plugin {
  let outDir = ''
  return {
    name: 'emit-version-json',
    apply: 'build',
    configResolved(config) {
      outDir = resolvedOutDir(config)
    },
    writeBundle() {
      const payload = JSON.stringify({
        version: identity.version,
        gitSha: identity.gitSha,
        builtAt: new Date().toISOString(),
      })
      fs.writeFileSync(path.join(outDir, 'version.json'), payload)
    },
  }
}
