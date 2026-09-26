import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo>/. Override with PERIGEE_BASE=/ for a custom domain.
const base = process.env['PERIGEE_BASE'] ?? '/Perigee/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
