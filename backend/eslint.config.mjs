import pluginSecurity from 'eslint-plugin-security';
import pluginSonarjs from 'eslint-plugin-sonarjs';

// Note: we intentionally do NOT pull in `@eslint/js` (js.configs.recommended).
// It is not a backend dependency, and importing it crashed `eslint` entirely
// (ERR_MODULE_NOT_FOUND), which meant the backend was never actually linted.
// The handful of core correctness rules we care about are enabled explicitly below.
export default [
  pluginSecurity.configs.recommended,
  pluginSonarjs.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        global: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        setInterval: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      // Core correctness rules (would normally come from eslint:recommended)
      // enabled explicitly so we don't need the @eslint/js dependency.
      'no-useless-escape': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-proto': 'warn',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
    },
  },
  {
    // Global overrides.
    //
    // The rules below are intentionally disabled on this legacy backend because
    // they are high-volume or false-positive-prone, not because the findings are
    // invalid. Tracked counts at time of writing: detect-object-injection ~63
    // (flags every obj[key] access), pseudo-random ~34 (Math.random in demo/seed
    // data, not used for anything security-sensitive). detect-unsafe-regex,
    // detect-non-literal-fs-filename and no-hardcoded-passwords each fire on a
    // small number of reviewed, intentional sites (dynamic upload/receipt paths,
    // the DEFAULT_PASSWORD dev fallback). Re-enable these incrementally with
    // inline disables on the justified sites — do not silently treat the codebase
    // as clean for them.
    rules: {
      'sonarjs/cognitive-complexity': 'off',
      'security/detect-object-injection': 'off',
      'sonarjs/no-nested-conditional': 'off',
      'sonarjs/super-linear-regex': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/no-dead-store': 'off',
      'sonarjs/concise-regex': 'off',
      'sonarjs/no-nested-functions': 'off',
      'sonarjs/no-ignored-exceptions': 'off',
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/pseudo-random': 'off',
      'sonarjs/no-unused-collection': 'off',
      'sonarjs/publicly-writable-directories': 'off',
      'sonarjs/no-hardcoded-passwords': 'off',
      'sonarjs/no-session-cookies-on-static-assets': 'off',
      'sonarjs/content-length': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'test/**', 'jest.setup.js'],
  },
];
