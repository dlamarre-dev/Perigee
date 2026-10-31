import { loadManifest } from '../data/loader';
import type { Manifest } from '../data/schemas';
import type { I18n, Lang } from '../i18n';
import {
  ALTERNATIVETO,
  AUTHOR,
  DATA_CREDITS,
  GOATCOUNTER,
  PRIVACY_PAGES,
  REPOSITORY,
  SOFTWARE_CREDITS,
  type Credit,
} from '../data/credits';
import { h, scrollingDialog } from './dom';

/** Fills `list` with `credits` in `lang` (re-run on a language change). */
function renderCredits(list: HTMLUListElement, credits: readonly Credit[], lang: Lang): void {
  list.replaceChildren(
    ...credits.map((c) =>
      h('li', {}, [
        h('a', { href: c.url, target: '_blank', rel: 'noopener' }, [c.name]),
        ...(c.detail ? [`${lang === 'fr' ? ' : ' : ': '}${c.detail[lang]}`] : []),
      ]),
    ),
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
  private readonly dataCredits = h('ul');
  private readonly softwareCredits = h('ul');
  private readonly license = h('p');
  private readonly privacyTitle = h('h3');
  private readonly analytics = h('p', { class: 'small' });
  private readonly reports = h('p', { class: 'small' });
  private readonly privacyLink = h('a', { target: '_blank', rel: 'noopener' });
  private readonly guidesLink = h('a');
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
      h('p', {}, [this.guidesLink]),
      this.disclaimer,
      this.sourcesTitle,
      this.dataCredits,
      this.softwareTitle,
      this.softwareCredits,
      this.license,
      this.privacyTitle,
      this.analytics,
      this.reports,
      h('p', { class: 'small' }, [this.privacyLink]),
      h('div', { class: 'dialog-actions' }, [
        // AlternativeTo's badge, served from this site (public/badges): no request leaves for their server until
        // the visitor follows the link.
        h('a', { class: 'about-badge', href: ALTERNATIVETO, target: '_blank', rel: 'noopener' }, [
          h('img', {
            src: `${baseUrl}badges/alternativeto.svg`,
            alt: 'Perigee | AlternativeTo',
            width: 171,
            height: 58,
          }),
        ]),
        this.close,
      ]),
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
    const when = (iso: string | undefined): string | undefined =>
      iso ? this.i18n.dateTime(new Date(iso)) : undefined;
    const latest = (isos: readonly string[]): string | undefined => [...isos].sort().at(-1);
    const parts: string[] = [];
    const gp = when(m.datasets['earth.gp']?.fetchedAt);
    if (gp) parts.push(`${t('about.data.satellites')} ${gp}`);
    const satcat = when(m.datasets['earth.satcat']?.fetchedAt);
    if (satcat) parts.push(`${t('about.data.satcat')} ${satcat}`);
    const ephem = when(latest(Object.values(m.ephemerides).map((e) => e.fetchedAt)));
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
      `${t('about.version')} ${build.version} · ${t('about.commit')} `,
      build.commit === 'dev' ? build.commit : commit,
      build.date ? ` (${build.date.slice(0, 10)})` : '',
    );
    this.renderData();
    this.disclaimer.textContent = t('about.disclaimer');
    this.sourcesTitle.textContent = t('about.sources');
    this.softwareTitle.textContent = t('about.software');
    renderCredits(this.dataCredits, DATA_CREDITS, this.i18n.lang);
    renderCredits(this.softwareCredits, SOFTWARE_CREDITS, this.i18n.lang);
    this.license.textContent = t('about.license');
    this.privacyTitle.textContent = t('about.privacy');
    const [before = '', after = ''] = t('about.analytics').split('{goatcounter}');
    this.analytics.replaceChildren(
      before,
      h('a', { href: GOATCOUNTER, target: '_blank', rel: 'noopener' }, ['GoatCounter']),
      after,
    );
    this.reports.textContent = t('about.reports');
    this.privacyLink.textContent = t('about.privacyPolicy');
    this.guidesLink.textContent = t('about.guides');
    this.guidesLink.href = `${this.baseUrl}${this.i18n.lang}/`;
    this.privacyLink.href = `${this.baseUrl}${PRIVACY_PAGES[this.i18n.lang]}`;
    this.close.textContent = t('about.close');
  }
}
