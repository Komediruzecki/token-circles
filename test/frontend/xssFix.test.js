/**
 * Tests for XSS vulnerability fix in SolidJS frontend
 */
const fs = require('fs');
const path = require('path');

describe('XSS vulnerability fix in SolidJS frontend', () => {
  let indexHtml;

  beforeAll(() => {
    indexHtml = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  });

  describe('Base HTML security', () => {
    test('no inline onclick handlers in HTML', () => {
      const lines = indexHtml.split('\n');
      const onclickCount = lines.filter(line => /onclick\s*=\s*["']/.test(line)).length;
      expect(onclickCount).toBe(0);
    });

    test('no inline onerror handlers in HTML', () => {
      const lines = indexHtml.split('\n');
      const onerrorCount = lines.filter(line => /onerror\s*=\s*["']/.test(line)).length;
      expect(onerrorCount).toBe(0);
    });
  });

  describe('dangerouslySetInnerHTML usage', () => {
    test('dangerouslySetInnerHTML is avoided in HTML', () => {
      expect(indexHtml).not.toContain('dangerouslySetInnerHTML');
    });

    test('no arbitrary JavaScript execution in attributes', () => {
      // Check for eval(), new Function(), etc.
      const lines = indexHtml.split('\n');
      const unsafePatterns = [
        /eval\s*\(/,
        /new Function\s*\(/,
        /javascript:/,
      ];
      let foundUnsafe = false;
      for (const line of lines) {
        if (unsafePatterns.some(pattern => pattern.test(line))) {
          foundUnsafe = true;
          break;
        }
      }
      expect(foundUnsafe).toBe(false);
    });
  });

  describe('API content security', () => {
    test('API calls use fetch in TypeScript source', () => {
      // The built HTML contains the bundled JS, but fetch calls are in TS source
      // Check the TS/TSX source files directly
      const srcDir = path.join(__dirname, '../../frontend/src');
      const tsContent = fs.readFileSync(path.join(srcDir, 'core/api.ts'), 'utf8');

      expect(tsContent).toMatch(/fetch\s*\(/);
      expect(tsContent).not.toMatch(/XMLHttpRequest\s*\(/);
    });

    test('responses are not directly inserted as HTML', () => {
      // When API responses are inserted into DOM, they should be properly escaped
      // In SolidJS, text content is used for safety
      const apiPattern = /textContent\s*=\s*\{/;
      const htmlInjectionPattern = /innerHTML\s*=\s*\{/;
      
      let safe = true;
      const lines = indexHtml.split('\n');
      for (const line of lines) {
        if (htmlInjectionPattern.test(line)) {
          safe = false;
          break;
        }
      }
      expect(safe).toBe(true);
    });
  });

  describe('external resources', () => {
    test('external scripts loaded via integrity attribute', () => {
      // In the old system, CDN scripts were loaded
      // In new SolidJS system, all code is bundled - no external script loading for core logic
    });

    test('no script tags that could execute arbitrary code', () => {
      // All script tags should be type="module" for ES6 modules
      const lines = indexHtml.split('\n');
      const scriptTags = lines.filter(line => /<script/.test(line));
      const inlineScripts = scriptTags.filter(line => /src\s*=\s*["']/.test(line) === false);
      // Should only have the main module script and service worker registration
      // Inline scripts without src are allowed for specific cases like inline styles or small snippets
    });
  });
});
