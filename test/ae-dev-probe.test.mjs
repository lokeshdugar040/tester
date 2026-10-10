/*
 * Developer-only live command probe. These tests evaluate the real host
 * command and client hook against ExtendScript and bridge mocks. They prove
 * the probe logic and its gating. They do not prove live After Effects
 * behaviour; that requires the manual run recorded in docs/live-ae-validation.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostSource = readFileSync(path.join(root, 'host/commands/ae-shortcuts.jsx'), 'utf8');
const platformSource = readFileSync(path.join(root, 'client/js/ui/shortcut-platform.js'), 'utf8');

// Menu labels as a mock AE 26.x install would expose them to findMenuCommandId.
const MENU = {
  'Undo': 2371,
  'Redo': 2372,
  'Duplicate': 2400,
  'Easy Ease': 2500,
  'Add Marker': 2600
};

function loadHost(options = {}) {
  const handlers = {};
  const executed = [];
  const dollar = {
    __rebound: { register(name, fn) { handlers[name] = fn; } },
    global: {},
    os: 'Windows',
    getenv() { return ''; }
  };
  const app = {
    version: '26.5x89',
    isoLanguage: 'en_US',
    project: null,
    findMenuCommandId(label) { return Object.prototype.hasOwnProperty.call(MENU, label) ? MENU[label] : 0; },
    executeCommand(id) {
      if (options.throwOn === id) throw new Error('AE refused command ' + id);
      executed.push(id);
    }
  };
  // Mirrors the ExtendScript global scope the file expects.
  new Function('$', 'app', 'CompItem', 'Property', 'File', hostSource)(
    dollar, app, undefined, undefined, undefined);
  return { probe: handlers['aeShortcut.devProbe'], executed };
}

describe('host developer probe', () => {
  it('refuses to run without the developer flag', () => {
    const { probe, executed } = loadHost();
    expect(() => probe({ mode: 'resolve' })).toThrow(/developer mode/);
    expect(() => probe({ mode: 'dispatch', devMode: false })).toThrow(/developer mode/);
    expect(executed).toEqual([]);
  });

  it('resolves each allowlisted command from the live menu resolver', () => {
    const { probe } = loadHost();
    const result = probe({ mode: 'resolve', devMode: true });
    expect(result.aeVersion).toBe('26.5x89');
    expect(result.locale).toBe('en_US');
    expect(result.osName).toBe('Windows');
    const byId = Object.fromEntries(result.rows.map((row) => [row.commandActionId, row]));
    expect(byId['ae-undo']).toMatchObject({ matchedLabel: 'Undo', commandId: 2371,
      isPositiveInteger: true, registrySource: 'app.findMenuCommandId' });
    expect(byId['ae-easy-ease'].commandId).toBe(2500);
    expect(byId['ae-add-marker'].commandId).toBe(2600);
  });

  it('reports unresolved commands as not executable instead of guessing a number', () => {
    const { probe } = loadHost();
    // ae-save-project has no label in this mock menu, so the resolver cannot find it.
    const row = probe({ mode: 'resolve', devMode: true }).rows
      .find((item) => item.commandActionId === 'ae-save-project');
    expect(row.commandId).toBe(0);
    expect(row.isPositiveInteger).toBe(false);
    expect(row.matchedLabel).toBeNull();
  });

  it('dispatches exactly one resolved command with a non-empty request ID', () => {
    const { probe, executed } = loadHost();
    const result = probe({ mode: 'dispatch', devMode: true, commandActionId: 'ae-undo',
      requestId: 'shortcut-1760000000000-probe-1' });
    expect(executed).toEqual([2371]);
    expect(result.ok).toBe(true);
    expect(result.requestId).toBe('shortcut-1760000000000-probe-1');
    expect(result.commandId).toBe(2371);
    expect(result.commandIdSource).toBe('app.findMenuCommandId');
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('rejects anything that is not an allowlisted command action ID', () => {
    const { probe, executed } = loadHost();
    const requestId = 'shortcut-1760000000000-probe-2';
    for (const commandActionId of ['pad:sample-shortcut-redo', 'sample-redo', 'Undo', '2371', '', undefined]) {
      expect(() => probe({ mode: 'dispatch', devMode: true, commandActionId, requestId })).toThrow();
    }
    expect(executed).toEqual([]);
  });

  it('rejects a missing or malformed request ID before any execution', () => {
    const { probe, executed } = loadHost();
    for (const requestId of ['', 'pin-redo', 'rb_zzz', undefined]) {
      expect(() => probe({ mode: 'dispatch', devMode: true, commandActionId: 'ae-undo', requestId })).toThrow();
    }
    expect(executed).toEqual([]);
  });

  it('returns a host execution error to the caller instead of swallowing it', () => {
    const { probe } = loadHost({ throwOn: 2371 });
    const result = probe({ mode: 'dispatch', devMode: true, commandActionId: 'ae-undo',
      requestId: 'shortcut-1760000000000-probe-3' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/AE refused command 2371/);
    expect(result.requestId).toBe('shortcut-1760000000000-probe-3');
  });
});

describe('client developer probe hook', () => {
  function loadClient(devEnabled) {
    const calls = [];
    const window = {
      Rebound: {
        shortcutDiagnostics: { developmentEnabled: () => devEnabled },
        bridge: {
          invoke(method, args) {
            calls.push({ method, args });
            if (args.mode === 'resolve') return Promise.resolve({ rows: [] });
            return Promise.resolve({ ok: true, commandId: 2371, commandIdSource: 'app.findMenuCommandId',
              verified: false, requestId: args.requestId, aeVersion: '26.5x89' });
          }
        },
        log: { debug() {}, info() {}, warn() {}, error() {} },
        bus: { on() { return () => {}; }, emit() {} },
        disk: { read: (k, f) => f, write: () => true, writeAtomic: () => true }
      },
      crypto: globalThis.crypto,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener() {},
      removeEventListener() {}
    };
    new Function('window', platformSource)(window);
    return { probe: window.Rebound.shortcutDevProbe, calls };
  }

  it('is unavailable outside developer diagnostics', () => {
    const { probe, calls } = loadClient(false);
    expect(() => probe.resolve()).toThrow(/developer diagnostics/);
    expect(calls).toEqual([]);
  });

  it('sends only the action ID and a generated request ID, never pad or sample IDs', async () => {
    const { probe, calls } = loadClient(true);
    await expect(probe.dispatch('pad:sample-shortcut-redo')).rejects.toThrow(/probe-eligible/);
    expect(calls).toEqual([]);

    const record = await probe.dispatch('ae-undo');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('aeShortcut.devProbe');
    expect(calls[0].args).toMatchObject({ mode: 'dispatch', devMode: true, commandActionId: 'ae-undo' });
    expect(calls[0].args.requestId).toMatch(/^shortcut-[0-9]+-/);
    expect(record.requestId).toBe(calls[0].args.requestId);
    expect(record.ok).toBe(true);
    expect(record.commandIdSource).toBe('app.findMenuCommandId');
  });

  it('exposes resolve only through the developer-gated bridge method', async () => {
    const { probe, calls } = loadClient(true);
    await probe.resolve();
    expect(calls).toEqual([{ method: 'aeShortcut.devProbe', args: { mode: 'resolve', devMode: true } }]);
  });
});
