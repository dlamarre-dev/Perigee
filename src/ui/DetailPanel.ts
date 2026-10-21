import type { ImageEntry, ModelEntry } from '../data/schemas';
import type { I18n } from '../i18n';
import {
  h,
  panelToggle,
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
  private followingValue = false;
  private lastSourcesKey = '';
  private readonly preview: ModelPreview;
  private readonly define: ReturnType<typeof labelDefinitions>;

  constructor(
    private readonly i18n: I18n,
    callbacks: DetailPanelCallbacks,
  ) {
    this.close.addEventListener('click', callbacks.onClose);
    this.follow.addEventListener('click', callbacks.onToggleFollow);
    this.action.addEventListener('click', () => this.actionRun?.());
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
        this.preview.element,
        this.badge,
        this.fields,
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

  show(content: DetailContent, focus = false): void {
    const wasHidden = this.element.hidden;
    this.element.hidden = false;
    // Opening (not the periodic refresh) shows the whole sheet on phones.
    if (wasHidden) setPanelCollapsed(this.element, false);
    setText(this.title, content.title);
    this.preview.show(
      content.model
        ? { kind: 'model', entry: content.model }
        : (content.preview ??
            (content.image ? { kind: 'image', entry: content.image, title: content.title } : undefined)),
    );
    this.badge.hidden = !content.badge;
    if (content.badge) {
      setText(this.badge, content.badge.text);
      this.badge.dataset['state'] = content.badge.state;
    }
    syncRows(this.fields, content.rows, this.define);
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

  private renderStatic(): void {
    this.close.textContent = this.i18n.t('info.close');
    this.sourcesTitle.textContent = this.i18n.t('info.sources');
    this.following = this.followingValue;
  }
}
