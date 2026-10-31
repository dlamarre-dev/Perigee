import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runnerImport, type Plugin } from 'vite';
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

/**
 * Version shown in the About panel: the release (package.json, tagged `v<version>` in git) and the commit the site
 * was built from (short hash, commit date).
 */
function buildInfo(): { version: string; commit: string; date: string } {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  try {
    const [commit = 'dev', date = ''] = execFileSync('git', ['log', '-1', '--format=%h|%cI'], {
      encoding: 'utf8',
    })
      .trim()
      .split('|');
    return { version, commit, date };
  } catch {
    return { version, commit: 'dev', date: '' };
  }
}

const buildStamp = buildInfo();
const assets = assetVersions();

/** Date (YYYY-MM-DD) of the last commit touching these paths; the build commit's date without git history. */
function lastChange(...paths: string[]): string {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...paths], {
      encoding: 'utf8',
    }).trim();
    if (date) return date.slice(0, 10);
  } catch {
    // No git: fall through.
  }
  return buildStamp.date.slice(0, 10);
}

/**
 * Content hash of the static files that keep a fixed name (public/textures, models, shapes, images), appended as `?v=`
 * by src/render/assetUrl.ts so a re-encoded file is never served stale. Skipped under Vitest.
 */
function assetVersions(): Record<string, string> {
  if (process.env['VITEST']) return {};
  const versions: Record<string, string> = {};
  for (const dir of ['textures', 'models', 'shapes', 'images', 'landing']) {
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

/**
 * Machine documentation (src/engine/apiDocs.ts): api/catalog.json, images.json, glossary.json, interface.json and
 * llms-full.txt, generated from the catalogues at build time (served from memory by the dev server). Links point
 * to the public site (PERIGEE_SITE overrides it).
 */
function apiDocuments(): Plugin {
  const site = process.env['PERIGEE_SITE'] ?? 'https://perigee.info/';
  // Loaded through Vite's module runner (TypeScript and JSON imports), not bundled into this config.
  const documents = async (): Promise<Record<string, string>> => {
    const { module } = await runnerImport<typeof import('./src/engine/apiDocs')>('/src/engine/apiDocs.ts', {
      configFile: false,
      logLevel: 'error',
    });
    return module.buildApiDocuments(site, buildStamp, readFileSync(join('public', 'llms.txt'), 'utf8'));
  };
  const types: Record<string, string> = { json: 'application/json', txt: 'text/plain' };
  return {
    name: 'perigee-api-documents',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]?.slice(base.length);
        if (!path || !(path.startsWith('api/') || path === 'llms-full.txt')) return next();
        documents().then(
          (docs) => {
            const body = docs[path];
            if (!body) return next();
            res.setHeader(
              'Content-Type',
              `${types[path.split('.').pop() ?? ''] ?? 'text/plain'}; charset=utf-8`,
            );
            res.end(body);
          },
          (err: unknown) => next(err),
        );
      });
    },
    async generateBundle() {
      for (const [fileName, source] of Object.entries(await documents()))
        this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

/**
 * Landing pages (src/landing/, CLAUDE.md §7): landing.html is bundled like the app's page, then cloned for every
 * topic and language into <lang>/<slug>/index.html with its static content (src/landing/render.ts), with the two
 * guides' indexes and sitemap.xml; the dev server renders the same pages on request.
 */
function landingPages(): Plugin {
  const ctx = {
    site: process.env['PERIGEE_SITE'] ?? 'https://perigee.info/',
    base,
    version: buildStamp.version,
    assets,
    landingDate: lastChange('src/landing'),
  };
  const renderer = async (): Promise<typeof import('./src/landing/render')> =>
    (
      await runnerImport<typeof import('./src/landing/render')>('/src/landing/render.ts', {
        configFile: false,
        logLevel: 'error',
      })
    ).module;
  return {
    name: 'perigee-landing-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        const path = url.startsWith(base) ? url.slice(base.length) : '';
        if (!/^(en|fr)(\/|$)/.test(path)) return next();
        if (!path.endsWith('/') && !path.endsWith('.html')) {
          res.statusCode = 301;
          res.setHeader('Location', `${url}/`);
          res.end();
          return;
        }
        renderer()
          .then(async (m) => {
            // Vite transforms the template only, as the build does: run over the page, it would prefix the
            // base again to the URLs the renderer already wrote with it (images, icons).
            const template = await server.transformIndexHtml(url, readFileSync('landing.html', 'utf8'));
            const html = m.renderPath(template, path, ctx);
            if (!html) return next();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          })
          .catch((err: unknown) => next(err));
      });
    },
    async generateBundle(_options, bundle) {
      const template = bundle['landing.html'];
      if (template?.type !== 'asset') return;
      delete bundle['landing.html'];
      const m = await renderer();
      for (const [fileName, source] of m.renderAll(String(template.source), ctx))
        this.emitFile({ type: 'asset', fileName, source });
      const lastmod = buildStamp.date.slice(0, 10) || new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: m.renderSitemap(ctx, lastmod) });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __PERIGEE_BUILD__: JSON.stringify(buildStamp),
    __PERIGEE_ASSETS__: JSON.stringify(assets),
  },
  plugins: [basisTranscoder(), versionFile(), apiDocuments(), landingPages()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~500 kB minified; the whole app is one chunk until views are code-split (M2+).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { main: 'index.html', landing: 'landing.html' },
    },
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
