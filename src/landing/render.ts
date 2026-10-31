/**
 * Static HTML of the landing pages (./topics.ts), written at build time by the `landingPages` Vite plugin and by the
 * dev server: what a search engine indexes (title, description, hreflang pair, structured data, the question, the
 * intro, the catalogue facts, the FAQ) and the empty frames the page script (./main.ts) fills with live values. No
 * position is computed here (CLAUDE.md §2.1). No DOM: strings only.
 */
import {
  AUTHOR,
  DATA_CREDITS,
  PRIVACY_PAGES,
  REPOSITORY,
  SOFTWARE_CREDITS,
  type Credit,
} from '../data/credits';
import { LICENCES } from '../data/licences';
import { isInactiveMission } from '../data/schemas';
import { catalogs, imageOf, resolve, type ObjectRef } from '../engine/objects';
import { I18n, type Lang, type MessageKey } from '../i18n';
import { THEMES, TOPICS, topicHasPlace, topicPath, type Topic, type TopicView } from './topics';

export interface RenderContext {
  /** Absolute site address for canonical links and structured data (https://perigee.info/). */
  readonly site: string;
  /** Path the site is served from (Vite `base`: "/" in production, "/Perigee/" locally). */
  readonly base: string;
  readonly version: string;
  /**
   * Content hashes of the files under public/ (`vite.config.ts` `assetVersions`, keyed by path): which topic captures
   * exist (public/landing/og/<lang>/<id>.jpg, tools/screenshots/og.ts) and their `?v=`. Without it, the shared image.
   */
  readonly assets?: Readonly<Record<string, string>>;
  /** Last change of the landing pages' texts and templates (YYYY-MM-DD, the last commit touching src/landing/). */
  readonly landingDate?: string;
}

/** Size of the topic captures (Open Graph images and the 3D view's poster). */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** A topic's capture of its 3D view, when tools/screenshots/og.ts made one: site-relative path with its version. */
export function topicCapture(topic: Topic, lang: Lang, ctx: RenderContext): string | undefined {
  const path = `landing/og/${lang}/${topic.id}.jpg`;
  const version = ctx.assets?.[path];
  return version ? `${path}?v=${version}` : undefined;
}

const LANGS: readonly Lang[] = ['en', 'fr'];
const other = (lang: Lang): Lang => (lang === 'en' ? 'fr' : 'en');

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** JSON for a <script type="application/ld+json"> block (no closing tag can appear in it). */
const jsonLd = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');

const BRAND: Record<Lang, string> = { en: 'Perigee', fr: 'Périgée' };

/** Link to the app showing a topic's view, in embed mode for the iframe. */
export function viewQuery(view: TopicView, lang: Lang, embed: boolean): string {
  const p = new URLSearchParams();
  if (view.view !== 'earth') p.set('view', view.view);
  if (view.sel) p.set('sel', view.sel);
  for (const [k, v] of Object.entries(view.params ?? {})) p.set(k, v);
  if (view.hideMissions && view.view !== 'earth') {
    // The active spacecraft (the inactive ones are hidden by default, src/app/hiddenMissions.ts); natural
    // bodies (dwarf planets, Phobos, Deimos) stay.
    const body = view.view === 'solar' ? 'sun' : view.view;
    const hide = catalogs.missions
      .filter((m) => m.centralBody === body && m.objectType !== 'natural' && !isInactiveMission(m))
      // A page about one spacecraft shows it alone.
      .filter((m) => m.id !== view.sel)
      .map((m) => m.id)
      .sort();
    if (hide.length) p.set('hide', hide.join(','));
  }
  p.set('lang', lang);
  if (view.follow) p.set('follow', '1');
  if (embed) p.set('embed', '1');
  return `?${p.toString()}`;
}

/**
 * Latest `verified` date of the catalogue entries a topic describes (YYYY-MM-DD): its spacecraft or curated
 * satellite, or the active spacecraft around its body. Undefined when it shows no dated entry (planets, sky, sites).
 */
