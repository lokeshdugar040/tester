/*
 * Curated After Effects menu commands that can be pinned to the Home board.
 */
;(function (R) {
  'use strict';

  var mappedActions = [];
  var activeEntries = [];
  var runtimeCommands = {};
  var registeredCommands = {};
  var runtimeCommandsLoaded = false;
  var registeredCommandsLoaded = false;
  var keymapLoaded = false;
  var currentContext = null;
  var registryVersion = '';
  var verificationKey = 'ae-shortcut-live-verifications';
  var observedExecutions = {};

  if (R.disk && R.disk.read) {
    var savedVerifications = R.disk.read(verificationKey, {});
    if (savedVerifications && typeof savedVerifications === 'object' &&
        !Array.isArray(savedVerifications)) {
      observedExecutions = savedVerifications;
    }
  }

  function metadataFor(record) {
    var metadata = R.aeShortcutMap && R.aeShortcutMap.actionMetadata
      ? R.aeShortcutMap.actionMetadata() : {};
    return metadata[record.aeContext + '|' + record.keymapCommand] || null;
  }

  function resolvedRecord(record) {
    var metadata = metadataFor(record);
    var routeKey = record.aeContext + '|' + record.keymapCommand;
    var runtimeCommand = runtimeCommands[routeKey] || null;
    var commandActionId = runtimeCommand && runtimeCommand.commandActionId ||
      metadata && metadata.commandActionId;
    var commandId = runtimeCommand && runtimeCommand.commandId || null;
    var hasBinding = !!record.activeChord && !(record.sequence && record.sequence.length > 1);
    var hostCommandRoute = !!(hasBinding && runtimeCommand &&
      runtimeCommand.deliveryRoute === 'host-command' && commandId &&
      runtimeCommand.commandIdSource === 'verified-host-probe');
    var deliveryRoute = hostCommandRoute ? 'host-command' : 'unsupported';
    var evidence = observedExecutions[record.actionId];
    var verificationStatus = deliveryRoute === 'unsupported' ? 'unsupported'
      : evidence && evidence.aeVersion === (runtimeCommand && runtimeCommand.aeVersion || '') &&
        evidence.deliveryRoute === deliveryRoute &&
        evidence.activeChord === record.activeChord &&
        JSON.stringify(evidence.sequence || []) === JSON.stringify(record.sequence || [])
        ? 'verified' : 'unverified';
    var userStatus = contextStatus(record, deliveryRoute);
    var reason = userStatus === 'Unsupported'
      ? !hasBinding ? 'No AE shortcut assigned'
        : 'This shortcut has no safe delivery route.'
      : userStatus === 'Ready' ? '' : userStatus;
    return {
      id: record.id,
      actionId: record.actionId,
      label: record.label,
      workflowCategory: record.workflowCategory,
      category: record.workflowCategory,
      menuPath: record.menuPath || (record.workflowCategory + ' \u203a ' + record.label),
      commandName: record.label,
      aeContext: record.aeContext,
      context: record.aeContext,
      contextLabel: record.contextLabel,
      requiredContext: record.requiredContext,
      keymapCommand: record.keymapCommand,
      activeKeymapCommandId: record.keymapCommand,
      activeChord: record.activeChord,
      chord: record.activeChord,
      shortcut: record.displayChord,
      displayChord: record.displayChord,
      alternateChords: record.alternateChords.slice(),
      bindingAlternatives: record.bindingAlternatives.slice(),
      sequence: record.sequence.slice(),
      actionKind: record.actionKind,
      requirements: record.requirements,
      commandId: commandId,
      commandIdSource: commandId && runtimeCommand.commandIdSource
        ? 'verified-host-probe' : null,
      menuLabel: runtimeCommand && runtimeCommand.menuLabel || null,
      nativeCommandId: null,
      deliveryRoute: deliveryRoute,
      executionRoute: deliveryRoute,
      fallbackRoute: null,
      route: deliveryRoute,
      verificationStatus: verificationStatus,
      aeVersion: runtimeCommand && runtimeCommand.aeVersion || '',
      userStatus: userStatus,
      requiredState: runtimeCommand && runtimeCommand.requiredState ||
        metadata && metadata.requiredState || 'Required AE state has not been verified.',
      successCriteria: runtimeCommand && runtimeCommand.successCriteria ||
        metadata && metadata.successCriteria || record.successCriteria,
      expectedResult: runtimeCommand && runtimeCommand.successCriteria ||
        metadata && metadata.successCriteria || record.successCriteria,
      schemaVersion: 1,
      commandRequest: {
        schemaVersion: 1,
        requestId: 'rb_' + (new Date()).getTime().toString(16) + '_' +
          Math.floor(Math.random() * 0x100000000).toString(16),
        shortcutId: record.id,
        commandIdentity: {
          context: record.aeContext,
          command: record.keymapCommand
        },
        commandActionId: commandActionId || null,
        commandId: commandId,
        commandIdSource: commandId ? 'verified-host-probe' : null,
        commandName: record.label,
        menuLabel: runtimeCommand && runtimeCommand.menuLabel || null,
        menuPath: record.menuPath ||
          record.workflowCategory + ' \u203a ' + record.label,
        nativeCommandId: null,
        binding: {
          activeChord: record.activeChord,
          sequence: record.sequence.slice()
        },
        requiredContext: record.requiredContext,
        contextSnapshot: {
          detectedContext: currentContext && currentContext.detectedContext || 'Unknown',
          aeForeground: currentContext && typeof currentContext.aeForeground === 'boolean'
            ? currentContext.aeForeground : null,
          capturedAt: (new Date()).getTime()
        },
        preferredRoute: deliveryRoute,
        fallbackRoute: null,
        expectedResult: runtimeCommand && runtimeCommand.successCriteria ||
          metadata && metadata.successCriteria || record.successCriteria
      },
      reason: reason,
      nativeActionId: hostCommandRoute ? commandActionId : null,
      available: hasBinding,
      assigned: hasBinding,
      runnable: userStatus === 'Ready',
      canonicalRecord: record,
      aeMapShortcut: true,
      isAfterEffectsShortcut: true,
      kind: 'apply',
      group: 'After Effects',
      desc: reason
    };
  }

  function contextStatus(record, deliveryRoute) {
    var state = currentContext || {};
    var needs = record.requirements || {};
    if (deliveryRoute === 'unsupported') return 'Unsupported';
    if (needs.composition && state.hasComp !== true) return 'Needs Composition';
    if (needs.mask && !(state.selectedMaskCount > 0)) return 'Needs Selection';
    if (needs.keyframes && !(state.totalSelectedKeys > 0)) return 'Needs Selection';
    if (needs.layer && !(state.selectedLayerCount > 0)) return 'Needs Selection';
    return 'Ready';
  }

  function actionFromEntry(entry) {
    var resolved = resolvedRecord(R.aeShortcutMap.canonicalRecord(entry));
    resolved.invoke = {
      method: 'aeShortcut.executeRequest',
      args: { request: resolved.commandRequest }
    };
    return resolved;
  }

  function updateFromKeymap(map) {
    if (!map || !Array.isArray(map.entries)) {
      throw new Error('The active After Effects keymap is invalid.');
    }
    var entries = map.entries.filter(function (entry) {
      return entry && entry.context !== '** header **' && entry.commandId;
    });
    activeEntries = entries.map(function (entry) {
      return {
        context: entry.context,
        contextLabel: R.aeShortcutMap.contextLabelForContext(entry.context),
        commandId: entry.commandId,
        shortcuts: Array.isArray(entry.shortcuts) ? entry.shortcuts.slice() : [],
        sequence: Array.isArray(entry.sequence) ? entry.sequence.slice() : [],
        sequenceBindingCount: Number(entry.sequenceBindingCount) || 0
      };
    });
    registryVersion = String(map.version || '');
    runtimeCommandsLoaded = false;
    mappedActions = activeEntries.map(actionFromEntry);
    keymapLoaded = true;
    if (R.bus) R.bus.emit('ae-shortcut-map:updated', map);
    return allActions();
  }

  function markUnavailable() {
    activeEntries = [];
    mappedActions = [];
    runtimeCommands = {};
    runtimeCommandsLoaded = false;
    keymapLoaded = false;
    currentContext = null;
    registryVersion = '';
  }

  function allActions() {
    return mappedActions.slice();
  }

  function nativeActionForChord(chord, context) {
    return null;
  }

  function nativeActionForCommand(commandId, context) {
    for (var i = 0; i < activeEntries.length; i++) {
      if (activeEntries[i].commandId !== commandId ||
          (context && activeEntries[i].context !== context)) continue;
      var record = R.aeShortcutMap.canonicalRecord(activeEntries[i]);
      var runtimeCommand = runtimeCommands[record.aeContext + '|' + record.keymapCommand];
      if (record.activeChord && runtimeCommand &&
          runtimeCommand.deliveryRoute === 'host-command' &&
          runtimeCommand.commandIdSource === 'verified-host-probe' &&
          typeof runtimeCommand.commandId === 'number' &&
          runtimeCommand.commandActionId) return runtimeCommand.commandActionId;
    }
    return null;
  }

  function isApplicationContext(context) {
    return context === 'CSwitchboard' || context === 'AE_TopLevelWindow';
  }

  function registeredActionForId(actionId) {
    if (!R.aeShortcutMap || !R.aeShortcutMap.actionMetadata) return null;
    var metadata = R.aeShortcutMap.actionMetadata();
    var keys = Object.keys(metadata);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var separator = key.indexOf('|');
      if (separator < 0) continue;
      var context = key.slice(0, separator);
      var command = key.slice(separator + 1);
      var entry = {
        context: context,
        commandId: command,
        shortcuts: [],
        sequence: []
      };
      var record = R.aeShortcutMap.canonicalRecord(entry);
      var item = metadata[key];
      if (item.id !== actionId && item.commandActionId !== actionId &&
          record.id !== actionId && record.actionId !== actionId) continue;
      if (!item.commandActionId ||
          !/^(?:host-menu-command|host-command|bridge-jsx|native-aegp)$/.test(item.route || '')) {
        continue;
      }
      var action = resolvedRecord(record);
      var commandMetadata = registeredCommands[item.commandActionId] || null;
      action.id = record.id;
      action.actionId = record.actionId;
      action.label = item.label || record.label;
      action.commandName = item.label || record.label;
      action.menuPath = item.menuPath || record.menuPath || record.workflowCategory +
        ' \u203a ' + (item.label || record.label);
      action.activeChord = '';
      action.chord = '';
      action.displayChord = '';
      action.deliveryRoute = 'bridge-jsx';
      action.executionRoute = 'bridge-jsx';
      action.fallbackRoute = null;
      action.route = 'bridge-jsx';
      action.commandId = commandMetadata && Number(commandMetadata.commandId) || null;
      action.commandIdSource = action.commandId ? 'app.findMenuCommandId' : null;
      action.nativeCommandId = null;
      action.commandRequest = null;
      action.commandActionId = item.commandActionId;
      action.userStatus = 'Ready';
      action.reason = '';
      action.available = false;
      action.assigned = false;
      action.runnable = true;
      action.aeMapShortcut = false;
      action.registeredFallback = true;
      action.invoke = {
        method: 'aeShortcut.execute',
        args: {
          id: item.commandActionId,
          commandId: action.commandId,
          commandIdSource: action.commandIdSource,
          commandName: action.commandName,
          menuPath: action.menuPath
        }
      };
      action.kind = 'apply';
      action.group = 'After Effects';
      return action;
    }
    return null;
  }

  function resolveAction(actionId) {
    for (var i = 0; i < activeEntries.length; i++) {
      var record = R.aeShortcutMap.canonicalRecord(activeEntries[i]);
      var metadata = metadataFor(record);
      if (record.id === actionId || record.actionId === actionId ||
          (metadata && metadata.commandActionId === actionId)) {
        var activeAction = resolvedRecord(record);
        if (activeAction.deliveryRoute !== 'unsupported') return activeAction;
        return registeredActionForId(actionId) || activeAction;
      }
    }
    return registeredActionForId(actionId);
  }

  function markExecutionVerified(actionId, result) {
    if (!result || result.verified !== true || result.executed !== true ||
        result.contextVerified !== true) return false;
    var action = resolveAction(actionId);
    if (!action || action.deliveryRoute === 'unsupported') return false;
    observedExecutions[action.actionId] = {
      aeVersion: action.aeVersion || '',
      deliveryRoute: action.deliveryRoute,
      activeChord: action.activeChord || '',
      sequence: action.sequence || [],
      verifiedAt: (new Date()).toISOString()
    };
    if (R.disk && R.disk.write && !R.disk.write(verificationKey, observedExecutions)) {
      if (R.log) R.log.error('Could not persist live After Effects shortcut verification.');
      return false;
    }
    mappedActions = activeEntries.map(actionFromEntry);
    if (R.bus) R.bus.emit('ae-shortcut-runtime-commands:updated', runtimeCommands);
    return true;
  }

  function catalogEntries() {
    if (!keymapLoaded) return [];
    return activeEntries.map(function (entry) {
      return resolvedRecord(R.aeShortcutMap.canonicalRecord(entry));
    });
  }

  function routeCandidates() {
    if (!keymapLoaded) return [];
    return activeEntries.reduce(function (candidates, entry) {
      var record = R.aeShortcutMap.canonicalRecord(entry);
      var metadata = metadataFor(record);
      if (metadata && metadata.commandActionId && record.activeChord &&
          !(record.sequence && record.sequence.length > 1)) {
        candidates.push({
          shortcutId: record.id,
          context: record.aeContext,
          commandId: record.keymapCommand,
          actionId: metadata.commandActionId,
          commandName: record.label,
          menuPath: record.menuPath ||
            record.workflowCategory + ' \u203a ' + record.label,
          activeChord: record.activeChord,
          sequence: record.sequence.slice(),
          fallbackRoute: null,
          requiredContext: record.requiredContext,
          verificationStatus: metadata.verificationStatus,
          requiredState: metadata.requiredState,
          successCriteria: metadata.successCriteria
        });
      }
      return candidates;
    }, []);
  }

  R.afterEffectsShortcuts = {
    actions: allActions,
    curatedActions: allActions,
    updateFromKeymap: updateFromKeymap,
    markUnavailable: markUnavailable,
    updateContext: function (state) {
      if (!state || typeof state !== 'object') {
        throw new Error('The live After Effects context is invalid.');
      }
      if (JSON.stringify(currentContext) === JSON.stringify(state)) return allActions();
      currentContext = state;
      mappedActions = activeEntries.map(actionFromEntry);
      if (R.bus) R.bus.emit('ae-shortcut-context:updated', currentContext);
      return allActions();
    },
    updateRuntimeCommands: function (result) {
      if (!result || !result.commands || typeof result.commands !== 'object') {
        throw new Error('After Effects returned invalid runtime menu command metadata.');
      }
      runtimeCommands = result.commands;
      runtimeCommandsLoaded = true;
      registryVersion = String(result.aeVersion || registryVersion || '');
      mappedActions = activeEntries.map(actionFromEntry);
      if (R.bus) R.bus.emit('ae-shortcut-runtime-commands:updated', runtimeCommands);
      return runtimeCommands;
    },
    updateMenuCommands: function (result) {
      if (!result || !result.commands || typeof result.commands !== 'object') {
        throw new Error('After Effects returned invalid registered command metadata.');
      }
      registeredCommands = result.commands;
      registeredCommandsLoaded = true;
      mappedActions = activeEntries.map(actionFromEntry);
      if (R.bus) R.bus.emit('ae-shortcut-runtime-commands:updated', runtimeCommands);
      return registeredCommands;
    },
    resolveAction: resolveAction,
    markExecutionVerified: markExecutionVerified,
    nativeActionForCommand: nativeActionForCommand,
    isApplicationContext: isApplicationContext,
    keymapEntries: function () {
      return activeEntries.map(function (entry) {
        return {
          context: entry.context,
          contextLabel: entry.contextLabel,
          commandId: entry.commandId,
          shortcuts: entry.shortcuts.slice(),
          sequence: entry.sequence.slice()
        };
      });
    },
    routeCandidates: routeCandidates,
    catalogEntries: catalogEntries,
    nativeActionForChord: nativeActionForChord,
    keymapLoaded: function () { return keymapLoaded; },
    runtimeReady: function () { return runtimeCommandsLoaded; },
    menuCommandsReady: function () { return registeredCommandsLoaded; },
    registeredCommands: function () { return registeredCommands; },
    registryVersion: function () { return registryVersion; },
    currentContext: function () { return currentContext ? copyContext(currentContext) : null; }
  };

  function copyContext(context) {
    var result = {};
    Object.keys(context || {}).forEach(function (key) { result[key] = context[key]; });
    return result;
  }
})(window.Rebound = window.Rebound || {});
