/**
 * Tests for PWA support (manifest + service worker)
 */
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(
  path.join(__dirname, '../../frontend/index.html'),
  'utf8'
);

const manifestJson = fs.readFileSync(
  path.join(__dirname, '../../public/manifest.json'),
  'utf8'
);

const swJs = fs.readFileSync(
  path.join(__dirname, '../../public/sw.js'),
  'utf8'
);

describe('PWA Support', () => {
  describe('Manifest', () => {
    let manifest;

    beforeAll(() => {
      manifest = JSON.parse(manifestJson);
    });

    test('manifest.json is valid JSON', () => {
      expect(() => JSON.parse(manifestJson)).not.toThrow();
    });

    test('manifest has name', () => {
      expect(manifest.name).toBeTruthy();
    });

    test('manifest has short_name', () => {
      expect(manifest.short_name).toBeTruthy();
    });

    test('manifest has start_url', () => {
      expect(manifest.start_url).toBe('/');
    });

    test('manifest has display standalone', () => {
      expect(manifest.display).toBe('standalone');
    });

    test('manifest has theme_color', () => {
      expect(manifest.theme_color).toBeTruthy();
    });

    test('manifest has background_color', () => {
      expect(manifest.background_color).toBeTruthy();
    });

    test('manifest has icons array with at least 192x192 and 512x512', () => {
      expect(manifest.icons).toBeInstanceOf(Array);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
      const sizes = manifest.icons.map(i => i.sizes);
      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
    });

    test('manifest icons have PNG type', () => {
      manifest.icons.forEach(icon => {
        expect(icon.type).toBe('image/png');
      });
    });

    test('manifest has categories', () => {
      expect(manifest.categories).toBeInstanceOf(Array);
      expect(manifest.categories.length).toBeGreaterThan(0);
    });
  });

  describe('Service Worker', () => {
    test('service worker file exists', () => {
      expect(fs.existsSync(path.join(__dirname, '../../public/sw.js'))).toBe(true);
    });

    test('service worker has install event', () => {
      expect(swJs).toMatch(/addEventListener\s*\(\s*['"]install['"]/);
    });

    test('service worker has activate event', () => {
      expect(swJs).toMatch(/addEventListener\s*\(\s*['"]activate['"]/);
    });

    test('service worker has fetch event', () => {
      expect(swJs).toMatch(/addEventListener\s*\(\s*['"]fetch['"]/);
    });

    test('service worker caches static assets', () => {
      expect(swJs).toMatch(/caches\.open/);
      expect(swJs).toMatch(/cache\.addAll/);
    });

    test('service worker cleans up old caches on activate', () => {
      expect(swJs).toMatch(/caches\.delete/);
    });

    test('service worker skips waiting on install', () => {
      expect(swJs).toMatch(/skipWaiting/);
    });

    test('service worker claims clients on activate', () => {
      expect(swJs).toMatch(/clients\.claim/);
    });

    test('service worker handles cross-origin requests', () => {
      expect(swJs).toMatch(/event\.request\.url\.startsWith\(self\.location\.origin\)/);
    });

    test('service worker does not cache API requests', () => {
      expect(swJs).toMatch(/\/api\//);
    });

    test('service worker caches navigation requests with index.html fallback', () => {
      expect(swJs).toMatch(/navigate/);
      expect(swJs).toMatch(/index\.html/);
    });

    test('service worker has message handler for SKIP_WAITING', () => {
      expect(swJs).toMatch(/SKIP_WAITING/);
    });

    test('service worker updates cache in background on cache hit', () => {
      expect(swJs).toMatch(/cache\.put/);
    });
  });

  describe('Frontend PWA Integration', () => {
    test('manifest.json is linked in index.html head', () => {
      expect(indexHtml).toMatch(/rel=["']manifest["']\s+href=["']\/manifest\.json["']/);
    });

    test('service worker is registered in init section', () => {
      expect(indexHtml).toMatch(/navigator\.serviceWorker\.register/);
    });

    test('service worker registration is wrapped in feature detection', () => {
      expect(indexHtml).toMatch(/if\s*\(\s*['"]serviceWorker['"]\s+in\s+navigator\s*\)/);
    });

    test('service worker registration handles errors gracefully', () => {
      expect(indexHtml).toMatch(/navigator\.serviceWorker\.register\([^)]+\)\s*\.catch/);
    });
  });
});
