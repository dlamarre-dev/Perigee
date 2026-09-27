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
  return h('aside', attrs, [h('div', { class: 'panel-body' }, children)]);
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
