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

## Planned

- NASA/JPL-Caltech Horizons — spacecraft ephemerides (M2–M4)
- NASA SVS CGI Moon Kit — lunar textures (M2)
- USGS Astrogeology — Viking MDIM 2.1 and MOLA Mars textures (M3)

## Software

- [three.js](https://threejs.org) — MIT
- [astronomy-engine](https://github.com/cosinekitty/astronomy) — MIT
- [satellite.js](https://github.com/shashwatak/satellite-js) — MIT
- [zod](https://zod.dev) — MIT
