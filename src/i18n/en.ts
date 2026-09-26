export const en = {
  'app.title': 'Périgée — objects in orbit, in real time',
  'app.loading': 'Loading…',
  'app.webglUnavailable': 'WebGL 2 is not available in this browser.',

  'toolbar.recenter': 'Recenter',
  'toolbar.recenter.hint': 'Return to the default view (R)',
  'toolbar.frame': 'Frame',
  'toolbar.frame.fixed': 'Earth-fixed',
  'toolbar.frame.inertial': 'Inertial',
  'toolbar.frame.hint': 'Earth-fixed: the Earth stays still. Inertial: the Earth rotates, orbits stay fixed.',
  'toolbar.language': 'Language',
  'toolbar.about': 'About',

  'time.label': 'Simulation time',
  'time.pause': 'Pause',
  'time.play': 'Play',
  'time.now': 'Now',
  'time.now.hint': 'Back to real time',
  'time.rate': 'Speed',
  'time.jump': 'Jump to date (UTC)',
  'time.jump.apply': 'Go',
  'time.live': 'Live',
  'time.paused': 'Paused',

  'about.title': 'About Périgée',
  'about.intro':
    'Périgée is an open-source viewer of artificial objects in orbit. All positions are computed in your browser from public data.',
  'about.disclaimer': 'Educational use only. Not intended for navigation or conjunction assessment.',
  'about.sources': 'Data and imagery',
  'about.software': 'Software',
  'about.license': 'Code released under the MIT license.',
  'about.close': 'Close',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
