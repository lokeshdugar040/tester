import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/js/ui/ae-shortcut-map.js'),
  'utf8'
);

function parse(text) {
  const window = { Rebound: {} };
  new Function('window', source)(window);
  return window.Rebound.aeShortcutMap.parse(text);
}

describe('After Effects shortcut map parser', () => {
  it('reads context groups, multiple key chords, and unassigned actions', () => {
    const result = parse([
      '# Text File Version 1.1',
      '["** header **"]',
      '  "major_version" = "109"',
      '["AE_TopLevelWindow"]',
      '  "ToggleTabPanelMaximize" = "(`)"',
      '  "CloseTimelinePanelsToLeft" = "()"',
      '["CCompCmd"]',
      '  "AddMarker" = "(PadMultiply)(Ctrl+8)"'
    ].join('\n'));

    expect(result).toMatchObject({ version: '109', total: 3, assigned: 2, unassigned: 1 });
    expect(result.entries[0]).toMatchObject({
      context: 'AE_TopLevelWindow',
      contextLabel: 'After Effects',
      commandId: 'ToggleTabPanelMaximize',
      label: 'Toggle Tab Panel Maximize',
      shortcuts: ['`']
    });
    expect(result.entries[1].shortcuts).toEqual([]);
    expect(result.entries[2]).toMatchObject({
      context: 'CCompCmd',
      contextLabel: 'Composition',
      shortcuts: ['PadMultiply', 'Ctrl+8']
    });
  });

  it('preserves ordered multi-key sequences separately from alternate bindings', () => {
    const result = parse([
      '["CSwitchboard"]',
      '  "SequenceCommand" = "(Ctrl+K, Ctrl+X)(Alt+X)"'
    ].join('\n'));
    const record = (() => {
      const window = { Rebound: {} };
      new Function('window', source)(window);
      return window.Rebound.aeShortcutMap.canonicalRecord(result.entries[0]);
    })();

    expect(result.entries[0].sequence).toEqual(['Ctrl+K', 'Ctrl+X']);
    expect(record).toMatchObject({
      activeChord: '',
      displayChord: 'Ctrl + K → Ctrl + X',
      alternateChords: ['Alt+X'],
      actionKind: 'ae-sequence',
      deliveryRoute: 'unsupported'
    });
  });

  it('resolves one active binding and keeps keypad bindings distinct', () => {
    const window = { Rebound: {} };
    new Function('window', source)(window);
    const record = window.Rebound.aeShortcutMap.canonicalRecord({
      context: 'CCompCmd',
      commandId: 'AddMarker',
      shortcuts: ['PadMultiply', 'Ctrl+8']
    });

    expect(record).toMatchObject({
      activeChord: 'PadMultiply',
      displayChord: 'Numpad *',
      alternateChords: ['Ctrl+8'],
      actionKind: 'ae-keypad'
    });
  });

  it('groups AE internal contexts under useful shortcut categories', () => {
    const window = { Rebound: {} };
    new Function('window', source)(window);
    const categories = window.Rebound.aeShortcutMap;

    expect(categories.categoryForContext('CCompMarkerCmd')).toBe('Markers');
    expect(categories.categoryForContext('CPanoProjLayerPanoMask')).toBe('Layers & Masks');
    expect(categories.categoryForContext('RQOutlinePano')).toBe('Render Queue');
    expect(categories.categoryForContext('TextLayerUI')).toBe('Text');
    expect(categories.categoryForContext('UnknownContext')).toBe('Other Shortcuts');
  });

  it('delivers only verified commands: Duplicate is available, Undo and Redo are unavailable with a reason', () => {
    const window = { Rebound: {} };
    window.Rebound.globalHotkeys = { cleanPadChord(chord) { return chord; } };
    new Function('window', source)(window);
    const map = window.Rebound.aeShortcutMap;
    const undo = map.canonicalRecord({
      context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Undo', shortcuts: ['Ctrl+Z']
    });
    const redo = map.canonicalRecord({
      context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Redo', shortcuts: ['Ctrl+Shift+Z']
    });
    const duplicate = map.canonicalRecord({
      context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Duplicate', shortcuts: ['Ctrl+D']
    });

    expect(duplicate).toMatchObject({ route: 'host-command', deliveryRoute: 'host-command',
      verificationStatus: 'verified', userStatus: 'Ready' });
    for (const record of [undo, redo]) {
      expect(record).toMatchObject({ route: 'unsupported', deliveryRoute: 'unsupported',
        verificationStatus: 'unverified', userStatus: 'Unsupported' });
      expect(record.reason).toMatch(/no verified automation route/);
    }
  });

  it('builds canonical records without inventing semantics for unknown commands', () => {
    const window = { Rebound: {} };
    window.Rebound.globalHotkeys = {
      cleanPadChord(chord) {
        return /(?:^|\+)(?:macControl|Cmd|Command|Meta)(?:\+|$)/i.test(chord) ? null : chord;
      }
    };
    new Function('window', source)(window);
    const map = window.Rebound.aeShortcutMap;
    const known = map.canonicalRecord({
      context: 'CSwitchboard',
      contextLabel: 'Application',
      commandId: 'Duplicate',
      shortcuts: ['Ctrl+D', 'PadDecimal']
    });
    const unknown = map.canonicalRecord({
      context: 'UnknownContext',
      contextLabel: 'Unknown',
      commandId: 'UnknownAction',
      shortcuts: ['macControl+8']
    });

    expect(known).toMatchObject({
      id: 'ae.map.CSwitchboard.Duplicate',
      label: 'Duplicate Selected Layer',
      aeContext: 'CSwitchboard',
      workflowCategory: 'Layer Management',
      activeKeymapCommandId: 'Duplicate',
      commandId: null,
      commandIdSource: null,
      activeChord: 'Ctrl+D',
      displayChord: 'Ctrl + D',
      alternateChords: ['PadDecimal'],
      bindingAlternatives: ['Ctrl+D', 'PadDecimal'],
      actionKind: 'ae-command',
      route: 'host-command',
      verificationStatus: 'verified',
      userStatus: 'Ready'
    });
    expect(unknown).toMatchObject({
      activeKeymapCommandId: 'UnknownAction',
      commandId: null,
      activeChord: '',
      bindingAlternatives: ['macControl+8'],
      actionKind: 'unsupported',
      route: 'unsupported',
      workflowCategory: 'Needs Review',
      verificationStatus: 'unsupported',
      userStatus: 'Unsupported'
    });
    expect(map.workflowCategories).toContain('Clipboard & Transfer');
    expect(map.workflowCategories).toContain('Needs Review');
  });

  it('keeps internal context identifiers out of fallback labels and rejects unknown contexts', () => {
    const window = { Rebound: { globalHotkeys: { cleanPadChord: (chord) => chord } } };
    new Function('window', source)(window);
    const map = window.Rebound.aeShortcutMap;
    const record = map.canonicalRecord({
      context: 'CDirItemTabPanelTime',
      commandId: 'CDirItemTabPanelTime',
      shortcuts: ['Ctrl+Alt+LeftArrow', 'PadHome']
    });

    expect(record.label).not.toContain('CDirItemTabPanelTime');
    expect(record.displayChord).toBe('Ctrl + Alt + Arrow Left');
    expect(record.alternateChords).toEqual(['PadHome']);
    expect(record.deliveryRoute).toBe('unsupported');
    expect(map.panelForContext(record.aeContext)).toBe('Project Panel');

    const unknown = map.canonicalRecord({
      context: 'UnknownContext',
      commandId: 'SomeAction',
      shortcuts: ['Ctrl+K']
    });
    expect(unknown.deliveryRoute).toBe('unsupported');
  });

  it('parses repeated bare keys as an ordered sequence, not alternate chords', () => {
    const window = { Rebound: { globalHotkeys: { cleanPadChord: (chord) => chord } } };
    new Function('window', source)(window);
    const entry = window.Rebound.aeShortcutMap.parse([
      '["CCompCompCmd"]',
      '  "ToggleMaskPath" = "(M)(M)"'
    ].join('\n')).entries[0];
    const record = window.Rebound.aeShortcutMap.canonicalRecord(entry);

    expect(record.sequence).toEqual(['M', 'M']);
    expect(record.activeChord).toBe('');
    expect(record.displayChord).toBe('M → M');
    expect(record.alternateChords).toEqual([]);
    expect(record.deliveryRoute).toBe('unsupported');
  });

  it('formats key labels naturally across Windows and macOS conventions', () => {
    const windows = { Rebound: {}, navigator: { platform: 'Win32' } };
    new Function('window', source)(windows);
    const format = windows.Rebound.aeShortcutMap.formatShortcutForDisplay;
    expect(format('Ctrl+Shift+KEYZ')).toBe('Ctrl + Shift + Z');
    expect(format('Pad0')).toBe('Numpad 0');
    expect(format('ArrowUp')).toBe('Arrow Up');
    expect(format('Shift+F9')).toBe('Shift + F9');

    const mac = { Rebound: {}, navigator: { platform: 'MacIntel' } };
    new Function('window', source)(mac);
    expect(mac.Rebound.aeShortcutMap.formatShortcutForDisplay('Meta+Option+ArrowUp'))
      .toBe('Cmd + Option + Arrow Up');
  });

  it('rejects empty or malformed keymap content instead of returning an empty list', () => {
    expect(() => parse('')).toThrow(/empty shortcut map/);
    expect(() => parse('# comments only')).toThrow(/No shortcut entries/);
  });
});
