import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo>/. Override with PERIGEE_BASE=/ for a custom domain.
const base = process.env['PERIGEE_BASE'] ?? '/Perigee/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~500 kB minified; the whole app is one chunk until views are code-split (M2+).
    chunkSizeWarningLimit: 800,
  },
  // Module workers: satellite.js 7 re-exports its WASM build, which uses top-level await.
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
