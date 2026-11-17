/**
 * Guided tour, like a mobile game's first-time experience: one control at a time is lit (a "hole" in a dimmed
 * layer) and everything else is blocked until the visitor uses it; after each object is shown, the blockers lift so
 * the visitor can look around (the camera following it) and press Next. A Quit button ends it at any time.
 *
 * The layer is a manual popover, so it sits in the top layer; when a modal dialog opens (favorites, settings, the
 * star map) the layer moves into it and is shown again, staying above it and outside its inert zone. Targets are
 * found by selector every frame (panels rebuild their rows), and what stands between the visitor and a target (the
 * ☰ menu, a closed side panel, a phone's detail sheet covering the list, a closed section) becomes the lit control
 * first. Nothing is stored; the steps live in ./steps.ts.
 */
import type { I18n, MessageKey } from '../../i18n';
import { h, setText } from '../dom';
import { TUTORIAL_STEPS, type TutorialStep } from './steps';

export interface TutorialHost {
  /** Moves the app to a link (query string), as a favorite does. */
  readonly openLink: (query: string) => Promise<void>;
  /** Follows the current selection, when it is not followed yet. */
  readonly startFollow: () => void;
}

/** Space between a lit control and the hole's edge (px). */
const HOLE_PAD_PX = 4;
const CARD_GAP_PX = 12;
/** Pointer events the dimmed layer swallows, so nothing under it reacts (menus closing on outside clicks…). */
const BLOCKED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'touchstart',
  'touchmove',
] as const;

interface Reached {
  readonly el: Element;
  /** Caption for an intermediate control (menu, panel…); the step's own text otherwise. */
  readonly caption?: MessageKey | undefined;
}

const visible = (el: Element): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;

const query = (selector: string): Element | null => {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
};

