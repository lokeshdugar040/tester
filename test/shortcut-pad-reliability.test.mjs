/*
 * Shortcut Pad reliability and native-keyboard safety.
 *
 * These tests load the real browser modules (global-hotkeys, shortcut-pads,
 * shortcut-platform) into a fresh window per "panel session", so a reload is
 * simulated by building a new workspace over the same persisted storage.
 * The AE bridge is a host fake that enforces the same request checks as
 * host/commands/ae-shortcuts.jsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const PAD_SOURCES = {
  pads: 'client/js/ui/shortcut-pads.js',
  platform: 'client/js/ui/shortcut-platform.js',
  widget: 'client/js/ui/shortcut-pad-widget.js',
  actions: 'client/js/ui/shortcut-actions.js',
  hotkeys: 'client/js/ui/global-hotkeys.js'
};
const sources = Object.fromEntries(Object.entries(PAD_SOURCES).map(([k, rel]) => [k, read(rel)]));
const homeCss = read('client/css/home.css');
const hostSource = read('host/commands/ae-shortcuts.jsx');

// The four real After Effects commands the Shortcut Pad must run reliably.
const COMMANDS = [
  { id: 'ae.app.undo', label: 'Undo', commandActionId: 'ae-undo', commandId: 2371,
    chord: 'Ctrl+Z', menuPath: 'Edit \u203a Undo', category: 'General' },
  { id: 'ae.app.redo', label: 'Redo', commandActionId: 'ae-redo', commandId: 2372,
    chord: 'Ctrl+Shift+Z', menuPath: 'Edit \u203a Redo', category: 'General' },
  { id: 'ae.layer.duplicate', label: 'Duplicate', commandActionId: 'ae-duplicate', commandId: 2400,
    chord: 'Ctrl+D', menuPath: 'Edit \u203a Duplicate', category: 'Layer Management' },
  { id: 'ae.keyframes.easy-ease', label: 'Easy Ease', commandActionId: 'ae-easy-ease', commandId: 2500,
    chord: 'F9', menuPath: 'Animation \u203a Keyframe Assistant \u203a Easy Ease', category: 'Keyframes & Graph' }
];

function actionFor(command) {
  return {
    id: command.id,
    label: command.label,
    commandName: command.label,
    menuPath: command.menuPath,
    workflowCategory: command.category,
    kind: 'apply',
    aeMapShortcut: true,
    deliveryRoute: 'host-command',
    commandId: command.commandId,
    commandIdSource: 'verified-host-probe',
    activeChord: command.chord,
    displayChord: command.chord,
    aeVersion: '26.5x89',
    commandRequest: {
      commandActionId: command.commandActionId,
      commandId: command.commandId,
      commandIdSource: 'verified-host-probe',
      preferredRoute: 'host-command'
    }
  };
}

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

/*
 * One panel session. `storage` persists across sessions (the Rebound disk).
 * `registryLoaded` mirrors whether the AE keymap has been read yet.
 */
