/**
 * Landing pages (CLAUDE.md §7): one common search per page ("where is the ISS", "how far is Voyager 1"…), in English
 * and French at their own address (`/en/<slug>/`, `/fr/<slug>/`). Each topic names the widgets it shows (`kind`),
 * the objects (engine ids: src/engine/objects.ts `resolve`) and the 3D view embedded on the page; the objects'
 * facts, images and positions come from the catalogues and the published data, never from this file. Written for
 * students: the intro explains, the live widgets give the numbers.
 */
import type { ViewId } from '../app/urlState';

export interface Localized {
  readonly en: string;
  readonly fr: string;
}

const L = (en: string, fr: string): Localized => ({ en, fr });

/** What a page shows live (src/landing/widgets.ts). */
export type TopicKind =
  /** An Earth satellite: where it is now, its ground track, its passes over the visitor. */
  | 'satellite'
  /** Counts of active satellites (all, a CelesTrak group or an orbit regime). */
  | 'constellation'
  /** A probe or a telescope beyond Earth orbit: distances, speed, light time. */
  | 'spacecraft'
  /** A planet or dwarf planet: distances from the Earth and the Sun. */
  | 'planet'
  /** The Moon: phase, illumination, distance, next phases. */
  | 'moon'
  /** The active spacecraft around the Moon or Mars. */
  | 'around'
  /** Several landing sites. */
  | 'sites'
  /** One landing site or a rover's last known place. */
  | 'site'
  /** A table of bodies (planets, dwarf planets, comets, asteroids). */
  | 'bodies'
  /** The Sun and today's sunspot groups. */
  | 'sun'
  /** The sky tonight from the visitor's place. */
  | 'sky'
  /** Upcoming astronomical events. */
  | 'events';

export type ThemeId = 'earth' | 'deep' | 'moon' | 'mars' | 'solar' | 'sky';

export const THEMES: readonly { readonly id: ThemeId; readonly name: Localized }[] = [
  { id: 'earth', name: L('Around the Earth', 'Autour de la Terre') },
  { id: 'deep', name: L('Telescopes and space probes', 'Télescopes et sondes spatiales') },
  { id: 'moon', name: L('The Moon', 'La Lune') },
  { id: 'mars', name: L('Mars', 'Mars') },
  { id: 'solar', name: L('The solar system', 'Le système solaire') },
  { id: 'sky', name: L('The sky tonight', 'Le ciel ce soir') },
];

/** The 3D view embedded on the page (an app link in embed mode). */
export interface TopicView {
  readonly view: ViewId;
  readonly sel?: string;
  readonly follow?: boolean;
  /** Other URL parameters of the view (filters, boxes). */
  readonly params?: Readonly<Record<string, string>>;
  /**
   * Moon, Mars or solar view: hide the spacecraft but the selected one (URL `hide=`, from the catalogue at build).
   */
  readonly hideMissions?: boolean;
}

export interface Topic {
  readonly id: string;
  readonly theme: ThemeId;
  readonly kind: TopicKind;
  /** Address of the page in each language (lowercase ASCII, hyphens). */
  readonly slug: Localized;
  /** The search, as a question: the page title and heading. */
  readonly question: Localized;
  /**
   * The answer line before the page script computes the live one: a fact with no number that drifts (no position is
   * computed at build, CLAUDE.md §2.1), so crawlers and visitors without JavaScript still read an answer.
   */
  readonly lead: Localized;
  /** Meta description (≤ 160 characters). */
  readonly description: Localized;
  /** What the page explains, for students (80–150 words). */
  readonly intro: Localized;
  readonly faq: readonly { readonly q: Localized; readonly a: Localized }[];
  /** The object shown (engine id). */
  readonly target?: string;
  /** The objects listed (`sites`), or the set of bodies (`bodies`). */
  readonly targets?: readonly string[];
  readonly bodySet?: 'planets' | 'dwarfs' | 'comets' | 'asteroids';
  /** The body whose orbiters are listed (`around`). */
  readonly around?: 'moon' | 'mars';
  /** What the statistics count (`constellation`): a CelesTrak group or an orbit regime; all satellites otherwise. */
  readonly stats?: { readonly group?: string; readonly regime?: 'LEO' | 'MEO' | 'GEO' | 'HEO' };
  /** Which part of a page leads (passes first, planets only, eclipses only…). */
  readonly focus?: 'passes' | 'distance' | 'planets' | 'eclipses' | 'fullMoon';
  readonly view: TopicView;
  readonly related: readonly string[];
}

/** Earth satellites the passes and visibility are computed for (the topics that show the Earth). */
export const topicHasPlace = (t: Topic): boolean => t.kind === 'satellite' || t.kind === 'sky';

