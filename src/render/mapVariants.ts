/**
 * Bodies with a second map the visitor can switch to from the info panel (a two-way switch under the 3D preview): Titan in
 * visible light (its orange haze) or in near infrared (the Cassini surface mosaic), Venus's cloud tops or its radar
 * surface. One choice per body for the whole page, shared by the panel's preview and the 3D view: both cross-fade
 * (BodyMesh.setAltVariant) when it changes. Remembered for the session only.
 */
import type { MessageKey } from '../i18n';

export interface MapVariant {
  /** Texture name of the second map (public/textures/<body>/<alt>-<k>k.*). */
  readonly alt: string;
  /** Names of the two maps, on the two halves of the switch. */
  readonly mainLabel: MessageKey;
  readonly altLabel: MessageKey;
  /** What the preview shows, under it. */
  readonly mainCaption: MessageKey;
  readonly altCaption: MessageKey;
}

export const MAP_VARIANTS: Readonly<Record<string, MapVariant>> = {
  titan: {
    alt: 'infrared',
    mainLabel: 'map.titan.mainLabel',
    altLabel: 'map.titan.altLabel',
    mainCaption: 'map.titan.main',
    altCaption: 'map.titan.alt',
  },
  venus: {
    alt: 'surface',
    mainLabel: 'map.venus.mainLabel',
    altLabel: 'map.venus.altLabel',
    mainCaption: 'map.venus.main',
    altCaption: 'map.venus.alt',
  },
};

const shown = new Set<string>();
const listeners = new Set<(body: string) => void>();

/** The body shows its second map. */
export function altShown(body: string): boolean {
  return shown.has(body);
}

export function setAltShown(body: string, on: boolean): void {
  if (on === shown.has(body)) return;
  if (on) shown.add(body);
  else shown.delete(body);
  for (const listener of listeners) listener(body);
}

/** Called when a body's choice changes; returns the unsubscribe function. */
export function onMapVariantChange(listener: (body: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
