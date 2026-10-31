/**
 * Credits and the site's fixed links (CLAUDE.md §9), shared by the About dialog (src/ui/About.ts) and the landing
 * pages (src/landing/): proper names, plus a translated description where needed. No DOM.
 */
import type { Lang } from '../i18n';

export interface Credit {
  /** Proper name, identical in every language. */
  readonly name: string;
  /** What the credit covers, when the name does not say it. */
  readonly detail?: { readonly en: string; readonly fr: string };
  readonly url: string;
}

/** Credits (CLAUDE.md §9): proper names, plus a translated description where needed. */
export const DATA_CREDITS: readonly Credit[] = [
  {
    name: 'NASA Blue Marble Next Generation',
    url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble',
  },
  { name: 'NASA Black Marble 2016', url: 'https://earthobservatory.nasa.gov/features/NightLights' },
  { name: 'CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track', url: 'https://celestrak.org' },
  {
    name: 'CelesTrak supplemental GP',
    detail: {
      en: 'fits to operator ephemerides: SpaceX, SES, Intelsat, NASA, GPS, GLONASS…',
      fr: 'ajustements aux éphémérides des opérateurs : SpaceX, SES, Intelsat, NASA, GPS, GLONASS…',
    },
    url: 'https://celestrak.org/NORAD/elements/supplemental/',
  },
  { name: 'NASA/JPL-Caltech Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  {
    name: 'NOAA Space Weather Prediction Center',
    detail: { en: 'solar active regions (sunspots)', fr: 'régions actives du Soleil (taches solaires)' },
    url: 'https://www.swpc.noaa.gov',
  },
  {
    name: 'NASA PDS Geosciences Node',
    detail: { en: 'MOLA topography of Mars (relief)', fr: 'topographie MOLA de Mars (relief)' },
    url: 'https://pds-geosciences.wustl.edu',
  },
  { name: 'NASA SVS CGI Moon Kit', url: 'https://svs.gsfc.nasa.gov/4720' },
  { name: 'LROC (Lunar Reconnaissance Orbiter Camera, ASU)', url: 'https://lroc.im-ldi.com' },
  { name: 'NASA NSSDCA', url: 'https://nssdc.gsfc.nasa.gov' },
  { name: 'USGS Astrogeology', url: 'https://astrogeology.usgs.gov' },
  {
    name: 'NASA Photojournal (MESSENGER, Cassini, New Horizons)',
    url: 'https://science.nasa.gov/photojournal/',
  },
  {
    name: 'NASA PDS Ring-Moon Systems Node',
    detail: { en: 'Voyager ring profiles', fr: 'profils des anneaux de Voyager' },
    url: 'https://pds-rings.seti.org',
  },
  {
    name: 'P. Stooke',
    detail: {
      en: 'small-body maps (NASA PDS Small Bodies Node)',
      fr: 'cartes de petits corps (NASA PDS Small Bodies Node)',
    },
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.maps/',
  },
  {
    name: 'P. Thomas, R. Gaskell',
    detail: {
      en: 'shape models of Hyperion and Phoebe (NASA PDS Small Bodies Node)',
      fr: 'modèles de forme d’Hypérion et de Phœbé (NASA PDS Small Bodies Node)',
    },
    url: 'https://sbn.psi.edu/pds/shape-models/',
  },
  {
    name: 'NASA/JPL SSD',
    detail: { en: 'planetary satellite mean elements', fr: 'éléments moyens des satellites planétaires' },
    url: 'https://ssd.jpl.nasa.gov/sats/elem/',
  },
  {
    name: 'NASA 3D Resources',
    detail: { en: 'spacecraft, rover and moon models', fr: 'modèles de sondes, de rovers et de lunes' },
    url: 'https://science.nasa.gov/3d-resources/',
  },
  {
    name: 'NASA/Goddard Space Flight Center Scientific Visualization Studio',
    detail: {
      en: 'Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC)',
      fr: 'Deep Star Maps 2020 (Gaia DR2 : ESA/Gaia/DPAC)',
    },
    url: 'https://svs.gsfc.nasa.gov/4851',
  },
  {
    name: 'SIMBAD (CDS, Strasbourg)',
    detail: {
      en: 'positions, magnitudes and spectral types of the named stars',
      fr: 'positions, magnitudes et types spectraux des étoiles nommées',
    },
    url: 'https://simbad.cds.unistra.fr/simbad/',
  },
  {
    name: 'Wikimedia Commons, NASA Image and Video Library, LROC',
    detail: {
      en: 'images of the objects without a 3D model; author and licence under each image',
      fr: 'images des objets sans modèle 3D ; auteur et licence sous chaque image',
    },
    url: 'https://commons.wikimedia.org',
  },
  {
    name: 'NASA MMGIS',
    detail: { en: 'Mars rover traverses', fr: 'trajets des rovers martiens' },
    url: 'https://mars.nasa.gov/maps/',
  },
  {
    name: 'Solar System Scope (INOVE)',
    detail: {
      en: 'Venus, Saturn, Uranus, Neptune maps, CC BY 4.0, resampled',
      fr: 'cartes de Vénus, Saturne, Uranus et Neptune, CC BY 4.0, rééchantillonnées',
    },
    url: 'https://www.solarsystemscope.com/textures/',
  },
];

export const AUTHOR = 'David Fugère-Lamarre';
export const REPOSITORY = 'https://github.com/dlamarre-dev/Perigee';
export const GOATCOUNTER = 'https://www.goatcounter.com';
export const ALTERNATIVETO =
  'https://alternativeto.net/software/perigee/about/?utm_source=badge&utm_medium=referral';
/** Static pages in public/, one per language. */
export const PRIVACY_PAGES: Readonly<Record<Lang, string>> = {
  en: 'privacy.html',
  fr: 'confidentialite.html',
};

export const SOFTWARE_CREDITS: readonly Credit[] = [
  { name: 'astronomy-engine (MIT)', url: 'https://github.com/cosinekitty/astronomy' },
  { name: 'satellite.js (MIT)', url: 'https://github.com/shashwatak/satellite-js' },
  { name: 'three.js (MIT)', url: 'https://threejs.org' },
  { name: 'Basis Universal transcoder (Apache-2.0)', url: 'https://github.com/BinomialLLC/basis_universal' },
  { name: 'Rajdhani, Indian Type Foundry (OFL-1.1)', url: 'https://github.com/itfoundry/rajdhani' },
  { name: 'Saira, Omnibus-Type (OFL-1.1)', url: 'https://github.com/Omnibus-Type/Saira' },
];
