import type { Lang } from './index';
import type { MessageKey } from './en';

/**
 * Definitions of the detail panels' field labels, written for a secondary-school student. A label with a
 * definition gets a small "?" and opens it in a dialog (src/ui/Glossary.ts).
 */
export const GLOSSARY = {
  norad: {
    en: 'The catalogue number given to every object tracked in Earth orbit by the US Space Force (it took over this catalogue from NORAD, the North American air defence command, which started it). Numbers are handed out in order of discovery: Sputnik’s rocket is No. 1, and since July 2026 new objects get six-digit numbers (100000 and up).',
    fr: 'Le numéro de catalogue attribué à chaque objet suivi en orbite terrestre par la US Space Force (qui a repris ce catalogue du NORAD, le commandement de la défense aérienne nord-américaine, qui l’avait créé). Les numéros sont donnés dans l’ordre de découverte : la fusée de Spoutnik porte le n° 1, et depuis juillet 2026 les nouveaux objets ont des numéros à six chiffres (100000 et plus).',
  },
  cospar: {
    en: 'The international designation of a launched object: the launch year, the launch’s number in that year, then a letter for each piece put in orbit by that launch. 1998-067A is the first piece (the ISS’s Zarya module) of the 67th launch of 1998.',
    fr: 'La désignation internationale d’un objet lancé : l’année du lancement, le numéro du lancement dans l’année, puis une lettre pour chaque objet mis en orbite par ce lancement. 1998-067A est le premier objet (le module Zarya de l’ISS) du 67e lancement de 1998.',
  },
  operator: {
    en: 'The company or organisation that runs the satellite from the ground (SpaceX, OneWeb, a space agency…). Here it is deduced from the CelesTrak group the satellite belongs to, such as “starlink”.',
    fr: 'L’entreprise ou l’organisme qui pilote le satellite depuis le sol (SpaceX, OneWeb, une agence spatiale…). Ici, il est déduit du groupe CelesTrak auquel le satellite appartient, par exemple « starlink ».',
  },
  hostedPayload: {
    en: 'An instrument carried by a satellite on behalf of another organisation, like a passenger: for example a navigation or Earth-observation instrument riding on a telecommunications satellite.',
    fr: 'Un instrument transporté par un satellite pour le compte d’un autre organisme, comme un passager : par exemple un instrument de navigation ou d’observation de la Terre à bord d’un satellite de télécommunications.',
  },
  owner: {
    en: 'The country or international organisation responsible for the object in the official satellite catalogue (SATCAT). It is usually a country (US, PRC for China, CIS for Russia…) or an agency (ESA), rarely a company.',
    fr: 'Le pays ou l’organisation internationale responsable de l’objet dans le catalogue officiel des satellites (SATCAT). C’est le plus souvent un pays (US, PRC pour la Chine, CIS pour la Russie…) ou une agence (ESA), rarement une entreprise.',
  },
  satcatCodes: {
    en: 'The short code the official satellite catalogue (SATCAT) uses to say where each object was launched from. They are often old names: AFETR, for Cape Canaveral, stands for “Air Force Eastern Test Range”. It is how the satellites launched from this site are found in the catalogue.',
    fr: 'Le code court qu’utilise le catalogue officiel des satellites (SATCAT) pour indiquer d’où chaque objet a été lancé. Ce sont souvent d’anciens noms : AFETR, pour Cap Canaveral, veut dire « Air Force Eastern Test Range » (zone d’essais de l’Est de l’armée de l’air américaine). C’est grâce à lui qu’on retrouve dans le catalogue les satellites lancés de ce site.',
  },
  altitude: {
    en: 'The height of the object above the surface of the body it orbits, measured from its average level (not from the mountains or valleys below). It changes along the orbit unless the orbit is a perfect circle.',
    fr: 'La hauteur de l’objet au-dessus de la surface du corps autour duquel il tourne, mesurée depuis son niveau moyen (pas depuis les montagnes ou les vallées en dessous). Elle varie le long de l’orbite, sauf si l’orbite est un cercle parfait.',
  },
  speed: {
    en: 'How fast the object moves relative to the centre of the body it orbits, in kilometres per second. The lower the orbit, the faster: about 7.7 km/s (27 000 km/h) for the International Space Station, 3 km/s in geostationary orbit.',
    fr: 'La vitesse de l’objet par rapport au centre du corps autour duquel il tourne, en kilomètres par seconde. Plus l’orbite est basse, plus c’est rapide : environ 7,7 km/s (27 000 km/h) pour la Station spatiale internationale, 3 km/s en orbite géostationnaire.',
  },
  apsides: {
    en: 'An orbit is an ellipse. Its lowest point is the periapsis (called perigee around the Earth) and its highest point the apoapsis (apogee around the Earth). Both are given here as altitudes above the surface. When they are close, the orbit is almost circular.',
    fr: 'Une orbite est une ellipse. Son point le plus bas est la périapside (appelée périgée autour de la Terre) et son point le plus haut l’apoapside (apogée autour de la Terre). Les deux sont données ici en altitude au-dessus de la surface. Quand elles sont proches, l’orbite est presque circulaire.',
  },
  period: {
    en: 'The time the object takes to go once around its orbit. About 90 minutes for a low satellite, one day for a geostationary one, one year for the Earth around the Sun.',
    fr: 'Le temps que met l’objet pour faire un tour complet de son orbite. Environ 90 minutes pour un satellite bas, un jour pour un satellite géostationnaire, un an pour la Terre autour du Soleil.',
  },
  inclination: {
    en: 'The tilt of the orbit relative to a reference plane, usually the equator of the central body. 0° means the object circles above the equator, 90° that it flies over the poles, and more than 90° that it goes round in the opposite direction to the body’s rotation.',
    fr: 'L’angle entre le plan de l’orbite et un plan de référence, en général l’équateur du corps central. 0° signifie que l’objet tourne au-dessus de l’équateur, 90° qu’il passe au-dessus des pôles, et plus de 90° qu’il tourne dans le sens inverse de la rotation du corps.',
  },
  epoch: {
    en: 'The date and time at which the orbital elements (the numbers describing the orbit) were measured. The position is computed forward from that moment, so it becomes less accurate as the elements get older: after 14 days they are flagged as stale.',
    fr: 'La date et l’heure auxquelles les éléments orbitaux (les nombres qui décrivent l’orbite) ont été mesurés. La position est calculée à partir de ce moment : elle devient moins précise à mesure que les éléments vieillissent, et après 14 jours ils sont signalés comme périmés.',
  },
  elementsSource: {
    en: 'Who measured the orbit used here. By default, the US Space Force tracks objects with radars and telescopes and publishes their orbits (through CelesTrak). Some operators publish their own, more precise data, from which CelesTrak computes better-fitting elements (“SupGP”).',
    fr: 'Qui a mesuré l’orbite utilisée ici. Par défaut, la US Space Force suit les objets avec des radars et des télescopes et publie leurs orbites (relayées par CelesTrak). Certains opérateurs publient leurs propres données, plus précises, dont CelesTrak tire des éléments mieux ajustés (« SupGP »).',
  },
  groups: {
    en: 'The lists CelesTrak sorts satellites into: a constellation (Starlink, OneWeb…), a navigation system (GPS, Galileo…), or a type of mission (weather, space stations, science…).',
    fr: 'Les listes dans lesquelles CelesTrak classe les satellites : une constellation (Starlink, OneWeb…), un système de navigation (GPS, Galileo…) ou un type de mission (météo, stations spatiales, science…).',
  },
  horizons: {
    en: 'The number of the object in JPL Horizons, the NASA service that computes the positions of planets, moons and spacecraft. Spacecraft have negative numbers (−85 is the Lunar Reconnaissance Orbiter).',
    fr: 'Le numéro de l’objet dans JPL Horizons, le service de la NASA qui calcule les positions des planètes, des lunes et des sondes. Les sondes ont des numéros négatifs (−85 est Lunar Reconnaissance Orbiter).',
  },
  ephemerisWindow: {
    en: 'An ephemeris is a table giving the position and speed of an object at regular times. This is the period covered by the table downloaded from JPL Horizons: inside it, the position is interpolated between the table’s values and is very accurate; outside it, it is estimated from the laws of orbits and shown as approximate.',
    fr: 'Des éphémérides sont une table donnant la position et la vitesse d’un objet à intervalles réguliers. C’est la période couverte par la table téléchargée de JPL Horizons : à l’intérieur, la position est interpolée entre les valeurs de la table et est très précise; en dehors, elle est estimée à partir des lois des orbites et affichée comme approximative.',
  },
  radius: {
    en: 'The distance from the centre of the body to its surface, averaged over the whole surface, since no body is a perfect sphere.',
    fr: 'La distance entre le centre du corps et sa surface, en moyenne sur toute la surface, car aucun corps n’est une sphère parfaite.',
  },
  flattening: {
    en: 'A spinning planet bulges at its equator and is flattened at its poles. The equatorial radius is measured from the centre to the equator, the polar radius from the centre to a pole. Saturn, which spins fast, is about 10 % wider than it is tall.',
    fr: 'Une planète qui tourne sur elle-même se renfle à l’équateur et s’aplatit aux pôles. Le rayon équatorial est mesuré du centre à l’équateur, le rayon polaire du centre à un pôle. Saturne, qui tourne vite, est environ 10 % plus large que haute.',
  },
  semiAxes: {
    en: 'The body is shaped like a stretched ball (an ellipsoid). Its three semi-axes are the distances from its centre to its surface along its longest, middle and shortest directions.',
    fr: 'Le corps a la forme d’une balle étirée (un ellipsoïde). Ses trois demi-axes sont les distances entre son centre et sa surface selon sa direction la plus longue, sa direction moyenne et sa direction la plus courte.',
  },
  coordinates: {
    en: 'The position on the surface: the latitude (north or south of the equator, in degrees) and the longitude (east or west of the body’s prime meridian, the reference line chosen by astronomers, like Greenwich on the Earth).',
    fr: 'La position à la surface : la latitude (au nord ou au sud de l’équateur, en degrés) et la longitude (à l’est ou à l’ouest du méridien origine du corps, la ligne de référence choisie par les astronomes, comme Greenwich sur la Terre).',
  },
  sol: {
    en: 'A day on Mars, from one noon to the next: 24 h 39 min 35 s. Missions count their sols from the landing day, sol 0.',
    fr: 'Un jour sur Mars, d’un midi au suivant : 24 h 39 min 35 s. Les missions comptent leurs sols à partir du jour de l’atterrissage, le sol 0.',
  },
  distSun: {
    en: 'The distance between the object and the centre of the Sun, in astronomical units (AU). One AU is the average Sun–Earth distance, about 150 million kilometres.',
    fr: 'La distance entre l’objet et le centre du Soleil, en unités astronomiques (ua). Une ua est la distance moyenne Terre–Soleil, environ 150 millions de kilomètres.',
  },
  distEarth: {
    en: 'The distance between the object and the Earth. The light time is how long light, or a radio message, takes to cover that distance at 300 000 km/s: the delay before a command sent from the Earth reaches a probe.',
    fr: 'La distance entre l’objet et la Terre. Le temps-lumière est la durée que met la lumière, ou un message radio, pour parcourir cette distance à 300 000 km/s : le délai avant qu’une commande envoyée de la Terre atteigne une sonde.',
  },
  speedSun: {
    en: 'The speed of the object relative to the Sun (“helio” means Sun). The Earth itself travels around the Sun at about 30 km/s; the closer to the Sun, the faster objects move.',
    fr: 'La vitesse de l’objet par rapport au Soleil (« hélio » veut dire Soleil). La Terre elle-même tourne autour du Soleil à environ 30 km/s; plus un objet est proche du Soleil, plus il va vite.',
  },
  speedPlanet: {
    en: 'How fast the moon moves around its planet, measured from the planet’s centre.',
    fr: 'La vitesse à laquelle la lune tourne autour de sa planète, mesurée depuis le centre de la planète.',
  },
  semiMajorAxis: {
    en: 'Half of the longest diameter of the orbit’s ellipse: the average of the closest and farthest distances from the central body. It sets the orbit’s size and its period.',
    fr: 'La moitié du plus grand diamètre de l’ellipse de l’orbite : la moyenne des distances la plus courte et la plus grande au corps central. Il fixe la taille de l’orbite et sa période.',
  },
  eccentricity: {
    en: 'A number describing how stretched the orbit is: 0 is a perfect circle, values close to 1 are very elongated ellipses. The Moon’s orbit around the Earth is 0.055.',
    fr: 'Un nombre qui indique à quel point l’orbite est étirée : 0 est un cercle parfait, les valeurs proches de 1 sont des ellipses très allongées. L’orbite de la Lune autour de la Terre est de 0,055.',
  },
  moonPhase: {
    en: 'The part of the Moon lit by the Sun that we see from the Earth. It changes as the Moon goes around the Earth: new moon (dark), first quarter, full moon, last quarter, then new moon again.',
    fr: 'La partie de la Lune éclairée par le Soleil que l’on voit depuis la Terre. Elle change à mesure que la Lune tourne autour de la Terre : nouvelle lune (sombre), premier quartier, pleine lune, dernier quartier, puis de nouveau nouvelle lune.',
  },
  designation: {
    en: 'The star’s name in Bayer’s system (1603): a Greek letter, usually given in order of brightness, followed by the name of its constellation. α Orionis (Betelgeuse) is the “alpha” of Orion.',
    fr: 'Le nom de l’étoile dans le système de Bayer (1603) : une lettre grecque, donnée en général par ordre d’éclat, suivie du nom de sa constellation. α Orionis (Bételgeuse) est l’« alpha » d’Orion.',
  },
  constellation: {
    en: 'One of the 88 regions of the sky defined by the International Astronomical Union, named after a figure drawn by ancient sky-watchers. Stars of a constellation look close together but can be at very different distances.',
    fr: 'L’une des 88 régions du ciel définies par l’Union astronomique internationale, nommées d’après une figure tracée par les observateurs de l’Antiquité. Les étoiles d’une constellation semblent proches les unes des autres mais peuvent être à des distances très différentes.',
  },
  spectralType: {
    en: 'A code sorting stars by the light they give off, which depends on their surface temperature. The letters go from the hottest (O, blue) to the coolest (M, red): O, B, A, F, G, K, M; a digit refines the class. The Roman numeral gives the size: V for a main-sequence star like the Sun (G2V), III for a giant, I for a supergiant.',
    fr: 'Un code qui classe les étoiles selon la lumière qu’elles émettent, qui dépend de la température de leur surface. Les lettres vont de la plus chaude (O, bleue) à la plus froide (M, rouge) : O, B, A, F, G, K, M; un chiffre affine la classe. Le chiffre romain indique la taille : V pour une étoile de la séquence principale comme le Soleil (G2V), III pour une géante, I pour une supergéante.',
  },
  magnitude: {
    en: 'How bright the star looks from the Earth. The scale runs backwards: the lower the number, the brighter the star. Each step of 1 means about 2.5 times brighter. Sirius, the brightest star at night, is −1.5; the faintest stars seen with the naked eye are about 6.',
    fr: 'L’éclat de l’étoile vue depuis la Terre. L’échelle va à l’envers : plus le nombre est petit, plus l’étoile est brillante. Chaque écart de 1 correspond à un éclat environ 2,5 fois plus grand. Sirius, l’étoile la plus brillante de la nuit, est à −1,5; les plus faibles visibles à l’œil nu sont vers 6.',
  },
  lightYear: {
    en: 'Stars are so far away that their distance is given in light-years: the distance light travels in one year, about 9 460 billion kilometres. The light we see from a star 100 light-years away left it 100 years ago.',
    fr: 'Les étoiles sont si loin qu’on donne leur distance en années-lumière : la distance que parcourt la lumière en un an, environ 9 460 milliards de kilomètres. La lumière que l’on voit d’une étoile à 100 années-lumière l’a quittée il y a 100 ans.',
  },
  starRadius: {
    en: 'The size of the star compared with the Sun’s radius (696 000 km, 109 times the Earth’s). Giant stars can be hundreds of times larger than the Sun.',
    fr: 'La taille de l’étoile comparée au rayon du Soleil (696 000 km, 109 fois celui de la Terre). Les étoiles géantes peuvent être des centaines de fois plus grandes que le Soleil.',
  },
  mass: {
    en: 'The amount of matter in the star. It decides almost everything about it: how hot and bright it shines, how long it lives and how it ends. Stars heavier than the Sun burn their fuel much faster.',
    fr: 'La quantité de matière de l’étoile. Elle décide de presque tout : sa température, son éclat, sa durée de vie et sa fin. Les étoiles plus massives que le Soleil brûlent leur combustible bien plus vite.',
  },
  temperature: {
    en: 'The temperature of the star’s visible surface, in kelvins (0 K is absolute zero, −273 °C). It sets the star’s colour: red stars are about 3 000 K, the Sun 5 800 K, blue stars over 10 000 K. “Effective” means the temperature a perfect radiator would need to give off the same light.',
    fr: 'La température de la surface visible de l’étoile, en kelvins (0 K est le zéro absolu, −273 °C). Elle fixe la couleur de l’étoile : environ 3 000 K pour une étoile rouge, 5 800 K pour le Soleil, plus de 10 000 K pour une étoile bleue. « Effective » désigne la température qu’aurait un émetteur parfait donnant la même lumière.',
  },
  luminosity: {
    en: 'The total energy the star gives off every second, as light and other radiation, whatever its distance from us. A star can look faint because it is far away while being far more luminous than the Sun.',
    fr: 'L’énergie totale émise par l’étoile chaque seconde, sous forme de lumière et d’autres rayonnements, quelle que soit sa distance à nous. Une étoile peut paraître faible parce qu’elle est loin tout en étant bien plus lumineuse que le Soleil.',
  },
  skyPosition: {
    en: 'The star’s place on the sky, like a longitude and latitude projected onto the sky: right ascension (RA, in hours, minutes and seconds) along the celestial equator and declination (Dec, in degrees) north or south of it. J2000 means the coordinates as of the year 2000, since the Earth’s axis slowly wobbles.',
    fr: 'La place de l’étoile sur le ciel, comme une longitude et une latitude projetées sur le ciel : l’ascension droite (AD, en heures, minutes et secondes) le long de l’équateur céleste et la déclinaison (Déc, en degrés) au nord ou au sud de celui-ci. J2000 indique les coordonnées de l’an 2000, car l’axe de la Terre oscille lentement.',
  },
  solarRotation: {
    en: 'The Sun turns on itself in about 25 days at its equator, and more slowly near its poles, since it is not solid. Seen from the Earth, which moves around it in the same direction, a turn seems to take two days longer.',
    fr: 'Le Soleil tourne sur lui-même en environ 25 jours à l’équateur, et plus lentement près des pôles, car il n’est pas solide. Vu de la Terre, qui tourne autour de lui dans le même sens, un tour semble durer deux jours de plus.',
  },
  carrington: {
    en: 'Astronomers have numbered the Sun’s rotations since 9 November 1853, following Richard Carrington. The central meridian is the solar longitude facing the Earth right now, which tells which side of the Sun we see.',
    fr: 'Les astronomes numérotent les rotations du Soleil depuis le 9 novembre 1853, à la suite de Richard Carrington. Le méridien central est la longitude solaire tournée vers la Terre en ce moment, ce qui indique quelle face du Soleil on voit.',
  },
  activeRegions: {
    en: 'Areas of the Sun where strong magnetic fields come through the surface. They often hold sunspots, darker because they are cooler, and they are where solar flares are born. NOAA numbers them each day.',
    fr: 'Des zones du Soleil où de forts champs magnétiques traversent la surface. Elles contiennent souvent des taches solaires, plus sombres car plus froides, et c’est là que naissent les éruptions solaires. La NOAA les numérote chaque jour.',
  },
  dwarfPlanet: {
    en: 'A body that orbits the Sun and is massive enough for its own gravity to have made it round, but that has not cleared its orbit of other objects, unlike a planet (International Astronomical Union, 2006). The IAU recognises five: Ceres, Pluto, Haumea, Makemake and Eris. Other large bodies beyond Neptune are “candidates”: astronomers think they are round, but their shape or size has not been measured well enough for the IAU to decide.',
    fr: 'Un corps qui tourne autour du Soleil et assez massif pour que sa propre gravité l’ait rendu rond, mais qui n’a pas fait le ménage sur son orbite, contrairement à une planète (Union astronomique internationale, 2006). L’UAI en reconnaît cinq : Cérès, Pluton, Hauméa, Makémaké et Éris. D’autres gros corps au-delà de Neptune sont des « candidates » : les astronomes les pensent ronds, mais leur forme ou leur taille n’est pas encore assez bien mesurée pour que l’UAI tranche.',
  },
} as const satisfies Record<string, Record<Lang, string>>;