export const TOPICS: readonly Topic[] = [
  // ------------------------------------------------------------------ around the Earth
  {
    id: 'iss',
    theme: 'earth',
    kind: 'satellite',
    target: '25544',
    slug: L('where-is-the-iss', 'ou-est-la-station-spatiale'),
    question: L(
      'Where is the International Space Station now?',
      'Où est la Station spatiale internationale ?',
    ),
    lead: L(
      'The International Space Station circles the Earth about every 90 minutes, some 400 km up; its live position is computed below.',
      'La Station spatiale internationale fait le tour de la Terre en 90 minutes environ, à quelque 400 km d’altitude ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live position of the ISS above the Earth, its ground track, altitude and speed, and when you can see it pass over you.',
      'Position en direct de l’ISS au-dessus de la Terre, sa trace au sol, son altitude, sa vitesse et ses passages au-dessus de chez vous.',
    ),
    intro: L(
      'The International Space Station circles the Earth about every 92 minutes, some 400 km up, at nearly 28,000 km/h: sixteen orbits a day. Its orbit is tilted 51.6° to the equator, so it flies over every place between about 52° north and 52° south. The map below shows where it is right now and the path its next orbit will trace over the ground. Because the Earth turns beneath it, each orbit passes farther west. Seen from the ground, the station is often the brightest moving point in the sky, but only when it is lit by the Sun while your sky is dark, shortly after sunset or before sunrise.',
      'La Station spatiale internationale fait le tour de la Terre en 92 minutes environ, à quelque 400 km d’altitude et à près de 28 000 km/h : seize orbites par jour. Son orbite est inclinée de 51,6° sur l’équateur ; elle survole donc tous les lieux situés entre environ 52° nord et 52° sud. La carte montre où elle se trouve en ce moment et le chemin que tracera au sol sa prochaine orbite. Comme la Terre tourne sous elle, chaque orbite passe plus à l’ouest. Vue du sol, la station est souvent le point mobile le plus brillant du ciel, mais seulement quand elle est éclairée par le Soleil alors que votre ciel est sombre : peu après le coucher ou avant le lever du Soleil.',
    ),
    faq: [
      {
        q: L('How fast does the ISS go?', 'À quelle vitesse va l’ISS ?'),
        a: L(
          'About 7.7 km per second, or nearly 28,000 km/h: fast enough to go around the Earth in about an hour and a half.',
          'Environ 7,7 km par seconde, soit près de 28 000 km/h : assez vite pour faire le tour de la Terre en une heure et demie environ.',
        ),
      },
      {
        q: L('Can I see the ISS with my own eyes?', 'Puis-je voir l’ISS à l’œil nu ?'),
        a: L(
          'Yes, on many evenings and mornings. Use “My location” on this page: Perigee lists its next passes over you and marks those that are visible, when the station is sunlit while your sky is dark.',
          'Oui, bien des soirs et des matins. Utilisez « Ma position » sur cette page : Périgée liste ses prochains passages au-dessus de vous et indique ceux qui sont visibles, quand la station est éclairée alors que votre ciel est sombre.',
        ),
      },
      {
        q: L('How many people live on the ISS?', 'Combien de personnes vivent dans l’ISS ?'),
        a: L(
          'Usually seven, sometimes more during crew changes. It has been occupied without a break since November 2000.',
          'Habituellement sept, parfois plus lors des relèves d’équipage. Elle est occupée sans interruption depuis novembre 2000.',
        ),
      },
    ],
    view: { view: 'earth', sel: '25544', follow: true },
    related: ['iss-passes', 'tiangong', 'hubble', 'satellites'],
  },
  {
    id: 'iss-passes',
    theme: 'earth',
    kind: 'satellite',
    target: '25544',
    focus: 'passes',
    slug: L('iss-passes-tonight', 'passages-iss-ce-soir'),
    question: L('When can I see the ISS pass tonight?', 'Quand voir passer l’ISS ce soir ?'),
    lead: L(
      'The ISS can be seen with the naked eye when it is sunlit while your sky is dark, shortly after sunset or before sunrise; share your location to list its passes over you.',
      'L’ISS se voit à l’œil nu quand elle est éclairée par le Soleil alors que votre ciel est sombre, peu après le coucher ou avant le lever du Soleil ; indiquez votre position pour connaître ses passages au-dessus de vous.',
    ),
    description: L(
      'Next passes of the International Space Station over your location, with times, directions and which ones you can see with the naked eye.',
      'Prochains passages de la Station spatiale internationale au-dessus de chez vous : heures, directions et passages visibles à l’œil nu.',
    ),
    intro: L(
      'The International Space Station shines like a bright star gliding silently across the sky, with no blinking lights. To see it, three conditions must meet: the station must rise above your horizon, it must be lit by the Sun, and your own sky must be dark. That happens around dusk and dawn, a few days in a row, then not for a while. Give Perigee your location: it computes the next passes from the latest tracking data, gives the time it rises, its highest point and where it sets, and marks the passes you can watch with the naked eye. Your location stays on your device.',
      'La Station spatiale internationale brille comme une étoile qui glisse en silence dans le ciel, sans clignoter. Pour la voir, il faut trois conditions : qu’elle passe au-dessus de votre horizon, qu’elle soit éclairée par le Soleil, et que votre ciel soit sombre. Cela arrive au crépuscule et à l’aube, quelques jours de suite, puis plus pendant un moment. Donnez votre position à Périgée : il calcule les prochains passages d’après les dernières données de suivi, donne l’heure du lever, du point le plus haut et du coucher, et indique les passages observables à l’œil nu. Votre position reste sur votre appareil.',
    ),
    faq: [
      {
        q: L('Why can’t I see every pass?', 'Pourquoi ne puis-je pas voir tous les passages ?'),
        a: L(
          'In daylight the sky is too bright, and in the middle of the night the station is usually in the Earth’s shadow. Only passes near dusk or dawn combine a dark sky and a sunlit station.',
          'En plein jour, le ciel est trop clair ; au milieu de la nuit, la station est le plus souvent dans l’ombre de la Terre. Seuls les passages proches du crépuscule ou de l’aube combinent un ciel sombre et une station éclairée.',
        ),
      },
      {
        q: L('How long does a pass last?', 'Combien de temps dure un passage ?'),
        a: L(
          'About ten minutes from horizon to horizon at most; the station is usually visible for a few minutes of it, until it enters the Earth’s shadow or sinks too low.',
          'Une dizaine de minutes au plus d’un horizon à l’autre ; la station est d’habitude visible pendant quelques minutes, jusqu’à ce qu’elle entre dans l’ombre de la Terre ou passe trop bas.',
        ),
      },
    ],
    view: { view: 'earth', sel: '25544', follow: true },
    related: ['iss', 'sky-tonight', 'tiangong'],
  },
  {
    id: 'tiangong',
    theme: 'earth',
    kind: 'satellite',
    target: '48274',
    slug: L('where-is-tiangong', 'ou-est-tiangong'),
    question: L('Where is the Tiangong space station now?', 'Où est la station spatiale Tiangong ?'),
    lead: L(
      'China’s Tiangong space station orbits the Earth about every 90 minutes, near 400 km up; its live position is computed below.',
      'La station spatiale chinoise Tiangong fait le tour de la Terre en 90 minutes environ, vers 400 km d’altitude ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live position of China’s Tiangong space station, its ground track, altitude and speed, and its passes over your location.',
      'Position en direct de la station spatiale chinoise Tiangong, sa trace au sol, son altitude, sa vitesse et ses passages au-dessus de chez vous.',
    ),
    intro: L(
      'Tiangong, the “Heavenly Palace”, is China’s space station. Its core module Tianhe was launched in 2021, joined by the Wentian and Mengtian laboratories in 2022, and crews of three astronauts take turns aboard for about six months. It flies a little lower than the International Space Station, around 380 to 400 km, on an orbit tilted 41.5° to the equator, so it never passes over places north of about 42° latitude. Like the ISS, it can be seen with the naked eye as a bright moving point when it is lit by the Sun in a dark sky.',
      'Tiangong, le « Palais céleste », est la station spatiale chinoise. Son module central Tianhe a été lancé en 2021 et rejoint en 2022 par les laboratoires Wentian et Mengtian ; des équipages de trois astronautes s’y relaient pour environ six mois. Elle vole un peu plus bas que la Station spatiale internationale, vers 380 à 400 km, sur une orbite inclinée de 41,5° sur l’équateur : elle ne passe donc jamais au-dessus des lieux situés au nord d’environ 42° de latitude. Comme l’ISS, on peut la voir à l’œil nu comme un point brillant en mouvement quand elle est éclairée par le Soleil dans un ciel sombre.',
    ),
    faq: [
      {
        q: L(
          'Can I see Tiangong from Canada or northern Europe?',
          'Peut-on voir Tiangong du Canada ou du nord de l’Europe ?',
        ),
        a: L(
          'Sometimes, low on the southern horizon from the southernmost parts. Its orbit reaches about 42° latitude, so the farther north you are, the lower and rarer its passes.',
          'Parfois, bas sur l’horizon sud, depuis les régions les plus au sud. Son orbite atteint environ 42° de latitude : plus on est au nord, plus ses passages sont bas et rares.',
        ),
      },
      {
        q: L('How big is Tiangong?', 'Quelle est la taille de Tiangong ?'),
        a: L(
          'About a sixth of the mass of the International Space Station, with three main modules; visiting spacecraft dock to it.',
          'Environ le sixième de la masse de la Station spatiale internationale, avec trois modules principaux ; des vaisseaux s’y amarrent.',
        ),
      },
    ],
    view: { view: 'earth', sel: '48274', follow: true },
    related: ['iss', 'hubble', 'satellites'],
  },
  {
    id: 'hubble',
    theme: 'earth',
    kind: 'satellite',
    target: '20580',
    slug: L('where-is-hubble', 'ou-est-hubble'),
    question: L('Where is the Hubble Space Telescope now?', 'Où est le télescope spatial Hubble ?'),
    lead: L(
      'The Hubble Space Telescope orbits the Earth about every 95 minutes, some 500 km up; its live position is computed below.',
      'Le télescope spatial Hubble fait le tour de la Terre en 95 minutes environ, à quelque 500 km d’altitude ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live position of the Hubble Space Telescope above the Earth, its ground track, altitude and speed, and its passes over you.',
      'Position en direct du télescope spatial Hubble au-dessus de la Terre, sa trace au sol, son altitude, sa vitesse et ses passages au-dessus de vous.',
    ),
    intro: L(
      'Hubble has orbited the Earth since 1990, a little under 500 km up, about once every 95 minutes. Above the atmosphere, which blurs and absorbs light, it has taken some of the sharpest pictures of planets, nebulae and distant galaxies, and helped measure the age and expansion of the universe. Astronauts visited it five times to repair and upgrade it; the last visit was in 2009. Its orbit is tilted only 28.5° to the equator, so it passes over the tropics and mid-latitudes. The thin air at its altitude slowly brakes it, and it drifts a little lower every year.',
      'Hubble tourne autour de la Terre depuis 1990, à un peu moins de 500 km d’altitude, en 95 minutes environ. Au-dessus de l’atmosphère, qui brouille et absorbe la lumière, il a pris certaines des images les plus nettes des planètes, des nébuleuses et des galaxies lointaines, et aidé à mesurer l’âge et l’expansion de l’univers. Des astronautes l’ont visité cinq fois pour le réparer et l’améliorer ; la dernière visite date de 2009. Son orbite n’est inclinée que de 28,5° sur l’équateur : il survole les tropiques et les latitudes moyennes. L’air très ténu à son altitude le freine lentement, et il descend un peu chaque année.',
    ),
    faq: [
      {
        q: L('Can I see Hubble from the ground?', 'Peut-on voir Hubble depuis le sol ?'),
        a: L(
          'Yes, from latitudes below about 40° north or south, as a moving point about as bright as a fairly bright star.',
          'Oui, depuis les latitudes inférieures à environ 40° nord ou sud, comme un point mobile à peu près aussi brillant qu’une étoile assez lumineuse.',
        ),
      },
      {
        q: L(
          'Is Hubble the same as the James Webb telescope?',
          'Hubble, est-ce la même chose que le télescope James Webb ?',
        ),
        a: L(
          'No. Hubble orbits the Earth and sees mostly visible and ultraviolet light; Webb is much farther away, 1.5 million km from the Earth, and sees infrared light.',
          'Non. Hubble tourne autour de la Terre et voit surtout la lumière visible et ultraviolette ; Webb est bien plus loin, à 1,5 million de km de la Terre, et voit l’infrarouge.',
        ),
      },
    ],
    view: { view: 'earth', sel: '20580', follow: true },
    related: ['jwst', 'iss', 'euclid'],
  },
  {
    id: 'satellites',
    theme: 'earth',
    kind: 'constellation',
    stats: {},
    slug: L('how-many-satellites-are-in-orbit', 'combien-de-satellites-en-orbite'),
    question: L(
      'How many satellites are orbiting the Earth?',
      'Combien de satellites tournent autour de la Terre ?',
    ),
    lead: L(
      'More than ten thousand active satellites orbit the Earth, most of them in low orbit; the live count below comes from the latest CelesTrak catalogue.',
      'Plus de dix mille satellites actifs tournent autour de la Terre, la plupart en orbite basse ; le décompte ci-dessous vient du dernier catalogue de CelesTrak.',
    ),
    description: L(
      'Live count of active satellites around the Earth, by country, operator and orbit, from CelesTrak’s public catalogue.',
      'Nombre en direct de satellites actifs autour de la Terre, par pays, opérateur et orbite, d’après le catalogue public de CelesTrak.',
    ),
    intro: L(
      'More than ten thousand working satellites now circle the Earth, and the number grows every week. Most fly in low Earth orbit, below 2,000 km, where they go around in about an hour and a half: internet constellations such as Starlink, Earth-observation satellites and space stations. Navigation satellites such as GPS fly much higher, around 20,000 km, and television and weather satellites hover 35,786 km above the equator. The counts on this page come from CelesTrak’s list of active satellites, refreshed several times a day; they leave out the debris and spent rocket stages that are also tracked.',
      'Plus de dix mille satellites en service tournent aujourd’hui autour de la Terre, et leur nombre augmente chaque semaine. La plupart volent en orbite basse, sous 2 000 km, où ils font le tour en une heure et demie environ : constellations Internet comme Starlink, satellites d’observation de la Terre et stations spatiales. Les satellites de navigation comme le GPS volent bien plus haut, vers 20 000 km, et ceux de télévision et de météo restent à 35 786 km au-dessus de l’équateur. Les nombres de cette page viennent de la liste des satellites actifs de CelesTrak, mise à jour plusieurs fois par jour ; ils excluent les débris et les étages de fusée usés, eux aussi suivis.',
    ),
    faq: [
      {
        q: L('Which country has the most satellites?', 'Quel pays a le plus de satellites ?'),
        a: L(
          'The United States, by far, mostly because of SpaceX’s Starlink constellation; the live table on this page ranks countries and organisations.',
          'Les États-Unis, de loin, surtout à cause de la constellation Starlink de SpaceX ; le tableau en direct de cette page classe les pays et organisations.',
        ),
      },
      {
        q: L('Does this include space junk?', 'Les débris spatiaux sont-ils comptés ?'),
        a: L(
          'No: only active satellites. Tens of thousands of pieces of debris larger than a few centimetres are tracked as well.',
          'Non : seulement les satellites actifs. Des dizaines de milliers de débris de plus de quelques centimètres sont également suivis.',
        ),
      },
    ],
    view: { view: 'earth' },
    related: ['starlink', 'geostationary', 'gps', 'iss'],
  },
  {
    id: 'starlink',
    theme: 'earth',
    kind: 'constellation',
    stats: { group: 'starlink' },
    slug: L('how-many-starlink-satellites', 'combien-de-satellites-starlink'),
    question: L(
      'How many Starlink satellites are in orbit?',
      'Combien de satellites Starlink sont en orbite ?',
    ),
    lead: L(
      'SpaceX’s Starlink satellites are the largest constellation ever launched, in low orbit around 550 km up; the live count is below.',
      'Les satellites Starlink de SpaceX forment la plus grande constellation jamais lancée, en orbite basse vers 550 km d’altitude ; le décompte en direct est ci-dessous.',
    ),
    description: L(
      'Live count of SpaceX Starlink satellites in orbit, their altitudes, and a 3D view of the whole constellation around the Earth.',
      'Nombre en direct de satellites Starlink de SpaceX en orbite, leurs altitudes, et une vue 3D de toute la constellation autour de la Terre.',
    ),
    intro: L(
      'Starlink is SpaceX’s internet constellation. Since 2019, rockets have launched dozens of flat satellites at a time into low orbits, mostly between 340 and 570 km, so that a user anywhere is always within reach of several of them. It is by far the largest group of satellites ever built: more than half of all active satellites belong to it. Just after launch, a fresh batch can be seen as a “train” of bright dots moving in a line across the evening sky. Astronomers study how such large constellations affect telescope images, and SpaceX has darkened its satellites to reduce their glare.',
      'Starlink est la constellation Internet de SpaceX. Depuis 2019, des fusées lancent des dizaines de satellites plats à la fois sur des orbites basses, surtout entre 340 et 570 km, pour qu’un utilisateur, où qu’il soit, en ait toujours plusieurs à portée. C’est de loin le plus grand groupe de satellites jamais construit : plus de la moitié des satellites actifs lui appartiennent. Juste après un lancement, on peut voir un nouveau lot comme un « train » de points brillants alignés qui traverse le ciel du soir. Les astronomes étudient l’effet de ces grandes constellations sur les images des télescopes, et SpaceX a assombri ses satellites pour réduire leur éclat.',
    ),
    faq: [
      {
        q: L('Why are Starlink satellites so low?', 'Pourquoi les satellites Starlink sont-ils si bas ?'),
        a: L(
          'Close to the ground, signals travel quickly and need less power; a satellite that fails also falls back and burns up within a few years.',
          'Près du sol, les signaux voyagent vite et demandent moins de puissance ; un satellite en panne retombe aussi et se consume en quelques années.',
        ),
      },
      {
        q: L('What is a “Starlink train”?', 'Qu’est-ce qu’un « train Starlink » ?'),
        a: L(
          'Satellites from the same launch, still close together on their way to their final orbit, which look like a line of moving lights.',
          'Des satellites d’un même lancement, encore proches les uns des autres en route vers leur orbite finale, qui ressemblent à une file de lumières en mouvement.',
        ),
      },
    ],
    view: { view: 'earth', params: { grp: 'starlink' } },
    related: ['satellites', 'oneweb', 'iss'],
  },
  {
    id: 'oneweb',
    theme: 'earth',
    kind: 'constellation',
    stats: { group: 'oneweb' },
    slug: L('oneweb-satellites', 'satellites-oneweb'),
    question: L('How many OneWeb satellites are in orbit?', 'Combien de satellites OneWeb sont en orbite ?'),
    lead: L(
      'Eutelsat OneWeb’s internet satellites fly in polar orbits about 1,200 km up; the live count is below.',
      'Les satellites Internet de Eutelsat OneWeb circulent sur des orbites polaires à environ 1 200 km d’altitude ; le décompte en direct est ci-dessous.',
    ),
    description: L(
      'Live count of Eutelsat OneWeb satellites, their polar orbits around 1,200 km, and a 3D view of the constellation.',
      'Nombre en direct de satellites Eutelsat OneWeb, leurs orbites polaires vers 1 200 km, et une vue 3D de la constellation.',
    ),
    intro: L(
      'OneWeb, now part of the French operator Eutelsat, runs an internet constellation of several hundred satellites. They fly higher than Starlink, about 1,200 km up, on orbits that pass close to the poles, arranged in a dozen rings that cover the whole globe, including the Arctic. Each orbit takes a little under two hours. OneWeb mostly sells its connection to companies, governments, ships and planes rather than to homes. In the 3D view, notice how the rings all cross above the poles, unlike Starlink’s orbits, which are mostly tilted about 53° and leave the polar regions to a few dedicated shells.',
      'OneWeb, qui fait aujourd’hui partie de l’opérateur français Eutelsat, exploite une constellation Internet de plusieurs centaines de satellites. Ils volent plus haut que Starlink, vers 1 200 km, sur des orbites qui passent près des pôles, réparties en une douzaine d’anneaux qui couvrent tout le globe, Arctique compris. Chaque orbite prend un peu moins de deux heures. OneWeb vend surtout sa connexion aux entreprises, aux gouvernements, aux navires et aux avions plutôt qu’aux particuliers. Dans la vue 3D, remarquez que les anneaux se croisent tous au-dessus des pôles, contrairement aux orbites de Starlink, surtout inclinées d’environ 53°.',
    ),
    faq: [
      {
        q: L('Who owns OneWeb?', 'À qui appartient OneWeb ?'),
        a: L(
          'Eutelsat, a European satellite operator based in France, merged with OneWeb in 2023 (Eutelsat OneWeb).',
          'Eutelsat, un opérateur européen de satellites basé en France, a fusionné avec OneWeb en 2023 (Eutelsat OneWeb).',
        ),
      },
      {
        q: L('Why polar orbits?', 'Pourquoi des orbites polaires ?'),
        a: L(
          'An orbit passing over the poles sees every latitude as the Earth turns beneath it, so the constellation covers the whole planet.',
          'Une orbite qui passe au-dessus des pôles voit toutes les latitudes pendant que la Terre tourne sous elle : la constellation couvre ainsi toute la planète.',
        ),
      },
    ],
    view: { view: 'earth', params: { grp: 'oneweb' } },
    related: ['starlink', 'satellites', 'geostationary'],
  },
  {
    id: 'gps',
    theme: 'earth',
    kind: 'constellation',
    stats: { group: 'gps-ops' },
    slug: L('gps-satellites', 'satellites-gps'),
    question: L('Where are the GPS satellites?', 'Où sont les satellites GPS ?'),
    lead: L(
      'The GPS satellites orbit about 20,200 km up, on six planes, so that at least four are above the horizon almost anywhere; their live count and positions are below.',
      'Les satellites GPS tournent à environ 20 200 km d’altitude, sur six plans, pour qu’au moins quatre soient au-dessus de l’horizon presque partout ; leur nombre et leurs positions en direct sont ci-dessous.',
    ),
    description: L(
      'Live count and 3D view of the GPS navigation satellites, about 20,200 km above the Earth, and how they give your position.',
      'Nombre en direct et vue 3D des satellites de navigation GPS, à environ 20 200 km de la Terre, et comment ils donnent votre position.',
    ),
    intro: L(
      'The Global Positioning System, run by the United States Space Force, uses about thirty satellites about 20,200 km above the Earth. They are spread over six orbital planes tilted 55°, and each goes around twice a day. Every satellite carries atomic clocks and broadcasts the exact time and its own position. A receiver, such as the one in your phone, picks up the signals of at least four satellites, compares how long each took to arrive and works out where it is, often to within a few metres. Europe’s Galileo, Russia’s GLONASS and China’s BeiDou work the same way, and phones use them together.',
      'Le système de positionnement mondial GPS, exploité par la Space Force des États-Unis, utilise une trentaine de satellites à environ 20 200 km de la Terre. Ils sont répartis sur six plans orbitaux inclinés de 55°, et chacun fait le tour deux fois par jour. Chaque satellite porte des horloges atomiques et diffuse l’heure exacte et sa propre position. Un récepteur, comme celui de votre téléphone, capte les signaux d’au moins quatre satellites, compare le temps mis par chacun pour arriver et en déduit où il se trouve, souvent à quelques mètres près. Galileo (Europe), GLONASS (Russie) et BeiDou (Chine) fonctionnent de la même façon, et les téléphones les utilisent ensemble.',
    ),
    faq: [
      {
        q: L('How many GPS satellites are needed?', 'Combien de satellites GPS faut-il ?'),
        a: L(
          'Four in view at once: three for the position and one more to correct the receiver’s clock. The constellation keeps about thirty so that enough are always above every place.',
          'Quatre visibles à la fois : trois pour la position et un de plus pour corriger l’horloge du récepteur. La constellation en compte une trentaine pour qu’il y en ait toujours assez au-dessus de chaque lieu.',
        ),
      },
      {
        q: L('Why do GPS satellites need relativity?', 'Pourquoi le GPS a-t-il besoin de la relativité ?'),
        a: L(
          'Their clocks tick about 38 microseconds a day faster than on the ground (weaker gravity, high speed); without that correction, positions would drift by kilometres each day.',
          'Leurs horloges avancent d’environ 38 microsecondes par jour par rapport au sol (gravité plus faible, grande vitesse) ; sans cette correction, les positions dériveraient de plusieurs kilomètres par jour.',
        ),
      },
    ],
    view: { view: 'earth', params: { grp: 'gps-ops' } },
    related: ['galileo', 'beidou', 'geostationary'],
  },
  {
    id: 'galileo',
    theme: 'earth',
    kind: 'constellation',
    stats: { group: 'galileo' },
    slug: L('galileo-satellites', 'satellites-galileo'),
    question: L(
      'Where are the Galileo navigation satellites?',
      'Où sont les satellites de navigation Galileo ?',
    ),
    lead: L(
      'Europe’s Galileo navigation satellites orbit about 23,200 km up on three planes; their live count and positions are below.',
      'Les satellites de navigation européens Galileo tournent à environ 23 200 km d’altitude sur trois plans ; leur nombre et leurs positions en direct sont ci-dessous.',
    ),
    description: L(
      'Live count and 3D view of Europe’s Galileo navigation satellites, about 23,200 km above the Earth.',
      'Nombre en direct et vue 3D des satellites de navigation européens Galileo, à environ 23 200 km de la Terre.',
    ),
    intro: L(
      'Galileo is Europe’s satellite navigation system, built by the European Union and the European Space Agency. Its satellites orbit about 23,200 km above the Earth in three planes tilted 56°, each going around in about 14 hours. Like GPS, every satellite broadcasts precise time from atomic clocks, and a receiver combines several signals to find its position. Galileo is civilian, and it also relays distress beacons for search and rescue. Most phones sold today use Galileo together with GPS, GLONASS and BeiDou, which gives a more reliable position in cities, where buildings hide part of the sky.',
      'Galileo est le système européen de navigation par satellite, construit par l’Union européenne et l’Agence spatiale européenne. Ses satellites tournent à environ 23 200 km de la Terre sur trois plans inclinés de 56°, chacun en 14 heures environ. Comme pour le GPS, chaque satellite diffuse une heure précise donnée par des horloges atomiques, et un récepteur combine plusieurs signaux pour trouver sa position. Galileo est civil et relaie aussi les balises de détresse pour les secours. La plupart des téléphones vendus aujourd’hui utilisent Galileo avec le GPS, GLONASS et BeiDou, ce qui donne une position plus fiable en ville, où les immeubles cachent une partie du ciel.',
    ),
    faq: [
      {
        q: L('Is Galileo better than GPS?', 'Galileo est-il meilleur que le GPS ?'),
        a: L(
          'Both are accurate to a few metres for everyone; using them together helps most, since more satellites are in view.',
          'Les deux sont précis à quelques mètres pour tout le monde ; c’est surtout leur combinaison qui aide, car plus de satellites sont visibles.',
        ),
      },
      {
        q: L('Why is Galileo higher than GPS?', 'Pourquoi Galileo est-il plus haut que le GPS ?'),
        a: L(
          'Its designers chose an orbit whose ground track repeats every ten days and that covers high latitudes well, such as northern Europe.',
          'Ses concepteurs ont choisi une orbite dont la trace au sol se répète tous les dix jours et qui couvre bien les hautes latitudes, comme le nord de l’Europe.',
        ),
      },
    ],
    view: { view: 'earth', params: { grp: 'galileo' } },
    related: ['gps', 'beidou', 'satellites'],
  },
  {
    id: 'beidou',
    theme: 'earth',
    kind: 'constellation',
    stats: { group: 'beidou' },
    slug: L('beidou-satellites', 'satellites-beidou'),
    question: L(
      'Where are the BeiDou navigation satellites?',
      'Où sont les satellites de navigation BeiDou ?',
    ),
    lead: L(
      'China’s BeiDou navigation system combines medium-orbit, geostationary and inclined geosynchronous satellites; their live count and positions are below.',
      'Le système de navigation chinois BeiDou combine des satellites en orbite moyenne, géostationnaires et géosynchrones inclinés ; leur nombre et leurs positions en direct sont ci-dessous.',
    ),
    description: L(
      'Live count and 3D view of China’s BeiDou navigation satellites in medium, geostationary and inclined orbits.',
      'Nombre en direct et vue 3D des satellites de navigation chinois BeiDou en orbites moyenne, géostationnaire et inclinée.',
    ),
    intro: L(
      'BeiDou, named after the Chinese name of the Big Dipper, is China’s satellite navigation system, complete worldwide since 2020. Unlike GPS and Galileo, it mixes three kinds of orbits: most satellites circle about 21,500 km up, others stay above the equator in geostationary orbit, 35,786 km high, and a few follow inclined orbits at the same height that trace figure-of-eight paths over Asia. That mix gives especially good coverage of the Asia-Pacific region. BeiDou also lets users send short text messages through its satellites, a service the other systems do not offer.',
      'BeiDou, du nom chinois de la Grande Ourse, est le système chinois de navigation par satellite, complet sur toute la Terre depuis 2020. Contrairement au GPS et à Galileo, il combine trois types d’orbites : la plupart des satellites tournent vers 21 500 km d’altitude, d’autres restent au-dessus de l’équateur en orbite géostationnaire, à 35 786 km, et quelques-uns suivent à la même hauteur des orbites inclinées qui dessinent des huit au-dessus de l’Asie. Ce mélange donne une couverture particulièrement bonne de la région Asie-Pacifique. BeiDou permet aussi d’envoyer de courts messages texte par ses satellites, un service que les autres systèmes n’offrent pas.',
    ),
    faq: [
      {
        q: L('Does my phone use BeiDou?', 'Mon téléphone utilise-t-il BeiDou ?'),
        a: L(
          'Most recent phones receive BeiDou together with GPS, Galileo and GLONASS.',
          'La plupart des téléphones récents reçoivent BeiDou avec le GPS, Galileo et GLONASS.',
        ),
      },
      {
        q: L(
          'Why do some BeiDou satellites draw a figure eight?',
          'Pourquoi certains satellites BeiDou dessinent-ils un huit ?',
        ),
        a: L(
          'They take one day per orbit like geostationary satellites, but their orbit is tilted, so they swing north and south of the equator over the same longitudes.',
          'Ils mettent un jour par orbite comme les satellites géostationnaires, mais leur orbite est inclinée : ils oscillent au nord et au sud de l’équateur au-dessus des mêmes longitudes.',
        ),
      },
    ],
    view: { view: 'earth', params: { grp: 'beidou' } },
    related: ['gps', 'galileo', 'geostationary'],
  },
  {
    id: 'geostationary',
    theme: 'earth',
    kind: 'constellation',
    stats: { regime: 'GEO' },
    slug: L('geostationary-satellites', 'satellites-geostationnaires'),
    question: L('What are geostationary satellites?', 'Que sont les satellites géostationnaires ?'),
    lead: L(
      'A geostationary satellite orbits 35,786 km above the equator in exactly one day, so it seems to stay still in the sky; the live count is below.',
      'Un satellite géostationnaire tourne à 35 786 km au-dessus de l’équateur en exactement un jour : il semble immobile dans le ciel ; le décompte en direct est ci-dessous.',
    ),
    description: L(
      'Live count and 3D view of the satellites 35,786 km above the equator that turn with the Earth and seem fixed in the sky.',
      'Nombre en direct et vue 3D des satellites à 35 786 km au-dessus de l’équateur, qui tournent avec la Terre et semblent fixes dans le ciel.',
    ),
    intro: L(
      'At 35,786 km above the equator, a satellite takes exactly one day to go around the Earth, the time the Earth takes to turn once. Seen from the ground it seems to stand still, which is why satellite dishes can point at one spot for years. That ring, the geostationary orbit, hosts television, communication and weather satellites: the images of clouds in weather forecasts often come from there. In the 3D view, the satellites form a thin necklace far out around the Earth. Space on that ring is shared out between countries, and old satellites are pushed a few hundred kilometres higher at the end of their life to free their place.',
      'À 35 786 km au-dessus de l’équateur, un satellite met exactement un jour à faire le tour de la Terre, le temps qu’elle met à tourner sur elle-même. Vu du sol, il semble immobile : c’est pourquoi les antennes paraboliques peuvent viser le même point pendant des années. Cet anneau, l’orbite géostationnaire, accueille des satellites de télévision, de communication et de météo : les images de nuages des bulletins météo viennent souvent de là. Dans la vue 3D, les satellites forment un mince collier loin autour de la Terre. Les places sur cet anneau sont réparties entre les pays, et les vieux satellites sont poussés quelques centaines de kilomètres plus haut en fin de vie pour libérer la leur.',
    ),
    faq: [
      {
        q: L('Why exactly 35,786 km?', 'Pourquoi exactement 35 786 km ?'),
        a: L(
          'The farther a satellite, the slower it orbits. At that height, its period equals one sidereal day (23 h 56 min), so it keeps pace with the turning Earth.',
          'Plus un satellite est loin, plus il tourne lentement. À cette altitude, sa période égale un jour sidéral (23 h 56 min) : il suit la rotation de la Terre.',
        ),
      },
      {
        q: L('Can I see geostationary satellites?', 'Peut-on voir les satellites géostationnaires ?'),
        a: L(
          'Not with the naked eye; with a telescope they appear as faint points that stay still while the stars drift past.',
          'Pas à l’œil nu ; au télescope, ils apparaissent comme des points faibles qui restent fixes pendant que les étoiles défilent.',
        ),
      },
    ],
    view: { view: 'earth', params: { reg: 'GEO' } },
    related: ['satellites', 'beidou', 'gps'],
  },
  // ------------------------------------------------------------------ telescopes and probes
  {
    id: 'jwst',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'jwst',
    slug: L('where-is-james-webb', 'ou-est-james-webb'),
    question: L('Where is the James Webb Space Telescope?', 'Où est le télescope spatial James Webb ?'),
    lead: L(
      'The James Webb Space Telescope orbits the Sun near the L2 point, about 1.5 million km from the Earth, on the side away from the Sun; its live distance is computed below.',
      'Le télescope spatial James Webb tourne autour du Soleil près du point L2, à environ 1,5 million de km de la Terre, du côté opposé au Soleil ; sa distance en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of the James Webb Space Telescope from the Earth and the Sun, its orbit around the L2 point, and what it studies.',
      'Distance en direct du télescope spatial James Webb à la Terre et au Soleil, son orbite autour du point L2, et ce qu’il étudie.',
    ),
    intro: L(
      'The James Webb Space Telescope, launched on 25 December 2021, does not orbit the Earth. It circles a point in space called Sun–Earth L2, about 1.5 million km from the Earth on the side away from the Sun, four times farther than the Moon. There, the Sun, the Earth and the Moon stay on the same side, and a sunshield the size of a tennis court keeps the telescope in the cold and dark it needs to see infrared light. Its golden mirror, 6.5 m across, collects light from the first galaxies, from stars being born and from the atmospheres of planets around other stars. It travels around the Sun with the Earth, once a year.',
      'Le télescope spatial James Webb, lancé le 25 décembre 2021, ne tourne pas autour de la Terre. Il décrit une orbite autour d’un point de l’espace appelé L2 Soleil–Terre, à environ 1,5 million de km de la Terre, du côté opposé au Soleil, quatre fois plus loin que la Lune. Là, le Soleil, la Terre et la Lune restent du même côté, et un pare-soleil grand comme un court de tennis garde le télescope dans le froid et l’obscurité dont il a besoin pour voir l’infrarouge. Son miroir doré de 6,5 m recueille la lumière des premières galaxies, des étoiles en formation et des atmosphères de planètes autour d’autres étoiles. Il fait le tour du Soleil avec la Terre, en un an.',
    ),
    faq: [
      {
        q: L('How far away is the James Webb telescope?', 'À quelle distance est le télescope James Webb ?'),
        a: L(
          'About 1.5 million km from the Earth; its orbit around L2 makes the distance vary, and the live value is shown above.',
          'Environ 1,5 million de km de la Terre ; son orbite autour de L2 fait varier la distance, dont la valeur en direct est affichée plus haut.',
        ),
      },
      {
        q: L('Can astronauts repair Webb?', 'Des astronautes peuvent-ils réparer Webb ?'),
        a: L(
          'No: it is far beyond the reach of crewed spacecraft, unlike Hubble, which orbits the Earth.',
          'Non : il est bien au-delà de la portée des vaisseaux habités, contrairement à Hubble, qui tourne autour de la Terre.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'jwst', follow: true, hideMissions: true },
    related: ['hubble', 'euclid', 'voyager-1'],
  },
  {
    id: 'euclid',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'euclid',
    slug: L('where-is-euclid', 'ou-est-euclid'),
    question: L('Where is the Euclid space telescope?', 'Où est le télescope spatial Euclid ?'),
    lead: L(
      'ESA’s Euclid telescope orbits the Sun near the L2 point, about 1.5 million km from the Earth; its live distance is computed below.',
      'Le télescope Euclid de l’ESA tourne autour du Soleil près du point L2, à environ 1,5 million de km de la Terre ; sa distance en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of ESA’s Euclid telescope from the Earth and the Sun, near the L2 point, and its map of the dark universe.',
      'Distance en direct du télescope Euclid de l’ESA à la Terre et au Soleil, près du point L2, et sa carte de l’univers sombre.',
    ),
    intro: L(
      'Euclid, a European Space Agency telescope launched on 1 July 2023, shares the neighbourhood of the James Webb telescope: it orbits the Sun–Earth L2 point, about 1.5 million km from the Earth. Its job is to map billions of galaxies over a third of the sky and measure how their shapes are slightly bent by unseen matter, and how the expansion of the universe has changed over ten billion years. Those measurements test our ideas about dark matter and dark energy, which together make up about 95 % of the universe but have never been seen directly. Euclid publishes its survey in instalments.',
      'Euclid, un télescope de l’Agence spatiale européenne lancé le 1er juillet 2023, est voisin du télescope James Webb : il tourne autour du point L2 Soleil–Terre, à environ 1,5 million de km de la Terre. Sa mission : cartographier des milliards de galaxies sur un tiers du ciel et mesurer comment leurs formes sont légèrement déformées par de la matière invisible, et comment l’expansion de l’univers a évolué sur dix milliards d’années. Ces mesures mettent à l’épreuve nos idées sur la matière noire et l’énergie sombre, qui forment ensemble environ 95 % de l’univers mais n’ont jamais été vues directement. Euclid publie son relevé par étapes.',
    ),
    faq: [
      {
        q: L('What is the L2 point?', 'Qu’est-ce que le point L2 ?'),
        a: L(
          'A place about 1.5 million km beyond the Earth, on the side away from the Sun, where a spacecraft can keep pace with the Earth around the Sun with little fuel.',
          'Un endroit à environ 1,5 million de km au-delà de la Terre, du côté opposé au Soleil, où un engin peut suivre la Terre autour du Soleil avec peu de carburant.',
        ),
      },
      {
        q: L('What is dark matter?', 'Qu’est-ce que la matière noire ?'),
        a: L(
          'Matter that we detect only through its gravity: it bends light and holds galaxies together, but emits no light of its own.',
          'De la matière qu’on ne détecte que par sa gravité : elle courbe la lumière et retient les galaxies, mais n’émet aucune lumière.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'euclid', follow: true, hideMissions: true },
    related: ['jwst', 'hubble', 'solar-orbiter'],
  },
  {
    id: 'voyager-1',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'voyager-1',
    focus: 'distance',
    slug: L('how-far-is-voyager-1', 'distance-voyager-1'),
    question: L('How far away is Voyager 1?', 'À quelle distance se trouve Voyager 1 ?'),
    lead: L(
      'Voyager 1 is in interstellar space, farther from the Earth than any other spacecraft; its live distance is computed below.',
      'Voyager 1 est dans l’espace interstellaire, plus loin de la Terre que tout autre engin spatial ; sa distance en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of Voyager 1, the farthest spacecraft from the Earth, in kilometres, astronomical units and light travel time.',
      'Distance en direct de Voyager 1, l’engin le plus éloigné de la Terre, en kilomètres, en unités astronomiques et en temps de lumière.',
    ),
    intro: L(
      'Voyager 1, launched on 5 September 1977, is the most distant object ever built by humans. After flying past Jupiter in 1979 and Saturn in 1980, it headed out of the solar system and crossed into interstellar space in August 2012. It still sends data with a transmitter about as powerful as a fridge light bulb; its signal, travelling at the speed of light, now takes almost a day to reach the Earth. Its distance from the Sun grows by about 17 km every second. Engineers switch off instruments one by one to save its dwindling power, so that Voyager can keep talking to us for as long as possible.',
      'Voyager 1, lancée le 5 septembre 1977, est l’objet le plus lointain jamais construit par l’humanité. Après avoir survolé Jupiter en 1979 et Saturne en 1980, elle s’est dirigée hors du système solaire et est entrée dans l’espace interstellaire en août 2012. Elle envoie encore des données avec un émetteur à peu près aussi puissant qu’une ampoule de réfrigérateur ; son signal, qui voyage à la vitesse de la lumière, met maintenant près d’une journée à atteindre la Terre. Sa distance au Soleil augmente d’environ 17 km chaque seconde. Les ingénieurs éteignent ses instruments un à un pour économiser son énergie déclinante, afin que Voyager puisse nous parler le plus longtemps possible.',
    ),
    faq: [
      {
        q: L('Has Voyager 1 left the solar system?', 'Voyager 1 a-t-elle quitté le système solaire ?'),
        a: L(
          'It left the heliosphere, the bubble of the Sun’s wind, in 2012. The Sun’s gravity still reaches much farther, out to the Oort cloud, which Voyager will need tens of thousands of years to cross.',
          'Elle a quitté l’héliosphère, la bulle du vent solaire, en 2012. La gravité du Soleil porte bien plus loin, jusqu’au nuage d’Oort, que Voyager mettra des dizaines de milliers d’années à traverser.',
        ),
      },
      {
        q: L('Is Voyager 1 still working?', 'Voyager 1 fonctionne-t-elle encore ?'),
        a: L(
          'Yes, with a few instruments left on; its power source, which turns the heat of decaying plutonium into electricity, weakens every year.',
          'Oui, avec quelques instruments encore allumés ; sa source d’énergie, qui transforme en électricité la chaleur du plutonium, faiblit chaque année.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'voyager-1', follow: true, hideMissions: true },
    related: ['voyager-2', 'new-horizons', 'planets'],
  },
  {
    id: 'voyager-2',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'voyager-2',
    focus: 'distance',
    slug: L('how-far-is-voyager-2', 'distance-voyager-2'),
    question: L('How far away is Voyager 2?', 'À quelle distance se trouve Voyager 2 ?'),
    lead: L(
      'Voyager 2, the only spacecraft to have visited Uranus and Neptune, is in interstellar space; its live distance is computed below.',
      'Voyager 2, le seul engin à avoir visité Uranus et Neptune, est dans l’espace interstellaire ; sa distance en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of Voyager 2 from the Earth and the Sun, the only spacecraft to have visited Uranus and Neptune.',
      'Distance en direct de Voyager 2 à la Terre et au Soleil, le seul engin à avoir visité Uranus et Neptune.',
    ),
    intro: L(
      'Voyager 2 was launched on 20 August 1977, sixteen days before its twin, on a slower path that let it visit all four giant planets: Jupiter in 1979, Saturn in 1981, Uranus in 1986 and Neptune in 1989. It is still the only spacecraft to have seen Uranus and Neptune up close. In November 2018 it too crossed into interstellar space, heading south of the plane of the planets. Its radio signal takes many hours to reach the Earth, and only one antenna in Australia can talk to it, because of the direction it travels. The live distance above comes from NASA/JPL’s trajectory.',
      'Voyager 2 a été lancée le 20 août 1977, seize jours avant sa jumelle, sur une trajectoire plus lente qui lui a permis de visiter les quatre planètes géantes : Jupiter en 1979, Saturne en 1981, Uranus en 1986 et Neptune en 1989. C’est encore le seul engin à avoir vu Uranus et Neptune de près. En novembre 2018, elle est à son tour entrée dans l’espace interstellaire, en direction du sud du plan des planètes. Son signal radio met de nombreuses heures à atteindre la Terre, et une seule antenne, en Australie, peut lui parler, à cause de la direction qu’elle suit. La distance affichée vient de la trajectoire de la NASA/JPL.',
    ),
    faq: [
      {
        q: L(
          'Why is Voyager 2 closer than Voyager 1?',
          'Pourquoi Voyager 2 est-elle plus proche que Voyager 1 ?',
        ),
        a: L(
          'Its route through the four giant planets was longer and slower; Voyager 1 took a shortcut after Saturn and travels faster.',
          'Son parcours par les quatre planètes géantes a été plus long et plus lent ; Voyager 1 a pris un raccourci après Saturne et va plus vite.',
        ),
      },
      {
        q: L('What is on the Voyager golden record?', 'Que contient le disque d’or de Voyager ?'),
        a: L(
          'Sounds and images of the Earth, music from many cultures and greetings in 55 languages, in case another civilisation ever finds it.',
          'Des sons et images de la Terre, de la musique de nombreuses cultures et des salutations en 55 langues, au cas où une autre civilisation le trouverait.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'voyager-2', follow: true, hideMissions: true },
    related: ['voyager-1', 'new-horizons', 'planets'],
  },
  {
    id: 'new-horizons',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'new-horizons',
    slug: L('where-is-new-horizons', 'ou-est-new-horizons'),
    question: L('Where is New Horizons now?', 'Où est New Horizons ?'),
    lead: L(
      'New Horizons flew past Pluto in 2015 and is crossing the Kuiper belt, far beyond Neptune; its live position is computed below.',
      'New Horizons a survolé Pluton en 2015 et traverse la ceinture de Kuiper, bien au-delà de Neptune ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of NASA’s New Horizons probe, which flew past Pluto in 2015 and Arrokoth in 2019, from the Earth and the Sun.',
      'Distance en direct de la sonde New Horizons de la NASA, qui a survolé Pluton en 2015 et Arrokoth en 2019, à la Terre et au Soleil.',
    ),
    intro: L(
      'New Horizons left the Earth on 19 January 2006, the fastest launch of its time, and flew past Pluto on 14 July 2015. Its pictures revealed a world of nitrogen-ice plains, water-ice mountains and a blue haze, far more active than expected. On 1 January 2019 it passed Arrokoth, a small reddish object shaped like a snowman, the most distant and most primitive body ever visited. The probe now crosses the Kuiper Belt, measuring the dust and charged particles of the outer solar system. Its distance from the Sun grows by about 14 km every second.',
      'New Horizons a quitté la Terre le 19 janvier 2006, le lancement le plus rapide de son époque, et a survolé Pluton le 14 juillet 2015. Ses images ont révélé un monde de plaines de glace d’azote, de montagnes de glace d’eau et de brume bleue, bien plus actif que prévu. Le 1er janvier 2019, elle est passée près d’Arrokoth, un petit objet rougeâtre en forme de bonhomme de neige, le corps le plus lointain et le plus primitif jamais visité. La sonde traverse maintenant la ceinture de Kuiper et mesure les poussières et les particules chargées du système solaire extérieur. Sa distance au Soleil augmente d’environ 14 km chaque seconde.',
    ),
    faq: [
      {
        q: L('Will New Horizons visit another object?', 'New Horizons visitera-t-elle un autre objet ?'),
        a: L(
          'Its team searches for another target within reach, but none has been found yet; it keeps studying the Kuiper Belt from afar.',
          'Son équipe cherche une autre cible à sa portée, mais aucune n’a encore été trouvée ; elle continue d’étudier la ceinture de Kuiper à distance.',
        ),
      },
      {
        q: L('How long did it take to reach Pluto?', 'Combien de temps a-t-elle mis pour atteindre Pluton ?'),
        a: L(
          'Nine and a half years, with a boost from Jupiter’s gravity in 2007.',
          'Neuf ans et demi, avec un coup de pouce de la gravité de Jupiter en 2007.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'new-horizons', follow: true, hideMissions: true },
    related: ['pluto', 'voyager-1', 'dwarf-planets'],
  },
  {
    id: 'parker',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'parker-solar-probe',
    slug: L('where-is-parker-solar-probe', 'ou-est-parker-solar-probe'),
    question: L('Where is the Parker Solar Probe?', 'Où est la sonde solaire Parker ?'),
    lead: L(
      'The Parker Solar Probe flies closer to the Sun than any spacecraft before it, through the Sun’s outer atmosphere; its live position is computed below.',
      'La sonde Parker Solar Probe passe plus près du Soleil qu’aucun engin avant elle, à travers la haute atmosphère du Soleil ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance and speed of NASA’s Parker Solar Probe, the spacecraft that flies closest to the Sun and fastest of all.',
      'Distance et vitesse en direct de la sonde Parker de la NASA, l’engin qui passe le plus près du Soleil et qui va le plus vite.',
    ),
    intro: L(
      'Parker Solar Probe, launched on 12 August 2018, “touches” the Sun: it dives through the Sun’s outer atmosphere, the corona, to learn why it is millions of degrees hotter than the surface and how the solar wind is launched. Flybys of Venus shrank its orbit step by step until, on 24 December 2024, it passed just 6.1 million km from the Sun’s surface at about 690,000 km/h, the fastest speed of any human-made object. A thick carbon heat shield keeps its instruments near room temperature while its front side heats to about 1,000 °C. Watch its speed above: it changes enormously between the far point and the close point of its orbit.',
      'La sonde Parker, lancée le 12 août 2018, « touche » le Soleil : elle plonge dans son atmosphère extérieure, la couronne, pour comprendre pourquoi celle-ci est des millions de degrés plus chaude que la surface et comment naît le vent solaire. Des survols de Vénus ont réduit son orbite pas à pas jusqu’à ce que, le 24 décembre 2024, elle passe à seulement 6,1 millions de km de la surface du Soleil à environ 690 000 km/h, la plus grande vitesse jamais atteinte par un objet humain. Un épais bouclier de carbone garde ses instruments près de la température ambiante alors que sa face avant chauffe à environ 1 000 °C. Observez sa vitesse : elle change énormément entre le point le plus éloigné et le plus proche de son orbite.',
    ),
    faq: [
      {
        q: L('Why doesn’t Parker melt?', 'Pourquoi Parker ne fond-elle pas ?'),
        a: L(
          'Its heat shield, a sandwich of carbon foam and carbon composite with a white coating, reflects and blocks the heat; the probe keeps it pointed at the Sun.',
          'Son bouclier thermique, un sandwich de mousse de carbone et de composite de carbone recouvert de blanc, réfléchit et bloque la chaleur ; la sonde le garde pointé vers le Soleil.',
        ),
      },
      {
        q: L('Why is it so fast?', 'Pourquoi va-t-elle si vite ?'),
        a: L(
          'Falling towards the Sun, it speeds up, like a ball rolling downhill; at its closest point, the Sun’s gravity is strongest.',
          'En tombant vers le Soleil, elle accélère, comme une balle qui dévale une pente ; à son point le plus proche, la gravité du Soleil est la plus forte.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'parker-solar-probe', follow: true, hideMissions: true },
    related: ['solar-orbiter', 'sun', 'bepicolombo'],
  },
  {
    id: 'solar-orbiter',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'solar-orbiter',
    slug: L('where-is-solar-orbiter', 'ou-est-solar-orbiter'),
    question: L('Where is Solar Orbiter?', 'Où est Solar Orbiter ?'),
    lead: L(
      'Solar Orbiter, an ESA and NASA mission, orbits the Sun to watch it up close and from above its equator; its live position is computed below.',
      'Solar Orbiter, une mission de l’ESA et de la NASA, tourne autour du Soleil pour l’observer de près et au-dessus de son équateur ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of the ESA–NASA Solar Orbiter from the Sun and the Earth, the first spacecraft to photograph the Sun’s poles.',
      'Distance en direct de Solar Orbiter (ESA–NASA) au Soleil et à la Terre, le premier engin à photographier les pôles du Soleil.',
    ),
    intro: L(
      'Solar Orbiter, a European Space Agency mission with NASA, was launched on 10 February 2020. Its orbit brings it inside the orbit of Mercury, about 42 million km from the Sun, where its cameras take close-up pictures while other instruments sample the solar wind that flows past. Flybys of Venus are slowly tilting its orbit out of the plane of the planets, and in 2025 it sent the first-ever pictures of the Sun’s south pole. The poles hold clues to the magnetic cycle that, every eleven years or so, makes sunspots come and go.',
      'Solar Orbiter, une mission de l’Agence spatiale européenne avec la NASA, a été lancée le 10 février 2020. Son orbite l’amène à l’intérieur de celle de Mercure, à environ 42 millions de km du Soleil, où ses caméras prennent des images rapprochées pendant que d’autres instruments analysent le vent solaire qui passe. Des survols de Vénus inclinent peu à peu son orbite hors du plan des planètes, et en 2025 elle a envoyé les toutes premières images du pôle sud du Soleil. Les pôles recèlent des indices sur le cycle magnétique qui, tous les onze ans environ, fait apparaître et disparaître les taches solaires.',
    ),
    faq: [
      {
        q: L(
          'How is Solar Orbiter different from Parker?',
          'En quoi Solar Orbiter diffère-t-elle de Parker ?',
        ),
        a: L(
          'Parker flies much closer but carries no camera looking straight at the Sun; Solar Orbiter stays farther away and takes pictures, and it looks at the poles.',
          'Parker passe bien plus près mais n’a pas de caméra pointée sur le Soleil ; Solar Orbiter reste plus loin, prend des images et observe les pôles.',
        ),
      },
      {
        q: L('Why look at the Sun’s poles?', 'Pourquoi observer les pôles du Soleil ?'),
        a: L(
          'The Sun’s magnetic field flips every eleven years or so, and the poles show how that cycle works; from the Earth we only see them at a grazing angle.',
          'Le champ magnétique du Soleil s’inverse tous les onze ans environ, et les pôles montrent comment fonctionne ce cycle ; depuis la Terre, on ne les voit que de biais.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'solar-orbiter', follow: true, hideMissions: true },
    related: ['parker', 'sun', 'euclid'],
  },
  {
    id: 'juno',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'juno',
    slug: L('where-is-juno', 'ou-est-juno'),
    question: L('Where is the Juno spacecraft?', 'Où est la sonde Juno ?'),
    lead: L(
      'NASA’s Juno orbits Jupiter, passing over its poles to study its atmosphere, interior and magnetic field; its live position is computed below.',
      'La sonde Juno de la NASA tourne autour de Jupiter en passant au-dessus de ses pôles pour étudier son atmosphère, son intérieur et son champ magnétique ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of NASA’s Juno probe, in orbit around Jupiter since 2016, from the Earth and the Sun.',
      'Distance en direct de la sonde Juno de la NASA, en orbite autour de Jupiter depuis 2016, à la Terre et au Soleil.',
    ),
    intro: L(
      'Juno was launched on 5 August 2011 and entered orbit around Jupiter on 4 July 2016. It flies a long, stretched orbit that passes over the poles, skimming a few thousand kilometres above the cloud tops at each close approach. Its instruments look beneath the clouds to measure the water, the deep winds and the magnetic field of the largest planet, and its camera, JunoCam, sends pictures of swirling storms that anyone can process. Juno runs on sunlight even out at Jupiter, five times farther from the Sun than the Earth, with three solar panels nearly 9 m long. Because Juno orbits Jupiter, its distance from the Earth follows Jupiter’s.',
      'Juno a été lancée le 5 août 2011 et s’est placée en orbite autour de Jupiter le 4 juillet 2016. Elle suit une longue orbite étirée qui passe au-dessus des pôles et frôle les nuages à quelques milliers de kilomètres à chaque passage rapproché. Ses instruments regardent sous les nuages pour mesurer l’eau, les vents profonds et le champ magnétique de la plus grande planète, et sa caméra, JunoCam, envoie des images de tempêtes tourbillonnantes que chacun peut traiter. Juno fonctionne à l’énergie solaire même près de Jupiter, cinq fois plus loin du Soleil que la Terre, grâce à trois panneaux de près de 9 m. Comme Juno tourne autour de Jupiter, sa distance à la Terre suit celle de Jupiter.',
    ),
    faq: [
      {
        q: L(
          'How long does Juno take to orbit Jupiter?',
          'Combien de temps Juno met-elle à faire le tour de Jupiter ?',
        ),
        a: L(
          'About a month per orbit in its extended mission; most of that time is spent far from the planet.',
          'Environ un mois par orbite dans sa mission prolongée ; elle passe la plus grande partie de ce temps loin de la planète.',
        ),
      },
      {
        q: L('What has Juno discovered?', 'Qu’a découvert Juno ?'),
        a: L(
          'Giant clusters of cyclones at Jupiter’s poles, a fuzzy core mixed with the rest of the planet and storms that reach hundreds of kilometres deep.',
          'D’immenses groupes de cyclones aux pôles de Jupiter, un noyau diffus mêlé au reste de la planète et des tempêtes qui plongent sur des centaines de kilomètres.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'juno', follow: true, hideMissions: true },
    related: ['europa-clipper', 'juice', 'planets'],
  },
  {
    id: 'europa-clipper',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'europa-clipper',
    slug: L('where-is-europa-clipper', 'ou-est-europa-clipper'),
    question: L('Where is Europa Clipper now?', 'Où est Europa Clipper ?'),
    lead: L(
      'NASA’s Europa Clipper is on its way to Jupiter to study its icy moon Europa and the ocean beneath its crust; its live position is computed below.',
      'La sonde Europa Clipper de la NASA est en route vers Jupiter pour étudier sa lune glacée Europe et l’océan sous sa croûte ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of NASA’s Europa Clipper on its way to Jupiter’s icy moon Europa, from the Earth and the Sun.',
      'Distance en direct d’Europa Clipper (NASA) en route vers Europe, la lune glacée de Jupiter, à la Terre et au Soleil.',
    ),
    intro: L(
      'Europa Clipper, launched on 14 October 2024, is the largest planetary spacecraft NASA has built. It is on its way to Jupiter, where it will arrive in 2030, after borrowing speed from Mars in 2025 and from the Earth. Its target is Europa, a moon slightly smaller than ours whose icy crust hides a salty ocean with perhaps twice as much water as all the Earth’s oceans. Rather than orbiting Europa, which sits in Jupiter’s fierce radiation, Clipper will orbit Jupiter and fly past Europa about fifty times, mapping its ice and checking whether that ocean could host life.',
      'Europa Clipper, lancée le 14 octobre 2024, est la plus grande sonde planétaire jamais construite par la NASA. Elle est en route vers Jupiter, qu’elle atteindra en 2030, après avoir emprunté de la vitesse à Mars en 2025 puis à la Terre. Sa cible est Europe, une lune un peu plus petite que la nôtre dont la croûte de glace cache un océan salé qui contiendrait peut-être deux fois plus d’eau que tous les océans terrestres. Plutôt que de tourner autour d’Europe, plongée dans les radiations intenses de Jupiter, Clipper tournera autour de Jupiter et survolera Europe une cinquantaine de fois pour cartographier sa glace et voir si cet océan pourrait abriter la vie.',
    ),
    faq: [
      {
        q: L(
          'Why does Europa Clipper fly past the Earth?',
          'Pourquoi Europa Clipper repasse-t-elle près de la Terre ?',
        ),
        a: L(
          'A gravity assist: passing close to a planet changes a probe’s speed and direction without fuel, which shortens the trip to Jupiter.',
          'Une assistance gravitationnelle : passer près d’une planète change la vitesse et la direction d’une sonde sans carburant, ce qui raccourcit le voyage vers Jupiter.',
        ),
      },
      {
        q: L('Will it land on Europa?', 'Va-t-elle se poser sur Europe ?'),
        a: L(
          'No. It will study Europa from flybys, some as low as 25 km above the surface.',
          'Non. Elle étudiera Europe lors de survols, certains à seulement 25 km de la surface.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'europa-clipper', follow: true, hideMissions: true },
    related: ['juice', 'juno', 'planets'],
  },
  {
    id: 'juice',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'juice',
    slug: L('where-is-juice', 'ou-est-juice'),
    question: L('Where is ESA’s JUICE mission?', 'Où est la mission JUICE de l’ESA ?'),
    lead: L(
      'ESA’s JUICE is on its way to Jupiter to study Ganymede, Callisto and Europa; its live position is computed below.',
      'La sonde JUICE de l’ESA est en route vers Jupiter pour étudier Ganymède, Callisto et Europe ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of ESA’s JUICE probe on its way to Jupiter and its moon Ganymede, from the Earth and the Sun.',
      'Distance en direct de la sonde JUICE de l’ESA en route vers Jupiter et sa lune Ganymède, à la Terre et au Soleil.',
    ),
    intro: L(
      'JUICE, the JUpiter ICy moons Explorer of the European Space Agency, was launched on 14 April 2023. It is taking the long way to Jupiter, with flybys of the Moon and the Earth in 2024, Venus in 2025, then the Earth again, before arriving in 2031. There it will study Jupiter and three of its large moons, Europa, Callisto and Ganymede, which may all hide oceans under their ice. In 2034 it will become the first spacecraft to orbit a moon of another planet: Ganymede, the largest moon in the solar system, larger than the planet Mercury and the only one with its own magnetic field.',
      'JUICE, l’explorateur des lunes glacées de Jupiter de l’Agence spatiale européenne, a été lancée le 14 avril 2023. Elle prend le chemin long vers Jupiter, avec des survols de la Lune et de la Terre en 2024, de Vénus en 2025, puis de nouveau de la Terre, avant d’arriver en 2031. Elle y étudiera Jupiter et trois de ses grandes lunes, Europe, Callisto et Ganymède, qui pourraient toutes cacher des océans sous leur glace. En 2034, elle deviendra le premier engin à tourner autour d’une lune d’une autre planète : Ganymède, la plus grande lune du système solaire, plus grande que la planète Mercure et la seule à avoir son propre champ magnétique.',
    ),
    faq: [
      {
        q: L(
          'Why does JUICE take eight years to reach Jupiter?',
          'Pourquoi JUICE met-elle huit ans pour atteindre Jupiter ?',
        ),
        a: L(
          'No rocket can send such a heavy probe straight there; flybys of the Earth, the Moon and Venus give it the extra speed it needs.',
          'Aucune fusée ne peut l’envoyer directement là-bas, car elle est trop lourde ; les survols de la Terre, de la Lune et de Vénus lui donnent la vitesse supplémentaire nécessaire.',
        ),
      },
      {
        q: L('Do JUICE and Europa Clipper compete?', 'JUICE et Europa Clipper sont-elles concurrentes ?'),
        a: L(
          'They complement each other: Clipper focuses on Europa, JUICE on Ganymede and Callisto, and their teams share plans.',
          'Elles se complètent : Clipper se concentre sur Europe, JUICE sur Ganymède et Callisto, et leurs équipes partagent leurs plans.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'juice', follow: true, hideMissions: true },
    related: ['europa-clipper', 'juno', 'bepicolombo'],
  },
  {
    id: 'bepicolombo',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'bepicolombo',
    slug: L('where-is-bepicolombo', 'ou-est-bepicolombo'),
    question: L('Where is BepiColombo now?', 'Où est BepiColombo ?'),
    lead: L(
      'BepiColombo, a European and Japanese mission, carries two orbiters to Mercury, the planet closest to the Sun; its live position is computed below.',
      'BepiColombo, une mission européenne et japonaise, emporte deux orbiteurs vers Mercure, la planète la plus proche du Soleil ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of the ESA–JAXA BepiColombo mission to Mercury from the Earth and the Sun.',
      'Distance en direct de la mission BepiColombo (ESA–JAXA) vers Mercure, à la Terre et au Soleil.',
    ),
    intro: L(
      'BepiColombo is a joint mission of the European and Japanese space agencies to Mercury, the smallest planet and the closest to the Sun. Launched on 20 October 2018, it is made of two orbiters stacked on a transfer module with ion engines. Getting to Mercury is surprisingly hard: a probe falling towards the Sun gathers speed and must brake to be captured, so BepiColombo used one flyby of the Earth, two of Venus and six of Mercury itself. Its arrival in orbit is planned for November 2026. The two orbiters will then separate to study Mercury’s surface, its iron core and its magnetic field.',
      'BepiColombo est une mission commune des agences spatiales européenne et japonaise vers Mercure, la plus petite planète et la plus proche du Soleil. Lancée le 20 octobre 2018, elle se compose de deux orbiteurs empilés sur un module de transfert à moteurs ioniques. Aller à Mercure est étonnamment difficile : une sonde qui tombe vers le Soleil prend de la vitesse et doit freiner pour être capturée ; BepiColombo a donc utilisé un survol de la Terre, deux de Vénus et six de Mercure elle-même. Son arrivée en orbite est prévue en novembre 2026. Les deux orbiteurs se sépareront alors pour étudier la surface de Mercure, son noyau de fer et son champ magnétique.',
    ),
    faq: [
      {
        q: L('Who was Bepi Colombo?', 'Qui était Bepi Colombo ?'),
        a: L(
          'Giuseppe “Bepi” Colombo, an Italian scientist who worked out how the Mariner 10 probe could fly past Mercury several times in the 1970s.',
          'Giuseppe « Bepi » Colombo, un scientifique italien qui a trouvé comment la sonde Mariner 10 pouvait survoler Mercure plusieurs fois dans les années 1970.',
        ),
      },
      {
        q: L('Why is Mercury hard to reach?', 'Pourquoi Mercure est-elle difficile à atteindre ?'),
        a: L(
          'Falling towards the Sun speeds a probe up, and it needs a lot of braking to stay in orbit around such a small planet.',
          'Tomber vers le Soleil accélère une sonde, et il faut beaucoup freiner pour rester en orbite autour d’une si petite planète.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'bepicolombo', follow: true, hideMissions: true },
    related: ['parker', 'planets', 'juice'],
  },
  {
    id: 'psyche',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'psyche',
    slug: L('where-is-psyche', 'ou-est-psyche'),
    question: L('Where is the Psyche spacecraft?', 'Où est la sonde Psyché ?'),
    lead: L(
      'NASA’s Psyche is travelling to the metal-rich asteroid of the same name, in the main belt between Mars and Jupiter; its live position is computed below.',
      'La sonde Psyche de la NASA voyage vers l’astéroïde métallique du même nom, dans la ceinture principale entre Mars et Jupiter ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of NASA’s Psyche probe on its way to the metal-rich asteroid Psyche, from the Earth and the Sun.',
      'Distance en direct de la sonde Psyché de la NASA en route vers l’astéroïde métallique Psyché, à la Terre et au Soleil.',
    ),
    intro: L(
      'NASA’s Psyche spacecraft, launched on 13 October 2023, is flying to an unusual asteroid of the same name, about 220 km across, in the asteroid belt between Mars and Jupiter. Psyche appears to be rich in metal, and it may be part of the iron core of a small world whose rocky outer layers were stripped away by collisions billions of years ago. Studying it is a way to look at the kind of core that lies, out of reach, deep inside the Earth. The probe is pushed by electric thrusters that glow blue, very gentle but very efficient, and it used Mars’s gravity in 2026. It should reach the asteroid in 2029.',
      'La sonde Psyché de la NASA, lancée le 13 octobre 2023, se dirige vers un astéroïde inhabituel du même nom, d’environ 220 km, dans la ceinture d’astéroïdes entre Mars et Jupiter. Psyché semble riche en métal ; ce pourrait être une partie du noyau de fer d’un petit monde dont les couches rocheuses ont été arrachées par des collisions il y a des milliards d’années. L’étudier permet d’observer le genre de noyau qui se trouve, hors d’atteinte, au cœur de la Terre. La sonde est poussée par des propulseurs électriques à la lueur bleue, très doux mais très efficaces, et elle a utilisé la gravité de Mars en 2026. Elle devrait atteindre l’astéroïde en 2029.',
    ),
    faq: [
      {
        q: L('Is Psyche made of gold?', 'Psyché est-il fait d’or ?'),
        a: L(
          'Mostly iron and nickel mixed with rock, as far as we know; its supposed value in headlines is a fantasy, since nobody can bring it back.',
          'Surtout de fer et de nickel mêlés à de la roche, pour ce qu’on en sait ; sa valeur supposée dans les manchettes est une fantaisie, puisque personne ne peut le rapporter.',
        ),
      },
      {
        q: L('How do electric thrusters work?', 'Comment fonctionnent les propulseurs électriques ?'),
        a: L(
          'Solar power charges xenon gas and an electric field shoots it out at great speed; the push is as weak as the weight of a sheet of paper, but it lasts for months.',
          'L’énergie solaire charge du xénon qu’un champ électrique éjecte à grande vitesse ; la poussée est aussi faible que le poids d’une feuille de papier, mais elle dure des mois.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'psyche', follow: true, hideMissions: true },
    related: ['lucy', 'asteroids', 'mars-distance'],
  },
  {
    id: 'lucy',
    theme: 'deep',
    kind: 'spacecraft',
    target: 'lucy',
    slug: L('where-is-lucy', 'ou-est-lucy'),
    question: L('Where is the Lucy spacecraft?', 'Où est la sonde Lucy ?'),
    lead: L(
      'NASA’s Lucy is touring asteroids, including the Trojans that share Jupiter’s orbit; its live position is computed below.',
      'La sonde Lucy de la NASA visite des astéroïdes, dont les Troyens qui partagent l’orbite de Jupiter ; sa position en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of NASA’s Lucy probe on its tour of Jupiter’s Trojan asteroids, from the Earth and the Sun.',
      'Distance en direct de la sonde Lucy de la NASA dans sa tournée des astéroïdes troyens de Jupiter, à la Terre et au Soleil.',
    ),
    intro: L(
      'Lucy, launched on 16 October 2021, is the first mission to the Trojan asteroids: two swarms of small bodies that share Jupiter’s orbit, one ahead of the planet and one behind. They are leftovers from the birth of the planets, like fossils of the early solar system, which is why the mission is named after the famous fossil of a human ancestor. On the way, Lucy flew past the small asteroid Dinkinesh in 2023, discovering it has a moon, and past Donaldjohanson in 2025. It reaches the Trojans in 2027 and should visit several of them until 2033, returning to the Earth between swarms.',
      'Lucy, lancée le 16 octobre 2021, est la première mission vers les astéroïdes troyens : deux essaims de petits corps qui partagent l’orbite de Jupiter, l’un devant la planète et l’autre derrière. Ce sont des restes de la naissance des planètes, comme des fossiles du système solaire primitif ; d’où le nom de la mission, celui du célèbre fossile d’une ancêtre de l’humanité. En chemin, Lucy a survolé le petit astéroïde Dinkinesh en 2023, découvrant qu’il a une lune, puis Donaldjohanson en 2025. Elle atteint les Troyens en 2027 et devrait en visiter plusieurs jusqu’en 2033, en repassant près de la Terre entre les essaims.',
    ),
    faq: [
      {
        q: L('What are Trojan asteroids?', 'Que sont les astéroïdes troyens ?'),
        a: L(
          'Asteroids gathered at two balance points of Jupiter’s orbit, 60° ahead of and behind the planet, where the gravity of the Sun and Jupiter keeps them in place.',
          'Des astéroïdes rassemblés en deux points d’équilibre de l’orbite de Jupiter, 60° devant et derrière la planète, où la gravité du Soleil et de Jupiter les maintient.',
        ),
      },
      {
        q: L('Why is the mission called Lucy?', 'Pourquoi la mission s’appelle-t-elle Lucy ?'),
        a: L(
          'After the fossil skeleton of an early human ancestor found in Ethiopia in 1974, which taught us about our origins, as the Trojans may about the planets’.',
          'D’après le squelette fossile d’une ancêtre de l’humanité découvert en Éthiopie en 1974, qui nous a renseignés sur nos origines, comme les Troyens pourraient le faire pour celles des planètes.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'lucy', follow: true, hideMissions: true },
    related: ['psyche', 'asteroids', 'juno'],
  },
  // ------------------------------------------------------------------ the Moon
  {
    id: 'moon-phase',
    theme: 'moon',
    kind: 'moon',
    slug: L('moon-phase-today', 'phase-de-la-lune-aujourdhui'),
    question: L('What is the Moon’s phase today?', 'Quelle est la phase de la Lune aujourd’hui ?'),
    lead: L(
      'The Moon goes through its phases in about 29.5 days, from new moon to full moon and back; today’s phase and lit fraction are computed below.',
      'La Lune passe par toutes ses phases en 29,5 jours environ, de la nouvelle lune à la pleine lune et retour ; la phase du jour et la part éclairée sont calculées ci-dessous.',
    ),
    description: L(
      'Today’s Moon phase and illumination, live, with the dates of the next new moon, quarters and full moon.',
      'Phase et illumination de la Lune aujourd’hui, en direct, avec les dates des prochaines nouvelle lune, quartiers et pleine lune.',
    ),
    intro: L(
      'The Moon makes no light of its own: we see the half lit by the Sun, from an angle that changes as the Moon circles the Earth. At new moon it lies roughly between the Earth and the Sun and shows us its dark side; a week later, at first quarter, we see half of its disc lit; at full moon it is opposite the Sun and fully lit; then it wanes back. The whole cycle takes about 29.5 days. The phase is the same for everyone on Earth at the same moment, but in the Southern Hemisphere the lit side appears flipped.',
      'La Lune ne produit pas de lumière : nous voyons la moitié éclairée par le Soleil, sous un angle qui change à mesure qu’elle tourne autour de la Terre. À la nouvelle lune, elle se trouve à peu près entre la Terre et le Soleil et nous montre sa face sombre ; une semaine plus tard, au premier quartier, la moitié de son disque est éclairée ; à la pleine lune, elle est à l’opposé du Soleil et entièrement éclairée ; puis elle décroît. Le cycle complet dure environ 29,5 jours. La phase est la même pour tous au même moment, mais dans l’hémisphère Sud le côté éclairé paraît inversé.',
    ),
    faq: [
      {
        q: L('Why does the Moon have phases?', 'Pourquoi la Lune a-t-elle des phases ?'),
        a: L(
          'Half of the Moon is always lit by the Sun; as it orbits the Earth, we see more or less of that lit half.',
          'La moitié de la Lune est toujours éclairée par le Soleil ; en tournant autour de la Terre, elle nous montre une part plus ou moins grande de cette moitié.',
        ),
      },
      {
        q: L('Is the phase caused by the Earth’s shadow?', 'La phase est-elle due à l’ombre de la Terre ?'),
        a: L(
          'No. The Earth’s shadow only falls on the Moon during a lunar eclipse, at some full moons.',
          'Non. L’ombre de la Terre ne tombe sur la Lune que lors d’une éclipse de Lune, à certaines pleines lunes.',
        ),
      },
    ],
    view: { view: 'moon' },
    related: ['full-moon', 'moon-distance', 'eclipse'],
  },
  {
    id: 'moon-distance',
    theme: 'moon',
    kind: 'moon',
    focus: 'distance',
    slug: L('how-far-is-the-moon', 'distance-terre-lune'),
    question: L('How far away is the Moon right now?', 'À quelle distance est la Lune en ce moment ?'),
    lead: L(
      'The Moon’s distance from the Earth varies between about 356,000 and 407,000 km along its elliptical orbit; today’s distance is computed below.',
      'La distance de la Lune à la Terre varie entre 356 000 et 407 000 km environ le long de son orbite elliptique ; la distance du jour est calculée ci-dessous.',
    ),
    description: L(
      'Live distance between the Earth and the Moon, in kilometres and light time, with its closest and farthest points this month.',
      'Distance en direct entre la Terre et la Lune, en kilomètres et en temps de lumière, avec ses points le plus proche et le plus éloigné ce mois-ci.',
    ),
    intro: L(
      'The Moon is on average 384,400 km from the Earth, about thirty Earths lined up. Its orbit is not a perfect circle, so the distance changes every day: around 363,000 km at its closest point (perigee) and 405,000 km at its farthest (apogee). A full moon near perigee looks about 14 % larger than one near apogee, the “supermoon” of the news. Light covers the distance in about 1.3 seconds, which is why conversations with Apollo astronauts had small delays. Measured by bouncing lasers off mirrors left by Apollo crews, the Moon moves about 3.8 cm farther from the Earth every year.',
      'La Lune est en moyenne à 384 400 km de la Terre, environ trente Terres alignées. Son orbite n’est pas un cercle parfait : la distance change donc chaque jour, autour de 363 000 km au point le plus proche (périgée) et de 405 000 km au plus éloigné (apogée). Une pleine lune proche du périgée paraît environ 14 % plus grande qu’une pleine lune à l’apogée : c’est la « super lune » des actualités. La lumière franchit cette distance en 1,3 seconde environ, d’où les petits délais dans les conversations avec les astronautes d’Apollo. Mesurée par des lasers renvoyés par des miroirs laissés par les équipages d’Apollo, la Lune s’éloigne de la Terre d’environ 3,8 cm par an.',
    ),
    faq: [
      {
        q: L(
          'How long would it take to drive to the Moon?',
          'Combien de temps faudrait-il pour aller sur la Lune en voiture ?',
        ),
        a: L(
          'At 100 km/h without stopping, about five months. Apollo astronauts took about three days.',
          'À 100 km/h sans s’arrêter, environ cinq mois. Les astronautes d’Apollo mettaient environ trois jours.',
        ),
      },
      {
        q: L('Why is the Moon moving away?', 'Pourquoi la Lune s’éloigne-t-elle ?'),
        a: L(
          'The tides it raises on the Earth slow the Earth’s rotation and give the Moon a little energy, which slowly widens its orbit.',
          'Les marées qu’elle provoque sur la Terre ralentissent la rotation de la Terre et donnent un peu d’énergie à la Lune, ce qui élargit lentement son orbite.',
        ),
      },
    ],
    view: { view: 'earth', sel: 'moon', follow: true },
    related: ['moon-phase', 'moon-orbiters', 'full-moon'],
  },
  {
    id: 'moon-orbiters',
    theme: 'moon',
    kind: 'around',
    around: 'moon',
    slug: L('spacecraft-orbiting-the-moon', 'sondes-en-orbite-lunaire'),
    question: L(
      'Which spacecraft are orbiting the Moon?',
      'Quelles sondes sont en orbite autour de la Lune ?',
    ),
    lead: L(
      'Several spacecraft from the United States, India and South Korea are orbiting the Moon; the list and their live positions are below.',
      'Plusieurs engins des États-Unis, de l’Inde et de la Corée du Sud tournent autour de la Lune ; la liste et leurs positions en direct sont ci-dessous.',
    ),
    description: L(
      'The active spacecraft around the Moon right now, LRO, Chandrayaan-2, Danuri and others, with their positions in a live 3D view.',
      'Les sondes actives autour de la Lune en ce moment, LRO, Chandrayaan-2, Danuri et d’autres, avec leurs positions dans une vue 3D en direct.',
    ),
    intro: L(
      'Several spacecraft from different countries orbit the Moon. NASA’s Lunar Reconnaissance Orbiter has mapped it in detail since 2009, spotting the Apollo landing sites and the tracks left by astronauts. India’s Chandrayaan-2 orbiter and South Korea’s Danuri photograph the surface and look for water ice in craters that never see the Sun. NASA’s two ARTEMIS probes study the space environment, and China relies on relay satellites to talk with landers on the far side, which never faces the Earth. Some of these orbits pass low over the poles; others swing far out. The 3D view shows the spacecraft whose trajectories JPL Horizons publishes.',
      'Plusieurs sondes de différents pays tournent autour de la Lune. Le Lunar Reconnaissance Orbiter de la NASA la cartographie en détail depuis 2009 ; il a repéré les sites d’alunissage d’Apollo et les traces laissées par les astronautes. L’orbiteur indien de Chandrayaan-2 et la sonde sud-coréenne Danuri photographient la surface et cherchent de la glace d’eau dans des cratères que le Soleil n’éclaire jamais. Les deux sondes ARTEMIS de la NASA étudient l’environnement spatial, et la Chine utilise des satellites relais pour communiquer avec ses atterrisseurs de la face cachée, qui n’est jamais tournée vers la Terre. Certaines orbites passent bas au-dessus des pôles ; d’autres s’éloignent beaucoup. La vue 3D montre les sondes dont JPL Horizons publie les trajectoires.',
    ),
    faq: [
      {
        q: L(
          'Why are there relay satellites for the Moon?',
          'Pourquoi y a-t-il des satellites relais pour la Lune ?',
        ),
        a: L(
          'The far side of the Moon never faces the Earth, so a lander there needs a satellite that sees both it and the Earth to pass its messages.',
          'La face cachée de la Lune n’est jamais tournée vers la Terre ; un atterrisseur qui s’y trouve a besoin d’un satellite qui voit à la fois lui et la Terre pour transmettre ses messages.',
        ),
      },
      {
        q: L(
          'Why are some lunar missions missing from the 3D view?',
          'Pourquoi certaines missions lunaires manquent-elles à la vue 3D ?',
        ),
        a: L(
          'Perigee only draws spacecraft whose trajectory is published; the others are listed without a position.',
          'Périgée ne dessine que les sondes dont la trajectoire est publiée ; les autres sont listées sans position.',
        ),
      },
    ],
    view: { view: 'moon' },
    related: ['apollo-sites', 'mars-orbiters', 'moon-distance'],
  },
  {
    id: 'apollo-sites',
    theme: 'moon',
    kind: 'sites',
    targets: [
      'site:apollo-11',
      'site:apollo-12',
      'site:apollo-14',
      'site:apollo-15',
      'site:apollo-16',
      'site:apollo-17',
    ],
    slug: L('apollo-landing-sites', 'sites-alunissage-apollo'),
    question: L(
      'Where did the Apollo missions land on the Moon?',
      'Où les missions Apollo se sont-elles posées sur la Lune ?',
    ),
    lead: L(
      'Six Apollo missions landed astronauts on the Moon between 1969 and 1972; their landing sites are shown below on the Moon as it turns now.',
      'Six missions Apollo ont posé des astronautes sur la Lune entre 1969 et 1972 ; leurs sites d’alunissage sont montrés ci-dessous sur la Lune telle qu’elle tourne en ce moment.',
    ),
    description: L(
      'The six Apollo landing sites on the Moon, with their coordinates, dates and photos, in a 3D view of the Moon.',
      'Les six sites d’alunissage d’Apollo sur la Lune, avec leurs coordonnées, leurs dates et leurs photos, dans une vue 3D de la Lune.',
    ),
    intro: L(
      'Between July 1969 and December 1972, six Apollo missions landed on the Moon and twelve astronauts walked on its surface. All the landings were on the side that faces the Earth, so that the crews could talk with Mission Control directly. The first sites were flat, safe plains; later missions, with more experience and the lunar rover, went to hills, valleys and mountains chosen by geologists. Apollo 13, in 1970, never landed after an explosion on the way. The sites are still there: the Lunar Reconnaissance Orbiter has photographed the descent stages, the rovers and the astronauts’ footpaths from orbit.',
      'Entre juillet 1969 et décembre 1972, six missions Apollo se sont posées sur la Lune et douze astronautes ont marché à sa surface. Tous les alunissages ont eu lieu sur la face tournée vers la Terre, pour que les équipages puissent parler directement avec le centre de contrôle. Les premiers sites étaient des plaines plates et sûres ; les missions suivantes, avec plus d’expérience et la jeep lunaire, sont allées vers des collines, des vallées et des montagnes choisies par des géologues. Apollo 13, en 1970, ne s’est jamais posée après une explosion en route. Les sites sont toujours là : le Lunar Reconnaissance Orbiter a photographié depuis l’orbite les étages de descente, les jeeps et les sentiers des astronautes.',
    ),
    faq: [
      {
        q: L('Can a telescope see the Apollo sites?', 'Un télescope peut-il voir les sites Apollo ?'),
        a: L(
          'No telescope on Earth can: the objects left there are far too small at that distance. Only spacecraft orbiting the Moon have photographed them.',
          'Aucun télescope terrestre ne le peut : les objets laissés là-bas sont bien trop petits à cette distance. Seules des sondes en orbite lunaire les ont photographiés.',
        ),
      },
      {
        q: L('How many people have walked on the Moon?', 'Combien de personnes ont marché sur la Lune ?'),
        a: L(
          'Twelve, all American astronauts, between 1969 and 1972.',
          'Douze, tous des astronautes américains, entre 1969 et 1972.',
        ),
      },
    ],
    view: { view: 'moon', sel: 'site:apollo-15', params: { sites: 'crewed' }, hideMissions: true },
    related: ['apollo-11', 'moon-orbiters', 'moon-phase'],
  },
  {
    id: 'apollo-11',
    theme: 'moon',
    kind: 'site',
    target: 'site:apollo-11',
    slug: L('where-did-apollo-11-land', 'ou-apollo-11-sest-pose'),
    question: L('Where did Apollo 11 land on the Moon?', 'Où Apollo 11 s’est-elle posée sur la Lune ?'),
    lead: L(
      'Apollo 11 landed on 20 July 1969 in the Sea of Tranquillity, on the side of the Moon that always faces the Earth; the site is shown below.',
      'Apollo 11 s’est posé le 20 juillet 1969 dans la mer de la Tranquillité, sur la face de la Lune toujours tournée vers la Terre ; le site est montré ci-dessous.',
    ),
    description: L(
      'The Apollo 11 landing site in the Sea of Tranquillity: coordinates, photo and a 3D view of the place on the Moon.',
      'Le site d’alunissage d’Apollo 11 dans la mer de la Tranquillité : coordonnées, photo et vue 3D de l’endroit sur la Lune.',
    ),
    intro: L(
      'On 20 July 1969, the lunar module Eagle landed in the Sea of Tranquillity, a dark, flat plain of old lava near the Moon’s equator. Neil Armstrong and Buzz Aldrin spent about two and a half hours walking outside, collecting 21.5 kg of rocks and setting up experiments, while Michael Collins circled overhead in the command module Columbia. The plain had been chosen because it was smooth and lit by a low morning Sun, but Armstrong had to steer past a field of boulders by hand and landed with less than a minute of fuel to spare. One of their instruments, a mirror for laser beams sent from the Earth, still works today.',
      'Le 20 juillet 1969, le module lunaire Eagle s’est posé dans la mer de la Tranquillité, une plaine sombre et plate de lave ancienne près de l’équateur lunaire. Neil Armstrong et Buzz Aldrin ont passé environ deux heures et demie à l’extérieur, à récolter 21,5 kg de roches et à installer des expériences, pendant que Michael Collins tournait au-dessus dans le module de commande Columbia. La plaine avait été choisie parce qu’elle était lisse et éclairée par un Soleil matinal bas, mais Armstrong a dû piloter à la main pour éviter un champ de rochers et s’est posé avec moins d’une minute de carburant en réserve. L’un de leurs instruments, un miroir pour les faisceaux laser envoyés depuis la Terre, fonctionne encore aujourd’hui.',
    ),
    faq: [
      {
        q: L('Is the American flag still standing?', 'Le drapeau américain est-il toujours debout ?'),
        a: L(
          'Probably not: Aldrin saw it knocked over by the engine’s blast at lift-off, and decades of harsh sunlight have likely bleached it.',
          'Probablement pas : Aldrin l’a vu renversé par le souffle du moteur au décollage, et des décennies de soleil intense l’ont sans doute décoloré.',
        ),
      },
      {
        q: L('Can I see the Sea of Tranquillity?', 'Puis-je voir la mer de la Tranquillité ?'),
        a: L(
          'Yes, with the naked eye: it is one of the dark patches on the Moon’s face, on the right side seen from the Northern Hemisphere.',
          'Oui, à l’œil nu : c’est l’une des taches sombres du visage de la Lune, du côté droit vue de l’hémisphère Nord.',
        ),
      },
    ],
    view: { view: 'moon', sel: 'site:apollo-11', hideMissions: true },
    related: ['apollo-sites', 'moon-phase', 'moon-orbiters'],
  },
  // ------------------------------------------------------------------ Mars
  {
    id: 'mars-orbiters',
    theme: 'mars',
    kind: 'around',
    around: 'mars',
    slug: L('spacecraft-orbiting-mars', 'sondes-en-orbite-autour-de-mars'),
    question: L('Which spacecraft are orbiting Mars?', 'Quelles sondes sont en orbite autour de Mars ?'),
    lead: L(
      'Spacecraft from the United States, Europe, the United Arab Emirates and China are orbiting Mars; the list and their live positions are below.',
      'Des engins des États-Unis, de l’Europe, des Émirats arabes unis et de la Chine tournent autour de Mars ; la liste et leurs positions en direct sont ci-dessous.',
    ),
    description: L(
      'The active spacecraft around Mars right now, Mars Odyssey, Mars Express, MRO, TGO, Hope and others, in a live 3D view.',
      'Les sondes actives autour de Mars en ce moment, Mars Odyssey, Mars Express, MRO, TGO, Hope et d’autres, dans une vue 3D en direct.',
    ),
    intro: L(
      'Mars has more working spacecraft around it than any planet except the Earth. NASA’s Mars Odyssey, in orbit since 2001, is the longest-serving; Europe’s Mars Express arrived in 2003 and NASA’s Mars Reconnaissance Orbiter in 2006, with a camera that can spot a rover from orbit. The ExoMars Trace Gas Orbiter sniffs the atmosphere for gases such as methane, the United Arab Emirates’ Hope watches the Martian weather from high up, and China’s Tianwen-1 orbiter supported its rover. Besides their own science, several of them relay the data of the rovers on the ground to the Earth. Their positions in the 3D view come from JPL Horizons.',
      'Mars compte plus de sondes en service autour d’elle que toute autre planète, la Terre exceptée. Mars Odyssey (NASA), en orbite depuis 2001, est la doyenne ; Mars Express (Europe) est arrivée en 2003 et le Mars Reconnaissance Orbiter de la NASA en 2006, avec une caméra capable de repérer un rover depuis l’orbite. L’orbiteur ExoMars TGO analyse l’atmosphère à la recherche de gaz comme le méthane, la sonde émiratie Hope suit la météo martienne de haut, et l’orbiteur chinois de Tianwen-1 a soutenu son rover. En plus de leur propre science, plusieurs relaient vers la Terre les données des rovers au sol. Leurs positions dans la vue 3D viennent de JPL Horizons.',
    ),
    faq: [
      {
        q: L(
          'How do rovers send data from Mars?',
          'Comment les rovers envoient-ils leurs données depuis Mars ?',
        ),
        a: L(
          'Mostly through orbiters passing overhead, which receive the data at close range and resend it to the Earth with bigger antennas.',
          'Surtout par les orbiteurs qui passent au-dessus d’eux : ils reçoivent les données de près et les renvoient vers la Terre avec de plus grandes antennes.',
        ),
      },
      {
        q: L('How long does a signal take from Mars?', 'Combien de temps met un signal depuis Mars ?'),
        a: L(
          'Between about 3 and 22 minutes, depending on where the Earth and Mars are in their orbits.',
          'Entre 3 et 22 minutes environ, selon les positions de la Terre et de Mars sur leurs orbites.',
        ),
      },
    ],
    view: { view: 'mars' },
    related: ['perseverance', 'curiosity', 'mars-distance'],
  },
  {
    id: 'perseverance',
    theme: 'mars',
    kind: 'site',
    target: 'site:perseverance-current',
    slug: L('where-is-perseverance', 'ou-est-perseverance'),
    question: L('Where is the Perseverance rover on Mars?', 'Où est le rover Perseverance sur Mars ?'),
    lead: L(
      'NASA’s Perseverance rover has been exploring Jezero crater on Mars since 2021; its last reported position is shown below.',
      'Le rover Perseverance de la NASA explore le cratère Jezero sur Mars depuis 2021 ; sa dernière position publiée est montrée ci-dessous.',
    ),
    description: L(
      'The latest position of NASA’s Perseverance rover in Jezero crater, from NASA’s traverse map, with a 3D view of Mars.',
      'La dernière position du rover Perseverance de la NASA dans le cratère Jezero, d’après la carte de trajet de la NASA, avec une vue 3D de Mars.',
    ),
    intro: L(
      'Perseverance landed in Jezero crater on 18 February 2021. Billions of years ago, a river flowed into this crater and built a delta in a lake, the kind of place where traces of ancient microbial life could be preserved. The car-sized rover drills rock cores and seals them in tubes for a future mission to bring back to the Earth; it carried the small helicopter Ingenuity, the first aircraft to fly on another world. It has since climbed out of the crater onto its rim. The position here is the latest one published by NASA from the rover’s driving logs, so it can lag a few days behind.',
      'Perseverance s’est posé dans le cratère Jezero le 18 février 2021. Il y a des milliards d’années, une rivière se jetait dans ce cratère et y formait un delta dans un lac, le genre d’endroit où des traces de vie microbienne ancienne pourraient s’être conservées. Le rover, de la taille d’une voiture, prélève des carottes de roche et les scelle dans des tubes pour qu’une future mission les rapporte sur Terre ; il transportait le petit hélicoptère Ingenuity, premier aéronef à voler sur un autre monde. Il est depuis sorti du cratère et grimpe sur son rebord. La position indiquée est la dernière publiée par la NASA d’après le journal de route du rover ; elle peut avoir quelques jours de retard.',
    ),
    faq: [
      {
        q: L('How fast does Perseverance drive?', 'À quelle vitesse roule Perseverance ?'),
        a: L(
          'Its top speed is about 150 m per hour, and it usually drives a few hundred metres on a good day, often steering itself.',
          'Sa vitesse maximale est d’environ 150 m à l’heure, et il roule d’habitude quelques centaines de mètres les bons jours, souvent en se guidant seul.',
        ),
      },
      {
        q: L('Has Perseverance found life?', 'Perseverance a-t-il trouvé de la vie ?'),
        a: L(
          'Not so far. It has found rocks that formed in water and features that could be signs of past life, but only studying the samples on Earth could tell.',
          'Pas jusqu’ici. Il a trouvé des roches formées dans l’eau et des structures qui pourraient être des signes de vie passée, mais seule l’étude des échantillons sur Terre pourrait le dire.',
        ),
      },
    ],
    view: { view: 'mars', sel: 'site:perseverance-current', hideMissions: true },
    related: ['curiosity', 'mars-orbiters', 'mars-distance'],
  },
  {
    id: 'curiosity',
    theme: 'mars',
    kind: 'site',
    target: 'site:curiosity-current',
    slug: L('where-is-curiosity', 'ou-est-curiosity'),
    question: L('Where is the Curiosity rover on Mars?', 'Où est le rover Curiosity sur Mars ?'),
    lead: L(
      'NASA’s Curiosity rover has been climbing Mount Sharp in Gale crater on Mars since 2012; its last reported position is shown below.',
      'Le rover Curiosity de la NASA gravit le mont Sharp dans le cratère Gale sur Mars depuis 2012 ; sa dernière position publiée est montrée ci-dessous.',
    ),
    description: L(
      'The latest position of NASA’s Curiosity rover on Mount Sharp in Gale crater, from NASA’s traverse map, with a 3D view of Mars.',
      'La dernière position du rover Curiosity de la NASA sur le mont Sharp dans le cratère Gale, d’après la carte de trajet de la NASA, avec une vue 3D de Mars.',
    ),
    intro: L(
      'Curiosity landed in Gale crater on 6 August 2012, lowered on cables by a hovering “sky crane”. Within months it found that the crater once held a lake whose water could have supported microbes. Since then the rover has been climbing Mount Sharp, a 5 km high mountain of layered rock in the middle of the crater: each layer is a page in the history of Mars’s climate, from wet to dry. Curiosity runs on the heat of decaying plutonium, like the Voyager probes, which lets it work through dusty seasons. The position here is the latest one NASA published from the rover’s driving logs.',
      'Curiosity s’est posé dans le cratère Gale le 6 août 2012, descendu au bout de câbles par une « grue volante ». En quelques mois, il a découvert que le cratère avait abrité un lac dont l’eau aurait pu convenir à des microbes. Depuis, le rover gravit le mont Sharp, une montagne de roches en couches haute de 5 km au milieu du cratère : chaque couche est une page de l’histoire du climat de Mars, de l’humide au sec. Curiosity fonctionne grâce à la chaleur du plutonium, comme les sondes Voyager, ce qui lui permet de travailler pendant les saisons poussiéreuses. La position indiquée est la dernière publiée par la NASA d’après le journal de route du rover.',
    ),
    faq: [
      {
        q: L('How long has Curiosity been working?', 'Depuis combien de temps Curiosity fonctionne-t-il ?'),
        a: L(
          'Since August 2012, more than six times its planned two-year mission.',
          'Depuis août 2012, plus de six fois sa mission prévue de deux ans.',
        ),
      },
      {
        q: L('Why climb Mount Sharp?', 'Pourquoi gravir le mont Sharp ?'),
        a: L(
          'Its layers were laid down over millions of years; climbing them is like reading Mars’s climate history from older to younger rocks.',
          'Ses couches se sont déposées sur des millions d’années ; les gravir revient à lire l’histoire du climat de Mars, des roches les plus anciennes aux plus récentes.',
        ),
      },
    ],
    view: { view: 'mars', sel: 'site:curiosity-current', hideMissions: true },
    related: ['perseverance', 'mars-orbiters', 'mars-distance'],
  },
  {
    id: 'mars-distance',
    theme: 'mars',
    kind: 'planet',
    target: 'mars',
    focus: 'distance',
    slug: L('how-far-is-mars', 'distance-terre-mars'),
    question: L(
      'How far is Mars from the Earth right now?',
      'À quelle distance est Mars de la Terre en ce moment ?',
    ),
    lead: L(
      'The distance between the Earth and Mars changes from about 55 to 400 million km as both planets go around the Sun; today’s distance is computed below.',
      'La distance entre la Terre et Mars varie d’environ 55 à 400 millions de km au fil de la course des deux planètes autour du Soleil ; la distance du jour est calculée ci-dessous.',
    ),
    description: L(
      'Live distance between the Earth and Mars in kilometres and light time, and why it changes from 55 to 400 million km.',
      'Distance en direct entre la Terre et Mars, en kilomètres et en temps de lumière, et pourquoi elle varie de 55 à 400 millions de km.',
    ),
    intro: L(
      'The Earth and Mars both orbit the Sun, the Earth faster, on the inside track. Every 26 months or so the Earth overtakes Mars: the two planets are then on the same side of the Sun and Mars is at its closest and brightest in our night sky, an event called opposition. At best, the distance falls to about 55 million km; when Mars is on the far side of the Sun, it grows to about 400 million km. That is why missions to Mars leave in launch windows about every two years. A radio signal, travelling at the speed of light, takes from about 3 to 22 minutes to make the trip, so rovers cannot be steered live with a joystick.',
      'La Terre et Mars tournent toutes deux autour du Soleil, la Terre plus vite, sur la piste intérieure. Tous les 26 mois environ, la Terre dépasse Mars : les deux planètes sont alors du même côté du Soleil, et Mars est au plus près et au plus brillant dans notre ciel nocturne, ce qu’on appelle une opposition. Au mieux, la distance tombe à environ 55 millions de km ; quand Mars est de l’autre côté du Soleil, elle atteint environ 400 millions de km. C’est pourquoi les missions vers Mars partent lors de fenêtres de lancement environ tous les deux ans. Un signal radio, qui voyage à la vitesse de la lumière, met de 3 à 22 minutes environ pour faire le trajet : on ne peut pas piloter un rover en direct avec une manette.',
    ),
    faq: [
      {
        q: L('How long does it take to travel to Mars?', 'Combien de temps faut-il pour aller sur Mars ?'),
        a: L(
          'About seven months for today’s probes, which follow a curved path around the Sun rather than a straight line.',
          'Environ sept mois pour les sondes actuelles, qui suivent une trajectoire courbe autour du Soleil plutôt qu’une ligne droite.',
        ),
      },
      {
        q: L('When is Mars closest to the Earth?', 'Quand Mars est-elle au plus près de la Terre ?'),
        a: L(
          'Around its oppositions, about every 26 months; the next one is in February 2027.',
          'Autour de ses oppositions, environ tous les 26 mois ; la prochaine a lieu en février 2027.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'mars', follow: true, hideMissions: true },
    related: ['mars-orbiters', 'perseverance', 'planets'],
  },
  // ------------------------------------------------------------------ the solar system
  {
    id: 'planets',
    theme: 'solar',
    kind: 'bodies',
    bodySet: 'planets',
    slug: L('where-are-the-planets-now', 'ou-sont-les-planetes'),
    question: L('Where are the planets right now?', 'Où sont les planètes en ce moment ?'),
    lead: L(
      'The eight planets go around the Sun at very different speeds, from 88 days for Mercury to 165 years for Neptune; where they are today is computed below.',
      'Les huit planètes tournent autour du Soleil à des rythmes très différents, de 88 jours pour Mercure à 165 ans pour Neptune ; leur position du jour est calculée ci-dessous.',
    ),
    description: L(
      'Live positions of the eight planets around the Sun, with their distances from the Sun and from the Earth, in a 3D solar system.',
      'Positions en direct des huit planètes autour du Soleil, avec leurs distances au Soleil et à la Terre, dans un système solaire en 3D.',
    ),
    intro: L(
      'The eight planets all go around the Sun in the same direction and in nearly the same plane, but at very different speeds: Mercury takes 88 days, the Earth a year and Neptune 165 years. So their arrangement is always changing, and the planets are rarely lined up. The table below gives, for this very moment, each planet’s distance from the Sun and from the Earth, computed with the same models astronomers use for their ephemerides. In the 3D view the planets are drawn much larger than they really are; at true scale, they would be invisible dots around a tiny Sun.',
      'Les huit planètes tournent toutes autour du Soleil dans le même sens et presque dans le même plan, mais à des vitesses très différentes : Mercure met 88 jours, la Terre un an et Neptune 165 ans. Leur disposition change donc sans cesse, et les planètes sont rarement alignées. Le tableau donne, pour cet instant précis, la distance de chaque planète au Soleil et à la Terre, calculée avec les mêmes modèles que ceux des éphémérides des astronomes. Dans la vue 3D, les planètes sont dessinées bien plus grosses qu’en réalité ; à l’échelle, ce seraient des points invisibles autour d’un minuscule Soleil.',
    ),
    faq: [
      {
        q: L('Which planet is closest to the Earth?', 'Quelle planète est la plus proche de la Terre ?'),
        a: L(
          'It changes: Venus comes closest of all, but on average Mercury is the nearest, since it never strays far from the Sun. The table shows today’s answer.',
          'Cela change : c’est Vénus qui s’approche le plus, mais en moyenne Mercure est la plus proche, car elle ne s’éloigne jamais du Soleil. Le tableau donne la réponse d’aujourd’hui.',
        ),
      },
      {
        q: L('Do the planets ever line up?', 'Les planètes s’alignent-elles parfois ?'),
        a: L(
          'Several can appear on the same side of the Sun, but never in a straight line, because their orbits are slightly tilted to one another.',
          'Plusieurs peuvent se trouver du même côté du Soleil, mais jamais sur une ligne droite, car leurs orbites sont légèrement inclinées les unes par rapport aux autres.',
        ),
      },
    ],
    view: { view: 'solar', hideMissions: true },
    related: ['planets-tonight', 'dwarf-planets', 'mars-distance'],
  },
  {
    id: 'dwarf-planets',
    theme: 'solar',
    kind: 'bodies',
    bodySet: 'dwarfs',
    slug: L('where-are-the-dwarf-planets', 'ou-sont-les-planetes-naines'),
    question: L('Where are the dwarf planets?', 'Où sont les planètes naines ?'),
    lead: L(
      'Ceres orbits in the asteroid belt; Pluto, Haumea, Makemake and Eris lie far beyond Neptune; where they are today is computed below.',
      'Cérès tourne dans la ceinture d’astéroïdes ; Pluton, Hauméa, Makémaké et Éris se trouvent bien au-delà de Neptune ; leur position du jour est calculée ci-dessous.',
    ),
    description: L(
      'Live positions of Pluto, Ceres, Eris, Haumea, Makemake and the dwarf planet candidates, with their distances from the Sun.',
      'Positions en direct de Pluton, Cérès, Éris, Hauméa, Makémaké et des candidates planètes naines, avec leurs distances au Soleil.',
    ),
    intro: L(
      'A dwarf planet orbits the Sun and is massive enough to be pulled into a round shape, but it has not cleared its path of other bodies, unlike the eight planets. The International Astronomical Union recognises five: Ceres in the asteroid belt, and Pluto, Haumea, Makemake and Eris beyond Neptune. Several other large, distant bodies, such as Gonggong, Quaoar, Orcus and Sedna, are probably dwarf planets too, but their shape and size are harder to measure; in October 2026 the Rubin Observatory announced a new candidate, 2026 ED138. The table lists them with their current distance from the Sun.',
      'Une planète naine tourne autour du Soleil et a assez de masse pour avoir pris une forme ronde, mais contrairement aux huit planètes, elle n’a pas fait le ménage sur son orbite. L’Union astronomique internationale en reconnaît cinq : Cérès, dans la ceinture d’astéroïdes, et Pluton, Hauméa, Makémaké et Éris, au-delà de Neptune. Plusieurs autres grands corps lointains, comme Gonggong, Quaoar, Orcus et Sedna, sont sans doute aussi des planètes naines, mais leur forme et leur taille sont plus difficiles à mesurer ; en octobre 2026, l’observatoire Rubin a annoncé une nouvelle candidate, 2026 ED138. Le tableau les liste avec leur distance actuelle au Soleil.',
    ),
    faq: [
      {
        q: L('Why is Pluto no longer a planet?', 'Pourquoi Pluton n’est-elle plus une planète ?'),
        a: L(
          'In 2006, after the discovery of Eris, about as large, astronomers defined “planet”: Pluto shares its zone with many Kuiper Belt objects, so it became a dwarf planet.',
          'En 2006, après la découverte d’Éris, presque aussi grande, les astronomes ont défini le mot « planète » : Pluton partage sa zone avec de nombreux objets de la ceinture de Kuiper ; elle est donc devenue une planète naine.',
        ),
      },
      {
        q: L('How many dwarf planets are there?', 'Combien y a-t-il de planètes naines ?'),
        a: L(
          'Five are officially recognised; astronomers think there may be dozens, even hundreds, in the far reaches of the solar system.',
          'Cinq sont officiellement reconnues ; les astronomes pensent qu’il pourrait y en avoir des dizaines, voire des centaines, aux confins du système solaire.',
        ),
      },
    ],
    view: { view: 'solar', params: { candidates: '1' }, hideMissions: true },
    related: ['pluto', 'asteroids', 'new-horizons'],
  },
  {
    id: 'comets',
    theme: 'solar',
    kind: 'bodies',
    bodySet: 'comets',
    slug: L('comets-visible-now', 'cometes-visibles-en-ce-moment'),
    question: L('Which comets can I see right now?', 'Quelles comètes peut-on voir en ce moment ?'),
    lead: L(
      'Most comets are too faint for the naked eye; the table below estimates the brightness of well-known comets and current telescope targets from their live distances.',
      'La plupart des comètes sont trop faibles pour l’œil nu ; le tableau ci-dessous estime l’éclat de comètes connues et de cibles actuelles des télescopes d’après leurs distances en direct.',
    ),
    description: L(
      'Live list of well-known and currently observed comets with their estimated brightness and distances from the Sun and the Earth.',
      'Liste en direct de comètes célèbres et actuellement observées, avec leur éclat estimé et leurs distances au Soleil et à la Terre.',
    ),
    intro: L(
      'A comet is a lump of ice and dust a few kilometres across, left over from the birth of the solar system. Far from the Sun it is dark and frozen; as it comes closer, the heat turns its ice into gas that carries dust away, forming a glowing head and tails that can stretch for millions of kilometres. The list below gives, for each comet Perigee follows, an estimated magnitude: the smaller the number, the brighter it is, and only comets below about magnitude 6 can be seen with the naked eye under a dark sky. Comets are famously unpredictable, so these estimates are a guide, not a promise.',
      'Une comète est un bloc de glace et de poussière de quelques kilomètres, vestige de la naissance du système solaire. Loin du Soleil, elle est sombre et gelée ; en s’approchant, la chaleur transforme sa glace en gaz qui emporte de la poussière, formant une tête lumineuse et des queues qui peuvent s’étendre sur des millions de kilomètres. La liste donne, pour chaque comète que suit Périgée, une magnitude estimée : plus le nombre est petit, plus elle est brillante, et seules les comètes sous la magnitude 6 environ sont visibles à l’œil nu dans un ciel bien noir. Les comètes sont réputées imprévisibles : ces estimations sont un guide, pas une promesse.',
    ),
    faq: [
      {
        q: L('Why does a comet have two tails?', 'Pourquoi une comète a-t-elle deux queues ?'),
        a: L(
          'The gas tail, often bluish, is pushed straight away from the Sun by the solar wind; the dust tail, yellowish and curved, lags behind along the comet’s path.',
          'La queue de gaz, souvent bleutée, est poussée à l’opposé du Soleil par le vent solaire ; la queue de poussière, jaunâtre et courbée, traîne derrière le long de la trajectoire.',
        ),
      },
      {
        q: L('When will Halley’s Comet return?', 'Quand la comète de Halley reviendra-t-elle ?'),
        a: L(
          'In 2061; it comes back about every 76 years and was last seen in 1986.',
          'En 2061 ; elle revient environ tous les 76 ans et a été vue pour la dernière fois en 1986.',
        ),
      },
    ],
    view: { view: 'solar', params: { comets: '1' }, hideMissions: true },
    related: ['asteroids', 'planets', 'sky-tonight'],
  },
  {
    id: 'asteroids',
    theme: 'solar',
    kind: 'bodies',
    bodySet: 'asteroids',
    slug: L('notable-asteroids', 'asteroides-remarquables'),
    question: L(
      'Where are the largest and most famous asteroids?',
      'Où sont les astéroïdes les plus grands et les plus célèbres ?',
    ),
    lead: L(
      'The largest asteroids and those visited by spacecraft orbit mostly in the main belt between Mars and Jupiter; where they are today is computed below.',
      'Les plus grands astéroïdes et ceux visités par des sondes tournent surtout dans la ceinture principale, entre Mars et Jupiter ; leur position du jour est calculée ci-dessous.',
    ),
    description: L(
      'Live positions of notable asteroids, Vesta, Pallas, Bennu, Eros and others, with their size and distances from the Sun and the Earth.',
      'Positions en direct d’astéroïdes remarquables, Vesta, Pallas, Bennu, Éros et d’autres, avec leur taille et leurs distances au Soleil et à la Terre.',
    ),
    intro: L(
      'Asteroids are rocky or metallic bodies left over from the formation of the planets. Most orbit in the main belt between Mars and Jupiter, where Jupiter’s gravity kept them from gathering into a planet; others, the near-Earth asteroids, cross the inner solar system, and the Trojans share Jupiter’s orbit. This page follows the largest ones, more than 250 km across, and those visited by spacecraft, such as Vesta and Ceres (Dawn), Bennu (OSIRIS-REx), Ryugu (Hayabusa2) or Dimorphos, which NASA’s DART deliberately struck in 2022 to test how to deflect an asteroid. Their positions come from JPL Horizons.',
      'Les astéroïdes sont des corps rocheux ou métalliques, restes de la formation des planètes. La plupart tournent dans la ceinture principale entre Mars et Jupiter, où la gravité de Jupiter les a empêchés de s’assembler en planète ; d’autres, les géocroiseurs, traversent le système solaire intérieur, et les Troyens partagent l’orbite de Jupiter. Cette page suit les plus grands, de plus de 250 km, et ceux que des sondes ont visités, comme Vesta et Cérès (Dawn), Bennu (OSIRIS-REx), Ryugu (Hayabusa2) ou Dimorphos, que la sonde DART de la NASA a percuté exprès en 2022 pour tester comment dévier un astéroïde. Leurs positions viennent de JPL Horizons.',
    ),
    faq: [
      {
        q: L('Could an asteroid hit the Earth?', 'Un astéroïde pourrait-il frapper la Terre ?'),
        a: L(
          'Small ones hit every day and burn up as shooting stars. Astronomers track the larger near-Earth asteroids, and none known is on course to hit us in the next century.',
          'De petits astéroïdes tombent chaque jour et se consument en étoiles filantes. Les astronomes suivent les géocroiseurs plus gros, et aucun de ceux connus ne doit nous frapper au cours du prochain siècle.',
        ),
      },
      {
        q: L('What is the largest asteroid?', 'Quel est le plus gros astéroïde ?'),
        a: L(
          'Ceres, about 940 km across, is so large it counts as a dwarf planet; among the others, Vesta and Pallas are the largest, a little over 500 km.',
          'Cérès, environ 940 km, est si grande qu’elle compte comme planète naine ; parmi les autres, Vesta et Pallas sont les plus grands, un peu plus de 500 km.',
        ),
      },
    ],
    view: { view: 'solar', params: { asteroids: '1' }, hideMissions: true },
    related: ['dwarf-planets', 'comets', 'psyche'],
  },
  {
    id: 'pluto',
    theme: 'solar',
    kind: 'planet',
    target: 'pluto',
    slug: L('where-is-pluto', 'ou-est-pluton'),
    question: L('Where is Pluto now?', 'Où est Pluton ?'),
    lead: L(
      'Pluto, a dwarf planet beyond Neptune, takes about 248 years to go around the Sun; its live distance is computed below.',
      'Pluton, une planète naine au-delà de Neptune, met environ 248 ans à faire le tour du Soleil ; sa distance en direct est calculée ci-dessous.',
    ),
    description: L(
      'Live distance of the dwarf planet Pluto from the Sun and the Earth, and how long its light takes to reach us.',
      'Distance en direct de la planète naine Pluton au Soleil et à la Terre, et le temps que met sa lumière pour nous parvenir.',
    ),
    intro: L(
      'Pluto, discovered in 1930 by Clyde Tombaugh, takes 248 years to go around the Sun on a stretched, tilted orbit: between about 30 and 49 times the Earth’s distance from the Sun, sometimes even closer than Neptune. It is smaller than our Moon, about 2,377 km across, and has five moons, the largest of which, Charon, is half its size. In 2015 the New Horizons probe revealed a heart-shaped plain of nitrogen ice, mountains of water ice and a hazy blue atmosphere. Sunlight takes several hours to reach it; at noon on Pluto the Sun is about a thousand times fainter than on Earth, yet still hundreds of times brighter than our full moon.',
      'Pluton, découverte en 1930 par Clyde Tombaugh, met 248 ans à faire le tour du Soleil sur une orbite étirée et inclinée : entre 30 et 49 fois environ la distance Terre–Soleil, parfois même plus près que Neptune. Elle est plus petite que notre Lune, environ 2 377 km de diamètre, et compte cinq lunes, dont la plus grande, Charon, fait la moitié de sa taille. En 2015, la sonde New Horizons a révélé une plaine de glace d’azote en forme de cœur, des montagnes de glace d’eau et une atmosphère brumeuse bleutée. La lumière du Soleil met plusieurs heures à l’atteindre ; à midi sur Pluton, le Soleil est environ mille fois plus faible que sur Terre, mais encore des centaines de fois plus brillant que notre pleine lune.',
    ),
    faq: [
      {
        q: L('Can I see Pluto with a telescope?', 'Peut-on voir Pluton au télescope ?'),
        a: L(
          'Only with a fairly large amateur telescope, as a faint point that looks like a star and moves a little from night to night.',
          'Seulement avec un assez gros télescope d’amateur, comme un point faible qui ressemble à une étoile et se déplace un peu d’une nuit à l’autre.',
        ),
      },
      {
        q: L('Is Pluto closer than Neptune sometimes?', 'Pluton est-elle parfois plus proche que Neptune ?'),
        a: L(
          'Yes, for about 20 years of each orbit; it was last the case from 1979 to 1999. Their orbits never cross in space, so they cannot collide.',
          'Oui, pendant une vingtaine d’années à chaque orbite ; ce fut le cas de 1979 à 1999. Leurs orbites ne se croisent pas dans l’espace : elles ne peuvent pas entrer en collision.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'pluto', follow: true, hideMissions: true },
    related: ['dwarf-planets', 'new-horizons', 'planets'],
  },
  {
    id: 'sun',
    theme: 'solar',
    kind: 'sun',
    target: 'sun',
    slug: L('sunspots-today', 'taches-solaires-aujourdhui'),
    question: L(
      'How many sunspots are on the Sun today?',
      'Combien de taches solaires y a-t-il aujourd’hui ?',
    ),
    lead: L(
      'Sunspots are cooler, darker areas where the Sun’s magnetic field is strong; today’s active regions, reported by NOAA, are listed below.',
      'Les taches solaires sont des zones plus froides et plus sombres où le champ magnétique du Soleil est intense ; les régions actives du jour, publiées par la NOAA, sont listées ci-dessous.',
    ),
    description: L(
      'Today’s sunspot groups on the Sun from NOAA’s daily report, with a 3D view of where they are on the solar disc.',
      'Les groupes de taches solaires d’aujourd’hui d’après le rapport quotidien de la NOAA, avec une vue 3D de leur place sur le disque solaire.',
    ),
    intro: L(
      'Sunspots are darker, cooler patches on the Sun’s surface, where tangled magnetic fields hold back the heat rising from inside. They come and go over days or weeks and are carried across the disc by the Sun’s rotation, about once every 27 days as seen from the Earth. Their number rises and falls over a cycle of about eleven years; the current cycle peaked around 2024–2025. Big sunspot groups can launch solar flares and clouds of particles that, on reaching the Earth, cause auroras. The groups shown here come from the daily report of the NOAA Space Weather Prediction Center. Never look at the Sun without proper eclipse glasses or a solar filter.',
      'Les taches solaires sont des zones plus sombres et plus froides de la surface du Soleil, où des champs magnétiques enchevêtrés retiennent la chaleur qui monte de l’intérieur. Elles apparaissent et disparaissent en quelques jours ou semaines et traversent le disque avec la rotation du Soleil, environ tous les 27 jours vue de la Terre. Leur nombre monte et descend selon un cycle d’environ onze ans ; le cycle actuel a culminé vers 2024–2025. Les grands groupes peuvent lancer des éruptions et des nuages de particules qui, en atteignant la Terre, provoquent des aurores. Les groupes montrés viennent du rapport quotidien du Space Weather Prediction Center de la NOAA. Ne regardez jamais le Soleil sans lunettes d’éclipse ou filtre solaire adaptés.',
    ),
    faq: [
      {
        q: L('Why are sunspots dark?', 'Pourquoi les taches solaires sont-elles sombres ?'),
        a: L(
          'They are about 1,500 °C cooler than the surface around them. They would still glow brightly on their own; they only look dark by contrast.',
          'Elles sont environ 1 500 °C plus froides que la surface qui les entoure. Seules, elles brilleraient encore fortement ; elles ne paraissent sombres que par contraste.',
        ),
      },
      {
        q: L('Do sunspots cause auroras?', 'Les taches solaires provoquent-elles des aurores ?'),
        a: L(
          'Indirectly: active regions around sunspots launch eruptions whose particles, a day or two later, can light up auroras near the poles.',
          'Indirectement : les régions actives autour des taches lancent des éruptions dont les particules peuvent, un ou deux jours plus tard, allumer des aurores près des pôles.',
        ),
      },
    ],
    view: { view: 'solar', sel: 'sun', follow: true, hideMissions: true },
    related: ['parker', 'solar-orbiter', 'eclipse'],
  },
  // ------------------------------------------------------------------ the sky
  {
    id: 'sky-tonight',
    theme: 'sky',
    kind: 'sky',
    slug: L('what-is-in-the-sky-tonight', 'que-voir-dans-le-ciel-ce-soir'),
    question: L('What can I see in the sky tonight?', 'Que voir dans le ciel ce soir ?'),
    lead: L(
      'Tonight’s sky depends on where you are: share your location to see which planets, bright stars and satellite passes you can see.',
      'Le ciel de ce soir dépend de l’endroit où vous êtes : indiquez votre position pour savoir quelles planètes, étoiles brillantes et passages de satellites vous pourrez voir.',
    ),
    description: L(
      'Tonight’s sky from your location: the Moon, the visible planets, passes of the ISS and other satellites, and upcoming events.',
      'Le ciel de ce soir depuis chez vous : la Lune, les planètes visibles, les passages de l’ISS et d’autres satellites, et les événements à venir.',
    ),
    intro: L(
      'What you can see tonight depends on where you are. Give Perigee your location and it works out, for the night ahead: when it gets dark, the Moon’s phase and when it rises, which planets are above the horizon and bright enough for the naked eye, and when the International Space Station, Tiangong or Hubble pass overhead in sunlight. Everything is computed on your device from astronomical models and the latest tracking data; your location is never sent anywhere. The clearest views come away from city lights, after your eyes have had about twenty minutes to get used to the dark.',
      'Ce que vous pouvez voir ce soir dépend de l’endroit où vous êtes. Donnez votre position à Périgée : il calcule, pour la nuit qui vient, quand il fera noir, la phase de la Lune et l’heure de son lever, quelles planètes sont au-dessus de l’horizon et assez brillantes pour l’œil nu, et quand la Station spatiale internationale, Tiangong ou Hubble passent au-dessus de vous en plein soleil. Tout est calculé sur votre appareil à partir de modèles astronomiques et des dernières données de suivi ; votre position n’est jamais envoyée. Les meilleures observations se font loin des lumières de la ville, après une vingtaine de minutes pour que vos yeux s’habituent à l’obscurité.',
    ),
    faq: [
      {
        q: L('How can I tell a planet from a star?', 'Comment distinguer une planète d’une étoile ?'),
        a: L(
          'Planets shine with a steady light, while stars twinkle, and planets stay close to the path the Sun and the Moon follow across the sky.',
          'Les planètes brillent d’une lumière fixe alors que les étoiles scintillent, et les planètes restent près du chemin que suivent le Soleil et la Lune dans le ciel.',
        ),
      },
      {
        q: L('Is my location sent anywhere?', 'Ma position est-elle envoyée quelque part ?'),
        a: L(
          'No. It is used only in your browser to do the calculations, and you can make the page forget it at any time.',
          'Non. Elle sert seulement dans votre navigateur pour faire les calculs, et vous pouvez demander à la page de l’oublier à tout moment.',
        ),
      },
    ],
    view: { view: 'solar', hideMissions: true },
    related: ['planets-tonight', 'iss-passes', 'moon-phase'],
  },
  {
    id: 'planets-tonight',
    theme: 'sky',
    kind: 'sky',
    focus: 'planets',
    slug: L('planets-visible-tonight', 'planetes-visibles-ce-soir'),
    question: L('Which planets are visible tonight?', 'Quelles planètes sont visibles ce soir ?'),
    lead: L(
      'Which planets you can see tonight depends on your location and the time; share your location to see when each one rises and sets.',
      'Les planètes visibles ce soir dépendent de votre position et de l’heure ; indiquez votre position pour savoir quand chacune se lève et se couche.',
    ),
    description: L(
      'Which planets you can see tonight from your location, where to look, how bright they are and when they rise and set.',
      'Les planètes visibles ce soir depuis chez vous, où regarder, leur éclat et l’heure de leur lever et de leur coucher.',
    ),
    intro: L(
      'Five planets are easy to see with the naked eye: Mercury, Venus, Mars, Jupiter and Saturn. They follow the same band of sky as the Sun and the Moon, the ecliptic, and they move slowly against the stars, which is where the word “planet”, “wanderer” in Greek, comes from. Venus, the brightest, is the “evening star” or “morning star” and never strays far from the Sun; Jupiter is often the next brightest; Mercury is the hardest to catch, low in the twilight. Give your location to get, for tonight, the planets above your horizon, the direction to look, their brightness and when they rise and set.',
      'Cinq planètes se voient facilement à l’œil nu : Mercure, Vénus, Mars, Jupiter et Saturne. Elles suivent la même bande de ciel que le Soleil et la Lune, l’écliptique, et se déplacent lentement parmi les étoiles : c’est l’origine du mot « planète », « errante » en grec. Vénus, la plus brillante, est « l’étoile du berger » du soir ou du matin et ne s’éloigne jamais beaucoup du Soleil ; Jupiter est souvent la suivante en éclat ; Mercure est la plus difficile à saisir, basse dans le crépuscule. Donnez votre position pour obtenir, pour ce soir, les planètes au-dessus de votre horizon, la direction où regarder, leur éclat et l’heure de leur lever et de leur coucher.',
    ),
    faq: [
      {
        q: L('Can I see Uranus and Neptune?', 'Peut-on voir Uranus et Neptune ?'),
        a: L(
          'Uranus is at the limit of naked-eye visibility under a very dark sky; Neptune needs binoculars or a telescope.',
          'Uranus est à la limite de la visibilité à l’œil nu sous un ciel très noir ; Neptune demande des jumelles ou un télescope.',
        ),
      },
      {
        q: L('What does “magnitude” mean?', 'Que signifie « magnitude » ?'),
        a: L(
          'A scale of brightness where smaller numbers are brighter: Venus reaches about −4, the brightest stars about 0, and the faintest stars visible to the naked eye about 6.',
          'Une échelle d’éclat où les petits nombres sont les plus brillants : Vénus atteint environ −4, les étoiles les plus brillantes environ 0, et les plus faibles visibles à l’œil nu environ 6.',
        ),
      },
    ],
    view: { view: 'solar', hideMissions: true },
    related: ['sky-tonight', 'planets', 'moon-phase'],
  },
  {
    id: 'eclipse',
    theme: 'sky',
    kind: 'events',
    focus: 'eclipses',
    slug: L('next-eclipse', 'prochaine-eclipse'),
    question: L('When is the next eclipse?', 'Quand aura lieu la prochaine éclipse ?'),
    lead: L(
      'Eclipses happen only when a new or full moon falls close to the plane of the Earth’s orbit; the next solar and lunar eclipses are computed below.',
      'Les éclipses ne se produisent que lorsqu’une nouvelle ou une pleine lune tombe près du plan de l’orbite terrestre ; les prochaines éclipses de Soleil et de Lune sont calculées ci-dessous.',
    ),
    description: L(
      'The next solar and lunar eclipses, with their dates and type, and whether they can be seen from your location.',
      'Les prochaines éclipses de Soleil et de Lune, avec leurs dates et leur type, et si elles sont visibles depuis chez vous.',
    ),
    intro: L(
      'An eclipse happens when the Sun, the Earth and the Moon line up. In a solar eclipse, the Moon passes in front of the Sun and its shadow sweeps across a strip of the Earth: only there is the eclipse total, while a much wider area sees a partial one. In a lunar eclipse, the Moon passes through the Earth’s shadow and can turn coppery red, and everyone on the night side of the Earth can see it. Because the Moon’s orbit is tilted, eclipses do not happen every month but in “seasons” about six months apart. The list gives the coming eclipses, and with your location Perigee says how much of each you would see.',
      'Une éclipse se produit quand le Soleil, la Terre et la Lune s’alignent. Lors d’une éclipse de Soleil, la Lune passe devant le Soleil et son ombre balaie une bande de la Terre : c’est seulement là que l’éclipse est totale, alors qu’une zone bien plus large voit une éclipse partielle. Lors d’une éclipse de Lune, la Lune traverse l’ombre de la Terre et peut devenir rouge cuivré ; tout le côté nuit de la Terre peut la voir. Comme l’orbite de la Lune est inclinée, les éclipses n’ont pas lieu chaque mois mais par « saisons » espacées d’environ six mois. La liste donne les prochaines éclipses et, avec votre position, Périgée indique ce que vous en verriez.',
    ),
    faq: [
      {
        q: L('Why doesn’t an eclipse happen every month?', 'Pourquoi n’y a-t-il pas d’éclipse chaque mois ?'),
        a: L(
          'The Moon’s orbit is tilted about 5° to the Earth’s, so the Moon usually passes a little above or below the Sun or the Earth’s shadow.',
          'L’orbite de la Lune est inclinée d’environ 5° sur celle de la Terre : la Lune passe donc d’habitude un peu au-dessus ou au-dessous du Soleil ou de l’ombre de la Terre.',
        ),
      },
      {
        q: L(
          'How can I watch a solar eclipse safely?',
          'Comment observer une éclipse de Soleil sans danger ?',
        ),
        a: L(
          'Only with certified eclipse glasses or a proper solar filter, or by projecting the Sun’s image through a pinhole; sunglasses are not enough.',
          'Uniquement avec des lunettes d’éclipse certifiées ou un vrai filtre solaire, ou en projetant l’image du Soleil par un petit trou ; des lunettes de soleil ne suffisent pas.',
        ),
      },
    ],
    view: { view: 'earth', sel: 'moon' },
    related: ['full-moon', 'moon-phase', 'sun'],
  },
  {
    id: 'full-moon',
    theme: 'sky',
    kind: 'events',
    focus: 'fullMoon',
    slug: L('next-full-moon', 'prochaine-pleine-lune'),
    question: L('When is the next full moon?', 'Quand aura lieu la prochaine pleine lune ?'),
    lead: L(
      'A full moon comes about every 29.5 days, when the Moon is opposite the Sun in the sky; the next full moons are computed below.',
      'La pleine lune revient tous les 29,5 jours environ, quand la Lune est à l’opposé du Soleil dans le ciel ; les prochaines pleines lunes sont calculées ci-dessous.',
    ),
    description: L(
      'Dates and times of the next full moons, new moons and quarters, in your time zone, with the Moon’s distance at each.',
      'Dates et heures des prochaines pleines lunes, nouvelles lunes et quartiers, dans votre fuseau horaire, avec la distance de la Lune.',
    ),
    intro: L(
      'The Moon is full when it is opposite the Sun in the sky, so that the whole face turned towards us is lit. It rises at sunset and sets at sunrise, lighting the whole night. Full moons come back every 29.5 days on average, and each one has traditional names, such as the Harvest Moon near the autumn equinox. The exact moment of full moon is the same everywhere on Earth; only the local time changes, and the times below are given in your computer’s time zone. A full moon near its closest point to the Earth looks slightly larger and brighter: the so-called supermoon.',
      'La Lune est pleine quand elle est à l’opposé du Soleil dans le ciel, de sorte que toute la face tournée vers nous est éclairée. Elle se lève au coucher du Soleil et se couche à son lever, éclairant toute la nuit. Les pleines lunes reviennent tous les 29,5 jours en moyenne, et chacune a des noms traditionnels, comme la lune des moissons près de l’équinoxe d’automne. L’instant exact de la pleine lune est le même partout sur Terre ; seule l’heure locale change, et les heures ci-dessous sont données dans le fuseau horaire de votre ordinateur. Une pleine lune proche du point le plus rapproché de la Terre paraît un peu plus grande et plus brillante : c’est la « super lune ».',
    ),
    faq: [
      {
        q: L('What is a blue moon?', 'Qu’est-ce qu’une « lune bleue » ?'),
        a: L(
          'The second full moon in one calendar month, which happens every two to three years; the Moon does not actually turn blue.',
          'La deuxième pleine lune d’un même mois civil, ce qui arrive tous les deux ou trois ans ; la Lune ne devient pas vraiment bleue.',
        ),
      },
      {
        q: L('Does every full moon cause an eclipse?', 'Chaque pleine lune provoque-t-elle une éclipse ?'),
        a: L(
          'No, only when the Moon passes through the Earth’s shadow, which happens a few times a year at most.',
          'Non, seulement quand la Lune traverse l’ombre de la Terre, ce qui arrive au plus quelques fois par an.',
        ),
      },
    ],
    view: { view: 'earth', sel: 'moon', follow: true },
    related: ['moon-phase', 'eclipse', 'moon-distance'],
  },
];

export const topicById = (id: string): Topic | undefined => TOPICS.find((t) => t.id === id);

/** Path of a topic's page under the site root (no leading slash). */
export const topicPath = (t: Topic, lang: 'en' | 'fr'): string => `${lang}/${t.slug[lang]}/`;
