/**
 * Solar active regions (sunspot groups and plage) from NOAA SWPC, one request per run (daily).
 * Fetch, validate and reformat only: the client places and rotates them (src/astro/sunspots.ts).
 */
import { z } from 'zod';
import type { SunRegions } from '../src/data/schemas';
import { ProviderError, politeGet } from './http';

export const SWPC_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';

const SwpcRegionsSchema = z
  .array(
    z.object({
      observed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      region: z.number().int().positive(),
      latitude: z.number().min(-90).max(90),
      carrington_longitude: z.number().min(0).max(360),
      area: z.number().nonnegative().nullable(),
      number_spots: z.number().int().nonnegative().nullable(),
    }),
  )
  .min(1);

/** Keeps the fields the client uses, sorted by date then region. */
export function parseSwpcRegions(json: unknown, url = SWPC_REGIONS_URL): SunRegions {
  const parsed = SwpcRegionsSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError(`Unexpected regions feed: ${parsed.error.message}`, url, 200);
  return parsed.data
    .map((r) => ({
      region: r.region,
      date: r.observed_date,
      latDeg: r.latitude,
      carringtonLonDeg: r.carrington_longitude,
      areaMh: r.area,
      spots: r.number_spots,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.region - b.region);
}

export async function fetchSunRegions(): Promise<SunRegions> {
  const body = await politeGet(SWPC_REGIONS_URL, {
    accept: 'application/json',
    retryAfterNetworkErrorMs: 10 * 60_000,
  });
  return parseSwpcRegions(JSON.parse(body));
}
