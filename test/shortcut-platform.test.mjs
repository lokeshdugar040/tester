import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'client/js/ui/shortcut-platform.js'), 'utf8');

function createRouter(options = {}) {
  const calls = [];
  const diagnostics = [];
  let action = options.action || null;
  const pad = options.pad || null;
  const selection = options.selection || {
    hasComp: true,
    selectedLayerCount: 1,
    selectedMaskCount: 0,
    totalSelectedKeys: 0
  };
  const helperStatus = options.helperStatus || {
    running: true,
    aeForeground: true,
    detectedContext: 'Timeline',
    targetPid: 42,
    foregroundHwnd: '0x10',
    focusedHwnd: '0x20'
  };
  const R = {
    shortcutPads: {
      byId(id) { return pad && pad.id === id ? pad : null; },
      resolve(value) {
        return {
          enabled: value.enabled === true &&
            (!action || Number(value.commandId) === action.commandId),
          action: action && action.id === value.actionId ? action : null,
          unavailableReason: value.unavailableReason || 'Edit this pin to repair it.'
        };
      },
      hotkeyChord(value) {
        const parts = [];
        if (value.ctrl) parts.push('Ctrl');
        if (value.alt) parts.push('Alt');
        if (value.shift) parts.push('Shift');
        if (value.win) parts.push('Win');
        if (value.key) parts.push(value.key);
        return parts.join('+');
      },
      effectiveChord(value) { return value.recordedChord || value.activeChord || ''; }
    },
    afterEffectsShortcuts: {
      resolveAction(id) { return action && action.id === id ? action : null; },
      updateContext(value) { calls.push({ context: value }); },
      refreshActiveKeymap(force) {
        calls.push({ refreshActiveKeymap: force });
        return Promise.resolve(options.onRefresh && options.onRefresh(force));
      },
      markExecutionVerified(id, result) {
        calls.push({ verifiedId: id, verification: result });
        return true;
      }
    },
    homeActions: {
      byId(id) { return action && action.id === id ? action : null; },
      defaultArgs(value) { return value.invoke && value.invoke.args || {}; },
      markActionVerified(id, result, method, args) {
        calls.push({ verifiedAction: id, result, method, args });
        return true;
      }
    },
    globalHotkeys: {
      supported: true,
      hotkeyCapture: { active: options.captureLocked === true },
      isCaptureActive() { return options.captureLocked === true; },
      status() { return helperStatus; },
      executeChord(chord, context) {
        calls.push({ chord, context });
        return Promise.resolve(options.chordResult || {
          ok: true,
          delivered: true,
          executed: false,
          verified: false,
          contextVerified: false
        });
      },
      executeSequence(sequence, context) {
        calls.push({ sequence, context });
        return Promise.resolve(options.sequenceResult || {
          ok: true,
          delivered: true,
          executed: false,
          verified: false,
          contextVerified: false
        });
      }
    },
    bridge: {
      invoke(method, args) {
        calls.push({ method, args });
        if (method === 'system.selectionSummary') {
          return Promise.resolve(selection);
        }
        if (typeof options.hostResult === 'function') {
          return Promise.resolve().then(() => options.hostResult(method, args, calls));
        }
        return Promise.resolve(options.hostResult || {
          ok: true,
          executed: true,
          verified: true,
          contextVerified: true,
          executionRoute: 'host-command',
          result: 'Observed the expected After Effects change.'
        });
      }
    },
    shortcutDiagnostics: {
      record(entry) { diagnostics.push(entry); return entry; }
    },
    shell: {
      openTool(id) { calls.push({ openTool: id }); }
    },
    log: { error() {} }
  };
  const win = {
    Rebound: R,
    confirm() { calls.push({ confirm: true }); return true; }
  };
  new Function('window', source)(win);
  return { api: R.actionRouter, calls, diagnostics };
}

