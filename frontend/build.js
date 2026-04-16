#!/usr/bin/env node
/**
 * Build script: concatenates HTML templates + inline CSS/JS into index.html
 *
 * Usage: node frontend/build.js
 *
 * This reads the original monolith's inline CSS and JS from a reference file,
 * and the extracted HTML templates, and builds the final index.html.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const TEMPLATES = path.join(FRONTEND, 'templates');

// File paths
const INDEX = path.join(FRONTEND, 'index.html');
const MONOLITH_REF = path.join(FRONTEND, 'index.html.ref'); // original monolith with inline CSS/JS
const SIDEBAR_TPL = path.join(TEMPLATES, 'sidebar.html');
const PAGES_TPL = path.join(TEMPLATES, 'pages.html');
const MODALS_TPL = path.join(TEMPLATES, 'modals.html');
const TOAST_TPL = path.join(TEMPLATES, 'toast.html');

const cssLink = '<link rel="stylesheet" href="css/base.css">\n<link rel="stylesheet" href="css/components.css">\n';

// External JS scripts are loaded during development via individual <script> tags
// For production builds, all JS is inlined in index.html for test compatibility
const jsScripts = '';

function build() {
  // Read inline CSS/JS from the monolith reference (original with all inlined)
  const monolith = fs.readFileSync(MONOLITH_REF, 'utf8');

  // Extract inline CSS (from <style> to </style>)
  const styleMatch = monolith.match(/<style>([\s\S]*?)<\/style>/);
  const inlineCSS = styleMatch ? styleMatch[0] : '';

  // Extract ALL inline JS from the monolith (from UTILITIES to INIT/</script>)
  // This includes: UTILITIES, PROFILE, AUTH, API, NAVIGATION, THEME, DASHBOARD,
  // TRANSACTION FILTERS, RECURRING, TRANSACTIONS, ANALYTICS, CATEGORIES, ACCOUNTS,
  // BUDGETS, LOANS, RETIREMENT CALCULATOR, IMPORT, DATA EXPORT, MONTHLY PDF REPORT,
  // SETTINGS, QUICK-ADD, INIT
  const utilStart = monolith.indexOf('// ==================== UTILITIES');
  const scriptTagStart = monolith.lastIndexOf('<script>', utilStart);
  const scriptEnd = monolith.indexOf('</script>\n', utilStart) + '</script>\n'.length;
  const inlineJS = monolith.slice(scriptTagStart, scriptEnd);

  // Build the output
  let output = '';

  // 1. HTML boilerplate (head opening + Chart.js CDN)
  output += `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>Finance Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
`;

  // 2. Inline CSS (preserve original formatting for test compatibility)
  output += inlineCSS + '\n';

  // 3. External CSS links
  output += cssLink;

  // 4. Close head, open body
  output += '</head>\n<body>\n';

  // 5. HTML templates
  output += fs.readFileSync(SIDEBAR_TPL, 'utf8');
  output += fs.readFileSync(PAGES_TPL, 'utf8');
  output += fs.readFileSync(MODALS_TPL, 'utf8');
  output += fs.readFileSync(TOAST_TPL, 'utf8');

  // 6. Inline JS (preserve original formatting for test compatibility)
  output += '\n' + inlineJS + '\n';

  // 7. External JS scripts
  output += jsScripts;

  // 8. Close body
  output += '</body>\n</html>\n';

  fs.writeFileSync(INDEX, output, 'utf8');
  console.log('Built index.html from templates');
  console.log(`  CSS: ${inlineCSS.length} chars`);
  console.log(`  JS: ${inlineJS.length} chars`);
  console.log(`  Templates: ${fs.readFileSync(SIDEBAR_TPL).length + fs.readFileSync(PAGES_TPL).length + fs.readFileSync(MODALS_TPL).length + fs.readFileSync(TOAST_TPL).length} chars`);
  console.log(`  Total: ${output.length} chars`);
}

build();
