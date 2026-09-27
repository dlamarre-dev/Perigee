# Périgée

Open-source, real-time web viewer of artificial objects orbiting the Earth, the Moon, Mars and the solar
system. Every position is computed in the browser from public data; the site is static and hosted on
GitHub Pages. The interface is available in English and French.

> Educational use only — not intended for navigation or conjunction assessment.

## Status

- **M0** — Vite/Three.js skeleton, quaternion orbit camera, textured Earth with a real day/night terminator,
  simulation clock (pause, ×1 to ×10,000, jump to date), EN/FR interface.
- **M1** — Earth view: every active catalogued satellite (~16.6k) propagated with SGP4 in Web Workers from
  CelesTrak OMM data, GPU picking, info panel, faceted filters (operator, country, group, orbit, type), text
  search, orbit trace, follow mode, shareable URL state. Data mirrored by GitHub Actions to the `data` branch.
- **M2** — Moon view: lunar orbiters from JPL Horizons ephemerides (Hermite interpolation, two-body
  extrapolation shown as such), 52 sourced landing and impact sites, the Earth at its true position, curated
  mission catalogue with statuses (`catalog/missions.json`).
- Earth view also shows 30 orbital launch sites; the launch-site facet filters satellites by where they were
  launched.

See `CLAUDE.md` §15 for the roadmap.

## Development

```bash
npm install
npm run data:pull  # download the latest published data (from the `data` branch on GitHub)
npm run dev        # http://localhost:5173/Perigee/
npm run test       # unit tests (Vitest), incl. Vallado SGP4 verification
npm run build && npm run test:e2e   # end-to-end tests (Playwright, fixture data)
npm run lint
npm run textures   # regenerate Earth textures from NASA sources (offline, rarely needed)
```

`npm run data:fetch` runs the pipeline against CelesTrak directly. Avoid it: CelesTrak enforces a strict usage
policy, and a local guard refuses to fetch the same resource twice within 2 h. Prefer `data:pull`.

Controls: left-drag rotates (arcball), right-drag or two-finger twist rolls, wheel/pinch zooms, click selects
an object, double-click selects and follows it. Keyboard: arrows rotate, Q/E roll, +/− zoom, R resets the view.

URL parameters: `view=earth|moon`, `lang=en|fr`, `frame=fixed|inertial`, `t=<ISO 8601 UTC>`, `rate=<speed>`, `sel=<NORAD>`,
`q=<search>`, and filters `op`, `own`, `grp`, `reg`, `type`, `site` (comma-separated values); `sel=site:<id>`, `ls=0`. Moon view: `sel=<mission>` or
`sel=site:<id>`, `sites=0`.

## Credits

See [DATA_SOURCES.md](DATA_SOURCES.md). Code under the [MIT license](LICENSE).