export function topicCatalogueDate(topic: Topic): string | undefined {
  const dates: string[] = [];
  for (const id of [topic.target, ...(topic.targets ?? [])]) {
    const ref = refOf(id);
    if (ref?.kind === 'mission') dates.push(ref.mission.verified);
    else if (ref?.kind === 'satellite' && ref.curated) dates.push(ref.curated.verified);
  }
  if (topic.around)
    for (const m of catalogs.missions)
      if (m.centralBody === topic.around && m.objectType !== 'natural' && !isInactiveMission(m))
        dates.push(m.verified);
  return dates.sort().at(-1);
}

function refOf(id: string | undefined): ObjectRef | undefined {
  if (!id) return undefined;
  try {
    return resolve(id);
  } catch {
    return undefined;
  }
}

/** Display name of an object from the catalogues (satellites: the curated name). */
export function nameOf(ref: ObjectRef | undefined, lang: Lang): string | undefined {
  if (!ref) return undefined;
  switch (ref.kind) {
    case 'satellite':
      return ref.curated?.name[lang];
    case 'mission':
      return ref.mission.name[lang];
    case 'site':
      return ref.site.name[lang];
    case 'planet':
      return ref.planet.name[lang];
    case 'moon':
      return ref.moon.name[lang];
    case 'comet':
      return ref.comet.name[lang];
    case 'asteroid':
      return ref.asteroid.name[lang];
    case 'sun':
      return lang === 'fr' ? 'le Soleil' : 'the Sun';
    default:
      return undefined;
  }
}

function figure(ref: ObjectRef | undefined, i18n: I18n, ctx: RenderContext): string {
  const image = ref && imageOf(ref);
  if (!image) return '';
  const licence = LICENCES[image.licence];
  const kind = i18n.maybe(`image.kind.${image.kind}`) ?? '';
  const licenceText = licence.url
    ? `<a href="${esc(licence.url)}" rel="license noopener" target="_blank">${esc(licence.name)}</a>`
    : esc(licence.name);
  return `<figure class="lp-figure">
  <a href="${ctx.base}images/${image.id}-large.webp"><img src="${ctx.base}images/${image.id}.webp" alt="${esc(nameOf(ref, i18n.lang) ?? '')}" loading="lazy" decoding="async"></a>
  <figcaption>${esc(kind)} · ${esc(image.credit)}, ${licenceText} · <a href="${esc(image.sources[0] ?? image.file)}" target="_blank" rel="noopener">source</a></figcaption>
</figure>`;
}

/** Catalogue facts of the object (goals, current notes, agency, launch, official site). */
function facts(ref: ObjectRef | undefined, i18n: I18n): string {
  if (!ref) return '';
  const lang = i18n.lang;
  const rows: [string, string][] = [];
  let goals: string | undefined;
  let notes: string | undefined;
  let website: string | undefined;
  if (ref.kind === 'mission') {
    const m = ref.mission;
    if (m.agency) rows.push([i18n.t('info.agency'), m.agency]);
    if (m.launchDate) rows.push([i18n.t('landing.facts.launched'), m.launchDate]);
    rows.push([i18n.t('info.status'), i18n.maybe(`mission.status.${m.status}`) ?? m.status]);
    goals = m.goals?.[lang];
    notes = m.notes?.[lang];
    website = m.website?.url;
  } else if (ref.kind === 'satellite' && ref.curated) {
    const s = ref.curated;
    rows.push([i18n.t('info.agency'), s.agency]);
    if (s.launchDate) rows.push([i18n.t('landing.facts.launched'), s.launchDate]);
    goals = s.goals?.[lang] ?? s.purpose[lang];
    notes = s.notes?.[lang];
    website = s.website?.url;
  } else if (ref.kind === 'site') {
    const s = ref.site;
    rows.push([i18n.t('landing.table.kind'), i18n.maybe(`site.${s.type}`) ?? s.type]);
    rows.push([i18n.t('info.agency'), s.agency]);
    rows.push([i18n.t('landing.table.date'), s.date]);
    rows.push([i18n.t('landing.table.coords'), i18n.latLon(s.latDeg, s.lonDeg)]);
    notes = s.note?.[lang];
  } else {
    return '';
  }
  const name = nameOf(ref, lang) ?? '';
  return `<section class="lp-facts panel">
  <h2>${esc(i18n.format('landing.facts.about', { name }))}</h2>
  ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
  ${goals ? `<h3>${esc(i18n.t('landing.facts.goals'))}</h3><p>${esc(goals)}</p>` : ''}
  ${notes ? `<h3>${esc(i18n.t('landing.facts.now'))}</h3><p>${esc(notes)}</p>` : ''}
  ${website ? `<p><a href="${esc(website)}" target="_blank" rel="noopener">${esc(i18n.t('landing.facts.website'))} ↗</a></p>` : ''}
</section>`;
}

