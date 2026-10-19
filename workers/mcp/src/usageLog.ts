/**
 * Usage log of the hosted MCP endpoint: one structured line per request, to see which tools are used, by which
 * kind of client, how often they fail and how long they take. Never the caller's IP address, never the tool
 * arguments except the object id asked about (place coordinates, dates and texts are left out): Cloudflare's own
 * invocation logs, which record request headers, are turned off (wrangler.jsonc). Pure functions.
 */

/** One JSON-RPC message of a request, as logged. */
export interface LoggedCall {
  readonly method: string;
  /** tools/call: the tool's name, the object id asked about (when the tool takes one) and the argument names. */
  readonly tool?: string;
  readonly objectId?: string;
  readonly args?: readonly string[];
  /** initialize: the client's own name and version (e.g. "claude-ai 0.1.0"). */
  readonly client?: string;
  /** tools/call: whether the tool answered (false: a tool error, e.g. an unknown object) and its message. */
  readonly ok?: boolean;
  readonly error?: string;
}

export interface UsageEntry {
  readonly evt: 'mcp';
  readonly status: number;
  /** Wall time of the request in the Worker (ms); downloads included, CPU time is in the dashboard's metrics. */
  readonly ms: number;
  /** 1 for the first request of a new isolate (a cold start, which pays the JavaScript warm-up). */
  readonly isolateRequest: number;
  readonly calls: readonly LoggedCall[];
  /** Country and Cloudflare data centre of the connecting server (an AI service's, or the user's own). */
  readonly country?: string;
  readonly colo?: string;
  /** First product token of the User-Agent ("node", "python-httpx", "perigee-loadtest"…), never the whole string. */
  readonly agent?: string;
  readonly rateLimited?: boolean;
}

/** Arguments that name an object (logged); every other argument is only counted by name. */
const OBJECT_ARGS = ['id', 'from', 'to', 'url'] as const;
const MAX_TEXT = 120;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const clip = (s: string): string => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

/** A Perigee link reduced to its view and selection ("solar mars"): its date and other parameters are left out. */
function linkSubject(link: string): string {
  const p = new URLSearchParams(link.slice(link.indexOf('?')));
  return [p.get('view') ?? 'earth', p.get('sel')].filter(Boolean).join(' ');
}

/** The calls of a JSON-RPC request body (a message or a batch). */
export function callsOf(body: unknown): LoggedCall[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter(isObject).map((m) => {
    const method = typeof m['method'] === 'string' ? m['method'] : 'unknown';
    const params = isObject(m['params']) ? m['params'] : {};
    if (method === 'initialize') {
      const info = isObject(params['clientInfo']) ? params['clientInfo'] : {};
      const name = typeof info['name'] === 'string' ? info['name'] : undefined;
      const version = typeof info['version'] === 'string' ? info['version'] : undefined;
      return { method, ...(name ? { client: clip(version ? `${name} ${version}` : name) } : {}) };
    }
    if (method === 'tools/call') {
      const args = isObject(params['arguments']) ? params['arguments'] : {};
      // The object of the question: an id, the two ends of a distance, or a Perigee link (its view and selection).
      const named = OBJECT_ARGS.map((k) => args[k]).filter((v): v is string => typeof v === 'string');
      const objectId = named.length
        ? named.map((v) => (v.includes('?') ? linkSubject(v) : v)).join(' → ')
        : undefined;
      return {
        method,
        ...(typeof params['name'] === 'string' ? { tool: params['name'] } : {}),
        ...(objectId ? { objectId: clip(objectId) } : {}),
        args: Object.keys(args).sort(),
      };
    }
    return { method };
  });
}

/** Marks the tools/call entries with their outcome, from the JSON-RPC response body (same order of ids). */
export function withOutcomes(
  calls: readonly LoggedCall[],
  requestBody: unknown,
  responseBody: unknown,
): LoggedCall[] {
  const requests = (Array.isArray(requestBody) ? requestBody : [requestBody]).filter(isObject);
  const responses = (Array.isArray(responseBody) ? responseBody : [responseBody]).filter(isObject);
  return calls.map((call, i) => {
    if (call.method !== 'tools/call') return call;
    const id = requests[i]?.['id'];
    const response = responses.find((r) => r['id'] === id);
    if (!response) return call;
    if (isObject(response['error'])) {
      const message = response['error']['message'];
      return { ...call, ok: false, ...(typeof message === 'string' ? { error: clip(message) } : {}) };
    }
    const result = isObject(response['result']) ? response['result'] : {};
    if (result['isError'] !== true) return { ...call, ok: true };
    const content = Array.isArray(result['content']) ? result['content'] : [];
    const first = content.find(isObject);
    const text = first && typeof first['text'] === 'string' ? first['text'] : undefined;
    return { ...call, ok: false, ...(text ? { error: clip(text) } : {}) };
  });
}

/** First product token of a User-Agent: "python-httpx/0.27 (…)" → "python-httpx". */
export function agentOf(userAgent: string | null): string | undefined {
  const token = userAgent?.trim().split(/[\s/]/)[0];
  return token ? clip(token) : undefined;
}
