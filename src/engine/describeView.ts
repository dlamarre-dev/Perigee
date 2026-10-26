/**
 * "Explain this view" (machine interface): a Perigee link or embed URL turned into words, for alternative text,
 * lesson notes or a student worksheet: which view, which object and what it is, where it is, the date and the speed
 * of time, the frame, the filters, what is hidden, and how reliable the selected object's position is (an
 * extrapolated object is drawn dimmed in the app). The camera's orientation and zoom are not in the URL: the exact
 * framing is unknown.
 */
import { parseUrlState, type ViewId } from '../app/urlState';
import { engineIdOf } from '../app/embedApi';
import { filtersFromParams } from '../earth/filters';
import type { Engine } from './index';
import { catalogs } from './objects';
import { defaultHiddenMissions, parseHiddenMissions } from '../app/hiddenMissions';
import type { Provenance } from './provenance';

type Lang = 'en' | 'fr';
type Localized = { readonly en: string; readonly fr: string };

const VIEWS: Record<ViewId, { name: Localized; shows: Localized }> = {
  earth: {
    name: { en: 'Earth view', fr: 'vue de la Terre' },
    shows: {
      en: 'the Earth with every active catalogued satellite (each a dot moving along its orbit), the launch sites and the Moon',
      fr: 'la Terre avec tous les satellites actifs catalogués (chacun un point qui suit son orbite), les sites de lancement et la Lune',
    },
  },
  moon: {
    name: { en: 'Moon view', fr: 'vue de la Lune' },
    shows: {
      en: 'the Moon with the spacecraft orbiting it and the landing and impact sites on its surface, the Earth in the distance',
      fr: 'la Lune avec les sondes en orbite autour d’elle et les sites d’alunissage et d’impact à sa surface, la Terre au loin',
    },
  },
  mars: {
    name: { en: 'Mars view', fr: 'vue de Mars' },
    shows: {
      en: 'Mars with its orbiters, its moons Phobos and Deimos, and the landing sites and rover positions on its surface',
      fr: 'Mars avec ses orbiteurs, ses lunes Phobos et Deimos, et les sites d’atterrissage et positions des rovers à sa surface',
    },
  },
  solar: {
    name: { en: 'solar system view', fr: 'vue du Système solaire' },
    shows: {
      en: 'the Sun, the planets and dwarf planets with their orbits and moons, and the interplanetary probes with their trajectories',
      fr: 'le Soleil, les planètes et planètes naines avec leurs orbites et leurs lunes, et les sondes interplanétaires avec leurs trajectoires',
    },
  },
};

const BODY_FRAME: Record<ViewId, Localized> = {
  earth: { en: 'the Earth', fr: 'la Terre' },
  moon: { en: 'the Moon', fr: 'la Lune' },
  mars: { en: 'Mars', fr: 'Mars' },
  solar: { en: 'the planets', fr: 'les planètes' },
};

const STATUS: Record<string, Localized> = {
  active: { en: 'active', fr: 'en activité' },
  inactive: { en: 'inactive', fr: 'inactif' },
  ended: { en: 'mission ended', fr: 'mission terminée' },
  cruise: { en: 'in cruise', fr: 'en croisière' },
  planned: { en: 'planned', fr: 'prévue' },
  unknown: { en: 'status unknown', fr: 'statut inconnu' },
};

const SITE_TYPES: Record<string, Localized> = {
  soft: { en: 'soft landing site', fr: 'site d’atterrissage en douceur' },
  hard: { en: 'crash site', fr: 'site d’écrasement' },
  impact: { en: 'impact site', fr: 'site d’impact' },
  crewed: { en: 'crewed landing site', fr: 'site d’atterrissage habité' },
  'rover-last-known': { en: 'last known rover position', fr: 'dernière position connue du rover' },
};

const AU_KM = 149_597_870.7;

/** Models whose positions need no data of the day: described by the model rather than the data state. */
const MODEL_TEXT: Partial<Record<Provenance['model'], Localized>> = {
  vsop87: {
    en: 'computed from a planetary theory (VSOP87, astronomy-engine), valid for any date',
    fr: 'calculée par une théorie planétaire (VSOP87, astronomy-engine), valable à toute date',
  },
  'astronomy-engine-moon': {
    en: 'computed from an analytical lunar or satellite theory (astronomy-engine)',
    fr: 'calculée par une théorie analytique de la Lune ou des satellites (astronomy-engine)',
  },
  'moon-mean-elements': {
    en: 'modelled from mean orbital elements (JPL)',
    fr: 'modélisée à partir d’éléments orbitaux moyens (JPL)',
  },
};

