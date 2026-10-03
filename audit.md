Maintenance audit, 2026-10-03 00:06 UTC.

### Launch site codes not in catalog/launch-sites.json (1)

- [ ] SATCAT launch site code STARB (26 active objects) is not in catalog/launch-sites.json

### Deep-space payloads not in catalog/missions.json (1)

- [ ] NGRST (2026-199A, launched 2026-08-30, orbit centre SU) is not in catalog/missions.json

### Ephemerides ended while the mission is listed as active (2)

- [ ] CAPSTONE: public Horizons ephemeris ended 2026-08-14 but status is "active" — check whether the mission ended or the ephemeris is just late
- [ ] SWC-1 (Shams): public Horizons ephemeris ended 2026-04-07 but status is "active" — check whether the mission ended or the ephemeris is just late

### Moon mean elements due for re-anchoring (1)

- [ ] 4 moons were anchored more than 365 days ago (io, europa, ganymede, callisto): run npm run moons:anchor

Machine-readable version: `data/audit.json` on the `data` branch.
