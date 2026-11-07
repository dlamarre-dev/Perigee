/**
 * Contour lines of a grid (marching squares): where the values cross a level, linearly interpolated between nodes,
 * chained into lines and smoothed (Catmull-Rom curves through the crossing points), as SVG path data. Nodes outside
 * the grid take the value `outside` (0 by default, so a zone of positive values touching the grid's edge is closed).
 * Saddle cells are resolved by the cell's mean.
 */

/** Node (col, row) to map coordinates. */
export type NodeToXY = (col: number, row: number) => readonly [number, number];

type XY = readonly [number, number];

export function isoline(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  level: number,
  toXY: NodeToXY,
  outside = 0,
): string {
  const v = (c: number, r: number): number =>
    c < 0 || r < 0 || c >= cols || r >= rows ? outside : (values[r * cols + c] ?? outside);
  // Crossing points, keyed by the grid edge they lie on (shared by the two cells on either side).
  const points = new Map<string, XY>();
  const segments: [string, string][] = [];
  const point = (c0: number, r0: number, c1: number, r1: number, a: number, b: number): string => {
    const key = `${c0},${r0},${c1},${r1}`;
    if (!points.has(key)) {
      const t = a === b ? 0.5 : (level - a) / (b - a);
      const [x0, y0] = toXY(c0, r0);
      const [x1, y1] = toXY(c1, r1);
      points.set(key, [x0 + t * (x1 - x0), y0 + t * (y1 - y0)]);
    }
    return key;
  };
  for (let r = -1; r < rows; r++)
    for (let c = -1; c < cols; c++) {
      // Corners: a (c, r), b (c+1, r), d (c, r+1), e (c+1, r+1).
      const a = v(c, r);
      const b = v(c + 1, r);
      const d = v(c, r + 1);
      const e = v(c + 1, r + 1);
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (e >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Crossing points on the cell's edges.
      const bottom = (): string => point(c, r, c + 1, r, a, b);
      const right = (): string => point(c + 1, r, c + 1, r + 1, b, e);
      const top = (): string => point(c, r + 1, c + 1, r + 1, d, e);
      const left = (): string => point(c, r, c, r + 1, a, d);
      const seg = (p: string, q: string): void => {
        segments.push([p, q]);
      };
      switch (code) {
        case 1:
        case 14:
          seg(left(), bottom());
          break;
        case 2:
        case 13:
          seg(bottom(), right());
          break;
        case 3:
        case 12:
          seg(left(), right());
          break;
        case 4:
        case 11:
          seg(right(), top());
          break;
        case 6:
        case 9:
          seg(bottom(), top());
          break;
        case 7:
        case 8:
          seg(left(), top());
          break;
        case 5:
        case 10: {
          const high = (a + b + d + e) / 4 >= level;
          // 5: a and e high. Joined through the middle when the mean is high.
          if ((code === 5) === high) {
            seg(left(), top());
            seg(bottom(), right());
          } else {
            seg(left(), bottom());
            seg(right(), top());
          }
          break;
        }
      }
    }
  return chain(segments)
    .map(({ keys, closed }) =>
      smooth(
        keys.map((k) => points.get(k) ?? [0, 0]),
        closed,
      ),
    )
    .join('');
}

/** Joins segments sharing an end into lines (each crossing point belongs to at most two segments). */
function chain(segments: readonly [string, string][]): { keys: string[]; closed: boolean }[] {
  const at = new Map<string, number[]>();
  segments.forEach(([p, q], i) => {
    for (const k of [p, q]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segments.length);
  /** Follows the line from `key`, away from segment `from`, appending the keys met. */
  const walk = (key: string, from: number, out: string[]): boolean => {
    let k = key;
    let prev = from;
    for (;;) {
      const next = (at.get(k) ?? []).find((i) => i !== prev && !used[i]);
      if (next === undefined) return false;
      used[next] = 1;
      const s = segments[next];
      if (!s) return false;
      k = s[0] === k ? s[1] : s[0];
      if (k === out[0]) return true;
      out.push(k);
      prev = next;
    }
  };
  const lines: { keys: string[]; closed: boolean }[] = [];
  segments.forEach(([p, q], i) => {
    if (used[i]) return;
    used[i] = 1;
    const forward = [p, q];
    if (walk(q, i, forward)) {
      lines.push({ keys: forward, closed: true });
      return;
    }
    const backward = [p];
    walk(p, i, backward);
    lines.push({ keys: [...backward.slice(1).reverse(), ...forward], closed: false });
  });
  return lines;
}

const f = (n: number): string => n.toFixed(2);

/** A Catmull-Rom curve through the points, as cubic Bézier segments. */
function smooth(pts: readonly XY[], closed: boolean): string {
  const n = pts.length;
  const first = pts[0];
  if (!first) return '';
  const p = (i: number): XY =>
    (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]) ?? first;
  let d = `M${f(first[0])} ${f(first[1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    d +=
      `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}