/** "one hour per second" for a time rate of 3600. */
export function rateText(rate: number, lang: Lang): string {
  if (rate === 0) return lang === 'fr' ? 'temps arrêté' : 'time paused';
  if (rate === 1) return lang === 'fr' ? 'temps réel' : 'real time';
  const abs = Math.abs(rate);
  const units: [number, Localized][] = [
    [86_400, { en: 'day', fr: 'jour' }],
    [3600, { en: 'hour', fr: 'heure' }],
    [60, { en: 'minute', fr: 'minute' }],
    [1, { en: 'second', fr: 'seconde' }],
  ];
  const [size, unit] = units.find(([s]) => abs >= s) ?? units[3] ?? [1, { en: 'second', fr: 'seconde' }];
  const n = Math.round((abs / size) * 10) / 10;
  const plural = n >= 2;
  const amount = `${n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB')} ${unit[lang]}${plural ? 's' : ''}`;
  const per =
    lang === 'fr'
      ? `${amount} par seconde (×${abs.toLocaleString('fr-FR')})`
      : `${amount} per second (×${abs.toLocaleString('en-GB')})`;
  return rate < 0 ? (lang === 'fr' ? `${per}, à rebours` : `${per}, backwards`) : per;
}

function dateText(date: Date, lang: Lang, zone: string | undefined): string {
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone ?? 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

const join = (items: readonly string[], lang: Lang): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${lang === 'fr' ? 'et' : 'and'} ${items[items.length - 1]}`;

/** Text of the Earth view's filters ("operator SpaceX; LEO orbits; search “starlink”"). */
function filtersText(p: URLSearchParams, lang: Lang): string[] {
  const f = filtersFromParams(p);
  const ops = catalogs.operators;
  const out: string[] = [];
  const fr = lang === 'fr';
  if (f.science.length) out.push(fr ? 'satellites scientifiques choisis' : 'selected science satellites');
  if (f.operators.length)
    out.push(
      `${fr ? 'opérateur' : 'operator'} ${join(
        f.operators.map((o) => ops.operators[o]?.name ?? o),
        lang,
      )}`,
    );
  if (f.owners.length)
    out.push(
      `${fr ? 'propriétaire' : 'owner'} ${join(
        f.owners.map((o) => ops.owners[o]?.[lang] ?? o),
        lang,
      )}`,
    );
  if (f.groups.length)
    out.push(
      `${fr ? 'groupe' : 'group'} ${join(
        f.groups.map((g) => ops.groups[g]?.[lang] ?? g),
        lang,
      )}`,
    );
  if (f.regimes.length) out.push(`${fr ? 'orbites' : 'orbits'} ${join(f.regimes, lang)}`);
  if (f.types.length) out.push(`${fr ? 'type' : 'type'} ${join(f.types, lang)}`);
  if (f.launchSites.length)
    out.push(`${fr ? 'lancés depuis' : 'launched from'} ${join(f.launchSites, lang)}`);
  if (f.query.trim()) out.push(fr ? `recherche « ${f.query.trim()} »` : `search “${f.query.trim()}”`);
  return out;
}

const STATE_TEXT: Record<Provenance['state'], Localized> = {
  fresh: { en: 'computed from recent orbital elements', fr: 'calculée à partir d’éléments orbitaux récents' },
  interpolated: {
    en: 'interpolated from published ephemerides',
    fr: 'interpolée entre des éphémérides publiées',
  },
  stale: {
    en: 'computed from orbital elements more than two weeks old (less accurate)',
    fr: 'calculée à partir d’éléments orbitaux de plus de deux semaines (moins précise)',
  },
  extrapolated: {
    en: 'extrapolated beyond the published ephemeris (approximate; drawn dimmed with a dashed path)',
    fr: 'extrapolée au-delà de l’éphéméride publiée (approximative ; dessinée atténuée, trajectoire en tirets)',
  },
  hidden: {
    en: 'unknown at this date (too far beyond its ephemeris: only its last known path is drawn, in grey)',
    fr: 'inconnue à cette date (trop loin au-delà de son éphéméride : seule sa dernière trajectoire connue est tracée, en gris)',
  },
  modelled: {
    en: 'modelled from mean orbital elements',
    fr: 'modélisée à partir d’éléments orbitaux moyens',
  },
  none: { en: 'not available (no public ephemeris)', fr: 'indisponible (pas d’éphéméride publique)' },
};

export async function describeView(
  engine: Engine,
  link: string,
  lang: Lang,
  zone?: string,
): Promise<Record<string, unknown>> {
  const query = link.includes('?') ? link.slice(link.indexOf('?')) : link.startsWith('?') ? link : `?${link}`;
  const p = new URLSearchParams(query.split('#')[0]);
  const url = parseUrlState(query);
  const fr = lang === 'fr';
  const view = VIEWS[url.view];
  const live = url.time === undefined;
  const date = url.time ?? new Date();
  const sentences: string[] = [];
  const facts: Record<string, unknown> = {
    view: url.view,
    live,
    date: date.toISOString(),
    rate: url.rate,
    frame: url.frame,
  };

  // Selection.
  const sel = p.get('sel');
  let subject: string | undefined;
  let selection: Record<string, unknown> | undefined;
  if (sel) {
    const id = engineIdOf(url.view, sel);
    try {
      const d = await engine.describe(id, lang);
      subject = typeof d['name'] === 'string' ? d['name'] : id;
      const s = await engine.state(id, date).catch(() => undefined);
      const prov = s?.provenance[0];
      selection = {
        id,
        name: subject,
        kind: d['kind'],
        ...(s?.distanceKm !== undefined ? { distanceKm: Math.round(s.distanceKm), centre: s.centre } : {}),
        ...(s?.altitudeKm !== undefined ? { altitudeKm: Math.round(s.altitudeKm) } : {}),
        ...(s?.groundPoint ? { groundPoint: s.groundPoint } : {}),
        ...(prov ? { positionState: prov.state, model: prov.model } : {}),
      };
      const statusCode = typeof d['status'] === 'string' ? d['status'] : undefined;
      const status = statusCode ? (STATUS[statusCode]?.[lang] ?? statusCode) : undefined;
      const where: string[] = [];
      const number = (n: number, digits = 0): string =>
        n.toLocaleString(fr ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits });
      if (d['kind'] === 'site' && typeof d['type'] === 'string') {
        const type = SITE_TYPES[d['type']]?.[lang] ?? d['type'];
        where.push(typeof d['date'] === 'string' ? `${type}, ${d['date']}` : type);
      } else if (d['kind'] === 'star' && typeof d['distanceLy'] === 'number') {
        // A star: in light-years, not hundreds of thousands of astronomical units.
        where.push(
          fr
            ? `à ${number(d['distanceLy'], 2)} années-lumière du Soleil`
            : `${number(d['distanceLy'], 2)} light-years from the Sun`,
        );
      } else if (s?.centre === 'sun' && s.distanceKm !== undefined) {
        const au = s.distanceKm / AU_KM;
        where.push(
          fr
            ? `à ${number(au, au < 10 ? 2 : 1)} ua du Soleil (${number(s.distanceKm / 1e6)} millions de km)`
            : `${number(au, au < 10 ? 2 : 1)} au from the Sun (${number(s.distanceKm / 1e6)} million km)`,
        );
      } else if (s?.altitudeKm !== undefined && s.altitudeKm > 0 && d['kind'] !== 'launch') {
        where.push(fr ? `à ${number(s.altitudeKm)} km d’altitude` : `${number(s.altitudeKm)} km up`);
      }
      const over = s?.groundPoint?.over;
      if (over) where.push(fr ? `au-dessus de : ${over.name.fr}` : `over ${over.name.en}`);
      sentences.push(
        fr
          ? `Objet sélectionné : ${subject}${status ? ` (${status})` : ''}${where.length ? `, ${join(where, lang)}` : ''}.`
          : `The selected object is ${subject}${status ? ` (${status})` : ''}${where.length ? `, ${join(where, lang)}` : ''}.`,
      );
      if (prov && d['kind'] !== 'site' && d['kind'] !== 'launch' && d['kind'] !== 'star')
        sentences.push(
          fr
            ? `Sa position est ${(MODEL_TEXT[prov.model] ?? STATE_TEXT[prov.state]).fr}.`
            : `Its position is ${(MODEL_TEXT[prov.model] ?? STATE_TEXT[prov.state]).en}.`,
        );
    } catch {
      sentences.push(fr ? `L’objet « ${sel} » n’est pas reconnu.` : `The object “${sel}” is not recognised.`);
      selection = { id: sel, unknown: true };
    }
  }
  const follow = p.get('follow') === '1' && sel !== null;

  // The opening sentence (also the alternative text).
  const when = live
    ? fr
      ? `en temps réel (${dateText(date, lang, zone)})`
      : `in real time (${dateText(date, lang, zone)})`
    : fr
      ? `au ${dateText(date, lang, zone)}`
      : `on ${dateText(date, lang, zone)}`;
  // map=1 with a selected star: its 3D map with the Sun (src/ui/StarMap.ts), pick=star:<id> compared with it.
  const starOf = (sel: string | null): (typeof catalogs.stars)[number] | undefined =>
    sel?.startsWith('star:') ? catalogs.stars.find((s) => `star:${s.id}` === sel) : undefined;
  const mapStar = url.view === 'solar' && p.get('map') === '1' ? starOf(p.get('sel')) : undefined;
  const mapPick = mapStar ? starOf(p.get('pick')) : undefined;
  const ly = (s: { readonly distanceLy: number }): string =>
    `${s.distanceLy.toLocaleString(fr ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 2 })} ${fr ? 'années-lumière' : 'light-years'}`;
  const alt = mapStar
    ? fr
      ? `Carte 3D de Périgée : ${mapStar.name.fr} et le Soleil, à ${ly(mapStar)} l’un de l’autre${mapPick ? `, comparée à ${mapPick.name.fr} (${ly(mapPick)})` : ''}, parmi les étoiles nommées autour du Soleil.`
      : `Perigee 3D map: ${mapStar.name.en} and the Sun, ${ly(mapStar)} apart${mapPick ? `, compared with ${mapPick.name.en} (${ly(mapPick)})` : ''}, among the named stars around the Sun.`
    : fr
      ? `Vue 3D de Périgée : ${view.name.fr} ${when}${subject ? `, ${follow ? 'objet suivi' : 'centrée sur l’objet'} : ${subject}` : ''}.`
      : `Perigee 3D ${view.name.en} ${when}${subject ? `, ${follow ? 'following' : 'centred on'} ${subject}` : ''}.`;

  const intro = fr
    ? `La ${view.name.fr} montre ${view.shows.fr}.`
    : `The ${view.name.en} shows ${view.shows.en}.`;
  const time = live
    ? fr
      ? `Le temps avance en temps réel.`
      : `Time runs in real time.`
    : fr
      ? `La date affichée est le ${dateText(date, lang, zone)} ; ${rateText(url.rate, lang)}.`
      : `The date shown is ${dateText(date, lang, zone)}; ${rateText(url.rate, lang)}.`;
  const frame =
    url.frame === 'inertial'
      ? fr
        ? `Repère inertiel : les étoiles restent fixes et ${BODY_FRAME[url.view].fr} tourne${url.view === 'solar' ? 'nt' : ''} sur ${url.view === 'solar' ? 'elles-mêmes' : 'elle-même'}.`
        : `Inertial frame: the stars stay fixed and ${BODY_FRAME[url.view].en} turn${url.view === 'solar' ? '' : 's'}.`
      : url.view === 'solar'
        ? ''
        : fr
          ? `Repère lié à ${BODY_FRAME[url.view].fr} : elle paraît immobile et le ciel tourne autour d’elle.`
          : `Frame fixed to ${BODY_FRAME[url.view].en}: it looks still while the sky turns around it.`;

  const extra: string[] = [];
  if (url.view === 'earth') {
    const filters = filtersText(p, lang);
    if (filters.length) {
      extra.push(
        fr
          ? `Seuls les satellites répondant à ces filtres sont affichés : ${filters.join(' ; ')}.`
          : `Only the satellites matching these filters are shown: ${filters.join('; ')}.`,
      );
      facts['filters'] = filters;
    }
    if (p.get('ls') === '0')
      extra.push(fr ? 'Les sites de lancement sont masqués.' : 'Launch sites are hidden.');
  }
  if ((url.view === 'moon' || url.view === 'mars') && p.get('sites') === '0')
    extra.push(fr ? 'Les sites au sol sont masqués.' : 'Surface sites are hidden.');
  if (url.view === 'solar') {
    if (p.get('log') === '1') {
      extra.push(
        fr
          ? 'Les distances sont en échelle logarithmique : elles ne sont pas à l’échelle.'
          : 'Distances are on a logarithmic scale: they are not to scale.',
      );
      facts['logScale'] = true;
    }
    if (p.get('sites') === '1')
      extra.push(
        fr
          ? 'Les sites d’atterrissage et d’impact de l’astre sélectionné (Mercure, Vénus, Titan) sont marqués à sa surface.'
          : 'The landing and impact sites of the selected body (Mercury, Venus, Titan) are marked on its surface.',
      );
    if (p.get('stars') === '1')
      extra.push(
        fr ? 'Les étoiles brillantes sont nommées sur le ciel.' : 'The bright stars are named on the sky.',
      );
    if (p.get('comets') === '1')
      extra.push(
        fr
          ? 'Les comètes du catalogue sont dessinées avec leur orbite et des queues illustratives.'
          : 'The catalogue comets are drawn with their orbits and illustrative tails.',
      );
    if (p.get('nearby') === '1')
      extra.push(
        fr
          ? 'Les étoiles à moins de 20 années-lumière du Soleil sont nommées sur le ciel.'
          : 'The stars within 20 light-years of the Sun are named on the sky.',
      );
    if (mapStar) {
      extra.push(
        fr
          ? `Par-dessus la vue, une carte 3D place chaque étoile nommée à sa distance réelle du Soleil (les points ne sont pas à l’échelle) : ${mapStar.name.fr} et le Soleil sont reliés par un trait pointillé de ${ly(mapStar)}${mapPick ? `, et ${mapPick.name.fr} par un second trait de ${ly(mapPick)} pour comparer` : ''}. Des cercles dans le plan de la Voie lactée et une tige de chaque étoile jusqu’à ce plan montrent la profondeur.`
          : `Over the view, a 3D map places every named star at its real distance from the Sun (the dots are not to scale): ${mapStar.name.en} and the Sun are joined by a dashed line of ${ly(mapStar)}${mapPick ? `, and ${mapPick.name.en} by a second one of ${ly(mapPick)} for comparison` : ''}. Rings in the plane of the Milky Way and a stalk from each star down to that plane show depth.`,
      );
      facts['starMap'] = { star: `star:${mapStar.id}`, ...(mapPick ? { pick: `star:${mapPick.id}` } : {}) };
    }
  }
  if (url.view !== 'earth') {
    // Inactive spacecraft are hidden by default: `hide` lists active ones hidden, `show` inactive ones drawn.
    const centre = url.view === 'solar' ? 'sun' : url.view;
    const viewMissions = catalogs.missions.filter((m) => m.centralBody === centre);
    const hidden = [...parseHiddenMissions(p, viewMissions)];
    const name = (id: string): string => catalogs.missions.find((m) => m.id === id)?.name[lang] ?? id;
    const explicit = hidden.filter((id) => !defaultHiddenMissions(viewMissions).has(id));
    const shown = (p.get('show') ?? '').split(',').filter((id) => id && !hidden.includes(id));
    if (explicit.length)
      extra.push(
        fr
          ? `Missions masquées : ${join(explicit.map(name), lang)}.`
          : `Missions not drawn: ${join(explicit.map(name), lang)}.`,
      );
    if (shown.length)
      extra.push(
        fr
          ? `Missions inactives affichées : ${join(shown.map(name), lang)} (les autres sont masquées).`
          : `Inactive missions drawn: ${join(shown.map(name), lang)} (the others are hidden).`,
      );
    if (hidden.length) facts['hidden'] = hidden;
  }
  if (p.get('embed') === '1') {
    const ui = (p.get('ui') ?? '').split(',');
    const kept = [
      ...(ui.includes('panel') ? [fr ? 'le panneau d’information' : 'the information panel'] : []),
      ...(ui.includes('time') ? [fr ? 'la barre de temps' : 'the time bar'] : []),
    ];
    extra.push(
      fr
        ? `Vue intégrée${kept.length ? `, avec ${join(kept, lang)}` : ', sans barres ni panneaux'}, et un lien vers l’application complète.`
        : `Embedded view${kept.length ? ` with ${join(kept, lang)}` : ' without bars or panels'}, with a link to the full app.`,
    );
    facts['embed'] = { ui: ui.filter(Boolean) };
  }
  if (follow)
    extra.push(
      fr
        ? 'La caméra suit l’objet sélectionné dans son mouvement.'
        : `The camera follows ${subject} as it moves.`,
    );

  const description = [intro, ...sentences, time, frame, ...extra].filter(Boolean).join(' ');
  const appUrl = new URL(engine.data.baseUrl);
  for (const [k, v] of p) if (k !== 'embed' && k !== 'ui') appUrl.searchParams.set(k, v);
  return {
    altText: alt,
    description,
    ...(selection ? { selection } : {}),
    parameters: facts,
    url: appUrl.href,
    caveat: fr
      ? 'L’orientation et le zoom de la caméra ne sont pas dans le lien : le cadrage exact n’est pas connu (la vue s’ouvre centrée sur l’objet sélectionné, sinon sur le corps central).'
      : 'The camera’s orientation and zoom are not in the link: the exact framing is unknown (the view opens centred on the selected object, else on the central body).',
  };
}