export class Tutorial {
  private readonly layer = h('div', {
    class: 'tutorial',
    popover: 'manual',
    role: 'dialog',
    'aria-modal': 'false',
  });
  private readonly blocks: readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement] = [
    h('div', { class: 'tutorial-block' }),
    h('div', { class: 'tutorial-block' }),
    h('div', { class: 'tutorial-block' }),
    h('div', { class: 'tutorial-block' }),
  ];
  private readonly ring = h('div', { class: 'tutorial-ring', 'aria-hidden': 'true' });
  private readonly count = h('p', { class: 'tutorial-count' });
  private readonly text = h('p', { class: 'tutorial-text', 'aria-live': 'polite' });
  private readonly next = h('button', { type: 'button', class: 'btn primary tutorial-next' });
  private readonly skip = h('button', { type: 'button', class: 'btn tutorial-skip' });
  private readonly quit = h('button', { type: 'button', class: 'btn tutorial-quit' });
  private readonly card = h('div', { class: 'panel tutorial-card' }, [
    this.count,
    this.text,
    h('div', { class: 'tutorial-actions' }, [this.quit, this.skip, this.next]),
  ]);
  private index = 0;
  private active = false;
  private frame = 0;
  /** The dialog the layer was last shown in (undefined: the page). */
  private host: HTMLDialogElement | undefined;
  private lastTarget: Element | undefined;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);

  constructor(
    private readonly i18n: I18n,
    private readonly app: TutorialHost,
    private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {
    this.layer.append(...this.blocks, this.ring, this.card);
    for (const type of BLOCKED_EVENTS)
      this.layer.addEventListener(
        type,
        (e) => {
          e.stopPropagation();
          if (e.target !== this.next && e.target !== this.skip && e.target !== this.quit && e.cancelable)
            if (type === 'wheel' || type === 'contextmenu' || type === 'touchmove') e.preventDefault();
        },
        { passive: false },
      );
    this.next.addEventListener('click', () => this.go(this.index + 1));
    this.skip.addEventListener('click', () => this.go(this.index + 1));
    this.quit.addEventListener('click', () => this.stop());
  }

  get running(): boolean {
    return this.active;
  }

  /** Starts from the Earth view in real time, whatever was on screen. */
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.index = 0;
    this.lastTarget = undefined;
    document.body.append(this.layer);
    this.show(undefined);
    window.addEventListener('keydown', this.onKey, true);
    this.render();
    await this.app.openLink('?view=earth');
    this.loop();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKey, true);
    if (this.layer.matches(':popover-open')) this.layer.hidePopover();
    this.layer.remove();
    this.host = undefined;
  }

  private go(index: number): void {
    if (index >= this.steps.length) {
      this.stop();
      return;
    }
    this.index = index;
    this.lastTarget = undefined;
    const step = this.steps[index];
    if (step?.observe === 'follow') this.app.startFollow();
    this.render();
  }

  private loop(): void {
    if (!this.active) return;
    this.tick();
    this.frame = requestAnimationFrame(() => this.loop());
  }

  /** One frame: follow the open dialogs, check the step, place the hole and the card. */
  private tick(): void {
    const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => {
      try {
        return d.matches(':modal');
      } catch {
        return true;
      }
    });
    const top = dialogs.at(-1);
    if (top !== this.host || !this.layer.matches(':popover-open')) this.show(top);
    const step = this.steps[this.index];
    if (!step) return;
    if (step.target && step.done?.()) {
      this.go(this.index + 1);
      return;
    }
    if (!step.target) {
      this.layout(undefined, true);
      return;
    }
    const target = query(step.target);
    const reached = target ? this.reach(target, undefined) : undefined;
    setText(
      this.text,
      this.i18n.t(reached ? (reached.caption ?? step.text) : target ? step.text : 'tutorial.loading'),
    );
    this.layout(reached?.el, false);
  }

  /** The control to light so that `el` can be used: `el` itself, or what hides it. */
  private reach(el: Element, caption: MessageKey | undefined): Reached | undefined {
    const sheet = el.closest<HTMLElement>('.side-panel.collapsed');
    if (visible(el) && !sheet) return { el, caption };
    if (sheet) {
      const toggle = [...sheet.querySelectorAll('[data-panel-toggle]')].find(visible);
      if (toggle) return { el: toggle, caption: 'tutorial.expand' };
    }
    // A summary is visible in its closed section: look from the section's parent.
    const from = el.matches('details > summary') ? el.parentElement?.parentElement : el.parentElement;
    const details = from?.closest('details:not([open])');
    const summary = details?.querySelector(':scope > summary');
    if (summary) return this.reach(summary, 'tutorial.openSection');
    const panel = el.closest<HTMLElement>('.side-panel');
    if (panel) {
      if (panel.hidden) {
        const toggle = query('button[aria-controls="side-panel"]');
        if (toggle) return this.reach(toggle, 'tutorial.openPanel');
      } else {
        // Phones show one sheet at a time: the detail sheet hides the list below it.
        const info = [...document.querySelectorAll<HTMLElement>('.side-panel.info')].find(
          (p) => p !== panel && !p.hidden && visible(p),
        );
        const close = info?.querySelector('.panel-actions .btn:not(.panel-minimize)');
        if (close && visible(close)) return { el: close, caption: 'tutorial.closeInfo' };
      }
    }
    if (el.closest('#toolbar-menu')) {
      const menu = query('.menu-toggle');
      if (menu && visible(menu)) return { el: menu, caption: 'tutorial.openMenu' };
    }
    return undefined;
  }

  /** Shows the layer in the top layer, inside `dialog` when one is open (outside, its page is inert). */
  private show(dialog: HTMLDialogElement | undefined): void {
    if (this.layer.matches(':popover-open')) this.layer.hidePopover();
    (dialog ?? document.body).append(this.layer);
    this.host = dialog;
    this.layer.showPopover();
  }

  private render(): void {
    const step = this.steps[this.index];
    if (!step) return;
    const total = this.steps.length;
    setText(
      this.count,
      this.i18n.format('tutorial.count', { n: String(this.index + 1), total: String(total) }),
    );
    setText(this.text, this.i18n.t(step.text));
    const last = this.index === total - 1;
    setText(this.next, this.i18n.t(last ? 'tutorial.finish' : 'tutorial.next'));
    setText(this.skip, this.i18n.t('tutorial.skip'));
    setText(this.quit, this.i18n.t('tutorial.quit'));
    this.next.hidden = Boolean(step.target);
    this.skip.hidden = !step.target;
    this.quit.hidden = last;
    this.layer.classList.toggle('observing', !step.target);
  }

  /** Places the four blocks around `el` (or over everything while it loads), the ring and the card. */
  private layout(el: Element | undefined, free: boolean): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (el && el !== this.lastTarget) {
      this.lastTarget = el;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const [top, bottom, left, right] = this.blocks;
    const place = (b: HTMLElement, x: number, y: number, w: number, hgt: number): void => {
      b.style.transform = `translate(${x}px, ${y}px)`;
      b.style.width = `${Math.max(0, w)}px`;
      b.style.height = `${Math.max(0, hgt)}px`;
    };
    for (const b of this.blocks) b.hidden = free;
    this.ring.hidden = free || !el;
    if (free) {
      this.placeCard(undefined, vw, vh);
      return;
    }
    if (!el) {
      place(top, 0, 0, vw, vh);
      for (const b of [bottom, left, right]) place(b, 0, 0, 0, 0);
      this.placeCard(undefined, vw, vh);
      return;
    }
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left - HOLE_PAD_PX);
    const y0 = Math.max(0, r.top - HOLE_PAD_PX);
    const x1 = Math.min(vw, r.right + HOLE_PAD_PX);
    const y1 = Math.min(vh, r.bottom + HOLE_PAD_PX);
    place(top, 0, 0, vw, y0);
    place(bottom, 0, y1, vw, vh - y1);
    place(left, 0, y0, x0, y1 - y0);
    place(right, x1, y0, vw - x1, y1 - y0);
    place(this.ring, x0, y0, x1 - x0, y1 - y0);
    this.placeCard({ x0, y0, x1, y1 }, vw, vh);
  }

  /** Below the hole if it fits, else above; at the top centre with no hole. */
  private placeCard(
    hole: { x0: number; y0: number; x1: number; y1: number } | undefined,
    vw: number,
    vh: number,
  ): void {
    const w = this.card.offsetWidth;
    const hgt = this.card.offsetHeight;
    let x = (vw - w) / 2;
    let y = Math.min(72, vh / 8);
    if (hole) {
      x = Math.min(Math.max(8, hole.x0), vw - w - 8);
      y =
        hole.y1 + CARD_GAP_PX + hgt <= vh - 8
          ? hole.y1 + CARD_GAP_PX
          : Math.max(8, hole.y0 - CARD_GAP_PX - hgt);
    }
    this.card.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
  }

  /** Keys: free while observing (camera keys), else only Tab, Enter and Space on the lit control; never Escape. */
  private key(e: KeyboardEvent): void {
    const inCard = e.target instanceof Node && this.card.contains(e.target);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const step = this.steps[this.index];
    if (!step?.target || inCard) return;
    const onTarget = e.target instanceof Node && this.lastTarget?.contains(e.target);
    if (onTarget && ['Tab', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
