import type { Messages } from './en';

export const fr: Messages = {
  'app.title': 'Périgée — les objets en orbite, en temps réel',
  'app.loading': 'Chargement…',
  'app.webglUnavailable': 'WebGL 2 n’est pas disponible dans ce navigateur.',

  'toolbar.recenter': 'Recentrer',
  'toolbar.recenter.hint': 'Revenir à la vue par défaut (R)',
  'toolbar.frame': 'Repère',
  'toolbar.frame.fixed': 'Terrestre fixe',
  'toolbar.frame.inertial': 'Inertiel',
  'toolbar.frame.hint':
    'Terrestre fixe : la Terre reste immobile. Inertiel : la Terre tourne, les orbites restent fixes.',
  'toolbar.language': 'Langue',
  'toolbar.about': 'À propos',

  'time.label': 'Temps de simulation',
  'time.pause': 'Pause',
  'time.play': 'Lecture',
  'time.now': 'Maintenant',
  'time.now.hint': 'Revenir au temps réel',
  'time.rate': 'Vitesse',
  'time.jump': 'Aller à la date (UTC)',
  'time.jump.apply': 'Aller',
  'time.live': 'En direct',
  'time.paused': 'En pause',

  'about.title': 'À propos de Périgée',
  'about.intro':
    'Périgée est un visualiseur libre des objets artificiels en orbite. Toutes les positions sont calculées dans votre navigateur à partir de données publiques.',
  'about.disclaimer':
    'Usage éducatif seulement. Non destiné à la navigation ni à l’évaluation de conjonctions.',
  'about.sources': 'Données et imagerie',
  'about.software': 'Logiciels',
  'about.license': 'Code publié sous licence MIT.',
  'about.close': 'Fermer',
};
