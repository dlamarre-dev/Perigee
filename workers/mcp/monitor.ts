/**
 * Usage monitor of the hosted MCP endpoint (run every hour by .github/workflows/mcp-monitor.yml): reads the
 * Worker's invocation counts from Cloudflare's GraphQL Analytics API and raises an alert when today's requests near
 * the free plan's daily quota (beyond it the endpoint is down for everyone until 00:00 UTC), when requests exceed
 * the CPU limit (error 1102) or when errors spike. Prints a Markdown report; exit code 2 means "alert" (the workflow
 * then opens or comments an issue), 1 a failure of the monitor itself (token without Account Analytics: Read…).
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx tsx workers/mcp/monitor.ts
 */

export const DAILY_QUOTA = 100_000;
export const QUOTA_ALERT_SHARE = 0.7;
const SCRIPT = 'perigee-mcp';

export interface InvocationRow {
  readonly status: string;
  readonly requests: number;
  readonly errors: number;
  readonly cpuP99Us?: number;
}

export interface Assessment {
  readonly alerts: string[];
  readonly report: string;
}

/** Statuses of invocations stopped by a Cloudflare limit (CPU time, memory…). */
const isLimit = (status: string): boolean => /exceeded/i.test(status);

/** Turns today's and the last hour's invocation rows into alerts and a Markdown report. Pure. */
export function assess(
  today: readonly InvocationRow[],
  lastHour: readonly InvocationRow[],
  now: Date,
): Assessment {
  const sum = (rows: readonly InvocationRow[], pick: (r: InvocationRow) => boolean = () => true) =>
    rows.filter(pick).reduce((n, r) => n + r.requests, 0);
  const todayTotal = sum(today);
  const share = todayTotal / DAILY_QUOTA;
  const hourTotal = sum(lastHour);
  const hourLimited = sum(lastHour, (r) => isLimit(r.status));
  const hourFailed = sum(lastHour, (r) => r.status !== 'success' && r.status !== 'clientDisconnected');
  const hoursLeft = 24 - now.getUTCHours() - now.getUTCMinutes() / 60;
  const projected =
    hoursLeft > 0 && now.getUTCHours() > 0
      ? todayTotal + (todayTotal / (24 - hoursLeft)) * hoursLeft
      : todayTotal;

  const alerts: string[] = [];
  if (share >= QUOTA_ALERT_SHARE)
    alerts.push(
      `Daily quota: ${todayTotal} requests today, ${(share * 100).toFixed(0)} % of ${DAILY_QUOTA} (the endpoint stops at 100 % until 00:00 UTC).`,
    );
  if (hourLimited >= 20 || (hourTotal >= 100 && hourLimited / hourTotal >= 0.02))
    alerts.push(
      `CPU or memory limit: ${hourLimited} of ${hourTotal} requests in the last hour were stopped by Cloudflare (error 1102).`,
    );
  if (hourTotal >= 100 && hourFailed / hourTotal >= 0.1)
    alerts.push(`Errors: ${hourFailed} of ${hourTotal} requests failed in the last hour.`);

  const statuses = (rows: readonly InvocationRow[]) =>
    rows
      .slice()
      .sort((a, b) => b.requests - a.requests)
      .map((r) => `${r.status} ${r.requests}`)
      .join(', ') || 'none';
  const cpu = Math.max(0, ...lastHour.map((r) => r.cpuP99Us ?? 0));
  const report = [
    `## Hosted MCP endpoint — ${now.toISOString().slice(0, 16)} UTC`,
    '',
    `| | Requests | Detail |`,
    `| --- | --- | --- |`,
    `| Today (since 00:00 UTC) | ${todayTotal} (${(share * 100).toFixed(1)} % of the daily quota) | projected ≈ ${Math.round(projected)}; ${statuses(today)} |`,
    `| Last hour | ${hourTotal} | ${statuses(lastHour)}${cpu ? `; CPU p99 ${(cpu / 1000).toFixed(1)} ms` : ''} |`,
    '',
    alerts.length ? `**Alerts**\n\n${alerts.map((a) => `- ${a}`).join('\n')}` : 'No alert.',
    '',
    'Playbook: docs/mcp-hosted.md#playbook. Logs: Cloudflare dashboard → Workers & Pages → perigee-mcp → Observability.',
  ].join('\n');
  return { alerts, report };
}

const QUERY = `query ($account: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 100, filter: { scriptName: "${SCRIPT}", datetime_geq: $since, datetime_leq: $until }) {
        sum { requests errors }
        quantiles { cpuTimeP99 }
        dimensions { status }
      }
    }
  }
}`;

interface GraphQlRow {
  sum: { requests: number; errors: number };
  quantiles?: { cpuTimeP99?: number };
  dimensions: { status: string };
}

async function invocations(
  token: string,
  account: string,
  since: Date,
  until: Date,
): Promise<InvocationRow[]> {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { account, since: since.toISOString(), until: until.toISOString() },
    }),
  });
  const body = (await res.json()) as {
    data?: { viewer: { accounts: { workersInvocationsAdaptive: GraphQlRow[] }[] } };
    errors?: { message: string }[] | null;
  };
  if (!res.ok || body.errors?.length)
    throw new Error(
      `Cloudflare GraphQL: HTTP ${res.status} ${body.errors?.map((e) => e.message).join('; ') ?? ''}`,
    );
  const rows = body.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
  return rows.map((r) => ({
    status: r.dimensions.status,
    requests: r.sum.requests,
    errors: r.sum.errors,
    ...(r.quantiles?.cpuTimeP99 !== undefined ? { cpuP99Us: r.quantiles.cpuTimeP99 } : {}),
  }));
}

async function main(): Promise<void> {
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [today, lastHour] = await Promise.all([
    invocations(token, account, midnight, now),
    invocations(token, account, new Date(now.getTime() - 3_600_000), now),
  ]);
  const { alerts, report } = assess(today, lastHour, now);
  console.log(report);
  process.exitCode = alerts.length ? 2 : 0;
}

if (process.argv[1] && /monitor\.ts$/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
