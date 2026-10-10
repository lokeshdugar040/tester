import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/js/ui/shortcut-actions.js'), 'utf8');

function createShortcuts(actions, saved = null) {
  let stored = saved;
  const byId = new Map(actions.map((action) => [action.id, action]));
  const R = {
    disk: {
      read(_key, fallback) { return stored == null ? fallback : stored; },
      write(_key, value) { stored = value; return true; }
    },
    homeActions: {
      byId(id) { return byId.get(id) || null; }
    }
  };
  new Function('window', source)({ Rebound: R });
  return { shortcuts: R.shortcutActions, readStored: () => stored };
}

const commands = [
  { id: 'ae-easy-ease', label: 'Easy Ease', shortcut: 'F9', kind: 'apply', isAfterEffectsShortcut: true, aeMapShortcut: true },
  { id: 'ae-undo', label: 'Undo', shortcut: 'Ctrl+Z', kind: 'apply', isAfterEffectsShortcut: true, aeMapShortcut: true },
  { id: 'ae-save-project', label: 'Save Project', shortcut: 'Ctrl+S', kind: 'apply', isAfterEffectsShortcut: true, aeMapShortcut: true },
  { id: 'toolpreset-spring-smooth', label: 'Spring: Smooth', kind: 'apply', presetName: 'Smooth' }
];

describe('After Effects shortcut buttons', () => {
  it('does not invent shortcut defaults before the active keymap is loaded', () => {
    const { shortcuts } = createShortcuts(commands);
    expect(shortcuts.all()).toEqual([]);
    expect(shortcuts.isAfterEffectsShortcut(commands[3])).toBe(false);
  });

  it('adds and removes only AE shortcuts and persists their order', () => {
    const { shortcuts, readStored } = createShortcuts(commands, ['ae-easy-ease', 'ae-undo']);
    expect(shortcuts.add('toolpreset-spring-smooth')).toBe(false);
    expect(shortcuts.add('ae-save-project')).toBe(true);
    expect(shortcuts.add('ae-save-project')).toBe(false);
    expect(shortcuts.remove('ae-undo')).toBe(true);
    expect(shortcuts.ids()).toEqual(['ae-easy-ease', 'ae-save-project']);
    expect(readStored()).toEqual(['ae-easy-ease', 'ae-save-project']);
  });

  it('filters stale persisted ids without inventing fallback shortcuts', () => {
    const { shortcuts } = createShortcuts(commands, ['missing-action']);
    expect(shortcuts.ids()).toEqual([]);
  });
});
