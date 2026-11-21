/**
 * Immersive effects (relief from normal maps, Earth clouds, moving gas on Venus and the giant planets, sunspots,
 * spacecraft models lit by the Sun alone with self-shadowing, the Sun's glare and lens flare, a spacecraft window, a warp bubble):
 * high quality tier (sunspots from the medium tier), each switchable by the visitor (settings window, remembered
 * per browser). They apply live: every shader that draws an effect shares its strength uniform (0 off, 1 on), so
 * no material is rebuilt.
 */
import { quality, type QualityTier } from './quality';

export type EffectName =
  'relief' | 'clouds' | 'gasMotion' | 'sunspots' | 'modelLighting' | 'sunGlare' | 'glass' | 'warp';
export const EFFECT_NAMES: readonly EffectName[] = [
  'relief',
  'clouds',
  'gasMotion',
  'sunspots',
  'sunGlare',
  'glass',
  'warp',
  'modelLighting',
];

/** Lowest tier drawing each effect. Sunspots are cheap: a loop over a few groups on the Sun's pixels only. */
const MIN_TIER: Readonly<Record<EffectName, QualityTier>> = {
  relief: 'high',
  clouds: 'high',
  gasMotion: 'high',
  sunspots: 'medium',
  modelLighting: 'high',
  sunGlare: 'high',
  glass: 'high',
  warp: 'high',
};
const TIER_RANK: Readonly<Record<QualityTier, number>> = { low: 0, medium: 1, high: 2 };

/** Whether the quality tier in effect can draw the effect (the visitor may still switch it off). */
export function effectAvailable(name: EffectName): boolean {
  return TIER_RANK[quality().tier] >= TIER_RANK[MIN_TIER[name]];
}

export type EffectPrefs = Readonly<Record<EffectName, boolean>>;

const KEY = 'perigee-effects';

/** Preferences from their stored form ("relief,-clouds": only the switched-off ones matter); all on by default. */
export function parseEffectPrefs(stored: string | null): EffectPrefs {
  const off = new Set(
    (stored ?? '')
      .split(',')
      .filter((s) => s.startsWith('-'))
      .map((s) => s.slice(1)),
  );
  return Object.fromEntries(EFFECT_NAMES.map((n) => [n, !off.has(n)])) as EffectPrefs;
}

export function formatEffectPrefs(prefs: EffectPrefs): string {
  return EFFECT_NAMES.filter((n) => !prefs[n])
    .map((n) => `-${n}`)
    .join(',');
}

function readPrefs(): EffectPrefs {
  try {
    return parseEffectPrefs(localStorage.getItem(KEY));
  } catch {
    return parseEffectPrefs(null);
  }
}

let prefs: EffectPrefs | undefined;
const uniforms = new Map<EffectName, { value: number }>();
const listeners = new Set<() => void>();

export function effectPrefs(): EffectPrefs {
  return (prefs ??= readPrefs());
}

/** Whether the effect is drawn: the quality tier allows it and the visitor left it on. */
export function effectEnabled(name: EffectName): boolean {
  return effectAvailable(name) && effectPrefs()[name];
}

/** Shared strength uniform of an effect (1 drawn, 0 not): put the same object in every material that draws it. */
export function effectUniform(name: EffectName): { value: number } {
  let u = uniforms.get(name);
  if (!u) {
    u = { value: effectEnabled(name) ? 1 : 0 };
    uniforms.set(name, u);
  }
  return u;
}

export function setEffectEnabled(name: EffectName, on: boolean): void {
  prefs = { ...effectPrefs(), [name]: on };
  try {
    const stored = formatEffectPrefs(prefs);
    if (stored) localStorage.setItem(KEY, stored);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered: the choice still applies to this page.
  }
  for (const n of EFFECT_NAMES) {
    const u = uniforms.get(n);
    if (u) u.value = effectEnabled(n) ? 1 : 0;
  }
  for (const listener of listeners) listener();
}

/** Called when an effect is switched (e.g. to show or hide a mesh); returns the unsubscribe function. */
export function onEffectsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One line for problem reports and ?debug=perf. */
export function effectsSummary(): string {
  const available = EFFECT_NAMES.filter(effectAvailable);
  if (available.length === 0) return 'effects off (tier)';
  const p = effectPrefs();
  return `effects ${available.map((n) => (p[n] ? n : `-${n}`)).join(' ')}`;
}
