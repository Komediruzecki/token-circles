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
    const vitePath = process.platform === 'win32'
      ? path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')
      : path.join(__dirname, 'node_modules', '.bin', 'vite')
    // Use node to run the ESM module with proper flags
    const nodeCmd = process.platform === 'win32' ? 'node' : 'node'
    execSync(`${nodeCmd} ${vitePath} build`, {
      stdio: 'inherit',
      cwd: __dirname
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
<title>Finance Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
</head>
<body>
`

  output += fs.readFileSync(path.join(TEMPLATES, 'sidebar.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'pages.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'modals.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'toast.html'), 'utf8')

  output += `
<script type="module" src="/dist/assets/index.js"></script>
<script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/dist/assets/sw.js").catch(()=>{});}</script>
</body>
</html>
`

  fs.writeFileSync(path.join(__dirname, 'index.html'), output, 'utf8')
}

async function copyStaticFiles() {
  const cssDir = path.join(__dirname, 'css')
  const outCssDir = path.join(DIST, 'assets', 'css')

  if (!fs.existsSync(outCssDir)) {
    fs.mkdirSync(outCssDir, { recursive: true })
  }

  await fs.promises.copyFile(path.join(cssDir, 'base.css'), path.join(outCssDir, 'base.css'))

  await fs.promises.copyFile(
    path.join(cssDir, 'components.css'),
    path.join(outCssDir, 'components.css')
  )

  if (!fs.existsSync(path.join(DIST, 'assets', 'templates'))) {
    fs.mkdirSync(path.join(DIST, 'assets', 'templates'), { recursive: true })
  }

  for (const file of ['sidebar.html', 'pages.html', 'modals.html', 'toast.html']) {
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
  generateHTML()
  console.log('\nBuild complete!')
}

async function copyServiceWorker() {
  const srcSw = path.join(__dirname, 'sw.js')
  const destSw = path.join(DIST, 'assets', 'sw.js')

  if (fs.existsSync(srcSw)) {
    await fs.promises.copyFile(srcSw, destSw)
    console.log('Copied service worker to dist/assets/sw.js')
  } else {
    console.warn('Service worker not found at frontend/sw.js')
  }
}

build()
