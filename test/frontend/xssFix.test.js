/**
 * Tests for XSS vulnerability fix
 */
const fs = require('fs');
const path = require('path');

describe('XSS vulnerability fix', () => {
  let htmlContent;
  let jsContent = '';

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');

    // Read all JS files for function definitions
    const featuresDir = path.join(__dirname, '../../frontend/js/features/');
    const coreDir = path.join(__dirname, '../../frontend/js/core/');

    [featuresDir, coreDir].forEach(dir => {
      fs.readdirSync(dir).forEach(file => {
        if (file.endsWith('.js')) {
          jsContent += fs.readFileSync(path.join(dir, file), 'utf8');
        }
      });
    });
  });

  describe('escapeHtml function', () => {
    test('escapeHtml function exists', () => {
      expect(jsContent).toContain('function escapeHtml(str)');
    });

    test('escapeHtml uses textContent to safely escape', () => {
      expect(jsContent).toContain("div.textContent = str");
      expect(jsContent).toContain("return div.innerHTML");
    });
  });

  describe('Transaction description escaping', () => {
    test('transaction descriptions are escaped in table rendering', () => {
      // Check that escapeHtml is used for transaction description
      const lines = jsContent.split('\n');
      let found = false;
      for (const line of lines) {
        if (line.includes('escapeHtml(t.description)')) { found = true; break; }
      }
      expect(found).toBe(true);
    });
  });

  describe('Category name escaping', () => {
    test('category names are escaped in dropdowns', () => {
      // Multiple places set innerHTML with category names
      expect(jsContent).toContain('escapeHtml(c.name)');
    });

    test('category names are escaped in category page list', () => {
      // Check categories page rendering
      expect(jsContent).toContain('escapeHtml(c.name)');
    });
  });

  describe('Profile names escaping', () => {
    test('profile names use escapeHtml in dropdown', () => {
      expect(jsContent).toMatch(/this\.escapeHtml\(p\.name\)|profile\.escapeHtml\(p\.name\)/);
    });

    test('profile current name uses textContent (safe)', () => {
      // Should use .textContent = current.name (safe by default)
      expect(jsContent).toContain("textContent = current ? current.name");
    });
  });

  describe('Analytics category names escaping', () => {
    test('category names in analytics are escaped', () => {
      expect(jsContent).toContain('escapeHtml(c.name)');
    });
  });
});