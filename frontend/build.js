#!/usr/bin/env node
/**
 * Build script: concatenates HTML templates + modular CSS/JS into index.html
 *
 * Usage: node frontend/build.js
 *
 * This reads the extracted HTML templates and modular JS/CSS files,
 * and builds the final index.html for production.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const TEMPLATES = path.join(FRONTEND, 'templates');

// File paths
const INDEX = path.join(FRONTEND, 'index.html');
const SIDEBAR_TPL = path.join(TEMPLATES, 'sidebar.html');
const PAGES_TPL = path.join(FRONTEND, 'templates', 'pages.html');
const MODALS_TPL = path.join(TEMPLATES, 'modals.html');
const TOAST_TPL = path.join(TEMPLATES, 'toast.html');

// Cache bust: use timestamp to force fresh loads
const CACHE_BUST = Date.now();

// External JS scripts - D3 and modular JS files
const jsScripts = `<script src="https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js"></script>
<script src="js/core/api.js?v=${CACHE_BUST}"></script>
<script src="js/core/auth.js?v=${CACHE_BUST}"></script>
<script src="js/core/theme.js?v=${CACHE_BUST}"></script>
<script src="js/core/modal.js?v=${CACHE_BUST}"></script>
<script src="js/core/profile.js?v=${CACHE_BUST}"></script>
<script src="js/core/router.js?v=${CACHE_BUST}"></script>
<script src="js/features/dashboard.js?v=${CACHE_BUST}"></script>
<script src="js/features/transactions.js?v=${CACHE_BUST}"></script>
<script src="js/features/budgets.js?v=${CACHE_BUST}"></script>
<script src="js/features/loans.js?v=${CACHE_BUST}"></script>
<script src="js/features/retirement.js?v=${CACHE_BUST}"></script>
<script src="js/features/analytics.js?v=${CACHE_BUST}"></script>
<script src="js/features/categories-accounts.js?v=${CACHE_BUST}"></script>
<script src="js/features/import.js?v=${CACHE_BUST}"></script>
<script src="js/features/settings-reports.js?v=${CACHE_BUST}"></script>
<script src="js/features/chartExport.js?v=${CACHE_BUST}"></script>
<script src="js/features/bulkEdit.js?v=${CACHE_BUST}"></script>
<script src="js/features/quickadd.js?v=${CACHE_BUST}"></script>
<script src="js/features/savingsGoals.js?v=${CACHE_BUST}"></script>
<script src="js/features/bills.js?v=${CACHE_BUST}"></script>
<script src="js/features/housingCalc.js?v=${CACHE_BUST}"></script>
<script src="js/app.js?v=${CACHE_BUST}"></script>
`;

function build() {
  // Build the output
  let output = '';

  // 1. HTML boilerplate (head opening + Chart.js CDN + D3 CDN)
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

  // 2. External CSS links
  output += '<link rel="stylesheet" href="css/base.css">\n';
  output += '<link rel="stylesheet" href="css/components.css">\n';

  // 3. Close head, open body
  output += '</head>\n<body>\n';

  // 4. HTML templates
  output += fs.readFileSync(SIDEBAR_TPL, 'utf8');
  output += fs.readFileSync(PAGES_TPL, 'utf8');
  output += fs.readFileSync(MODALS_TPL, 'utf8');
  output += fs.readFileSync(TOAST_TPL, 'utf8');

  // 5. External JS scripts (modular modules)
  output += '\n' + jsScripts + '\n';

  // 6. Close body
  output += '</body>\n</html>\n';

  fs.writeFileSync(INDEX, output, 'utf8');
  console.log('Built index.html from templates');
  console.log(`  Templates: ${fs.readFileSync(SIDEBAR_TPL).length + fs.readFileSync(PAGES_TPL).length + fs.readFileSync(MODALS_TPL).length + fs.readFileSync(TOAST_TPL).length} chars`);
  console.log(`  JS Scripts: ${jsScripts.length} chars`);
  console.log(`  Total: ${output.length} chars`);
}

build();
