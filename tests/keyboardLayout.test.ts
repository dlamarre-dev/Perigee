import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('keyboard layout labels', () => {
  beforeEach(() => {
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });

  it('reads the layout from a typed letter: Z is decisive, Q/A/W tell AZERTY, Y tells QWERTZ', async () => {
    const { testing } = await import('../src/ui/keyboardLayout');
    expect(testing.layoutFrom('KeyZ', 'z')).toBe('qwerty');
    expect(testing.layoutFrom('KeyZ', 'w')).toBe('azerty');
    expect(testing.layoutFrom('KeyZ', 'y')).toBe('qwertz');
    expect(testing.layoutFrom('KeyQ', 'a')).toBe('azerty');
    expect(testing.layoutFrom('KeyW', 'Z')).toBe('azerty');
    expect(testing.layoutFrom('KeyY', 'z')).toBe('qwertz');
    // Keys printing the same letter everywhere say nothing.
    expect(testing.layoutFrom('KeyE', 'e')).toBeUndefined();
    expect(testing.layoutFrom('KeyQ', 'q')).toBeUndefined();
  });

  it('names the keys as printed: QWERTY by default, AZERTY once learned (remembered)', async () => {
    const listeners: ((e: Partial<KeyboardEvent>) => void)[] = [];
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {
      addEventListener: (_: string, l: (e: Partial<KeyboardEvent>) => void) => listeners.push(l),
    });
    const layout = await import('../src/ui/keyboardLayout');
    layout.watchKeyboardLayout();
    expect(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].map(layout.keyLabel)).toEqual([
      'W',
      'A',
      'S',
      'D',
      'Q',
      'E',
    ]);
    let changed = 0;
    layout.onKeyboardLayoutChange(() => changed++);
    for (const l of listeners) l({ code: 'KeyQ', key: 'a', ctrlKey: false, metaKey: false, altKey: false });
    expect(changed).toBe(1);
    // W A S D read by position is Z Q S D on AZERTY; the roll keys Q/E are A/E; − is printed on 6.
    expect(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].map(layout.keyLabel)).toEqual([
      'Z',
      'Q',
      'S',
      'D',
      'A',
      'E',
    ]);
    expect(layout.keyLabel('Digit6')).toBe('-');
    // Remembered: a new page load starts from AZERTY (same storage, fresh module).
    vi.resetModules();
    const again = await import('../src/ui/keyboardLayout');
    expect(again.keyLabel('KeyQ')).toBe('A');
  });
});
