/**
 * Which missions are drawn in the Moon, Mars and solar views: a checkbox next to each mission button, and
 * "all" / "none" buttons. The state is a set of hidden mission ids (the URL keeps it short: `hide=a,b`).
 */
import type { Mission } from '../data/schemas';
import type { I18n } from '../i18n';
import { h } from './dom';

export class MissionToggles {
  private readonly hiddenIds: Set<string>;
  /** Checkboxes of the latest render, by mission id. */
  private readonly boxes = new Map<string, HTMLInputElement>();
  private readonly allButton = h('button', { type: 'button', class: 'btn small' });
  private readonly noneButton = h('button', { type: 'button', class: 'btn small' });
  /** Toolbar placed above the mission list. */
  readonly toolbar = h('p', { class: 'mission-toggles' }, [this.allButton, this.noneButton]);

  constructor(
    private readonly i18n: I18n,
    private readonly missions: () => readonly Mission[],
    hidden: ReadonlySet<string>,
    private readonly onChange: (hidden: ReadonlySet<string>) => void,
  ) {
    this.hiddenIds = new Set(hidden);
    this.allButton.addEventListener('click', () => this.setAll(true));
    this.noneButton.addEventListener('click', () => this.setAll(false));
    this.renderLabels();
  }

  get hidden(): ReadonlySet<string> {
    return this.hiddenIds;
  }

  renderLabels(): void {
    this.allButton.textContent = this.i18n.t('missions.showAll');
    this.noneButton.textContent = this.i18n.t('missions.showNone');
  }

  /** List item: the visibility checkbox, then the mission's selection button. */
  row(mission: Mission, button: HTMLElement): HTMLLIElement {
    const box = h('input', {
      type: 'checkbox',
      class: 'mission-toggle',
      'data-toggle': mission.id,
      checked: !this.hiddenIds.has(mission.id),
    });
    box.setAttribute(
      'aria-label',
      this.i18n.format('missions.toggle', { name: mission.name[this.i18n.lang] }),
    );
    this.boxes.set(mission.id, box);
    box.addEventListener('change', () => {
      if (box.checked) this.hiddenIds.delete(mission.id);
      else this.hiddenIds.add(mission.id);
      this.onChange(this.hiddenIds);
    });
    return h('li', { class: 'toggle-row' }, [box, button]);
  }

  private setAll(visible: boolean): void {
    this.hiddenIds.clear();
    if (!visible) for (const m of this.missions()) this.hiddenIds.add(m.id);
    for (const box of this.boxes.values()) box.checked = visible;
    this.onChange(this.hiddenIds);
  }
}

/** `hide=a,b` → set of ids. */
export function parseHiddenMissions(params: URLSearchParams): Set<string> {
  return new Set(
    (params.get('hide') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function writeHiddenMissions(params: URLSearchParams, hidden: ReadonlySet<string>): void {
  if (hidden.size > 0) params.set('hide', [...hidden].sort().join(','));
}
