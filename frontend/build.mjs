/**
 * Build script - Generates index.html from templates for the SolidJS SPA.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEMPLATES = path.join(__dirname, 'templates')
const DIST = path.join(__dirname, 'dist')

function runViteBuild() {
  console.log('Building with Vite...')
  try {
    // Use local node_modules vite to avoid version conflicts with npx
    const vitePath =
      process.platform === 'win32'
        ? path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')
        : path.join(__dirname, 'node_modules', '.bin', 'vite')
    // Use node to run the ESM module with proper flags
    const nodeCmd = process.platform === 'win32' ? 'node' : 'node'
    execSync(`${nodeCmd} ${vitePath} build`, {
      stdio: 'inherit',
      cwd: __dirname,
    })
  } catch (e) {
    console.error('Vite build failed')
    process.exit(1)
  }
}

function generateHTML() {
  let output = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#3b82f6">
<title>Finance Manager</title>
<link rel="manifest" href="/manifest.json">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=fallback" rel="stylesheet">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/dashboard-settings.css">
<link rel="stylesheet" href="dist/assets/css/index.css">
</head>
<body>
<div id="app"></div>
`

  output += fs.readFileSync(path.join(TEMPLATES, 'sidebar.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'modals.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'toast.html'), 'utf8')

  output += `
<script type="module" src="/dist/assets/index.js"></script>
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/dist/assets/sw.js").catch(()=>{});}</script>
</body>
</html>
`

  // Write to repo root (not frontend/ which is served by Apache)
  const repoRoot = path.join(__dirname, '..')
  fs.writeFileSync(path.join(repoRoot, 'index.html'), output, 'utf8')
}

async function copyStaticFiles() {
  const cssDir = path.join(__dirname, 'css')
  const srcCssDir = path.join(__dirname, 'src')
  const outCssDir = path.join(DIST, 'assets', 'css')

  if (!fs.existsSync(outCssDir)) {
    fs.mkdirSync(outCssDir, { recursive: true })
  }

  // Copy CSS from both src and css directories (SolidJS refactor mixed files)
  await fs.promises.copyFile(path.join(cssDir, 'base.css'), path.join(outCssDir, 'base.css'))

  await fs.promises.copyFile(
    path.join(cssDir, 'components.css'),
    path.join(outCssDir, 'components.css')
  )

  // Copy dashboard-settings.css
  if (fs.existsSync(path.join(cssDir, 'dashboard-settings.css'))) {
    await fs.promises.copyFile(
      path.join(cssDir, 'dashboard-settings.css'),
      path.join(outCssDir, 'dashboard-settings.css')
    )
    console.log('Copied dashboard-settings.css')
  }

  // Copy index.css from src which contains app layout styles (.app-root, .app-header, etc.)
  if (fs.existsSync(path.join(srcCssDir, 'index.css'))) {
    await fs.promises.copyFile(path.join(srcCssDir, 'index.css'), path.join(outCssDir, 'index.css'))
    console.log('Copied src/index.css with layout styles')
  }

  if (!fs.existsSync(path.join(DIST, 'assets', 'templates'))) {
    fs.mkdirSync(path.join(DIST, 'assets', 'templates'), { recursive: true })
  }

  for (const file of ['sidebar.html', 'modals.html', 'toast.html']) {
    await fs.promises.copyFile(
      path.join(TEMPLATES, file),
      path.join(DIST, 'assets', 'templates', file)
    )
  }
}

// Main build function
async function build() {
  console.log('Building Finance Manager...')
  await runViteBuild()
  await copyStaticFiles()
  await copyServiceWorker()
  await copyStandaloneServiceWorker()
  generateHTML()
  console.log('\nBuild complete!')
}

async function copyServiceWorker() {
  const srcSw = path.join(__dirname, 'sw.js')
  const distSw = path.join(DIST, 'assets', 'sw.js')

  if (fs.existsSync(srcSw)) {
    let swContent = await fs.promises.readFile(srcSw, 'utf8')
    // Inject version from package.json
    const pkg = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, '../package.json'), 'utf8')
    )
    const version = pkg.version
    swContent = swContent.replace(
      /const CACHE_VERSION = '[^']*'/,
      `const CACHE_VERSION = '${version}'`
    )
    await fs.promises.writeFile(distSw, swContent, 'utf8')
    console.log(`Copied service worker with version ${version} to dist/assets/sw.js`)
  } else {
    console.warn('Service worker not found at frontend/sw.js')
  }
}

async function copyStandaloneServiceWorker() {
  const srcSw = path.join(__dirname, 'sw.js')
  const distSw = path.join(__dirname, 'sw.js')

  if (fs.existsSync(srcSw)) {
    let swContent = await fs.promises.readFile(srcSw, 'utf8')
    // Inject version from package.json
    const pkg = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, '../package.json'), 'utf8')
    )
    const version = pkg.version
    swContent = swContent.replace(
      /const CACHE_VERSION = '[^']*'/,
      `const CACHE_VERSION = '${version}'`
    )
    await fs.promises.writeFile(distSw, swContent, 'utf8')
    console.log(`Updated standalone service worker with version ${version}`)
  }
}

build()
