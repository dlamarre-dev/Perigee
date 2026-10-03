/**
 * URLs of the static files shipped in public/ (textures, models, shapes) carry `?v=<content hash>`, computed at
 * build time (vite.config.ts): a re-encoded file reaches visitors on their next load, and the service worker
 * caches these URLs as immutable, one version per file.
 */
export function assetUrl(baseUrl: string, path: string): string {
  const version = __PERIGEE_ASSETS__[path];
  return version ? `${baseUrl}${path}?v=${version}` : `${baseUrl}${path}`;
}
