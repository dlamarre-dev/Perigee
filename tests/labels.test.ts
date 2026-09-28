import { describe, expect, it } from 'vitest';
import {
  layoutLabels,
  occludedBySphere,
  occludedBySphereAt,
  rectsOverlap,
  type LayoutInput,
} from '../src/render/Labels';

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
    const shown = [...results.values()].filter((r): r is NonNullable<typeof r> => r !== undefined);
    shown.forEach((a, i) => shown.slice(i + 1).forEach((b) => expect(rectsOverlap(a, b)).toBe(false)));
    expect(shown.length).toBeLessThan(inputs.length);
  });

  it('keeps higher-priority labels and respects obstacles for lower priorities', () => {
    const states = new Map();
    const obstacle = { x: 505, y: 400, w: 16, h: 16, priority: 50 };
    const obstacles = [obstacle];
    const r = new Map(
      layoutLabels([label('site', 500, 400, 10)], obstacles, states, W, H).map((x) => [x.id, x.rect]),
    );
    const rect = r.get('site');
    if (rect) expect(rectsOverlap(rect, obstacle, 0)).toBe(false);
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

describe('occludedBySphereAt', () => {
  const centre: [number, number, number] = [1000, 0, 0];
  const camera: [number, number, number] = [0, 0, 0];
  it('hides a point behind the sphere and keeps one in front or beside it', () => {
    expect(occludedBySphereAt(camera, [2000, 0, 0], centre, 100)).toBe(true);
    expect(occludedBySphereAt(camera, [500, 0, 0], centre, 100)).toBe(false);
    expect(occludedBySphereAt(camera, [2000, 300, 0], centre, 100)).toBe(false);
  });
  it('matches occludedBySphere once translated', () => {
    const cam: [number, number, number] = [-5000, 20, 0];
    const p: [number, number, number] = [3000, 10, 5];
    expect(occludedBySphereAt(cam, p, centre, 200)).toBe(
      occludedBySphere([cam[0] - 1000, cam[1], cam[2]], [p[0] - 1000, p[1], p[2]], 200),
    );
  });
});
