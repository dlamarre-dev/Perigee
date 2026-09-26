/**
 * Polite HTTP client for upstream providers (CLAUDE.md §8):
 * one call per resource per run, identifying User-Agent, stop on any non-200 response.
 */
export const USER_AGENT = 'Perigee data pipeline (+https://github.com/dlamarre-dev/Perigee)';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface PoliteGetOptions {
  /**
   * Retry once after this delay on a network error (never on an HTTP status).
   * Off for CelesTrak: an IP block often shows up as a hung connection, and retrying makes it worse.
   */
  readonly retryAfterNetworkErrorMs?: number;
  readonly timeoutMs?: number;
  readonly accept?: string;
}

export async function politeGet(url: string, options: PoliteGetOptions = {}): Promise<string> {
  const attempt = async (): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: options.accept ?? '*/*' },
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new ProviderError(`Network error: ${String(err)}`, url);
    }
    if (res.status !== 200) {
      throw new ProviderError(`HTTP ${res.status} ${res.statusText}`, url, res.status);
    }
    return res.text();
  };

  try {
    return await attempt();
  } catch (err) {
    const retryMs = options.retryAfterNetworkErrorMs;
    if (!(err instanceof ProviderError) || err.status !== undefined || retryMs === undefined) throw err;
    console.warn(`${err.message} — single retry in ${Math.round(retryMs / 60_000)} min`);
    await new Promise((r) => setTimeout(r, retryMs));
    return attempt();
  }
}
