import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const buildStamp = buildInfo();

/**
 * Content hash of the static files that keep a fixed name (public/textures, models, shapes), appended as `?v=`
 * by src/render/assetUrl.ts so a re-encoded file is never served stale. Skipped under Vitest.
 */
function assetVersions(): Record<string, string> {
  if (process.env['VITEST']) return {};
  const versions: Record<string, string> = {};
  for (const dir of ['textures', 'models', 'shapes']) {
    for (const entry of readdirSync(join('public', dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      const path = relative('public', file).replaceAll('\\', '/');
      versions[path] = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
    }
  }
  return versions;
}

/**
 * `version.json`: the commit of the build, polled by open tabs to learn that a new version was deployed
 * (src/app/updates.ts). Never cached by the service worker.
 */
function versionFile(): Plugin {
  return {
    name: 'perigee-version-file',
    apply: 'build',
    generateBundle() {
      const source = `${JSON.stringify({ commit: buildStamp.commit })}\n`;
      this.emitFile({ type: 'asset', fileName: 'version.json', source });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __PERIGEE_BUILD__: JSON.stringify(buildStamp),
    __PERIGEE_ASSETS__: JSON.stringify(assetVersions()),
  },
  plugins: [basisTranscoder(), versionFile()],
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