/** Rows of the objects a list topic shows (names from the catalogues; live columns filled by the script). */
export function listedObjects(topic: Topic): readonly string[] {
  if (topic.kind === 'sites') return topic.targets ?? [];
  if (topic.kind === 'around') {
    return catalogs.missions
      .filter((m) => m.centralBody === topic.around && m.objectType !== 'natural' && !isInactiveMission(m))
      .filter((m) => m.status !== 'planned')
      .map((m) => m.id);
  }
  if (topic.kind === 'bodies') {
    switch (topic.bodySet) {
      case 'planets':
        return ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
      case 'dwarfs':
        return [
          'pluto',
          ...catalogs.missions.filter((m) => m.dwarfStatus === 'iau').map((m) => m.id),
          ...catalogs.missions.filter((m) => m.dwarfStatus === 'candidate').map((m) => m.id),
        ];
      case 'comets':
        return catalogs.comets.map((c) => `comet:${c.id}`);
      case 'asteroids':
        return catalogs.asteroids.map((a) => `asteroid:${a.id}`);
      default:
        return [];
    }
  }
  return [];
}

function listTable(topic: Topic, i18n: I18n): string {
  const ids = listedObjects(topic);
  if (!ids.length) return '';
  const t = (k: MessageKey): string => esc(i18n.t(k));
  const lang = i18n.lang;
  let head: string[];
  let row: (id: string, ref: ObjectRef | undefined) => string[];
  if (topic.kind === 'sites') {
    head = [t('landing.table.name'), t('landing.table.date'), t('landing.table.coords')];
    row = (_id, ref) =>
      ref?.kind === 'site'
        ? [esc(ref.site.date), esc(i18n.latLon(ref.site.latDeg, ref.site.lonDeg))]
        : ['', ''];
  } else if (topic.kind === 'around') {
    head = [
      t('landing.table.name'),
      t('landing.table.agency'),
      t('landing.table.status'),
      t('landing.card.altitude'),
    ];
    row = (_id, ref) =>
      ref?.kind === 'mission'
        ? [
            esc(ref.mission.agency ?? ''),
            esc(i18n.maybe(`mission.status.${ref.mission.status}`) ?? ref.mission.status),
            ref.mission.ephemeris === 'horizons'
              ? '<span data-live="altitude">–</span>'
              : `<span class="lp-muted">${t('landing.table.notDrawn')}</span>`,
          ]
        : ['', '', ''];
  } else {
    head = [t('landing.table.name'), t('landing.table.distanceSun'), t('landing.table.distanceEarth')];
    if (topic.bodySet === 'comets') head.push(t('landing.table.magnitude'));
    if (topic.bodySet === 'asteroids') head.push(t('landing.table.size'));
    row = (_id, ref) => {
      const cells = ['<span data-live="sun">–</span>', '<span data-live="earth">–</span>'];
      if (topic.bodySet === 'comets') cells.push('<span data-live="mag">–</span>');
      if (ref?.kind === 'asteroid')
        cells.push(esc(i18n.format('landing.unit.km', { n: ref.asteroid.diameterKm })));
      return cells;
    };
  }
  const body = ids
    .map((id) => {
      const ref = id === 'earth' ? undefined : refOf(id);
      const name = id === 'earth' ? (lang === 'fr' ? 'Terre' : 'Earth') : (nameOf(ref, lang) ?? id);
      return `<tr data-id="${esc(id)}"><th scope="row">${esc(name)}</th>${row(id, ref)
        .map((c) => `<td>${c}</td>`)
        .join('')}</tr>`;
    })
    .join('\n');
  return `<section class="lp-list panel"><div class="lp-scroll"><table>
  <thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
  <tbody>${body}</tbody>
</table></div></section>`;
}

