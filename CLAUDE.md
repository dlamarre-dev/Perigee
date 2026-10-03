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
- Freshness indicator: every object knows whether its position is *propagated from recent elements*,
  *interpolated from ephemerides*, or *extrapolated/modelled* (shown visually).

## 2. Non-negotiable principles

1. **Client-side computation.** The data pipeline (GitHub Actions) only *fetches, validates, reformats and
   compresses* raw data. It never computes a position. SGP4, interpolation, frame changes, planetary rotations:
   everything happens in the browser.
2. **Public data only**, with visible attribution (see §9).
3. **Respect the providers.** The user's browser **never** contacts CelesTrak or Horizons directly. See §4 for why.
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
- **Always resolve IDs through `horizons_lookup.api`**, never guess them. Record them in `catalog/missions.json`
  with the verification date.
- Some missions have no public ephemerides (e.g. Tianwen-1, sometimes Queqiao-2) → see §5.3.

### 4.4 Curated catalog (in the repo)
No single API provides "active probes + landing sites". We maintain:
- `catalog/missions.json`: missions beyond Earth orbit (internal id, EN/FR name, agency, country, launch date,
  Horizons ID, NORAD if any, central body, status, `ephemeris: horizons|kepler|none`, `verified: YYYY-MM-DD`,
  `sources: [url]`).
- `catalog/earth-science.json`: the featured "space & Earth science" satellites of the Earth view (CelesTrak
  `science` group + the ISS): known name EN/FR, agency, country, status, purpose, notes, `verified`, `sources`.
  Shown first in the filters, with curated names in the list and the info panel; re-verified monthly like the
  missions; the audit flags new members of the CelesTrak group.
- `catalog/landing-sites/moon.json`, `catalog/landing-sites/mars.json`: planetocentric lat/lon, date, mission,
  type (`soft|hard|impact|crewed|rover-last-known`), source.
- Every entry must cite at least one source (NASA, ESA, JAXA, CNSA, ISRO, KARI, LROC, Wikipedia as last resort).
- Optional: enrichment via Wikidata SPARQL (CORS-enabled) for descriptions/links, never for positions.

### 4.5 Body textures and models
- Earth: NASA Blue Marble (public domain) + optional night mask (Black Marble).
- Moon: NASA SVS **CGI Moon Kit** (svs.gsfc.nasa.gov/4720) — LROC colour + LOLA displacement.
- Mars: USGS Astrogeology **colourised Viking MDIM 2.1** + MOLA for relief.
- Planets (view D): NASA Photojournal / USGS public-domain maps (Mercury, Jupiter, Pluto, Ceres); procedural
  band textures where no public-domain global map exists (Venus cloud tops, Saturn, Uranus, Neptune, unresolved
  dwarf planets, moons never mapped globally). Moons: USGS global mosaics, P. Stooke's PDS maps (Amalthea and
  Hyperion hand-drawn, labelled). Saturn's rings from Voyager PDS profiles (brightness + optical depth), Uranus' from the NASA
  fact sheet (`tools/textures/rings.ts`, `src/render/RingMesh.ts`).
- **Offline** pre-processing (`tools/textures/` script): resample to 2k/4k/8k, KTX2 (Basis) compression,
  progressive loading by zoom level. Source textures are not committed; only compressed derivatives are
  (committed directly, no Git LFS: LFS bandwidth would be spent on every Pages deploy; keep each file well under GitHub's 100 MB limit — the UASTC 8k maps are 7–29 MB, approved 2026-09-27; re-encode only when a source changes, since every version stays in history). Levels per body are declared once in `src/render/textureLevels.ts` (read by the tool and
  the client). KTX2 (Basis ETC1S, sRGB, mipmaps, Y-flipped since compressed textures ignore `flipY`) is preferred,
  WebP is the fallback; the Basis transcoder is copied from three.js by a Vite plugin. Encoding uses the official
  `basisu` CLI in its WASI build, run by Node (`tools/textures/basisu.ts`, pinned commit); the browser WASM
  wrappers cap images at ~12 Mpixel. 8k levels (Earth day/night, Moon, Mars) are KTX2-only and load on demand
  when the camera is within one radius of the surface (`BodyMesh.requestDetail()` / `ProgressiveTexture`).
