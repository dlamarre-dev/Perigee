/**
 * Performance bench: main-thread cost per view on the production build with the published data.
 *
 *   npm run data:pull && npm run build && npx tsx tools/perf/bench.ts [--throttle 4] [--seconds 10] [--quality low]
 *
 * Serves dist/ with `vite preview`, opens each scenario in headless Chromium (software WebGL, so GPU numbers are
 * not meaningful; main-thread numbers are) and reports, over a fixed window after loading: script and task time
 * per second, forced layouts, frames, messages sent to the SGP4 workers, WebGL contexts created, and the time to
 * the first satellites. Compare runs before and after a change on the same machine.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type CDPSession } from 'playwright';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const THROTTLE = flag('throttle', 1);
const SECONDS = flag('seconds', 10);
const PORT = 4321;
/** Optional quality tier forced on every scenario (`--quality low`). */
const QUALITY = ((): string => {
  const i = args.indexOf('--quality');
  return i >= 0 ? `&quality=${args[i + 1]}` : '';
})();
const BASE = `http://localhost:${PORT}/Perigee/`;

interface Scenario {
  readonly name: string;
  readonly query: string;
  /** Text the page shows once the view has its data. */
  readonly ready: string;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'earth ×1', query: 'lang=en', ready: 'shown of' },
  { name: 'earth paused', query: 'lang=en&rate=0', ready: 'shown of' },
  { name: 'earth ×1 ISS selected', query: 'lang=en&sel=25544', ready: 'shown of' },
  { name: 'earth ×10000', query: 'lang=en&rate=10000', ready: 'shown of' },
  { name: 'moon', query: 'lang=en&view=moon', ready: 'Lunar Reconnaissance Orbiter' },
  { name: 'mars', query: 'lang=en&view=mars', ready: 'Mars Reconnaissance Orbiter' },
  { name: 'solar', query: 'lang=en&view=solar', ready: 'Jupiter' },
  { name: 'solar ×100000', query: 'lang=en&view=solar&rate=100000', ready: 'Jupiter' },
];

/**
 * Counts WebGL contexts and messages to workers from the page's own scripts. Kept as source text: tsx would
 * otherwise inject helpers the page does not have.
 */
const INSTRUMENT = `
  window.__bench = { contexts: 0, workerMessages: 0 };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    const ctx = getContext.call(this, type, opts);
    if (ctx && String(type).startsWith('webgl') && !this.__counted) {
      this.__counted = true;
      window.__bench.contexts++;
    }
    return ctx;
  };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...a) {
    window.__bench.workerMessages++;
    return post.apply(this, a);
  };
`;

const START_FRAMES = `(() => {
  window.__frames = 0;
  const tick = () => { window.__frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return window.__bench.workerMessages;
})()`;
const READ = `({ frames: window.__frames, messages: window.__bench.workerMessages, contexts: window.__bench.contexts })`;

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

async function run(): Promise<void> {
  // Vite run directly (no shell), so kill() really stops it; dist/ of the current directory is served.
  const vite = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 4000));
  // The machine's GPU through ANGLE (D3D11 on Windows): software WebGL would cap the frame rate and skew every
  // per-second figure. --swiftshader forces software rendering (e.g. on CI).
  const gpuArgs = args.includes('--swiftshader')
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'];
  const browser = await chromium.launch({ args: gpuArgs });
  const rows: Record<string, string | number>[] = [];
  try {
    for (const s of SCENARIOS) {
      const context = await browser.newContext({
        viewport: { width: 1400, height: 850 },
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await page.addInitScript({ content: INSTRUMENT });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const t0 = Date.now();
      await page.goto(`${BASE}?${s.query}${QUALITY}`);
      await page.getByText(s.ready).first().waitFor({ timeout: 120_000 });
      const readyMs = Date.now() - t0;
      await page.waitForTimeout(3000);
      const before = await metrics(cdp);
      const b0 = (await page.evaluate(START_FRAMES)) as number;
      await page.waitForTimeout(SECONDS * 1000);
      const after = await metrics(cdp);
      const end = (await page.evaluate(READ)) as { frames: number; messages: number; contexts: number };
      const per = (k: string): number => ((after[k] ?? 0) - (before[k] ?? 0)) / SECONDS;
      rows.push({
        scenario: s.name,
        'ready s': +(readyMs / 1000).toFixed(1),
        'script ms/s': Math.round(per('ScriptDuration') * 1000),
        'task ms/s': Math.round(per('TaskDuration') * 1000),
        'layouts/s': +per('LayoutCount').toFixed(1),
        fps: Math.round(end.frames / SECONDS),
        'worker msg/min': Math.round(((end.messages - b0) / SECONDS) * 60),
        'GL contexts': end.contexts,
      });
      await context.close();
    }
    // WebGL contexts after switching views five times.
    const context = await browser.newContext({
      viewport: { width: 1400, height: 850 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.addInitScript({ content: INSTRUMENT });
    await page.goto(`${BASE}?lang=en&sel=25544`);
    await page.getByText('shown of').first().waitFor({ timeout: 120_000 });
    for (const tab of ['Moon', 'Mars', 'Solar system', 'Earth', 'Moon']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(4000);
    }
    const contexts = (await page.evaluate('window.__bench.contexts')) as number;
    await context.close();
    console.log(`CPU throttling ×${THROTTLE}, window ${SECONDS} s`);
    console.table(rows);
    console.log(`WebGL contexts created after 5 view switches: ${contexts}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

await run();
