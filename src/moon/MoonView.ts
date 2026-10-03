/** View B — Moon: lunar orbiters, landing/impact sites and the Earth at its true position. */
import missionsJson from '../../catalog/missions.json';
import sitesJson from '../../catalog/landing-sites/moon.json';
import type { ViewFactory } from '../app/View';
import { Astronomy } from '../astro/astronomy';
import { MOON_RADIUS_KM, moonToEarthKm, moonToSunKm } from '../astro/bodies';
import { DEG_TO_RAD } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { GM_KM3_S2 } from '../astro/kepler';
import { PlanetaryView } from '../bodies/PlanetaryView';
import { LandingSitesSchema, MissionsCatalogSchema } from '../data/schemas';

export const createMoonView: ViewFactory = (host) =>
  new PlanetaryView(host, {
    id: 'moon',
    centralBody: 'moon',
    body: Astronomy.Body.Moon,
    radiusKm: MOON_RADIUS_KM,
    muKm3S2: GM_KM3_S2.moon,
    texture: { name: 'color', placeholderRgb: [110, 110, 110] },
    ambient: 0.015,
    // Near side, slightly north, so the Earth-facing hemisphere and Apollo sites are in view.
    homeDirectionBody: latLonToUnit(15 * DEG_TO_RAD, 0),
    homeDistanceKm: MOON_RADIUS_KM * 4.2,
    maxDistanceKm: 600_000,
    // The Earth is up to ~406 000 km away.
    farKm: 600_000,
    // Earth aphelion + lunar distance + solar radius.
    sunMaxDistanceKm: 1.535e8,
    missions: MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'moon'),
    sites: LandingSitesSchema.parse(sitesJson),
    sunFromBodyKm: moonToSunKm,
    earthFromBodyKm: moonToEarthKm,
    siteLabelDistanceKm: 4500,
    keys: {
      panel: 'moon.panel',
      loading: 'moon.loading',
      unavailable: 'moon.unavailable',
      sites: 'moon.sites',
      showSites: 'moon.showSites',
    },
  });
