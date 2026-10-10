import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/js/ui/ae-shortcut-diagnostics.js'),
  'utf8'
);

function createDiagnostics(search = '') {
  const values = new Map();
  const events = [];
  const R = {
    disk: {
      read(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
      write(key, value) { values.set(key, value); return true; }
    },
    bus: { emit(name) { events.push(name); } }
  };
  const win = { Rebound: R, location: { search } };
  new Function('window', source)(win);
  return { api: R.shortcutDiagnostics, values, events };
}

describe('After Effects shortcut diagnostics', () => {
  it('persists structured local execution details and a bounded recent-action list', () => {
    const { api, values, events } = createDiagnostics();
    const entry = api.record({
      actionId: 'ae-map-CSwitchboard-Duplicate',
      label: 'Duplicate Selected Layer',
      shortcut: 'Ctrl+D',
      bindingAlternatives: ['Ctrl+D', 'PadMultiply'],
      workflowCategory: 'Layer Management',
      aeContext: 'CSwitchboard',
      requiredState: 'Select a layer.',
      route: 'focused-chord',
      status: 'delivered-unverified',
      delivered: true,
      targetPid: 123,
      targetHwnd: '17',
      foregroundHwndBefore: '17',
      focusedHwndBefore: '18',
      focusStatus: 'preserved',
      contextVerified: true
    });

    expect(entry).toMatchObject({
      actionId: 'ae-map-CSwitchboard-Duplicate',
      bindingAlternatives: ['Ctrl+D', 'PadMultiply'],
      aeContext: 'CSwitchboard',
      route: 'focused-chord',
      delivered: true,
      contextVerified: true,
      targetPid: 123,
      targetHwnd: '17',
      focusedHwndBefore: '18',
      focusStatus: 'preserved'
    });
    expect(entry.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(api.list(1)).toEqual([entry]);
    expect(api.recent()).toEqual(['ae-map-CSwitchboard-Duplicate']);
    expect(values.get('ae-shortcut-execution-log')).toEqual([entry]);
    expect(events).toContain('ae-shortcut-diagnostics:updated');
  });

  it('keeps diagnostics hidden unless explicitly enabled in development', () => {
    expect(createDiagnostics().api.developmentEnabled()).toBe(false);
    expect(createDiagnostics('?shortcutDiagnostics=1').api.developmentEnabled()).toBe(true);
  });

  it('reports a persistence failure without creating a success-shaped record', () => {
    const win = {
      Rebound: {
        disk: { read(_key, fallback) { return fallback; }, write() { return false; } },
        log: { error() {} }
      },
      location: { search: '' }
    };
    new Function('window', source)(win);
    expect(win.Rebound.shortcutDiagnostics.record({ actionId: 'failed-log' })).toBe(false);
    expect(win.Rebound.shortcutDiagnostics.list()).toEqual([]);
  });
});