function header(i18n: I18n, ctx: RenderContext, otherHref: string, dashboard: boolean): string {
  const lang = i18n.lang;
  const o = other(lang);
  return `<header class="lp-top panel">
  <a class="brand" href="${ctx.base}?lang=${lang}">${BRAND[lang]}</a>
  <nav class="lp-nav" aria-label="${esc(BRAND[lang])}">
    <a href="${ctx.base}${lang}/">${esc(i18n.t('landing.guides'))}</a>
    <a href="${ctx.base}?lang=${lang}">${esc(i18n.t('landing.openApp'))}</a>
  </nav>
  <span class="lp-top-actions">
    ${dashboard ? `<button type="button" class="btn" id="lp-dashboard" title="${esc(i18n.t('landing.dashboardHint'))}">${esc(i18n.t('landing.dashboard'))}</button>` : ''}
    <a class="btn" href="${otherHref}" hreflang="${o}" lang="${o}">${o.toUpperCase()}</a>
  </span>
</header>
<div class="lp-banner" id="lp-lang-banner" lang="${o}" hidden>
  <span>${esc(new I18n(o).t('landing.otherLanguage'))}</span>
  <a href="${otherHref}" hreflang="${o}">${esc(new I18n(o).t('landing.otherLanguageLink'))}</a>
  <button type="button" class="btn" id="lp-lang-close">${esc(new I18n(o).t('landing.close'))}</button>
</div>`;
}

/** The page listing every data source and software credit, one per language (linked from each footer). */
export const CREDITS_PATHS: Readonly<Record<Lang, string>> = {
  en: 'en/sources-and-credits/',
  fr: 'fr/sources-et-credits/',
};

function creditItems(credits: readonly Credit[], lang: Lang): string {
  return credits
    .map(
      (c) =>
        `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>${c.detail ? `${lang === 'fr' ? ' : ' : ': '}${esc(c.detail[lang])}` : ''}</li>`,
    )
    .join(`${NL}      `);
}

function footer(i18n: I18n, ctx: RenderContext): string {
  const lang = i18n.lang;
  return `<footer class="lp-footer">
  <section>
    <h2>${esc(i18n.t('landing.footer.about'))}</h2>
    <p>${esc(i18n.t('landing.footer.aboutText'))}</p>
    <p>${esc(i18n.format('landing.footer.by', { author: AUTHOR }))} · <a href="${REPOSITORY}" target="_blank" rel="noopener">${esc(i18n.t('landing.footer.code'))}</a> · ${esc(i18n.format('landing.footer.version', { version: ctx.version }))}</p>
    <p class="lp-disclaimer">${esc(i18n.t('about.disclaimer'))}</p>
    <p><a href="${ctx.base}${PRIVACY_PAGES[lang]}">${esc(i18n.t('landing.footer.privacy'))}</a> · ${esc(i18n.t('landing.footer.counter'))}</p>
    <p><a href="${ctx.base}${CREDITS_PATHS[lang]}">${esc(i18n.t('landing.footer.sources'))}</a></p>
  </section>
</footer>`;
}

const GOATCOUNTER_TAG =
  '<script data-goatcounter="https://perigeeinfo.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>';

