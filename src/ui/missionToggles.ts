/**
 * Which missions are drawn in the Moon, Mars and solar views: a checkbox next to each mission button, and
 * "all" / "none" buttons above the active and the inactive lists. Inactive spacecraft (`isInactiveMission`) are
 * hidden by default (URL: `src/app/hiddenMissions.ts`).
 */
import { isInactiveMission, type Mission } from '../data/schemas';
import type { I18n } from '../i18n';
import { h } from './dom';

export class MissionToggles {
  private readonly hiddenIds: Set<string>;
  /** Checkboxes of the latest render, by mission id. */
  private readonly boxes = new Map<string, HTMLInputElement>();
  private readonly labels: (() => void)[] = [];
  /** Toolbar placed above the active missions. */
  readonly toolbar: HTMLElement;
  /** Toolbar placed above the inactive missions. */
  readonly inactiveToolbar: HTMLElement;

  constructor(
    private readonly i18n: I18n,
    private readonly missions: () => readonly Mission[],
    hidden: ReadonlySet<string>,
    private readonly onChange: (hidden: ReadonlySet<string>) => void,
  ) {
    this.hiddenIds = new Set(hidden);
    this.toolbar = this.makeToolbar((m) => !isInactiveMission(m));
    this.inactiveToolbar = this.makeToolbar(isInactiveMission);
    this.renderLabels();
  }

  get hidden(): ReadonlySet<string> {
    return this.hiddenIds;
  }

  renderLabels(): void {
    for (const render of this.labels) render();
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

  /** Draws a hidden mission again (it was just selected); no-op when it is shown. */
  show(id: string): void {
    if (!this.hiddenIds.delete(id)) return;
    const box = this.boxes.get(id);
    if (box) box.checked = true;
    this.onChange(this.hiddenIds);
  }

  private makeToolbar(group: (m: Mission) => boolean): HTMLElement {
    const all = h('button', { type: 'button', class: 'btn small' });
    const none = h('button', { type: 'button', class: 'btn small' });
    all.addEventListener('click', () => this.setAll(group, true));
    none.addEventListener('click', () => this.setAll(group, false));
    this.labels.push(() => {
      all.textContent = this.i18n.t('missions.showAll');
      none.textContent = this.i18n.t('missions.showNone');
    });
    return h('p', { class: 'mission-toggles' }, [all, none]);
  }

  private setAll(group: (m: Mission) => boolean, visible: boolean): void {
    for (const m of this.missions().filter(group)) {
      if (visible) this.hiddenIds.delete(m.id);
      else this.hiddenIds.add(m.id);
      const box = this.boxes.get(m.id);
      if (box) box.checked = visible;
    }
    this.onChange(this.hiddenIds);
  }
}
