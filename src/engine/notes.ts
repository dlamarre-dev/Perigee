/**
 * Texts of the machine interface's answers meant for the user, in English and French (an answer gives the
 * language asked for). Codes stay English in every language ("ESE", "umbra"…): they are values for the assistant,
 * and the texts beside them are localised.
 */
export type Lang = 'en' | 'fr';
type Localized = { readonly en: string; readonly fr: string };

/** Compass point for a text: French writes O (ouest) for W ("ONO" for "WNW"). */
export function compassLabel(code: string, lang: Lang): string {
  return lang === 'fr' ? code.replaceAll('W', 'O') : code;
}

export const LIGHT_LABELS: Readonly<Record<'sunlight' | 'penumbra' | 'umbra', Localized>> = {
  sunlight: { en: 'in sunlight', fr: 'au soleil' },
  penumbra: {
    en: 'in the penumbra (part of the Sun hidden)',
    fr: 'dans la pénombre (Soleil en partie caché)',
  },
  umbra: { en: 'in the shadow (umbra)', fr: 'dans l’ombre (ombre pure)' },
};

export const NOTES = {
  passes: {
    en: "Times to within seconds for elements a few days old (low orbits drift by roughly a second per day of element age, more during strong solar activity); azimuth and elevation to a fraction of a degree. Refraction is ignored (it lifts objects by about 0.5 degrees at the horizon). Visible to the naked eye: the satellite is sunlit while the Sun is more than 6 degrees below the observer's horizon, above the minimum elevation; brightness is not estimated. Directions are compass codes (N, NNE… W = west).",
    fr: 'Heures à quelques secondes près pour des éléments de quelques jours (les orbites basses dérivent d’environ une seconde par jour d’âge des éléments, davantage lors d’une forte activité solaire) ; azimut et hauteur à une fraction de degré près. La réfraction est ignorée (elle relève les objets d’environ 0,5 degré à l’horizon). Visible à l’œil nu : le satellite est éclairé par le Soleil pendant que celui-ci est à plus de 6 degrés sous l’horizon de l’observateur, au-dessus de la hauteur minimale ; l’éclat n’est pas estimé. Les directions sont des codes de boussole anglais (N, NNE… W = ouest).',
  },
  events: {
    en: 'Times in UTC (and local time when a zone is given); astronomical events from astronomy-engine to within a minute. Supermoon: full Moon nearer than 360,000 km; micromoon: farther than 405,000 km. Mission events come from the curated catalogue (verified date given); a partial date ("2026-11") is placed at the start of its overlap with the period.',
    fr: 'Heures en UTC (et en heure locale si un fuseau est donné) ; événements astronomiques d’astronomy-engine à la minute près. Super Lune : pleine Lune à moins de 360 000 km ; micro Lune : à plus de 405 000 km. Les événements des missions viennent du catalogue tenu à jour (date de vérification donnée) ; une date partielle (« 2026-11 ») est placée au début de son chevauchement avec la période.',
  },
  shadow: {
    en: "Penumbra: part of the Sun is hidden by the body; umbra: all of it. The body is a sphere of its mean (Earth: equatorial) radius, without atmosphere (the Earth's refraction and haze blur the edge by a few seconds); times to within a second of this model, which is as good as the position.",
    fr: 'Pénombre : une partie du Soleil est cachée par l’astre ; ombre : tout le Soleil. L’astre est une sphère de son rayon moyen (la Terre : équatorial), sans atmosphère (la réfraction et la brume de la Terre estompent la limite de quelques secondes) ; heures à la seconde près pour ce modèle, aussi justes que la position.',
  },
  groundTrack: {
    en: "WGS 84 geodetic latitude and longitude (east positive) of the point below the satellite, SGP4 in an Earth-fixed frame by GMST (polar motion neglected: well under 1 km). GeoJSON coordinates are [longitude, latitude], split where the track crosses the antimeridian. The track drifts west by the Earth's rotation each orbit; it is as accurate as the position (a few km for elements a few days old).",
    fr: 'Latitude et longitude géodésiques WGS 84 (est positif) du point sous le satellite, SGP4 dans un repère lié à la Terre par le temps sidéral (mouvement du pôle négligé : bien moins de 1 km). Les coordonnées GeoJSON sont [longitude, latitude], coupées là où la trace franchit l’antiméridien. La trace se décale vers l’ouest à chaque orbite à cause de la rotation de la Terre ; elle est aussi juste que la position (quelques km pour des éléments de quelques jours).',
  },
  approachWarning: {
    en: 'For education only: not a conjunction assessment and never for collision avoidance. Public elements carry errors of kilometres growing by kilometres a day, and real screening needs covariances, operator ephemerides and manoeuvre plans (that is the job of the US Space Force, ESA and the operators).',
    fr: 'À des fins éducatives seulement : ce n’est pas une évaluation de conjonction, et jamais pour éviter une collision. Les éléments publics ont des erreurs de quelques kilomètres qui grandissent de plusieurs kilomètres par jour, et une vraie surveillance demande des covariances, les éphémérides des opérateurs et leurs plans de manœuvre (c’est le travail de l’US Space Force, de l’ESA et des opérateurs).',
  },
  conjunctions: {
    en: "Separations between centres, seen from the place (the Moon's parallax included), at their smallest (to about a minute); altitude and direction (compass code) of the pair at that moment; visible: above the horizon with the Sun more than 6 degrees below it. Stars: magnitude 1.5 or brighter within 10 degrees of the ecliptic. A satellite's separations are sampled every 2 seconds during its passes above 10 degrees; it shows only when sunlit.",
    fr: 'Écarts entre les centres, vus du lieu (parallaxe de la Lune comprise), au plus près (à la minute près) ; hauteur et direction (code de boussole anglais, W = ouest) de la paire à ce moment ; visible : au-dessus de l’horizon avec le Soleil à plus de 6 degrés sous celui-ci. Étoiles : magnitude 1,5 ou moins, à moins de 10 degrés de l’écliptique. Les écarts d’un satellite sont échantillonnés toutes les 2 secondes pendant ses passages au-dessus de 10 degrés ; il ne se voit que s’il est éclairé.',
  },
  tonight: {
    en: "Night: the Sun more than 6 degrees below the horizon (end of civil twilight to its start). Planets: those visible to the naked eye an hour into the night. Passes: the visible part of the passes of the ISS, Tiangong and Hubble above 10 degrees (sunlit satellite, dark sky); brightness is not estimated. Conjunctions: pairs within 5 degrees, visible from the place. City lights, clouds and the horizon's relief are not known.",
    fr: 'Nuit : le Soleil à plus de 6 degrés sous l’horizon (de la fin du crépuscule civil à son début). Planètes : celles visibles à l’œil nu une heure après le début de la nuit. Passages : la partie visible des passages de l’ISS, de Tiangong et de Hubble au-dessus de 10 degrés (satellite éclairé, ciel noir) ; l’éclat n’est pas estimé. Rapprochements : paires à moins de 5 degrés, visibles du lieu. L’éclairage urbain, les nuages et le relief de l’horizon ne sont pas connus.',
  },
} as const satisfies Record<string, Localized>;