function headTags(
  title: string,
  description: string,
  lang: Lang,
  paths: Record<Lang, string>,
  ctx: RenderContext,
  ld: readonly unknown[],
  image?: { readonly path: string; readonly alt: string },
): string {
  const url = (l: Lang): string => `${ctx.site}${paths[l]}`;
  const imageUrl = `${ctx.site}${image?.path ?? 'og-image.jpg'}`;
  const imageAlt = image
    ? `
    <meta property="og:image:alt" content="${esc(image.alt)}">`
    : '';
  const twitterAlt = image
    ? `
    <meta name="twitter:image:alt" content="${esc(image.alt)}">`
    : '';
  return `<title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow, max-image-preview:large">
    <link rel="canonical" href="${url(lang)}">
    <link rel="alternate" hreflang="en" href="${url('en')}">
    <link rel="alternate" hreflang="fr" href="${url('fr')}">
    <link rel="alternate" hreflang="x-default" href="${url('en')}">
    <meta name="author" content="${esc(AUTHOR)}">
    <meta name="color-scheme" content="dark">
    <meta name="theme-color" content="#02050a">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${BRAND[lang]}">
    <meta property="og:url" content="${url(lang)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${esc(imageUrl)}">
    <meta property="og:image:width" content="${OG_WIDTH}">
    <meta property="og:image:height" content="${OG_HEIGHT}">${imageAlt}
    <meta property="og:locale" content="${lang === 'fr' ? 'fr_CA' : 'en_CA'}">
    <meta property="og:locale:alternate" content="${lang === 'fr' ? 'en_CA' : 'fr_CA'}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${esc(imageUrl)}">${twitterAlt}
    <link rel="icon" href="${ctx.base}icons/favicon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="${ctx.base}icons/apple-touch-icon.png">
    ${ld.map((d) => `<script type="application/ld+json">${jsonLd(d)}</script>`).join('\n    ')}
    ${GOATCOUNTER_TAG}`;
}

function fill(
  template: string,
  lang: Lang,
  attrs: Record<string, string>,
  head: string,
  body: string,
): string {
  const htmlAttrs = Object.entries({ lang, ...attrs })
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
  return template
    .replace(/<html[^>]*>/, `<html ${htmlAttrs}>`)
    .replace('<!--lp:head-->', head)
    .replace('<!--lp:body-->', body);
}

