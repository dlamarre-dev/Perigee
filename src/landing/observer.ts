/**
 * The visitor's place on the landing pages ("My location", CLAUDE.md §7): asked from the browser only on a click,
 * rounded to 0.01° (about 1 km) and kept in this browser's storage (`perigee-observer`) until "Forget". It never
 * leaves the device: it is not put in any address, and the 3D view receives it through postMessage only.
 */
export const OBSERVER_KEY = 'perigee-observer';

export interface Place {
  readonly latDeg: number;
  readonly lonDeg: number;
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** The place rounded to about a kilometre, longitude in −180…180. */
export function roundPlace(latDeg: number, lonDeg: number): Place {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  return { latDeg: round(Math.max(-90, Math.min(90, latDeg))), lonDeg: round(lon) };
}

export function loadPlace(storage: Storage | undefined): Place | undefined {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(OBSERVER_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return undefined;
    const { latDeg, lonDeg } = raw as Record<string, unknown>;
    if (typeof latDeg !== 'number' || typeof lonDeg !== 'number') return undefined;
    if (!(Math.abs(latDeg) <= 90) || !(Math.abs(lonDeg) <= 180)) return undefined;
    return roundPlace(latDeg, lonDeg);
  } catch {
    return undefined;
  }
}

export function savePlace(storage: Storage | undefined, place: Place): void {
  try {
    storage?.setItem(OBSERVER_KEY, JSON.stringify(roundPlace(place.latDeg, place.lonDeg)));
  } catch {
    // Storage refused (private mode): the place still works for this visit.
  }
}

export function forgetPlace(storage: Storage | undefined): void {
  try {
    storage?.removeItem(OBSERVER_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The browser's local storage, or undefined where it is blocked. */
export function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Asks the browser for the place (one reading, a few minutes old at most). */
export function locate(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(roundPlace(p.coords.latitude, p.coords.longitude)),
      (err) => reject(new Error(err.message || 'denied')),
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 20_000 },
    );
  });
}
