/**
 * Load test of the MCP endpoint: a mix of realistic tool calls (stateless JSON-RPC posts, like an AI service
 * makes) at a fixed rate and concurrency, with latency percentiles, HTTP statuses (429 rate limit, 5xx, Cloudflare
 * error 1102 "exceeded CPU") and tool errors per tool. Requests carry the User-Agent "perigee-loadtest", which the
 * usage log records, so they can be told apart from real use.
 *
 *   npx tsx tools/loadtest/mcp-load.ts                                  # local `wrangler dev` (127.0.0.1:8787)
 *   npx tsx tools/loadtest/mcp-load.ts --requests 400 --rate 8 --concurrency 6
 *   npx tsx tools/loadtest/mcp-load.ts --url https://perigee-mcp.perigeeinfo.workers.dev/mcp --remote
 *
 * Against the hosted endpoint (--remote): at most 600 requests and 4 per second, below the per-address limit of
 * 300 a minute; each request counts in the free plan's 100,000 a day. A local `wrangler dev` does not enforce the
 * CPU limit: the CPU figures that matter are in the Cloudflare dashboard (Workers → perigee-mcp → Metrics).
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8787/mcp' },
    requests: { type: 'string', default: '200' },
    rate: { type: 'string', default: '4' },
    concurrency: { type: 'string', default: '4' },
    remote: { type: 'boolean', default: false },
    seed: { type: 'string', default: '1' },
  },
});

const url = new URL(values.url);
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
if (!local && !values.remote) {
  console.error('Refusing a non-local endpoint without --remote (see the header of this file).');
  process.exit(2);
}
const requests = Math.min(Number(values.requests), local ? 100_000 : 600);
const rate = Math.min(Number(values.rate), local ? 1000 : 4);
const concurrency = Math.max(1, Number(values.concurrency));

// A small deterministic generator, so two runs send the same mix.
let state = Number(values.seed) >>> 0 || 1;
const random = (): number => (state = (state * 1_664_525 + 1_013_904_223) >>> 0) / 2 ** 32;
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;

const SATELLITES = [
  '25544',
  '48274',
  '20580',
  '43013',
  '100830',
  '44713',
  '28654',
  '41866',
  '27424',
  '25994',
];
const PLACES = [
  { latitude: 45.5, longitude: -73.57, time_zone: 'America/Toronto' },
  { latitude: 48.86, longitude: 2.35, time_zone: 'Europe/Paris' },
  { latitude: -33.87, longitude: 151.21, time_zone: 'Australia/Sydney' },
  { latitude: 35.68, longitude: 139.69, time_zone: 'Asia/Tokyo' },
  { latitude: -23.55, longitude: -46.63, time_zone: 'America/Sao_Paulo' },
];
const BODIES = ['earth', 'mars', 'moon', 'jupiter', 'voyager-1', 'lro', 'mro', 'psyche', 'saturn'];

/** Weighted mix of tool calls (weights roughly what a teaching assistant would ask). */
const MIX: [number, () => [string, Record<string, unknown>]][] = [
  [
    10,
    () => [
      'perigee_find',
      { query: pick(['iss', 'hubble', 'mars', 'lucy', 'starlink', 'apollo', 'titan', 'zarya']) },
    ],
  ],
  [14, () => ['perigee_state', { id: pick([...SATELLITES, ...BODIES]) }]],
  [
    10,
    () => [
      'perigee_object',
      { id: pick([...SATELLITES, 'lro', 'voyager-1', 'site:apollo-11', 'mars']), lang: pick(['en', 'fr']) },
    ],
  ],
  [8, () => ['perigee_orbit', { id: pick([...SATELLITES, 'lro', 'mro', 'mars']) }]],
  [12, () => ['perigee_distance', { from: pick(BODIES), to: pick(BODIES) }]],
  [
    4,
    () => [
      'perigee_distance_series',
      {
        from: 'earth',
        to: pick(['mars', 'jupiter', 'venus']),
        start: '2026-10-01T00:00:00Z',
        end: '2027-10-01T00:00:00Z',
        steps: 60,
      },
    ],
  ],
  [
    12,
    () => ['perigee_passes', { id: pick(SATELLITES.slice(0, 4)), ...pick(PLACES), days: pick([1, 2, 3]) }],
  ],
  [8, () => ['perigee_sky', { ...pick(PLACES), lang: pick(['en', 'fr']) }]],
  [6, () => ['perigee_events', { days: pick([7, 14, 31]), lang: pick(['en', 'fr']) }]],
  [4, () => ['perigee_stats', pick([{}, { operator: 'spacex' }, { owner: 'PRC' }])]],
  [4, () => ['perigee_view', { id: pick(BODIES), embed: true }]],
  [
    4,
    () => [
      'perigee_describe_view',
      { url: `https://perigee.info/?view=solar&sel=${pick(['mars', 'jupiter', 'voyager-1'])}&follow=1` },
    ],
  ],
  [
    4,
    () => [
      'perigee_define',
      { term: pick(['apogee', 'inclination', 'norad', 'période']), lang: pick(['en', 'fr']) },
    ],
  ],
];
const total = MIX.reduce((s, [w]) => s + w, 0);
const nextCall = (): [string, Record<string, unknown>] => {
  let r = random() * total;
  for (const [w, make] of MIX) if ((r -= w) <= 0) return make();
  return (MIX[0] as (typeof MIX)[number])[1]();
};

