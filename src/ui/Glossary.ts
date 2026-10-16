import type { I18n, Lang } from '../i18n';
import { GLOSSARY, LABEL_TERMS, type GlossaryTerm } from '../i18n/glossary';
import { h, scrollingDialog, type LabelDefinition } from './dom';

const termsByLabel = new Map<Lang, Map<string, GlossaryTerm>>();

/**
 * The definition of a detail-panel label, found from its text in the current language (the panels' rows carry
 * translated labels only).
 */
export function termForLabel(i18n: I18n, label: string): GlossaryTerm | undefined {
  let byLabel = termsByLabel.get(i18n.lang);
  if (!byLabel) {
    byLabel = new Map();
    for (const [key, term] of Object.entries(LABEL_TERMS)) byLabel.set(i18n.maybe(key) ?? key, term);
    termsByLabel.set(i18n.lang, byLabel);
  }
  return byLabel.get(label);
}

/** Centred dialog with the definition of a field label, like About (full width on phones). */
class GlossaryDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'glossary-title', tabindex: -1 });
  private readonly text = h('p', { id: 'glossary-text' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private current: { term: GlossaryTerm; label: string } | undefined;

  constructor(private readonly i18n: I18n) {
    this.close.addEventListener('click', () => this.element.close());
    this.element = h(
      'dialog',
      {
        class: 'panel about glossary',
        'aria-labelledby': 'glossary-title',
        'aria-describedby': 'glossary-text',
      },
      [this.title, this.text, h('div', { class: 'dialog-actions' }, [this.close])],
    );
    scrollingDialog(this.element);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    i18n.onChange(() => this.render());
  }

  open(term: GlossaryTerm, label: string): void {
    this.current = { term, label };
    this.render();
    if (!this.element.open) this.element.showModal();
    this.title.focus({ preventScroll: true });
  }

  private render(): void {
    this.close.textContent = this.i18n.t('about.close');
    if (!this.current) return;
    // The label is shown as clicked; a language switch while open keeps the definition in step.
    this.title.textContent = this.current.label;
    this.text.textContent = GLOSSARY[this.current.term][this.i18n.lang];
  }
}

let dialog: GlossaryDialog | undefined;

/** Opens the definition of `term` (the dialog is created on first use, beside the other dialogs). */
export function openDefinition(i18n: I18n, term: GlossaryTerm, label: string): void {
  if (!dialog) {
    dialog = new GlossaryDialog(i18n);
    (document.getElementById('app') ?? document.body).append(dialog.element);
  }
  dialog.open(term, label);
}

/** `syncRows` definitions of the detail panels' labels, in the current language. */
export function labelDefinitions(i18n: I18n): (label: string, term?: string) => LabelDefinition | undefined {
  return (label, given) => {
    const term = given && given in GLOSSARY ? (given as GlossaryTerm) : termForLabel(i18n, label);
    return term && { term, hint: i18n.format('glossary.open', { label }) };
  };
}

/**
 * Makes the defined labels of a fields list (`syncRows`) open their definition: one listener on the list, so
 * rows rebuilt by live updates need no wiring.
 */
export function enableDefinitions(dl: HTMLElement, i18n: I18n): void {
  dl.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLElement>('button[data-term]');
    const term = button?.dataset['term'] as GlossaryTerm | undefined;
    if (button && term && term in GLOSSARY) openDefinition(i18n, term, button.textContent ?? '');
  });
}
