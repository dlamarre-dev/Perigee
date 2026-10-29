# CLAUDE.md — Périgée (working name)

Open-source, real-time web viewer of artificial objects orbiting the Earth, the Moon, Mars and the
solar system. Hosted on GitHub Pages. **All position computations happen in the browser.**

---

## 0. Language

- All code, comments, commit messages and documentation are written in **English**.
- The website is bilingual **EN + FR**. Every user-facing string lives in `src/i18n/` — never hardcode UI text.
  Initial language: `?lang=` URL parameter, otherwise `navigator.language` (`fr*` → FR, else EN); switchable in the UI.

## 1. Product vision

Four views, each centred on a body, with free navigation (quaternions) around the central point:

| View | Central body | Displayed objects | Main source |
|------|--------------|-------------------|-------------|
| A — Earth | Earth (rotating Earth frame) | All active catalogued satellites (~15k+) | CelesTrak GP (OMM) + SATCAT |
| B — Moon | Moon (rotating lunar frame) | Active lunar orbiters + landing/impact sites | JPL Horizons + curated catalog |
| C — Mars | Mars (rotating Martian frame) | Active Mars orbiters + Phobos/Deimos + landing sites | JPL Horizons + curated catalog |
| D — Solar system | Sun (barycentre) | Planets + active interplanetary probes | astronomy-engine + JPL Horizons |

Cross-cutting features:
- Every object is clickable → panel: name, identifier (NORAD / COSPAR / Horizons ID), operator, country,
  launch date, status, orbit (altitude, period, inclination), data age.
- Filters by organisation / country / constellation / orbit type (LEO, MEO, GEO, HEO), mostly in view A.
- Time control: real time by default, acceleration (×1 to ×10,000), pause, jump to a date.
- Dates and times are shown in the computer's time zone (daylight saving included) by default; the zone name in
  the time bar opens a list of zones (UTC and every IANA zone, remembered per browser). Everything internal, the URL
  included, stays UTC (`src/i18n/timeZone.ts`, `I18n.dateTime`). Calendar dates (launch, verified) are not converted.
- Freshness indicator: every object knows whether its position is *propagated from recent elements*,
  *interpolated from ephemerides*, or *extrapolated/modelled* (shown visually).

## 2. Non-negotiable principles

1. **Client-side computation.** The data pipeline (GitHub Actions) only *fetches, validates, reformats and
   compresses* raw data. It never computes a position. SGP4, interpolation, frame changes, planetary rotations:
   everything happens in the browser — or, for the machine interfaces, on their host: the MCP server (`mcp/`) on
   the user's machine and its hosted endpoint (`workers/mcp/`, Cloudflare Workers), with the same code and the same
   published data, never contacting the providers.
2. **Public data only**, with visible attribution (see §9).
3. **Respect the providers.** The user's browser **never** contacts CelesTrak or Horizons directly. See §4 for why.
   The only third-party request the app makes on its own is the "Report" form (`src/ui/ReportDialog.ts`), sent to
   Web3Forms (which e-mails the maintainer) only when the visitor submits it, plus the GoatCounter page-view counter
   (`index.html`, `perigeeinfo.goatcounter.com`: cookie-less, privacy-friendly analytics).
   Both are named in the About dialog and described, with what stays in browser storage and SoundCloud's
   music player (loaded only when its panel opens), in the static privacy pages `public/privacy.html` (EN) and
   `public/confidentialite.html` (FR), with the MCP server and its hosted endpoint: update them whenever the site
   starts sending or storing something new.
4. **No mission list hardcoded in the code.** Missions, their IDs and statuses live in `catalog/*.json`,
   versioned and changed through PRs — by the maintainer or by the weekly maintenance agent, whose PRs
   auto-merge only when CI (including `catalog-guard`) passes (§8).
5. **Visual honesty.** An object whose position is extrapolated beyond its validity window is drawn differently
   (opacity, dashed outline) and the panel says so.

## 3. Tech stack

- **Strict TypeScript** + **Vite** (static build for GitHub Pages).
- **Three.js** (WebGL2). No CesiumJS (too heavy, imposed frame, unsuited to Moon/Mars/solar-system views).
- **satellite.js ≥ 6** for SGP4/SDP4 — use `json2satrec(omm)` (OMM format), **never** `twoline2satrec`
  for new data.
- **astronomy-engine** (Don Cross, MIT) for: planetary positions, the Moon, sidereal time, IAU rotation axes
  (`RotationAxis`) of the Moon, Mars and the planets.
- **Web Workers** for bulk SGP4 propagation; results transferred as `Float32Array` (transferable).
  Vite builds workers as ES modules (`worker.format: 'es'`): satellite.js 7 re-exports a WASM build that uses
  top-level `await`.
- Tests: **Vitest** (unit, reference values), **Playwright** (render smoke tests).
- Lint/format: ESLint + Prettier. No heavy UI framework; UI in native TS/DOM, or Lit if needed.

## 4. Data sources and known constraints

### 4.1 CelesTrak — orbital elements (view A)
- Endpoint: `https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON` (OMM JSON).
  Groups useful for filters: `starlink`, `oneweb`, `kuiper`, `qianfan`, `hulianwang`, `gps-ops`, `galileo`,
  `glo-ops` (not `glonass-ops`), `beidou`, `stations`, `weather`, etc. The authoritative list is the index page
  `https://celestrak.org/NORAD/elements/`; the groups actually fetched are the keys of `catalog/operators.json`.
- **Strict usage policy**: data updated every ~2 h; a single fetch per update cycle, enforced since March 2026
  on the `active` and `starlink` groups. Exceeding it → IP block (often without a clear HTTP code). Any M2M code
  must **stop immediately** on any non-200 response and report.
  → This is why browsers must never call CelesTrak: thousands of users = block.
- **6-digit catalog numbers**: 5-digit numbers ran out on 2026-07-11. New objects (100000+) **do not exist in
  TLE format**. Consequences:
  - OMM format (JSON/CSV) mandatory everywhere.
  - `NORAD_CAT_ID` is an integer; never format/pad it to 5 characters nor parse it with fixed columns.
  - The legacy text SATCAT is truncated; use the CSV/JSON SATCAT.
- Always use `celestrak.org` (not `.com`, which 301-redirects).
- **Supplemental GP (SupGP)**: `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=<set>&FORMAT=JSON`,
  SGP4 fits by CelesTrak to operator ephemerides (SpaceX, SES, Intelsat, NASA ISS, CMS CSS, GPS almanac, GLONASS…),
  ~10× more accurate than GP and usually < 1 day old (GPS fits are dated a few days ahead). Same OMM JSON plus
  `RMS` (unit undocumented, not shown) and `DATA_SOURCE`. The sets used are the keys of `catalog/operators.json`
  `supplemental` (deliberate exclusions in `ignoredSupplemental`; the weekly audit flags new sets). The `gp` run
  fetches them after `active` (one request per set) and merges them (`pipeline/supgp.ts`): an object of the
  `active` group takes the freshest SupGP fit dated within [−3 d, +7 d] of the run and not older than its GP
  elements, keeping its GP name, with `SOURCE: <set>`; SupGP-only objects are not added. The info panel says
  where the elements come from. Galileo has no SupGP set, and new satellites appear in a set only once
  operational.

### 4.2 CelesTrak SATCAT — metadata (info panel, filters)
- `https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=JSON` (same set as the GP `active` group).
  `records.php` requires a search field (`GROUP`, `CATNR`, `INTDES`, `NAME`…): `ACTIVE=true` alone is rejected.
  `/pub/satcat.csv` answered HTTP 406 to the pipeline on 2026-09-26 — do not use it.
- CelesTrak may refuse some datacenter IP ranges; if the GitHub Actions runs fail systematically, check this
  first and report it rather than retrying.
- Useful fields: `OBJECT_NAME`, `OBJECT_ID` (COSPAR), `NORAD_CAT_ID`, `OBJECT_TYPE`, `OPS_STATUS_CODE`,
  `OWNER`, `LAUNCH_DATE`, `LAUNCH_SITE`, `PERIOD`, `INCLINATION`, `APOGEE`, `PERIGEE`, `RCS`.
- `OWNER` is mostly a country/organisation code (US, PRC, CIS, ESA, ISS, JPN, IND…), not a commercial operator.
  For "SpaceX", "OneWeb", "Planet", etc., derive membership from **CelesTrak groups** (an object in `starlink`
  → operator SpaceX). Mapping table in `catalog/operators.json` (SATCAT code → EN/FR label, agency, flag;
  group → operator).
- Refresh: daily is enough.