function createWorkspace(storage, options = {}) {
  const R = {};
  const bridgeCalls = [];
  const executions = [];
  const keymapRefreshes = [];
  const settingsWrites = [];
  const listenerTypes = [];
  const busHandlers = {};
  const actions = (options.actions || COMMANDS).map(actionFor);
  let registryLoaded = options.registryLoaded !== false;
  let devMode = options.devMode === true;
  const hostBehavior = options.hostBehavior || null;

  const win = {
    Rebound: R,
    navigator: { platform: 'Win32' },
    crypto: globalThis.crypto,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener(type) { listenerTypes.push(type); },
    removeEventListener() {}
  };

  R.log = { debug() {}, info() {}, warn() {}, error() {} };
  R.ui = { toast() {} };
  R.shell = {};
  R.shortcutDiagnostics = {
    developmentEnabled() { return devMode; },
    record() {}
  };
  R.bus = {
    on(type, fn) {
      (busHandlers[type] = busHandlers[type] || []).push(fn);
      return () => {};
    },
    emit(type) { (busHandlers[type] || []).forEach((fn) => fn()); }
  };
  R.disk = {
    read(key, fallback) {
      return storage.has(key) ? clone(storage.get(key)) : fallback;
    },
    write(key, value) {
      settingsWrites.push(key);
      storage.set(key, clone(value));
      return true;
    },
    writeAtomic(key, value) {
      settingsWrites.push(key);
      storage.set(key, clone(value));
      return true;
    }
  };
  R.homeActions = {
    byId() { return null; },
    shortcutCatalog() { return []; },
    markActionVerified() { return false; }
  };
  R.afterEffectsShortcuts = {
    // Production resolves nothing until the AE keymap has been read.
    resolveAction(id) {
      if (!registryLoaded) return null;
      return actions.find((action) => action.id === id) || null;
    },
    catalogEntries() { return []; },
    keymapLoaded() { return registryLoaded; },
    registryVersion() { return '26.5x89'; },
    refreshActiveKeymap(force) {
      keymapRefreshes.push(force);
      return Promise.resolve();
    },
    updateContext() {},
    markExecutionVerified() { return false; },
    currentContext() { return null; }
  };
  R.bridge = {
    invoke(method, args) {
      bridgeCalls.push({ method, args: clone(args) });
      if (method === 'system.selectionSummary') {
        return Promise.resolve({
          hasComp: true,
          selectedLayerCount: 1,
          selectedMaskCount: 0,
          totalSelectedKeys: 1,
          aeForeground: true,
          detectedContext: 'Timeline'
        });
      }
      if (method !== 'aeShortcut.executeRequest') {
        return Promise.reject(new Error('Unexpected bridge method ' + method));
      }
      if (hostBehavior) return hostBehavior(args.request, executions);
      const request = args.request;
      // Mirror the host's checks: a real numeric command must be requested.
      if (!request || !request.requestId ||
          typeof request.commandId !== 'number' || request.commandId <= 0) {
        return Promise.reject(new Error('The typed shortcut command request is invalid.'));
      }
      const command = COMMANDS.find((item) => item.commandActionId === request.commandActionId);
      if (!command || command.commandId !== request.commandId) {
        return Promise.reject(new Error('The shortcut command request no longer matches the active AE keymap.'));
      }
      executions.push({
        requestId: request.requestId,
        commandId: request.commandId,
        commandActionId: request.commandActionId
      });
      return Promise.resolve({
        ok: true,
        requestId: request.requestId,
        commandId: request.commandId,
        commandName: command.label,
        executionRoute: 'host-command',
        executed: true,
        contextVerified: true,
        verified: false,
        result: 'Command dispatched.'
      });
    }
  };
  R.globalHotkeys = undefined;

  // Real modules, loaded in the same order as client/index.html.
  new Function('window', sources.hotkeys)(win);
  new Function('window', sources.pads)(win);
  new Function('window', sources.platform)(win);

  return {
    R,
    router: R.actionRouter,
    pads: R.shortcutPads,
    bridgeCalls,
    executions,
    keymapRefreshes,
    settingsWrites,
    listenerTypes,
    setRegistryLoaded(value) {
      registryLoaded = value === true;
      R.bus.emit('ae-shortcut-map:updated');
    },
    setDevMode(value) { devMode = value === true; }
  };
}

function newStorage(initial) {
  const storage = new Map();
  if (initial !== undefined) storage.set('home-shortcut-pads', clone(initial));
  return storage;
}

// Build the four canonical pins through the public API, then "reload" the panel.
function savePins(storage) {
  const session = createWorkspace(storage);
  COMMANDS.forEach((command) => {
    session.pads.add(command.label, { actionId: command.id });
  });
  return session;
}

