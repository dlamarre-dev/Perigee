/**
 * Welcome window, in About's frame, shown once to a new visitor (src/app/main.ts decides when): what Perigee
 * shows, then two choices, the guided tour (src/ui/tutorial/Tutorial.ts) or exploring freely. However it closes
 * (a choice, Escape, the backdrop), `perigee-welcome` is stored so it does not come back.
 */
import type { I18n } from '../i18n';
import { h, scrollingDialog, setText } from './dom';

export const WELCOME_KEY = 'perigee-welcome';

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** True once the visitor has seen the welcome window (or when storage is unavailable: never nag). */
export function welcomeSeen(): boolean {
  try {
    const store = storage();
    return !store || store.getItem(WELCOME_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    storage()?.setItem(WELCOME_KEY, '1');
  } catch {
    // Private mode or blocked storage: it shows again next time, nothing else breaks.
  }
}

export class WelcomeDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'welcome-title', tabindex: -1 });
  private readonly text = h('p', {});
  private readonly question = h('p', { class: 'muted' });
  private readonly tutorial = h('button', { type: 'button', class: 'btn primary welcome-tutorial' });
  private readonly explore = h('button', { type: 'button', class: 'btn welcome-explore' });
  private choice: 'tutorial' | 'explore' = 'explore';

  constructor(
    private readonly i18n: I18n,
    onTutorial: () => void,
  ) {
    // Stored at once (the dialog's `close` event comes a task later): a reload right after does not show it again.
    this.tutorial.addEventListener('click', () => {
      this.choice = 'tutorial';
      markSeen();
      this.element.close();
    });
    this.explore.addEventListener('click', () => {
      this.choice = 'explore';
      markSeen();
      this.element.close();
    });
    this.element = h('dialog', { class: 'panel about welcome', 'aria-labelledby': 'welcome-title' }, [
      this.title,
      this.text,
      this.question,
      h('div', { class: 'dialog-actions welcome-actions' }, [this.explore, this.tutorial]),
    ]);
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        markSeen();
        this.element.close();
      }
    });
    this.element.addEventListener('cancel', () => markSeen());
    this.element.addEventListener('close', () => {
      markSeen();
      if (this.choice === 'tutorial') onTutorial();
    });
    i18n.onChange(() => this.render());
    this.render();
  }

  open(): void {
    this.choice = 'explore';
    this.element.showModal();
    this.tutorial.focus({ preventScroll: true });
  }

  private render(): void {
    const t = this.i18n.t.bind(this.i18n);
    setText(this.title, t('welcome.title'));
    setText(this.text, t('welcome.text'));
    setText(this.question, t('welcome.question'));
    setText(this.tutorial, t('welcome.tutorial'));
    setText(this.explore, t('welcome.explore'));
  }
}