### 4.3 JPL Horizons — ephemerides (views B, C, D)
- API: `https://ssd.jpl.nasa.gov/api/horizons.api`; ID lookup: `horizons_lookup.api?sstr=...`.
- **No CORS headers** → unusable from the browser. Fetched by the pipeline only.
- Typical request: `EPHEM_TYPE=VECTORS`, `CENTER=500@301` (Moon) / `500@499` (Mars) / `500@10` (Sun centre, heliocentric — chosen over the barycentre `500@0` so probes share the frame of astronomy-engine `HelioVector` planets and two-body extrapolation around the Sun is physical),
  `REF_SYSTEM=ICRF`, `REF_PLANE=FRAME` (J2000 equator), `OUT_UNITS=KM-S`, `CSV_FORMAT=YES`, `VEC_TABLE=2`.
- Output times in **TDB** (JD). TDB↔UTC conversion on the client (astronomy-engine handles ΔT).
- Sampling step according to dynamics:
  - Low lunar/Martian orbiters (period ~2 h): 2 min step, window −1 d / +3 d.
  - Highly elliptical orbiters (Queqiao-2, TGO high orbit, Hope): 10 min step.
  - Heliocentric probes: 1 d step (6 h for Parker Solar Probe near perihelion), window −60 d / +365 d. When the
    public ephemeris ends inside the window, the window is truncated (not shifted) so "now" stays covered.
  - **30 days of past** for windows reaching back less than that (no extra request): each daily run keeps the rows
    leaving the window in `data/ephem/past/<id>.bin` (`mergePast` in `pipeline/publish.ts`, oldest source first, a
    later source owning its own span; rows older than 30 days dropped; manifest entry field `past`). Archived rows
    are what Horizons published then (not reconstructed later). A one-time `horizons --bootstrap-past` (manual
    dispatch of `data-horizons.yml`, one extra request per mission) fills the 30 days at once.
- **Always resolve IDs through `horizons_lookup.api`**, never guess them. Record them in `catalog/missions.json`
  with the verification date.
- Some missions have no public ephemerides (e.g. Tianwen-1, sometimes Queqiao-2) → see §5.3.

### 4.4 Curated catalog (in the repo)
No single API provides "active probes + landing sites". We maintain:
- `catalog/missions.json`: missions beyond Earth orbit (internal id, EN/FR name, agency, country, launch date,
  Horizons ID, NORAD if any, central body, status, `ephemeris: horizons|kepler|none`, `goals` (main objectives,
  2–3 sentences for students, shown before the `notes` on the current state), `website` (main official page,
  listed first among the links; `lang` only when neither English nor French, shown as "(zh)"),
  `verified: YYYY-MM-DD`, `sources: [url]`). The panels list `ended`/`inactive` spacecraft apart, after the active ones
  ("Inactive spacecraft" in the solar view, "Inactive missions" in the Moon and Mars views; `isInactiveMission` in
  `src/data/schemas.ts`, catalogue order, chronological for the retired probes; `llms-full.txt` splits them the same
  way). Each section has its own show all / hide all buttons; inactive ones are hidden (unchecked) by default, and
  selecting one draws it again. The URL keeps departures from that default only: `hide=` (active ones hidden),
  `show=` (inactive ones drawn) (`src/app/hiddenMissions.ts`, also read by `perigee_describe_view`). Retired probes get Horizons vectors only while Horizons publishes a predicted trajectory covering the present
  (otherwise clamping would re-request the same past daily); famous ones without it are listed with `ephemeris: "none"`.
- `catalog/earth-science.json`: the featured "space & Earth science" satellites of the Earth view (CelesTrak
  `science` group + the ISS): known name EN/FR, agency, country, status, purpose, `goals`, notes, `website`,
  `verified`, `sources`.
  Shown first in the filters, with curated names in the list and the info panel; re-verified monthly like the
  missions; the audit flags new members of the CelesTrak group.
