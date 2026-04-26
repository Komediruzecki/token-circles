import js from '@eslint/js';

export default [
  js.configs.recommended,
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
      'no-useless-escape': 'off',
    },
    ignores: ['**/node_modules/**', '**/test/**', 'jest.setup.js'],
  },
];
