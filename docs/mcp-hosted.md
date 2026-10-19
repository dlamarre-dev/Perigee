# Hosted MCP endpoint (Cloudflare Workers)

`workers/mcp/` serves the same tools as the npm package `perigee-mcp` over MCP's Streamable HTTP transport, for AI
services that cannot start a local server (Claude.ai custom connectors, web-based assistants). It is stateless (one
MCP server per request, JSON responses), reads Perigee's published data from https://perigee.info/ like the npm
package, keeps the raw files in the data centre's Cache API by content hash and the parsed datasets in memory, and
never contacts CelesTrak or Horizons. Request logs are off; the caller's IP address is only used by the per-IP rate
limiter (60 requests per minute, in memory at Cloudflare).

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
