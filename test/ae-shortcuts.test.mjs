import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapSource = readFileSync(path.join(root, 'client/js/ui/ae-shortcut-map.js'), 'utf8');
const clientSource = readFileSync(path.join(root, 'client/js/ui/ae-shortcuts.js'), 'utf8');
const catalogUiSource = readFileSync(path.join(root, 'client/js/features/ae-shortcut-catalog.js'), 'utf8');
const settingsSource = readFileSync(path.join(root, 'client/js/features/settings-panel.js'), 'utf8');
const homeCssSource = readFileSync(path.join(root, 'client/css/home.css'), 'utf8');
const hostSource = readFileSync(path.join(root, 'host/commands/ae-shortcuts.jsx'), 'utf8');

function installClient(entries = [], platform = 'Win32', disk = null) {
  const R = {
    disk: disk || {
      values: {},
      read(key, fallback) {
        return this.values[key] === undefined ? fallback : this.values[key];
      },
      write(key, value) {
        this.values[key] = value;
        return true;
      }
    },
    globalHotkeys: {
      supported: true,
      cleanPadChord(chord) {
        return /(?:^|\+)(?:macControl|Cmd|Command|Meta)(?:\+|$)/i.test(chord) ? null : chord;
      }
    }
  };
  const win = { Rebound: R, navigator: { platform } };
  new Function('window', mapSource)(win);
  new Function('window', clientSource)(win);
  if (entries.length) R.afterEffectsShortcuts.updateFromKeymap({ entries });
  return R.afterEffectsShortcuts;
}

function resolveHostRoutes(shortcuts, firstCommandId = 1000) {
  const commands = {};
  shortcuts.routeCandidates().forEach((candidate, index) => {
    commands[candidate.context + '|' + candidate.commandId] = Object.assign({}, candidate, {
      commandId: firstCommandId + index,
      commandIdSource: 'verified-host-probe',
      deliveryRoute: 'host-command',
      aeVersion: '26.5x89'
    });
  });
  shortcuts.updateRuntimeCommands({ commands, aeVersion: '26.5x89' });
  return commands;
}

function installHost(args = {}) {
  const handlers = {};
  const global = {};
  const R = {
    register(name, callback) { handlers[name] = callback; }
  };
  const $ = { __rebound: R, global };
  new Function('$', 'app', 'Property', 'CompItem', 'File', 'KeyframeInterpolationType', hostSource)(
    $, args.app || {}, args.Property, args.CompItem, args.File, {
      BEZIER: 'bezier',
      LINEAR: 'linear'
    }
  );
  return { handlers, global };
}

