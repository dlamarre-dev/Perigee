# Périgée

Open-source, real-time web viewer of artificial objects orbiting the Earth, the Moon, Mars and the solar
system. Every position is computed in the browser from public data; the site is static and hosted on
GitHub Pages. The interface is available in English and French.

> Educational use only — not intended for navigation or conjunction assessment.

## Status

Milestone **M0**: Vite/Three.js skeleton, quaternion orbit camera, textured Earth with a real day/night
terminator, simulation clock (pause, ×1 to ×10,000, jump to date), EN/FR interface. See `CLAUDE.md` §15 for the
roadmap.

## Development

```bash
npm install
npm run dev        # http://localhost:5173/Perigee/
npm run test       # unit tests (Vitest)
npm run build && npm run test:e2e   # smoke tests (Playwright)
npm run lint
npm run textures   # regenerate Earth textures from NASA sources (offline, rarely needed)
```

Controls: left-drag rotates (arcball), right-drag or two-finger twist rolls, wheel/pinch zooms.
Keyboard: arrows rotate, Q/E roll, +/− zoom, R resets the view.

URL parameters: `lang=en|fr`, `frame=fixed|inertial`, `t=<ISO 8601 UTC>`, `rate=<speed>`.

## Credits

See [DATA_SOURCES.md](DATA_SOURCES.md). Code under the [MIT license](LICENSE).
