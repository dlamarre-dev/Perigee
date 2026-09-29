import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site under /<repo>/. Override with PERIGEE_BASE=/ for a custom domain.
const base = process.env['PERIGEE_BASE'] ?? '/Perigee/';

/**
 * Basis Universal transcoder (Apache-2.0) used by three's KTX2Loader, served at <base>basis/ in dev and emitted
 * into the build, straight from the installed three.js so the transcoder always matches the loader version.
 */
function basisTranscoder(): Plugin {
  const dir = join('node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  const files = ['basis_transcoder.js', 'basis_transcoder.wasm'];
  return {
    name: 'perigee-basis-transcoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = files.find((f) => req.url?.split('?')[0] === `${base}basis/${f}`);
        if (!name) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({ type: 'asset', fileName: `basis/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

/** Version shown in the About panel: the commit the site was built from (short hash, commit date). */
function buildInfo(): { commit: string; date: string } {
  try {
    const [commit = 'dev', date = ''] = execFileSync('git', ['log', '-1', '--format=%h|%cI'], {
      encoding: 'utf8',
    })
      .trim()
      .split('|');
    return { commit, date };
  } catch {
    return { commit: 'dev', date: '' };
  }
}

export default defineConfig({
  base,
  define: {
    __PERIGEE_BUILD__: JSON.stringify(buildInfo()),
  },
  plugins: [basisTranscoder()],
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