describe('Shortcut Pad: canonical execution after a panel reload', () => {
  it('runs Undo, Redo, Duplicate, and Easy Ease exactly once each after reload', async () => {
    const storage = newStorage();
    savePins(storage);

    // Panel reload: a new session over the same storage, registry not yet read.
    const reloaded = createWorkspace(storage, { registryLoaded: false });
    expect(reloaded.pads.all().map((pad) => pad.label)).toEqual(
      COMMANDS.map((command) => command.label));

    // Before the keymap loads, a click reports loading and dispatches nothing.
    const early = await reloaded.router.executePin(reloaded.pads.all()[0].id,
      { kind: 'shortcut-pad' });
    expect(early.state).toBe('Loading');
    expect(reloaded.executions).toHaveLength(0);

    reloaded.setRegistryLoaded(true);
    const settingsBefore = reloaded.settingsWrites.length;

    for (const pin of reloaded.pads.all()) {
      const command = COMMANDS.find((item) => item.label === pin.label);
      const before = reloaded.executions.length;
      // A human click is never inside the 120 ms duplicate-activation window.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 130));
      const result = await reloaded.router.executePin(pin.id, { kind: 'shortcut-pad' });

      expect(result.state).toBe('Done');
      expect(result.requestId).toMatch(/^shortcut-/);
      expect(reloaded.executions).toHaveLength(before + 1);
      const dispatched = reloaded.executions[reloaded.executions.length - 1];
      expect(dispatched.commandId).toBe(command.commandId);
      expect(dispatched.commandActionId).toBe(command.commandActionId);
      expect(dispatched.requestId).toBe(result.requestId);
    }

    expect(reloaded.executions.map((item) => item.commandId)).toEqual([2371, 2372, 2400, 2500]);
    // Normal tile execution never writes settings.
    expect(reloaded.settingsWrites).toHaveLength(settingsBefore);
    // No registry rebuild happens on click.
    expect(reloaded.keymapRefreshes).toHaveLength(0);
  });

  it('gives every activation a unique, non-empty request ID', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage);
    const pin = session.pads.all()[0];
    const ids = [];
    for (let index = 0; index < 3; index++) {
      const result = await session.router.executePin(pin.id, { kind: 'shortcut-pad' });
      ids.push(result.requestId);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 130));
    }
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits one structured development record per activation', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage, { devMode: true });
    const pin = session.pads.all()[0];
    const result = await session.router.executePin(pin.id, { kind: 'shortcut-pad' });

    const record = session.router.pinDebug()
      .filter((entry) => entry.phase === 'Shortcut execution completed' &&
        entry.details.requestId === result.requestId);
    expect(record).toHaveLength(1);
    expect(record[0].details).toMatchObject({
      requestId: result.requestId,
      pinId: pin.id,
      commandId: 2371,
      commandName: 'Undo',
      ok: true,
      error: ''
    });
    expect(typeof record[0].details.startedAt).toBe('string');
    expect(typeof record[0].details.completedAt).toBe('string');
    expect(typeof record[0].details.durationMs).toBe('number');
  });

  it('reports a host failure visibly without throwing or re-dispatching', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage, {
      hostBehavior() { return Promise.reject(new Error('After Effects is busy.')); }
    });
    const pin = session.pads.all()[0];
    const result = await session.router.executePin(pin.id, { kind: 'shortcut-pad' });

    expect(result.state).toBe('Failed');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('After Effects is busy.');
    expect(result.requestId).toMatch(/^shortcut-/);
  });
});

describe('Shortcut Pad: stale and invalid pins never reach AE', () => {
  it('migrates a legacy sample pin as unavailable and never dispatches it', async () => {
    const storage = newStorage([{
      id: 'sample-shortcut-redo',
      label: 'Redo',
      actionType: 'ae-command',
      actionId: 'pad:sample-shortcut-redo',
      pinnedSlot: 0
    }]);
    const session = createWorkspace(storage);
    const pins = session.pads.all();
    expect(pins).toHaveLength(1);
    expect(pins[0].id).not.toMatch(/sample/i);
    expect(pins[0].enabled).toBe(false);

    const result = await session.router.executePin(pins[0].id, { kind: 'shortcut-pad' });
    expect(result.state).toBe('Unsupported');
    expect(result.requestId).toMatch(/^shortcut-/);
    expect(session.bridgeCalls).toHaveLength(0);
    expect(session.keymapRefreshes).toHaveLength(0);
  });

  it('never executes a pad: or sample: action ID through the fresh-action path', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage);

    for (const actionId of ['pad:sample-shortcut-redo', 'pad:pin-redo', 'sample-shortcut-undo']) {
      const result = await session.router.executeFreshAction(actionId, { kind: 'shortcut-search' });
      expect(result.state).not.toBe('Done');
    }
    expect(session.bridgeCalls.filter((call) => call.method === 'aeShortcut.executeRequest'))
      .toHaveLength(0);
    expect(session.keymapRefreshes).toHaveLength(0);
  });

  it('does not execute an empty slot or a missing pin', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage);

    const empty = await session.router.executePin('', { kind: 'shortcut-pad' });
    const missing = await session.router.executePin('pin-does-not-exist', { kind: 'shortcut-pad' });
    expect(empty.state).toBe('Failed');
    expect(missing.state).toBe('Unsupported');
    expect(session.bridgeCalls).toHaveLength(0);
  });

  it('marks an unresolved action unavailable without executing or refreshing the registry', async () => {
    const storage = newStorage([{
      id: 'pin-gone', label: 'Gone', actionId: 'ae.no-longer-registered', pinnedSlot: 0
    }]);
    const session = createWorkspace(storage);
    session.setRegistryLoaded(true);
    const pin = session.pads.all()[0];

    const first = await session.router.executePin(pin.id, { kind: 'shortcut-pad' });
    expect(first.state).toBe('Unsupported');
    expect(first.pinStatus).toBe('unavailable');
    expect(session.bridgeCalls).toHaveLength(0);
    expect(session.keymapRefreshes).toHaveLength(0);
  });
});

