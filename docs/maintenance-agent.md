# Weekly maintenance agent — procedure

This file is the instruction set of the scheduled Claude Code routine that keeps Perigee's curated catalog up
to date (Saturday 02:00 America/Toronto). It is owned by the maintainer: the agent follows it and **never
edits it**. Read `CLAUDE.md` first; its rules apply, especially §2 (principles), §4 (sources and providers) and
§13 (statuses to re-check).

## Goal

Resolve what the Friday audit found (`data/audit.json`), refresh statuses that are due for re-verification, and
publish the changes through a pull request that merges itself once CI passes. The maintainer should not have
to do anything unless you explicitly ask for help.

## Steps

1. Set up: `npm ci`, then `npm run data:pull`. Read `public/data/audit.json` and `public/data/audit.md`
   (published by the `Data — maintenance audit` workflow on Friday 21:00 UTC). If they are older than 3 days
   or missing, say so in the report and continue with step 3 only.
2. For each audit item, research and edit the catalog:
   - `deep-space-candidate`: decide whether the payload belongs in `catalog/missions.json` (an active
     probe or orbiter around the Moon, Mars, a Lagrange point or the Sun). If yes, add a complete entry: the
     Horizons ID comes from the audit, `details.horizonsMatches` in `audit.json` (looked up in GitHub Actions
     by COSPAR designation, then by name); use it only when the match clearly is this spacecraft. Without a
     match, add the entry with `"ephemeris": "none"` (listed, not drawn) and say so in the report. Also
     fill in `sampling` following CLAUDE.md §4.3, `norad`, the EN and FR names, the agency, the country,
     the launch date, `status`, `sources` and `verified`. If it does not belong (a relay test, a failed
     launch…), note why in the report.
   - `launch-site-code`: either add a site to `catalog/launch-sites.json` (verified coordinates with
     sources) or add the code to `unplacedSatcatCodes` with a reason. The official list of codes is
     `https://celestrak.org/satcat/launchsites.php` (one request).
   - `owner-code`: add the label (EN/FR, ISO country) to `catalog/operators.json` `owners`, using
     `https://celestrak.org/satcat/sources.php` (one request).
   - `celestrak-group`: add the group to `operators.json` `groups` (a constellation run by one operator, with
     its `operator` link) or to `ignoredGroups` with a reason.
   - `celestrak-supgp`: a new CelesTrak supplemental GP set (SGP4 fits to operator ephemerides). Add it to
     `operators.json` `supplemental` (EN/FR label naming the operator, `sources` with the SupGP page and the
     operator's data page) when it covers operational satellites of the GP "active" group, or to
     `ignoredSupplemental` with a reason (laser-ranging predictions, a launch's temporary post-deployment set
     once its satellites are in the regular sets).
   - `supgp-stale`: a SupGP set the pipeline could not refresh for days (its errors only warn). Check the
     set's page on CelesTrak: if it was discontinued or renamed, move it to `ignoredSupplemental` (or rename the
     key) with the source; if CelesTrak still lists it, do not change the catalog and mention it to the
     maintainer in the report (the pipeline may be refused by CelesTrak).
   - `ephemeris-ending` / `ephemeris-ended-active` and `stale-verification`: check the mission's current
     status on the agency's own pages (news, mission page), then update `status`, `phase`, `nextEvent`,
     `notes` and `sources`, and set `verified` to today. An ended mission keeps its entry with `status:
"ended"`: never delete entries. Every active mission comes back about once a month (the audit lists at most
     15 per week, oldest first; `missions:deferred` lists the rest, handled in the next weeks): even when
     nothing changed, set `verified` to today and add or keep the page you checked in `sources`.
   - Hosted payloads (every week, even without an audit item): check the sources of `operators.json`
     `hostedPayloads` (e.g. the GHGSat series page on Gunter's Space Page) for newly launched instruments, and add
     each one with the host's NORAD number (look it up in `public/data/earth/satcat.json.gz` by COSPAR designation),
     the payload name and sources. Satellites carrying the operator's name are already covered by `nameRules`.
   - `earth-science-member`: a new member of the CelesTrak `science` group. Add it to `catalog/earth-science.json`
     with the name the public knows (acronym in parentheses), agency, country, launch date, status, purpose, notes,
     official sources and `verified`. Stale `earth-science:<id>` items are re-verified like missions (status,
     notes, sources).
   - `moon-anchor`: run `npm run moons:anchor` (three Horizons requests per listed moon, a few seconds apart),
     then `npm run test` (the moons test compares positions with Horizons). It rewrites the epoch angles, the
     mean motion, `verified` and the Horizons source of each mean-element moon in `catalog/moons.json`.
   - `leap-second`: update `src/astro/leapSeconds.ts` from the IERS file, including its "Last checked" line.
3. Refresh the "Known statuses" summary in `CLAUDE.md` §13 for the missions you changed (same format and
   dates).
4. Sources: official agency pages first (NASA, ESA, JAXA, CNSA, ISRO, KASA, UAE Space Agency…), NASA NSSDCA,
   LROC. Wikipedia only as a last resort. Every added or changed entry cites at least one https URL. If the
   sources disagree, or you cannot confirm something, **do not guess**: leave the entry unchanged and list it
   under "Needs a human" in the report.
5. Check: `npm run lint && npm run test`. Fix your own mistakes; never weaken tests or schemas.
6. Publish, if anything changed:
   - branch `maintenance/<YYYY-MM-DD>`, one commit `catalog: weekly maintenance <date>` (conventional
     commits, English);
   - a pull request whose body is the change report: one line per entry (what changed, why, sources), then
     "Needs a human" (or "Nothing");
   - `gh pr merge --auto --squash <number>`. CI (`catalog-guard`, lint, tests, e2e) must pass before it
     merges.
7. Report, every week, even when nothing changed: a comment on the open issue labelled
   `maintenance-report` (create it and pin it if it does not exist). The comment gives the date, the number of
   audit items, what was changed with the PR link, and what needs a human. Start the comment with
   `@dlamarre-dev` **only** when something needs a human, so e-mail alerts stay meaningful.

## Rules

- Allowed files: `catalog/**/*.json`, `CLAUDE.md` (§13 only) and `src/astro/leapSeconds.ts`. The
  `catalog-guard` CI job rejects anything else, deleted entries, missing or non-https sources, changes without a
  new `verified` date, and more than 40 changed entries.
- Never call CelesTrak GP endpoints (`gp.php`), JPL Horizons (`ssd.jpl.nasa.gov`) or IERS: the Actions pipeline
  owns them and the audit already brings what you need. One exception: `npm run moons:anchor`, only for a
  `moon-anchor` audit item (about once a year), run once. The other CelesTrak pages listed above: one request each.
- If the network blocks a source, try another official one; if nothing can be read, do not guess: list the item
  under "Needs a human".
- Never push to `master` directly, never disable checks, never merge a PR whose CI failed.
- Language: code, catalog `en` fields, commit and PR text in English; `fr` fields in French (Quebec
  typography: a non-breaking space before `:`). Every text a visitor reads (names, `note`, `notes`, `orbit`,
  `purpose`…) has both an `en` and an `fr` value, including source notes on landing sites; translate when
  adding or editing one.
- Budget: stop after about 25 researched items (re-verifications included); carry the rest over to next week in
  the report.
