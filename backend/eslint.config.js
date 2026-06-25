import js from '@eslint/js';
import pluginSecurity from 'eslint-plugin-security';
import pluginSonarjs from 'eslint-plugin-sonarjs';

export default [
  js.configs.recommended,
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
        beforeEach: 'readonly',
        afterAll: 'readonly',
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
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-proto': 'warn',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
    },
    ignores: ['**/node_modules/**', '**/test/**', 'jest.setup.js'],
  },
];
