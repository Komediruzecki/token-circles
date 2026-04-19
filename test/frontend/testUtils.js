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

  return {
    htmlContent,
    jsContent,
    combinedContent: htmlContent + jsContent,
  };
}

module.exports = { readFrontendContent, fs, path };
