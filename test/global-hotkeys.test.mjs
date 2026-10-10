import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/js/ui/global-hotkeys.js'),
  'utf8'
);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function installGlobalHotkeys() {
  const listeners = [];
  const R = {
    log: { error() {} },
    disk: { dir() { return null; } }
  };
  const win = {
    Rebound: R,
    navigator: { platform: 'Win32' },
    addEventListener(name) { listeners.push(name); },
    isFinite
  };
  new Function('window', source)(win);
  return { api: R.globalHotkeys, listeners };
}

describe('native After Effects keyboard safety', () => {
  it('installs no keyboard listeners or helper lifecycle listeners', () => {
    const { listeners } = installGlobalHotkeys();
    const keyboardListener = /(?:addEventListener|on)\s*\([^;\n]*['"]key(?:down|up|press)['"]|onkey(?:down|up|press)\s*:/;

    expect(listeners).toEqual([]);
    [
      'client/js/main.js',
      'client/js/ui/modal.js',
      'client/js/ui/global-hotkeys.js',
      'client/js/ui/shortcut-pad-widget.js',
      'client/js/ui/color-picker.js',
      'client/js/ui/controls.js',
      'client/js/ui/curve-editor.js',
      'client/js/ui/preset-gallery.js',
      'client/js/features/import.js',
      'client/js/features/library.js',
      'client/js/features/palette.js',
      'client/js/features/settings-panel.js'
    ].forEach((file) => {
      expect(readFileSync(path.join(root, file), 'utf8')).not.toMatch(keyboardListener);
    });
    expect(source).not.toMatch(/SetWindowsHookEx|WH_KEYBOARD_LL|SendInput|keybd_event/);
    expect(existsSync(path.join(root, 'host/helpers/global-hotkeys.ps1'))).toBe(false);
    const picker = readFileSync(path.join(root, 'tools/screen-color-picker.ps1'), 'utf8');
    expect(picker).not.toMatch(/WH_KEYBOARD_LL|KeyboardHook|keyboardHook/);
  });

  it('keeps keymap chord normalization display-only', () => {
    const { api } = installGlobalHotkeys();

    expect(api.cleanPadChord('Ctrl+Shift+z')).toBe('Ctrl+Shift+Z');
    expect(api.cleanPadChord('Ctrl+Numpad4')).toBe('Ctrl+Pad4');
    expect(api.padChordFromEvent({
      code: 'KeyZ',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false
    })).toBe('Ctrl+Z');
    expect(api.bindings()).toEqual({});
    expect(api.bindingFor('pad:pin-undo')).toBeNull();
  });

  it('refuses global bindings, recording sessions, and simulated key delivery', async () => {
    const { api } = installGlobalHotkeys();

    expect(api.supported).toBe(false);
    expect(api.start()).toBe(false);
    expect(api.beginCaptureSession(() => {})).toBe('');
    expect(api.setBinding('pad:pin-undo', 'Ctrl+Z')).toMatchObject({ ok: false });
    await expect(api.executeChord('Ctrl+Z')).rejects.toThrow(/disabled/i);
    await expect(api.executeSequence(['Ctrl+Z'])).rejects.toThrow(/disabled/i);
  });
});