/** One topic's page in one language. */
export function renderTopic(template: string, topic: Topic, lang: Lang, ctx: RenderContext): string {
  const i18n = new I18n(lang);
  const o = other(lang);
  const paths = { en: topicPath(topic, 'en'), fr: topicPath(topic, 'fr') } as Record<Lang, string>;
  const ref = refOf(topic.target);
  const name = nameOf(ref, lang) ?? topic.question[lang];
  const theme = THEMES.find((t) => t.id === topic.theme);
  const title = `${topic.question[lang]} | ${BRAND[lang]}`;
  const pageUrl = `${ctx.site}${paths[lang]}`;
  const capture = topicCapture(topic, lang, ctx);
  const viewTitle = i18n.format('landing.viewTitle', { name });
  const catalogueImage = ref && imageOf(ref);
  const primaryImage = catalogueImage
    ? { '@type': 'ImageObject', url: `${ctx.site}images/${catalogueImage.id}.webp` }
    : capture
      ? { '@type': 'ImageObject', url: `${ctx.site}${capture}`, width: OG_WIDTH, height: OG_HEIGHT }
      : undefined;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: topic.question[lang],
      description: topic.description[lang],
      url: pageUrl,
      inLanguage: lang,
      isPartOf: { '@type': 'WebSite', name: BRAND[lang], url: ctx.site },
      ...(primaryImage ? { primaryImageOfPage: primaryImage } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: BRAND[lang], item: ctx.site },
        { '@type': 'ListItem', position: 2, name: i18n.t('landing.guides'), item: `${ctx.site}${lang}/` },
        { '@type': 'ListItem', position: 3, name: topic.question[lang], item: pageUrl },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: lang,
      mainEntity: topic.faq.map((f) => ({
        '@type': 'Question',
        name: f.q[lang],
        acceptedAnswer: { '@type': 'Answer', text: f.a[lang] },
      })),
    },
  ];
  const viewSrc = `${ctx.base}${viewQuery(topic.view, lang, true)}`;
  const related = topic.related
    .map((id) => TOPICS.find((t) => t.id === id))
    .filter((t): t is Topic => t !== undefined)
    .map((t) => `<li><a href="${ctx.base}${topicPath(t, lang)}">${esc(t.question[lang])}</a></li>`)
    .join('');
  const hasMap = topic.kind === 'satellite';
  const hasPlace = topicHasPlace(topic);
  const body = `${header(i18n, ctx, `${ctx.base}${paths[o]}`, true)}
<main class="lp" id="lp-main">
  <nav class="lp-crumbs" aria-label="breadcrumb"><a href="${ctx.base}?lang=${lang}">${BRAND[lang]}</a> › <a href="${ctx.base}${lang}/">${esc(i18n.t('landing.guides'))}</a> › <span>${esc(theme?.name[lang] ?? '')}</span></nav>
  <h1>${esc(topic.question[lang])}</h1>
  <p class="lp-answer" id="lp-answer" aria-live="polite"><span class="lp-live-dot" aria-hidden="true"></span><span id="lp-answer-text">${esc(topic.lead[lang])}</span></p>
  <noscript><p class="lp-noscript">${esc(i18n.t('landing.noscript'))}</p></noscript>
  <div class="lp-board">
    <section class="lp-view panel">
      ${capture ? `<img class="lp-poster" src="${ctx.base}${esc(capture)}" width="${OG_WIDTH}" height="${OG_HEIGHT}" alt="${esc(viewTitle)}" fetchpriority="high" decoding="async">` : ''}
      <iframe data-src="${esc(viewSrc)}" title="${esc(viewTitle)}" allow="fullscreen"></iframe>
      <noscript><a class="lp-view-noscript" href="${esc(`${ctx.base}${viewQuery(topic.view, lang, false)}`)}">${esc(i18n.t('embed.open'))}</a></noscript>
    </section>
    <section class="lp-cards" id="lp-cards" aria-live="off"></section>
    ${hasMap ? `<section class="lp-map panel" id="lp-map"><h2>${esc(i18n.t('landing.map.title'))}</h2><div id="lp-map-svg" role="img" aria-label="${esc(i18n.format('landing.map.label', { name }))}"></div><p class="lp-note">${esc(i18n.format('landing.map.note', { name }))}</p></section>` : ''}
    ${hasPlace ? `<section class="lp-place panel" id="lp-place"><h2>${esc(i18n.t('landing.place.title'))}</h2><p id="lp-place-why">${esc(topic.kind === 'satellite' ? i18n.format('landing.place.why', { name }) : i18n.t('landing.place.whySky'))}</p><p class="lp-place-actions"><button type="button" class="btn" id="lp-locate">${esc(i18n.t('landing.place.use'))}</button> <button type="button" class="btn" id="lp-forget" hidden>${esc(i18n.t('landing.place.forget'))}</button> <span id="lp-place-status" aria-live="polite"></span></p><div id="lp-place-out"></div><p class="lp-note">${esc(i18n.t('landing.place.note'))}</p></section>` : ''}
    ${listTable(topic, i18n)}
  </div>
  <article class="lp-text">
    <p class="lp-intro">${esc(topic.intro[lang])}</p>
    ${figure(ref, i18n, ctx)}
  </article>
  ${facts(ref, i18n)}
  <section class="lp-faq">
    <h2>${esc(i18n.t('landing.faq'))}</h2>
    ${topic.faq.map((f) => `<details><summary>${esc(f.q[lang])}</summary><p>${esc(f.a[lang])}</p></details>`).join('\n    ')}
  </section>
  <section class="lp-sources panel" id="lp-sources">
    <h2>${esc(i18n.t('landing.sources.title'))}</h2>
    <div id="lp-provenance"></div>
    <p class="lp-note">${esc(i18n.t('landing.sources.refresh'))}</p>
  </section>
  <nav class="lp-related"><h2>${esc(i18n.t('landing.related'))}</h2><ul>${related}</ul></nav>
</main>
${footer(i18n, ctx)}`;
  return fill(
    template,
    lang,
    { 'data-topic': topic.id, 'data-base': ctx.base, 'data-other': `${ctx.base}${paths[o]}` },
    headTags(
      title,
      topic.description[lang],
      lang,
      paths,
      ctx,
      ld,
      capture ? { path: capture, alt: viewTitle } : undefined,
    ),
    body,
  );
}

