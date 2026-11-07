/**
 * Computes a solar eclipse's map (src/astro/eclipseMap.ts) off the page's main thread: about 0.1–0.5 s of
 * arithmetic over the grid of the partial zone.
 */
import { solarEclipseMap } from '../astro/eclipseMap';

self.onmessage = (e: MessageEvent<{ id: number; peak: string }>) => {
  const map = solarEclipseMap(new Date(e.data.peak));
  (self as unknown as Worker).postMessage({ id: e.data.id, map }, [
    map.grid.values.buffer,
    map.grid.limitField.buffer,
    map.grid.halfField.buffer,
  ]);
};
