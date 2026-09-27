import { describe, expect, it } from 'vitest';
import { layoutLabels, rectsOverlap, type LayoutInput } from '../src/render/Labels';

const W = 1000;
const H = 800;
const label = (id: string, x: number, y: number, priority = 10): LayoutInput => ({
  id,
  anchorX: x,
  anchorY: y,
  w: 80,
  h: 16,
  priority,
});

function run(inputs: LayoutInput[], states = new Map(), obstacles = []) {
  return {
    results: new Map(layoutLabels(inputs, obstacles, states, W, H).map((r) => [r.id, r.rect])),
    states,
  };
}

describe('label collision avoidance', () => {
  it('moves a colliding label to another side instead of overlapping', () => {
    const { results } = run([label('a', 500, 400), label('b', 505, 402)]);
    const a = results.get('a');
    const b = results.get('b');
    expect(a && b).toBeTruthy();
    if (a && b) expect(rectsOverlap(a, b)).toBe(false);
  });

  it('hides the lowest-priority label when no position is free', () => {
    const inputs = [
      label('s1', 500, 400),
      label('s2', 501, 400),
      label('s3', 502, 400),
      label('s4', 503, 400),
    ];
    inputs.push(label('top', 502, 401, 100));
    const { results } = run(inputs);
    expect(results.get('top')).toBeDefined();
    const shown = [...results.values()].filter(Boolean);
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) expect(rectsOverlap(shown[i]!, shown[j]!)).toBe(false);
    expect(shown.length).toBeLessThan(inputs.length);
  });

  it('keeps higher-priority labels and respects obstacles for lower priorities', () => {
    const states = new Map();
    const obstacles = [{ x: 505, y: 400, w: 16, h: 16, priority: 50 }];
    const r = new Map(
      layoutLabels([label('site', 500, 400, 10)], obstacles, states, W, H).map((x) => [x.id, x.rect]),
    );
    const rect = r.get('site');
    if (rect) expect(rectsOverlap(rect, obstacles[0]!, 0)).toBe(false);
  });

  it('does not flicker: a label hidden by a collision waits several frames before reappearing', () => {
    const states = new Map();
    const crowd = (dx: number) => [
      label('a', 500, 400, 50),
      ...[0, 1, 2, 3].map((i) => label(`x${i}`, 500 + dx + i, 400, 60)),
    ];
    // Frame 1: 'a' fits nowhere once the four higher-priority labels take all sides → hidden.
    run(crowd(0), states);
    const hidden = run(crowd(0), states).results.get('a');
    // Obstruction disappears: 'a' must not pop back immediately.
    const next = run([label('a', 500, 400, 50)], states).results.get('a');
    expect(hidden === undefined || next === undefined).toBe(true);
    let frames = 1;
    while (!run([label('a', 500, 400, 50)], states).results.get('a') && frames < 50) frames++;
    expect(frames).toBeGreaterThanOrEqual(5);
    expect(frames).toBeLessThan(20);
  });

  it('keeps its chosen side while it still fits (no oscillation)', () => {
    const states = new Map();
    run([label('a', 500, 400), label('b', 505, 402)], states);
    const sideB = states.get('b').offset;
    for (let i = 0; i < 20; i++) run([label('a', 500 + (i % 2), 400), label('b', 505, 402)], states);
    expect(states.get('b').offset).toBe(sideB);
  });
});
