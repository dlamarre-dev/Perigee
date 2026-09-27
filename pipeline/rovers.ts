/**
 * Mars rover positions from NASA's MMGIS "current waypoint" GeoJSON feeds (one request per rover per run).
 * Fetch, validate and reformat only.
 */
import { z } from 'zod';
import type { LandingSites, RoverPositions } from '../src/data/schemas';
import { ProviderError, politeGet } from './http';

const WaypointFeedSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        properties: z.object({
          sol: z.number().int().nonnegative(),
          lon: z.number().min(-180).max(360),
          lat: z.number().min(-90).max(90),
          dist_total_m: z.number().nonnegative().optional(),
        }),
      }),
    )
    .min(1),
});

/** Parses a waypoint feed; the last feature is the latest position. Longitudes normalised to [-180, 180]. */
export function parseWaypointFeed(json: unknown, url: string): RoverPositions[string] {
  const parsed = WaypointFeedSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError(`Unexpected waypoint feed: ${parsed.error.message}`, url, 200);
  const latest = parsed.data.features[parsed.data.features.length - 1];
  if (!latest) throw new ProviderError('Empty waypoint feed', url, 200);
  const p = latest.properties;
  const lonDeg = p.lon > 180 ? p.lon - 360 : p.lon;
  return {
    latDeg: p.lat,
    lonDeg,
    sol: p.sol,
    ...(p.dist_total_m === undefined ? {} : { distanceTotalM: p.dist_total_m }),
    source: url,
  };
}

export async function fetchRoverPositions(catalogues: readonly LandingSites[]): Promise<RoverPositions> {
  const out: RoverPositions = {};
  for (const catalogue of catalogues) {
    for (const site of catalogue.sites) {
      if (!site.feed) continue;
      const url = site.feed.url;
      const body = await politeGet(url, {
        accept: 'application/json',
        retryAfterNetworkErrorMs: 10 * 60_000,
      });
      out[site.id] = parseWaypointFeed(JSON.parse(body), url);
    }
  }
  return out;
}
