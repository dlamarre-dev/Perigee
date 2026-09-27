# Data sources and attribution

Périgée only uses public data. The browser never contacts upstream providers directly: data is mirrored by
GitHub Actions (from milestone M1) and served from the same origin as the site.

## In use (M0)

| Asset                     | Source                                                                                                                                                  | License       | Notes                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| Earth day texture         | NASA Earth Observatory — Blue Marble Next Generation, August 2004, topography + bathymetry ([record 73776](https://visibleearth.nasa.gov/images/73776)) | Public domain | Resampled to 2k/4k WebP by `tools/textures/fetch-earth.ts` |
| Earth night texture       | NASA Earth Observatory — Black Marble 2016, 3 km ([record 144898](https://earthobservatory.nasa.gov/images/144898))                                     | Public domain | Same pipeline                                              |
| Sun position, time scales | [astronomy-engine](https://github.com/cosinekitty/astronomy) (Don Cross)                                                                                | MIT           | ΔT replaced by the IERS leap-second table since 1972       |
| Leap seconds              | [IERS Bulletin C](https://www.iers.org/IERS/EN/Publications/Bulletins/bulletins.html)                                                                   | Public        | Table in `src/astro/leapSeconds.ts`, checked 2026-09-26    |

## In use (M1 — Earth view)

| Dataset                                      | Source                                                                                                | Refresh                    | Published as                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| GP mean elements (OMM JSON), group `active`  | [CelesTrak](https://celestrak.org/NORAD/elements/) (T.S. Kelso), from 18th & 19th SDS via Space-Track | every 4 h, 1 request       | `data/earth/gp-active.json.gz` |
| SATCAT metadata, group `active`              | [CelesTrak SATCAT](https://celestrak.org/satcat/)                                                     | daily, 1 request           | `data/earth/satcat.json.gz`    |
| Group membership (operators, constellations) | CelesTrak GP groups listed in `catalog/operators.json`                                                | daily, 1 request per group | `data/earth/groups.json.gz`    |
| SATCAT owner codes                           | [CelesTrak SATCAT sources](https://celestrak.org/satcat/sources.php)                                  | curated                    | `catalog/operators.json`       |
| SGP4/SDP4                                    | [satellite.js](https://github.com/shashwatak/satellite-js)                                            | —                          | MIT                            |
| SGP4 verification cases (tests only)         | Vallado et al., AIAA 2006-6753, via [python-sgp4](https://github.com/brandon-rhodes/python-sgp4)      | —                          | `tests/fixtures/vallado/`      |

The pipeline (`pipeline/`) only fetches, validates (zod), reformats and compresses; it stops on any non-200
response and never overwrites published data with a file under 50 % of the previous one.

## Launch sites (Earth view)

`catalog/launch-sites.json`: 30 orbital spaceports with geodetic coordinates (mostly from Wikipedia articles, each entry
lists its sources) and their CelesTrak SATCAT `LAUNCH_SITE` codes (from https://celestrak.org/satcat/launchsites.php).
Sea and air launch areas (YSLA, SCSLA, SEAL, ERAS, WRAS) and Dombarovsky (unverified pad coordinates) are not placed.

## In use (M2 — Moon view)

| Dataset                                            | Source                                                                                                                                                                                                 | Refresh                      | Published as               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------- |
| Spacecraft state vectors (ICRF, Moon-centred, TDB) | [NASA/JPL-Caltech Horizons](https://ssd.jpl.nasa.gov/horizons/) — IDs resolved with `horizons_lookup.api`                                                                                              | daily, 1 request per mission | `data/ephem/<mission>.bin` |
| Missions, statuses, IDs                            | Curated in `catalog/missions.json`; every entry cites its sources (NASA, ISRO, KASA, CNSA, ESA…)                                                                                                       | reviewed by PR               | —                          |
| Landing and impact sites                           | Curated in `catalog/landing-sites/moon.json`, mostly from [LROC](https://lroc.im-ldi.com) and [NASA NSSDCA](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html); each entry cites its source | reviewed by PR               | —                          |
| Moon colour map                                    | [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LROC WAC mosaic), public domain                                                                                                               | offline                      | `public/textures/moon/`    |
| Lunar orientation                                  | IAU WGCCRE model via astronomy-engine `RotationAxis`                                                                                                                                                   | —                            | —                          |

Missions with no public ephemeris (e.g. Queqiao-2) are listed but not drawn in 3D. Some site dates and the
coordinates of Luna 9/13 are of lower confidence; see the `note` field of each entry.

## Planned

- USGS Astrogeology — Viking MDIM 2.1 and MOLA Mars textures (M3)

## Software

- [three.js](https://threejs.org) — MIT
- [astronomy-engine](https://github.com/cosinekitty/astronomy) — MIT
- [satellite.js](https://github.com/shashwatak/satellite-js) — MIT
- [zod](https://zod.dev) — MIT