/** The guides' index in one language: every topic by theme. */
export function renderHub(template: string, lang: Lang, ctx: RenderContext): string {
  const i18n = new I18n(lang);
  const o = other(lang);
  const paths = { en: 'en/', fr: 'fr/' } as Record<Lang, string>;
  const title = `${i18n.t('landing.hubTitle')} | ${BRAND[lang]}`;
  const sections = THEMES.map((theme) => {
    const items = TOPICS.filter((t) => t.theme === theme.id)
      .map(
        (t) =>
          `<li><a href="${ctx.base}${topicPath(t, lang)}"><strong>${esc(t.question[lang])}</strong><span>${esc(t.description[lang])}</span></a></li>`,
      )
      .join('\n      ');
    return `<section class="lp-hub-theme"><h2>${esc(theme.name[lang])}</h2><ul class="lp-hub-list">
      ${items}
    </ul></section>`;
  }).join('\n  ');
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: i18n.t('landing.hubTitle'),
      description: i18n.t('landing.hubDescription'),
      url: `${ctx.site}${paths[lang]}`,
      inLanguage: lang,
      isPartOf: { '@type': 'WebSite', name: BRAND[lang], url: ctx.site },
      hasPart: TOPICS.map((t) => ({
        '@type': 'WebPage',
        name: t.question[lang],
        url: `${ctx.site}${topicPath(t, lang)}`,
      })),
    },
  ];
  const body = `${header(i18n, ctx, `${ctx.base}${paths[o]}`, false)}
<main class="lp lp-hub" id="lp-main">
  <h1>${esc(i18n.t('landing.hubTitle'))}</h1>
  <p class="lp-intro">${esc(i18n.t('landing.hubIntro'))}</p>
  ${sections}
</main>
${footer(i18n, ctx)}`;
  return fill(
    template,
    lang,
    { 'data-hub': '1', 'data-base': ctx.base, 'data-other': `${ctx.base}${paths[o]}` },
    headTags(title, i18n.t('landing.hubDescription'), lang, paths, ctx, ld),
    body,
  );
}

/** Every data source and software credit, the list of the app's About dialog. */
export function renderCredits(template: string, lang: Lang, ctx: RenderContext): string {
  const i18n = new I18n(lang);
  const o = other(lang);
  const title = `${i18n.t('landing.footer.sources')} | ${BRAND[lang]}`;
  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: i18n.t('landing.footer.sources'),
      description: i18n.t('landing.credits.description'),
      url: `${ctx.site}${CREDITS_PATHS[lang]}`,
      inLanguage: lang,
      isPartOf: { '@type': 'WebSite', name: BRAND[lang], url: ctx.site },
    },
  ];
  const body = `${header(i18n, ctx, `${ctx.base}${CREDITS_PATHS[o]}`, false)}
<main class="lp lp-credits-page" id="lp-main">
  <nav class="lp-crumbs" aria-label="breadcrumb"><a href="${ctx.base}?lang=${lang}">${BRAND[lang]}</a> › <a href="${ctx.base}${lang}/">${esc(i18n.t('landing.guides'))}</a></nav>
  <h1>${esc(i18n.t('landing.footer.sources'))}</h1>
  <p class="lp-intro">${esc(i18n.t('landing.credits.intro'))}</p>
  <section class="lp-credits-list">
    <h2>${esc(i18n.t('about.sources'))}</h2>
    <ul class="lp-credits">
      ${creditItems(DATA_CREDITS, lang)}
    </ul>
    <h2>${esc(i18n.t('about.software'))}</h2>
    <ul class="lp-credits">
      ${creditItems(SOFTWARE_CREDITS, lang)}
    </ul>
  </section>
</main>
${footer(i18n, ctx)}`;
  return fill(
    template,
    lang,
    { 'data-base': ctx.base, 'data-other': `${ctx.base}${CREDITS_PATHS[o]}` },
    headTags(title, i18n.t('landing.credits.description'), lang, CREDITS_PATHS, ctx, ld),
    body,
  );
}