describe('After Effects shortcut catalog', () => {
  it('uses one compact editable pad and a vertically scrollable catalog', () => {
    expect(catalogUiSource).not.toMatch(/rb-aeshortcuts-tabs|Browse All|Quick Pads/);
    expect(catalogUiSource).not.toMatch(/(?:\{|,)\s*text:\s*entry\.(?:commandId|context|activeKeymapCommandId|bindingAlternatives|verificationStatus)/);
    expect(catalogUiSource).not.toMatch(/text:\s*['"][^'"]*unverified/i);
    expect(catalogUiSource).toContain('padApi.pinAction(entry.actionId)');
    expect(catalogUiSource).toContain('Search all shortcuts');
    expect(catalogUiSource).toContain('Manage widgets');
    expect(catalogUiSource).toContain('Reset shortcuts');
    expect(catalogUiSource).toContain('R.disk.write(CATEGORY_KEY, category)');
    expect(catalogUiSource).toContain('R.disk.write(SEARCH_KEY, query)');
    expect(catalogUiSource).toContain(
      'if (ctx.widget && R.shortcutPadWidget) return R.shortcutPadWidget.mount(ctx)');
    expect(homeCssSource).toMatch(/\.rb-shortcut-pad-grid\s*\{[^}]*repeat\(6,/s);
    expect(homeCssSource).toContain('grid-auto-flow: row');
    expect(homeCssSource).toContain('align-content: start');
    expect(homeCssSource).toContain('min-height: 72px');
    expect(homeCssSource).not.toContain('max-width: 466px');
    expect(homeCssSource).not.toMatch(/word-break:\s*break-all/);
    expect(homeCssSource).toMatch(/\.rb-aeshortcuts-grid\s*\{[^}]*overflow-y:\s*auto/s);
    expect(homeCssSource).toMatch(/\.rb-aeshortcuts-padgrid\s*\{[^}]*overflow-y:\s*auto/s);
    expect(homeCssSource).toContain('.rb-aeshortcuts-row');
    expect(homeCssSource).toContain('.rb-aeshortcuts-diagnostics-output');
    expect(homeCssSource).toContain('.rb-home-shortcut-button.is-running');
    expect(hostSource).toContain('app.executeCommand(commandId)');
    expect(hostSource).not.toMatch(/SendInput|keybd_event|nativeCommandId\s*\)/);
    expect(hostSource).not.toMatch(/\.open\(['"]w['"]\)/);
    const settingsBody = settingsSource.match(/function buildBody[\s\S]*?function buildShortcutSettings/)[0];
    expect(settingsBody).not.toMatch(/buildShortcutCheatSection|buildGlobalHotkeysSection|buildAeShortcutMapSection|buildKeybindsSection/);
    expect(settingsSource).toContain('openShortcutSettings: openShortcutSettings');
  });

  it('does not invent catalog entries when the active keymap is unavailable', () => {
    const entries = installClient().catalogEntries();
    expect(entries).toEqual([]);
  });

  it('keeps all active-map entries while selecting one chord and blocking unsupported routes', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Duplicate', shortcuts: ['Ctrl+D'] },
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'MacOnlyCommand', shortcuts: ['macControl+8'] },
      { context: 'CCompCmd', contextLabel: 'Composition', commandId: 'AddMarker', shortcuts: ['PadMultiply', 'Ctrl+8'] },
      { context: 'UnknownContext', contextLabel: 'Unknown', commandId: 'UnassignedCommand', shortcuts: [] }
    ]);
    const candidates = shortcuts.routeCandidates();
    shortcuts.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, candidates.find((item) =>
          item.commandId === 'Duplicate'), {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null
        }),
        'CCompCmd|AddMarker': Object.assign({}, candidates.find((item) =>
          item.commandId === 'AddMarker'), {
          commandId: 2157,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null
        })
      }
    });
    shortcuts.updateContext({
      hasComp: true, selectedLayerCount: 1, selectedMaskCount: 0,
      totalSelectedKeys: 0, detectedContext: 'Composition Viewer'
    });
    const entries = shortcuts.catalogEntries();

    expect(entries).toHaveLength(4);
    expect(entries.find((entry) => entry.activeKeymapCommandId === 'Duplicate')).toMatchObject({
      label: 'Duplicate Selected Layer',
      category: 'Layer Management',
      route: 'host-command',
      verificationStatus: 'unverified',
      userStatus: 'Ready',
      runnable: true
    });
    const duplicate = entries.find((entry) => entry.activeKeymapCommandId === 'Duplicate');
    expect(shortcuts.markExecutionVerified(duplicate.actionId, {
      executed: true,
      verified: false
    })).toBe(false);
    expect(shortcuts.markExecutionVerified(duplicate.actionId, {
      executed: true,
      verified: true,
      contextVerified: true
    })).toBe(true);
    expect(shortcuts.resolveAction(duplicate.actionId).verificationStatus).toBe('verified');
    expect(entries.find((entry) => entry.activeKeymapCommandId === 'MacOnlyCommand')).toMatchObject({
      shortcut: '',
      chord: '',
      bindingAlternatives: ['macControl+8'],
      runnable: false,
      verificationStatus: 'unsupported',
      userStatus: 'Unsupported'
    });
    expect(entries.find((entry) => entry.activeKeymapCommandId === 'AddMarker')).toMatchObject({
      shortcut: 'Numpad *',
      activeChord: 'PadMultiply',
      alternateChords: ['Ctrl+8'],
      route: 'host-command',
      nativeActionId: 'ae-add-marker'
    });
    expect(entries.find((entry) => entry.activeKeymapCommandId === 'UnassignedCommand')).toMatchObject({
      shortcut: '',
      verificationStatus: 'unsupported',
      userStatus: 'Unsupported',
      route: 'unsupported'
    });
  });

  it('uses only routes supported by the active context and leaves execution unverified', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'UnknownCommand', shortcuts: ['Ctrl+K'] },
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Undo', shortcuts: ['Ctrl+Z'] },
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Duplicate', shortcuts: ['Ctrl+D'] },
      { context: 'CCompCmd', contextLabel: 'Composition', commandId: 'ContextOnly', shortcuts: ['Ctrl+K'] }
    ]);
    const candidates = shortcuts.routeCandidates();
    shortcuts.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Undo': Object.assign({}, candidates.find((item) =>
          item.commandId === 'Undo'), {
          commandId: 2371,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          aeVersion: '26.5x89'
        }),
        'CSwitchboard|Duplicate': Object.assign({}, candidates.find((item) =>
          item.commandId === 'Duplicate'), {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          aeVersion: '26.5x89'
        })
      },
      aeVersion: '26.5x89'
    });

    expect(shortcuts.catalogEntries().find((entry) => entry.activeKeymapCommandId === 'UnknownCommand'))
      .toMatchObject({ route: 'unsupported', runnable: false, userStatus: 'Unsupported' });
    expect(shortcuts.catalogEntries().find((entry) => entry.activeKeymapCommandId === 'Undo'))
      .toMatchObject({
        route: 'host-command',
        commandId: 2371,
        commandIdSource: 'verified-host-probe',
        runnable: true,
        verificationStatus: 'unverified'
      });
    expect(shortcuts.catalogEntries().find((entry) => entry.activeKeymapCommandId === 'ContextOnly'))
      .toMatchObject({ route: 'unsupported', runnable: false, userStatus: 'Unsupported' });
    expect(shortcuts.nativeActionForCommand('Duplicate', 'CCompCmd')).toBe(null);
    expect(shortcuts.nativeActionForCommand('Duplicate', 'CSwitchboard')).toBe(null);
    const duplicateCandidate = shortcuts.routeCandidates().find((item) =>
      item.commandId === 'Duplicate');
    shortcuts.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, duplicateCandidate, {
          commandActionId: 'ae-duplicate',
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null
        })
      }
    });
    expect(shortcuts.nativeActionForCommand('Duplicate', 'CSwitchboard')).toBe('ae-duplicate');
  });

  it('persists observed verification only for the same AE version, route, and binding', () => {
    const disk = {
      values: {},
      read(key, fallback) {
        return this.values[key] === undefined ? fallback : this.values[key];
      },
      write(key, value) {
        this.values[key] = value;
        return true;
      }
    };
    const entries = [
      { context: 'CSwitchboard', commandId: 'Duplicate', shortcuts: ['Ctrl+D'] }
    ];
    const first = installClient(entries, 'Win32', disk);
    first.updateContext({
      hasComp: true,
      selectedLayerCount: 1,
      selectedMaskCount: 0,
      totalSelectedKeys: 0,
      detectedContext: 'Composition Viewer'
    });
    const candidate = first.routeCandidates()[0];
    first.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, candidate, {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null,
          aeVersion: '26.0'
        })
      }
    });
    const duplicate = first.catalogEntries()[0];
    expect(first.markExecutionVerified(duplicate.actionId, {
      executed: true,
      verified: true,
      contextVerified: true
    })).toBe(true);

    const sameVersion = installClient(entries, 'Win32', disk);
    sameVersion.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, candidate, {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null,
          aeVersion: '26.0'
        })
      }
    });
    expect(sameVersion.catalogEntries()[0].verificationStatus).toBe('verified');

    const changedVersion = installClient(entries, 'Win32', disk);
    changedVersion.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, candidate, {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null,
          aeVersion: '27.0'
        })
      }
    });
    expect(changedVersion.catalogEntries()[0].verificationStatus).toBe('unverified');
  });

  it('reports prerequisites only for commands with verified direct routes', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', commandId: 'Duplicate', shortcuts: ['Ctrl+D'] },
      { context: 'CCompCmd', commandId: 'AddMarker', shortcuts: ['PadMultiply'] },
      { context: 'CSwitchboard', commandId: 'EasyEase', shortcuts: ['F9'] }
    ]);
    resolveHostRoutes(shortcuts);
    const byCommand = (command) =>
      shortcuts.catalogEntries().find((entry) => entry.activeKeymapCommandId === command);

    expect(byCommand('Duplicate').userStatus).toBe('Needs Composition');
    expect(byCommand('AddMarker').userStatus).toBe('Needs Composition');
    expect(byCommand('EasyEase').userStatus).toBe('Needs Composition');

    shortcuts.updateContext({
      hasComp: true,
      selectedLayerCount: 0,
      selectedMaskCount: 0,
      totalSelectedKeys: 0,
      detectedContext: 'Unknown'
    });
    expect(byCommand('Duplicate').userStatus).toBe('Needs Selection');
    expect(byCommand('AddMarker').userStatus).toBe('Needs Selection');
    expect(byCommand('EasyEase').userStatus).toBe('Needs Selection');

    shortcuts.updateContext({
      hasComp: true,
      selectedLayerCount: 1,
      selectedMaskCount: 1,
      totalSelectedKeys: 2,
      detectedContext: 'Composition Viewer'
    });
    expect(byCommand('Duplicate').userStatus).toBe('Ready');
    expect(byCommand('AddMarker').userStatus).toBe('Ready');
    expect(byCommand('EasyEase').userStatus).toBe('Ready');
  });

  it('keeps command-ID actions available without intercepting foreground keyboard input', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', commandId: 'Undo', shortcuts: ['Ctrl+Z'] }
    ]);
    resolveHostRoutes(shortcuts);
    shortcuts.updateContext({
      hasComp: true,
      selectedLayerCount: 1,
      totalSelectedKeys: 0,
      detectedContext: 'Timeline',
      aeForeground: false
    });
    expect(shortcuts.catalogEntries()[0]).toMatchObject({
      userStatus: 'Ready',
      runnable: true,
      deliveryRoute: 'host-command'
    });
  });

  it('treats missing foreground telemetry as unknown so an in-host route remains available', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', commandId: 'Undo', shortcuts: ['Ctrl+Z'] }
    ]);
    resolveHostRoutes(shortcuts, 2371);
    shortcuts.updateContext({
      detectedContext: 'Unknown',
      aeForeground: null
    });
    expect(shortcuts.catalogEntries()[0]).toMatchObject({
      activeChord: 'Ctrl+Z',
      deliveryRoute: 'host-command',
      verificationStatus: 'unverified',
      userStatus: 'Ready',
      runnable: true
    });
    expect(shortcuts.catalogEntries()[0].commandRequest.contextSnapshot.aeForeground).toBe(null);
  });

  it('retains current runtime command IDs and their provenance without guessing numeric IDs', () => {
    const shortcuts = installClient([
      { context: 'CSwitchboard', contextLabel: 'Application', commandId: 'Duplicate', shortcuts: ['Ctrl+D'] }
    ]);
    expect(shortcuts.catalogEntries()[0]).toMatchObject({
      commandId: null,
      commandIdSource: null,
      activeKeymapCommandId: 'Duplicate'
    });

    const duplicateCandidate = shortcuts.routeCandidates().find((item) =>
      item.commandId === 'Duplicate');
    shortcuts.updateRuntimeCommands({
      commands: {
        'CSwitchboard|Duplicate': Object.assign({}, duplicateCandidate, {
          commandId: 2080,
          commandIdSource: 'verified-host-probe',
          deliveryRoute: 'host-command',
          nativeCommandId: null
        })
      }
    });
    expect(shortcuts.catalogEntries()[0]).toMatchObject({
      commandId: 2080,
      commandIdSource: 'verified-host-probe'
    });
  });

  it('executes Undo directly with the verified numeric AE command ID', () => {
    const dispatched = [];
    const host = installHost({
      app: {
        project: {},
        findMenuCommandId(label) { return label === 'Undo' ? 2371 : 0; },
        executeCommand(commandId) { dispatched.push(commandId); }
      }
    });
    const route = {
      shortcutId: 'ae.map.CSwitchboard.Undo',
      context: 'CSwitchboard',
      commandId: 'Undo',
      actionId: 'ae-undo',
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      activeChord: 'Ctrl+Z',
      sequence: [],
      fallbackRoute: null,
      requiredContext: '',
      verificationStatus: 'unverified',
      requiredState: 'An open project with a reversible edit.',
      successCriteria: 'The visible project state must change to the prior state.'
    };
    const entries = [{ context: 'CSwitchboard', commandId: 'Undo', shortcuts: ['Ctrl+Z'] }];
    host.handlers['aeShortcut.resolveActiveKeymap']({
      entries,
      routeCandidates: [route]
    });
    const request = {
      schemaVersion: 1,
      requestId: 'shortcut-12345-1-test',
      shortcutId: route.shortcutId,
      commandIdentity: { context: 'CSwitchboard', command: 'Undo' },
      commandActionId: 'ae-undo',
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      commandName: 'Undo',
      menuLabel: 'Undo',
      menuPath: 'Edit › Undo',
      nativeCommandId: null,
      binding: { activeChord: 'Ctrl+Z', sequence: [] },
      requiredContext: '',
      contextSnapshot: { detectedContext: 'Unknown', aeForeground: false, capturedAt: Date.now() },
      preferredRoute: 'host-command',
      fallbackRoute: null,
      expectedResult: route.successCriteria
    };

    const result = host.handlers['aeShortcut.executeRequest']({ request });

    expect(dispatched).toEqual([2371]);
    expect(result).toMatchObject({
      requestId: request.requestId,
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      executionRoute: 'host-command',
      executed: true
    });
  });

  it('validates a typed pad request and dispatches exactly one numeric command', () => {
    const dispatched = [];
    const host = installHost({
      app: {
        project: {},
        findMenuCommandId(label) { return label === 'Undo' ? 2371 : 0; },
        executeCommand(commandId) { dispatched.push(commandId); }
      }
    });
    const route = {
      shortcutId: 'ae.map.CSwitchboard.Undo',
      context: 'CSwitchboard',
      commandId: 'Undo',
      actionId: 'ae-undo',
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      activeChord: 'Ctrl+Z',
      sequence: [],
      fallbackRoute: null,
      requiredContext: '',
      successCriteria: 'Undo is dispatched.'
    };
    host.handlers['aeShortcut.resolveActiveKeymap']({
      entries: [{ context: 'CSwitchboard', commandId: 'Undo', shortcuts: ['Ctrl+Z'] }],
      routeCandidates: [route]
    });
    const request = {
      schemaVersion: 1,
      requestId: 'shortcut-12345-1-undo',
      shortcutId: route.shortcutId,
      commandIdentity: { context: route.context, command: route.commandId },
      commandActionId: route.actionId,
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      commandName: route.commandName,
      menuLabel: 'Undo',
      menuPath: route.menuPath,
      nativeCommandId: null,
      binding: { activeChord: 'Ctrl+Z', sequence: [] },
      requiredContext: '',
      contextSnapshot: {
        detectedContext: 'Unknown',
        aeForeground: false,
        capturedAt: Date.now()
      },
      preferredRoute: 'host-command',
      fallbackRoute: null,
      expectedResult: route.successCriteria
    };

    const result = host.handlers['aeShortcut.executeRequest']({ request });

    expect(dispatched).toEqual([2371]);
    expect(result).toMatchObject({
      requestId: request.requestId,
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      executionRoute: 'host-command',
      executed: true
    });
  });

  it('preflights Duplicate strictly for selected composition layers and verifies the layer-count change', () => {
    function CompItem() {}
    const comp = new CompItem();
    comp.numLayers = 1;
    comp.selectedLayers = [{}];
    const app = {
      project: { activeItem: comp },
      findMenuCommandId() { return 2080; },
      executeCommand() { comp.numLayers += 1; }
    };
    const host = installHost({ app, CompItem });

    expect(host.handlers['aeShortcut.execute']({ id: 'ae-duplicate' })).toMatchObject({
      commandId: 2080,
      commandIdSource: 'app.findMenuCommandId',
      executionRoute: 'host-command',
      executed: true,
      verified: true
    });
    expect(comp.numLayers).toBe(2);
  });

  it('rejects project-panel selection for Duplicate without dispatching a command', () => {
    function CompItem() {}
    const app = {
      project: { activeItem: { selectedLayers: [] }, selection: [{}] },
      findMenuCommandId() { return 2080; },
      executeCommand() { throw new Error('must not run'); }
    };
    const host = installHost({ app, CompItem });

    expect(() => host.handlers['aeShortcut.execute']({ id: 'ae-duplicate' }))
      .toThrow(/only enabled for selected composition layers/);
  });

  it('verifies Save only when a dirty saved project becomes clean', () => {
    const project = { dirty: true, file: { fsName: 'C:/test.aep' } };
    const host = installHost({
      app: {
        project,
        findMenuCommandId() { return 5; },
        executeCommand() { project.dirty = false; }
      }
    });
    expect(host.handlers['aeShortcut.execute']({ id: 'ae-save-project' })).toMatchObject({
      executed: true,
      verified: true,
      result: 'Project dirty=false.'
    });
  });

  it('does not report an unobserved Undo command as successful', () => {
    const host = installHost({
      app: {
        findMenuCommandId() { return 2371; },
        executeCommand() {}
      }
    });
    expect(host.handlers['aeShortcut.execute']({ id: 'ae-undo' })).toMatchObject({
      executed: true,
      verified: false
    });
  });

  it('resolves localized menu IDs dynamically for known host actions', () => {
    const host = installHost({
      app: {
        findMenuCommandId(label) { return label === 'Duplicate' ? 2080 : label === 'Save' ? 5 : 0; }
      }
    });
    expect(host.handlers['aeShortcut.resolveMenuCommands']().commands['ae-duplicate']).toEqual({
      commandId: 2080,
      commandIdSource: 'app.findMenuCommandId',
      menuLabel: 'Duplicate'
    });
  });
});