interface Result {
  readonly tool: string;
  readonly ms: number;
  readonly status: number;
  readonly outcome: 'ok' | 'tool-error' | 'rpc-error' | 'http-error' | 'cpu-exceeded' | 'network';
}

async function send(id: number): Promise<Result> {
  const [tool, args] = nextCall();
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': '2025-06-18',
        'User-Agent': 'perigee-loadtest/1 (+https://github.com/dlamarre-dev/Perigee)',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) {
      const outcome = /1102|exceeded/i.test(text) ? 'cpu-exceeded' : 'http-error';
      return { tool, ms, status: res.status, outcome };
    }
    const body = JSON.parse(text) as { error?: unknown; result?: { isError?: boolean } };
    return {
      tool,
      ms,
      status: res.status,
      outcome: body.error ? 'rpc-error' : body.result?.isError ? 'tool-error' : 'ok',
    };
  } catch {
    return { tool, ms: performance.now() - t0, status: 0, outcome: 'network' };
  }
}

const results: Result[] = [];
const started = performance.now();
let issued = 0;
async function worker(): Promise<void> {
  while (issued < requests) {
    const id = ++issued;
    // Pace the whole run at `rate` requests per second.
    const due = started + ((id - 1) / rate) * 1000;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    results.push(await send(id));
    if (results.length % 50 === 0) console.log(`${results.length}/${requests}…`);
  }
}
console.log(`${requests} requests to ${url.href} at ${rate}/s, concurrency ${concurrency}`);
await Promise.all(Array.from({ length: concurrency }, worker));
const seconds = (performance.now() - started) / 1000;

const pct = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const summary = (list: Result[]) => {
  const ms = list.map((r) => r.ms).sort((a, b) => a - b);
  const count = (o: Result['outcome']) => list.filter((r) => r.outcome === o).length;
  return {
    n: list.length,
    ok: count('ok'),
    toolErr: count('tool-error'),
    rpcErr: count('rpc-error'),
    http: count('http-error'),
    cpu: count('cpu-exceeded'),
    net: count('network'),
    p50: Math.round(pct(ms, 50)),
    p90: Math.round(pct(ms, 90)),
    p99: Math.round(pct(ms, 99)),
    max: Math.round(ms[ms.length - 1] ?? 0),
  };
};
const statuses: Record<string, number> = {};
for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(
  `\n${results.length} requests in ${seconds.toFixed(1)} s (${(results.length / seconds).toFixed(1)}/s); HTTP ${JSON.stringify(statuses)}`,
);
console.table({
  all: summary(results),
  ...Object.fromEntries(
    [...new Set(results.map((r) => r.tool))]
      .sort()
      .map((t) => [t, summary(results.filter((r) => r.tool === t))]),
  ),
});
const failures = results.filter((r) => r.outcome !== 'ok' && r.outcome !== 'tool-error').length;
process.exit(failures > 0 ? 1 : 0);
