/**
 * Responsive bars that degrade step by step instead of wrapping: each bar has ordered presentation levels
 * (`data-fit`), from the fullest to the most compact; the first level whose items all sit on one row is kept.
 * Measured rather than set by fixed breakpoints, so it adapts to the language (French labels are longer), the
 * fonts and the buttons a view shows.
 */

/** Items laid out by `el`: its children, looking through `display: contents` wrappers. */
function layoutItems(el: Element, out: HTMLElement[] = []): HTMLElement[] {
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue;
    const display = getComputedStyle(child).display;
    if (display === 'contents') layoutItems(child, out);
    else if (display !== 'none') out.push(child);
  }
  return out;
}

/** True when every laid-out item (except skipped ones) shares one horizontal band: no wrapped second row. */
export function onOneRow(el: HTMLElement, skip: (item: HTMLElement) => boolean = () => false): boolean {
  let maxTop = -Infinity;
  let minBottom = Infinity;
  for (const item of layoutItems(el)) {
    if (skip(item)) continue;
    const r = item.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    maxTop = Math.max(maxTop, r.top);
    minBottom = Math.min(minBottom, r.bottom);
  }
  return maxTop < minBottom;
}

/**
 * Applies `levels` in order (as `data-fit`) and keeps the first one that `fits`; the last level is the fallback.
 * Returns the level kept.
 */
export function fitLevels(
  el: HTMLElement,
  levels: readonly string[],
  fits: (level: string) => boolean,
): string {
  for (const level of levels) {
    el.dataset['fit'] = level;
    if (fits(level)) return level;
  }
  return el.dataset['fit'] ?? '';
}

/**
 * Re-runs `fit` when the window resizes, the fonts finish loading, or `extra` changes are signalled; batched to
 * one run per frame.
 */
export function watchFit(fit: () => void): () => void {
  let pending = false;
  const schedule = (): void => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fit();
    });
  };
  window.addEventListener('resize', schedule);
  void document.fonts?.ready.then(schedule);
  schedule();
  return schedule;
}