/**
 * Every page: `<lang>/<slug>/index.html`, the two hubs `<lang>/index.html` and the credits pages, keyed by output
 * path.
 */
export function renderAll(template: string, ctx: RenderContext): Map<string, string> {
  const out = new Map<string, string>();
  for (const lang of LANGS) {
    out.set(`${lang}/index.html`, renderHub(template, lang, ctx));
    out.set(`${CREDITS_PATHS[lang]}index.html`, renderCredits(template, lang, ctx));
    for (const topic of TOPICS)
      out.set(`${topicPath(topic, lang)}index.html`, renderTopic(template, topic, lang, ctx));
  }
  return out;
}

/** The page for a URL path under the base (dev server), or undefined. */
export function renderPath(template: string, path: string, ctx: RenderContext): string | undefined {
  const clean = path.replace(/index\.html$/, '');
  for (const lang of LANGS) {
    if (clean === `${lang}/`) return renderHub(template, lang, ctx);
    if (clean === CREDITS_PATHS[lang]) return renderCredits(template, lang, ctx);
    const topic = TOPICS.find((t) => topicPath(t, lang) === clean);
    if (topic) return renderTopic(template, topic, lang, ctx);
  }
  return undefined;
}

const NL = '\n';

/** sitemap.xml: the app's views (both languages) and every landing page, each with its alternate. */
export function renderSitemap(ctx: RenderContext, buildDate: string): string {
  const entry = (
    paths: Record<Lang, string>,
    fallback: string,
    priority: string,
    lastmod: string = buildDate,
  ): string =>
    LANGS.map(
      (lang) => `  <url>
    <loc>${esc(`${ctx.site}${paths[lang]}`)}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(`${ctx.site}${paths[l]}`)}"/>`).join(NL)}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(`${ctx.site}${fallback}`)}"/>
    <lastmod>${lastmod}</lastmod>
    <priority>${priority}</priority>
  </url>`,
    ).join(NL);
  const views = ['', '&view=moon', '&view=mars', '&view=solar'].map((v) =>
    entry({ en: `?lang=en${v}`, fr: `?lang=fr${v}` }, v ? `?${v.slice(1)}` : '', v ? '0.8' : '1.0'),
  );
  // A page changes when its texts do or when its catalogue entries are re-verified, not at every commit.
  const landingDate = ctx.landingDate ?? buildDate;
  const topicDate = (t: Topic): string =>
    [landingDate, topicCatalogueDate(t) ?? ''].sort().at(-1) ?? landingDate;
  const hubs = entry({ en: 'en/', fr: 'fr/' }, 'en/', '0.9', landingDate);
  const topics = TOPICS.map((t) =>
    entry({ en: topicPath(t, 'en'), fr: topicPath(t, 'fr') }, topicPath(t, 'en'), '0.8', topicDate(t)),
  );
  const privacy = entry({ en: PRIVACY_PAGES.en, fr: PRIVACY_PAGES.fr }, PRIVACY_PAGES.en, '0.3');
  const credits = entry(CREDITS_PATHS, CREDITS_PATHS.en, '0.3', landingDate);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Written at build time (src/landing/render.ts): one URL per app view and language (the other URL parameters
     are not indexed), the guides and their pages, the privacy and credits pages. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...views, hubs, ...topics, privacy, credits].join(NL)}
</urlset>
`;
}
