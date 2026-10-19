/**
 * Offline: countries and seas for the engine's ground points ("over France", "over the Indian Ocean"), from Natural
 * Earth 1:110m (public domain, https://www.naturalearthdata.com/): admin-0 countries and marine polygons, names in
 * English and French, coordinates rounded to 0.01°. Writes src/engine/regions.json (committed; the sources are not).
 *
 *   npx tsx tools/geo/fetch-regions.ts
 */
import { writeFile } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
const USER_AGENT = 'Perigee (+https://github.com/dlamarre-dev/Perigee)';

type Ring = [number, number][];
interface Feature {
  properties: Record<string, string | number | null>;
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
}

async function features(name: string): Promise<Feature[]> {
  const res = await fetch(`${BASE}${name}.geojson`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  return ((await res.json()) as { features: Feature[] }).features;
}

/** Polygons as flat [lon, lat, lon, lat…] rings in hundredths of a degree, outer ring first. */
function polygons(f: Feature): number[][][] {
  const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return list.map((rings) =>
    rings.map((ring) => ring.flatMap(([lon, lat]) => [Math.round(lon * 100), Math.round(lat * 100)])),
  );
}

const sentence = (s: string): string => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const text = (v: string | number | null | undefined): string => (typeof v === 'string' ? v : '');

const countries = (await features('ne_110m_admin_0_countries')).map((f) => ({
  iso: text(f.properties['ISO_A2_EH']) || text(f.properties['ISO_A2']),
  en: text(f.properties['NAME_EN']) || text(f.properties['NAME']),
  fr: text(f.properties['NAME_FR']) || text(f.properties['NAME']),
  polygons: polygons(f),
}));
const seas = (await features('ne_110m_geography_marine_polys')).map((f) => ({
  en: sentence(text(f.properties['name_en']) || text(f.properties['name'])),
  fr: text(f.properties['name_fr']) || text(f.properties['name']),
  polygons: polygons(f),
}));

const out = {
  source: 'Natural Earth 1:110m cultural (admin-0 countries) and physical (marine polygons) vectors, v5.1.2',
  url: 'https://www.naturalearthdata.com/',
  licence: 'public domain',
  note: 'Coordinates in hundredths of a degree: [lon, lat, lon, lat, …] rings, outer ring first. De facto boundaries as drawn by Natural Earth.',
  countries,
  seas,
};
await writeFile('src/engine/regions.json', `${JSON.stringify(out)}\n`);
console.log(`${countries.length} countries, ${seas.length} seas`);