- Irregular moons (Amalthea, Proteus, Hyperion, Phoebe): PDS shape models resampled to radius grids
  (`tools/shapes/fetch-shapes.ts` → `public/shapes/<id>.json`, `moons.json` `shape: "grid"`), displacing the body
  sphere (`src/render/shapeGeometry.ts`); UVs unchanged, so the equirectangular maps still apply.
- 3D models (`catalog/models.json`, targets `mission:`/`moon:`/`site:`/`norad:`): NASA 3D Resources GLBs processed by
  `tools/models/fetch-models.ts` (simplified, WebP textures ≤ 1024 px, meshopt, metres; NASA insignia and JPL logo
  decals covered, ISS stray parts dropped) → `public/models/<id>.glb`. The selected object's model replaces its
  marker once it covers ≥ 4 px (`src/render/models.ts` `SceneModel`, PBR lit by the Sun and a dim room environment;
  illustrative attitude from `src/astro/attitude.ts`), and a preview spins at the top of the info panel
  (`src/ui/ModelPreview.ts`). Following such an object lets the camera come to twice its size. Phobos and Deimos
  (`body` entries) replace the BodyMesh sphere, aligned offline on Thomas's PDS grids. ESA models (SCIFLEET) are
  under a non-commercial licence: not used (permission requested).
- Sky (all views): NASA SVS Deep Star Maps 2020 (`src/render/SkyMesh.ts`, J2000 plate carrée, EXR tone-mapped by
  `tools/textures/exr.ts`); 4k KTX2 by default, 8k UASTC (~25 MB) only on large high-density screens.
- Sun: procedural photosphere shader (`src/render/SunMesh.ts`: limb darkening, granulation); no sunspot map.
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
  at ≥ 10 Hz (measured: ~17 ms for 16.6k objects on one thread). Between two samples the vertex shader uses
  **cubic Hermite interpolation on position + velocity** (instead of linear), so motion stays on the orbit even
  when samples are minutes apart at ×1000–×10000 (`src/earth/SampleTimeline.ts`, `src/render/SatellitePoints.ts`).
- Objects with SGP4 errors (`satrec.error != 0`, decay): hidden and counted in an "invalid" counter.
- Element age = `now - EPOCH`; beyond 14 days, flag as "stale elements".

### 5.2 Moon / Mars / solar-system views (ephemerides)
- **Cubic Hermite** interpolation of position+velocity between Horizons samples (no high-order Lagrange).
- Outside the window: **two-body Keplerian** extrapolation from the last state (central body GM), shown as
  "extrapolated" (dimmed marker, dashed trajectory). Beyond 7 days outside the window for a low orbiter — and
  14 days for any other orbit, since two-body extrapolation of high or three-body orbits (NRHO, DRO) degrades
  quickly too — hide the position and keep the last known trajectory in grey (`src/astro/track.ts`).
- Horizons coverage can end before "now" (e.g. CAPSTONE): the pipeline moves the window to the covered side once
  and the client shows the object as hidden/extrapolated accordingly.
- Body rotation: `Astronomy.RotationAxis(body, time)` (IAU WGCCRE model) to orient the Moon and Mars; landing
  sites are placed in planetocentric coordinates then rotated with the body.
- Phobos/Deimos: Horizons (IDs 401/402) like the probes.
- Moons in the solar view (`catalog/moons.json`, `src/astro/moons.ts`): the Moon and the Galilean moons from
  astronomy-engine; the others from JPL SSD mean elements (two-body + uniform apsidal/nodal precession in the
  tabulated Laplace/equator/ecliptic plane), whose epoch angles and mean motion are re-anchored on Horizons states
  by hand about once a year (`npm run moons:anchor`, 3 Horizons requests per moon; ≤ 7° error after a year).
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
- Wheel / pinch: **logarithmic** zoom (`distance *= exp(k·Δ)`), min bound (body radius × 1.02) and max bound
  (per view).
