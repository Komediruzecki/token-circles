#!/usr/bin/env node
/**
 * Build script: bundles JS with esbuild, generates index.html from templates.
 *
 * Usage: node frontend/build.js
 *
 * Output structure:
 *   frontend/js/dist/core.js     - minified core modules (api, auth, modal, profile, theme, router)
 *   frontend/js/dist/features.js - minified feature modules (all 16 features)
 *   frontend/js/dist/app.js     - minified app bootstrap
 *   frontend/index.html          - generated SPA entry point
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const TEMPLATES = path.join(FRONTEND, 'templates');
const JS_SRC = path.join(FRONTEND, 'js');
const JS_DIST = path.join(FRONTEND, 'js', 'dist');
const JS_CORE = path.join(JS_SRC, 'core');
const JS_FEATURES = path.join(JS_SRC, 'features');
const CSS_DIR = path.join(FRONTEND, 'css');
const BUILD_MANIFEST = path.join(FRONTEND, '.build-manifest.json');
const INDEX = path.join(FRONTEND, 'index.html');

// Template files
const SIDEBAR_TPL = path.join(TEMPLATES, 'sidebar.html');
const PAGES_TPL = path.join(TEMPLATES, 'pages.html');
const MODALS_TPL = path.join(TEMPLATES, 'modals.html');
const TOAST_TPL = path.join(TEMPLATES, 'toast.html');

// Core modules (always loaded)
const CORE_FILES = ['app-singleton.js', 'auth.js', 'modal.js', 'profile.js', 'theme.js'];

// Feature modules
const FEATURE_FILES = [
  'analytics.js', 'bills.js', 'budgets.js', 'bulkEdit.js',
  'categories-accounts.js', 'chartExport.js', 'dashboard.js',
  'heatmap.js', 'housingCalc.js', 'import.js', 'loans.js',
  'quickadd.js', 'retirement.js', 'savingsGoals.js',
  'settings-reports.js', 'transactions.js',
];

// Page → feature file mapping
const PAGE_FEATURES = {
  dashboard: ['dashboard'],
  transactions: ['transactions'],
  budgets: ['budgets'],
  loans: ['loans'],
  goals: ['savingsGoals'],
  bills: ['bills'],
  import: ['import'],
  accounts: ['categories-accounts'],
  retirement: ['retirement'],
  housing: ['housingCalc'],
  analytics: ['analytics', 'heatmap'],
  categories: ['categories-accounts'],
  settings: ['settings-reports'],
};

function computeHash(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

function getFileHash(fp) {
  return computeHash(fs.readFileSync(fp, 'utf8'));
}

async function build(opts = {}) {
  const esbuild = require('esbuild');

  // Create output directories
  const featuresDist = path.join(JS_DIST, 'features');
  fs.mkdirSync(featuresDist, { recursive: true });

  // Incremental: only rebuild files whose content hash changed
  let oldManifest = {};
  try { oldManifest = JSON.parse(fs.readFileSync(BUILD_MANIFEST, 'utf8')); } catch {}

  const manifest = {
    version: computeHash(
      [...CORE_FILES.map(f => path.join(JS_CORE, f)), ...FEATURE_FILES.map(f => path.join(JS_FEATURES, f))]
        .map(fp => getFileHash(fp)).join('')
    ),
    swVersion: computeHash(Date.now().toString()),
    hashes: {},
    pages: PAGE_FEATURES,
    timestamp: Date.now(),
  };
  let totalJsBytes = 0;

  // ========== 1. Core bundle (minified concatenation) ==========
  // esbuild IIFE bundling causes tree-shaking of unused const declarations.
  // Use esbuild transform (no bundling) for safe minification without tree-shaking.
  let coreCode = '';
  for (const f of CORE_FILES) {
    coreCode += fs.readFileSync(path.join(JS_CORE, f), 'utf8') + '\n';
  }
  const coreMinified = await esbuild.transform(coreCode, { minify: true, logLevel: 'error' });
  fs.writeFileSync(path.join(JS_DIST, 'core.js'), coreMinified.code);
  const coreHash = getFileHash(path.join(JS_DIST, 'core.js'));
  const coreSize = fs.statSync(path.join(JS_DIST, 'core.js')).size;
  totalJsBytes += coreSize;
  manifest.hashes['core.js'] = coreHash;
  console.log(`  core.js        ${(coreSize / 1024 / 1024).toFixed(2)}MB  hash=${coreHash}`);

  // ========== 2. Feature bundle (minified concatenation) ==========
  let featCode = '';
  for (const feat of FEATURE_FILES) {
    featCode += fs.readFileSync(path.join(JS_FEATURES, feat), 'utf8') + '\n';
  }
  const featMinified = await esbuild.transform(featCode, { minify: true, logLevel: 'error' });
  fs.writeFileSync(path.join(JS_DIST, 'features.js'), featMinified.code);
  const featHash = getFileHash(path.join(JS_DIST, 'features.js'));
  const featSize = fs.statSync(path.join(JS_DIST, 'features.js')).size;
  totalJsBytes += featSize;
  manifest.hashes['features/features.js'] = featHash;
  console.log(`  features.js   ${(featSize / 1024 / 1024).toFixed(2)}MB  hash=${featHash}`);

  // ========== 3. App bundle ==========
  let appCode = fs.readFileSync(path.join(JS_SRC, 'app.js'), 'utf8');
  const appMinified = await esbuild.transform(appCode, { minify: true, logLevel: 'error' });
  fs.writeFileSync(path.join(JS_DIST, 'app.js'), appMinified.code);
  const appHash = getFileHash(path.join(JS_DIST, 'app.js'));
  const appSize = fs.statSync(path.join(JS_DIST, 'app.js')).size;
  totalJsBytes += appSize;
  manifest.hashes['app.js'] = appHash;
  console.log(`  app.js        ${(appSize / 1024).toFixed(1)}KB  hash=${appHash}`);

  // ========== 4. CSS minification ==========
  const cssFiles = ['base.css', 'components.css'];
  let totalCssBytes = 0;
  try {
    const { minify: cssMinify } = await import('clean-css');
    for (const f of cssFiles) {
      const fp = path.join(CSS_DIR, f);
      if (fs.existsSync(fp)) {
        const input = fs.readFileSync(fp, 'utf8');
        const result = new cssMinify({}).minify(input);
        fs.writeFileSync(fp, result.styles, 'utf8');
        const hash = computeHash(result.styles);
        manifest.hashes[`css/${f}`] = hash;
        totalCssBytes += result.styles.length;
        console.log(`  css/${f}    ${(result.styles.length / 1024).toFixed(1)}KB  hash=${hash}`);
      }
    }
  } catch (e) {
    console.log('  CSS minification skipped (clean-css not installed)');
    for (const f of cssFiles) {
      const fp = path.join(CSS_DIR, f);
      if (fs.existsSync(fp)) {
        const hash = getFileHash(fp);
        manifest.hashes[`css/${f}`] = hash;
        totalCssBytes += fs.statSync(fp).size;
      }
    }
  }

  // ========== 5. Save manifest + inject SW version ==========
  fs.writeFileSync(BUILD_MANIFEST, JSON.stringify(manifest, null, 2));
  // Inject swVersion into sw.js so it auto-increments on every build
  let swCode = fs.readFileSync(path.join(FRONTEND, 'sw.js'), 'utf8');
  // Replace the current cache name (any 'finance-manager-vXXXXXXXX' pattern)
  swCode = swCode.replace(/const CACHE_NAME = 'finance-manager-v[a-f0-9]+';/, `const CACHE_NAME = 'finance-manager-v${manifest.swVersion}';`);
  fs.writeFileSync(path.join(FRONTEND, 'sw.js'), swCode);
  console.log(`  sw.js         cache=v${manifest.swVersion}`);

  // ========== 6. Generate index.html ==========
  generateHTML(manifest, manifest.swVersion);

  console.log(`\nBuild complete. Total: ${((totalJsBytes + totalCssBytes) / 1024 / 1024).toFixed(2)}MB (${(totalJsBytes / 1024).toFixed(1)}KB JS, ${(totalCssBytes / 1024).toFixed(1)}KB CSS)`);
}

function generateHTML(manifest, swVersion) {
  const h = manifest.hashes;
  const v = manifest.version;

  // CDN libs + bundled core + bundled app
  // Feature modules are loaded lazily via nav.js dynamic imports
  const jsScripts = `<script src="https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="js/dist/core.js?v=${h['core.js'] || v}"></script>
<script src="js/dist/features.js?v=${h['features/features.js'] || v}"></script>
<script src="js/dist/app.js?v=${h['app.js'] || v}"></script>
`;

  let output = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Finance Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/base.css?v=${h['css/base.css'] || v}">
<link rel="stylesheet" href="css/components.css?v=${h['css/components.css'] || v}">
</head>
<body>
`;
  output += fs.readFileSync(SIDEBAR_TPL, 'utf8');
  output += fs.readFileSync(PAGES_TPL, 'utf8');
  output += fs.readFileSync(MODALS_TPL, 'utf8');
  output += fs.readFileSync(TOAST_TPL, 'utf8');
  output += '\n' + jsScripts + '\n';
  output += `<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js?v=${swVersion}').catch(()=>{});}</script>\n`;
  output += '</body>\n</html>\n';

  fs.writeFileSync(INDEX, output, 'utf8');
  console.log(`  index.html    ${(output.length / 1024).toFixed(1)}KB`);
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

// Watch mode for development
if (process.argv.includes('--watch')) {
  const watchTargets = [
    ...CORE_FILES.map(f => path.join(JS_CORE, f)),
    ...FEATURE_FILES.map(f => path.join(JS_FEATURES, f)),
    path.join(JS_SRC, 'app.js'),
    path.join(CSS_DIR, 'base.css'),
    path.join(CSS_DIR, 'components.css'),
    SIDEBAR_TPL, PAGES_TPL, MODALS_TPL, TOAST_TPL,
  ];

  console.log('\nWatching for changes...');
  const watched = new Set();
  const watcher = (fp) => {
    fs.watch(fp, { persistent: false }, async (evt) => {
      if (evt !== 'change') return;
      if (watched.has(fp)) return;
      watched.add(fp);
      setTimeout(async () => {
        watched.delete(fp);
        const rel = path.relative(FRONTEND, fp);
        console.log(`\n  [changed] ${rel} — rebuilding...`);
        await build();
      }, 100);
    });
  };

  for (const fp of watchTargets) {
    if (fs.existsSync(fp)) watcher(fp);
  }
}
