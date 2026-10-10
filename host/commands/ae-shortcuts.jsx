/*
 * Dispatch a curated After Effects menu command by its current localized menu
 * label. Command IDs are resolved at runtime because they vary by AE version.
 */
(function () {
  var R = $.__rebound;
  var COMMANDS = {
    'ae-easy-ease': ['Easy Ease'],
    'ae-easy-ease-in': ['Easy Ease In'],
    'ae-easy-ease-out': ['Easy Ease Out'],
    'ae-undo': ['Undo'],
    'ae-redo': ['Redo'],
    'ae-save-project': ['Save'],
    'ae-new-composition': ['New Composition...', 'New Composition'],
    'ae-pre-compose': ['Pre-compose...', 'Pre-compose'],
    'ae-new-solid': ['New Solid...', 'New Solid'],
    'ae-duplicate': ['Duplicate'],
    'ae-split-layer': ['Split Layer'],
    'ae-new-null': ['Null Object'],
    'ae-add-marker': ['Add Marker']
  };
  var registry = $.global.__reboundAeShortcutRegistry;
  if (!registry || typeof registry !== 'object') registry = {};
  registry.actions = COMMANDS;
  registry.activeKeymap = registry.activeKeymap || {};
  registry.schemaVersion = 1;
  registry.hostVersion = String(app.version || '');
  $.global.__reboundAeShortcutRegistry = registry;

  function selectedKeyframes() {
    var comp = app.project && app.project.activeItem;
    var props = comp && comp.selectedProperties;
    var keys = [];
    if (!props) return keys;
    for (var p = 0; p < props.length; p++) {
      if (!(props[p] instanceof Property)) continue;
      var selected = props[p].selectedKeys;
      for (var k = 0; k < selected.length; k++) {
        keys.push({ property: props[p], index: selected[k] });
      }
    }
    return keys;
  }

  function markerProperty(layer) {
    try { return layer.property('ADBE Marker'); }
    catch (err) { return null; }
  }

  function captureState(actionId) {
    var project = app.project;
    var comp = project && project.activeItem;
    var state = { actionId: actionId };
    if (actionId === 'ae-save-project') {
      state.dirty = project ? project.dirty : null;
      state.file = project && project.file ? project.file.fsName : '';
    }
    if (comp && typeof CompItem !== 'undefined' && comp instanceof CompItem) {
      state.comp = comp;
      state.numLayers = comp.numLayers;
      state.selectedLayers = comp.selectedLayers ? comp.selectedLayers.length : 0;
      state.currentTime = comp.time;
      state.nullLayers = 0;
      state.markerKeys = 0;
      if (actionId === 'ae-new-null') {
        for (var n = 1; n <= comp.numLayers; n++) {
          if (comp.layer(n).nullLayer) state.nullLayers++;
        }
      }
      if (actionId === 'ae-add-marker' && comp.selectedLayers) {
        for (var m = 0; m < comp.selectedLayers.length; m++) {
          var markers = markerProperty(comp.selectedLayers[m]);
          if (markers) state.markerKeys += markers.numKeys;
        }
      }
    }
    if (actionId === 'ae-easy-ease' || actionId === 'ae-easy-ease-in' ||
        actionId === 'ae-easy-ease-out') state.keys = selectedKeyframes();
    return state;
  }

  function verifyState(actionId, before) {
    var comp = before.comp;
    if (actionId === 'ae-save-project') {
      return {
        verified: !!(app.project && before.file && before.dirty === true && app.project.dirty === false),
        result: 'Project dirty=' + (app.project ? app.project.dirty : 'unavailable') + '.'
      };
    }
    if (actionId === 'ae-duplicate' || actionId === 'ae-split-layer') {
      var expected = before.numLayers + before.selectedLayers;
      var actual = comp ? comp.numLayers : -1;
      return {
        verified: !!(before.selectedLayers && actual === expected),
        result: 'Layer count ' + before.numLayers + ' -> ' + actual + '; expected ' + expected + '.'
      };
    }
    if (actionId === 'ae-new-null') {
      var nullCount = 0;
      if (comp) {
        for (var n = 1; n <= comp.numLayers; n++) {
          if (comp.layer(n).nullLayer) nullCount++;
        }
      }
      return {
        verified: !!(comp && comp.numLayers === before.numLayers + 1 &&
          nullCount === before.nullLayers + 1),
        result: 'Layer count ' + before.numLayers + ' -> ' + (comp ? comp.numLayers : -1) +
          '; null count ' + before.nullLayers + ' -> ' + nullCount + '.'
      };
    }
    if (actionId === 'ae-add-marker') {
      var markerCount = 0;
      if (comp && comp.selectedLayers) {
        for (var m = 0; m < comp.selectedLayers.length; m++) {
          var markers = markerProperty(comp.selectedLayers[m]);
          if (markers) markerCount += markers.numKeys;
        }
      }
      return {
        verified: !!(before.selectedLayers && markerCount > before.markerKeys),
        result: 'Selected-layer markers ' + before.markerKeys + ' -> ' + markerCount + '.'
      };
    }
    if (actionId === 'ae-easy-ease' || actionId === 'ae-easy-ease-in' ||
        actionId === 'ae-easy-ease-out') {
      var verified = !!(before.keys && before.keys.length);
      for (var k = 0; verified && k < before.keys.length; k++) {
        var selectedKey = before.keys[k];
        verified = selectedKey.property.keyInInterpolationType(selectedKey.index) === KeyframeInterpolationType.BEZIER &&
          selectedKey.property.keyOutInterpolationType(selectedKey.index) === KeyframeInterpolationType.BEZIER;
      }
      return {
        verified: verified,
        result: before.keys.length + ' selected keyframe(s) use Bezier interpolation.'
      };
    }
    if (actionId === 'ae-pre-compose') {
      return {
        verified: !!(comp && comp.numLayers < before.numLayers),
        result: 'Layer count ' + before.numLayers + ' -> ' + (comp ? comp.numLayers : -1) + '.'
      };
    }
    return {
      verified: false,
      result: 'The command was dispatched, but no action-specific postcondition is available.'
    };
  }

  function validateRequestContext(request) {
    var required = request.requiredContext || '';
    var snapshot = request.contextSnapshot || {};
    var now = (new Date()).getTime();
    var panelRequired = /^(?:Timeline|Composition Viewer|Effect Controls|Project Panel|Render Queue)$/
      .test(required);
    if (panelRequired &&
        (snapshot.aeForeground !== true ||
         now - Number(snapshot.capturedAt) > 2000 ||
         snapshot.capturedAt > now ||
         snapshot.detectedContext !== required)) {
      throw new Error('Focus the After Effects ' + required + ' panel before running this shortcut.');
    }
    var comp = app.project && app.project.activeItem;
    var hasComp = typeof CompItem !== 'undefined' && comp instanceof CompItem;
    if (/^(?:Composition|Composition Viewer|Timeline|Selected layer|Selected keyframes|Mask selection)$/
        .test(required) && !hasComp) {
      throw new Error('Open a composition before running this shortcut.');
    }
    if (/Selected layer/.test(required) &&
        (!comp.selectedLayers || !comp.selectedLayers.length)) {
      throw new Error('Select one or more layers before running this shortcut.');
    }
    if (/Selected keyframes/.test(required) && !selectedKeyframes().length) {
      throw new Error('Select one or more keyframes before running this shortcut.');
    }
    if ((request.commandActionId === 'ae-undo' ||
         request.commandActionId === 'ae-redo') && !app.project) {
      throw new Error('Open a project before running this history command.');
    }
    return true;
  }

  function executeRegisteredAction(args) {
    var labels = args && COMMANDS[args.id];
    if (!labels) throw new Error('Unknown After Effects shortcut action.');
    var request = args && args.request;
    if (request && (request.preferredRoute !== 'host-command' ||
        typeof request.commandId !== 'number' || request.commandId <= 0 ||
        request.commandIdSource !== 'verified-host-probe')) {
      throw new Error('The action must use a verified After Effects command ID.');
    }
    if (args.id === 'ae-easy-ease' || args.id === 'ae-easy-ease-in' || args.id === 'ae-easy-ease-out') {
      var comp = app.project && app.project.activeItem;
      var props = comp && comp.selectedProperties;
      var selectedKeys = 0;
      if (props) {
        for (var p = 0; p < props.length; p++) {
          if (props[p] instanceof Property) selectedKeys += props[p].selectedKeys.length;
        }
      }
      if (!selectedKeys) {
        throw new Error('Select one or more keyframes in the active composition before applying ' +
          labels[0] + '.');
      }
    }
    if (args.id === 'ae-split-layer' || args.id === 'ae-pre-compose') {
      var selectedComp = app.project && app.project.activeItem;
      if (typeof CompItem === 'undefined' || !(selectedComp instanceof CompItem) ||
          !selectedComp.selectedLayers || !selectedComp.selectedLayers.length) {
        throw new Error(labels[0] + ' is not available in this context. Select one or more layers in a composition.');
      }
    }
    if (args.id === 'ae-pre-compose' &&
        app.project.activeItem.selectedLayers.length < 2) {
      throw new Error('Pre-compose requires at least two selected layers.');
    }
    if (args.id === 'ae-new-solid') {
      var activeComp = app.project && app.project.activeItem;
      if (typeof CompItem === 'undefined' || !(activeComp instanceof CompItem)) {
        throw new Error('New Solid is not available in this context. Open a composition first.');
      }
    }
    if (args.id === 'ae-duplicate') {
      var selectedLayersForDuplicate = app.project && app.project.activeItem;
      if (typeof CompItem === 'undefined' ||
          !(selectedLayersForDuplicate instanceof CompItem) ||
          !selectedLayersForDuplicate.selectedLayers ||
          !selectedLayersForDuplicate.selectedLayers.length) {
        throw new Error('Duplicate is only enabled for selected composition layers.');
      }
    }
    if (args.id === 'ae-new-null' || args.id === 'ae-add-marker') {
      var actionComp = app.project && app.project.activeItem;
      if (typeof CompItem === 'undefined' || !(actionComp instanceof CompItem)) {
        throw new Error(labels[0] + ' requires an active composition.');
      }
      if (args.id === 'ae-add-marker' &&
          (!actionComp.selectedLayers || !actionComp.selectedLayers.length)) {
        throw new Error('Add Marker requires a selected layer in the active composition.');
      }
    }
    if (typeof app.executeCommand !== 'function' ||
        (!request && typeof app.findMenuCommandId !== 'function')) {
      throw new Error('After Effects menu commands are unavailable in this host.');
    }

    var commandId = 0, menuLabel = null, i;
    var registeredCommand = registry.menuCommands && registry.menuCommands[args.id];
    var activeRoute = request && request.commandIdentity &&
      registry.activeKeymap[request.commandIdentity.context + '|' +
        request.commandIdentity.command];
    if (request && activeRoute &&
        activeRoute.schemaVersion === 1 &&
        activeRoute.deliveryRoute === 'host-command' &&
        activeRoute.commandActionId === args.id &&
        activeRoute.commandId === request.commandId &&
        activeRoute.commandName === request.commandName &&
        activeRoute.menuPath === request.menuPath &&
        request.commandIdSource === 'verified-host-probe' &&
        typeof request.commandId === 'number' && request.commandId > 0) {
      commandId = request.commandId;
      menuLabel = request.menuLabel || null;
    } else if (request) {
      throw new Error('The saved command ID no longer matches the current After Effects command registry.');
    } else if (args.commandId && registeredCommand &&
        Number(registeredCommand.commandId) === Number(args.commandId)) {
      commandId = Number(args.commandId);
      menuLabel = registeredCommand.menuLabel || null;
    } else {
      for (i = 0; i < labels.length; i++) {
        commandId = app.findMenuCommandId(labels[i]);
        if (commandId) {
          menuLabel = labels[i];
          break;
        }
      }
    }
    if (!commandId) {
      throw new Error('Could not find the After Effects menu command: ' + labels.join(' / ') +
        '. The command may have a different name in this After Effects language or version.');
    }

    var before = captureState(args.id);
    app.executeCommand(commandId);
    var result = verifyState(args.id, before);
    return {
      ok: true,
      requestId: request && request.requestId || args.requestId || '',
      commandId: commandId,
      commandName: request && request.commandName || args.commandName || labels[0],
      menuPath: request && request.menuPath || args.menuPath || '',
      menuLabel: menuLabel || registeredCommand && registeredCommand.menuLabel || null,
      commandIdSource: request && request.commandIdSource === 'verified-host-probe'
          ? request.commandIdSource : 'app.findMenuCommandId',
      executionRoute: 'host-command',
      executed: true,
      contextVerified: !!request,
      verified: result.verified,
      result: result.result
    };
  }

  R.register('aeShortcut.execute', executeRegisteredAction);

  R.register('aeShortcut.executeRequest', function (args) {
    var request = args && args.request;
    if (!request || request.schemaVersion !== 1 ||
        typeof request.requestId !== 'string' ||
        !/^(?:rb_[a-f0-9]+_[a-f0-9]+|shortcut-[0-9]+-[A-Za-z0-9-]+)$/i
          .test(request.requestId) ||
        typeof request.shortcutId !== 'string' ||
        !request.commandIdentity ||
        typeof request.commandIdentity.context !== 'string' ||
        typeof request.commandIdentity.command !== 'string' ||
        typeof request.commandId !== 'number' || request.commandId <= 0 ||
        request.commandIdSource !== 'verified-host-probe' ||
        typeof request.commandActionId !== 'string' || !request.commandActionId ||
        request.preferredRoute !== 'host-command') {
      throw new Error('The typed shortcut command request is invalid.');
    }
    var key = request.commandIdentity.context + '|' + request.commandIdentity.command;
    var activeRoute = registry.activeKeymap[key];
    if (!activeRoute || activeRoute.schemaVersion !== 1 ||
        activeRoute.shortcutId !== request.shortcutId ||
        activeRoute.commandActionId !== request.commandActionId ||
        activeRoute.commandId !== request.commandId ||
        activeRoute.commandName !== request.commandName ||
        activeRoute.menuPath !== request.menuPath ||
        activeRoute.nativeCommandId !== request.nativeCommandId ||
        activeRoute.deliveryRoute !== request.preferredRoute ||
        !request.binding ||
        activeRoute.activeChord !== request.binding.activeChord ||
        JSON.stringify(activeRoute.sequence) !== JSON.stringify(request.binding.sequence) ||
        activeRoute.fallbackRoute !== request.fallbackRoute ||
        activeRoute.requiredContext !== request.requiredContext ||
        activeRoute.successCriteria !== request.expectedResult) {
      throw new Error('The shortcut command request no longer matches the active AE keymap.');
    }
    validateRequestContext(request);
    return executeRegisteredAction({
      id: request.commandActionId,
      request: request
    });
  });

  R.register('aeShortcut.resolveMenuCommands', function () {
    if (typeof app.findMenuCommandId !== 'function') {
      throw new Error('After Effects menu command lookup is unavailable.');
    }
    var resolved = {}, actionId, labels, commandId, i;
    for (actionId in COMMANDS) {
      if (!COMMANDS.hasOwnProperty(actionId)) continue;
      labels = COMMANDS[actionId];
      commandId = 0;
      for (i = 0; i < labels.length; i++) {
        commandId = app.findMenuCommandId(labels[i]);
        if (commandId) break;
      }
      resolved[actionId] = {
        commandId: commandId || null,
        commandIdSource: 'app.findMenuCommandId',
        menuLabel: commandId ? labels[i] : null
      };
    }
    registry.menuCommands = resolved;
    return { commands: resolved };
  });

  R.register('aeShortcut.resolveActiveKeymap', function (args) {
    var entries = args && args.entries;
    var candidates = args && args.routeCandidates;
    if (Object.prototype.toString.call(entries) !== '[object Array]' || entries.length > 2000 ||
        Object.prototype.toString.call(candidates) !== '[object Array]' || candidates.length > 2000) {
      throw new Error('The active keymap command list is invalid.');
    }
    if (typeof app.findMenuCommandId !== 'function') {
      throw new Error('After Effects menu command lookup is unavailable.');
    }
    var activeIdentities = {}, resolved = {}, i, entry, key, route, labels, commandId, menuLabel, j;
    for (i = 0; i < entries.length; i++) {
      entry = entries[i];
      if (!entry || typeof entry.context !== 'string' ||
          typeof entry.commandId !== 'string' || !entry.context || !entry.commandId) {
        throw new Error('The active keymap contains an invalid command identity.');
      }
      key = entry.context + '|' + entry.commandId;
      activeIdentities[key] = true;
    }
    for (i = 0; i < candidates.length; i++) {
      route = candidates[i];
      if (!route || typeof route.context !== 'string' ||
          typeof route.commandId !== 'string' || typeof route.actionId !== 'string') {
        throw new Error('The active keymap route candidate is invalid.');
      }
      key = route.context + '|' + route.commandId;
      if (!activeIdentities[key]) {
        throw new Error('A route candidate does not match an entry in the active keymap.');
      }
      if (route.shortcutId !== 'ae.map.' + encodeURIComponent(route.context) + '.' +
          encodeURIComponent(route.commandId)) {
        throw new Error('A route candidate has an invalid stable shortcut id.');
      }
      if (!registry.actions[route.actionId]) {
        throw new Error('The active keymap requested an unregistered AE action.');
      }
      labels = registry.actions[route.actionId];
      commandId = 0;
      menuLabel = null;
      for (j = 0; j < labels.length; j++) {
        commandId = app.findMenuCommandId(labels[j]);
        if (commandId) {
          menuLabel = labels[j];
          break;
        }
      }
      resolved[key] = {
        schemaVersion: 1,
        shortcutId: route.shortcutId,
        context: route.context,
        keymapCommand: route.commandId,
        commandName: route.commandName || '',
        menuPath: route.menuPath || '',
        activeChord: route.activeChord || '',
        sequence: route.sequence || [],
        fallbackRoute: route.fallbackRoute || null,
        requiredContext: route.requiredContext || '',
        commandActionId: route.actionId,
        commandId: commandId || null,
        commandIdSource: commandId ? 'verified-host-probe' : null,
        nativeCommandId: null,
        menuLabel: menuLabel,
        deliveryRoute: commandId ? 'host-command' : 'unavailable',
        verificationStatus: route.verificationStatus || 'unverified',
        requiredState: route.requiredState,
        successCriteria: route.successCriteria,
        aeVersion: registry.hostVersion
      };
    }
    registry.activeKeymap = resolved;
    return {
      commands: resolved,
      commandIdSource: 'verified-host-probe',
      schemaVersion: registry.schemaVersion,
      nativeCommandAvailable: false,
      aeVersion: registry.hostVersion,
      keymapCount: entries.length
    };
  });

  R.register('aeShortcut.executeCustom', function (args) {
    var functionName = args && args.functionName;
    var parameters = args && args.args != null ? args.args : [];
    if (typeof functionName !== 'string' ||
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(functionName)) {
      throw new Error('Enter a valid ExtendScript function name.');
    }
    if (Object.prototype.toString.call(parameters) !== '[object Array]' || parameters.length > 32) {
      throw new Error('Custom AE function arguments must be an array of at most 32 values.');
    }
    var target = $.global;
    var customFunction = target && target[functionName];
    if (typeof customFunction !== 'function') {
      throw new Error('Could not find the ExtendScript function "' + functionName + '".');
    }
    customFunction.apply(target, parameters);
    return { functionName: functionName };
  }, 'Rebound: Custom AE Function');

  function readFile(file) {
    if (!file.exists) throw new Error('After Effects shortcut preference file was not found: ' + file.fsName);
    file.encoding = 'UTF-8';
    if (!file.open('r')) throw new Error('Could not open the After Effects shortcut preference file: ' + file.fsName);
    var contents;
    try { contents = file.read(); }
    finally { file.close(); }
    return contents;
  }

  R.register('aeShortcut.readKeymap', function () {
    var appData = $.getenv('APPDATA');
    if (!appData) throw new Error('Could not locate the Windows user preferences folder.');
    var version = String(app.version || '');
    var versionMatch = /^(\d+\.\d+)/.exec(version);
    if (!versionMatch) throw new Error('Could not determine the active After Effects preference version.');
    var prefVersion = versionMatch[1];
    var prefRoot = appData + '/Adobe/After Effects/' + prefVersion;
    var prefs = new File(prefRoot + '/Adobe After Effects ' + prefVersion + ' Prefs.txt');
    var selected = /"Shortcut File Location"\s*=\s*"([^"]+)"/.exec(readFile(prefs));
    if (!selected || !selected[1]) {
      throw new Error('After Effects did not report the active shortcut map in its preferences.');
    }
    var filename = selected[1];
    if (filename.indexOf('/') !== -1 || filename.indexOf('\\') !== -1 || filename.indexOf('..') !== -1) {
      throw new Error('After Effects reported an invalid shortcut map filename.');
    }
    var map = new File(prefRoot + '/aeks/' + filename);
    return {
      version: version,
      filename: filename,
      contents: readFile(map)
    };
  });
})();
