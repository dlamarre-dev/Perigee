type Attrs = Record<string, string | boolean | number | undefined>;
type Child = Node | string;

/** Tiny hyperscript helper for native-DOM UI. Boolean `true` sets an empty attribute, `false`/undefined omits it. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  el.append(...children);
  return el;
}

/**
 * Side panel: a fixed frame (background, border, corner brackets) around a body that scrolls vertically only,
 * so the decorations do not move with the content and nothing scrolls horizontally.
 */
export function sidePanel(attrs: Attrs, children: readonly Child[]): HTMLElement {
  // Grab bar, shown on phones only (CSS): collapses the bottom sheet to its first lines and back.
  const grab = panelToggle('sheet-grab');
  return h('aside', attrs, [grab, h('div', { class: 'panel-body' }, children)]);
}

/**
 * Button collapsing its side panel to its header (larger screens; phones keep the first lines of the sheet) and
 * back. The panel, its selection and its scroll position are kept.
 */
export function panelToggle(className: string): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: className,
    'data-panel-toggle': true,
    'aria-expanded': 'true',
  });
  button.setAttribute('aria-label', panelToggleLabel);
  button.title = panelToggleLabel;
  button.addEventListener('click', () => {
    const panel = button.closest<HTMLElement>('.side-panel');
    if (panel) setPanelCollapsed(panel, !panel.classList.contains('collapsed'));
  });
  return button;
}

/** Collapses or expands `panel`, keeping its toggles' state in step. */
export function setPanelCollapsed(panel: HTMLElement, collapsed: boolean): void {
  panel.classList.toggle('collapsed', collapsed);
  for (const b of panel.querySelectorAll('[data-panel-toggle]'))
    b.setAttribute('aria-expanded', String(!collapsed));
}

let panelToggleLabel = '';

/** Localised label of every panel's collapse toggle (set by the shell, updated on language change). */
export function setSheetGrabLabel(label: string): void {
  panelToggleLabel = label;
  for (const b of document.querySelectorAll<HTMLElement>('[data-panel-toggle]')) {
    b.setAttribute('aria-label', label);
    b.title = label;
  }
}

/**
 * Marks the list buttons of `root` matching `isCurrent` with aria-current (styled as the selection) and, when
 * `scroll` is set, brings the first match into view.
 */
export function markCurrent(
  root: HTMLElement,
  isCurrent: (el: HTMLElement) => boolean,
  scroll: boolean,
): void {
  let first: HTMLElement | undefined;
  for (const el of root.querySelectorAll<HTMLElement>('.result')) {
    const on = isCurrent(el);
    if (on) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
    if (on && !first) first = el;
  }
  if (scroll && first) first.scrollIntoView({ block: 'nearest' });
}

/** A label with a definition: the term opening it and the button's tooltip. */
export interface LabelDefinition {
  readonly term: string;
  readonly hint: string;
}

/**
 * Shows label/value rows in a <dl>, refreshed several times a second: the existing <dt>/<dd> nodes are reused
 * and only changed texts are written (no node churn, no style work for unchanged rows). Rebuilt when the
 * number of rows changes. Labels `define` knows (or given a term as the row's third item) become buttons,
 * underlined like links, opening their definition
 * (src/ui/Glossary.ts `enableDefinitions`).
 */
export function syncRows(
  dl: HTMLElement,
  rows: readonly (readonly [label: string, value: string, term?: string])[],
  define?: (label: string, term?: string) => LabelDefinition | undefined,
): void {
  const nodes = dl.children;
  const reusable =
    nodes.length === rows.length * 2 &&
    rows.every((_, i) => nodes[2 * i]?.tagName === 'DT' && nodes[2 * i + 1]?.tagName === 'DD');
  if (!reusable) {
    dl.replaceChildren(
      ...rows.flatMap(([k, v, term]) => {
        const dt = h('dt');
        fillLabel(dt, k, define?.(k, term));
        return [dt, h('dd', {}, [v])];
      }),
    );
    return;
  }
  rows.forEach(([k, v, term], i) => {
    const dt = nodes[2 * i];
    const dd = nodes[2 * i + 1];
    if (dt instanceof HTMLElement) {
      const definition = define?.(k, term);
      // Same text in both languages (NORAD, Altitude…): the tooltip still follows the language.
      const hint = dt.firstElementChild?.getAttribute('title') ?? undefined;
      if (dt.textContent !== k || hint !== definition?.hint) fillLabel(dt, k, definition);
    }
    if (dd && dd.textContent !== v) dd.textContent = v;
  });
}

function fillLabel(dt: HTMLElement, label: string, definition: LabelDefinition | undefined): void {
  if (!definition) {
    dt.textContent = label;
    return;
  }
  dt.replaceChildren(
    h(
      'button',
      {
        type: 'button',
        class: 'term',
        'data-term': definition.term,
        'aria-haspopup': 'dialog',
        title: definition.hint,
      },
      [label],
    ),
  );
}

/** A mission's main page (catalog `website`). */
export interface WebsiteLink {
  readonly url: string;
  readonly lang?: string | undefined;
}

/**
 * Source links of a panel: the mission's main page first ("science.nasa.gov · mission page", with the page's
 * language code when it is neither English nor French), then its 3D model on the publisher's site
 * ("scifleet.esa.int · 3D model", not in the phone layout), then the other sources (hostnames).
 */
export function sourceItems(
  sources: readonly string[],
  website: WebsiteLink | undefined,
  websiteLabel: string,
  model3d?: { readonly url: string; readonly label: string },
): HTMLLIElement[] {
  const link = (url: string): HTMLAnchorElement =>
    h('a', { href: url, target: '_blank', rel: 'noopener' }, [new URL(url).hostname]);
  const items = sources.filter((u) => u !== website?.url).map((url) => h('li', {}, [link(url)]));
  // Hidden in the phone layout (styles.css): SciFleet's Unity viewer warns that phones are not supported.
  if (model3d) items.unshift(h('li', { class: 'model3d-link' }, [link(model3d.url), ` · ${model3d.label}`]));
  if (website) {
    const lang = website.lang ? ` (${website.lang})` : '';
    items.unshift(h('li', {}, [link(website.url), `${lang} · ${websiteLabel}`]));
  }
  return items;
}

/** Writes an element's text only when it changed (periodic refreshes then cost no DOM mutation). */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Moves a dialog's content into a scrolling body: the dialog itself (its border and corner brackets) stays put
 * and only the body scrolls, so the bottom-right bracket stays at the window's corner.
 */
export function scrollingDialog(dialog: HTMLDialogElement): HTMLDialogElement {
  const body = h('div', { class: 'dialog-body' });
  body.append(...dialog.childNodes);
  dialog.append(body);
  return dialog;
}
