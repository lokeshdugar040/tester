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
      if (source.pinId) tracePin('Action dispatched', action, source.requestId, {
        route: route,
        executionRoute: route
      });
      return R.bridge.invoke('aeShortcut.executeRequest', {
        request: freshRequest(action, route, state, source.requestId)
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
        var ok = verified || opened;
        var state = ok ? 'Done' : (execution && execution.ok === false
          ? 'Failed' : 'Ready');
        var message = opened ? action.label + ' opened.'
          : verified ? execution.result || action.label + ' completed.'
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

  function mappingUnavailable(actionId, source, previous) {
    var result = copy(previous);
    result.actionId = actionId;
    result.ok = false;
    result.state = 'Unsupported';
    result.route = result.route || 'unsupported';
    result.routeAvailable = false;
    result.delivered = false;
    result.executed = false;
    result.verified = false;
    result.contextVerified = false;
    result.userMessage = 'Mapping unavailable — assign an action or check AE keymap.';
    result.error = 'The active shortcut mapping could not be refreshed.';
    if (!result.source) result.source = source.kind;
    return result;
  }

  function refreshForActivation(actionId, forceHostRefresh) {
    var needsRefresh = /^pad:/.test(actionId) || /^ae\.map\./.test(actionId);
    var action = resolveAction(actionId);
    needsRefresh = needsRefresh || !!(action &&
      (action.aeMapShortcut || action.registeredFallback));
    var shortcuts = R.afterEffectsShortcuts;
    if (!needsRefresh || !shortcuts || !shortcuts.refreshActiveKeymap) {
      return Promise.resolve();
    }
    return Promise.resolve().then(function () {
      return shortcuts.refreshActiveKeymap(forceHostRefresh === true);
    });
  }

  function executeFreshAction(actionId, inputSource) {
    var source = sourceFor(inputSource);
    if (source.error) return executeAction(actionId, inputSource);

    function run(attempt) {
      return refreshForActivation(actionId, attempt > 0).then(function () {
        return executeAction(actionId, source);
      }).then(function (result) {
        if (!staleKeymapResult(result)) return result;
        if (attempt < 1) {
          if (R.log) R.log.warn('Shortcut mapping changed during execution; refreshing once.', {
            actionId: actionId,
            requestId: result.requestId
          });
          return run(attempt + 1);
        }
        if (R.log) R.log.warn('Shortcut mapping remained stale after one refresh retry.', {
          actionId: actionId,
          requestId: result.requestId
        });
        return mappingUnavailable(actionId, source, result);
      }).catch(function (error) {
        var action = resolveAction(actionId);
        if (action && action.registeredFallback && !action.aeMapShortcut) {
          return executeAction(actionId, source);
        }
        if (R.log) R.log.warn('Could not refresh the active shortcut mapping.', error);
        return resultFor(actionId, source, 'Unsupported', 'unsupported', {
          userMessage: 'Mapping unavailable — assign an action or check AE keymap.',
          error: error && error.message || 'The active shortcut mapping could not be refreshed.'
        });
      });
    }

    return run(0);
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

  function unavailablePinResult(pinId, pin, source, requestId, reason) {
    var displayName = pin && (pin.displayName || pin.label) || 'Shortcut';
    var message = 'Couldn’t run "' + displayName + '". Action is unavailable.';
    var result = resultFor(pin && pin.actionId || '', source, 'Unsupported', 'unsupported', {
      ok: false,
      pinId: pinId,
      requestId: requestId,
      userMessage: message + (reason ? ' ' + reason : ''),
      error: reason || 'The saved pin action could not be resolved.',
      pinStatus: 'unavailable'
    });
    tracePin('Action unavailable', pin, requestId, {
      error: reason || result.error,
      pinStatus: 'unavailable'
    }, 'warn');
    return Promise.resolve(result);
  }

  function refreshPinRegistry(pinId, requestId) {
    var shortcuts = R.afterEffectsShortcuts;
    if (!shortcuts || typeof shortcuts.refreshActiveKeymap !== 'function') {
      return Promise.resolve(null);
    }
    return Promise.resolve().then(function () {
      tracePin('Refreshing stale pin mapping', padById(pinId), requestId, {
        refreshAttempted: true
      });
      return shortcuts.refreshActiveKeymap(true);
    }).then(function () {
      var pin = padById(pinId);
      if (!pin) return null;
      var resolution = R.shortcutPads && R.shortcutPads.resolve
        ? R.shortcutPads.resolve(pin) : null;
      var action = pinActionForExecution(pin, resolution);
      if (!action) {
        var registryEntries = shortcuts.catalogEntries ? shortcuts.catalogEntries() : [];
        var registryVersion = shortcuts.registryVersion
          ? shortcuts.registryVersion() : '';
        var reason = resolution && resolution.unavailableReason ||
          'The action did not resolve in the refreshed AE action registry.';
        if (R.shortcutPads && R.shortcutPads.markUnavailable) {
          R.shortcutPads.markUnavailable(pinId, reason);
        }
        tracePin('Shortcut action unresolved after registry refresh', pin, requestId, {
          storedActionId: pin.action && pin.action.actionId || pin.actionId || '',
          storedActionName: pin.action && pin.action.commandName || pin.commandName || '',
          menuPath: pin.action && pin.action.menuPath || pin.menuPath || '',
          pinStatus: 'unavailable',
          registryVersion: registryVersion || pin.registryVersion || '',
          registrySize: registryEntries.length,
          refreshAttempted: true,
          error: reason
        }, 'warn');
        return null;
      }
      tracePin('Pin resolved after registry refresh', pin, requestId, {
        commandId: pin.commandId,
        commandName: pin.commandName,
        registryVersion: shortcuts.registryVersion
          ? shortcuts.registryVersion() : ''
      });
      return { pin: pin, action: action };
    }).catch(function (error) {
      var pin = padById(pinId);
      tracePin('Shortcut action unresolved after registry refresh', pin, requestId, {
        storedActionId: pin && (pin.action && pin.action.actionId || pin.actionId) || '',
        storedActionName: pin && (pin.action && pin.action.commandName || pin.commandName) || '',
        menuPath: pin && (pin.action && pin.action.menuPath || pin.menuPath) || '',
        pinStatus: 'unavailable',
        registryVersion: shortcuts.registryVersion ? shortcuts.registryVersion() : '',
        registrySize: shortcuts.catalogEntries ? shortcuts.catalogEntries().length : 0,
        refreshAttempted: true,
        error: error && error.message || String(error)
      }, 'warn');
      return null;
    });
  }

  function executeResolvedPin(pin, action, source, requestId, refreshAttempted) {
    var actionId = action.actionId || action.id;
    return executeAction(actionId, source, action).then(function (result) {
      if (staleKeymapResult(result) && !refreshAttempted) {
        return refreshPinRegistry(pin.pinId || pin.id, requestId).then(function (refreshed) {
          if (!refreshed) {
            var reason = result.error || result.userMessage ||
              'The saved action no longer matches the active AE keymap.';
            if (R.shortcutPads && R.shortcutPads.markUnavailable) {
              R.shortcutPads.markUnavailable(pin.pinId || pin.id, reason);
            }
            return unavailablePinResult(pin.pinId || pin.id, pin, source, requestId, reason);
          }
          return executeResolvedPin(refreshed.pin, refreshed.action, source, requestId, true);
        });
      }
      var durationMs = Math.max(0, Date.now() - source.startedAt);
      result.pinId = pin.pinId || pin.id;
      result.requestId = requestId;
      result.durationMs = durationMs;
      if (result.state === 'Ready' && !result.verified && !result.userMessage) {
        result.userMessage = 'After Effects did not confirm "' +
          (pin.displayName || pin.label || 'Shortcut') + '". Check its target and context.';
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
        pinId: pin.pinId || pin.id,
        requestId: requestId,
        durationMs: durationMs,
        userMessage: 'Couldn’t run "' + (pin.displayName || pin.label || 'Shortcut') + '".',
        error: message
      });
      tracePin('AE execution failed', pin, requestId, {
        durationMs: durationMs,
        error: message
      }, 'warn');
      return result;
    });
  }

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
      return result;
    }

    function resolveAndRun(allowRefresh) {
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
        actionId: pin.action && pin.action.actionId || pin.actionId || '',
        commandId: pin.action && pin.action.commandId || pin.commandId,
        commandName: pin.action && pin.action.commandName || pin.commandName || '',
        registryVersion: pin.action && pin.action.registryVersion || pin.registryVersion || ''
      });
      if (pin.enabled !== true || pin.status === 'unavailable') {
        return unavailablePinResult(source.pinId, pin, source, requestId,
          pin.unavailableReason || 'Edit this pin to repair its action.');
      }
      var resolution = R.shortcutPads && R.shortcutPads.resolve
        ? R.shortcutPads.resolve(pin) : null;
      var action = pinActionForExecution(pin, resolution);
      if (!action) {
        if (allowRefresh && R.afterEffectsShortcuts &&
            R.afterEffectsShortcuts.refreshActiveKeymap) {
          return refreshPinRegistry(source.pinId, requestId).then(function (refreshed) {
            return refreshed
              ? executeResolvedPin(refreshed.pin, refreshed.action, source, requestId, true)
              : unavailablePinResult(source.pinId, padById(source.pinId) || pin,
                source, requestId, 'The action could not be resolved in the current AE registry.');
          });
        }
        return unavailablePinResult(source.pinId, pin, source, requestId,
          resolution && resolution.unavailableReason || 'Edit this pin to repair its action.');
      }
      return executeResolvedPin(pin, action, source, requestId, false);
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
      return resolveAndRun(true);
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
        userMessage: 'Couldn’t run "' + (pin && (pin.displayName || pin.label) || 'Shortcut') + '".',
        error: message
      }));
    });
  }

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
