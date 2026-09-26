import type { I18n } from '../i18n';
import { h } from './dom';

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
  { name: 'NASA/JPL-Caltech Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { name: 'NASA SVS CGI Moon Kit', url: 'https://svs.gsfc.nasa.gov/4720' },
  { name: 'USGS Astrogeology', url: 'https://astrogeology.usgs.gov' },
];

const SOFTWARE_CREDITS: readonly Credit[] = [
  { name: 'astronomy-engine (MIT)', url: 'https://github.com/cosinekitty/astronomy' },
  { name: 'satellite.js (MIT)', url: 'https://github.com/shashwatak/satellite-js' },
  { name: 'three.js (MIT)', url: 'https://threejs.org' },
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
  private readonly title = h('h2', { id: 'about-title' });
  private readonly intro = h('p');
  private readonly disclaimer = h('p', { class: 'disclaimer' });
  private readonly sourcesTitle = h('h3');
  private readonly softwareTitle = h('h3');
  private readonly license = h('p');
  private readonly close = h('button', { type: 'button', class: 'btn', autofocus: true });

  constructor(private readonly i18n: I18n) {
    this.close.addEventListener('click', () => this.element.close());
    this.element = h('dialog', { class: 'panel about', 'aria-labelledby': 'about-title' }, [
      this.title,
      this.intro,
      this.disclaimer,
      this.sourcesTitle,
      creditList(DATA_CREDITS),
      this.softwareTitle,
      creditList(SOFTWARE_CREDITS),
      this.license,
      h('div', { class: 'dialog-actions' }, [this.close]),
    ]);
    // Close when clicking the backdrop.
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
  }

  open(): void {
    this.element.showModal();
  }

  private renderLabels(): void {
    const t = this.i18n.t.bind(this.i18n);
    this.title.textContent = t('about.title');
    this.intro.textContent = t('about.intro');
    this.disclaimer.textContent = t('about.disclaimer');
    this.sourcesTitle.textContent = t('about.sources');
    this.softwareTitle.textContent = t('about.software');
    this.license.textContent = t('about.license');
    this.close.textContent = t('about.close');
  }
}
