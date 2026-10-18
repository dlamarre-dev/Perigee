import { describe, expect, it } from 'vitest';
import {
  EMBED_PROTOCOL,
  EmbedApi,
  engineIdOf,
  parseSetParams,
  type EmbedHost,
  type EmbedState,
} from '../src/app/embedApi';

const base: EmbedState = {
  view: 'earth',
  sel: null,
  time: '2026-09-26T12:00:00.000Z',
  live: false,
  rate: 0,
  frame: 'fixed',
  lang: 'en',
  following: false,
  url: 'https://perigee.info/',
};

function setup(): {
  send: (msg: unknown) => Promise<unknown>;
  events: unknown[];
  api: EmbedApi;
  host: { state: EmbedState };
} {
  const box = { state: base };
  const host: EmbedHost = {
    state: () => box.state,
    set: async (p) => {
      box.state = {
        ...box.state,
        ...(p.sel !== undefined ? { sel: p.sel } : {}),
        ...(p.view ? { view: p.view } : {}),
      };
    },
    snapshot: async () => ({ dataUrl: 'data:image/png;base64,AA', title: 'Perigee' }),
    details: async () => ({ facts: true }),
  };
  let listener: ((e: MessageEvent) => void) | undefined;
  const events: unknown[] = [];
  const api = new EmbedApi(host, { postMessage: (m) => events.push(m) }, {
    addEventListener: (_type: string, l: (e: MessageEvent) => void) => (listener = l),
  } as unknown as Window);
  const send = (msg: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      listener?.({
        data: msg,
        origin: 'https://lesson.example',
        source: { postMessage: (m: unknown, origin: string) => resolve({ m, origin }) },
      } as unknown as MessageEvent);
    });
  return { send, events, api, host: box };
}

describe('embed API', () => {
  it('validates set parameters', () => {
    expect(parseSetParams({ view: 'mars', sel: 'site:perseverance', rate: 100, follow: true })).toEqual({
      view: 'mars',
      sel: 'site:perseverance',
      rate: 100,
      follow: true,
    });
    expect(() => parseSetParams({ view: 'venus' })).toThrow(/view/);
    expect(() => parseSetParams({ time: 'tomorrow' })).toThrow(/time/);
    expect(() => parseSetParams({ rate: 1e9 })).toThrow(/rate/);
    expect(() => parseSetParams({ zoom: 2 })).toThrow(/unknown parameter/);
  });

  it('answers to the caller origin with the request id', async () => {
    const { send } = setup();
    const r = (await send({ type: EMBED_PROTOCOL, id: 7, method: 'get' })) as {
      m: Record<string, unknown>;
      origin: string;
    };
    expect(r.origin).toBe('https://lesson.example');
    expect(r.m).toMatchObject({ type: EMBED_PROTOCOL, id: 7, ok: true, result: { view: 'earth' } });
  });

  it('reports errors without throwing', async () => {
    const { send } = setup();
    const r = (await send({ type: EMBED_PROTOCOL, id: 1, method: 'set', params: { lang: 'de' } })) as {
      m: Record<string, unknown>;
    };
    expect(r.m).toMatchObject({ ok: false, error: expect.stringMatching(/lang/) });
    const u = (await send({ type: EMBED_PROTOCOL, id: 2, method: 'fly' })) as { m: Record<string, unknown> };
    expect(u.m['error']).toMatch(/unknown method/);
  });

  it('posts ready and selection events to the parent', async () => {
    const { send, events, api } = setup();
    api.ready();
    await send({ type: EMBED_PROTOCOL, id: 3, method: 'set', params: { sel: '25544' } });
    expect(events.map((e) => (e as { event: string }).event)).toEqual(['ready', 'selection']);
  });

  it('ignores other messages', async () => {
    const { send } = setup();
    const r = await Promise.race([
      send({ type: 'other', method: 'get' }),
      new Promise((r) => setTimeout(() => r('none'), 20)),
    ]);
    expect(r).toBe('none');
  });

  it('maps selections to engine ids', () => {
    expect(engineIdOf('earth', 'site:kourou')).toBe('launch:kourou');
    expect(engineIdOf('moon', 'site:apollo-11')).toBe('site:apollo-11');
    expect(engineIdOf('earth', 'moon')).toBe('moon:moon');
  });
});
