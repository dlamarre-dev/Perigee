import { expect, test } from '@playwright/test';

// An outside page embeds Perigee in an iframe and drives it with the perigee:v1 postMessage API.
test('embed mode answers the postMessage API', async ({ page, baseURL }) => {
  const src = new URL('./?embed=1&lang=en&t=2026-09-26T12:00:00Z&rate=0', baseURL).href;
  await page.setContent(`<!doctype html><body style="margin:0">
    <iframe id="p" src="${src}" style="width:800px;height:600px;border:0"></iframe>
    <script>
      window.events = [];
      const pending = new Map();
      let next = 1;
      addEventListener('message', (e) => {
        const m = e.data;
        if (!m || m.type !== 'perigee:v1') return;
        if (m.event) window.events.push(m);
        else pending.get(m.id)?.(m);
      });
      window.call = (method, params) => new Promise((resolve) => {
        const id = next++;
        pending.set(id, resolve);
        document.getElementById('p').contentWindow.postMessage({ type: 'perigee:v1', id, method, params }, '*');
      });
    </script></body>`);
  await page.waitForFunction(
    () => (window as unknown as { events: { event: string }[] }).events.some((e) => e.event === 'ready'),
    undefined,
    { timeout: 30_000 },
  );

  const frame = page.frameLocator('#p');
  await expect(frame.locator('.toolbar')).toBeHidden();
  await expect(frame.locator('.time-control')).toBeHidden();
  await expect(frame.locator('.embed-credit')).toHaveText(/Open in Perigee/);

  type Reply = { ok: boolean; result: Record<string, unknown>; error?: string };
  const call = (method: string, params?: unknown): Promise<Reply> =>
    page.evaluate(
      ([m, p]) => (window as unknown as { call: (m: unknown, p: unknown) => Promise<Reply> }).call(m, p),
      [method, params] as const,
    );

  const set = await call('set', { sel: '25544' });
  expect(set.ok).toBe(true);
  await expect.poll(async () => (await call('get')).result['sel'], { timeout: 20_000 }).toBe('25544');
  await expect(frame.locator('.embed-credit')).toHaveAttribute('href', /sel=25544/);

  const bad = await call('set', { view: 'venus' });
  expect(bad.ok).toBe(false);

  const shot = await call('snapshot', { kind: 'shown' });
  expect(shot.ok).toBe(true);
  expect(String(shot.result['dataUrl'])).toMatch(/^data:image\/png;base64,/);

  const details = await call('get', { details: true });
  const d = details.result['details'] as { id: string; position: { provenance: { model: string }[] } };
  expect(d.id).toBe('25544');
  expect(d.position.provenance[0]?.model).toMatch(/^sgp4/);
});
