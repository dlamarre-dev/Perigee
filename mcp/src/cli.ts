#!/usr/bin/env node
/**
 * `npx perigee-mcp`: Perigee's MCP server over stdio for desktop AI assistants (Claude Desktop, Claude Code, any
 * MCP client). Reads Perigee's published data from https://perigee.info/ (PERIGEE_SITE overrides it) and keeps
 * each dataset version in a disk cache, so one version is downloaded once. Never contacts CelesTrak or Horizons.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngine } from '../../src/engine';
import { DiskCache, defaultCacheDir } from './diskCache';
import { createPerigeeServer } from './tools';

declare const __PERIGEE_MCP_VERSION__: string;

const VERSION = typeof __PERIGEE_MCP_VERSION__ === 'string' ? __PERIGEE_MCP_VERSION__ : '0.0.0';
const site = process.env['PERIGEE_SITE'] ?? 'https://perigee.info/';
const userAgent = `perigee-mcp/${VERSION} (+https://github.com/dlamarre-dev/Perigee)`;
const get = (url: string): Promise<Response> => fetch(url, { headers: { 'User-Agent': userAgent } });

const engine = createEngine({
  baseUrl: site.endsWith('/') ? site : `${site}/`,
  fetch: get,
  cache: new DiskCache(process.env['PERIGEE_MCP_CACHE'] ?? defaultCacheDir()),
});
const server = createPerigeeServer(engine, {
  version: VERSION,
  fetchImage: async (url) => {
    const res = await get(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  },
});
await server.connect(new StdioServerTransport());
