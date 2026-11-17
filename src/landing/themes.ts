/**
 * The guides' sections (CLAUDE.md §7, landing pages): one page per section (`/<lang>/<slug>/`) besides the hub. Kept
 * apart from topics.ts so the app's Guides window (src/ui/GuidesDialog.ts) can list them without bundling every
 * topic's texts.
 */
import type { Lang } from '../i18n';

export type ThemeId = 'earth' | 'deep' | 'moon' | 'mars' | 'solar' | 'sky';

export interface Theme {
  readonly id: ThemeId;
  readonly name: Readonly<Record<Lang, string>>;
  /** Meta description of the section's page. */
  readonly description: Readonly<Record<Lang, string>>;
  readonly slug: Readonly<Record<Lang, string>>;
  /** The topic whose thumbnail (public/landing/thumbs/<id>.webp) stands for the section. */
  readonly thumb: string;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'earth',
    name: { en: 'Around the Earth', fr: 'Autour de la Terre' },
    description: {
      en: 'Live guides to what orbits the Earth: the ISS, Tiangong, Hubble, Starlink, GPS, Galileo, BeiDou and the geostationary belt.',
      fr: 'Guides en direct sur ce qui tourne autour de la Terre : l’ISS, Tiangong, Hubble, Starlink, le GPS, Galileo, BeiDou et l’orbite géostationnaire.',
    },
    slug: { en: 'around-the-earth', fr: 'autour-de-la-terre' },
    thumb: 'satellites',
  },
  {
    id: 'deep',
    name: { en: 'Telescopes and space probes', fr: 'Télescopes et sondes spatiales' },
    description: {
      en: 'Live guides to the space telescopes and probes beyond Earth orbit: James Webb, Voyager, New Horizons, Parker, Juno and more.',
      fr: 'Guides en direct sur les télescopes spatiaux et les sondes au-delà de l’orbite terrestre : James Webb, Voyager, New Horizons, Parker, Juno et d’autres.',
    },
    slug: { en: 'telescopes-and-space-probes', fr: 'telescopes-et-sondes-spatiales' },
    thumb: 'jwst',
  },
  {
    id: 'moon',
    name: { en: 'The Moon', fr: 'La Lune' },
    description: {
      en: 'Live guides to the Moon: its phase, its distance, the spacecraft orbiting it and the Apollo landing sites.',
      fr: 'Guides en direct sur la Lune : sa phase, sa distance, les sondes en orbite et les sites d’alunissage Apollo.',
    },
    slug: { en: 'the-moon', fr: 'la-lune' },
    thumb: 'moon-orbiters',
  },
  {
    id: 'mars',
    name: { en: 'Mars', fr: 'Mars' },
    description: {
      en: 'Live guides to Mars: the spacecraft orbiting it, the Perseverance and Curiosity rovers, and its distance from the Earth.',
      fr: 'Guides en direct sur Mars : les sondes en orbite, les rovers Perseverance et Curiosity, et sa distance à la Terre.',
    },
    slug: { en: 'mars', fr: 'mars' },
    thumb: 'mars-orbiters',
  },
  {
    id: 'solar',
    name: { en: 'The solar system', fr: 'Le système solaire' },
    description: {
      en: 'Live guides to the solar system: the planets, the dwarf planets, comets, notable asteroids, Pluto and today’s sunspots.',
      fr: 'Guides en direct sur le système solaire : les planètes, les planètes naines, les comètes, les astéroïdes remarquables, Pluton et les taches solaires du jour.',
    },
    slug: { en: 'solar-system', fr: 'systeme-solaire' },
    thumb: 'sun',
  },
  {
    id: 'sky',
    name: { en: 'The sky tonight', fr: 'Le ciel ce soir' },
    description: {
      en: 'Live guides to the sky from where you are: what to see tonight, the visible planets, the next eclipse and the next full Moon.',
      fr: 'Guides en direct sur le ciel de chez vous : que voir ce soir, les planètes visibles, la prochaine éclipse et la prochaine pleine Lune.',
    },
    slug: { en: 'sky-tonight', fr: 'ciel-ce-soir' },
    thumb: 'eclipse',
  },
];

/** A section's page, relative to the site base. */
export const themePath = (theme: Theme, lang: Lang): string => `${lang}/${theme.slug[lang]}/`;
