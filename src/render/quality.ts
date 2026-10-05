/**
 * Quality tiers (CLAUDE.md §7): what the device can afford, decided once at startup from cheap signals (no
 * benchmark), refined at runtime by the adaptive resolution (src/render/adaptiveResolution.ts), and overridable
 * by the visitor (toolbar menu, remembered) or the URL (`?quality=`, for testing).
 */

export type QualityTier = 'high' | 'medium' | 'low';
export type QualityChoice = 'auto' | QualityTier;
export const QUALITY_CHOICES: readonly QualityChoice[] = ['auto', 'high', 'medium', 'low'];

/** What the browser tells about the device. Unknown values are left undefined. */
export interface DeviceSignals {
  /** Touch-first device (phone, tablet). */
  readonly coarsePointer: boolean;
  readonly deviceMemoryGb: number | undefined;
  readonly cores: number | undefined;
  readonly maxTextureSize: number;
  /** MSAA samples the GPU offers (0 without WebGL2 multisampling). */
  readonly maxSamples: number;
  /** GPU renderer string, when the browser exposes it. */
  readonly gpu: string | undefined;
  /** Data saver or prefers-reduced-data. */
  readonly saveData: boolean;
}

export interface QualitySettings {
  readonly tier: QualityTier;
  /** Device pixel ratio cap, and the floor the adaptive resolution may go down to. */
  readonly maxPixelRatio: number;
  readonly minPixelRatio: number;
  readonly msaa: boolean;
  /** 8k body and sky textures (tens of MB each). */
  readonly textures8k: boolean;
  /** Full-quality model variants (the 56 MB ISS). */
  readonly highModels: boolean;
  /** Smooth model cut-outs (needs MSAA); plain alpha test otherwise. */
  readonly alphaToCoverage: boolean;
  /** Frosted panels (backdrop blur over the live canvas). */
  readonly panelBlur: boolean;
  /** Frame-rate cap (undefined: the display's rate). */
  readonly maxFps: number | undefined;
  /** Frame rate while nothing moves (clock paused, no interaction). */
  readonly idleFps: number | undefined;
  /** Frame rate of the spinning model preview. */
  readonly previewFps: number;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export interface TierDecision {
  readonly tier: QualityTier;
  /** Short reasons, for diagnostics (problem reports, ?debug=perf). */
  readonly reasons: readonly string[];
}

/** Tier from the device signals: low on any weak signal, high only for a desktop-class GPU, else medium. */
export function detectTier(s: DeviceSignals): TierDecision {
  const low: string[] = [];
  if (s.gpu && SOFTWARE_GPU.test(s.gpu)) low.push('software GPU');
  if (s.deviceMemoryGb !== undefined && s.deviceMemoryGb <= 4) low.push(`${s.deviceMemoryGb} GB`);
  if (s.cores !== undefined && s.cores <= 4) low.push(`${s.cores} cores`);
  if (s.maxTextureSize < 8192) low.push(`max texture ${s.maxTextureSize}`);
  if (s.saveData) low.push('data saver');
  if (low.length > 0) return { tier: 'low', reasons: low };
  const notHigh: string[] = [];
  if (s.coarsePointer) notHigh.push('touch device');
  if (s.deviceMemoryGb !== undefined && s.deviceMemoryGb < 8) notHigh.push(`${s.deviceMemoryGb} GB`);
  if (s.maxSamples < 4) notHigh.push('no MSAA');
  return notHigh.length > 0
    ? { tier: 'medium', reasons: notHigh }
    : { tier: 'high', reasons: ['desktop-class GPU'] };
}

export function settingsFor(tier: QualityTier): QualitySettings {
  switch (tier) {
    case 'high':
      return {
        tier,
        maxPixelRatio: 2,
        minPixelRatio: 1,
        msaa: true,
        textures8k: true,
        highModels: true,
        alphaToCoverage: true,
        panelBlur: true,
        maxFps: undefined,
        idleFps: undefined,
        previewFps: 30,
      };
    case 'medium':
      return {
        tier,
        maxPixelRatio: 2,
        minPixelRatio: 1.25,
        msaa: true,
        textures8k: false,
        highModels: false,
        alphaToCoverage: false,
        panelBlur: true,
        maxFps: 60,
        idleFps: undefined,
        previewFps: 30,
      };
    case 'low':
      return {
        tier,
        maxPixelRatio: 1.5,
        minPixelRatio: 1,
        msaa: false,
        textures8k: false,
        highModels: false,
        alphaToCoverage: false,
        panelBlur: false,
        maxFps: 60,
        idleFps: 30,
        previewFps: 15,
      };
  }
}

/** Reads the signals; the WebGL ones come from a throwaway context, released at once. */
export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  let maxTextureSize = 4096;
  let maxSamples = 0;
  let gpu: string | undefined;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
      // Chrome masks RENDERER ("WebKit WebGL") and names the GPU through the debug extension; Firefox names it
      // in RENDERER and deprecates the extension, so it is only asked when the plain name says nothing.
      gpu = String(gl.getParameter(gl.RENDERER));
      if (/^webkit webgl$/i.test(gpu)) {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        if (info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No WebGL2: the renderer will report it.
  }
  const media = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  return {
    coarsePointer: media('(pointer: coarse)') && !media('(any-pointer: fine)'),
    deviceMemoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency || undefined,
    maxTextureSize,
    maxSamples,
    gpu,
    saveData: nav.connection?.saveData === true || media('(prefers-reduced-data: reduce)'),
  };
}

const CHOICE_KEY = 'perigee-quality';

export function isQualityChoice(v: unknown): v is QualityChoice {
  return typeof v === 'string' && (QUALITY_CHOICES as readonly string[]).includes(v);
}

/** The visitor's remembered choice ('auto' when none or storage is unavailable). */
export function storedChoice(): QualityChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return isQualityChoice(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function storeChoice(choice: QualityChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Not remembered: the choice still applies to this page.
  }
}

/** The settings in effect: the URL override, else the visitor's choice, else the detected tier. */
export interface QualityState {
  readonly choice: QualityChoice;
  readonly detected: TierDecision;
  readonly settings: QualitySettings;
  readonly signals: DeviceSignals;
}

export function resolveQuality(urlChoice: string | null, signals: DeviceSignals): QualityState {
  const detected = detectTier(signals);
  const choice = isQualityChoice(urlChoice) ? urlChoice : storedChoice();
  const tier = choice === 'auto' ? detected.tier : choice;
  return { choice, detected, settings: settingsFor(tier), signals };
}

let current: QualityState | undefined;

/** Set once by the shell at startup, before any view or model loads. */
export function setQuality(state: QualityState): void {
  current = state;
}

/** Settings in effect (high-tier defaults before the shell has decided, e.g. in unit tests). */
export function quality(): QualitySettings {
  return current?.settings ?? settingsFor('high');
}

export function qualityState(): QualityState | undefined {
  return current;
}

const RATIO_KEY = 'perigee-pixel-ratio';

/** Pixel ratio the adaptive resolution settled on last time for this tier (a per-viewer convenience). */
export function storedPixelRatio(tier: QualityTier): number | undefined {
  try {
    const [t, v] = (localStorage.getItem(RATIO_KEY) ?? '').split(':');
    const ratio = Number(v);
    return t === tier && ratio > 0 ? ratio : undefined;
  } catch {
    return undefined;
  }
}

export function storePixelRatio(tier: QualityTier, ratio: number): void {
  try {
    localStorage.setItem(RATIO_KEY, `${tier}:${ratio}`);
  } catch {
    // Not remembered: the next visit adapts again.
  }
}
