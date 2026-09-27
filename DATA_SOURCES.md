# Data sources and attribution

Perigee only uses public data. The browser never contacts upstream providers directly: data is mirrored by
GitHub Actions (from milestone M1) and served from the same origin as the site.

## In use (M0)

| Asset                     | Source                                                                                                                                                  | License       | Notes                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| Earth day texture         | NASA Earth Observatory — Blue Marble Next Generation, August 2004, topography + bathymetry ([record 73776](https://visibleearth.nasa.gov/images/73776)) | Public domain | 21600×10800 source; 2k/4k WebP + 2k/4k/8k KTX2 by `tools/textures/fetch-textures.ts` |
| Earth night texture       | NASA Earth Observatory — Black Marble 2016, 3 km ([record 144898](https://earthobservatory.nasa.gov/images/144898))                                     | Public domain | Same pipeline                                                                        |
| Sun position, time scales | [astronomy-engine](https://github.com/cosinekitty/astronomy) (Don Cross)                                                                                | MIT           | ΔT replaced by the IERS leap-second table since 1972                                 |
| Leap seconds              | [IERS Bulletin C](https://www.iers.org/IERS/EN/Publications/Bulletins/bulletins.html)                                                                   | Public        | Table in `src/astro/leapSeconds.ts`, checked 2026-09-26                              |

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

## In use (M4 — solar system view)

| Dataset                                            | Source                                                                                 | Refresh                    | Published as           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| Planet positions                                   | [astronomy-engine](https://github.com/cosinekitty/astronomy) (computed in the browser) | —                          | —                      |
| Planet radii and periods                           | [NASA planetary fact sheets](https://nssdc.gsfc.nasa.gov/planetary/factsheet/)         | curated                    | `src/astro/planets.ts` |
| Spacecraft state vectors (ICRF, heliocentric, TDB) | [NASA/JPL-Caltech Horizons](https://ssd.jpl.nasa.gov/horizons/), CENTER=500@10         | daily, 1 request per probe | `data/ephem/<id>.bin`  |
| Missions and statuses                              | Curated in `catalog/missions.json` (NASA, ESA, JAXA, CNSA, ISRO sources)               | reviewed by PR             | —                      |

The optional logarithmic distance scale is a visual aid only and is flagged as "not to scale" in the interface.

### Planet, dwarf-planet and ring textures

All maps are equirectangular, east longitude increasing to the right, prime meridian centred (the tool rolls
maps centred on 180°). Public-domain / NASA media first; attribution-only CC BY 4.0 maps where none exists (approved by the maintainer on 2026-09-27). Non-commercial or no-derivatives licences are never used.

| Body                                        | Source                                                                                                                                                                                                                                                                           | License / terms                                                                       | Notes                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Mercury                                     | [NASA Photojournal PIA16298](https://science.nasa.gov/photojournal/a-world-view/) — MESSENGER MDIS global mosaic (NASA/JHUAPL/Carnegie Institution of Washington)                                                                                                                | NASA media, not copyrighted                                                           | Greyscale                                                                                                          |
| Jupiter                                     | [NASA Photojournal PIA07782](https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map/) — Cassini ISS map, Dec 2000 (NASA/JPL/Space Science Institute)                                                                                                | NASA media, not copyrighted                                                           | System III, snapshot (clouds drift)                                                                                |
| Pluto                                       | [NASA Photojournal PIA20658](https://science.nasa.gov/photojournal/pluto-a-global-perspective/) — New Horizons LORRI (NASA/JHUAPL/SwRI)                                                                                                                                          | NASA media, not copyrighted                                                           | South of ~30°S unseen (black)                                                                                      |
| Ceres                                       | [USGS Astrogeology — Dawn FC global mosaic, 20 px/deg](https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_140m) (NASA/JPL-Caltech/UCLA/MPS/DLR/IDA)                                                                                                            | Public domain                                                                         | Kait = 0° longitudes; IAU 2015 rotation model                                                                      |
| Saturn rings                                | Voyager 2 ISS radial I/F profile ([PDS Rings Node VG_2810](https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2810/), Showalter & Gordon) and PPS δ Sco occultation optical depth ([VG_2801](https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/), Esposito et al.) | NASA PDS archive data                                                                 | Radii: [NASA Saturnian Rings Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html)         |
| Uranus rings                                | Radii, widths, optical depths from the [NASA Uranian Rings Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/uranringfact.html)                                                                                                                                        | Public domain                                                                         | Drawn slightly stronger than physical to stay visible                                                              |
| Sun                                         | **Procedural** photosphere (`src/render/SunMesh.ts`): quadratic limb darkening (Cox, _Allen's Astrophysical Quantities_, 2000), granulation noise                                                                                                                                | —                                                                                     | No sunspots (they change daily)                                                                                    |
| Venus (cloud tops), Saturn, Uranus, Neptune | [Solar System Scope](https://www.solarsystemscope.com/textures/) (INOVE), via the Wikimedia Commons mirrors                                                                                                                                                                      | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), resampled and recompressed | Artist's impressions based on NASA imagery (no public-domain global map exists); labelled as such in the interface |
| Eris, Haumea, Makemake                      | **Procedural** (`tools/textures/procedural.ts`): uniform colour from published albedo and spectra (NASA dwarf-planet pages)                                                                                                                                                      | —                                                                                     | Never imaged in detail; labelled as such                                                                           |

## In use (M3 — Mars view)

| Dataset                                                                      | Source                                                                                                                                                          | Refresh                     | Published as            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------- |
| Orbiters, Phobos (401), Deimos (402) state vectors (ICRF, Mars-centred, TDB) | [NASA/JPL-Caltech Horizons](https://ssd.jpl.nasa.gov/horizons/)                                                                                                 | daily, 1 request per object | `data/ephem/<id>.bin`   |
| Missions and statuses                                                        | Curated in `catalog/missions.json` (NASA, ESA, JAXA, UAE, CNSA sources)                                                                                         | reviewed by PR              | —                       |
| Landing sites, rover positions                                               | Curated in `catalog/landing-sites/mars.json` (NASA GISS Mars24, NSSDCA, HiRISE, ESA; rover positions from NASA MMGIS waypoint feeds, dated)                     | reviewed by PR              | —                       |
| Mars colour map                                                              | [USGS Astrogeology Viking MDIM2.1 colourised mosaic, 1 km/px](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m), public domain | offline                     | `public/textures/mars/` |
| Mars orientation                                                             | IAU WGCCRE model via astronomy-engine `RotationAxis`                                                                                                            | —                           | —                       |

Curiosity and Perseverance "last known" positions are snapshots (Sept 2026) and go stale; Mars 2/3/6 sites are
predicted, never located.

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

## Offline cache (M5)

The service worker (`public/sw.js`) caches same-origin files only (build assets, data files, textures) with the
Cache API; nothing from third parties (e.g. the optional SoundCloud player) is cached or intercepted.

## Software

- [three.js](https://threejs.org) — MIT
- [astronomy-engine](https://github.com/cosinekitty/astronomy) — MIT
- [satellite.js](https://github.com/shashwatak/satellite-js) — MIT
- [zod](https://zod.dev) — MIT
- [Basis Universal transcoder](https://github.com/BinomialLLC/basis_universal) (shipped with three.js, served at `basis/`) — Apache-2.0
- [Basis Universal `basisu` encoder](https://github.com/BinomialLLC/basis_universal) (WASI build, offline texture tool only) — Apache-2.0
- [Rajdhani](https://github.com/itfoundry/rajdhani) (Indian Type Foundry) — SIL Open Font License 1.1, bundled via @fontsource
- [Saira Semi Condensed](https://github.com/Omnibus-Type/Saira) (Omnibus-Type) — SIL Open Font License 1.1, bundled via @fontsource