describe('Shortcut Pad: native keyboard safety', () => {
  it('installs no keyboard listeners while loading and running pins', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage);
    await session.router.executePin(session.pads.all()[0].id, { kind: 'shortcut-pad' });

    expect(session.listenerTypes.filter((type) => /^key/.test(type))).toEqual([]);
  });

  it('has no keydown, keyup, keypress, synthetic, or dispatch code in the pad modules', () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/['"`](?:keydown|keyup|keypress)['"`]/);
      expect(source, name).not.toMatch(/\bonkey(?:down|up|press)\b/);
      expect(source, name).not.toMatch(/new\s+KeyboardEvent/);
      expect(source, name).not.toMatch(/\.dispatchEvent\s*\(/);
    }
  });

  it('never stops propagation and calls preventDefault only for drag gestures', () => {
    const platform = sources.platform;
    const widget = sources.widget;
    expect(platform).not.toMatch(/\bpreventDefault\s*\(/);
    expect(platform).not.toMatch(/\bstopPropagation\s*\(/);
    expect(widget).not.toMatch(/\bstopPropagation\s*\(/);

    const dragStart = widget.indexOf('function attachDragHandlers');
    const dragEnd = widget.indexOf('function scheduleFit');
    expect(dragStart).toBeGreaterThan(-1);
    expect(dragEnd).toBeGreaterThan(dragStart);
    const outsideDrag = widget.slice(0, dragStart) + widget.slice(dragEnd);
    expect(outsideDrag).not.toMatch(/\bpreventDefault\s*\(/);
  });

  it('never writes AE preferences or .kys keymaps, and only reads the keymap', () => {
    expect(hostSource).not.toMatch(/\.kys\b/);
    expect(hostSource).not.toMatch(/\.open\(['"]w['"]\)/);
    expect(hostSource).not.toMatch(/SendInput|keybd_event|SendKeys/);
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/\.kys\b/);
    }
  });

  it('keeps global key capture disabled and never sends chords as commands', async () => {
    const storage = newStorage();
    savePins(storage);
    const session = createWorkspace(storage);
    const hotkeys = session.R.globalHotkeys;
    expect(hotkeys.supported).toBe(false);
    expect(hotkeys.beginCaptureSession()).toBe('');
    expect(hotkeys.isCaptureActive()).toBe(false);
    expect(hotkeys.start()).toBe(false);
    await expect(hotkeys.executeChord('Ctrl+Z')).rejects.toThrow(/disabled/);
    expect(session.bridgeCalls.filter((call) => /key|chord/i.test(call.method))).toEqual([]);
  });
});

describe('Shortcut Pad: retry and stale-mapping root causes are gone', () => {
  it('has no pad-ID keyed refresh-and-retry loop and no stale-retry message', () => {
    expect(sources.platform).not.toMatch(/remained stale after one refresh retry/);
    expect(sources.platform).not.toMatch(/function refreshPinRegistry/);
    expect(sources.platform).not.toMatch(/refreshForActivation\(actionId, attempt/);
    // Refresh is only requested after the host has rejected a request.
    expect(sources.platform.match(/requestRegistryRefresh\(/g)).toHaveLength(2);
  });
});

describe('Shortcut Pad: scoped visual rules', () => {
  function ruleBodies(css) {
    const rules = [];
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(css))) {
      if (/rb-shortcut-pad/.test(match[1])) rules.push({ selector: match[1].trim(), body: match[2] });
    }
    return rules;
  }

  it('never uppercases, breaks mid-word, or forces all caps on pad text', () => {
    const rules = ruleBodies(homeCss);
    expect(rules.length).toBeGreaterThan(20);
    for (const rule of rules) {
      expect(rule.body, rule.selector).not.toMatch(/text-transform\s*:\s*uppercase/);
      expect(rule.body, rule.selector).not.toMatch(/word-break\s*:\s*break-all/);
    }
  });

  it('keeps single-line pad labels with an ellipsis instead of splitting words', () => {
    const label = ruleBodies(homeCss).find((rule) => rule.selector === '.rb-shortcut-pad-label');
    expect(label).toBeTruthy();
    expect(label.body).toMatch(/white-space:\s*nowrap/);
    expect(label.body).toMatch(/text-overflow:\s*ellipsis/);
    expect(label.body).toMatch(/word-break:\s*normal/);
  });

  it('keeps cards compact: 72px minimum, 12px label, 10px chord', () => {
    const cell = ruleBodies(homeCss).find((rule) => rule.selector === '.rb-shortcut-pad-cell');
    expect(cell.body).toMatch(/min-height:\s*72px/);
    const label = ruleBodies(homeCss).find((rule) => rule.selector === '.rb-shortcut-pad-label');
    expect(label.body).toMatch(/font-size:\s*12px/);
    const chord = ruleBodies(homeCss).find((rule) => rule.selector === '.rb-shortcut-pad-chord');
    expect(chord.body).toMatch(/font-size:\s*10px/);
  });
});