describe('central action router', () => {
  it('runs a saved Rebound action directly without requiring verification or route metadata', async () => {
    const action = {
      id: 'duplicate-selected-items',
      label: 'Duplicate Selected Items',
      kind: 'apply',
      invoke: {
        method: 'aeShortcut.execute',
        args: { id: 'ae-duplicate' }
      }
    };
    const { api, calls } = createRouter({ action });

    await expect(api.triggerAction(action.id)).resolves.toMatchObject({
      ok: true,
      actionId: action.id,
      label: action.label
    });
    expect(calls).toContainEqual({
      method: 'aeShortcut.execute',
      args: { id: 'ae-duplicate' }
    });
    expect(calls.some((call) => call.method === 'system.selectionSummary')).toBe(false);
  });

  it('never dispatches a keyboard chord as an AE command', async () => {
    const action = {
      id: 'ae.unverified-chord',
      label: 'Unverified Chord',
      aeMapShortcut: true,
      activeChord: 'Ctrl+J'
    };
    const { api, calls } = createRouter({ action });

    await expect(api.executeAction(action.id, { kind: 'ae-catalog' }))
      .resolves.toMatchObject({ state: 'Unsupported', route: 'unsupported' });
    expect(calls.some((call) => call.chord)).toBe(false);
  });

  it('uses the verified numeric host command route', async () => {
    const action = {
      id: 'ae.test-command',
      label: 'Test Command',
      deliveryRoute: 'host-command',
      userStatus: 'Needs Composition',
      activeChord: 'Ctrl+J',
      commandId: 1234,
      commandIdSource: 'verified-host-probe',
      aeMapShortcut: true,
      commandRequest: {
        commandActionId: 'ae-test-command',
        commandId: 1234,
        commandIdSource: 'verified-host-probe',
        preferredRoute: 'host-command'
      },
      canonicalRecord: {
        aeContext: 'CCompTimePanel',
        requirements: { composition: true },
        requiredContext: 'Composition'
      }
    };
    const { api, calls, diagnostics } = createRouter({ action });

    const result = await api.executeAction(action.id, { kind: 'shortcut-pad' });

    expect(result).toMatchObject({
      ok: true,
      state: 'Done',
      route: 'host-command',
      delivered: false,
      executed: true,
      verified: true,
      actorCategory: 'human-user'
    });
    const requestCall = calls.find((call) => call.method === 'aeShortcut.executeRequest');
    expect(requestCall.args.request.preferredRoute).toBe('host-command');
    expect(requestCall.args.request.contextSnapshot).toMatchObject({
      detectedContext: 'Timeline',
      aeForeground: true
    });
    expect(diagnostics[0]).toMatchObject({
      triggerSource: 'shortcut-pad',
      actorCategory: 'human-user',
      route: 'host-command',
      verified: true
    });
  });

  it('uses the persistent JSX bridge before a focused chord when it is registered', async () => {
    const action = {
      id: 'ae.bridge-command',
      label: 'Bridge Command',
      deliveryRoute: 'focused-chord',
      activeChord: 'Ctrl+J',
      commandActionId: 'ae-bridge-command',
      commandRequest: {
        commandActionId: 'ae-bridge-command',
        preferredRoute: 'focused-chord',
        fallbackRoute: 'focused-chord'
      },
      canonicalRecord: { requirements: {} }
    };
    const { api, calls } = createRouter({ action });

    const result = await api.executeAction(action.id, { kind: 'ae-catalog' });

    expect(result.route).toBe('bridge-jsx');
    expect(calls.some((call) => call.method === 'aeShortcut.executeRequest')).toBe(true);
    expect(calls.some((call) => call.chord === 'Ctrl+J')).toBe(false);
  });

  it('returns real context guidance without invoking a route', async () => {
    const action = {
      id: 'ae.layer-command',
      label: 'Layer Command',
      deliveryRoute: 'host-command',
      commandId: 1234,
      commandIdSource: 'verified-host-probe',
      commandRequest: {
        commandActionId: 'ae-layer-command',
        commandId: 1234,
        commandIdSource: 'verified-host-probe',
        preferredRoute: 'host-command'
      },
      canonicalRecord: {
        requirements: { composition: true, layer: true },
        requiredContext: 'Selected layer'
      }
    };
    const { api, calls } = createRouter({
      action,
      selection: {
        hasComp: true,
        selectedLayerCount: 0,
        selectedMaskCount: 0,
        totalSelectedKeys: 0
      }
    });

    const result = await api.executeAction(action.id, { kind: 'home-action' });

    expect(result).toMatchObject({
      ok: false,
      state: 'Needs Selection',
      route: 'host-command',
      routeAvailable: true,
      userMessage: 'Select one or more layers in a composition, then try again.'
    });
    expect(calls.some((call) => call.method === 'aeShortcut.executeRequest')).toBe(false);
  });

  it('returns Unsupported for a chord-only action without sending a key', async () => {
    const action = {
      id: 'ae.chord-command',
      label: 'Chord Command',
      deliveryRoute: 'focused-chord',
      activeChord: 'Ctrl+Alt+N',
      actionKind: 'ae-chord',
      canonicalRecord: { requirements: {} }
    };
    const { api, calls } = createRouter({ action });

    const result = await api.executeAction(action.id, { kind: 'ae-catalog' });

    expect(result).toMatchObject({
      ok: false,
      state: 'Unsupported',
      route: 'unsupported',
      delivered: false,
      executed: false,
      verified: false
    });
    expect(result.userMessage).toContain('safe execution route');
    expect(calls.some((call) => call.chord)).toBe(false);
  });

  it('routes a saved pin by numeric command ID, never by its label or chord', async () => {
    const action = {
      id: 'ae.undo',
      label: 'Undo',
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      kind: 'apply',
      aeMapShortcut: true,
      deliveryRoute: 'host-command',
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      activeChord: 'Ctrl+Alt+N',
      commandRequest: {
        commandActionId: 'ae-undo',
        commandId: 2371,
        commandIdSource: 'verified-host-probe',
        commandName: 'Undo',
        menuPath: 'Edit › Undo',
        preferredRoute: 'host-command'
      },
      canonicalRecord: { requirements: {} }
    };
    const pad = {
      id: 'user-pad-17',
      pinId: 'user-pad-17',
      label: 'A renamed pin',
      displayName: 'A renamed pin',
      actionId: action.id,
      actionType: 'ae-command',
      enabled: true,
      status: 'ready',
      commandId: 2371,
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      action: {
        type: 'ae-command',
        actionId: action.id,
        commandActionId: 'ae-undo',
        commandId: 2371,
        commandName: 'Undo',
        menuPath: 'Edit › Undo'
      }
    };
    const { api, calls } = createRouter({ pad, action });

    const result = await api.executePin('user-pad-17', {
      kind: 'global-hotkey',
      actorCategory: 'human-user',
      pinId: 'user-pad-17'
    });

    expect(result.actionId).toBe(action.id);
    expect(result.pinId).toBe('user-pad-17');
    expect(result.route).toBe('host-command');
    expect(calls.find((call) => call.method === 'aeShortcut.executeRequest')
      .args.request.commandId).toBe(2371);
    expect(calls.some((call) => call.chord)).toBe(false);
  });

  it('blocks Shortcut Pad execution while hotkey capture is locked', async () => {
    const { api, calls } = createRouter({
      captureLocked: true,
      pad: {
        id: 'locked-pad',
        pinId: 'locked-pad',
        label: 'Locked Shortcut',
        actionId: 'duplicate-selected-items',
        enabled: true,
        actionType: 'script'
      }
    });

    await expect(api.executePin('locked-pad', { kind: 'global-hotkey' }))
      .resolves.toMatchObject({ state: 'Failed', error: 'Shortcut capture is active.' });
    expect(calls).toHaveLength(0);
  });

  it('never dispatches a sample pin ID and always returns a request ID', async () => {
    const { api, calls } = createRouter();

    const result = await api.executePin('sample-shortcut-redo', {
      kind: 'shortcut-pad'
    });

    expect(result).toMatchObject({
      state: 'Unsupported',
      requestId: expect.stringMatching(/^shortcut-/),
      pinId: 'sample-shortcut-redo'
    });
    expect(calls).toHaveLength(0);
  });

  it('dispatches one request for rapid activations and returns its AE request ID', async () => {
    const action = {
      id: 'ae.undo',
      label: 'Undo',
      kind: 'apply',
      aeMapShortcut: true,
      deliveryRoute: 'host-command',
      commandId: 42,
      commandIdSource: 'verified-host-probe',
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      commandRequest: {
        commandActionId: 'ae-undo',
        commandId: 42,
        commandIdSource: 'verified-host-probe',
        commandName: 'Undo',
        menuPath: 'Edit › Undo',
        preferredRoute: 'host-command'
      }
    };
    const pad = {
      id: 'pin-undo',
      pinId: 'pin-undo',
      label: 'Renamed Undo',
      displayName: 'Renamed Undo',
      actionId: action.id,
      actionType: 'ae-command',
      commandId: 42,
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      action: {
        type: 'ae-command',
        actionId: action.id,
        commandActionId: 'ae-undo',
        commandId: 42,
        commandName: 'Undo',
        menuPath: 'Edit › Undo'
      },
      enabled: true,
      status: 'ready'
    };
    let resolveHost;
    const hostResult = new Promise((resolve) => { resolveHost = resolve; });
    const { api, calls } = createRouter({ pad, action, hostResult });
    const first = api.executePin('pin-undo', { kind: 'shortcut-pad' });
    const duplicates = [];
    for (let index = 0; index < 20; index++) {
      duplicates.push(api.executePin('pin-undo', { kind: 'shortcut-pad' }));
    }
    const duplicateResults = await Promise.all(duplicates);
    expect(duplicateResults.every((result) => result.state === 'Running')).toBe(true);
    expect(calls.filter((call) => call.method === 'aeShortcut.executeRequest')).toHaveLength(0);

    let dispatched = null;
    for (let step = 0; step < 10 && !dispatched; step++) {
      await Promise.resolve();
      dispatched = calls.find((call) => call.method === 'aeShortcut.executeRequest');
    }
    expect(dispatched).toBeDefined();
    expect(dispatched.args.request.requestId).toMatch(/^shortcut-\d+-[A-Za-z0-9-]+$/);
    expect(dispatched.args.request.commandId).toBe(42);
    expect(calls.filter((call) => call.method === 'aeShortcut.executeRequest')).toHaveLength(1);
    resolveHost({
      ok: true,
      requestId: dispatched.args.request.requestId,
      executed: true,
      verified: true,
      contextVerified: true,
      executionRoute: 'host-command',
      result: 'Undo completed.'
    });
    await expect(first).resolves.toMatchObject({
      state: 'Done',
      pinId: 'pin-undo',
      requestId: dispatched.args.request.requestId,
      verified: true
    });
  });

  it('marks a pin unavailable instead of retrying a changed command ID', async () => {
    const action = {
      id: 'ae.redo',
      label: 'Redo',
      kind: 'apply',
      commandName: 'Redo',
      menuPath: 'Edit › Redo',
      aeMapShortcut: true,
      deliveryRoute: 'host-command',
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      commandRequest: {
        commandActionId: 'ae-redo',
        commandId: 2371,
        commandIdSource: 'verified-host-probe',
        commandName: 'Redo',
        menuPath: 'Edit › Redo',
        preferredRoute: 'host-command'
      },
      canonicalRecord: { requirements: {} }
    };
    const pad = {
      id: 'pin-redo',
      pinId: 'pin-redo',
      label: 'Redo',
      displayName: 'Redo',
      actionId: action.id,
      actionType: 'ae-command',
      commandId: 2371,
      commandName: 'Redo',
      menuPath: 'Edit › Redo',
      action: {
        type: 'ae-command',
        actionId: 'ae.redo',
        commandActionId: 'ae-redo',
        commandId: 2371,
        commandName: 'Redo',
        menuPath: 'Edit › Redo'
      },
      enabled: true,
      status: 'ready'
    };
    let dispatchCount = 0;
    const { api, calls } = createRouter({
      pad,
      action,
      onRefresh(force) {
        expect(force).toBe(true);
        action.commandId = 2372;
        action.commandIdSource = 'verified-host-probe';
        action.deliveryRoute = 'host-command';
        action.commandRequest.commandId = 2372;
        action.commandRequest.commandIdSource = 'verified-host-probe';
        action.commandRequest.preferredRoute = 'host-command';
      },
      hostResult(method, args) {
        if (method !== 'aeShortcut.executeRequest') return null;
        dispatchCount++;
        return {
          ok: false,
          requestId: args.request.requestId,
          error: 'The shortcut command request no longer matches the active AE keymap.'
        };
      }
    });

    const result = await api.executePin('pin-redo', { kind: 'shortcut-pad' });
    const requests = calls.filter((call) => call.method === 'aeShortcut.executeRequest')
      .map((call) => call.args.request);

    expect(result).toMatchObject({
      actionId: 'ae.redo',
      pinId: 'pin-redo',
      state: 'Unsupported',
      pinStatus: 'unavailable'
    });
    expect(calls).toContainEqual({ refreshActiveKeymap: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      preferredRoute: 'host-command',
      commandActionId: 'ae-redo',
      commandId: 2371
    });
    expect(requests[0].requestId).toBeTruthy();
    expect(dispatchCount).toBe(1);
  });

  it('records developer and automatic sources separately', async () => {
    const action = {
      id: 'ae.test-command',
      label: 'Test Command',
      deliveryRoute: 'host-command',
      commandId: 1234,
      commandIdSource: 'verified-host-probe',
      commandRequest: { commandActionId: 'ae-test-command' },
      canonicalRecord: { requirements: {} }
    };
    const { api, diagnostics } = createRouter({ action });

    await api.executeAction(action.id, { kind: 'developer-test' });
    await api.executeAction(action.id, { kind: 'helper-restart' });

    expect(diagnostics.map((entry) => entry.actorCategory)).toEqual([
      'coding-developer-bot',
      'automatic-system-restart'
    ]);
  });

  it('preserves helper request IDs and assigned trigger chords in diagnostics', async () => {
    const action = {
      id: 'ae.test-command',
      label: 'Test Command',
      activeChord: 'F9',
      requiredContext: 'Timeline',
      deliveryRoute: 'host-command',
      commandId: 1234,
      commandIdSource: 'verified-host-probe',
      commandRequest: { commandActionId: 'ae-test-command' },
      canonicalRecord: { requirements: {} }
    };
    const { api, calls, diagnostics } = createRouter({ action });

    await api.executeAction(action.id, {
      kind: 'global-hotkey',
      helperRequestId: 'helper-request-42',
      triggerChord: 'Ctrl+Shift+J',
      triggerContext: {
        detectedContext: 'Timeline',
        aeForeground: true,
        targetPid: 42,
        foregroundHwnd: '0x10',
        focusedHwnd: '0x20',
        capturedAt: new Date().toISOString()
      }
    });

    expect(diagnostics[0]).toMatchObject({
      actionId: action.id,
      triggerSource: 'global-hotkey',
      actorCategory: 'human-user',
      requestId: expect.stringMatching(/^shortcut-/),
      shortcut: 'Ctrl+Shift+J',
      detectedContext: 'Timeline'
    });
    expect(calls.find((call) => call.context)).toMatchObject({
      context: {
        detectedContext: 'Timeline',
        aeForeground: true,
        targetPid: 42,
        foregroundHwnd: '0x10',
        focusedHwnd: '0x20'
      }
    });
  });

  it('keeps the generated request ID in diagnostics when host execution rejects', async () => {
    const action = {
      id: 'ae.test-command',
      label: 'Test Command',
      deliveryRoute: 'host-command',
      commandId: 1234,
      commandIdSource: 'verified-host-probe',
      commandRequest: { commandActionId: 'ae-test-command' },
      canonicalRecord: { requirements: {} }
    };
    const { api, diagnostics } = createRouter({
      action,
      hostResult(method) {
        if (method === 'aeShortcut.executeRequest') {
          return Promise.reject(new Error('ExtendScript rejected the command.'));
        }
        return null;
      }
    });

    const result = await api.executeAction(action.id, { kind: 'shortcut-pad' });

    expect(result).toMatchObject({ state: 'Failed', error: 'ExtendScript rejected the command.' });
    expect(result.requestId).toMatch(/^shortcut-/);
    expect(diagnostics[0].requestId).toBe(result.requestId);
  });

  it('rejects malformed action configuration instead of silently ignoring it', async () => {
    const action = {
      id: 'apply-configured',
      label: 'Configured Action',
      kind: 'apply',
      deliveryRoute: 'bridge-jsx',
      config: [{ arg: 'mode', type: 'select', options: [{ value: 'keys', label: 'Keys' }] }],
      invoke: { method: 'test.apply', args: { mode: 'keys' } }
    };
    const { api, calls } = createRouter({ action });

    const result = await api.executeAction(action.id, {
      kind: 'home-action',
      configuration: { mode: 'expressions' }
    });

    expect(result.state).toBe('Failed');
    expect(result.userMessage).toContain('setting is not supported');
    expect(calls.some((call) => call.method === 'test.apply')).toBe(false);
  });
});
