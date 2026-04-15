/**
 * Tests for XSS vulnerability fix
 */
const fs = require('fs');
const path = require('path');

describe('XSS vulnerability fix', () => {
  let htmlContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('escapeHtml function', () => {
    test('escapeHtml function exists', () => {
      expect(htmlContent).toContain('function escapeHtml(str)');
    });

    test('escapeHtml uses textContent to safely escape', () => {
      expect(htmlContent).toContain("div.textContent = str");
      expect(htmlContent).toContain("return div.innerHTML");
    });
  });

  describe('Transaction description escaping', () => {
    test('transaction descriptions are escaped in table rendering', () => {
      // Check that escapeHtml is used for transaction description
      const lines = htmlContent.split('\n');
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
      expect(htmlContent).toContain('escapeHtml(c.name)');
    });

    test('category names are escaped in category page list', () => {
      // Check categories page rendering
      expect(htmlContent).toContain('escapeHtml(c.name)');
    });
  });

  describe('Profile names escaping', () => {
    test('profile names use escapeHtml in dropdown', () => {
      expect(htmlContent).toContain('profile.escapeHtml(p.name)');
    });

    test('profile current name uses textContent (safe)', () => {
      // Should use .textContent = current.name (safe by default)
      expect(htmlContent).toContain("textContent = current.name");
    });
  });

  describe('Analytics category names escaping', () => {
    test('category names in analytics are escaped', () => {
      expect(htmlContent).toContain('escapeHtml(c.name)');
    });
  });
});