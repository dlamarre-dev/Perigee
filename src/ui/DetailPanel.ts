import type { ImageEntry, ModelEntry } from '../data/schemas';
import type { I18n } from '../i18n';
import {
  h,
  markCurrent,
  panelToggle,
  scrollPanelToTop,
  setPanelCollapsed,
  setText,
  sidePanel,
  sourceItems,
  syncRows,
  type WebsiteLink,
} from './dom';
import type { GlossaryTerm } from '../i18n/glossary';
import { enableDefinitions, labelDefinitions } from './Glossary';
import { ModelPreview, type PreviewSubject } from './ModelPreview';

export type BadgeState = 'fresh' | 'stale' | 'invalid';

export interface DetailContent {
  readonly title: string;
  readonly badge?: { readonly text: string; readonly state: BadgeState };
  /** The optional third item names a glossary term for a label whose text alone is ambiguous. */
  readonly rows: readonly (readonly [label: string, value: string, term?: GlossaryTerm])[];
  /** Main objectives of a mission, shown before the notes. */
  readonly goals?: string;
  readonly notes?: string;
  /** The mission's main page, listed first among the sources. */
  readonly website?: WebsiteLink;
  /** Its 3D model on the publisher's site (catalog `model3d`), listed after the main page. */
  readonly model3d?: { readonly url: string };
  readonly sources?: readonly string[];
  readonly footnote?: string;
  /** Show the Follow button. */
  readonly followable: boolean;
  /** NASA 3D model shown at the top of the panel. */
  readonly model?: ModelEntry;
  /** Otherwise: a celestial body in 3D, or a star illustration. */
  readonly preview?: PreviewSubject;
  /** Otherwise: a representative image (catalog/images.json). */
  readonly image?: ImageEntry;
  /** Optional secondary action (e.g. apply a filter). */
  readonly action?: { readonly label: string; readonly run: () => void };
  /**
   * Two tabs under the title: the object itself and one of its parts (a body and one of its landing sites), so the
   * camera keeps following the object while the panel describes the part. `sub` undefined: none chosen yet.
   */
  readonly tabs?: DetailTabs;
  /** A list behind a checkbox, under the rows (a body's landing sites), like the star lists of the side panel. */
  readonly list?: DetailList;
}

export type DetailTab = 'main' | 'sub';

/** What the panel describes: its title, or the part shown in the second tab (a site of the body in the title). */
function subjectTitle(content: DetailContent): string {
  const tabs = content.tabs;
  return tabs?.active === 'sub' && tabs.sub !== undefined ? tabs.sub : content.title;
}

export interface DetailTabs {
  readonly main: string;
  readonly sub: string | undefined;
  /** Second tab's name while none is chosen (disabled). */
  readonly subPlaceholder: string;
  readonly active: DetailTab;
  readonly onSelect: (tab: DetailTab) => void;
}

export interface DetailList {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  readonly items: readonly { readonly key: string; readonly name: string; readonly detail: string }[];
  readonly current: string | undefined;
  readonly onPick: (key: string) => void;
}

export interface DetailPanelCallbacks {
  readonly onClose: () => void;
  readonly onToggleFollow: () => void;
}

/** Right-hand panel describing the selected object of a view. Escape closes it. */
export class DetailPanel {
  readonly element: HTMLElement;
  private readonly title = h('h2', { class: 'panel-title', id: 'detail-title', tabindex: -1 });
  private readonly badge = h('p', { class: 'freshness' });
  private readonly fields = h('dl', { class: 'fields' });
  private readonly goals = h('p', { class: 'small goals' });
  private readonly notes = h('p', { class: 'small' });
  private readonly sourcesTitle = h('h3', { class: 'results-title' });
  private readonly sources = h('ul', { class: 'sources small' });
  private readonly footnote = h('p', { class: 'muted small' });
  private readonly follow = h('button', { type: 'button', class: 'btn' });
  private readonly action = h('button', { type: 'button', class: 'btn' });
  private actionRun: (() => void) | undefined;
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private readonly tabMain = h('button', {
    type: 'button',
    class: 'btn',
    role: 'tab',
    id: 'detail-tab-main',
  });
  private readonly tabSub = h('button', { type: 'button', class: 'btn', role: 'tab', id: 'detail-tab-sub' });
  private readonly tabBar = h('div', { class: 'segmented detail-tabs', role: 'tablist', hidden: true }, [
    this.tabMain,
    this.tabSub,
  ]);
  private tabSelect: ((tab: DetailTab) => void) | undefined;
  private readonly listToggle = h('input', { type: 'checkbox', id: 'detail-list-toggle' });
  private readonly listLabel = h('label', { for: 'detail-list-toggle' });
  private readonly listRow = h('p', { class: 'search-row detail-list-row', hidden: true }, [
    this.listToggle,
    this.listLabel,
  ]);
  private readonly list = h('ul', { class: 'results moon-list detail-list', id: 'detail-list' });
  private listKey = '';
  private listToggled: ((open: boolean) => void) | undefined;
  private listPicked: ((key: string) => void) | undefined;
  private followingValue = false;
  private lastSourcesKey = '';
  private subject: string | undefined;
  private readonly preview: ModelPreview;
  private readonly define: ReturnType<typeof labelDefinitions>;

