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

## Tools

| Tool                      | What it returns                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perigee_find`            | Ids of objects matching a name (English or French): planets, moons, missions, any active Earth satellite (name, NORAD or COSPAR id), sites, stars       |
| `perigee_object`          | Facts: agency, country, launch, status, mission goals, identifiers, official website, sources and verification date, image with credit and licence      |
| `perigee_state`           | Position and velocity at a date relative to a centre, distance, altitude, speed, light time                                                             |
| `perigee_distance`        | Distance between two objects at a date (km, au) and light time                                                                                          |
| `perigee_distance_series` | Distances over a period, with the closest and farthest samples                                                                                          |
| `perigee_view`            | Link to the 3D view, and an `<iframe>` of the live view for a lesson page (the page can drive it and take PNG snapshots with the `perigee:v1` messages) |
| `perigee_define`          | Student-level definitions (EN/FR) of apogee, inclination, NORAD number, ephemeris window…                                                               |
| `perigee_about`           | Data sources and fetch times, models and their typical accuracy, attribution                                                                            |

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
