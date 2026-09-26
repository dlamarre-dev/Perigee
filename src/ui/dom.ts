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
