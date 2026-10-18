/**
 * Bundles the MCP server (mcp/src/cli.ts) with the engine and the catalogues into mcp/dist/perigee-mcp.js; the
 * npm dependencies of mcp/package.json stay external. Run from the repository root: `npm run mcp:build`.
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('mcp/package.json', 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};

export default defineConfig({
  define: { __PERIGEE_MCP_VERSION__: JSON.stringify(pkg.version) },
  publicDir: false,
  build: {
    ssr: 'mcp/src/cli.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node20',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: (id) => Object.keys(pkg.dependencies).some((d) => id === d || id.startsWith(`${d}/`)),
      output: { entryFileNames: 'perigee-mcp.js', format: 'es' },
    },
  },
});
