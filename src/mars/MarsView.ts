/** View C — Mars: orbiters, Phobos and Deimos from JPL Horizons, landing sites. */
import missionsJson from '../../catalog/missions.json';
import sitesJson from '../../catalog/landing-sites/mars.json';
import type { ViewFactory } from '../app/View';
import { Astronomy } from '../astro/astronomy';
import { MARS_RADIUS_KM, marsToSunKm } from '../astro/bodies';
import { DEG_TO_RAD } from '../astro/constants';
import { latLonToUnit } from '../astro/frames';
import { GM_KM3_S2 } from '../astro/kepler';
import { PlanetaryView } from '../bodies/PlanetaryView';
import { LandingSitesSchema, MissionsCatalogSchema } from '../data/schemas';

export const createMarsView: ViewFactory = (host) =>
  new PlanetaryView(host, {
    id: 'mars',
    centralBody: 'mars',
    body: Astronomy.Body.Mars,
    radiusKm: MARS_RADIUS_KM,
    muKm3S2: GM_KM3_S2.mars,
    texture: { name: 'color', placeholderRgb: [160, 90, 60] },
    ambient: 0.02,
    // Thin, dusty atmosphere: faint warm rim.
    atmosphere: { color: [0.9, 0.55, 0.35], strength: 0.25 },
    // 15° N, on the day side (longitude follows the Sun).
    homeDirectionBody: latLonToUnit(15 * DEG_TO_RAD, 0),
    homeFacesSun: true,
    homeDistanceKm: MARS_RADIUS_KM * 4.5,
    maxDistanceKm: 300_000,
    // Deimos orbits at ~23 500 km; Hope's apoapsis is ~43 000 km.
    farKm: 300_000,
    missions: MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'mars'),
    sites: LandingSitesSchema.parse(sitesJson),
    sunFromBodyKm: marsToSunKm,
    siteLabelDistanceKm: 9000,
    keys: {
      panel: 'mars.panel',
      loading: 'mars.loading',
      unavailable: 'mars.unavailable',
      sites: 'mars.sites',
      showSites: 'mars.showSites',
    },
  });