export type GlossaryTerm = keyof typeof GLOSSARY;

/** Field labels with a definition. Labels showing the same text must share their term (checked by a test). */
// "Phase" is defined only for the Moon (its row names the term): a probe's mission phase needs none.
export const LABEL_TERMS: Partial<Record<MessageKey, GlossaryTerm>> = {
  'info.norad': 'norad',
  'info.cospar': 'cospar',
  'info.operator': 'operator',
  'info.hostedPayload': 'hostedPayload',
  'info.owner': 'owner',
  'launch.codes': 'satcatCodes',
  'info.altitude': 'altitude',
  'info.speed': 'speed',
  'info.apsides': 'apsides',
  'info.periapsis': 'apsides',
  'info.period': 'period',
  'info.orbitalPeriod': 'period',
  'info.inclination': 'inclination',
  'info.inclinationEquator': 'inclination',
  'info.epoch': 'epoch',
  'info.elementsSource': 'elementsSource',
  'info.groups': 'groups',
  'info.horizons': 'horizons',
  'info.window': 'ephemerisWindow',
  'info.radius': 'radius',
  'info.radiiEqPolar': 'flattening',
  'info.semiAxes': 'semiAxes',
  'info.coordinates': 'coordinates',
  'info.sol': 'sol',
  'info.distSun': 'distSun',
  'info.distEarth': 'distEarth',
  'info.speedSun': 'speedSun',
  'info.speedPlanet': 'speedPlanet',
  'info.semiMajorAxis': 'semiMajorAxis',
  'info.eccentricity': 'eccentricity',
  'star.designation': 'designation',
  'star.constellation': 'constellation',
  'star.spectralType': 'spectralType',
  'star.magnitude': 'magnitude',
  'star.distance': 'lightYear',
  'star.radius': 'starRadius',
  'star.mass': 'mass',
  'sun.mass': 'mass',
  'star.temperature': 'temperature',
  'sun.temperature': 'temperature',
  'star.luminosity': 'luminosity',
  'sun.luminosity': 'luminosity',
  'star.position': 'skyPosition',
  'sun.rotation': 'solarRotation',
  'sun.carrington': 'carrington',
  'sun.regions': 'activeRegions',
  'dwarf.status': 'dwarfPlanet',
};
