# Hosted MCP endpoint (Cloudflare Workers)

`workers/mcp/` serves the same tools as the npm package `perigee-mcp` over MCP's Streamable HTTP transport, for AI
services that cannot start a local server (Claude.ai custom connectors, web-based assistants). It is stateless (one
MCP server per request, JSON responses), reads Perigee's published data from https://perigee.info/ like the npm
package, keeps the raw files in the data centre's Cache API by content hash and the parsed datasets in memory, and
never contacts CelesTrak or Horizons. It writes one usage line per request to Workers Logs (tool, object id, outcome,
duration, client name, country; never the IP address or place coordinates; see
[machine-interface.md](machine-interface.md#observability)); the caller's IP address is only used by the per-IP rate
limiter (60 units a minute per address, in memory at Cloudflare; see [Abuse and availability](#abuse-and-availability)).

Deployed at <https://perigee-mcp.perigeeinfo.workers.dev> (account subdomain `perigeeinfo`): `GET /` describes the
server; `/mcp` is the MCP endpoint (POST; CORS open).

## CPU budget (free plan)

Cloudflare's free Workers plan allows 10 ms of CPU per request. Decoding the whole Earth-satellite file takes about
120 ms, so the pipeline also publishes it split by NORAD number (256 shards of ~65 satellites, `shards` in the
manifest entries of `earth.gp` and `earth.satcat`) with a text name index (`names`), and the engine reads only the
shard or the index it needs (`src/data/shards.ts`, `PublishedData.satelliteElements`, `searchSatellites`). Measured
on a desktop through the Worker handler, with a fresh engine (a new isolate) and the files already downloaded:
satellite state or facts 2–3 ms, name search ~6 ms (1–1.5 ms once the index is loaded), planets and probes under
2 ms, a 100-sample distance series with a satellite ~8 ms (the Worker caps series at 100 samples), satellite passes
over a place ~5.5 ms for 3 days (the Worker caps searches at 3 days; the npm package allows 10), the sky from a
place ~6 ms, a month of events ~5 ms (the Worker caps event searches at 31 days; the npm package allows 366),
satellite statistics ~1 ms. The first request of a new isolate also pays the JavaScript engine's warm-up of
astronomy-engine (tens of milliseconds); Cloudflare has tolerated it so far. Waiting for a
download does not count as CPU. The Workers Paid plan (5 USD per month, 30 s of CPU) is only needed if Cloudflare's
servers turn out slower than these measurements.

## Setup (once)

1. **Account**: create a Cloudflare account (<https://dash.cloudflare.com/sign-up>), then open Workers & Pages once
   to choose the account's `workers.dev` subdomain (e.g. `perigee`). The free plan is enough (see above).
2. **Account id**: Workers & Pages → Overview, right column "Account ID".
3. **API token**: My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers** → limit it to this
   account (Account Resources) and, under Zone Resources, "All zones" is not needed (no zone is used) → Create.
4. **GitHub secrets** (repository → Settings → Secrets and variables → Actions → New repository secret):
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. **First deployment**: Actions → "MCP worker" → Run workflow (later pushes deploy by themselves when
   `workers/mcp`, `mcp/src`, the engine, the astro code or the catalogues change). The log ends with the URL,
   `https://perigee-mcp.<subdomain>.workers.dev`.
6. Check it: open that URL (it answers a short JSON description), then add it to an MCP client, e.g.
   `claude mcp add --transport http perigee-remote https://perigee-mcp.<subdomain>.workers.dev/mcp`, or Claude.ai →
   Settings → Connectors → Add custom connector with the `/mcp` URL.
7. Tell the maintainer's agent (or edit by hand) the final URL, so it is added to `public/llms.txt`,
   `mcp/README.md` and `src/engine/apiDocs.ts` (`interface.json`).

Local run: `cd workers/mcp && npm install && npx wrangler dev` (http://127.0.0.1:8787/mcp).

## Custom domain (optional, later)

A Worker can answer on `mcp.perigee.info` only if the `perigee.info` DNS zone is on Cloudflare. It is at Spaceship
today (`launch1/launch2.spaceship.net`). To move it: add the site to Cloudflare (free plan), check that the imported
records include GitHub Pages' (`A` 185.199.108–111.153 and the `www` CNAME, if any), switch the nameservers at
Spaceship to Cloudflare's, wait for activation, keep the GitHub Pages records "DNS only" (grey cloud) so Pages keeps
issuing its certificate, then add to `workers/mcp/wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "mcp.perigee.info", "custom_domain": true }]
```

## Costs and limits

Free plan: 100,000 requests per day. The rate limit (`ratelimits` in `wrangler.jsonc`) caps each address at 60
requests per minute; change `limit`/`period` there. Data downloads come from GitHub Pages once per dataset version
and data centre (Cache API), not per request.

## Usage log and load tests

The usage log, the dashboard queries and the load-test tool (`npm run mcp:load`) are described in
[machine-interface.md](machine-interface.md#observability). Workers Logs must stay with invocation logs off
(`wrangler.jsonc`): those record request headers, IP addresses included.

## Abuse and availability

The free plan allows **100,000 requests a day** for the whole endpoint; beyond, Cloudflare answers error 1027 to
everyone until 00:00 UTC. Every request counts, refused ones included. The protections aim at keeping one caller
from taking the service down, at seeing trouble early, and at reacting in minutes without a commit.

| Protection         | Setting                                                                           | Effect                                                                                         |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Per-address budget | 60 units a minute (`wrangler.jsonc`, binding `LIMITER`)                           | One address sends at most 86,400 requests a day: it alone cannot use up the quota.             |
| Cost per tool      | `TOOL_COST` (`handler.ts`): series 4, passes 3, events 3, sky 2, find 2, others 1 | Hammering the most expensive tools exhausts the budget sooner.                                 |
| Batches            | at most 4 JSON-RPC messages, each charged (`MAX_BATCH`)                           | A batch cannot bypass the per-request count.                                                   |
| Work per call      | series ≤ 100 samples, passes ≤ 3 days, events ≤ 31 days                           | Each call stays within 10 ms of CPU.                                                           |
| Body size          | 64 KB                                                                             |                                                                                                |
| Egress             | images only from `https://perigee.info/images/`; data only from perigee.info      | The Worker fetches nothing else.                                                               |
| Alerts             | `mcp-monitor.yml`, hourly                                                         | An issue when today's requests pass 70 % of the quota, or on CPU-limit (1102) or error spikes. |
| Logs               | one line per request, ≤ 1 line per invocation                                     | Bounded by the request quota (100,000) below the logs' 200,000 a day.                          |

What these do not cover:

- **Many addresses** (a botnet, IPv6 addresses rotated within a range): the budget is per address. Cloudflare's rate
  limiting binding only counts over 10 or 60 seconds, so a daily per-address limit would need a Durable Object
  counter (more latency, its own quota): not done.
- **Shared addresses**: AI services (Claude.ai…) call from a few server addresses shared by all their users; if
  their users are refused (429 in the logs with their `agent`), raise the budget.
- **CORS is open** (`*`) so browser-based MCP clients work; a web page could make its visitors' browsers call the
  endpoint, each counted at its own address.

### Playbook

When `mcp-monitor.yml` opens an issue, or users report failures:

1. **Look.** The issue gives today's requests, the quota share and the last hour's statuses. Dashboard →
   Workers & Pages → perigee-mcp → **Metrics** (requests, errors, CPU) and **Observability → Logs**: group by
   `calls[0].tool`, `agent`, `country`, `rateLimited` to see who and what.
2. **Switch off the expensive tools** (seconds, no commit): dashboard → perigee-mcp → **Settings → Variables and
   Secrets** → add or edit the text variable `PERIGEE_MCP_DISABLED_TOOLS` = `series,passes,events,sky` (tool names or
   their ends) → Deploy. They leave the tool list and calls to them fail; the others keep working. The variable
   survives deployments (`keep_vars`).
3. **Pause the endpoint** if the quota is about to run out: `PERIGEE_MCP_DISABLED_TOOLS` = `*`. Every call is then
   answered at once with 503 and a pointer to the local server (`npx -y perigee-mcp`); requests still count, but
   cost nothing. The quota resets at 00:00 UTC.
4. **Tighten the budget** if one address or a few are the cause: lower `limit` in `wrangler.jsonc` (or raise
   `TOOL_COST`) and push (the `MCP worker` workflow deploys in a minute).
5. **If it keeps happening**: the Workers Paid plan (5 USD a month: 10 million requests a month, no daily cap,
   30 s of CPU) moves the wall far away; moving the perigee.info DNS zone to Cloudflare would also allow WAF rate
   limiting rules (longer windows, per-country rules) on a custom domain.
6. **Afterwards**: remove the variable (or set it empty), note what happened in the issue and close it.