- Optional inertia (exponential damping of angular velocity).
- Double-click on an object: `target` glides to the object (orientation slerp + distance interpolation over 0.8 s);
  "recenter" button to return to the body.
- Keyboard: arrows (rotation), Q/E (roll), +/− (zoom), R (reset).
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
- Accessibility: keyboard-readable info panel, text list of filtered objects, AA contrast.
- Bilingual **EN/FR** interface (see §0), strings in `src/i18n/`. Brand: "Perigee" in English, "Périgée" in French.
- Visual style: sci-fi HUD inspired by recent Halo games (chamfered translucent panels, corner brackets, cyan
  accents, condensed uppercase labels) in `src/styles.css`. Fonts: Rajdhani (display) and Saira Semi Condensed
  (text), OFL-1.1, bundled via `@fontsource` (latin subset).
- Screen-sized markers on a body surface (sites) do not depth-test: occlusion is computed on the CPU
  (`occludedBySphere`), otherwise the flat sprite sinks into the curved surface when seen from afar. The same holds for
  their selection ring (`SelectionMarker` surface mode). In the solar view the Sun, planets and small bodies hide
  the markers and labels behind them (`occludedBySphereAt`); in the Moon view the Earth does too.
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
  data-horizons.yml    # daily cron: vectors for each mission in catalog/missions.json
  data-audit.yml       # Friday 21:00 UTC: maintenance audit → audit.json / audit.md on the data branch
  maintenance-watchdog.yml  # Saturday 14:00 UTC: alert issue if the agent did not report or its PR is stuck
  deploy.yml           # Vite build + Pages deployment (triggered on main and after data updates)
