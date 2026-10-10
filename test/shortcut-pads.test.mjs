import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, '../client/js/ui/shortcut-pads.js'), 'utf8');
const mapSource = readFileSync(path.join(testDir, '../client/js/ui/ae-shortcut-map.js'), 'utf8');
const globalHotkeysSource = readFileSync(
  path.join(testDir, '../client/js/ui/global-hotkeys.js'),
  'utf8'
);

const baseActions = [
  { id: 'ae.undo', label: 'Undo', menuPath: 'Edit \u203a Undo', workflowCategory: 'General', activeChord: 'Ctrl+Z', displayChord: 'Ctrl+Z', aeMapShortcut: true },
  { id: 'ae.redo', label: 'Redo', menuPath: 'Edit \u203a Redo', workflowCategory: 'General', activeChord: 'Ctrl+Shift+Z', displayChord: 'Ctrl+Shift+Z', aeMapShortcut: true },
  { id: 'ae.save', label: 'Save Project', menuPath: 'File \u203a Save', workflowCategory: 'Project & Files', activeChord: 'Ctrl+S', displayChord: 'Ctrl+S', aeMapShortcut: true },
  { id: 'ae.open', label: 'Open Project', menuPath: 'File \u203a Open', workflowCategory: 'Project & Files', activeChord: 'Ctrl+O', displayChord: 'Ctrl+O', aeMapShortcut: true },
  { id: 'ae.close', label: 'Close Project', menuPath: 'File \u203a Close', workflowCategory: 'Project & Files', activeChord: 'Ctrl+W', displayChord: 'Ctrl+W', aeMapShortcut: true },
  { id: 'ae.select-all', label: 'Select All', menuPath: 'Edit \u203a Select All', workflowCategory: 'General', activeChord: 'Ctrl+A', displayChord: 'Ctrl+A', aeMapShortcut: true },
  { id: 'ae.deselect', label: 'Deselect All', menuPath: 'Edit \u203a Deselect All', workflowCategory: 'General', activeChord: 'F2', displayChord: 'F2', aeMapShortcut: true },
  { id: 'ae.marker', label: 'Add Marker', menuPath: 'Layer \u203a Marker \u203a Add Marker', workflowCategory: 'Markers & Tracking', activeChord: '*', displayChord: 'Numpad *', aeMapShortcut: true },
  { id: 'ae.preview', label: 'Preview', menuPath: 'Window \u203a Preview', workflowCategory: 'Views & Panels', activeChord: '0', displayChord: 'Numpad 0', aeMapShortcut: true }
];

const actionList = baseActions.map((action, index) => {
  const commandActionId = 'ae-command-' + index;
  const commandId = 1000 + index;
  return Object.assign({}, action, {
    commandName: action.label,
    commandId,
    commandIdSource: 'verified-host-probe',
    deliveryRoute: 'host-command',
    aeVersion: '26.5x89',
    commandRequest: {
      commandActionId,
      commandId,
      commandIdSource: 'verified-host-probe',
      preferredRoute: 'host-command'
    }
  });
});

const defaultEntries = actionList.slice(0, 9).map((action) => ({
  id: action.id,
  actionId: action.id,
  label: action.label,
  activeChord: action.activeChord,
  displayChord: action.displayChord,
  deliveryRoute: action.deliveryRoute || 'host-command'
}));

function createPads(initial = null, options = {}) {
  let stored = initial;
  const settings = {};
  const atomicWrites = [];
  const actions = options.actions || actionList;
  const entries = options.entries === undefined ? defaultEntries : options.entries;
  function persist(key, value, atomic) {
    if (atomic) atomicWrites.push(key);
    if (options.writeFails) return false;
    if (key === 'home-shortcut-pads') stored = value;
    else settings[key] = value;
    return true;
  }
  const R = {
    homeActions: {
      byId(id) { return actions.find((action) => action.id === id) || null; },
      shortcutCatalog() { return []; }
    },
    actionRouter: {
      selectRoute(action) { return action && action.deliveryRoute || 'host-command'; }
    },
    disk: {
      read(key, fallback) {
        if (key === 'home-shortcut-pads') return stored == null ? fallback : stored;
        return settings[key] === undefined ? fallback : settings[key];
      },
      write(key, value) {
        return persist(key, value, false);
      },
      writeAtomic(key, value) {
        return persist(key, value, true);
      }
    },
    afterEffectsShortcuts: {
      catalogEntries() { return entries; },
      resolveAction(id) { return actions.find((action) => action.id === id) || null; }
    },
    log: { info() {}, warn() {} }
  };
  const win = {
    Rebound: R,
    navigator: { platform: 'Win32' },
    addEventListener() {},
    isFinite
  };
  new Function('window', mapSource)(win);
  new Function('window', 'SystemPath', globalHotkeysSource)(win, { EXTENSION: 'extension' });
  new Function('window', source)(win);
  return { pads: R.shortcutPads, readStored: () => stored, atomicWrites };
}


