# perigee-mcp

An [MCP](https://modelcontextprotocol.io/) server for [Perigee](https://perigee.info/), the open-source 3D viewer of the
artificial objects orbiting the Earth, the Moon and Mars and of the spacecraft crossing the solar system. It lets an
AI assistant (a teaching assistant, for example) answer questions such as “how far is Mars from the Earth on
1 December 2026?”, “where is the ISS now?” or “what is Lucy's mission?”, and hand the student a live 3D view, with
**how each number was obtained, from which data, how fresh and how accurate**.

Educational use only: not for navigation, collision avoidance or conjunction assessment.

## Use it

Claude Desktop (`claude_desktop_config.json`) or any MCP client that starts servers over stdio:

```json
{
  "mcpServers": {
    "perigee": { "command": "npx", "args": ["-y", "perigee-mcp"] }
  }
}
```

Claude Code: `claude mcp add perigee -- npx -y perigee-mcp`. Node.js 20 or later.

**Hosted, nothing to install**: the same tools at `https://perigee-mcp.perigeeinfo.workers.dev/mcp` (Streamable HTTP, no account, a budget of 60 units
a minute per address, a tool call costing 1 to 4). Claude.ai: Settings → Connectors → Add custom connector with that URL; Claude Code:
`claude mcp add --transport http perigee https://perigee-mcp.perigeeinfo.workers.dev/mcp`. Distance series are limited to 100 samples, pass searches to 3 days and event searches to 31 days there. The hosted
endpoint keeps a short usage log (tool, object asked about, outcome; never your address or place coordinates; see
the [privacy page](https://perigee.info/privacy.html)).

## Tools

| Tool                      | What it returns                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perigee_find`            | Ids of objects matching a name (English or French): planets, moons, missions, any active Earth satellite (name, NORAD or COSPAR id), sites, stars                                             |
| `perigee_object`          | Facts: agency, country, launch, status, mission goals, identifiers, official website, sources and verification date, image with credit and licence                                            |
| `perigee_state`           | Position and velocity at a date relative to a centre, distance, altitude, speed, light time, sunlight; the ground point below (country or sea on the Earth)                                   |
| `perigee_orbit`           | Perigee and apogee altitudes, period, inclination, eccentricity; regime (LEO, MEO, GEO, HEO) for Earth satellites                                                                             |
| `perigee_passes`          | When an Earth satellite passes over a place: rise, highest point and set with direction and elevation, naked-eye visibility, local times                                                      |
| `perigee_sky`             | The sky from a place at a date: day, twilight or night, the Sun and its next rise and set, the Moon's phase, the planets and bright stars with direction, brightness and naked-eye visibility |
| `perigee_events`          | Moon phases (super and micro full Moons), eclipses (also as seen from a place), equinoxes, solstices, perihelion, planet oppositions, conjunctions and elongations, mission milestones        |
| `perigee_stats`           | Counts of active satellites by owner, operator, constellation, orbit regime, object type, launch year and altitude band                                                                       |
| `perigee_distance`        | Distance between two objects at a date (km, au) and light time                                                                                                                                |
| `perigee_distance_series` | Distances over a period, with the closest and farthest samples                                                                                                                                |
| `perigee_view`            | Link to the 3D view, and an `<iframe>` of the live view for a lesson page (the page can drive it and take PNG snapshots with the `perigee:v1` messages)                                       |
| `perigee_describe_view`   | A Perigee link or embed in words: one-sentence alternative text and a description for lesson notes (view, object and reliability of its position, date, speed of time, frame, filters)        |
| `perigee_define`          | Student-level definitions (EN/FR) of apogee, inclination, NORAD number, ephemeris window…                                                                                                     |
| `perigee_about`           | Data sources and fetch times, models and their typical accuracy, attribution                                                                                                                  |

Every computed answer has a `provenance` list: the model (SGP4 from CelesTrak GP or supplemental GP elements,
Hermite interpolation of JPL Horizons vectors, two-body extrapolation, VSOP87 for planets, analytical or mean-element
moons), the data state (`fresh`, `interpolated`, `stale`, `extrapolated`, `hidden`, `modelled`, `none`), when the data
were fetched, the age of the orbital elements, the ephemeris window, and a typical accuracy with its basis.

## Data

Positions are computed on your machine with the same code as the web app, from the data Perigee publishes at
`https://perigee.info/data/` (CelesTrak elements refreshed every 4 hours, JPL Horizons ephemerides daily). Each
dataset version is downloaded once and kept in a cache (`%LOCALAPPDATA%\perigee-mcp`, `~/Library/Caches/perigee-mcp`
or `~/.cache/perigee-mcp`; `PERIGEE_MCP_CACHE` overrides it). The server never contacts CelesTrak or Horizons.
`PERIGEE_SITE` points it to another Perigee deployment.

Credits: CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track, NASA/JPL-Caltech Horizons, astronomy-engine (MIT),
satellite.js (MIT); catalogue images under the licence given with each. Code: MIT, https://github.com/dlamarre-dev/Perigee.