```

Weekly maintenance (hands-off):
- `pipeline/audit.ts` (`npm run data:audit`) compares published data and a few upstream lists (CelesTrak index
  page, this year's SATCAT launches, IERS leap seconds, Horizons lookups for new deep-space payloads) with the
  catalog: unknown launch-site/owner codes, new CelesTrak groups, deep-space payloads missing from
  `missions.json`, public ephemerides ending (`coverageEnd` in the manifest), stale `verified` dates (missions
  monthly, at most 15 per week; files after 180 days), leap seconds. Deliberate exclusions live in `launch-sites.json` `unplacedSatcatCodes` and `operators.json`
  `ignoredGroups`.
- A scheduled Claude Code routine (maintainer's account, Saturday 02:00 America/Toronto) follows
  `docs/maintenance-agent.md`: researches each item on official sources, edits `catalog/`, opens a
  `maintenance/<date>` PR with the change report and enables auto-merge, then comments on the pinned
  `maintenance-report` issue (mentioning the maintainer only when something needs a human).
- `pipeline/catalog-guard.ts` (CI job on `maintenance/*` PRs): curated files only, schema-valid, no deleted
  entries, https sources and a new `verified` date on every changed entry, ≤ 40 changes. Branch protection on
  `master` requires CI; pipeline failure and watchdog issues are assigned to the maintainer (e-mail).
- Only the maintainer's own PRs are ever merged without review: `maintenance-merge.yml` (backup for auto-merge)
  merges a `maintenance/*` PR only if it comes from this repository (not a fork), is authored by the repository
  owner's account (the agent acts through it) and CI passed on its current head. GitHub auto-merge can only be
  enabled by users with write access. Workflows of every external contributor's PR need manual approval
  (repository setting), and the default `GITHUB_TOKEN` is read-only. Outside PRs always wait for a human merge.

Rules:
- Scripts in `pipeline/` (Node 20+ + TS, run with `tsx`). No server dependency.
- **One call per resource per run**, `User-Agent` identifying the project and the repo URL, stop on any non-200
  response, no retry loops (at most 1 retry, after 10 min).
- Schema validation (zod) before publication: an invalid or near-empty file (< 50 % of the previous one) does
  **not** overwrite the previous version; the action fails and opens an issue.
- Output: `data/earth/gp-active.json.gz`, `data/earth/satcat.json.gz`, `data/ephem/<mission>.bin`
  (compact Float64: t_TDB, x, y, z, vx, vy, vz) + `data/manifest.json` (timestamp, source, object count, hash).
  The client reads `manifest.json` first.
- Published on an **orphan `data` branch** force-pushed (no history) to avoid bloating the repo, then copied into
  the Pages artifact at deploy time. Same origin → no CORS issue.
- The client caches via Pages `Cache-Control` + a hand-written Service Worker (`public/sw.js`, Cache API,
  production builds only): network-first for pages and `manifest.json`, cache-first for hashed assets and
  versioned data (`?v=<sha>`), stale-while-revalidate for textures; same-origin only. After the first visit the
  page posts the URLs it already loaded so they are cached too. Offline, a badge says data come from the cache.

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
- Lunar orbit (verified 2026-10-03, details and sources in `catalog/missions.json`): LRO (−85), Chandrayaan-2
  orbiter (−152, planned 7-year life reached mid-2026 — re-check), Danuri/KPLO (−155, extended to end 2027),
  ARTEMIS P1/P2 (−192/−193), CAPSTONE (−1176; NASA declared the mission complete 2026-07-06, Advanced Space
  continues flying it commercially (weekly NRHO station-keeping as of mid-2026); **public Horizons ephemeris
  stops 2026-08-14 and has not resumed**, likely permanently now that NASA's DSN-tracked mission has ended —
  re-check periodically), SWC-1/Shams (−168540, Saudi Space Agency cislunar space-weather 12U CubeSat deployed
  during Artemis II, launched 2026-04-01; still tracked in high Earth orbit in October 2026 (NORAD 68540,
  Space-Track elements on N2YO, verified 2026-10-03), but its public Horizons ephemeris stops 2026-04-07, so it is
  `ephemeris: "none"`). No Horizons ephemeris: Queqiao-2,
  Tiandu-2, Queqiao-1 (L2), DRO-A; Tiandu-1 and DRO-B have left lunar orbit (Earth–Moon resonant orbits, 2025).
  ICUBE-Q: presumed lost. **Chang'e-7 did not launch**: August 2026 window lost to Typhoon Narra, postponed to
  2027. Artemis II flew 1–10 April 2026 (ended).
- Mars (verified 2026-09-27, details in `catalog/missions.json`): Mars Odyssey (−53, very low on propellant —
  re-check), Mars Express (−41, extended June 2026), MRO (−74), ExoMars TGO (−143), Hope/EMM (−62, extended to
  2028), Tianwen-1 orbiter (no public ephemeris). MAVEN (−202): lost 2025-12-06, mission declared over
  2026-06-03; Horizons coverage ends 2026-03-01 (shown as last known trajectory). ESCAPADE Blue/Gold: launched
  2025-11-13, waiting near Sun–Earth L2, Earth-departure burns Nov 2026, Mars arrival Sept 2027. MMX (JAXA):
  launch 2026-10-19 19:41 UTC (H3 F10). Phobos (401) and Deimos (402) come from Horizons like the probes.
- Interplanetary (verified 2026-10-03, details in `catalog/missions.json`, heliocentric Horizons IDs): Voyager 1
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
- Mars rover positions come from NASA MMGIS waypoint feeds (`catalog/landing-sites/mars.json` `feed`, daily).

## 14. Code conventions

- TypeScript `strict`, no unjustified `any`. Explicit units in names (`distanceKm`, `tTdbJd`, `angleRad`).
  Never degrees in internal computations.
- Astrodynamics functions are **pure** and tested; no Three.js dependency in `src/astro/`.
- No `localStorage` for large data; the Service Worker's Cache API holds datasets and textures.
- Conventional commits (`feat:`, `fix:`, `data:`, `catalog:`). Any change to `catalog/` must include the source
  in the PR.
- Before adding a dependency: check the license (MIT/BSD/Apache/public domain only; **fonts may also be
  OFL-1.1**, approved by the maintainer on 2026-09-27) and weight. Imagery: public domain / NASA media first;
  CC BY 4.0 (attribution only) allowed where none exists (approved 2026-09-27), credited and labelled if artistic;
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
