/**
 * Labels of the keyboard's letter keys, for the controls shown in the settings window. The camera keys are read by
 * their physical position (`KeyboardEvent.code`: WASD and Q/E on QWERTY are ZQSD and A/E on AZERTY), so the window
 * names them as printed on the visitor's keyboard: from the browser's layout map where it exists (Chromium), else
 * learned from the keys typed (`code` → `key`), recognising AZERTY and QWERTZ; QWERTY until then.
 */

type Layout = 'qwerty' | 'azerty' | 'qwertz';

/** Letter keys that differ from QWERTY, by physical code. */
const SWAPS: Readonly<Record<Exclude<Layout, 'qwerty'>, Readonly<Record<string, string>>>> = {
  azerty: {
    KeyQ: 'A',
    KeyA: 'Q',
    KeyW: 'Z',
    KeyZ: 'W',
    KeyM: ',',
    Semicolon: 'M',
    Digit1: '&',
    Digit2: 'É',
    Digit3: '"',
    Digit4: "'",
    Digit5: '(',
    Digit6: '-',
    Digit7: 'È',
    Digit8: '_',
    Digit9: 'Ç',
    Digit0: 'À',
    Minus: ')',
    Equal: '=',
  },
  qwertz: { KeyY: 'Z', KeyZ: 'Y', Minus: 'ß', Equal: '´' },
};

/** QWERTY labels of the symbol keys drawn in the settings window. */
const QWERTY_SYMBOLS: Readonly<Record<string, string>> = { Minus: '-', Equal: '=', Semicolon: ';' };

const STORAGE_KEY = 'perigee-keyboard';

/** Labels from the browser's layout map (exact), when it gave one. */
let layoutMap: ReadonlyMap<string, string> | undefined;
/** Layout guessed from the keys typed (remembered per browser). */
let guessed: Layout = readGuess();
const listeners = new Set<() => void>();

function readGuess(): Layout {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'azerty' || v === 'qwertz' ? v : 'qwerty';
  } catch {
    return 'qwerty';
  }
}

function setGuess(layout: Layout): void {
  if (layout === guessed) return;
  guessed = layout;
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    // Private mode: the guess lasts for this page only.
  }
  for (const l of listeners) l();
}

/**
 * The layout a typed letter reveals, if any. Z is decisive alone (Z on QWERTY, W on AZERTY, Y on QWERTZ); Q, A, W
 * and Y tell AZERTY or QWERTZ apart from the others; other keys print the same letter on all three.
 */
function layoutFrom(code: string, key: string): Layout | undefined {
  const k = key.toUpperCase();
  if (k.length !== 1) return undefined;
  if (code === 'KeyZ') return k === 'Z' ? 'qwerty' : k === 'W' ? 'azerty' : k === 'Y' ? 'qwertz' : undefined;
  if ((code === 'KeyQ' && k === 'A') || (code === 'KeyA' && k === 'Q') || (code === 'KeyW' && k === 'Z'))
    return 'azerty';
  if (code === 'KeyY' && k === 'Z') return 'qwertz';
  return undefined;
}

/** Starts reading the layout: the browser's map if any, and the keys typed. Call once. */
export function watchKeyboardLayout(): void {
  const keyboard = (
    navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }
  ).keyboard;
  void keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      layoutMap = map;
      for (const l of listeners) l();
    })
    .catch(() => undefined);
  window.addEventListener(
    'keydown',
    (e) => {
      if (layoutMap || e.ctrlKey || e.metaKey || e.altKey) return;
      const layout = layoutFrom(e.code, e.key);
      if (layout) setGuess(layout);
    },
    { capture: true, passive: true },
  );
}

/** Called when the labels may have changed (layout map arrived, layout guessed). */
export function onKeyboardLayoutChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Label printed on the key at this physical position ("KeyQ" → "Q", or "A" on AZERTY). */
export function keyLabel(code: string): string {
  const fromMap = layoutMap?.get(code);
  if (fromMap) return fromMap.toUpperCase();
  if (guessed !== 'qwerty') {
    const swapped = SWAPS[guessed][code];
    if (swapped) return swapped;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return QWERTY_SYMBOLS[code] ?? code;
}

export const testing = { layoutFrom };
