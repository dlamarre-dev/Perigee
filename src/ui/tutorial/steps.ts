/**
 * The guided tour's steps (src/ui/tutorial/Tutorial.ts). A step either spotlights one control (`target`, a
 * selector re-queried every frame since panels rebuild their rows) and waits until `done` holds, or lets the
 * visitor look around freely (`observe`) until they press Next. Selectors and done-signals follow the app's DOM
 * and URL (`sel`, `view`): keep them in step with the panels (tests/e2e/tutorial.spec.ts walks the first ones).
 */
import type { MessageKey } from '../../i18n';

export interface TutorialStep {
  readonly text: MessageKey;
  /** The control to use; absent for a free "observe" step or the end card. */
  readonly target?: string;
  /** For a target step: true once the visitor has done it. */
  readonly done?: () => boolean;
  /** Observe step: free camera and a Next button; `follow` first follows the selection. */
  readonly observe?: 'follow' | 'look';
  /** A wider hole than the lit control (a whole window to read); clicks still reach only what is inside. */
  readonly hole?: string;
  /** False: the blocked part is not darkened (the 3D view must be seen, e.g. time running faster). */
  readonly dim?: boolean;
  /** The selection the step needs (URL id): restored on entering it if the visitor closed the object's panel. */
  readonly select?: string;
}

const param = (key: string): string | null => new URLSearchParams(window.location.search).get(key);
const view = (): string => param('view') ?? 'earth';
const isOpen = (selector: string): boolean => document.querySelector(`${selector}[open]`) !== null;
const checked = (id: string): boolean => document.querySelector<HTMLInputElement>(`#${id}`)?.checked === true;
/** The open info panel's Follow button (Earth satellites: InfoPanel; other objects: DetailPanel). */
const FOLLOW_BUTTON = '.side-panel.info:not([hidden]) .follow-button';
const following = (): boolean =>
  document.querySelector(FOLLOW_BUTTON)?.getAttribute('aria-pressed') === 'true';

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // Time: faster, much faster, then back to now (the rate buttons on large screens, the rate list on phones).
  {
    text: 'tutorial.time.x10',
    target: '.time-control button[data-rate="10"], .time-control .rate-select',
    done: () => param('rate') === '10',
    dim: false,
  },
  {
    text: 'tutorial.time.x1000',
    target: '.time-control button[data-rate="1000"], .time-control .rate-select',
    done: () => param('rate') === '1000',
    dim: false,
  },
  {
    text: 'tutorial.time.now',
    target: '.time-control .now-button',
    done: () => !param('rate') && !param('t'),
    dim: false,
  },
  // Earth: the ISS through the filters.
  {
    text: 'tutorial.iss.filter',
    target: 'li:has(> #f-science-25544)',
    done: () => checked('f-science-25544') || param('sel') === '25544',
  },
  {
    text: 'tutorial.iss.select',
    target: 'button.result[data-norad="25544"]',
    done: () => param('sel') === '25544',
  },
  { text: 'tutorial.iss.observe', observe: 'look' },
  // Following, taught once on the ISS and once on Saturn.
  { text: 'tutorial.iss.follow', target: FOLLOW_BUTTON, select: '25544', done: following },
  { text: 'tutorial.iss.followObserve', observe: 'look' },
  // The Moon: LRO.
  {
    text: 'tutorial.moon.tab',
    target: '.view-tabs button[data-view="moon"]',
    done: () => view() === 'moon',
  },
  {
    text: 'tutorial.moon.lro',
    target: 'button.result[data-mission="lro"]',
    done: () => view() === 'moon' && param('sel') === 'lro',
  },
  { text: 'tutorial.moon.observe', observe: 'look' },
  // Mars: Curiosity, at its last known place.
  {
    text: 'tutorial.mars.tab',
    target: '.view-tabs button[data-view="mars"]',
    done: () => view() === 'mars',
  },
  {
    text: 'tutorial.mars.curiosity',
    target: 'button.result[data-site="curiosity-current"]',
    done: () => view() === 'mars' && param('sel') === 'site:curiosity-current',
  },
  // A site on the ground: the camera glides to it, no following.
  { text: 'tutorial.mars.observe', observe: 'look' },
  // The solar system: Saturn, then Voyager 1.
  {
    text: 'tutorial.solar.tab',
    target: '.view-tabs button[data-view="solar"]',
    done: () => view() === 'solar',
  },
  {
    text: 'tutorial.solar.saturn',
    target: 'button.result[data-planet="saturn"]',
    done: () => view() === 'solar' && param('sel') === 'saturn',
  },
  { text: 'tutorial.solar.saturnObserve', observe: 'look' },
  { text: 'tutorial.solar.saturnFollow', target: FOLLOW_BUTTON, select: 'saturn', done: following },
  { text: 'tutorial.solar.saturnFollowObserve', observe: 'look' },
  {
    text: 'tutorial.solar.voyager',
    target: 'button.result[data-mission="voyager-1"]',
    done: () => view() === 'solar' && param('sel') === 'voyager-1',
  },
  { text: 'tutorial.solar.voyagerObserve', observe: 'look' },
  // The stars: Sirius and the 3D star map.
  {
    text: 'tutorial.stars.toggle',
    target: ':has(> #toggle-stars)',
    done: () => checked('toggle-stars'),
  },
  {
    text: 'tutorial.stars.sirius',
    target: '#star-list button.result[data-star="sirius"]',
    done: () => param('sel') === 'star:sirius',
  },
  // Stars are not followable: the camera turns towards Sirius.
  { text: 'tutorial.stars.siriusObserve', observe: 'look' },
  {
    text: 'tutorial.stars.map',
    select: 'star:sirius',
    target: '.side-panel.info:not([hidden]) .star-map-button',
    done: () => isOpen('dialog.star-map'),
  },
  { text: 'tutorial.stars.mapObserve', observe: 'look' },
  {
    text: 'tutorial.stars.mapClose',
    target: 'dialog.star-map[open] .dialog-actions .btn:last-child',
    done: () => !isOpen('dialog.star-map'),
  },
  // Favorites: Apollo 11.
  {
    text: 'tutorial.favorites.open',
    target: '.favorites-button',
    done: () => isOpen('dialog.favorites') || param('sel') === 'site:apollo-11',
  },
  {
    text: 'tutorial.favorites.apollo',
    target: 'dialog.favorites[open] a.favorite-link[href*="apollo-11"]',
    done: () => param('sel') === 'site:apollo-11' && !isOpen('dialog.favorites'),
  },
  { text: 'tutorial.favorites.observe', observe: 'follow' },
  // Settings: open and close.
  {
    text: 'tutorial.settings.open',
    target: '.settings-button',
    done: () => isOpen('dialog.settings'),
  },
  {
    text: 'tutorial.settings.close',
    target: 'dialog.settings[open] .settings-close',
    hole: 'dialog.settings[open]',
    done: () => !isOpen('dialog.settings'),
  },
  { text: 'tutorial.end' },
];
