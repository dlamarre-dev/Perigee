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

## Planned

- CelesTrak (T.S. Kelso) — GP/OMM elements and SATCAT, from 18th & 19th SDS via Space-Track (M1)
- NASA/JPL-Caltech Horizons — spacecraft ephemerides (M2–M4)
- NASA SVS CGI Moon Kit — lunar textures (M2)
- USGS Astrogeology — Viking MDIM 2.1 and MOLA Mars textures (M3)
- satellite.js (MIT) — SGP4/SDP4 (M1)

## Software

- [three.js](https://threejs.org) — MIT
- [astronomy-engine](https://github.com/cosinekitty/astronomy) — MIT