// Explicit fixture: the first eight verified pins, created through the public
// add() API (the production store no longer seeds defaults on its own).
function createSeededPads(initial = null, options = {}) {
  const made = createPads(initial, options);
  actionList.slice(0, 8).forEach((action, index) => {
    made.pads.add(action.label, { actionId: action.id, pinnedSlot: index });
  });
  return made;
}

describe('Home Shortcut Pad persistence', () => {
  it('starts empty and never auto-seeds default or sample pins', () => {
    const { pads, readStored, atomicWrites } = createPads();

    expect(pads.all()).toEqual([]);
    expect(readStored()).toBeNull();
    expect(atomicWrites).toEqual([]);
  });

  it('adds new shortcuts into the first empty slot and keeps library-only items unpinned', () => {
    const { pads } = createSeededPads();

    expect(pads.firstEmptySlot()).toBe(8);
    const pinned = pads.add('Preview', { actionId: 'ae.preview' });
    expect(pinned.pinnedSlot).toBe(8);
    expect(pads.firstEmptySlot()).toBe(9);

    const saved = pads.add('My Preview', {
      actionId: 'ae.preview',
      hotkey: 'Ctrl+Alt+D',
      pinnedSlot: null
    });
    expect(saved).toMatchObject({
      label: 'My Preview',
      actionId: 'ae.preview',
      hotkey: null,
      shortcut: { display: 'Numpad 0' },
      pinnedSlot: null
    });
    expect(pads.byId(saved.id)).toEqual(saved);
    expect(pads.all()).toHaveLength(10);
  });

  it('replaces a chosen pin without deleting the previous shortcut', () => {
    const { pads } = createSeededPads();
    const original = pads.atSlot(0);
    const candidate = pads.add('Preview', {
      actionId: 'ae.preview',
      pinnedSlot: null
    });

    expect(pads.replaceAt(candidate.id, 0)).toMatchObject({ pinnedSlot: 0 });
    expect(pads.byId(original.id)).toMatchObject({
      label: 'Undo',
      actionId: 'ae.undo',
      pinnedSlot: null
    });
    expect(pads.atSlot(0).id).toBe(candidate.id);
    expect(pads.all()).toHaveLength(9);
  });

  it('clears a pin without treating its AE display chord as a Rebound binding', () => {
    const { pads } = createSeededPads();
    const pinned = pads.add('Custom Preview', {
      actionId: 'ae.preview',
      hotkey: 'Ctrl+Alt+P'
    });

    expect(pads.clearFromPad(pinned.id)).toBe(true);
    expect(pads.byId(pinned.id)).toMatchObject({
      id: pinned.id,
      pinId: pinned.id,
      label: 'Custom Preview',
      displayName: 'Custom Preview',
      actionId: 'ae.preview',
      hotkey: null,
      shortcut: { display: 'Numpad 0' },
      pinnedSlot: null,
      action: {
        type: 'ae-command',
        actionId: 'ae.preview',
        commandName: 'Preview'
      },
      enabled: true
    });
    expect(pads.atSlot(pinned.pinnedSlot)).toBeNull();
  });

  it('swaps pins when reordering within the 6 × 6 pad', () => {
    const { pads } = createSeededPads();
    const first = pads.atSlot(0);
    const second = pads.atSlot(1);

    expect(pads.pinAt(first.id, 1).pinnedSlot).toBe(1);
    expect(pads.byId(second.id).pinnedSlot).toBe(0);
    expect(pads.atSlot(1).id).toBe(first.id);
    expect(pads.atSlot(0).id).toBe(second.id);
  });

  it('resets only pins and retains saved AE commands in the library', () => {
    const { pads } = createSeededPads();
    const custom = pads.add('My Preview', {
      actionId: 'ae.preview',
      hotkey: 'Ctrl+Alt+D',
      pinnedSlot: null
    });

    pads.reset();

    expect(pads.byId(custom.id)).toMatchObject({
      label: 'My Preview',
      actionId: 'ae.preview',
      hotkey: null,
      shortcut: { display: 'Numpad 0' },
      pinnedSlot: null
    });
    expect(pads.atSlot(0).label).toBe('Undo');
  });

  it('migrates sample IDs and legacy records into stable pin/action records', () => {
    const legacy = [{
      id: 'sample-shortcut-redo',
      label: 'CDirltemTabPanelTime',
      actionId: 'ae.undo',
      hotkey: 'Ctrl+Alt+LeftArrow',
      pinnedPosition: 2,
      context: 'CDirltemTabPanelTime',
      commandId: 12345,
      verificationStatus: 'unverified'
    }];
    const { pads, readStored } = createPads(legacy);

    expect(pads.all()[0]).toMatchObject({
      id: 'pin-shortcut-redo',
      pinId: 'pin-shortcut-redo',
      label: 'Undo',
      displayName: 'Undo',
      actionId: 'ae.undo',
      hotkey: null,
      shortcut: { display: 'Ctrl + Z' },
      pinnedSlot: 2,
      enabled: true,
      status: 'ready'
    });
    expect(readStored()[0]).toMatchObject({
      pinId: 'pin-shortcut-redo',
      action: { actionId: 'ae.undo', commandName: 'Undo' }
    });
    expect(JSON.stringify(readStored())).not.toContain('CDirltemTabPanelTime');
    expect(JSON.stringify(readStored())).not.toContain('unverified');
  });

  it('clears placeholder sample actions and leaves the migrated pin unavailable', () => {
    const { pads, readStored } = createPads([{
      id: 'sample-shortcut-redo',
      displayName: 'Redo',
      action: {
        type: 'ae-command',
        actionId: 'pad:sample-shortcut-redo'
      },
      slot: 0
    }]);

    expect(pads.atSlot(0)).toMatchObject({
      id: 'pin-shortcut-redo',
      actionId: '',
      enabled: false,
      status: 'unavailable'
    });
    expect(JSON.stringify(readStored())).not.toMatch(/sample-|pad:sample-/i);
  });

  it('marks stale command identity unavailable and never reuses a saved chord', () => {
    const { pads } = createPads([{
      pinId: 'pin-koi',
      slot: 0,
      displayName: 'koi',
      enabled: true,
      action: {
        type: 'ae-command',
        actionId: 'ae.undo',
        commandActionId: 'ae-undo',
        commandId: 2080,
        commandIdSource: 'verified-host-probe',
        commandName: 'Undo',
        menuPath: 'Layer Management › Duplicate',
        registryVersion: '26.5x89'
      },
      shortcut: { modifiers: ['Ctrl'], key: 'D', display: 'Ctrl + D' }
    }]);

    expect(pads.atSlot(0)).toMatchObject({
      displayName: 'koi',
      actionId: 'ae.undo',
      commandId: 2080,
      enabled: false,
      status: 'unavailable',
      shortcut: null
    });
    expect(pads.displayChord(pads.atSlot(0))).toBe('');
  });

  it('derives the shown chord from the resolved action, not a saved pin chord', () => {
    const { pads } = createPads([{
      pinId: 'pin-koi',
      slot: 0,
      displayName: 'koi',
      enabled: true,
      action: {
        type: 'ae-command',
        actionId: 'ae.undo',
        commandActionId: 'ae-command-0',
        commandId: 1000,
        commandIdSource: 'verified-host-probe',
        commandName: 'Undo',
        menuPath: 'Edit › Undo',
        registryVersion: '26.5x89'
      },
      shortcut: { modifiers: ['Ctrl'], key: 'D', display: 'Ctrl + D' }
    }]);

    expect(pads.atSlot(0)).toMatchObject({ enabled: true, displayName: 'koi' });
    expect(pads.displayChord(pads.atSlot(0))).toBe('Ctrl + Z');
  });

  it('refreshes a numeric command ID after AE version changes when identity still matches', () => {
    const { pads } = createPads([{
      pinId: 'pin-versioned-undo',
      slot: 0,
      displayName: 'Undo',
      enabled: true,
      action: {
        type: 'ae-command',
        actionId: 'ae.undo',
        commandActionId: 'ae-command-0',
        commandId: 871,
        commandIdSource: 'verified-host-probe',
        commandName: 'Undo',
        menuPath: 'Edit › Undo',
        registryVersion: '25.0'
      }
    }]);

    expect(pads.atSlot(0)).toMatchObject({
      commandId: 1000,
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      registryVersion: '26.5x89',
      enabled: true,
      status: 'ready'
    });
  });

  it('leaves invalid duplicate slots empty and never infers an action from metadata', () => {
    const legacy = [
      { id: 'one', label: 'Undo', actionId: 'ae.undo', pinnedSlot: 1 },
      { id: 'two', label: 'Redo', actionId: 'ae.redo', pinnedSlot: 1 },
      {
        id: 'three',
        label: 'Save',
        chord: 'Ctrl+S',
        commandId: 555,
        context: 'Project Panel',
        pinnedSlot: 2
      }
    ];
    const { pads } = createPads(legacy);

    expect(pads.all().map((pad) => [
      pad.id, pad.label, pad.actionId, pad.pinnedSlot, pad.enabled
    ])).toEqual([
      ['one', 'Undo', 'ae.undo', 1, true],
      ['three', 'Save', '', 2, false],
      ['two', 'Redo', 'ae.redo', null, true]
    ]);
  });

  it('uses only the action-matched AE chord and supports removal', () => {
    const { pads } = createSeededPads();
    const custom = pads.add('Custom', {
      actionId: 'ae.undo',
      hotkey: 'Ctrl+Alt+Numpad4',
      pinnedSlot: null
    });

    expect(custom.hotkey).toBeNull();
    expect(pads.effectiveChord(custom)).toBe('Ctrl+Z');
    expect(pads.displayChord(custom)).toBe('Ctrl + Z');
    expect(pads.effectiveChord(pads.atSlot(0))).toBe('Ctrl+Z');
    expect(pads.remove(custom.id)).toBe(true);
    expect(pads.byId(custom.id)).toBeNull();
  });

  it('does not persist a custom physical key binding', () => {
    const { pads, readStored } = createSeededPads();
    const custom = pads.add('Win Backspace', {
      actionId: 'ae.undo',
      hotkey: {
        ctrl: true,
        alt: false,
        shift: true,
        win: true,
        key: 'Backspace',
        display: 'raw value is ignored'
      },
      pinnedSlot: null
    });

    expect(custom.hotkey).toBeNull();
    expect(pads.effectiveChord(custom)).toBe('Ctrl+Z');
    expect(pads.displayChord(custom)).toBe('Ctrl + Z');
    expect(JSON.stringify(readStored())).not.toContain('raw value is ignored');
  });

  it('updates pins atomically and keeps the canonical record readable', () => {
    const { pads, readStored, atomicWrites } = createSeededPads();
    const original = pads.atSlot(0);

    expect(pads.update(original.id, { label: 'My Undo' })).toBe(true);
    const updated = pads.byId(original.id);

    expect(updated).toMatchObject({
      id: original.id,
      label: 'My Undo',
      actionId: original.actionId,
      pinnedSlot: 0
    });
    expect(readStored().find((pad) => pad.pinId === original.id).displayName).toBe('My Undo');
    expect(atomicWrites.at(-1)).toBe('home-shortcut-pads');
  });

  it('applies whole-grid edits as one validated atomic storage transaction', () => {
    const { pads, readStored, atomicWrites } = createSeededPads();
    const changed = pads.all().map((pad) => Object.assign({}, pad));
    changed[0].pinnedSlot = 2;
    changed[2].pinnedSlot = 0;

    expect(pads.replaceAll(changed).find((pad) => pad.id === changed[0].id).pinnedSlot)
      .toBe(2);
    expect(atomicWrites.at(-1)).toBe('home-shortcut-pads');
    expect(readStored().find((pad) => pad.pinId === changed[0].id).slot).toBe(2);

    const duplicateSlots = pads.all().map((pad) => Object.assign({}, pad));
    duplicateSlots[1].pinnedSlot = duplicateSlots[0].pinnedSlot;
    expect(() => pads.replaceAll(duplicateSlots)).toThrow(/duplicate slot/);
  });

  it('fixes the grid at 36 slots and reports invalid inputs and write failures', () => {
    const { pads } = createSeededPads();

    expect(pads.slotCount()).toBe(36);
    expect(pads.columns()).toBe(6);
    expect(pads.setColumns(6)).toBe(6);
    expect(() => pads.setColumns(4)).toThrow(/fixed 6 × 6/);
    expect(() => pads.pinAt('missing', 36)).toThrow(/36 Shortcut Pad slots/);
    expect(() => pads.add('', { actionId: 'ae.undo' })).toThrow(/Enter a name/);
    expect(() => pads.add('Unknown', { actionId: 'unknown' }))
      .toThrow(/verified numeric command ID/);

    const failing = createPads(null, { writeFails: true, entries: [] }).pads;
    expect(() => failing.add('Save', { actionId: 'ae.undo' })).toThrow(/Could not save/);
  });
});
