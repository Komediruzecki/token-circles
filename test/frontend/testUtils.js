/**
 * Test utilities for reading frontend files in modular architecture
 */
const fs = require('fs');
const path = require('path');

/**
 * Read all frontend content (HTML + JS modules combined)
 */
function readFrontendContent() {
  const frontendDir = path.join(__dirname, '../../frontend');

  // Read index.html
  const htmlContent = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');

  // Read all JS files from modular directories
  let jsContent = '';
  const jsDirs = [
    path.join(frontendDir, 'js', 'core'),
    path.join(frontendDir, 'js', 'features'),
  ];

  jsDirs.forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((file) => {
        if (file.endsWith('.js')) {
          jsContent += fs.readFileSync(path.join(dir, file), 'utf8') + '\n';
        }
      });
    }
  });

  // Read CSS files too (for CSS tests)
  let cssContent = '';
  const cssDir = path.join(frontendDir, 'css');
  if (fs.existsSync(cssDir)) {
    fs.readdirSync(cssDir).forEach((file) => {
      if (file.endsWith('.css')) {
        cssContent += fs.readFileSync(path.join(cssDir, file), 'utf8') + '\n';
      }
    });
  }

  return {
    htmlContent,
    jsContent,
    cssContent,
    combinedContent: htmlContent + jsContent + cssContent,
  };
}

module.exports = { readFrontendContent, fs, path };
