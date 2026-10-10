/*
 * Central action router for Home actions, keymap commands, and Shortcut Pads.
 */
;(function (R) {
  'use strict';

  var RUNNING = {};
  var PIN_RUNNING = {};
  var PIN_LAST_TRIGGER = {};
  var PIN_DUPLICATE_WINDOW_MS = 120;
  var PIN_TRACE_LIMIT = 200;
  var PIN_TRACES = [];
  var pinTraceQueue = [];
  var pinTraceScheduled = false;
  var requestSequence = 0;
  var ACTORS = ['human-user', 'coding-developer-bot', 'automatic-system-restart'];

  function copy(value) {
    var out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    Object.keys(value).forEach(function (key) { out[key] = value[key]; });
    return out;
  }

  function createRequestId() {
    requestSequence++;
    var suffix = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : requestSequence.toString(36) + '-' + Math.floor(Math.random() * 0x100000000)
        .toString(36);
    return 'shortcut-' + Date.now() + '-' + suffix;
  }

  function developmentTraceEnabled() {
    return !!(R.shortcutDiagnostics && R.shortcutDiagnostics.developmentEnabled &&
      R.shortcutDiagnostics.developmentEnabled());
  }

  function flushPinTrace() {
    pinTraceScheduled = false;
    if (!developmentTraceEnabled() || !window.console) {
      pinTraceQueue = [];
      return;
    }
    var batch = pinTraceQueue;
    pinTraceQueue = [];
    batch.forEach(function (entry) {
      if (entry.phase === 'Shortcut action unresolved after registry refresh') {
        if (typeof window.console.warn === 'function') {
          window.console.warn('Shortcut action unresolved after registry refresh', entry.details);
        }
        return;
      }
      var method = entry.level === 'warn' ? 'warn' : 'debug';
      if (typeof window.console[method] === 'function') {
        window.console[method]('[Rebound Shortcut Pin] ' + entry.phase, entry.details);
      }
    });
  }

  function tracePin(phase, pin, requestId, details, level) {
    pin = pin || {};
    details = details || {};
    var entry = {
      phase: phase,
      level: level || 'debug',
      details: {
        requestId: requestId || '',
        pinId: pin.pinId || pin.id || '',
        displayName: pin.displayName || pin.label || '',
        actionType: pin.actionType || pin.action && pin.action.type || '',
        commandId: pin.commandId == null ? pin.action && pin.action.commandId || null : pin.commandId,
        commandName: pin.commandName || pin.action && pin.action.commandName || '',
        menuPath: pin.menuPath || pin.action && pin.action.menuPath || '',
        pinStatus: pin.status || (pin.enabled ? 'ready' : 'unavailable'),
        registryVersion: pin.registryVersion || pin.action && pin.action.registryVersion || ''
      }
    };
    Object.keys(details).forEach(function (key) { entry.details[key] = details[key]; });
    PIN_TRACES.push(entry);
    if (PIN_TRACES.length > PIN_TRACE_LIMIT) PIN_TRACES.shift();
    if (!developmentTraceEnabled()) return;
    pinTraceQueue.push(entry);
    if (!pinTraceScheduled) {
      pinTraceScheduled = true;
      window.setTimeout(flushPinTrace, 0);
    }
  }

  function padById(id) {
    return R.shortcutPads && R.shortcutPads.byId ? R.shortcutPads.byId(id) : null;
  }

  function actionById(id) {
    var action = R.afterEffectsShortcuts && R.afterEffectsShortcuts.resolveAction
      ? R.afterEffectsShortcuts.resolveAction(id) : null;
    if (action) return action;
    return R.homeActions && R.homeActions.byId ? R.homeActions.byId(id) : null;
  }

  function actionForPad(pad) {
    if (!pad) return null;
    var stableId = 'pin:' + (pad.pinId || pad.id);
    var resolution = R.shortcutPads && R.shortcutPads.resolve
      ? R.shortcutPads.resolve(pad) : null;
    if (!pad.actionId || pad.enabled === false ||
        resolution && !resolution.enabled) {
      return {
        id: stableId,
        label: pad.displayName || pad.label,
        kind: 'unsupported',
        reason: 'Action unavailable. Edit this pin to repair it.'
      };
    }
    var action = resolution && resolution.action || actionById(pad.actionId);
    if (!action) return null;
    action = copy(action);
    action.label = pad.displayName || pad.label || action.label || 'Shortcut';
    action.pinId = pad.pinId || pad.id;
    action.padId = action.pinId;
    action.padActionId = stableId;
    return action;
  }

  function resolveAction(actionId) {
    if (typeof actionId !== 'string' || !actionId) return null;
    var padMatch = /^pad:(.+)$/.exec(actionId);
    if (padMatch) return actionForPad(padById(padMatch[1]));
    return actionById(actionId);
  }

  function sourceFor(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { error: 'An action source is required.' };
    }
    var kind = String(source.kind || source.type || '');
    if (!kind) return { error: 'The action source type is missing.' };
    var actor = source.actorCategory || source.actor;
    if (!actor) {
      actor = kind === 'developer-test' ? 'coding-developer-bot'
        : kind === 'helper-restart' ? 'automatic-system-restart' : 'human-user';
    }
    if (ACTORS.indexOf(actor) === -1) {
      return { error: 'The action actor category is invalid.' };
    }
    if (source.configuration != null &&
        (typeof source.configuration !== 'object' || Array.isArray(source.configuration))) {
      return { error: 'Action configuration must be an object.' };
    }
    return {
      kind: kind,
      actorCategory: actor,
      configuration: copy(source.configuration),
      padId: typeof source.padId === 'string' ? source.padId : '',
      pinId: typeof source.pinId === 'string' ? source.pinId
        : typeof source.padId === 'string' ? source.padId : '',
      parentActionId: typeof source.parentActionId === 'string' ? source.parentActionId : '',
      helperRequestId: typeof source.helperRequestId === 'string' ? source.helperRequestId : '',
      requestId: typeof source.requestId === 'string' ? source.requestId : '',
      triggerChord: typeof source.triggerChord === 'string' ? source.triggerChord : '',
      triggerContext: copy(source.triggerContext)
    };
  }

  function requirementsFor(action) {
    var canonical = action.canonicalRecord || {};
    return copy(action.requirements || canonical.requirements);
  }

  function requiredContextFor(action) {
    var canonical = action.canonicalRecord || {};
    return String(action.requiredContext || canonical.requiredContext || '');
  }

  function isPanelRoute(route) {
    return route === 'focused-chord' || route === 'sequence';
  }

  function panelName(requiredContext, requirements) {
    if (requirements.timeline) return 'Timeline';
    if (requirements.viewer) return 'Composition Viewer';
    if (/^(?:timeline|composition viewer|effect controls|project panel|render queue)$/i.test(requiredContext)) {
      var panels = {
        timeline: 'Timeline',
        'composition viewer': 'Composition Viewer',
        'effect controls': 'Effect Controls',
        'project panel': 'Project Panel',
        'render queue': 'Render Queue'
      };
      return panels[requiredContext.toLowerCase()];
    }
    return '';
  }

  function contextIssue(action, state, route) {
    var requirements = requirementsFor(action);
    var requiredContext = requiredContextFor(action);
    if ((requirements.composition || /^(?:composition|composition viewer)$/i.test(requiredContext)) &&
        state.hasComp !== true) {
      return {
        state: 'Needs Composition',
        userMessage: 'Open a composition in After Effects, then try again.'
      };
    }
    if ((requirements.mask || /mask selection/i.test(requiredContext)) &&
        !(Number(state.selectedMaskCount) > 0)) {
      return {
        state: 'Needs Selection',
        userMessage: 'Select a mask in the active composition, then try again.'
      };
    }
    if ((requirements.keyframes || /selected keyframes/i.test(requiredContext)) &&
        !(Number(state.totalSelectedKeys) > 0)) {
      return {
        state: 'Needs Selection',
        userMessage: 'Select one or more keyframes, then try again.'
      };
    }
    if ((requirements.layer || /selected layer/i.test(requiredContext)) &&
        !(Number(state.selectedLayerCount) > 0)) {
      return {
        state: 'Needs Selection',
        userMessage: 'Select one or more layers in a composition, then try again.'
      };
    }
    var panel = panelName(requiredContext, requirements);
    if (isPanelRoute(route) && panel) {
      if (state.aeForeground === false) {
        return {
          state: 'Failed',
          userMessage: 'Bring After Effects to the foreground, then try again.'
        };
      }
      if (String(state.detectedContext || '').toLowerCase() !== panel.toLowerCase()) {
        if (panel === 'Timeline') {
          return { state: 'Needs Timeline', userMessage: 'Focus the After Effects Timeline, then try again.' };
        }
        if (panel === 'Composition Viewer') {
          return {
            state: 'Needs Composition',
            userMessage: 'Focus the active composition viewer, then try again.'
          };
        }
        return {
          state: 'Failed',
          userMessage: 'Focus the ' + panel + ' panel in After Effects, then try again.'
        };
      }
    }
    if (isPanelRoute(route) && state.aeForeground === false) {
      return {
        state: 'Failed',
        userMessage: 'Bring After Effects to the foreground, then try again.'
      };
    }
    return null;
  }

  function triggerContextIsFresh(triggerContext, helper) {
    if (!triggerContext || typeof triggerContext.capturedAt !== 'string') return false;
    var capturedAt = Date.parse(triggerContext.capturedAt);
    var helperUpdatedAt = helper && helper.updated ? Date.parse(helper.updated) : NaN;
    return isFinite(capturedAt) && Date.now() - capturedAt < 4000 &&
      capturedAt <= Date.now() && (!isFinite(helperUpdatedAt) ||
        capturedAt >= helperUpdatedAt);
  }

  function readLiveContext(source) {
    if (!R.bridge || typeof R.bridge.invoke !== 'function') {
      return Promise.reject(new Error('The After Effects bridge is unavailable.'));
    }
    return Promise.resolve().then(function () {
      return R.bridge.invoke('system.selectionSummary', {});
    }).then(function (selection) {
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
        throw new Error('After Effects returned invalid selection context.');
      }
      var state = copy(selection);
      var helper = R.globalHotkeys && R.globalHotkeys.status
        ? R.globalHotkeys.status() : {};
      var triggerContext = source && source.triggerContext || {};
      var useTriggerContext = triggerContextIsFresh(triggerContext, helper);
      state.detectedContext = (useTriggerContext && triggerContext.detectedContext) ||
        helper.detectedContext || 'Unknown';
      state.aeForeground = useTriggerContext &&
        typeof triggerContext.aeForeground === 'boolean' ? triggerContext.aeForeground
        : typeof helper.aeForeground === 'boolean' ? helper.aeForeground : null;
      state.targetPid = (useTriggerContext && triggerContext.targetPid) || helper.targetPid || null;
      state.foregroundHwnd = (useTriggerContext && triggerContext.foregroundHwnd) ||
        helper.foregroundHwnd || '';
      state.focusedHwnd = (useTriggerContext && triggerContext.focusedHwnd) ||
        helper.focusedHwnd || '';
      if (R.afterEffectsShortcuts && R.afterEffectsShortcuts.updateContext) {
        R.afterEffectsShortcuts.updateContext(state);
      }
      return state;
    });
  }

  function validCommandId(action) {
    return !!(action && typeof action.commandId === 'number' &&
      isFinite(action.commandId) && action.commandId > 0 &&
      action.commandIdSource === 'verified-host-probe');
  }

  function routeAvailable(action, route) {
    var request = action && action.commandRequest || {};
    var bridgeReady = !!(R.bridge && typeof R.bridge.invoke === 'function');
    if (route === 'native-aegp' || route === 'sequence' || route === 'focused-chord') return false;
    if (route === 'host-command') {
      return !!(bridgeReady && validCommandId(action) &&
        request.commandActionId && request.preferredRoute === 'host-command');
    }
    if (route === 'bridge-jsx') {
      return !!(bridgeReady && action.aeMapShortcut !== true &&
        (request.commandActionId ||
        action.commandActionId || action.invoke && action.invoke.method));
    }
    if (route === 'custom-workflow') {
      return !!(Array.isArray(action.workflowSteps) && action.workflowSteps.length > 0);
    }
    if (route === 'open-tool') {
      return !!(action.kind === 'open' || action.kind === 'widget');
    }
    return false;
  }

  function selectRoute(action) {
    if (!action) return 'unsupported';
    if (action.kind === 'open' || action.kind === 'widget') return 'open-tool';
    if (action.kind === 'custom-workflow') {
      return routeAvailable(action, 'custom-workflow') ? 'custom-workflow' : 'unsupported';
    }
    if (action.kind === 'custom-chord') return 'unsupported';
    if (action.kind === 'unsupported') return 'unsupported';
    var order = ['host-command', 'bridge-jsx'];
    for (var i = 0; i < order.length; i++) {
      if (routeAvailable(action, order[i])) return order[i];
    }
    return 'unsupported';
  }

  function configurationFor(action, configuration) {
    var config = action.config || [];
    var base = action.invoke && action.invoke.args || action.args || {};
    var result = copy(base);
    var supplied = copy(configuration);
    var allowed = {};
    config.forEach(function (field) {
      if (field && typeof field.arg === 'string') allowed[field.arg] = field;
    });
    Object.keys(supplied).forEach(function (key) {
      var field = allowed[key];
      if (!field) throw new Error('This action does not accept the "' + key + '" setting.');
      var value = supplied[key];
      if (field.type === 'select') {
        var options = field.options || [];
        var valid = options.some(function (option) {
          return option && option.value === value;
        });
        if (!valid) throw new Error('The "' + key + '" setting is not supported.');
      } else if (field.type === 'text') {
        if (typeof value !== 'string' || value.length > 4000) {
          throw new Error('The "' + key + '" setting is invalid.');
        }
      } else {
        throw new Error('The "' + key + '" setting is not supported.');
      }
      result[key] = value;
    });
    return result;
  }

  function freshRequest(action, route, state, requestId) {
    var request = copy(action.commandRequest);
    request.requestId = requestId || createRequestId();
    request.contextSnapshot = {
      detectedContext: state.detectedContext || 'Unknown',
      aeForeground: typeof state.aeForeground === 'boolean' ? state.aeForeground : null,
      capturedAt: Date.now()
    };
    request.preferredRoute = route;
    return request;
  }

  // Last check before the AE bridge. Only a real, numeric, verified AE command
  // with a non-empty request ID may cross it. Pin IDs, sample IDs, slot
  // numbers, labels, menu paths, and key strings are all refused here.
  function assertHostCommandRequest(request) {
    if (!request || typeof request.requestId !== 'string' || !request.requestId) {
      throw new Error('The shortcut request has no request ID.');
    }
    if (typeof request.commandId !== 'number' || !isFinite(request.commandId) ||
        request.commandId <= 0 || Math.floor(request.commandId) !== request.commandId) {
      throw new Error('The shortcut has no verified After Effects command ID.');
    }
    if (request.commandIdSource !== 'verified-host-probe') {
      throw new Error('The After Effects command ID was not verified.');
    }
    if (typeof request.commandActionId !== 'string' ||
        !/^ae-[a-z0-9-]+$/.test(request.commandActionId)) {
      throw new Error('The shortcut does not name a registered After Effects command.');
    }
    if (request.preferredRoute !== 'host-command') {
      throw new Error('The shortcut request used an unsupported route.');
    }
    return true;
  }

  function executeRoute(action, route, source, state) {
    if (route === 'open-tool') {
      if (source.pinId) tracePin('Action dispatched', action, source.requestId, { route: route });
      if (action.presetState && R.shell && R.shell.openToolWithPreset) {
        R.shell.openToolWithPreset(action.toolId, action.presetState);
      } else if (R.shell && R.shell.openTool) {
        R.shell.openTool(action.toolId);
      } else {
        throw new Error('The Rebound tool launcher is unavailable.');
      }
      return Promise.resolve({ ok: true, opened: action.toolId });
    }
    if (route === 'custom-workflow') return executeWorkflow(action, source);
    if (route === 'host-command' ||
        route === 'bridge-jsx' && action.commandRequest) {
      var hostRequest = freshRequest(action, route, state, source.requestId);
      if (route === 'host-command') assertHostCommandRequest(hostRequest);
      if (source.pinId) tracePin('Action dispatched', action, source.requestId, {
        route: route,
        executionRoute: route
      });
      return R.bridge.invoke('aeShortcut.executeRequest', {
        request: hostRequest
      });
    }
    if (route === 'bridge-jsx') {
      var config = configurationFor(action, source.configuration);
      var invocation = action.build
        ? action.build(config)
        : { method: action.invoke.method, args: config };
      if (!invocation || typeof invocation.method !== 'string' || !invocation.method) {
        throw new Error('This action has no registered JSX command.');
      }
      var invocationArgs = invocation.args || {};
      if (source.pinId) tracePin('Action dispatched', action, source.requestId, {
        route: route,
        method: invocation.method
      });
      if (invocation.method === 'aeShortcut.execute' &&
          invocationArgs && typeof invocationArgs === 'object' &&
          !Array.isArray(invocationArgs)) {
        invocationArgs = copy(invocationArgs);
        invocationArgs.requestId = source.requestId || createRequestId();
      }
      return R.bridge.invoke(invocation.method, invocationArgs);
    }
    throw new Error('No safe execution route is available for this action.');
  }

  function resultFor(actionId, source, state, route, values) {
    var result = {
      ok: false,
      actionId: actionId,
      source: source.kind,
      actorCategory: source.actorCategory,
      state: state,
      route: route || 'unsupported',
      routeAvailable: route !== 'unsupported',
      userMessage: '',
      delivered: false,
      executed: false,
      verified: false,
      contextVerified: false,
      requestId: source.requestId || source.helperRequestId || '',
      result: null,
      error: ''
    };
    if (values) Object.keys(values).forEach(function (key) { result[key] = values[key]; });
    return result;
  }

  function logResult(action, outcome, state, error, startedAt, liveContext, source, route) {
    if (source && source.pinId) return;
    if (!R.shortcutDiagnostics || !R.shortcutDiagnostics.record) return;
    var canonical = action.canonicalRecord || {};
    var telemetry = outcome || error || {};
    var request = action.commandRequest || {};
    source = source || {};
    try {
      R.shortcutDiagnostics.record({
        actionId: action.id,
        label: action.label,
        shortcut: source.triggerChord || action.activeChord || action.displayChord ||
          canonical.displayChord || '',
        bindingAlternatives: canonical.bindingAlternatives || [],
        workflowCategory: action.workflowCategory || canonical.workflowCategory || '',
        aeContext: action.context || action.aeContext || canonical.aeContext || '',
        requiredState: action.requiredState || canonical.requiredState || '',
        requiredContext: requiredContextFor(action),
        detectedContext: telemetry.detectedContext ||
          liveContext && liveContext.detectedContext || '',
        route: outcome && outcome.route || '',
        executionRoute: outcome && outcome.executionRoute || outcome && outcome.route || '',
        routeAvailable: route !== 'unsupported',
        requestId: telemetry.requestId || source.requestId ||
          source.helperRequestId || request.requestId || '',
        latencyMs: Math.max(0, Date.now() - startedAt),
        expectedResult: action.expectedResult || action.successCriteria || '',
        status: state,
        result: outcome && outcome.result || '',
        error: error && error.message || '',
        errorStack: error && error.stack || '',
        verified: telemetry.verified === true,
        delivered: telemetry.delivered === true,
        executed: telemetry.executed === true,
        contextVerified: telemetry.contextVerified === true,
        targetPid: telemetry.targetPid || liveContext && liveContext.targetPid,
        targetHwnd: telemetry.targetHwnd || '',
        foregroundHwndBefore: telemetry.foregroundHwndBefore ||
          liveContext && liveContext.foregroundHwnd,
        focusedHwndBefore: telemetry.focusedHwndBefore ||
          liveContext && liveContext.focusedHwnd,
        focusStatus: telemetry.focusStatus || '',
        commandId: telemetry.commandId || action.commandId,
        commandIdSource: telemetry.commandIdSource || action.commandIdSource,
        triggerSource: outcome && outcome.source,
        actorCategory: outcome && outcome.actorCategory
      });
    } catch (diagnosticError) {
      if (R.log) R.log.error('Action router could not record shortcut diagnostics.', diagnosticError);
    }
  }

  function executeWorkflow(action, source) {
    if (action.configurationError) throw new Error(action.configurationError);
    if (typeof window.confirm !== 'function' ||
        !window.confirm('Run the "' + (action.label || 'Custom workflow') +
          '" workflow now? Each action will be checked before it runs.')) {
      var cancelled = new Error('The workflow was cancelled.');
      cancelled.cancelled = true;
      throw cancelled;
    }
    var results = [];
    var current = Promise.resolve();
    action.workflowSteps.forEach(function (step) {
      current = current.then(function () {
        var childSource = {
          kind: 'workflow-step',
          actorCategory: source.actorCategory,
          configuration: step.configuration || {},
          parentActionId: action.id
        };
        return executeAction(step.actionId, childSource).then(function (stepResult) {
          results.push(stepResult);
          if (!stepResult.ok || !stepResult.verified) {
            var stepError = new Error(stepResult.userMessage ||
              'A workflow action did not confirm its result.');
            stepError.actionResult = stepResult;
            throw stepError;
          }
        });
      });
    });
    return current.then(function () {
      return {
        ok: true,
        executed: true,
        verified: true,
        contextVerified: true,
        steps: results,
        result: 'All workflow actions completed and were verified.'
      };
    });
  }

  function triggerAction(actionId) {
    var action = actionById(actionId);
    var label = action && action.label || 'Shortcut';
    if (!action) {
      var missing = new Error('The assigned action is no longer available.');
      if (R.ui && R.ui.toast) R.ui.toast(label + ' failed: ' + missing.message, { kind: 'error' });
      return Promise.reject(missing);
    }
    var operation;
    try {
      if (action.kind === 'open' || action.kind === 'widget') {
        if (!R.shell || !R.shell.openTool) throw new Error('The selected Rebound tool is unavailable.');
        var toolId = action.toolId || String(action.id).replace(/^(?:open|widget)-/, '');
        operation = R.shell.openTool(toolId);
        if (operation === undefined) operation = { ok: true, opened: toolId };
      } else if (action.aeMapShortcut) {
        operation = executeAction(action.id, {
          kind: 'ae-catalog',
          actorCategory: 'human-user'
        });
      } else if (action.invoke && action.invoke.method &&
          R.bridge && R.bridge.invoke) {
        operation = R.bridge.invoke(action.invoke.method, copy(action.invoke.args));
      } else {
        throw new Error('The selected action cannot be run.');
      }
    } catch (error) {
      operation = Promise.reject(error);
    }
    return Promise.resolve(operation).then(function (result) {
      if (result === false || result == null || result.ok === false || result.error) {
        throw new Error(result && (result.error || result.result) ||
          'After Effects did not confirm the action.');
      }
      var verified = result.verified === true && result.executed === true &&
        result.contextVerified === true;
      if (!verified) {
        var unverifiedMessage = result.userMessage || result.error ||
          (typeof result.result === 'string' ? result.result : '');
        throw new Error(unverifiedMessage ||
          'The action result was not confirmed by After Effects.');
      }
      if (verified && R.ui && R.ui.toast) {
        R.ui.toast(label + ' completed.', { kind: 'success' });
      }
      return {
        ok: true,
        actionId: actionId,
        label: label,
        state: verified ? 'Done' : 'Ready',
        verified: verified,
        result: result
      };
    }).catch(function (error) {
      var message = error && error.message || 'The shortcut action failed.';
      if (R.ui && R.ui.toast) {
        R.ui.toast(label + ' failed: ' + message, { kind: 'error' });
      }
      throw error;
    });
  }

  function executeAction(actionId, inputSource, resolvedAction) {
    var source = sourceFor(inputSource);
    if (source.error) {
      return Promise.resolve(resultFor(String(actionId || ''), {
        kind: 'invalid-source', actorCategory: 'human-user'
      }, 'Failed', 'unsupported', {
        userMessage: source.error,
        error: source.error
      }));
    }
    if (!source.requestId) source.requestId = createRequestId();
    if (typeof actionId !== 'string' || !actionId) {
      return Promise.resolve(resultFor('', source, 'Failed', 'unsupported', {
        userMessage: 'Choose an action before running it.',
        error: 'An action ID is required.'
      }));
    }
    var runningKey = source.pinId ? 'pin:' + source.pinId : actionId;
    if (RUNNING[runningKey]) {
      return Promise.resolve(resultFor(actionId, source, 'Running', 'unsupported', {
        userMessage: 'This action is already running.'
      }));
    }

    var action = resolvedAction || resolveAction(actionId);
    if (!action) {
      return Promise.resolve(resultFor(actionId, source, 'Unsupported', 'unsupported', {
        userMessage: 'Mapping unavailable — assign an action or check AE keymap.',
        error: 'The action ID is not registered.'
      }));
    }
    if (action.kind === 'unsupported') {
      return Promise.resolve(resultFor(actionId, source, 'Unsupported', 'unsupported', {
        userMessage: action.reason || 'This action is not supported.',
        error: action.reason || 'No safe execution route is registered.'
      }));
    }

    var route = selectRoute(action);
    if (route === 'unsupported') {
      return Promise.resolve(resultFor(actionId, source, 'Unsupported', route, {
        userMessage: 'This action has no safe execution route.',
        error: 'No route is registered for this action.'
      }));
    }

    var startedAt = Date.now();
    RUNNING[runningKey] = true;
    var contextPromise = route === 'open-tool'
      ? Promise.resolve({})
      : readLiveContext(source);
    return contextPromise.then(function (liveContext) {
      var issue = contextIssue(action, liveContext, route);
      if (issue) {
        var blocked = resultFor(actionId, source, issue.state, route, {
          userMessage: issue.userMessage,
          requiredContext: requiredContextFor(action),
          detectedContext: liveContext.detectedContext || 'Unknown'
        });
        logResult(action, {
          route: route,
          source: source.kind,
          actorCategory: source.actorCategory,
          detectedContext: liveContext.detectedContext
        }, blocked.state, null, startedAt, liveContext, source, route);
        return blocked;
      }
      return Promise.resolve().then(function () {
        return executeRoute(action, route, source, liveContext);
      }).then(function (execution) {
        var verified = !!(execution && execution.ok !== false &&
          execution.verified === true && execution.executed === true &&
          execution.contextVerified === true);
        var delivered = !!(execution && execution.delivered === true);
        var executed = !!(execution && execution.executed === true);
        var opened = route === 'open-tool' && !!(execution && execution.opened);
        // A pin is a real AE command. When the host accepted and executed it
        // without throwing, that is a dispatched success; a missing
        // postcondition is not a failure. Only host errors are failures.
        var dispatched = !!(source.pinId && route === 'host-command' && executed &&
          execution.ok !== false && execution.contextVerified === true);
        var ok = verified || opened || dispatched;
        var state = ok ? 'Done' : (execution && execution.ok === false
          ? 'Failed' : 'Ready');
        var message = opened ? action.label + ' opened.'
          : verified ? execution.result || action.label + ' completed.'
            : dispatched ? action.label + ' sent to After Effects.'
            : execution && execution.error
              ? String(execution.error)
              : !verified
                ? execution && (execution.userMessage ||
                  (typeof execution.result === 'string' ? execution.result : '')) ||
                  'The action result was not confirmed by After Effects.'
                : state === 'Failed' ? 'After Effects could not run this action.' : '';
        var output = resultFor(actionId, source, state, route, {
          ok: ok,
          userMessage: message,
          delivered: delivered,
          executed: executed || opened,
          verified: verified || opened,
          dispatched: dispatched,
          contextVerified: execution && execution.contextVerified === true,
          requestId: execution && execution.requestId || source.requestId ||
            action.commandRequest && action.commandRequest.requestId || '',
          pinId: source.pinId || '',
          result: execution || null,
          requiredContext: requiredContextFor(action),
          detectedContext: liveContext.detectedContext || 'Unknown'
        });
        logResult(action, {
          source: source.kind,
          actorCategory: source.actorCategory,
          route: route,
          routeAvailable: true,
          delivered: delivered,
          executed: executed,
          verified: verified,
          contextVerified: execution && execution.contextVerified === true,
          requestId: output.requestId,
          result: execution && execution.result,
          targetPid: execution && execution.targetPid,
          targetHwnd: execution && execution.targetHwnd,
          foregroundHwndBefore: execution && execution.foregroundHwndBefore,
          focusedHwndBefore: execution && execution.focusedHwndBefore,
          focusStatus: execution && execution.focusStatus,
          commandId: execution && execution.commandId,
          commandIdSource: execution && execution.commandIdSource,
          detectedContext: liveContext.detectedContext
        }, state, null, startedAt, liveContext, source, route);
        if (verified && !source.pinId && R.afterEffectsShortcuts &&
            R.afterEffectsShortcuts.markExecutionVerified) {
          R.afterEffectsShortcuts.markExecutionVerified(action.id, execution);
        }
        if (verified && !source.pinId && R.homeActions &&
            R.homeActions.markActionVerified && action.invoke) {
          R.homeActions.markActionVerified(action.id, execution,
            action.invoke.method, action.invoke.args || {});
        }
        return output;
      });
    }).catch(function (error) {
      var message = error && error.message || 'The action could not be run.';
      var actionResult = error && error.actionResult;
      var state = error && error.cancelled ? 'Ready' : 'Failed';
      var output = resultFor(actionId, source, state, route, {
        userMessage: error && error.cancelled ? 'Workflow cancelled.' :
          actionResult && actionResult.userMessage || message,
        error: message,
        requestId: source.requestId,
        pinId: source.pinId || '',
        result: actionResult || null,
        requiredContext: requiredContextFor(action)
      });
      logResult(action, {
        source: source.kind,
        actorCategory: source.actorCategory,
        route: route,
        detectedContext: error && error.detectedContext
      }, state, error, startedAt, null, source, route);
      if (R.log) R.log.error('Action router failed for ' + actionId + '.', error);
      return output;
    }).then(function (result) {
      delete RUNNING[runningKey];
      return result;
    }, function (error) {
      delete RUNNING[runningKey];
      throw error;
    });
  }

  function staleKeymapResult(result) {
    var detail = result && (result.error || result.userMessage || '');
    if (result && result.result && typeof result.result === 'object') {
      detail += ' ' + (result.result.error || '');
    }
    return /no longer matches the active AE keymap|stale.{0,24}keymap/i.test(detail);
  }

  function refreshForActivation(actionId) {
    var shortcuts = R.afterEffectsShortcuts;
    if (!shortcuts || typeof shortcuts.refreshActiveKeymap !== 'function') {
      return Promise.resolve();
    }
    if (typeof shortcuts.keymapLoaded === 'function' && shortcuts.keymapLoaded()) {
      return Promise.resolve();
    }
    return Promise.resolve().then(function () {
      return shortcuts.refreshActiveKeymap(false);
    });
  }

  function executeFreshAction(actionId, inputSource) {
    var source = sourceFor(inputSource);
    if (source.error) return executeAction(actionId, inputSource);
    // Pad (pin) actions never reach this path; they use executePin.
    if (/^pad:/.test(String(actionId || ''))) {
      return Promise.resolve(resultFor(String(actionId || ''), source, 'Unsupported',
        'unsupported', {
          userMessage: 'Edit this pin to repair it.',
          error: 'Pinned actions must run through executePin.'
        }));
    }
    return refreshForActivation(actionId).then(function () {
      return executeAction(actionId, source);
    }).catch(function (error) {
      if (R.log) R.log.warn('Could not load the active shortcut mapping.', error);
      return resultFor(actionId, source, 'Unsupported', 'unsupported', {
        userMessage: 'Mapping unavailable — assign an action or check AE keymap.',
        error: error && error.message || 'The active shortcut mapping could not be refreshed.'
      });
    });
  }

  function pinActionForExecution(pin, resolution) {
    if (!pin || !resolution || resolution.enabled !== true || !resolution.action) return null;
    var pinId = pin.pinId || pin.id;
    var actionId = pin.action && pin.action.actionId || pin.actionId;
    if (!actionId || /^(?:pad:)?sample-/i.test(actionId) ||
        actionId === pinId || actionId === 'pad:' + pinId) return null;
    var action = copy(resolution.action);
    var resolvedActionId = action.actionId || action.id;
    if (resolvedActionId && resolvedActionId !== actionId) return null;
    var type = pin.actionType || pin.action && pin.action.type;
    var request = action.commandRequest || {};
    if (type !== 'ae-command' || action.aeMapShortcut !== true ||
        !validCommandId(action) || !request.commandActionId ||
        request.commandActionId !== (pin.action && pin.action.commandActionId) ||
        request.commandId !== action.commandId ||
        request.commandIdSource !== 'verified-host-probe' ||
        request.preferredRoute !== 'host-command' ||
        Number(pin.commandId) !== action.commandId ||
        String(pin.commandName || '') !== String(action.commandName || action.label || '') ||
        String(pin.menuPath || '') !== String(action.menuPath || '')) return null;
    action.id = actionId;
    action.actionId = actionId;
    action.label = pin.displayName || pin.label || pin.commandName || 'Shortcut';
    action.pinId = pinId;
    action.padId = pinId;
    action.pinActionType = type;
    action.pinCommandId = pin.commandId;
    action.pinCommandName = pin.commandName ||
      pin.action && pin.action.commandName || action.label;
    action.pinMenuPath = pin.menuPath || pin.action && pin.action.menuPath || '';
    action.deliveryRoute = 'host-command';
    action.executionRoute = 'host-command';
    action.route = 'host-command';
    return action;
  }

  function registryReady() {
    var shortcuts = R.afterEffectsShortcuts;
    if (!shortcuts) return false;
    return typeof shortcuts.keymapLoaded !== 'function' || shortcuts.keymapLoaded() === true;
  }

  // After the host reports a stale keymap, the command has NOT run (the host
  // rejects the request before executeCommand). We refresh the registry once in
  // the background and let the user click again. Nothing is re-dispatched.
  function requestRegistryRefresh(requestId) {
    var shortcuts = R.afterEffectsShortcuts;
    if (!shortcuts || typeof shortcuts.refreshActiveKeymap !== 'function') return;
    Promise.resolve().then(function () {
      tracePin('Refreshing stale pin mapping', null, requestId, { refreshAttempted: true });
      return shortcuts.refreshActiveKeymap(true);
    }).catch(function (error) {
      if (R.log) R.log.warn('Could not refresh the After Effects shortcut registry.', error);
    });
  }

  function unavailablePinResult(pinId, pin, source, requestId, reason) {
    var displayName = pin && (pin.displayName || pin.label) || 'Shortcut';
    var message = 'Couldn’t run “' + displayName + '”. Its After Effects command needs repair.';
    var result = resultFor('', source, 'Unsupported', 'unsupported', {
      ok: false,
      pinId: pinId,
      requestId: requestId,
      userMessage: message,
      error: reason || 'The saved pin action could not be resolved.',
      pinStatus: 'unavailable'
    });
    tracePin('Action unavailable', pin, requestId, {
      error: reason || result.error,
      pinStatus: 'unavailable'
    }, 'warn');
    return Promise.resolve(result);
  }

  function loadingPinResult(pinId, source, requestId) {
    return Promise.resolve(resultFor('', source, 'Loading', 'unsupported', {
      pinId: pinId,
      requestId: requestId,
      userMessage: 'After Effects shortcuts are still loading. Try again in a moment.',
      error: 'The After Effects command registry has not loaded yet.'
    }));
  }

  function executeResolvedPin(pin, action, source, requestId) {
    var actionId = action.actionId || action.id;
    var pinId = pin.pinId || pin.id;
    return executeAction(actionId, source, action).then(function (result) {
      if (staleKeymapResult(result)) {
        requestRegistryRefresh(requestId);
        result.state = 'Failed';
        result.ok = false;
        result.userMessage = 'After Effects had a newer shortcut map, so nothing ran. ' +
          'The map was refreshed; click the shortcut again.';
      }
      var durationMs = Math.max(0, Date.now() - source.startedAt);
      result.pinId = pinId;
      result.requestId = requestId;
      result.durationMs = durationMs;
      if (result.state === 'Ready' && !result.verified && !result.userMessage) {
        result.userMessage = 'After Effects did not confirm “' +
          (pin.displayName || pin.label || 'Shortcut') + '”. Check its target and context.';
      }
      if (result.state === 'Failed' || result.state === 'Unsupported' || result.error) {
        result.pinStatus = 'unavailable';
      }
      tracePin('AE result received', pin, requestId, {
        state: result.state,
        ok: result.ok,
        verified: result.verified,
        durationMs: durationMs,
        result: result.result && result.result.result || result.userMessage || '',
        error: result.error || ''
      }, durationMs > 250 || result.state === 'Failed' ? 'warn' : 'debug');
      if (durationMs > 250) {
        tracePin('Shortcut execution exceeded 250 ms', pin, requestId, {
          durationMs: durationMs,
          state: result.state
        }, 'warn');
      }
      return result;
    }).catch(function (error) {
      var durationMs = Math.max(0, Date.now() - source.startedAt);
      var message = error && error.message || 'The action could not be run.';
      var result = resultFor(actionId, source, 'Failed', selectRoute(action), {
        pinId: pinId,
        requestId: requestId,
        durationMs: durationMs,
        userMessage: 'Couldn’t run “' + (pin.displayName || pin.label || 'Shortcut') + '”.',
        error: message
      });
      tracePin('AE execution failed', pin, requestId, {
        durationMs: durationMs,
        error: message
      }, 'warn');
      return result;
    });
  }

  // Development-only structured record of one pin activation.
  function logPinExecution(source, result) {
    var completedAt = Date.now();
    var pin = padById(source.pinId);
    var execution = result && result.result || {};
    tracePin('Shortcut execution completed', pin, source.requestId, {
      requestId: source.requestId,
      pinId: source.pinId,
      commandId: execution.commandId || (pin && pin.commandId) || null,
      commandName: execution.commandName || (pin && pin.commandName) || '',
      startedAt: new Date(source.startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: Math.max(0, completedAt - source.startedAt),
      ok: !!(result && result.ok),
      error: result && result.error || ''
    }, result && result.ok ? 'debug' : 'warn');
  }

  // Canonical Shortcut Pad execution. One activation = one request ID = at most
  // one bridge dispatch. Never retries, never writes settings, never searches.
  function executePin(pinId, inputSource) {
    var requestId = createRequestId();
    var source = sourceFor(inputSource || {
      kind: 'shortcut-pad',
      actorCategory: 'human-user'
    });
    if (source.error) {
      return Promise.resolve(resultFor('', {
        kind: 'invalid-source',
        actorCategory: 'human-user',
        requestId: requestId
      }, 'Failed', 'unsupported', {
        requestId: requestId,
        pinId: String(pinId || ''),
        userMessage: source.error,
        error: source.error
      }));
    }
    source.pinId = String(pinId || '');
    source.padId = source.pinId;
    source.requestId = requestId;
    source.startedAt = Date.now();
    tracePin('Click received', null, requestId, { pinId: source.pinId });
    if (!source.pinId) {
      return Promise.resolve(resultFor('', source, 'Failed', 'unsupported', {
        requestId: requestId,
        userMessage: 'Shortcut not found.',
        error: 'A pin ID is required.'
      }));
    }
    var now = Date.now();
    if (PIN_RUNNING[source.pinId] ||
        PIN_LAST_TRIGGER[source.pinId] &&
        now - PIN_LAST_TRIGGER[source.pinId] < PIN_DUPLICATE_WINDOW_MS) {
      tracePin('Duplicate activation ignored', padById(source.pinId), requestId, {
        duplicateWindowMs: PIN_DUPLICATE_WINDOW_MS
      });
      return Promise.resolve(resultFor('', source, 'Running', 'unsupported', {
        pinId: source.pinId,
        requestId: requestId,
        userMessage: ''
      }));
    }
    PIN_RUNNING[source.pinId] = true;
    PIN_LAST_TRIGGER[source.pinId] = now;

    function finish(result) {
      delete PIN_RUNNING[source.pinId];
      logPinExecution(source, result);
      return result;
    }

    function resolveAndRun() {
      var pin = padById(source.pinId);
      if (!pin) {
        tracePin('Pin not found', null, requestId, {
          pinId: source.pinId,
          durationMs: Math.max(0, Date.now() - source.startedAt)
        }, 'warn');
        return Promise.resolve(resultFor('', source, 'Unsupported', 'unsupported', {
          pinId: source.pinId,
          requestId: requestId,
          userMessage: 'Shortcut not found.',
          error: 'The saved pin no longer exists.'
        }));
      }
      tracePin('Pin resolved', pin, requestId, {
        commandId: pin.commandId,
        commandName: pin.commandName || '',
        registryVersion: pin.registryVersion || ''
      });
      // Resolution depends on the loaded registry. Before it loads, a pin is
      // "loading", never "broken", and nothing is marked or refreshed.
      if (pin.enabled !== true && !registryReady()) {
        return loadingPinResult(source.pinId, source, requestId);
      }
      if (pin.enabled !== true || pin.status === 'unavailable') {
        return unavailablePinResult(source.pinId, pin, source, requestId,
          pin.unavailableReason || 'Edit this pin to repair its action.');
      }
      var resolution = R.shortcutPads && R.shortcutPads.resolve
        ? R.shortcutPads.resolve(pin) : null;
      var action = pinActionForExecution(pin, resolution);
      if (!action) {
        return unavailablePinResult(source.pinId, pin, source, requestId,
          resolution && resolution.unavailableReason || 'Edit this pin to repair its action.');
      }
      return executeResolvedPin(pin, action, source, requestId);
    }

    return Promise.resolve().then(function () {
      if (R.globalHotkeys && R.globalHotkeys.isCaptureActive &&
          R.globalHotkeys.isCaptureActive()) {
        return resultFor('', source, 'Failed', 'unsupported', {
          pinId: source.pinId,
          requestId: requestId,
          userMessage: 'Shortcut actions are locked while recording a shortcut.',
          error: 'Shortcut capture is active.'
        });
      }
      return resolveAndRun();
    }).then(finish, function (error) {
      var pin = padById(source.pinId);
      var durationMs = Math.max(0, Date.now() - source.startedAt);
      var message = error && error.message || 'The action could not be run.';
      tracePin('AE execution failed', pin, requestId, {
        durationMs: durationMs,
        error: message
      }, 'warn');
      return finish(resultFor(pin && pin.actionId || '', source, 'Failed', 'unsupported', {
        pinId: source.pinId,
        requestId: requestId,
        durationMs: durationMs,
        userMessage: 'Couldn’t run “' + (pin && (pin.displayName || pin.label) || 'Shortcut') + '”.',
        error: message
      }));
    });
  }

  // Developer-only live probe of the After Effects command resolver. Refuses to
  // run unless developer diagnostics are on. Call from the panel devtools console:
  //   Rebound.shortcutDevProbe.resolve()
  //   Rebound.shortcutDevProbe.dispatch('ae-undo')
  // Only allowlisted command action IDs reach the host. No pad IDs, labels,
  // chords, or raw command numbers.
  function requireDevProbe() {
    if (!developmentTraceEnabled()) {
      throw new Error('The shortcut command probe requires developer diagnostics.');
    }
    if (!R.bridge || typeof R.bridge.invoke !== 'function') {
      throw new Error('The After Effects bridge is not available.');
    }
  }

  R.shortcutDevProbe = {
    resolve: function () {
      requireDevProbe();
      return R.bridge.invoke('aeShortcut.devProbe', { mode: 'resolve', devMode: true });
    },
    dispatch: function (commandActionId) {
      requireDevProbe();
      if (typeof commandActionId !== 'string' || !commandActionId ||
          /^(?:pad:|sample-)/.test(commandActionId)) {
        return Promise.reject(new Error('Not a probe-eligible After Effects command ID.'));
      }
      var requestId = createRequestId();
      var started = Date.now();
      return R.bridge.invoke('aeShortcut.devProbe', {
        mode: 'dispatch', devMode: true, commandActionId: commandActionId, requestId: requestId
      }).then(function (result) {
        var record = {
          requestId: requestId,
          commandActionId: commandActionId,
          ok: !!(result && result.ok),
          commandId: result && result.commandId,
          commandIdSource: result && result.commandIdSource,
          verified: result && result.verified,
          error: result && result.error || '',
          elapsedMs: Date.now() - started,
          aeVersion: result && result.aeVersion
        };
        if (window.console && window.console.info) window.console.info('[Rebound probe]', record);
        return record;
      });
    }
  };

  R.actionRouter = {
    triggerAction: triggerAction,
    executeAction: executeAction,
    executeFreshAction: executeFreshAction,
    executePin: executePin,
    pinDebug: function () { return PIN_TRACES.slice(); },
    createRequestId: createRequestId,
    resolveAction: resolveAction,
    selectRoute: selectRoute,
    readLiveContext: readLiveContext,
    routeAvailable: routeAvailable
  };
})(window.Rebound = window.Rebound || {});
