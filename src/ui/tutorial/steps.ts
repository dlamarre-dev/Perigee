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
}

const param = (key: string): string | null => new URLSearchParams(window.location.search).get(key);
const view = (): string => param('view') ?? 'earth';
const isOpen = (selector: string): boolean => document.querySelector(`${selector}[open]`) !== null;
const checked = (id: string): boolean => document.querySelector<HTMLInputElement>(`#${id}`)?.checked === true;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
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
  { text: 'tutorial.iss.observe', observe: 'follow' },
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
  { text: 'tutorial.moon.observe', observe: 'follow' },
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
  { text: 'tutorial.mars.observe', observe: 'follow' },
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
  { text: 'tutorial.solar.saturnObserve', observe: 'follow' },
  {
    text: 'tutorial.solar.voyager',
    target: 'button.result[data-mission="voyager-1"]',
    done: () => view() === 'solar' && param('sel') === 'voyager-1',
  },
  { text: 'tutorial.solar.voyagerObserve', observe: 'follow' },
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
  {
    text: 'tutorial.stars.map',
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
    done: () => !isOpen('dialog.settings'),
  },
  { text: 'tutorial.end' },
];
