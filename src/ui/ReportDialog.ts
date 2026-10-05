/**
 * "Report a problem" dialog: bug, wrong data, suggestion or comment, an optional e-mail address to reply to, and
 * a description. The site is static, so reports are relayed by e-mail through Web3Forms (https://web3forms.com):
 * the access key is tied to the maintainer's address and is public by design (it can only send to them).
 * Nothing is sent until the visitor submits; the attached context is shown before sending.
 */
import type { I18n, MessageKey } from '../i18n';
import { pixelRatio } from '../render/pixelRatio';
import { qualityState } from '../render/quality';
import { h } from './dom';

export const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';
const WEB3FORMS_ACCESS_KEY = 'a2aa504d-8bd4-4c69-b920-bdeaa147da0c';

export const REPORT_TYPES = ['bug', 'data', 'suggestion', 'comment'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 5000;

export interface ReportContext {
  readonly url: string;
  readonly build: string;
  readonly lang: string;
  readonly viewport: string;
  /** Quality tier in effect, how it was chosen, and the GPU (helps with device-specific problems). */
  readonly quality: string;
}

/** Web3Forms JSON payload (pure, tested). An empty e-mail is left out; `botcheck` is the anti-spam honeypot. */
export function buildReport(
  type: ReportType,
  message: string,
  email: string,
  context: ReportContext,
  botcheck = '',
): Record<string, string | boolean> {
  const text = message.trim();
  const mail = email.trim();
  const firstLine = text.split('\n')[0] ?? '';
  return {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `[Perigee] ${type}: ${firstLine.slice(0, 60)}${firstLine.length > 60 ? '…' : ''}`,
    from_name: 'Perigee',
    type,
    message: text,
    ...(mail ? { email: mail } : {}),
    page: context.url,
    build: context.build,
    lang: context.lang,
    viewport: context.viewport,
    quality: context.quality,
    botcheck: botcheck !== '',
  };
}

/** E.g. "quality medium (auto: touch device), render ×1.75, GPU PowerVR D-Series DXT-48-1536". */
export function qualitySummary(): string {
  const q = qualityState();
  if (!q) return 'quality unknown';
  const how = q.choice === 'auto' ? `auto: ${q.detected.reasons.join(', ')}` : 'chosen';
  return `quality ${q.settings.tier} (${how}), render ×${pixelRatio()}, GPU ${q.signals.gpu ?? 'unknown'}`;
}

export class ReportDialog {
  readonly element: HTMLDialogElement;
  private readonly title = h('h2', { id: 'report-title' });
  private readonly intro = h('p', { class: 'small' });
  private readonly typeLegend = h('legend');
  private readonly typeLabels = new Map<ReportType, HTMLElement>();
  private readonly typeInputs = new Map<ReportType, HTMLInputElement>();
  private readonly messageLabel = h('label', { for: 'report-message' });
  private readonly message = h('textarea', {
    id: 'report-message',
    class: 'input',
    rows: 6,
    required: true,
    minlength: MESSAGE_MIN,
    maxlength: MESSAGE_MAX,
  });
  private readonly emailLabel = h('label', { for: 'report-email' });
  private readonly email = h('input', {
    id: 'report-email',
    class: 'input',
    type: 'email',
    autocomplete: 'email',
    'aria-describedby': 'report-email-note',
  });
  private readonly emailNote = h('p', { class: 'muted small', id: 'report-email-note' });
  /** Honeypot: hidden from people, filled by naive bots. */
  private readonly botcheck = h('input', {
    type: 'checkbox',
    name: 'botcheck',
    class: 'visually-hidden',
    tabindex: -1,
    'aria-hidden': 'true',
  });
  private readonly contextTitle = h('summary');
  private readonly contextList = h('ul', { class: 'small' });
  private readonly status = h('p', { class: 'small report-status', role: 'status', 'aria-live': 'polite' });
  private readonly send = h('button', { type: 'submit', class: 'btn' });
  private readonly close = h('button', { type: 'button', class: 'btn' });
  private readonly form: HTMLFormElement;

  constructor(private readonly i18n: I18n) {
    const radios = REPORT_TYPES.map((type, i) => {
      const id = `report-type-${type}`;
      const input = h('input', { type: 'radio', name: 'report-type', id, value: type, checked: i === 0 });
      const label = h('label', { for: id });
      this.typeInputs.set(type, input);
      this.typeLabels.set(type, label);
      return h('span', { class: 'report-type' }, [input, label]);
    });
    this.form = h('form', { class: 'report-form', novalidate: false }, [
      h('fieldset', { class: 'report-types' }, [this.typeLegend, ...radios]),
      this.messageLabel,
      this.message,
      this.emailLabel,
      this.email,
      this.emailNote,
      this.botcheck,
      h('details', { class: 'report-context' }, [this.contextTitle, this.contextList]),
      this.status,
      h('div', { class: 'dialog-actions' }, [this.close, this.send]),
    ]);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.close.addEventListener('click', () => this.element.close());
    this.element = h('dialog', { class: 'panel about report', 'aria-labelledby': 'report-title' }, [
      this.title,
      this.intro,
      this.form,
    ]);
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.element.close();
    });
    i18n.onChange(() => this.renderLabels());
    this.renderLabels();
  }

  open(): void {
    this.status.textContent = '';
    this.renderContext();
    this.element.showModal();
    this.message.focus();
  }

  private context(): ReportContext {
    const build = __PERIGEE_BUILD__;
    return {
      url: window.location.href,
      build: `${build.commit} (${build.date})`,
      lang: this.i18n.lang,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
      quality: qualitySummary(),
    };
  }

  private renderContext(): void {
    const c = this.context();
    this.contextList.replaceChildren(
      ...[c.url, c.build, c.lang, c.viewport, c.quality].map((v) => h('li', {}, [v])),
    );
  }

  private selectedType(): ReportType {
    return REPORT_TYPES.find((t) => this.typeInputs.get(t)?.checked) ?? 'bug';
  }

  private async submit(): Promise<void> {
    if (!this.form.reportValidity()) return;
    const t = this.i18n.t.bind(this.i18n);
    this.send.disabled = true;
    this.status.dataset['state'] = 'sending';
    this.status.textContent = t('report.sending');
    try {
      const payload = buildReport(
        this.selectedType(),
        this.message.value,
        this.email.value,
        this.context(),
        this.botcheck.checked ? 'on' : '',
      );
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean };
      if (!res.ok || body.success === false) throw new Error(`HTTP ${res.status}`);
      this.status.dataset['state'] = 'sent';
      this.status.textContent = t('report.sent');
      this.message.value = '';
      this.email.value = '';
    } catch (err) {
      console.warn('Report not sent', err);
      this.status.dataset['state'] = 'error';
      this.status.textContent = t('report.error');
    } finally {
      this.send.disabled = false;
    }
  }

  private renderLabels(): void {
    const t = (k: MessageKey): string => this.i18n.t(k);
    this.title.textContent = t('report.title');
    this.intro.textContent = t('report.intro');
    this.typeLegend.textContent = t('report.type');
    for (const type of REPORT_TYPES) {
      const label = this.typeLabels.get(type);
      if (label) label.textContent = t(`report.type.${type}`);
    }
    this.messageLabel.textContent = t('report.message');
    this.message.placeholder = t('report.messagePlaceholder');
    this.emailLabel.textContent = t('report.email');
    this.emailNote.textContent = t('report.emailNote');
    this.contextTitle.textContent = t('report.context');
    this.send.textContent = t('report.send');
    this.close.textContent = t('info.close');
  }
}