- `catalog/landing-sites/moon.json`, `catalog/landing-sites/mars.json`, `mercury.json`, `venus.json`, `titan.json`: planetocentric
  lat/lon (east-positive, −180…180: Titan's west longitudes converted), date, mission, type
  (`soft|hard|impact|crewed|rover-last-known`), source; `site:<id>` is one namespace across the files. Mercury, Venus
  and Titan sites live in the solar view (`src/solar/SurfaceSites.ts`): the selected body's detail panel lists them
  behind a checkbox (URL `sites=1`, markers on its surface) and describes a picked site (marker or list) in a
  second tab, with its image, while the camera stays on the body (`sel=site:<id>`; picked from the list, the
  follow turns to look down on it; the checkbox names a single site's kind). Mercury and Venus on their IAU frames, Titan on the tidal frame (`tidalOrientationEqj`,
  longitude 0 towards Saturn). Venera 3 (no published impact point), Venera 4–6 and the Pioneer Venus bus
  (destroyed in the atmosphere), Magellan, Pioneer Venus Orbiter and Venus Express (no location) are left out; MESSENGER is NASA's
  prediction 24 h before impact (crater not imaged yet).
- Every entry must cite at least one source (NASA, ESA, JAXA, CNSA, ISRO, KARI, LROC, Wikipedia as last resort).
- Every catalog text shown to visitors (names, notes, orbits, purposes…) is a `{ en, fr }` object, enforced by the
  zod schemas: a plain string fails validation, so updates cannot add English-only text.
- `catalog/stars.json`: well-known stars named on the sky of the solar view (EN/FR name, Bayer designation,
  constellation, ICRS J2000 position, V magnitude and spectral type from SIMBAD; distance, radius, mass,
  temperature and luminosity of the main star from the cited literature; student-level notes): the bright stars
  (magnitude ≤ 2.5: all 93 of Wikipedia's List of brightest stars) and every system within 20 light-years whose primary is magnitude 12 or brighter (Wikipedia's
  List of nearest stars, added 2026-10-21), two groups in `src/astro/stars.ts` (`isBrightStar`, `isNearbyStar`;
  every entry must be in one). Notes say where a star can be seen by latitude, hemisphere or continent, never by
  country (visitors are international); papers without a DOI or arXiv entry are cited on SciX
  (`https://scixplorer.org/abs/<bibcode>/abstract`; ADS links move there from 2026-11-16). Off by default (panel checkboxes "Identify the bright stars", URL `stars=1`, and
  "Identify the stars within 20 light-years", URL `nearby=1`, listed nearest first): no marker, a leader line from the star to its label
  (`LabelLayer` `leaderPx`); selectable (`sel=star:<id>`, not followable), the camera turns towards it
  (`ViewHost.aimAt`). Hidden behind the Sun and the bodies like the other labels. The info panel shows an
  illustration (`src/render/starImage.ts`, labelled "not a photograph": black-body colour of the effective
  temperature, limb darkening, convection cells sized to the star, the Sun at the same scale); few stars were
  ever resolved, so none uses a real image. Clicking it opens a 3D map (`src/ui/StarMap.ts`, About's frame, loaded
  on demand, its own WebGL renderer only while open): every catalogue star at its distance around the Sun (light-
  years, to scale; dots not to scale), the star and the Sun named in the accent colour and joined by a dashed line
  with their distance; a stalk map for depth: rings of the galactic plane around the Sun and a stalk from each star
  to its foot on that plane (faint, except the followed and the clicked star's), galactic north up at the opening;
  a click picks one other star (named, with its own dashed line and distance to the Sun); an axis gizmo at the top
  right (`src/ui/viewGizmo.ts`) looks along the six galactic axes and switches perspective/orthographic;
  QuaternionOrbitControls around the Sun, double-click a star to centre on it (keys typed in a dialog drive only
  the controls inside it). The solar view mirrors it in the URL (`map=1` with `sel=star:<id>`, `pick=star:<id>`
  for the compared star), so links open it; with `embed=1` it fills the frame alone (a link to the full app
  instead of Close, Escape ignored). `perigee_view` builds such links (`star_map`, `compare`) and
  `perigee_describe_view` puts them into words.
- `catalog/comets.json`: comets of the solar view, a curated list (famous ones and the current telescope targets):
  EN/FR name, designation, `horizonsId` `DES=<designation>;CAP;NOFRAG` (the current apparition's orbit solution),
  sampling, kind, discovery, nucleus size, student notes, sources. The daily `horizons` run fetches their
  heliocentric vectors (like the probes, with the coverage clamping; `OBJ_DATA=YES` for the magnitude law M1/k1 and
  radius, `parseCometPhysical`) into `data/ephem/comets/<id>.bin`, manifest top-level `comets` (an extra field;
  failures only warn). The weekly audit flags comets without recent vectors and suggests candidates from one JPL
  SBDB query (perihelion within 120 days, q < 1.5 au or M1 < 10 with q < 2.5 au; the pipeline never computes a
  position, so it cannot rank by current brightness). COBS (cobs.si) was considered and left out: its data are
  CC BY-NC-SA 4.0. The solar panel has a "Show the comets" box (URL `comets=1`, off by default) and a list sorted
  by estimated magnitude (m = M1 + 5 log Δ + 2.5 k1 log r, labelled as an estimate); a comet is selectable
  (`sel=comet:<id>`, followable) and drawn even with the box unticked. The view interpolates its vectors
  (`EphemerisTrack`), draws its osculating conic (`conicOffsetsAround` in `src/astro/comets.ts`: true-anomaly
  steps, open orbits cut at 60 au) and two illustrative tails (`src/render/CometTail.ts`: ion tail away from the
  Sun, dust tail lagging behind the motion; length from r and M1, true scale only, labelled). The panel gives the
  osculating q, e, ecliptic inclination, period and perihelia (`perihelionPassages`, two-body, years 1000–9999
  only) and a photo from `catalog/images.json` (`comet:<id>` targets) when one is freely licensed.
- `catalog/asteroids.json`: notable asteroids of the solar view, from Wikipedia's "List of exceptional asteroids":
  the largest (over 250 km; Ceres stays a dwarf planet of `missions.json`) and the spacecraft targets. EN/FR name,
  designation, `horizonsId` `<number>;`, group (main belt, Mars-crosser, near-Earth, Jupiter trojan), spectral type,
  diameter and measured dimensions, rotation, discovery, moons, spacecraft visits (`missionId` links
  `missions.json`), student notes, sources. Fetched by the same `horizons` run as the comets (`OBJ_DATA=YES` for H and
  G), but only when their file is a week old or its window ends within 300 days (`slowBodyDue`, `pipeline/refresh.ts`):
  `data/ephem/asteroids/<id>.bin`, manifest top-level `asteroids`; the audit flags them after 10 days
  (`asteroid-ephemeris-stale`). Shown like the comets (`SmallBodyObject` in `SolarView`: box "Show the notable
  asteroids", URL `asteroids=1`, list sorted by size, `sel=asteroid:<id>`, osculating orbits, no tail); the panel
  gives group, size, rotation, visits, osculating a/q/e/i/period and the H–G magnitude (`asteroidMagnitude`). Four
  have a NASA shape model (Vesta, Bennu, Eros, Itokawa: `asteroid:` model targets, shown in the panel and in place of
  the marker when close, turning about z at the catalogued period, orientation illustrative); 20 others an image
  (ESO VLT/SPHERE for the large ones, spacecraft views for the visited ones).
- Dwarf planets in `catalog/missions.json` (natural objects around the Sun, Horizons vectors refreshed **weekly**
  by `slowBodyDue`, like the asteroids; spacecraft stay daily): `dwarfStatus` `iau` (Ceres, Haumea, Makemake, Eris,
  listed with the planets) or `candidate`, with `sizeMethod` (spacecraft, occultation, thermal, brightness),
  `diameterRangeKm` for an uncertain size, `discovered`/`discoverer` and `moons` (named in the panel, not drawn; placing
  them in 3D is a later study). Candidates (added 2026-10-28; the planetologists' usual set plus Rubin's first): Gonggong
  (225088), Quaoar (50000), Orcus (90482), Sedna (90377) and 2026 ED138 (`DES=2026 ED138;`, unnumbered, 600–1500 km
  from its brightness, announced 2026-10-27), behind the solar panel's box "Show the dwarf planet candidates" (URL
  `candidates=1`, off by default; a selected one is drawn anyway). Procedural uniform maps (`texture.uniform`;
  ED138's colour is unmeasured, `texture.unknown`); a body with a uniform map shows its telescope image (image kind
  `telescope`: Hubble, Rubin, ESO VLT) instead of its sphere in the panel. API docs kinds `dwarf-planet` and
  `dwarf-planet-candidate`; glossary term `dwarfPlanet`.
- Optional: enrichment via Wikidata SPARQL (CORS-enabled) for descriptions/links, never for positions.

### 4.5 Body textures and models
- Earth: NASA Blue Marble (public domain) + optional night mask (Black Marble).
- Moon: NASA SVS **CGI Moon Kit** (svs.gsfc.nasa.gov/4720) — LROC colour + LOLA displacement.
- Mars: USGS Astrogeology **colourised Viking MDIM 2.1** + MOLA for relief.
- Planets (view D): NASA Photojournal / USGS public-domain maps (Mercury, Jupiter, Pluto, Ceres); Solar System
  Scope maps (CC BY 4.0, artist's impressions, labelled) for Venus cloud tops, Saturn and Neptune; an illustrative
  procedural Uranus (Voyager hue, Hubble/JWST bands and polar cap, labelled);
  procedural uniform maps for unresolved dwarf planets and moons never mapped globally. Map variants
  (`src/render/mapVariants.ts`): Titan in visible light (procedural haze, default) or near infrared (Cassini ISS
  mosaic), Venus's cloud tops or its Magellan radar surface (Solar System Scope, CC BY 4.0); a button under the info
  panel's preview switches them, cross-fading the preview and the 3D view (`BodyMesh.setAltVariant`; session only). Moons: USGS global mosaics, P. Stooke's PDS maps (Amalthea and
  Hyperion hand-drawn, labelled). Saturn's rings from Voyager PDS profiles (brightness + optical depth), Uranus' and Neptune's from the NASA
  fact sheets (strengthened to stay visible; Neptune's Adams arcs left out) (`tools/textures/rings.ts`, `src/render/RingMesh.ts`).
- **Offline** pre-processing (`tools/textures/` script): resample to 2k/4k/8k, KTX2 (Basis) compression,
  progressive loading by zoom level. Source textures are not committed; only compressed derivatives are
  (committed directly, no Git LFS: LFS bandwidth would be spent on every Pages deploy; keep each file well under GitHub's 100 MB limit — the UASTC 8k maps are 7–29 MB, approved 2026-09-27; re-encode only when a source changes, since every version stays in history). Levels per body are declared once in `src/render/textureLevels.ts` (read by the tool and
  the client). KTX2 (Basis ETC1S, sRGB, mipmaps, Y-flipped since compressed textures ignore `flipY`) is preferred,
  WebP is the fallback; the Basis transcoder is copied from three.js by a Vite plugin. Encoding uses the official
  `basisu` CLI in its WASI build, run by Node (`tools/textures/basisu.ts`, pinned commit); the browser WASM
  wrappers cap images at ~12 Mpixel. 8k levels (Earth day/night, Moon, Mars) are KTX2-only and load on demand
  when the camera is within one radius of the surface (`BodyMesh.requestDetail()` / `ProgressiveTexture`), on the
  high quality tier only (§7).
- Ellipsoids where the flattening shows (`radiiKm`: `src/astro/planets.ts` for the giants, NASA fact sheets
  1-bar radii; `catalog/` for Ceres (Dawn), Haumea (2017 occultation) and Mimas (Thomas 2010)): the BodyMesh
  sphere is scaled along its body axes (x prime meridian or towards the planet, z pole), normals from the
  ellipsoid; the mean radius still sets framing and sizes, the largest semi-axis the camera obstacle. Haumea
  spins about its ring pole (`haumeaOrientationEqj`) with an unpublished, illustrative rotation phase. Not for
  the Earth or Mars (≤ 0.6 %, and the surface code assumes a sphere).
- Irregular moons (Amalthea, Proteus, Hyperion, Phoebe): PDS shape models resampled to radius grids
  (`tools/shapes/fetch-shapes.ts` → `public/shapes/<id>.json`, `moons.json` `shape: "grid"`), displacing the body
  sphere (`src/render/shapeGeometry.ts`); UVs unchanged, so the equirectangular maps still apply.
- 3D models (`catalog/models.json`, targets `mission:`/`moon:`/`site:`/`norad:`): NASA 3D Resources GLBs processed by
  `tools/models/fetch-models.ts` (simplified, WebP textures ≤ 1024 px, meshopt, metres; NASA insignia and JPL logo
  decals covered, ISS stray parts dropped) → `public/models/<id>.glb`. The selected object's model replaces its
  marker once it covers ≥ 4 px (`src/render/models.ts` `SceneModel`, PBR lit by the Sun and a dim room environment;
  illustrative attitude from `src/astro/attitude.ts`), and a preview spins at the top of the info panel
  (`src/ui/ModelPreview.ts`; dragging turns it, except in the phone layout, where a drag scrolls the sheet). The same preview shows a selected celestial body as drawn in the view (its
  BodyMesh: map, flattening, moving gas, rings, shape grid; planets, moons, dwarf planets, and the Moon of the
  Earth view, selectable with `sel=moon`), and the Sun and the named stars as 2D illustrations. Following such an object lets the camera come to twice its size. Phobos and Deimos
  (`body` entries) replace the BodyMesh sphere, aligned offline on Thomas's PDS grids. Entries with `high` (the
  ISS) also get a full-quality variant (`--high`: every part, no simplification beyond 1e-3 of the extent, KTX2
  textures) loaded only on the high quality tier and large screens while the model covers ≥ `minPx` (a Pixel 10
  flickered with its 2 M triangles and ~215 MB of textures), and released (GPU memory freed) when it
  shrinks; the light model stays for the panel preview. Objects without a model (probes, landing/impact and launch sites, science satellites) may
  show one image instead (`catalog/images.json`, targets `mission:`/`site:`/`launch:`/`norad:`; kind, credit,
  licence, source page): Wikimedia Commons, NASA Image Library, LROC; public domain, CC0, CC BY, CC BY-SA (3.0,
  3.0 IGO, 4.0), GODL-India and KOGL-1 only (approved 2026-10-16); `tools/images/fetch-images.ts` resizes them
  to WebP in `public/images/` (`<id>.webp` ≤ 720 × 540 for the panel, `<id>-large.webp` ≤ 1600 × 1200; never
  cropped); the panel frames the image itself with "kind · image: credit, licence", and a click opens it larger
  in a centred dialog (`src/ui/ImageViewer.ts`, About's frame). glTF BLEND materials are drawn as cut-outs (alpha test,
  plus alpha to coverage on the high tier, with a minimum edge width) so overlapping parts keep their depth order. ESA models (SCIFLEET) are
  under a non-commercial licence and may not be redistributed or modified in this repository (SciFleet reply,
  2026-10-21, ticket CCR-171-85084): never copied; catalogue entries link to them instead (`model3d`, a
  `https://scifleet.esa.int/model/<id>/` viewer page, listed after the mission page in the panel's sources,
  hidden in the phone layout since the Unity viewer warns that phones are unsupported; their server sends no CORS headers, so the app cannot load them anyway).
- Sky (all views): NASA SVS Deep Star Maps 2020 (`src/render/SkyMesh.ts`, J2000 plate carrée, EXR tone-mapped by
  `tools/textures/exr.ts`); 4k KTX2 by default, 8k UASTC (~25 MB) only on large high-density screens.
- Sun: procedural photosphere shader (`src/render/SunMesh.ts`: limb darkening, granulation); sunspots from the
  day's NOAA SWPC active regions (immersive effect, §7), never a fixed map.
- Orbits of planets and small bodies: osculating ellipses whose vertices are offsets from the body, dense near it
  (`ellipseOffsetsAround`), rebuilt as the body moves. Spacecraft trajectories: Horizons samples densified with
  the same Hermite interpolation as the markers; stretches where a probe stays within 1.5 Hill radii of a planet
  for ≥ 10 days (orbiting, L1/L2) are left out, since they only retrace the planet's orbit.
  Solar-view textures load lazily when the camera comes near the body.

## 5. Computation models (client side)

### 5.1 Earth view
- `json2satrec` → `sgp4(satrec, date)` → position/velocity in **TEME**.
- TEME → ECEF via GMST rotation (`satellite.gstime`); at this visualisation level, neglect polar motion and fine
  nutation. Document the approximation.
- The scene lives in the **Earth-fixed** frame (the Earth does not rotate on screen; an "inertial frame" option
  makes the Earth rotate with fixed orbits).
- TEME → scene: satellites live in one `Group` rotated by −GMST (Earth-fixed view) or 0 (inertial view); the GMST
  is the IAU-82 formula in `src/astro/time.ts` (same as `satellite.gstime`).
- Propagation in a worker pool (N = `navigator.hardwareConcurrency - 1`, max 4). Budget: 15k objects propagated
  at ≥ 10 Hz (measured: ~17 ms for 16.6k objects on one thread). The vertex shader moves each object along its
  orbit from the two samples with the **two-body Lagrange f and g series** (to dt⁵, each sample covering its side,
  blended over the middle of the span; `src/astro/lagrangeSeries.ts`, tested against Kepler), also past the last
  sample when a propagation is late. A sample is requested only when "now" nears the last one, at least 2 min of
  simulated time ahead (`MIN_SPAN_MS`): ~1 propagation every 2 min at ×1. Samples are 10–25 min apart at ×10 000: a cubic Hermite was off by 60–280 km
  in LEO there, and the former straight-line extrapolation made low orbits jump outward (`src/earth/SampleTimeline.ts`,
  `src/render/SatellitePoints.ts`).
- Objects with SGP4 errors (`satrec.error != 0`, decay): hidden and counted in an "invalid" counter.
- Element age = `now - EPOCH`; beyond 14 days, flag as "stale elements".
- **Past dates** (30 days): the pipeline keeps the last GP set of each UTC day (copied when the next day's first
  run replaces it, with its shards: `data/earth/history/<date>.json.gz`, manifest top-level `earthHistory`; no
  extra request; CelesTrak serves no past, so the archive builds up over 30 days). A date more than a day before
  the current set uses the first copy fetched after it (`src/data/history.ts` `snapshotFor`): `EarthView` rebuilds
  its satellites from it once the date has settled (500 ms), keeping filters, selection and following, and the
  filter panel says "elements from the CelesTrak archive of <date>"; the engine reads that copy's shard and says
  `elementSet: "archive <date>"`. The Service Worker keeps 3 copies at most.

### 5.2 Moon / Mars / solar-system views (ephemerides)
- **Cubic Hermite** interpolation of position+velocity between Horizons samples (no high-order Lagrange).
- Outside the window: **two-body Keplerian** extrapolation from the last state (central body GM), shown as
  "extrapolated" (dimmed marker, dashed trajectory). Beyond 7 days outside the window for a low orbiter — and
  14 days for any other orbit, since two-body extrapolation of high or three-body orbits (NRHO, DRO) degrades
  quickly too — hide the position and keep the last known trajectory in grey (`src/astro/track.ts`).
- Horizons coverage can end before "now" (e.g. CAPSTONE): the pipeline moves the window to the covered side once
  and the client shows the object as hidden/extrapolated accordingly. Coverage shorter than the window on both
  sides (a new mission, e.g. MMX: launch to six weeks ahead) is clamped a second time from the other limit (a third
  request). An answer with no usable vectors for one mission only warns and keeps its previous file; network and
  HTTP errors still abort the run.
- The 30-day archive (§4.3) is fetched only when the shown date nears the window start (`PlanetaryView`
  `loadPastIfNeeded`; the engine reads it for earlier dates); `EphemerisTrack` joins the tables and splits them into
  segments at gaps longer than 1.5 × the steps around them (a missed run): the extrapolation and hiding rules apply
  around each segment. The panel says "interpolated from archived JPL Horizons ephemerides" and gives the archive's
  span.
- Body rotation: `Astronomy.RotationAxis(body, time)` (IAU WGCCRE model) to orient the Moon and Mars; landing
  sites are placed in planetocentric coordinates then rotated with the body.
- Phobos/Deimos: Horizons (IDs 401/402) like the probes.
- Moons in the solar view (`catalog/moons.json`, `src/astro/moons.ts`): the Moon and the Galilean moons from
  astronomy-engine; the others from JPL SSD mean elements (two-body + uniform apsidal/nodal precession in the
  tabulated Laplace/equator/ecliptic plane), whose epoch angles and mean motion are re-anchored on Horizons states
  by hand about once a year (`npm run moons:anchor`, 3 Horizons requests per moon; ≤ 7° error after a year).
  Those mean-element moons are also fetched from Horizons by the daily `horizons` run (planet-relative vectors,
  `500@<planet>`, −2 d / +30 d, ~64 samples per orbit between 10 min and 1 d; `data/ephem/moons/<id>.bin`, manifest
  `moons`) and loaded when the moon is first computed: the solar view interpolates them (Hermite) when they cover
  the date, else falls back to the mean elements; the badge says which. Moon requests only warn on failure (the
  missions are still published) and the audit flags moons not refreshed for 3 days (`moon-ephemeris-stale`).
  The Moon and the Galilean moons stay on astronomy-engine (10–90 km from Horizons, any date, no data).
  Moons and their orbits are drawn only when the orbit spans ≥ 14 px (or the moon is selected); the panel lists
  them folded under their planet, unfolded while the planet or one of its moons is selected.

### 5.3 Missions without public ephemerides
- `ephemeris: "kepler"`: published mean orbital elements (cited source) propagated as two-body.
  Unknown orbital phase → show the **orbit** but the position as "modelled, phase unknown".
- `ephemeris: "none"`: listed in the panel, not shown in 3D.

### 5.4 Frames and time
- Internal time: UTC `Date` + conversion helpers (JD UTC, JD TDB via astronomy-engine).
- Common working frame: ICRF equatorial J2000, in km, **Float64 on the CPU**.
- GPU precision: **camera-relative** rendering (subtract the origin in Float64 before sending Float32) +
  `logarithmicDepthBuffer` in **all** views (the Moon view spans 1 km to 400 000 km). Every custom
  `ShaderMaterial` that depth-tests must include the `logdepthbuf_*` chunks. Never send raw heliocentric
  coordinates to the GPU.
- Views implement `src/app/View.ts` (inertial ← body-fixed orientation, per-frame update, floating origin,
  picking, URL parameters); the shell (`src/app/main.ts`) owns camera, clock, frame switching and follow mode.
  Views are code-split and loaded on demand.

## 6. Quaternion camera

Custom controller `src/camera/QuaternionOrbitControls.ts` (do not use Three.js `OrbitControls`: it constrains
the "up" vector and causes gimbal lock at the poles).

- State: `target` (central point, usually the body origin), `distance`, `orientation: Quaternion`.
  Camera position = `target + orientation · (0, 0, distance)`.
- Left drag: **arcball** rotation around the centre — axis = `(Δy, Δx, 0)` expressed in the camera frame,
  angle ∝ displacement; `orientation = orientation · q(axis, angle)`, then normalise.
- Right drag or two-finger twist: **roll** around the view axis (camera z).
- Alt (Option) + left drag, Alt + arrows, or a three-finger drag (past a 12 px dead zone; two fingers only pinch
  and twist, a pinch moving their midpoint enough to pan by mistake): **pan** the pivot
  (`panVector`/`panBy`, the point under the pointer follows it); the pivot stays there on release, zoom, rotation
  and the altimeter (plain distance) are relative to it, following stops (no glide back). Around a pivot away from
  the body centre the closest approach is `pivotMinDistanceKm`. The camera never leaves the cube enclosing the
  view's maximum-distance sphere (`boundsHalfKm`: a pan slides along the wall, a zoom or a turn is capped there);
  a pan into a body pushes the camera out by translation (`keepOutsideByTranslation`). A cyan "guardian" grid
  (`src/render/GuardianGrid.ts`, camera-relative patches) fades in on a face within 10 % of it.
- Rotation slows near the central body's surface (`OrbitLimits.surfaceRadiusKm`, default minimum distance / 1.02;
  the solar view gives the Sun's radius, its closest approach being 1.5 radii).
- Wheel / pinch: **logarithmic** zoom (`distance *= exp(k·Δ)`), min bound (body radius × 1.02) and max bound
  (per view).
- Optional inertia (exponential damping of angular velocity).
- Double-click on an object: `target` glides to the object (orientation slerp + distance interpolation over 0.8 s);
  "recenter" button to return to the body. Following a celestial body (planet, dwarf planet, moon, Phobos/Deimos)
  frames it at 10 radii in every view, from its day side, and keeps the camera outside it (`bodyFollow` in
  `src/camera/orbitMath.ts`); spacecraft with a 3D model are framed by the model's size.
- Keyboard: arrows or W A S D (rotation), Q/E (roll), +/− (zoom), R (reset), F (follow). Letters are read by
  physical position (`KeyboardEvent.code`: Z Q S D and A/E on AZERTY), + and − by the character typed; the settings
  window names the keys as printed on the visitor's keyboard (`src/ui/keyboardLayout.ts`: the browser's layout map,
  else learned from typing, AZERTY and QWERTZ recognised).
- The camera never enters a body: views list `cameraObstacles()` (central body, with the exact ground of the local
  patch around a selected site; moons, Earth/Moon, the Sun and planets), and the shell moves a camera that ends up
  inside back above the surface (`keepOutside`, 2 m clearance), so it slides along the ground.
- Renormalise the quaternion every frame. Unit tests: no drift after 10⁶ small rotations, rotation around the
  poles without singularity.

## 7. Rendering and interaction

- Satellites: `THREE.Points` (or `InstancedMesh` at low zoom) with a single position buffer updated by the
  workers; colour by operator/filter via an attribute.
- Selection: **GPU picking by ID** (off-screen pass encoding the index as a colour), no raycasting over 15k points.
- Orbits: drawn on demand for the selected object (and optionally for a filter with < 200 objects).
- Filters: AND/OR combination of facets (operator, country, group, orbit regime, object type); filter state,
  view, selected object and time are reflected in the URL (link sharing).
- Lighting: Sun positioned with astronomy-engine; real day/night terminator.
- Photo mode (camera button in the top bar, `src/render/photo.ts`): downloads two PNGs of the 3D view, as shown
  (object labels painted from their computed style, no panels or bars) and objects only (every point, line and
  sprite hidden except the starfield and the Sun's halo, `keepInPhoto`). Title (file name and PNG iTXt `Title`):
  brand, followed object (else the view's body), displayed date and time in the display zone. A toast confirms (3 s).
- Favorites (star button between the languages and the settings, "Favorites" in the phone menu,
  `src/ui/FavoritesDialog.ts`, About's frame): four fixed examples in real time (ISS followed, Apollo 11's site, MRO
  followed, Voyager 1 followed), then "Add the current view" (fifth row: the URL plus `follow=1` while following), then
  the saved views, each deletable after a confirmation, "Clear all" at the bottom (confirmed too). A web page cannot read or write the browser's bookmarks
  (extensions only; approved 2026-10-27), so saved favorites are Perigee links in `localStorage`
  (`perigee-favorites`, `src/app/favorites.ts`: same origin and path only, browser/test parameters dropped, at most 50:
  a new view beyond that is refused with a message; re-read at each opening; the window's body scrolls). Names come from the engine (`describe`). Picking one (`openLink` in `src/app/main.ts`)
  sets the date (or real time), rate and frame, then selects in place when the view and its filters are the same
  (the camera glides), else rebuilds the view from the link; `follow=1` resumes following like a page load.
- Accessibility: keyboard-readable info panel, text list of filtered objects, AA contrast.
- Machine interface (for AI teaching assistants): `src/engine/` is a headless engine (no DOM or WebGL) over the
  published data and the same `src/astro` models: `find`, `describe`, `state`, `distance`, `series`, `define`,
  `viewUrl`, `about`; every answer carries its provenance (`src/engine/provenance.ts`: model, sources, fetch time,
  element age, validity window, data state, typical accuracy) and the educational-use disclaimer. Embed mode
  (`?embed=1`, `ui=panel,time` to keep the info panel or the time bar, `follow=1`) shows the 3D view alone with a
  link to the full app; a framed page answers the `perigee:v1` postMessage API (`src/app/embedApi.ts`: `get`
  with optional `details` from the engine, `set`, `snapshot` from photo mode, `ping`; events `ready`, `view`,
  `selection`, `time`). Views select in place through `View.selectId`. Documented in `public/llms.txt`; the build
  also writes `api/catalog.json`, `images.json`, `glossary.json`, `interface.json` and `llms-full.txt` from the
  catalogues (`src/engine/apiDocs.ts`, Vite plugin `apiDocuments`; no positions). MCP server `mcp/` (npm
  `perigee-mcp`, own semver, stdio, `@modelcontextprotocol/sdk`): tools `perigee_find`, `_object` (optional image),
  `_state`, `_distance`, `_distance_series`, `_view` (links, iframe), `_define`, `_about` in `mcp/src/tools.ts`
  (shared with a hosted endpoint); disk cache keyed by content hash (`mcp/src/diskCache.ts`); bundled by
  `npm run mcp:build` (npm dependencies bundled too: the package installs nothing else; the SDK's ajv validator, elicitation only, is stubbed), published by `mcp-release.yml` on a `mcp-v<version>` tag (npm trusted publishing, `docs/mcp-publishing.md`).
  Hosted endpoint `workers/mcp/` (Cloudflare Worker, https://perigee-mcp.perigeeinfo.workers.dev/mcp,
  `docs/mcp-hosted.md`): the same tools over stateless
  Streamable HTTP at `/mcp`, parsed data of the current version in isolate memory (the Cache API is a no-op on
  `*.workers.dev`; every file is checked against the manifest's or the shard index's SHA-256), a usage line per request in Workers Logs
  (`workers/mcp/src/usageLog.ts`: tool, object id, outcome, duration, client, country; never IP addresses or
  coordinates; Cloudflare's invocation logs off since they record headers), per-IP rate limit
  (60 units/min, binding `LIMITER`; a tool call costs 1–4, `TOOL_COST`; batches ≤ 4 messages, each charged), circuit
  breaker `PERIGEE_MCP_DISABLED_TOOLS` (dashboard variable, `keep_vars`; `*` pauses the endpoint), hourly alerts
  (`workers/mcp/monitor.ts`, `mcp-monitor.yml`: quota share, CPU-limit and error spikes; playbook in
  `docs/mcp-hosted.md`); deployed by `mcp-worker.yml` once the Cloudflare secrets exist (else it only checks
  the bundle). To fit the free plan's 10 ms of CPU per request, the pipeline also writes `earth.gp` and
  `earth.satcat` split by NORAD number (256 shards, `src/data/shards.ts`; manifest entry fields `shards` and, for
  gp, `names`: a tab-separated text index NORAD, name, COSPAR), so the engine decodes one shard (~65 records) instead of the
  whole file; new manifest information goes in extra entry fields, never new dataset keys (older clients' zod
  `partialRecord` rejects unknown keys). The Worker caps distance series at 100 samples and pass searches at
  3 days. `perigee_state` adds the ground point (`src/engine/ground.ts`: WGS 84 geodetic from TEME by GMST; country
  or sea from Natural Earth 1:110m, public domain, `tools/geo/fetch-regions.ts` → `src/engine/regions.json`; Moon
  and Mars planetocentric) and the sunlit fraction; `perigee_orbit` gives SGP4 mean elements for Earth satellites,
  osculating elements otherwise (`src/engine/orbitTools.ts`); `perigee_passes` (`src/engine/passes.ts`) finds rise,
  culmination and set over a place (scan that jumps by the geometric lower bound on the time to rise, bisection,
  golden section) and naked-eye visibility (sunlit satellite, Sun below −6°; low-precision Sun). `perigee_sky`
  (`src/engine/sky.ts`: Sun and twilights, Moon phase, planets, catalogue stars, from a place) and `perigee_events`
  (`src/engine/events.ts`: Moon phases and apsides, eclipses found only at syzygies with the Moon within 1.8° of
  the ecliptic, local solar eclipses sampled topocentrically around the global peak, seasons, perihelion, planet
  oppositions, conjunctions and elongations, missions' `nextEvent`) use astronomy-engine only; the Worker caps
  events at 31 days. `perigee_stats` reads `data/earth/stats.json.gz` (manifest top-level `stats`), counts written by
  the pipeline after each GP and SATCAT run (`writeStats`, `src/earth/stats.ts` over `buildCatalog`; an
  enhancement: a failure only warns). `perigee_describe_view` (`src/engine/describeView.ts`) turns a Perigee link
  into alternative text and a description (view, selection with its position state, date, rate, frame, filters,
  hidden items; the camera framing is not in the URL). `perigee_shadow` (`src/engine/shadow.ts`: sunlight,
  penumbra or umbra from `sunlitFraction`, changes found by scan and bisection; Earth satellites in TEME, lunar and
  Martian orbiters from their track and the centre on an hourly grid), `perigee_ground_track`
  (`src/engine/groundTrack.ts`: ≤ 360 points, GeoJSON split at the antimeridian), `perigee_close_approach`
  (`src/engine/closeApproach.ts`: adaptive scan, golden section to 20 ms; education only, says so),
  `perigee_sky_conjunctions` (`src/engine/conjunctions.ts`: Moon, planets and bright ecliptic stars, topocentric
  J2000, planets every 6 h and the Moon every hour; a satellite's passes sampled every 2 s) and `perigee_tonight`
  (the night ahead: sky, visible passes of the ISS, Tiangong and Hubble, conjunctions, events) use the same engine;
  the Worker caps close approaches at 1 day, conjunctions at 7 days and shadow searches at 12 hours. Answers meant
  for the user follow `lang` (EN/FR: notes, warnings, highlights, labels in `src/engine/notes.ts`, compass points
  with O for west in French texts); codes stay English in every language (`direction: "WNW"`, `light: "umbra"`),
  with a localised label beside them where a person reads them. perigee-mcp
  1.9.1 has 19 tools. Architecture, observability,
  load tests (`npm run mcp:load`, `tools/loadtest/mcp-load.ts`) and troubleshooting: `docs/machine-interface.md`.
- Definitions: detail-panel labels with a glossary entry (`src/i18n/glossary.ts`, EN/FR, secondary-school level) are
  underlined like links and open a centred dialog (`src/ui/Glossary.ts`, About's frame). Found from the label text;
  a row can name its term when the text is ambiguous (only the Moon's "Phase" is defined, not a probe's).
- Search and sharing (site at https://perigee.info/, GitHub Pages custom domain): static English metadata in
  `index.html` (description, Open Graph/Twitter card with `public/og-image.jpg`, hreflang, JSON-LD WebApplication);
  the app sets title, description, `lang` and the canonical URL (language + view only) for what it shows.
  `public/robots.txt`, `public/sitemap.xml` (one URL per view and language, with alternates) and `public/llms.txt`.
- Bilingual **EN/FR** interface (see §0), strings in `src/i18n/`. Brand: "Perigee" in English, "Périgée" in French.
- Visual style: sci-fi HUD inspired by recent Halo games (chamfered translucent panels, corner brackets, cyan
  accents, condensed uppercase labels) in `src/styles.css`. Fonts: Rajdhani (display) and Saira Semi Condensed
  (text), OFL-1.1, bundled via `@fontsource` (latin subset).
- A followed object that covers more than 10 px on screen (its 3D model, or a body's disc) names itself: its
  label, marker and selection ring are hidden until it shrinks again (solar, Moon and Mars views).
- Screen-sized markers on a body surface (sites) do not depth-test: occlusion is computed on the CPU
  (`occludedBySphere`), otherwise the flat sprite sinks into the curved surface when seen from afar. The same holds for
  their selection ring (`SelectionMarker` surface mode). In the solar view the Sun, planets and small bodies hide
  the markers and labels behind them (`occludedBySphereAt`); in the Moon view the Earth does too.
- **Quality tiers** (`src/render/quality.ts`): high (desktop-class GPU), medium (touch devices, < 8 GB, no MSAA),
  low (≤ 4 GB, ≤ 4 cores, max texture < 8192, software GPU, data saver), decided at startup from cheap signals
  (WebGL caps and GPU name from a throwaway context, `deviceMemory`, cores, pointer, saveData). The tier sets the
  pixel-ratio cap and floor, MSAA, 8k textures, HD models, model alpha-to-coverage, panel blur, frame cap (60 fps
  below high; 30 fps when idle on low) and the preview rate. Adaptive resolution (`src/render/adaptiveResolution.ts`)
  steps the pixel ratio down by 0.25 while the median frame is slow and back up when it keeps the display's pace
  (5 s warm-up, ceiling after an up/down bounce); screen-sized points are given in CSS px and scaled by the shared
  `PIXEL_RATIO_UNIFORM`. The visitor can force a tier at the head of the settings window (gear
  button in the top bar, "Settings" in the phone menu, `src/ui/SettingsDialog.ts`, centred like About; remembered,
  reload in place). The same window then draws the controls like a game menu: a mouse and a keyboard with the keys in
  use lit in each action's colour (⌥ option on a Mac, Alt elsewhere), or the touch gestures only on a touch-only
  device; nothing is configurable; `?quality=` overrides for tests; `?debug=perf` shows the tier,
  reasons, GPU and frame rate; problem reports carry the tier. `tools/perf/bench.ts` measures main-thread cost
  per view (`--throttle 4` to approach a phone).
- **Immersive effects** (high tier only; each switchable live in the settings window, remembered
  per browser in `perigee-effects`; `src/render/effects.ts`, shared strength uniforms, no rebuild):
  - *Relief*: normal maps (east/north/up, linear UASTC KTX2 `normal-*`, ≤ 4k) from elevation models (Moon LOLA,
    Mars MOLA MEGDR, Mercury MESSENGER, Ceres Dawn; `tools/textures/normals.ts`, uncompressed int16 GeoTIFFs read
    by `tools/textures/tiff.ts` since sharp clips signed samples; the USGS Mercury and Ceres models are 0–360°
    despite their tie points, checked against the colour mosaics' shading). Diffuse light only: the day/night
    mix stays on the sphere. No Earth relief (Blue Marble is already shaded).
  - *Earth clouds*: illustrative Blue Marble cloud layer 12 km up, with ground shadows (`src/render/clouds.ts`),
    labelled as such. A per-tab seed (`sessionStorage`, `src/render/cloudSeed.ts`) shifts it in longitude,
    warps and thins it, so each visit differs but view switches and reloads keep it; that seeded cover is baked
    on the GPU (`CloudBaker`), each frame only reads it.
  - *Moving gas* (Venus, Jupiter, Saturn, Uranus, Neptune): the bands slide along schematic zonal wind profiles
    (m/s, `BodyMesh` `gasFlow`).
  - *Sunspots* (solar view): NOAA SWPC regions (`src/astro/sunspots.ts`): Carrington longitude = IAU body frame
    of the Sun, positions as of 24:00 UT of the report day, differential rotation since, faded 7–14 days after
    the last report; groups drawn procedurally in `SunMesh` (illustrative shapes, real place and area); the panel
    names the report date. The Sun is selectable (`sel=sun`; click on its disc or the panel's first entry): main
    figures (IAU 2015 nominal values), Carrington rotation and central meridian, the day's active regions and
    where the sunspot data come from; it is framed and followed from the Earth's side.
  - *Spacecraft lighting* (3D models, `SceneModel`): the Sun is nearly the only light (environment and ambient
    fills cut to a trace), with self-shadowing from a shadow map fitted to the model each frame (the renderer's
    shadow map is enabled on the high tier; only model parts cast, and only while the effect is on) and the
    central body's shadow (`src/astro/eclipse.ts`, umbra and penumbra; orbiters only, not surface sites).
  Clouds and gas follow the simulation clock (`src/render/simTime.ts`, set by the frame loop): two layers each
  drift for a cycle (clouds 2 days, gas 4 days) and cross-fade into the next (`layerCycle`); a cloud layer's
  next drawing is a new seed (tab seed + cycle number), so a date shows the same clouds in every view and a layer
  is never blended with a shifted copy of itself (the earlier looping flow map looked stencilled). At ×1 the
  drift is real-time slow (~12 m/s for clouds).
- Phone layout (`styles.css`, ≤ 640 px wide; landscape ≤ 500 px tall): top bar with a "☰" menu and view tabs,
  compact time bar docked at the bottom (speed `<select>`, date popover), panels as collapsible bottom sheets
  above it, one at a time. The shell publishes `--timebar-h` and moves the camera's projection centre above an
  open sheet (`src/render/viewInset.ts`, used by the main pass and GPU picking). Touch screens get larger pick
  radii (`src/render/pointer.ts`). A Playwright "mobile" project runs `tests/e2e/mobile.spec.ts`.

## 8. Data pipeline (GitHub Actions)

```
.github/workflows/
  data-celestrak.yml   # cron every 4 h: GP active (+ filter groups) — 1 request per group
  data-satcat.yml      # daily cron: active SATCAT
  data-horizons.yml    # daily cron: vectors for the missions, moons (mean-element) and comets of catalog/
  data-sun.yml         # daily cron: NOAA SWPC solar active regions (sunspots effect) — 1 request
  data-audit.yml       # Friday 21:00 UTC: maintenance audit → audit.json / audit.md on the data branch
  maintenance-watchdog.yml  # Saturday 14:00 UTC: alert issue if the agent did not report or its PR is stuck
  deploy.yml           # Vite build + Pages deployment (triggered on main and after data updates)
```

Weekly maintenance (hands-off):
- `pipeline/audit.ts` (`npm run data:audit`) compares published data and a few upstream lists (CelesTrak index
  page, this year's SATCAT launches, IERS leap seconds (else the IANA tzdb `leap-seconds.list`; neither answering is an audit item, not a failure), Horizons lookups for new deep-space payloads) with the
  catalog: unknown launch-site/owner codes, new CelesTrak groups, deep-space payloads missing from
  `missions.json`, public ephemerides ending (`coverageEnd` in the manifest), stale `verified` dates (missions
  monthly, at most 15 per week; files after 180 days), leap seconds. Deliberate exclusions live in `launch-sites.json` `unplacedSatcatCodes` and `operators.json`
  `ignoredGroups`.
- A scheduled Claude Code routine (maintainer's account, Saturday 02:00 America/Toronto) follows
  `docs/maintenance-agent.md`: researches each item on official sources, edits `catalog/`, opens a
  `maintenance/<date>` PR with the change report and enables auto-merge, then comments on the pinned
  `maintenance-report` issue (mentioning the maintainer only when something needs a human).
- `pipeline/catalog-guard.ts` (CI job on `maintenance/*` PRs): curated files only, schema-valid, no deleted
  entries (renames count as deletions), no unknown catalog files, https sources and a new `verified` date on every
  changed entry (the file's date for entries without their own; new entries verified within 14 days), ≤ 40 changes. Branch protection on
  `master` requires CI; pipeline failure and watchdog issues are assigned to the maintainer (e-mail).
- Only the maintainer's own PRs are ever merged without review: `maintenance-merge.yml` (backup for auto-merge)
  merges a `maintenance/*` PR only if it comes from this repository (not a fork), is authored by the repository
  owner's account (the agent acts through it) and CI passed on its current head. GitHub auto-merge can only be
  enabled by users with write access. Workflows of every external contributor's PR need manual approval
  (repository setting), and the default `GITHUB_TOKEN` is read-only. Outside PRs always wait for a human merge.

Rules:
- Scripts in `pipeline/` (Node 20+ + TS, run with `tsx`). No server dependency.
- **One call per resource per run**, `User-Agent` identifying the project and the repo URL, stop on any non-200
  response, no retry loops (at most 1 retry, after 10 min). SupGP is an enhancement: a failing set stops the
  remaining SupGP requests of the run and only warns; the `active` data are published, merged with the sets
  gathered or kept from the last run (`data/earth/supgp-sets.json.gz`). The weekly audit flags a set not refreshed
  for 2 days (`supgp-stale`). CelesTrak answered 503 to the pipeline's SupGP requests from a residential IP on
  2026-10-05 (cause unknown).
- Schema validation (zod) before publication: an invalid or near-empty file (< 50 % of the previous one) does
  **not** overwrite the previous version; the action fails. A failed scheduled run only warns (providers have
  occasional outages); `data-pipeline.yml` opens or comments an issue when the previous run of the same workflow
  failed too (two in a row).
- Output: `data/earth/gp-active.json.gz` (+ `gp-active/<shard>.json.gz`, `gp-names.txt.gz`),
  `data/earth/satcat.json.gz` (+ `satcat/<shard>.json.gz`), `data/ephem/<mission>.bin`
  (compact Float64: t_TDB, x, y, z, vx, vy, vz; `data/ephem/past/<mission>.bin` the 30-day archive),
  `data/earth/history/<date>.json.gz` (+ shards: the daily GP copies, 30 days), `data/sun/regions.json.gz` (NOAA SWPC
  `services.swpc.noaa.gov/json/solar_regions.json`, ~30 days of region reports) + `data/manifest.json`
  (timestamp, source, object count, hash).
  The client reads `manifest.json` first.
- Published on an **orphan `data` branch** force-pushed (no history) to avoid bloating the repo, then copied into
  the Pages artifact at deploy time. Same origin → no CORS issue.
- The client caches via Pages `Cache-Control` + a hand-written Service Worker (`public/sw.js`, Cache API,
  production builds only): network-first for pages and `manifest.json`, cache-first for hashed assets (least-recently-used
  eviction, so the running build's scripts stay) and versioned data (`?v=<sha>`, one version kept per file), stale-while-revalidate for textures; same-origin only. After the first visit the
  page posts the URLs it already loaded so they are cached too. Offline, a badge says data come from the cache.
  Pages sends `max-age=600` on every file: the worker revalidates page navigations (`cache: 'no-cache'`), and the
  textures, models and shapes of `public/` carry `?v=<content hash>` (build-time map, `src/render/assetUrl.ts`)
  so they are versioned like the data.
- Open tabs stay current (`src/app/updates.ts`): every 15 min while visible (and on return to the tab), the page
  compares its commit with `version.json` (written by the build, never cached) and the data hashes its view
  loaded (`View.dataVersions()`) with `manifest.json`. A tab in the background reloads on return; a visible one
  shows a "Refresh" notice. The URL keeps view, selection, filters and time; the camera crosses the reload in
  `sessionStorage`. A view chunk missing after a deployment triggers one reload (at most one per minute).

## 9. License and attribution

- Code: **MIT**. Do **not** copy code from AGPL/GPL projects (e.g. KeepTrack is AGPL) — take conceptual
  inspiration only.
- Attribution shown in the UI ("About") and in `DATA_SOURCES.md`:
  CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track, NASA/JPL-Caltech Horizons, NASA SVS
  (CGI Moon Kit), USGS Astrogeology, NASA Blue Marble, astronomy-engine (MIT), satellite.js (MIT).
- Notice: data for educational purposes, not intended for navigation or conjunction assessment.

## 10. Repository layout

```
/
├─ CLAUDE.md
├─ DATA_SOURCES.md
├─ catalog/            # curated versioned data (missions, operators, sites)
├─ pipeline/           # fetch scripts (Actions) — no astrodynamics here
├─ tools/textures/     # offline texture pre-processing
├─ public/textures/    # texture derivatives (WebP in M0, KTX2 later)
├─ src/
│  ├─ app/             # bootstrap, view routing, URL state
│  ├─ camera/          # QuaternionOrbitControls
│  ├─ astro/           # time, frames, Hermite interpolation, Kepler, astronomy-engine wrappers
│  ├─ earth/           # view A: OMM loading, SGP4 workers, filters
│  ├─ moon/ mars/ solar/  # views B, C, D
│  ├─ render/          # scene, GPU picking, materials, orbits
│  ├─ ui/              # panels, filters, time control
│  ├─ data/            # manifest loading, cache, zod schemas shared with pipeline/
│  └─ i18n/
├─ mcp/                # MCP server (npm perigee-mcp) over the headless engine src/engine/
├─ workers/mcp/        # hosted MCP endpoint (Cloudflare Worker), same tools
└─ tests/              # vitest (reference values), playwright
```

## 11. Commands

```bash
npm install
npm run dev            # local Vite server (reads local data/ or the data branch via fetch)
npm run build          # static build → dist/
npm run test           # vitest
npm run test:e2e       # playwright
npm run lint
npm run data:fetch     # runs the pipeline locally — WARNING: respect the CelesTrak policy,
                       # do not run in a loop; prefer `npm run data:pull`
npm run data:pull      # downloads the latest published `data` branch (normal development use)
npm run textures       # offline texture pre-processing (downloads NASA sources, writes public/textures/)
npm run mcp:build      # bundles the MCP server into mcp/dist/perigee-mcp.js
npx tsx tools/screenshots/readme.ts docs/images   # README screenshots (dev server, data:pull, a GPU)
```

## 12. Required reference tests

- SGP4: Vallado test cases (SGP4-VER) → error < 1 m vs published values.
- TEME→ECEF: ISS position vs a reference value at a given epoch (< 1 km).
- Hermite: reconstruction of a synthetic Keplerian orbit, error < 10 m with a 2 min step.
- Lunar/Martian rotation: sub-Earth longitude / prime meridian at a known date.
- Camera: no drift and no singularity (see §6).
- Parsing: an OMM with `NORAD_CAT_ID` ≥ 100000 is correctly ingested, displayed and searchable.

## 13. Things to re-check regularly (verification dates in `catalog/`)

Known statuses at end of September 2026. Kept current by the weekly maintenance agent (§8), which re-verifies
every active mission about monthly (due after 21 days, at most 15 per weekly audit, oldest first) and anything
the audit flags:
- Lunar orbit (verified 2026-10-10, details and sources in `catalog/missions.json`): LRO (−85), Chandrayaan-2
  orbiter (−152, planned 7-year life reached mid-2026 — re-check), Danuri/KPLO (−155, extended to end 2027),
  ARTEMIS P1/P2 (−192/−193), CAPSTONE (−1176; NASA declared the mission complete 2026-07-06, Advanced Space
  continues flying it commercially (weekly NRHO station-keeping as of mid-2026); **public Horizons ephemeris
  stops 2026-08-14 and has not resumed**, likely permanently now that NASA's DSN-tracked mission has ended —
  re-check periodically), SWC-1/Shams (−168540, Saudi Space Agency cislunar space-weather 12U CubeSat deployed
  during Artemis II, launched 2026-04-01; still tracked in high Earth orbit in October 2026 (NORAD 68540,
  Space-Track elements on N2YO, verified 2026-10-10), but its public Horizons ephemeris stops 2026-04-07, so it is
  `ephemeris: "none"`). No Horizons ephemeris: Queqiao-2,
  Tiandu-2, Queqiao-1 (L2), DRO-A; Tiandu-1 and DRO-B have left lunar orbit (Earth–Moon resonant orbits, 2025).
  ICUBE-Q: presumed lost. **Chang'e-7 did not launch**: August 2026 window lost to Typhoon Narra, postponed to
  2027. Artemis II flew 1–10 April 2026 (ended).
- Mars (verified 2026-09-27, details in `catalog/missions.json`): Mars Odyssey (−53, very low on propellant —
  re-check), Mars Express (−41, extended June 2026), MRO (−74), ExoMars TGO (−143), Hope/EMM (−62, extended to
  2028), Tianwen-1 orbiter (no public ephemeris). MAVEN (−202): lost 2025-12-06, mission declared over
  2026-06-03; Horizons coverage ends 2026-03-01 (shown as last known trajectory). ESCAPADE Blue/Gold: launched
  2025-11-13, waiting near Sun–Earth L2, Earth-departure burns Nov 2026, Mars arrival Sept 2027. MMX (JAXA):
  launched 2026-10-19 19:41 UTC (H3 F10) into its planned trajectory; heliocentric cruise, Mars arrival 2027
  (NORAD 101109, Horizons ID −239). Phobos (401) and Deimos (402) come from Horizons like the probes.
- Interplanetary (verified 2026-10-10, details in `catalog/missions.json`, heliocentric Horizons IDs): Voyager 1
  (−31, LECP off April 2026) and 2 (−32), New Horizons (−98), Juno (−61, end date unconfirmed), Parker (−96, 6 h
  step), Solar Orbiter (−144), BepiColombo (−121, Mercury orbit insertion 2026-11-21), JUICE (−28, Earth flyby
  2026-09-28), Europa Clipper (−159), Psyche (−255), Lucy (−49), OSIRIS-APEX (−64), Hera (−91, Didymos Nov 2026),
  Hayabusa2 (−37), Aditya-L1 (−156), SOHO (−21), JWST (−170), Gaia (−139479, retired 2025), Euclid (−680), IMAP
  (−43), Carruthers (−171), STEREO-A (−234). No public ephemeris: Tianwen-2 (at Kamoʻoalewa since June 2026),
  SOLAR-1, Nancy Grace Roman Space Telescope (NORAD 100532, launched 2026-08-30, cruising to Sun–Earth L2,
  arrival ~Nov 2026; coronagraph first light 2026-09-22, guidance system checked 2026-09-30 — re-check for a
  Horizons match once it settles at L2). Planned: NEO Surveyor, MBR Explorer, DESTINY+, Comet
  Interceptor. Several public ephemerides end within weeks (Hera, SOHO, IMAP, Aditya-L1, Hayabusa2, STEREO-A):
  windows are truncated, re-check coverage regularly.
- Inactive spacecraft (added 2026-10-25, Horizons coverage checked that day): with a predicted Horizons trajectory
  through 2027-10, Pioneer 10 (−23), Pioneer 11 (−24), Ulysses (−55), Spitzer (−79), Kepler (−227), Planck (−489),
  Herschel (−486) and Gaia (−139479). Listed without a position (Horizons coverage ended): Mariner 2, Mariner 10,
  Helios 1 and 2, Galileo, NEAR Shoemaker, Cassini, Deep Space 1 (ends 2003), Stardust (2011), WMAP (2009),
  Hayabusa, Rosetta, Deep Impact/EPOXI (2020), Dawn, Akatsuki, DART. MarCO is unknown to Horizons. Ulysses shows a photo:
  NASA's model spans its 72 m wire antenna, leaving the spacecraft a dot in the preview.
- Dwarf planet candidates (added 2026-10-28): 2026 ED138 is new (Rubin, condition code 3, size from brightness only):
  re-check its size, any moon, its MPC number and whether the IAU recognises it; likewise any IAU decision on the
  other candidates.
- Mars rover positions come from NASA MMGIS waypoint feeds (`catalog/landing-sites/mars.json` `feed`, daily).

## 14. Code conventions

- TypeScript `strict`, no unjustified `any`. Explicit units in names (`distanceKm`, `tTdbJd`, `angleRad`).
  Never degrees in internal computations.
- Astrodynamics functions are **pure** and tested; no Three.js dependency in `src/astro/`.
- No `localStorage` for large data; the Service Worker's Cache API holds datasets and textures.
- Releases: semantic version in `package.json`, tagged `v<version>` on the release commit; the About dialog shows
  it beside the build commit (`__PERIGEE_BUILD__`).
- Conventional commits (`feat:`, `fix:`, `data:`, `catalog:`). Any change to `catalog/` must include the source
  in the PR.
- Before adding a dependency: check the license (MIT/BSD/Apache/public domain only; **fonts may also be
  OFL-1.1**, approved by the maintainer on 2026-09-27) and weight. Imagery: public domain / NASA media first;
  CC BY 4.0 (attribution only) allowed where none exists (approved 2026-09-27), credited and labelled if artistic;
  panel images (`catalog/images.json`) also CC BY 2.0/3.0, CC BY-SA 3.0/3.0 IGO/4.0, GODL-India, KOGL-1 (2026-10-16);
  never NC/ND. Fonts are bundled locally (`@fontsource`),
  never loaded from a third-party CDN.

## 15. Roadmap

1. **M0** — Vite/Three skeleton, quaternion camera, textured Earth, real time. Camera tests.
2. **M1** — CelesTrak + SATCAT pipeline, complete view A (workers, picking, panel, filters, URL).
3. **M2** — Horizons pipeline, view B (Moon) with landing sites.
4. **M3** — view C (Mars), Phobos/Deimos, sites.
5. **M4** — view D (solar system), optional logarithmic scale, trajectories.
6. **M5** — PWA/offline, KTX2 textures, full i18n review, accessibility, contributor documentation.

## 16. Existing projects (reference, no copying)

- orbitalradar.com (real-time Moon/Mars globes based on Horizons — same approach as B/C).
- KeepTrack (AGPL), Stuff in Space, NASA Eyes on the Solar System.
- `maxmoneycash/orbital-works-data`: example of a CelesTrak mirror via GitHub Actions (model for §8).
