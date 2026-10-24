/**
 * Bundles the MCP server (mcp/src/cli.ts) with the engine, the catalogues and its npm dependencies into
 * mcp/dist/perigee-mcp.js, so the published package has no dependencies to install: only the SDK parts the stdio
 * server uses ship (not its HTTP transports, express, hono or cross-spawn). Run from the repository root:
 * `npm run mcp:build`. A dependency fix reaches users with the next perigee-mcp release.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('mcp/package.json', 'utf8')) as { version: string };

/** Package root (the directory holding its package.json with a name) of a bundled module under node_modules. */
function packageRoot(id: string): string | undefined {
  for (let dir = dirname(id); dir.includes('node_modules'); dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name) return dir;
  }
  return undefined;
}

/** dist/THIRD_PARTY_LICENSES.md: the licence text of every npm package inlined in the bundle (MIT asks for it). */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle() {
      const roots = new Set<string>();
      for (const id of this.getModuleIds()) {
        const root = id.includes('node_modules')
          ? packageRoot(id.replace(/^\0/, '').split('?')[0] ?? '')
          : undefined;
        if (root) roots.add(root);
      }
      const sections = [...roots]
        .map((root) => {
          const meta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
            name: string;
            version: string;
            license?: string;
            main?: string;
          };
          const file = readdirSync(root).find((f) => /^(licen[cs]e|copying)/i.test(f));
          // Without a licence file (astronomy-engine), the notice heading the package's main file.
          const header = file
            ? undefined
            : /^\/\*\*([\s\S]*?License[\s\S]*?)\*\//.exec(
                readFileSync(join(root, meta.main ?? 'index.js'), 'utf8'),
              )?.[1];
          const text = file
            ? readFileSync(join(root, file), 'utf8').trim()
            : header
                ?.replace(/^\s*@preserve\s*$/m, '')
                .replace(/^ {4}/gm, '')
                .trim();
          if (!text) throw new Error(`${meta.name}: no licence text to ship with the bundle`);
          return `## ${meta.name} ${meta.version} (${meta.license ?? 'see text'})\n\n\`\`\`\n${text}\n\`\`\``;
        })
        .sort();
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.md',
        source: `# Third-party licences\n\nperigee-mcp.js bundles these npm packages.\n\n${sections.join('\n\n')}\n`,
      });
    },
  };
}

export default defineConfig({
  define: { __PERIGEE_MCP_VERSION__: JSON.stringify(pkg.version) },
  publicDir: false,
  plugins: [thirdPartyLicenses()],
  resolve: {
    alias: [
      {
        // The SDK server's default JSON Schema validator (ajv, elicitation only): see noJsonSchemaValidator.ts.
        find: /^\.\.\/validation\/ajv-provider\.js$/,
        replacement: fileURLToPath(new URL('src/noJsonSchemaValidator.ts', import.meta.url)),
      },
    ],
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'mcp/src/cli.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node20',
    sourcemap: false,
    // Minified: the catalogues and region outlines would otherwise be pretty-printed object literals (~1.3 MB).
    minify: true,
    rollupOptions: {
      external: (id) => id.startsWith('node:'),
      output: { entryFileNames: 'perigee-mcp.js', format: 'es' },
    },
  },
});
