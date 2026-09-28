# Contributing to Perigee

Thanks for helping! Perigee is a static site: every position is computed in the browser, and GitHub Actions only
mirrors public data. `CLAUDE.md` is the full design reference; this page is the short version.

## Ground rules

- **English** for code, comments, commit messages and documentation. The interface is bilingual: every
  user-facing string goes in `src/i18n/en.ts` **and** `src/i18n/fr.ts` (the unit tests fail if keys differ).
  French follows Quebec typography: a non-breaking space (U+00A0) before `:`, none before `; ! ?`.
- **Never call CelesTrak or JPL Horizons from the browser**, and never loop against them from scripts. Use
  `npm run data:pull` to get data for development; `npm run data:fetch` is for pipeline work only, and a local
  guard refuses repeated CelesTrak fetches within 2 h. Any non-200 response must stop the script.
- **No mission list in code.** Missions, landing sites, launch sites and operators live in `catalog/*.json`.
- **Visual honesty.** Extrapolated, modelled or stale positions must look different and say so in the panel.
- **Dependencies**: MIT, BSD, Apache-2.0 or public domain only (fonts: OFL-1.1). Check the size too.
- **Textures and data**: public domain or NASA media first; attribution-only CC BY 4.0 where nothing public
  exists (credit it in `DATA_SOURCES.md` and the About panel, and label artistic maps in the interface). Never
  non-commercial (NC), no-derivatives (ND) or "ask permission" terms.

## Setup

```bash
npm install
npm run data:pull   # latest published data into data/
npm run dev         # http://localhost:5173/Perigee/
```

Before opening a PR:

```bash
npm run lint        # ESLint + Prettier (npm run format fixes formatting)
npm run test        # Vitest: reference values (SGP4 Vallado, Hermite, rotations, contrast…)
npm run build && npm run test:e2e   # Playwright on the production build with fixture data
```

## Catalog changes (`catalog/`)

Every entry cites at least one source (agency page first; Wikipedia only as a last resort) and carries a
`verified: YYYY-MM-DD` date. For Horizons IDs, **resolve them with**
`https://ssd.jpl.nasa.gov/api/horizons_lookup.api?sstr=<name>` — never guess. Put the source URLs in the PR
description too. Commit prefix: `catalog:`.

Landing sites use planetocentric latitude / east longitude in degrees; add a `note` when the position is
uncertain (predicted, never imaged…).

## Weekly maintenance

A Friday audit (`Data — maintenance audit` workflow) lists what the catalog is missing; on Saturday a scheduled
agent follows [docs/maintenance-agent.md](docs/maintenance-agent.md), opens a `maintenance/<date>` pull request
and reports on the pinned `maintenance-report` issue. Its pull requests merge automatically once CI passes,
including the `catalog-guard` job (curated files only, sources, no deletions). Human contributions follow the
same rules but are always reviewed and merged by the maintainer: nothing from a fork is merged automatically, and
CI on pull requests from outside contributors starts after the maintainer approves it. To change how the agent works, edit `docs/maintenance-agent.md` (the agent itself may not).

## Code conventions

- Strict TypeScript, no unjustified `any`. Units in names (`distanceKm`, `tTdbJd`, `angleRad`); radians
  internally, degrees only at the edges (catalog, display).
- `src/astro/` is pure (no Three.js, no DOM) and unit-tested against published reference values.
- Custom `ShaderMaterial`s that depth-test include the `logdepthbuf_*` chunks (all views use a logarithmic depth
  buffer); positions go to the GPU relative to the camera (Float64 on the CPU).
- Conventional commits: `feat:`, `fix:`, `docs:`, `data:`, `catalog:`, `chore:`, `test:`.

## Textures

`npm run textures [body…]` downloads the sources listed in `tools/textures/fetch-textures.ts` into
`tools/textures/src/` (git-ignored) and writes WebP and KTX2 derivatives into `public/textures/`. The levels
written for each body are declared once in `src/render/textureLevels.ts`, which the client reads too. Add new
sources to `DATA_SOURCES.md`.

## Accessibility

Keep panels usable with the keyboard, keep the text list in sync with what the 3D view shows, and check colours
against the contrast test (`tests/contrast.test.ts`, WCAG AA). Animations honour `prefers-reduced-motion`.

## Licence

By contributing you agree that your code is released under the [MIT licence](LICENSE).
