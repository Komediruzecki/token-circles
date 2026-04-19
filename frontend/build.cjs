/**
 * Build script - Generates index.html from templates for the SolidJS SPA.
 * Uses Vite for the main build, TypeScript for type checking.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const TEMPLATES = path.join(__dirname, 'templates')
const DIST = path.join(__dirname, 'dist')

function runTsc() {
  console.log('1. Checking TypeScript...')
  try {
    execSync('npx tsc', { stdio: 'inherit' })
  } catch (e) {
    console.error('TypeScript compilation failed')
    process.exit(1)
  }
}

function runViteBuild() {
  console.log('2. Building with Vite...')
  try {
    execSync('npx vite build', { stdio: 'inherit' })
  } catch (e) {
    console.error('Vite build failed')
    process.exit(1)
  }
}

function copyStaticFiles() {
  const cssDir = path.join(__dirname, 'css')
  const outCssDir = path.join(DIST, 'assets', 'css')

  if (!fs.existsSync(outCssDir)) {
    fs.mkdirSync(outCssDir, { recursive: true })
  }

  for (const file of ['base.css', 'components.css']) {
    fs.copyFileSync(path.join(cssDir, file), path.join(outCssDir, file))
  }

  if (!fs.existsSync(path.join(DIST, 'assets', 'templates'))) {
    fs.mkdirSync(path.join(DIST, 'assets', 'templates'), { recursive: true })
  }

  for (const file of ['sidebar.html', 'pages.html', 'modals.html', 'toast.html']) {
    fs.copyFileSync(path.join(TEMPLATES, file), path.join(DIST, 'assets', 'templates', file))
  }
}

function generateHTML() {
  console.log('3. Generating index.html...')
  let output = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Finance Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/dist/assets/css/base.css">
<link rel="stylesheet" href="/dist/assets/css/components.css">
</head>
<body>
`

  output += fs.readFileSync(path.join(TEMPLATES, 'sidebar.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'pages.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'modals.html'), 'utf8')
  output += fs.readFileSync(path.join(TEMPLATES, 'toast.html'), 'utf8')

  output += `
<script type="module" src="/dist/assets/index.js"></script>
</body>
</html>
`

  fs.writeFileSync(path.join(__dirname, 'index.html'), output, 'utf8')
}

// Main build function
function build() {
  console.log('Building Finance Manager SPA...')
  runTsc()
  runViteBuild()
  copyStaticFiles()
  generateHTML()
  console.log('\n✓ Build complete!')
}

build()