# Perigee

**Perigee** shows, in real time, the artificial objects orbiting the Earth, the Moon and Mars, and the
spacecraft travelling through the solar system. Every position is computed in your browser from public data
(CelesTrak, NASA/JPL Horizons, astronomy-engine). The site works in English and French (_Périgée_) and keeps
working offline once visited.

**→ [Open Perigee](https://dlamarre-dev.github.io/Perigee/)**

> Educational use only — not intended for navigation or conjunction assessment.

## What you can see

| View             | Contents                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Earth**        | Every active catalogued satellite (~16,000), propagated with SGP4 from CelesTrak elements refreshed every 4 hours, and 30 orbital launch sites.              |
| **Moon**         | Active lunar orbiters from JPL Horizons ephemerides, the Earth at its true position, and 50+ landing and impact sites.                                       |
| **Mars**         | Mars orbiters, Phobos and Deimos, landing sites and the latest positions of the Curiosity and Perseverance rovers.                                           |
| **Solar system** | The Sun, the planets, five dwarf planets and 20+ interplanetary spacecraft, with distances and light travel time. An optional logarithmic scale fits it all. |

Click any object to open its panel: identifiers (NORAD, COSPAR, Horizons), operator, country, launch date,
status, orbit, and where its position comes from. Positions that are **extrapolated** beyond their data, or
based on **stale** elements, are drawn dimmed or dashed and flagged in the panel.

## Using it

- **Rotate**: left-drag, or the arrow keys. **Roll**: right-drag, two-finger twist, or Q/E.
- **Zoom**: mouse wheel, pinch, or +/−. **Reset**: R or the _Recenter_ button.
- **Select**: click an object, or pick it in the side panel list. **Follow**: double-click it.
- **Time**: pause, run at ×1 to ×100,000 (×10,000 in the Earth view), go back to _Now_, or jump to any date.
- **Frame**: body-fixed (the body stays still) or inertial (the body turns, orbits stay fixed).
- **Filters** (Earth view): operator, country, constellation group, orbit (LEO, MEO, GEO, HEO), object type,
  launch site, plus text search by name, NORAD number or COSPAR ID.
- **Install**: your browser can install Perigee as an app; after a first visit it opens offline with the data
  it last downloaded (a badge tells you when you are offline).

### Sharing a view

The address bar always describes what you see, so a link reproduces it:

| Parameter                                      | Meaning                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `view=earth\|moon\|mars\|solar`                | View                                                                                   |
| `lang=en\|fr`                                  | Language                                                                               |
| `frame=fixed\|inertial`                        | Reference frame                                                                        |
| `t=<ISO 8601 UTC>`, `rate=<n>`                 | Simulated time and speed (absent: live)                                                |
| `sel=<id>`                                     | Selected object: NORAD number (Earth), mission or planet id, or `site:<id>` for a site |
| `q`, `op`, `own`, `grp`, `reg`, `type`, `site` | Earth-view search and filters (comma-separated values)                                 |
| `ls=0`, `sites=0`                              | Hide launch sites (Earth) or landing sites (Moon, Mars)                                |
| `log=1`                                        | Logarithmic distances in the solar-system view                                         |

## Data and credits

Satellite elements come from [CelesTrak](https://celestrak.org) (T.S. Kelso); spacecraft ephemerides from
[NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); planet positions from
[astronomy-engine](https://github.com/cosinekitty/astronomy); imagery from NASA and USGS. A GitHub Actions
pipeline mirrors the data (your browser never contacts these providers), and every mission, site and status is
curated with its sources in [`catalog/`](catalog/). Full list: [DATA_SOURCES.md](DATA_SOURCES.md).

Created by David Fugère-Lamarre. Code under the [MIT license](LICENSE).

## Contributing

Corrections to missions, statuses and sites are especially welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the development setup (`npm install`, `npm run data:pull`, `npm run dev`) and the project rules.
