/**
 * Keeps an open tab current (CLAUDE.md §8). The service worker and the HTTP cache serve a tab's first load;
 * after that, nothing would tell a page left open for hours that a new build or new data were published. The
 * watcher compares, every few minutes while the tab is visible:
 * - the build commit with `version.json` (written at build time, never cached);
 * - the hashes of the data the current view loaded with `data/manifest.json`.
 * The shell then reloads (tab in the background) or offers a "Refresh" button, and restores the camera from a
 * short-lived snapshot in sessionStorage.
 */
import type { Manifest } from '../data/schemas';

export type UpdateKind = 'app' | 'data';

/** Key of a dataset or an ephemeris in a view's loaded-data map. */
export const datasetKey = (key: string): string => `dataset:${key}`;
export const ephemerisKey = (missionId: string): string => `ephem:${missionId}`;

/** Hash published for a loaded-data key, or undefined when the manifest no longer lists it. */
function publishedHash(manifest: Manifest, key: string): string | undefined {
  if (key.startsWith('dataset:')) {
    return manifest.datasets[key.slice('dataset:'.length) as keyof Manifest['datasets']]?.sha256;
  }
  if (key.startsWith('ephem:')) return manifest.ephemerides[key.slice('ephem:'.length)]?.sha256;
  return undefined;
}

/**
 * What changed since the page loaded. A new build wins over new data (reloading brings both). A dataset that
 * vanished from the manifest is not "new data": the page keeps what it has.
 */
export function detectUpdate(
  localCommit: string,
  remoteCommit: string | undefined,
  loaded: ReadonlyMap<string, string>,
  manifest: Manifest | undefined,
): UpdateKind | undefined {
  if (remoteCommit && localCommit !== 'dev' && remoteCommit !== localCommit) return 'app';
  if (!manifest) return undefined;
  for (const [key, hash] of loaded) {
    const now = publishedHash(manifest, key);
    if (now !== undefined && now !== hash) return 'data';
  }
  return undefined;
}

export interface UpdateWatcherOptions {
  readonly baseUrl: string;
  readonly commit: string;
  /** Hashes of the data the current view loaded (empty while loading). */
  readonly loaded: () => ReadonlyMap<string, string>;
  readonly loadManifest: () => Promise<Manifest>;
  readonly onUpdate: (kind: UpdateKind) => void;
  readonly fetch?: typeof fetch;
  readonly intervalMs?: number;
  /** Shortest delay between two checks triggered by the tab becoming visible. */
  readonly minGapMs?: number;
}

export class UpdateWatcher {
  private lastCheckMs = Date.now();
  private timer: number | undefined;
  private found = false;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible' && Date.now() - this.lastCheckMs >= this.minGapMs)
      void this.check();
  };
  private readonly minGapMs: number;

  constructor(private readonly options: UpdateWatcherOptions) {
    this.minGapMs = options.minGapMs ?? 5 * 60_000;
  }

  start(): void {
    this.timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void this.check();
      },
      this.options.intervalMs ?? 15 * 60_000,
    );
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop(): void {
    window.clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  /** One check; network failures are ignored (offline: the badge already says so) until the next one. */
  async check(): Promise<UpdateKind | undefined> {
    if (this.found) return undefined;
    this.lastCheckMs = Date.now();
    const { baseUrl, commit } = this.options;
    const get = this.options.fetch ?? fetch.bind(window);
    let remoteCommit: string | undefined;
    try {
      const res = await get(`${baseUrl}version.json`, { cache: 'no-cache' });
      if (res.ok) {
        const body = (await res.json()) as { commit?: unknown };
        if (typeof body.commit === 'string') remoteCommit = body.commit;
      }
    } catch {
      return undefined;
    }
    const loaded = this.options.loaded();
    let kind = detectUpdate(commit, remoteCommit, loaded, undefined);
    if (!kind && loaded.size > 0) {
      const manifest = await this.options.loadManifest().catch(() => undefined);
      kind = detectUpdate(commit, remoteCommit, loaded, manifest);
    }
    if (kind) {
      this.found = true;
      this.options.onUpdate(kind);
    }
    return kind;
  }
}

/** Camera snapshot carried across an update reload (same tab only). */
export interface CameraSnapshot {
  readonly view: string;
  readonly frame: string;
  readonly savedAtMs: number;
  readonly targetKm: readonly [number, number, number];
  readonly distanceKm: number;
  readonly orientation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly following: boolean;
}

const CAMERA_KEY = 'perigee-camera';
const RELOAD_KEY = 'perigee-auto-reload';
export const CAMERA_SNAPSHOT_TTL_MS = 2 * 60_000;
/** At most one automatic reload per this delay (a server that really fails must not cause a loop). */
export const AUTO_RELOAD_GAP_MS = 60_000;

function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveCamera(snapshot: CameraSnapshot): void {
  try {
    storage()?.setItem(CAMERA_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked: the reload simply starts from the home view.
  }
}

/** Reads and removes a sessionStorage entry. */
function readOnce(key: string): string | null {
  try {
    const s = storage();
    const raw = s?.getItem(key) ?? null;
    s?.removeItem(key);
    return raw;
  } catch {
    return null;
  }
}

/** The snapshot saved for this view and frame less than CAMERA_SNAPSHOT_TTL_MS ago; read once. */
export function takeCamera(view: string, frame: string, nowMs = Date.now()): CameraSnapshot | undefined {
  const raw = readOnce(CAMERA_KEY);
  if (!raw) return undefined;
  try {
    const snap = JSON.parse(raw) as CameraSnapshot;
    if (snap.view !== view || snap.frame !== frame) return undefined;
    if (!(nowMs - snap.savedAtMs >= 0 && nowMs - snap.savedAtMs < CAMERA_SNAPSHOT_TTL_MS)) return undefined;
    const q = snap.orientation;
    const finite = [...snap.targetKm, snap.distanceKm, q.x, q.y, q.z, q.w].every(Number.isFinite);
    return finite && snap.distanceKm > 0 ? snap : undefined;
  } catch {
    return undefined;
  }
}

/** True (and remembered) when an automatic reload is allowed now; false within AUTO_RELOAD_GAP_MS of the last. */
export function claimAutoReload(nowMs = Date.now()): boolean {
  const s = storage();
  try {
    const last = Number(s?.getItem(RELOAD_KEY) ?? 0);
    if (nowMs - last < AUTO_RELOAD_GAP_MS) return false;
    s?.setItem(RELOAD_KEY, String(nowMs));
    return true;
  } catch {
    return false;
  }
}
