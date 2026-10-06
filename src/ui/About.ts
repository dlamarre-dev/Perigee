import { loadManifest } from '../data/loader';
import type { Manifest } from '../data/schemas';
import type { I18n } from '../i18n';
import { h, scrollingDialog } from './dom';

interface Credit {
  readonly name: string;
  readonly url: string;
}

/** Credits are proper names, identical in every language (CLAUDE.md §9). */
const DATA_CREDITS: readonly Credit[] = [
  {
    name: 'NASA Blue Marble Next Generation',
    url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble',
  },
  { name: 'NASA Black Marble 2016', url: 'https://earthobservatory.nasa.gov/features/NightLights' },
  { name: 'CelesTrak (T.S. Kelso) / 18th & 19th SDS via Space-Track', url: 'https://celestrak.org' },
  {
    name: 'CelesTrak supplemental GP (fits to operator ephemerides: SpaceX, SES, Intelsat, NASA, GPS, GLONASS…)',
    url: 'https://celestrak.org/NORAD/elements/supplemental/',
  },
  { name: 'NASA/JPL-Caltech Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { name: 'NASA SVS CGI Moon Kit', url: 'https://svs.gsfc.nasa.gov/4720' },
  { name: 'LROC (Lunar Reconnaissance Orbiter Camera, ASU)', url: 'https://lroc.im-ldi.com' },
  { name: 'NASA NSSDCA', url: 'https://nssdc.gsfc.nasa.gov' },
  { name: 'USGS Astrogeology', url: 'https://astrogeology.usgs.gov' },
  {
    name: 'NASA Photojournal (MESSENGER, Cassini, New Horizons)',
    url: 'https://science.nasa.gov/photojournal/',
  },
  { name: 'NASA PDS Ring-Moon Systems Node (Voyager ring profiles)', url: 'https://pds-rings.seti.org' },
  {
    name: 'P. Stooke — small-body maps (NASA PDS Small Bodies Node)',
    url: 'https://sbnarchive.psi.edu/pds4/non_mission/small_bodies.stooke.maps/',
  },
  {
    name: 'P. Thomas, R. Gaskell — shape models of Hyperion and Phoebe (NASA PDS Small Bodies Node)',
    url: 'https://sbn.psi.edu/pds/shape-models/',
  },
  { name: 'NASA/JPL SSD — planetary satellite mean elements', url: 'https://ssd.jpl.nasa.gov/sats/elem/' },
  {
    name: 'NASA 3D Resources (spacecraft, rover and moon models)',
    url: 'https://science.nasa.gov/3d-resources/',
  },
  {
    name: 'NASA/Goddard Space Flight Center Scientific Visualization Studio — Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC)',
    url: 'https://svs.gsfc.nasa.gov/4851',
  },
  { name: 'NASA MMGIS (Mars rover traverses)', url: 'https://mars.nasa.gov/maps/' },
  {
    name: 'Solar System Scope (INOVE) — Venus, Saturn, Uranus, Neptune maps, CC BY 4.0, resampled',
    url: 'https://www.solarsystemscope.com/textures/',
  },
];

const AUTHOR = 'David Fugère-Lamarre';
const REPOSITORY = 'https://github.com/dlamarre-dev/Perigee';

const SOFTWARE_CREDITS: readonly Credit[] = [
  { name: 'astronomy-engine (MIT)', url: 'https://github.com/cosinekitty/astronomy' },
  { name: 'satellite.js (MIT)', url: 'https://github.com/shashwatak/satellite-js' },
  { name: 'three.js (MIT)', url: 'https://threejs.org' },
  { name: 'Basis Universal transcoder (Apache-2.0)', url: 'https://github.com/BinomialLLC/basis_universal' },
  { name: 'Rajdhani — Indian Type Foundry (OFL-1.1)', url: 'https://github.com/itfoundry/rajdhani' },
  { name: 'Saira — Omnibus-Type (OFL-1.1)', url: 'https://github.com/Omnibus-Type/Saira' },
];

function creditList(credits: readonly Credit[]): HTMLUListElement {
  return h(
    'ul',
    {},
    credits.map((c) => h('li', {}, [h('a', { href: c.url, target: '_blank', rel: 'noopener' }, [c.name])])),
  );
}

/** "About" dialog: purpose, disclaimer, attributions, license. */
export class About {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'about-title', tabindex: -1 });
  private readonly intro = h('p');
  private readonly authorLabel = h('span');
  private readonly sourceLink = h('a', { href: REPOSITORY, target: '_blank', rel: 'noopener' });
  private readonly versionLine = h('p', { class: 'small' });
  private readonly dataLine = h('p', { class: 'small' });
  private manifest: Manifest | undefined;
  private manifestError = false;
  private readonly disclaimer = h('p', { class: 'disclaimer' });
  private readonly sourcesTitle = h('h3');
  private readonly softwareTitle = h('h3');
  private readonly license = h('p');
  private readonly reports = h('p', { class: 'small' });
  private readonly close = h('button', { type: 'button', class: 'btn', autofocus: true });

  constructor(
    private readonly i18n: I18n,
    private readonly baseUrl: string,
  ) {
    this.close.addEventListener('click', () => this.element.close());
    this.element = h('dialog', { class: 'panel about', 'aria-labelledby': 'about-title' }, [
      this.title,
      this.intro,
      h('p', { class: 'about-author' }, [
        this.authorLabel,
        ' ',
        h('strong', {}, [AUTHOR]),
        ' · ',
        this.sourceLink,
      ]),
      this.versionLine,
      this.dataLine,
      this.disclaimer,
      this.sourcesTitle,
      creditList(DATA_CREDITS),
      this.softwareTitle,
      creditList(SOFTWARE_CREDITS),
      this.license,
      this.reports,
      h('div', { class: 'dialog-actions' }, [this.close]),
    ]);
    scrollingDialog(this.element);
    // Close when clicking the backdrop.
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
  }

  open(): void {
    this.element.showModal();
    // showModal focuses the first focusable element, which can scroll a tall dialog's body away from its top:
    // start at the title instead, scrolled to the top.
    this.title.focus({ preventScroll: true });
    const body = this.element.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
    // Fresh on every opening: the data branch is republished several times a day.
    loadManifest(this.baseUrl)
      .then((m) => {
        this.manifest = m;
        this.manifestError = false;
      })
      .catch(() => {
        this.manifestError = true;
      })
      .finally(() => this.renderData());
  }

  private renderData(): void {
    const t = this.i18n.t.bind(this.i18n);
    const m = this.manifest;
    if (!m) {
      this.dataLine.textContent = this.manifestError ? t('about.dataUnavailable') : '';
      return;
    }
    const utc = (iso: string | undefined): string | undefined =>
      iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : undefined;
    const latest = (isos: readonly string[]): string | undefined => [...isos].sort().at(-1);
    const parts: string[] = [];
    const gp = utc(m.datasets['earth.gp']?.fetchedAt);
    if (gp) parts.push(`${t('about.data.satellites')} ${gp}`);
    const satcat = utc(m.datasets['earth.satcat']?.fetchedAt);
    if (satcat) parts.push(`${t('about.data.satcat')} ${satcat}`);
    const ephem = utc(latest(Object.values(m.ephemerides).map((e) => e.fetchedAt)));
    if (ephem) parts.push(`${t('about.data.ephemerides')} ${ephem}`);
    this.dataLine.textContent = `${t('about.dataRefreshed')} ${parts.join(' · ')}`;
  }

  private renderLabels(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('about.title');
    this.intro.textContent = t('about.intro');
    this.authorLabel.textContent = t('about.author');
    this.sourceLink.textContent = t('about.sourceCode');
    const build = __PERIGEE_BUILD__;
    const commit = h(
      'a',
      { href: `${REPOSITORY}/commit/${build.commit}`, target: '_blank', rel: 'noopener' },
      [build.commit],
    );
    this.versionLine.replaceChildren(
      `${t('about.version')} `,
      build.commit === 'dev' ? build.commit : commit,
      build.date ? ` (${build.date.slice(0, 10)})` : '',
    );
    this.renderData();
    this.disclaimer.textContent = t('about.disclaimer');
    this.sourcesTitle.textContent = t('about.sources');
    this.softwareTitle.textContent = t('about.software');
    this.license.textContent = t('about.license');
    this.reports.textContent = t('about.reports');
    this.close.textContent = t('about.close');
  }
}