  constructor(
    private readonly i18n: I18n,
    callbacks: DetailPanelCallbacks,
  ) {
    this.close.addEventListener('click', callbacks.onClose);
    this.follow.addEventListener('click', callbacks.onToggleFollow);
    this.action.addEventListener('click', () => this.actionRun?.());
    this.tabMain.addEventListener('click', () => this.tabSelect?.('main'));
    this.tabSub.addEventListener('click', () => this.tabSelect?.('sub'));
    this.listToggle.setAttribute('aria-controls', 'detail-list');
    this.listToggle.addEventListener('change', () => {
      this.list.hidden = !this.listToggle.checked;
      this.listToggled?.(this.listToggle.checked);
    });
    this.list.addEventListener('click', (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset['key'];
      if (key) this.listPicked?.(key);
    });
    this.define = labelDefinitions(i18n);
    enableDefinitions(this.fields, i18n);
    this.preview = new ModelPreview(i18n, import.meta.env.BASE_URL);
    this.element = sidePanel(
      { class: 'panel side-panel info', 'aria-labelledby': 'detail-title', hidden: true },
      [
        h('div', { class: 'panel-header' }, [
          this.title,
          h('div', { class: 'panel-actions' }, [panelToggle('btn panel-minimize'), this.close]),
        ]),
        this.tabBar,
        this.preview.element,
        this.badge,
        this.fields,
        this.listRow,
        this.list,
        this.goals,
        this.notes,
        this.sourcesTitle,
        this.sources,
        this.footnote,
        h('div', { class: 'dialog-actions' }, [this.action, this.follow]),
      ],
    );
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') callbacks.onClose();
    });
    i18n.onChange(() => this.renderStatic());
    this.renderStatic();
  }

  set following(v: boolean) {
    this.followingValue = v;
    this.follow.textContent = this.i18n.t(v ? 'info.unfollow' : 'info.follow');
    this.follow.setAttribute('aria-pressed', String(v));
  }

  hide(): void {
    this.element.hidden = true;
    this.preview.show(undefined);
  }

  /**
   * `subject` identifies what the panel describes (a selection key, plus the part shown in a second tab): a new one
   * starts at the top, while the periodic refreshes of the same one keep the scroll position.
   */
  show(content: DetailContent, focus = false, subject?: string): void {
    const wasHidden = this.element.hidden;
    this.element.hidden = false;
    // Opening (not the periodic refresh) shows the whole sheet on phones.
    if (wasHidden) setPanelCollapsed(this.element, false);
    if (subject !== this.subject) {
      this.subject = subject;
      scrollPanelToTop(this.element);
    }
    setText(this.title, content.title);
    this.preview.show(
      content.model
        ? { kind: 'model', entry: content.model }
        : (content.preview ??
            (content.image
              ? { kind: 'image', entry: content.image, title: subjectTitle(content) }
              : undefined)),
    );
    this.badge.hidden = !content.badge;
    if (content.badge) {
      setText(this.badge, content.badge.text);
      this.badge.dataset['state'] = content.badge.state;
    }
    syncRows(this.fields, content.rows, this.define);
    this.showTabs(content.tabs);
    this.showList(content.list);
    this.goals.hidden = !content.goals;
    setText(this.goals, content.goals ?? '');
    this.notes.hidden = !content.notes;
    setText(this.notes, content.notes ?? '');
    // Rebuild the links only when they change, so keyboard focus survives live updates.
    const websiteLabel = this.i18n.t('info.missionPage');
    const sources = content.sources ?? [];
    const w = content.website;
    const model3d = content.model3d && { url: content.model3d.url, label: this.i18n.t('info.model3d') };
    const key = [w?.url, w?.lang, websiteLabel, model3d?.url, model3d?.label, ...sources].join('|');
    if (key !== this.lastSourcesKey) {
      this.lastSourcesKey = key;
      this.sources.replaceChildren(...sourceItems(sources, w, websiteLabel, model3d));
    }
    this.sourcesTitle.hidden = !sources.length && !w && !model3d;
    setText(this.footnote, content.footnote ?? '');
    this.follow.hidden = !content.followable;
    this.action.hidden = !content.action;
    setText(this.action, content.action?.label ?? '');
    this.actionRun = content.action?.run;
    if (focus && wasHidden) this.title.focus();
  }

  private showTabs(tabs: DetailTabs | undefined): void {
    this.tabBar.hidden = !tabs;
    this.tabSelect = tabs?.onSelect;
    if (!tabs) return;
    setText(this.tabMain, tabs.main);
    setText(this.tabSub, tabs.sub ?? tabs.subPlaceholder);
    this.tabSub.disabled = tabs.sub === undefined;
    for (const [tab, button] of [
      ['main', this.tabMain],
      ['sub', this.tabSub],
    ] as const) {
      const on = tabs.active === tab;
      button.setAttribute('aria-selected', String(on));
      button.setAttribute('aria-pressed', String(on));
    }
  }

  private showList(list: DetailList | undefined): void {
    this.listRow.hidden = !list;
    this.listToggled = list?.onToggle;
    this.listPicked = list?.onPick;
    if (!list) {
      this.list.hidden = true;
      return;
    }
    setText(this.listLabel, list.label);
    this.listToggle.checked = list.open;
    this.list.hidden = !list.open;
    // Rebuilt only when the items change, so keyboard focus survives live updates.
    const key = list.items.map((i) => `${i.key}|${i.name}|${i.detail}`).join(';');
    if (key !== this.listKey) {
      this.listKey = key;
      this.list.replaceChildren(
        ...list.items.map((i) =>
          h('li', {}, [
            h('button', { type: 'button', class: 'result', 'data-key': i.key }, [
              h('span', { class: 'result-name' }, [i.name]),
              h('span', { class: 'result-id' }, [i.detail]),
            ]),
          ]),
        ),
      );
    }
    markCurrent(this.list, (el) => el.dataset['key'] === list.current, false);
  }

  private renderStatic(): void {
    this.close.textContent = this.i18n.t('info.close');
    this.sourcesTitle.textContent = this.i18n.t('info.sources');
    this.following = this.followingValue;
  }
}
