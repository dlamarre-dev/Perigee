import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.venv/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Hand-written service worker (plain JS, served as is).
    files: ['public/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: Object.fromEntries(
        ['self', 'caches', 'fetch', 'URL', 'Request', 'Response', 'Promise', 'Set'].map((g) => [
          g,
          'readonly',
        ]),
      ),
    },
  },
);
