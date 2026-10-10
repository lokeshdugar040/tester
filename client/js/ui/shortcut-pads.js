/*
 * Persistent Shortcut Library and the 36 Home-pad slots.
 */
;(function (R) {
  'use strict';

  var KEY = 'home-shortcut-pads';
  var SLOT_COUNT = 36;
  var DEFAULT_PIN_COUNT = 8;
  var sequence = 0;
  var cachedPads = null;
  var actionCache = {};
  var routeCache = {};

  function trim(value) {
    return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function lookupActionForId(actionId) {
    if (!actionId) return null;
    var action = R.afterEffectsShortcuts && R.afterEffectsShortcuts.resolveAction
      ? R.afterEffectsShortcuts.resolveAction(actionId) : null;
    if (action) return action;
    action = R.homeActions && R.homeActions.byId
      ? R.homeActions.byId(actionId) : null;
    if (action) return action;
    var catalog = R.homeActions && R.homeActions.shortcutCatalog
      ? R.homeActions.shortcutCatalog() : [];
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i] && catalog[i].id === actionId) {
        return catalog[i].action || catalog[i];
      }
    }
    return null;
  }

  function actionForId(actionId) {
    if (!actionId) return null;
    if (hasOwn(actionCache, actionId)) return actionCache[actionId] || null;
    var action = lookupActionForId(actionId);
    actionCache[actionId] = action || false;
    return action;
  }

  function routeForAction(actionId, action) {
    if (!actionId || !action) return 'unsupported';
    if (!hasOwn(routeCache, actionId)) {
      routeCache[actionId] = R.actionRouter && R.actionRouter.selectRoute
        ? R.actionRouter.selectRoute(action) : 'unsupported';
    }
    return routeCache[actionId];
  }

  function invalidateCaches() {
    cachedPads = null;
    actionCache = {};
    routeCache = {};
  }

  function isSampleId(id) {
    return /^(?:pad:)?sample-/i.test(String(id || ''));
  }

  function isPlaceholderActionId(id) {
    return /^(?:(?:pad:)?sample(?:[-:]|$)|(?:pad:)?demo(?:[-:]|$)|placeholder(?:[-:]|$)|unassigned$)/i
      .test(String(id || ''));
  }

  function pinIdentifier(id, index, usedIds) {
    var original = trim(id);
    if (!isSampleId(original)) return original.slice(0, 128);
    var suffix = original.replace(/^(?:pad:)?sample-/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-');
    var migrated = 'pin-' + (suffix || String(index + 1));
    var base = migrated;
    var counter = 2;
    while (usedIds[migrated]) migrated = base + '-' + counter++;
    return migrated.slice(0, 128);
  }

  function commandIdFor(action) {
    if (!action) return null;
    var commandId = action.commandId;
    if (!(typeof commandId === 'number' && isFinite(commandId) && commandId > 0)) {
      var request = action.commandRequest || {};
      commandId = request.commandId;
    }
    return typeof commandId === 'number' && isFinite(commandId) && commandId > 0
      ? Math.floor(commandId) : null;
  }

  function savedCommandIdFor(action) {
    if (!action) return null;
    var commandId = action.commandId;
    return typeof commandId === 'number' && isFinite(commandId) && commandId > 0
      ? Math.floor(commandId) : null;
  }

  function commandActionIdFor(action) {
    if (!action) return '';
    return String(action.commandRequest && action.commandRequest.commandActionId ||
      action.commandActionId ||
      action.invoke && action.invoke.method === 'aeShortcut.execute' &&
        action.invoke.args && action.invoke.args.id || '');
  }

  function actionTypeFor(action, fallback) {
    if (action && isVerifiedAeCommand(action)) return 'ae-command';
    return /^(?:ae-command|script|keyboard-shortcut)$/.test(fallback || '')
      ? fallback : 'ae-command';
  }

  function isVerifiedAeCommand(action) {
    var request = action && action.commandRequest || {};
    return !!(action && action.aeMapShortcut === true &&
      action.deliveryRoute === 'host-command' &&
      typeof action.commandId === 'number' && isFinite(action.commandId) &&
      action.commandId > 0 &&
      action.commandIdSource === 'verified-host-probe' &&
      typeof request.commandId === 'number' &&
      request.commandId === action.commandId &&
      request.commandIdSource === 'verified-host-probe' &&
      request.preferredRoute === 'host-command' &&
      typeof request.commandActionId === 'string' && request.commandActionId);
  }

  function normalizedIdentity(value) {
    return trim(value).toLowerCase()
      .replace(/â€º/g, '›')
      .replace(/\s*[›>]\s*/g, '>')
      .replace(/\s+/g, ' ');
  }

  function sameIdentity(left, right) {
    return !!left && !!right && normalizedIdentity(left) === normalizedIdentity(right);
  }

  function registryVersionFor(action) {
    var shortcuts = R.afterEffectsShortcuts;
    if (shortcuts && typeof shortcuts.registryVersion === 'function') {
      return String(shortcuts.registryVersion() || '');
    }
    return String(action && action.aeVersion || '');
  }

  function menuPathFor(action, commandName) {
    if (action && action.menuPath) return trim(action.menuPath);
    var category = trim(action &&
      (action.workflowCategory || action.category || action.group) || '');
    return category && commandName ? category + ' \u203a ' + commandName
      : category || commandName || '';
  }

  function shortcutRecord(hotkey) {
    if (!hotkey || !hotkey.key) return null;
    var modifiers = [];
    if (hotkey.ctrl) modifiers.push('Ctrl');
    if (hotkey.alt) modifiers.push('Alt');
    if (hotkey.shift) modifiers.push('Shift');
    if (hotkey.win) modifiers.push('Win');
    return {
      modifiers: modifiers,
      key: hotkey.key,
      display: displayHotkey(hotkey)
    };
  }

  function hotkeyChord(hotkey) {
    if (!hotkey || !hotkey.key) return '';
    var parts = [];
    if (hotkey.ctrl) parts.push('Ctrl');
    if (hotkey.alt) parts.push('Alt');
    if (hotkey.shift) parts.push('Shift');
    if (hotkey.win) parts.push('Win');
    parts.push(hotkey.key);
    return R.globalHotkeys && R.globalHotkeys.cleanPadChord
      ? R.globalHotkeys.cleanPadChord(parts.join('+')) : null;
  }

  function displayHotkey(hotkey) {
    if (!hotkey || !hotkey.key) return '';
    return formatShortcutForDisplay(hotkeyChord(hotkey));
  }

  function formatShortcutForDisplay(chord) {
    if (!chord) return '';
    if (R.aeShortcutMap && R.aeShortcutMap.formatShortcutForDisplay) {
      return R.aeShortcutMap.formatShortcutForDisplay(chord);
    }
    return String(chord).split('+').map(function (part) {
      return part.replace(/^\s+|\s+$/g, '');
    }).join(' + ');
  }

  function cleanHotkey(value) {
    if (value == null || value === '') return null;
    var chord;
    if (typeof value === 'string') {
      chord = R.globalHotkeys && R.globalHotkeys.cleanPadChord
        ? R.globalHotkeys.cleanPadChord(trim(value)) : null;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      var modifierList = Array.isArray(value.modifiers) ? value.modifiers : [];
      chord = hotkeyChord({
        ctrl: value.ctrl === true || modifierList.indexOf('Ctrl') !== -1 ||
          modifierList.indexOf('Control') !== -1,
        alt: value.alt === true || modifierList.indexOf('Alt') !== -1 ||
          modifierList.indexOf('Option') !== -1,
        shift: value.shift === true || modifierList.indexOf('Shift') !== -1,
        win: value.win === true || modifierList.indexOf('Win') !== -1 ||
          modifierList.indexOf('Meta') !== -1 || modifierList.indexOf('Cmd') !== -1 ||
          modifierList.indexOf('Command') !== -1,
        key: R.globalHotkeys && R.globalHotkeys.cleanPadKey
          ? R.globalHotkeys.cleanPadKey(value.key) : null
      });
    }
    if (!chord) throw new Error('Choose a supported key combination.');
    var parts = chord.split('+');
    var key = parts.pop();
    var modifiers = {};
    parts.forEach(function (part) { modifiers[part] = true; });
    var hotkey = {
      ctrl: !!modifiers.Ctrl,
      alt: !!modifiers.Alt,
      shift: !!modifiers.Shift,
      win: !!modifiers.Win,
      key: key,
      display: ''
    };
    hotkey.display = displayHotkey(hotkey);
    return hotkey;
  }

  function looksLikeInternalLabel(value) {
    return /^(?:C[A-Z]|AE_[A-Z]|AEGP|POutline|TLOutline|RQOutline|FloPano)/
      .test(String(value || ''));
  }

  function cleanLabel(value, action, fallback) {
    var label = trim(value);
    if (looksLikeInternalLabel(label)) {
      label = trim(action && action.label || fallback || 'Shortcut');
    }
    if (!label) label = action && action.label || fallback || 'Shortcut';
    return label.slice(0, 64);
  }

  function normalizePosition(value, fallback, usedSlots) {
    var slot = null;
    if (value === undefined) {
      slot = fallback >= 0 && fallback < SLOT_COUNT ? fallback : null;
    } else if (value !== null) {
      slot = value;
      slot = Number(slot);
      if (Math.floor(slot) !== slot || slot < 0 || slot >= SLOT_COUNT) {
        if (R.log) R.log.warn('An invalid 6 × 6 Shortcut Pad slot was left empty during migration.');
        slot = null;
      }
    }
    if (slot !== null && usedSlots[slot]) {
      if (R.log) R.log.warn('A duplicate Shortcut Pad slot was left empty during migration.');
      slot = null;
    }
    if (slot !== null) usedSlots[slot] = true;
    return slot;
  }

  function normalize(item, index, usedSlots, usedIds) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    var actionData = item.action && typeof item.action === 'object'
      ? item.action : {};
    var originalPinId = typeof item.pinId === 'string' ? trim(item.pinId)
      : typeof item.id === 'string' ? trim(item.id)
        : typeof item.padId === 'string' ? trim(item.padId) : '';
    if (!originalPinId) return null;
    var pinId = pinIdentifier(originalPinId, index, usedIds);
    var actionId = trim(item.actionId || '');
    if (isPlaceholderActionId(actionId)) actionId = '';
    if (!actionId) {
      actionId = trim(actionData.actionId || '');
      if (isPlaceholderActionId(actionId)) actionId = '';
    }
    var action = actionId ? actionForId(actionId) : null;
    var resolvedCommandName = trim(action && (action.commandName || action.label) || '');
    var resolvedMenuPath = menuPathFor(action, resolvedCommandName);
    var commandName = trim(actionData.commandName || item.commandName ||
      resolvedCommandName);
    var menuPath = trim(actionData.menuPath || item.menuPath || resolvedMenuPath);
    var displayName = cleanLabel(item.displayName || item.label || item.customLabel,
      action, 'Shortcut');
    var type = actionTypeFor(action, actionData.type || item.actionType);
    var resolvedCommandId = commandIdFor(action);
    var savedCommandId = action ? savedCommandIdFor(actionData)
      : savedCommandIdFor({ commandId: actionData.commandId });
    var savedVersion = String(actionData.registryVersion || item.registryVersion || '');
    var resolvedVersion = registryVersionFor(action);
    var versionChanged = !!(savedVersion && resolvedVersion &&
      savedVersion !== resolvedVersion);
    var commandIdMismatch = !!(action && savedCommandId != null &&
      resolvedCommandId != null && savedCommandId !== resolvedCommandId &&
      !versionChanged);
    var commandId = !action ? savedCommandId
      : commandIdMismatch ? savedCommandId : resolvedCommandId;
    var savedCommandActionId = trim(actionData.commandActionId ||
      item.commandActionId || '');
    var resolvedCommandActionId = commandActionIdFor(action);
    var commandActionMismatch = !!(action && savedCommandActionId &&
      resolvedCommandActionId && savedCommandActionId !== resolvedCommandActionId);
    var commandNameMismatch = !!(action && commandName &&
      resolvedCommandName && !sameIdentity(commandName, resolvedCommandName));
    var menuPathMismatch = !!(action && menuPath &&
      resolvedMenuPath && !sameIdentity(menuPath, resolvedMenuPath));
    var commandIdSource = action
      ? action.commandIdSource ||
        action.commandRequest && action.commandRequest.commandIdSource || null
      : actionData.commandIdSource || null;
    var validAction = isVerifiedAeCommand(action);
    var route = routeForAction(actionId, action);
    var enabled = !!(validAction && actionId && route === 'host-command' &&
      !commandIdMismatch && !commandActionMismatch && !commandNameMismatch &&
      !menuPathMismatch &&
      item.status !== 'disabled');
    var commandChord = enabled
      ? action.activeChord || action.canonicalRecord &&
        action.canonicalRecord.activeChord || ''
      : '';
    var shortcut = null;
    if (commandChord) {
      try {
        shortcut = shortcutRecord(cleanHotkey(commandChord));
        if (shortcut && action.displayChord) {
          shortcut.display = formatShortcutForDisplay(action.displayChord);
        }
      }
      catch (shortcutError) {
        if (R.log) R.log.warn('The active AE command chord could not be displayed.', {
          actionId: actionId,
          chord: commandChord,
          error: shortcutError
        });
      }
    }
    var slotValue = hasOwn(item, 'pinnedSlot') ? item.pinnedSlot
      : hasOwn(item, 'slot') ? item.slot
        : hasOwn(item, 'pinnedPosition') ? item.pinnedPosition
          : hasOwn(item, 'position') ? item.position : undefined;
    var slot = normalizePosition(slotValue, index, usedSlots);
    if (originalPinId !== pinId && R.log) {
      R.log.info('Migrated a sample Shortcut Pad pin.', {
        previousPinId: originalPinId,
        pinId: pinId,
        actionId: actionId || null,
        commandName: commandName,
        menuPath: menuPath
      });
    }
    if (!enabled && R.log) {
      R.log.warn('Shortcut Pad pin has no resolvable action and will be unavailable.', {
        pinId: pinId,
        actionId: actionId || null,
        commandId: commandId,
        commandName: commandName,
        menuPath: menuPath,
        route: route
      });
    }
    var canonicalAction = {
      type: type,
      actionId: actionId,
      commandActionId: commandActionMismatch ? savedCommandActionId
        : resolvedCommandActionId || savedCommandActionId,
      commandId: commandId,
      commandIdSource: commandIdSource,
      commandName: commandName,
      menuPath: menuPath,
      registryVersion: resolvedVersion || savedVersion
    };
    return {
      id: pinId,
      pinId: pinId,
      slot: slot,
      displayName: displayName,
      action: canonicalAction,
      actionType: type,
      commandId: commandId,
      commandName: commandName,
      menuPath: menuPath,
      registryVersion: resolvedVersion || savedVersion,
      enabled: enabled,
      status: enabled ? 'ready' : item.status === 'disabled' ? 'disabled' : 'unavailable',
      unavailableReason: enabled ? '' : action
        ? commandIdMismatch ? 'The saved command ID does not match the current AE registry.'
          : commandActionMismatch ? 'The saved command identity does not match the current AE registry.'
            : commandNameMismatch ? 'The saved command name does not match the current AE registry.'
              : menuPathMismatch ? 'The saved menu path does not match the current AE registry.'
            : item.status === 'disabled' ? 'This shortcut pin is disabled.'
              : !validAction || route !== 'host-command'
                ? 'A verified After Effects command ID is unavailable.'
                : 'The action has no safe execution route.'
        : 'The saved action could not be resolved in the current AE action registry.',
      shortcut: shortcut,
      shortcutOverride: null,
      actionId: actionId.slice(0, 256),
      label: displayName,
      hotkey: null,
      pinnedSlot: slot
    };
  }

  function normalizeAll(items, pinIdMigrations) {
    var usedSlots = Object.create(null);
    var seen = Object.create(null);
    var pads = [];
    items.forEach(function (item, index) {
      var pad = normalize(item, index, usedSlots, seen);
      if (!pad || seen[pad.id]) {
        if (R.log) R.log.warn('An invalid or duplicate saved Shortcut was ignored.');
        return;
      }
      var oldId = item && (item.pinId || item.id || item.padId);
      if (pinIdMigrations && oldId && oldId !== pad.pinId) {
        pinIdMigrations[String(oldId)] = pad.pinId;
      }
      seen[pad.id] = true;
      pads.push(pad);
    });
    return pads;
  }

  function stableList(pads) {
    return pads.map(function (pad) {
      return {
        pinId: pad.pinId || pad.id,
        slot: pad.slot == null ? pad.pinnedSlot : pad.slot,
        displayName: pad.displayName || pad.label,
        enabled: pad.enabled === true,
        action: {
          type: pad.actionType || pad.action && pad.action.type || 'script',
          actionId: pad.actionId || pad.action && pad.action.actionId || '',
          commandActionId: pad.action && pad.action.commandActionId || '',
          commandId: pad.commandId == null ? pad.action && pad.action.commandId || null : pad.commandId,
          commandIdSource: pad.action && pad.action.commandIdSource || null,
          commandName: pad.commandName || pad.action && pad.action.commandName || '',
          menuPath: pad.menuPath || pad.action && pad.action.menuPath || '',
          registryVersion: pad.registryVersion ||
            pad.action && pad.action.registryVersion || ''
        },
        aeShortcutDisplay: pad.shortcut && pad.shortcut.display || '',
        status: pad.status || (pad.enabled ? 'ready' : 'unavailable'),
        unavailableReason: pad.enabled ? '' : pad.unavailableReason || 'Action unavailable.',
        shortcut: pad.shortcut || null
      };
    });
  }

  function clonePin(pad) {
    return {
      id: pad.id,
      pinId: pad.pinId || pad.id,
      slot: pad.slot == null ? pad.pinnedSlot : pad.slot,
      displayName: pad.displayName || pad.label,
      action: {
        type: pad.actionType || pad.action && pad.action.type || 'script',
        actionId: pad.actionId || pad.action && pad.action.actionId || '',
        commandActionId: pad.action && pad.action.commandActionId || '',
        commandId: pad.commandId == null ? pad.action && pad.action.commandId || null : pad.commandId,
        commandIdSource: pad.action && pad.action.commandIdSource || null,
        commandName: pad.commandName || pad.action && pad.action.commandName || '',
        menuPath: pad.menuPath || pad.action && pad.action.menuPath || '',
        registryVersion: pad.registryVersion ||
          pad.action && pad.action.registryVersion || ''
      },
      actionType: pad.actionType || pad.action && pad.action.type || 'script',
      commandId: pad.commandId == null ? pad.action && pad.action.commandId || null : pad.commandId,
      commandIdSource: pad.action && pad.action.commandIdSource || null,
      commandName: pad.commandName || pad.action && pad.action.commandName || '',
      menuPath: pad.menuPath || pad.action && pad.action.menuPath || '',
      registryVersion: pad.registryVersion || pad.action && pad.action.registryVersion || '',
      enabled: pad.enabled === true,
      status: pad.status || (pad.enabled ? 'ready' : 'unavailable'),
      unavailableReason: pad.unavailableReason || '',
      shortcut: pad.shortcut && {
        modifiers: pad.shortcut.modifiers ? pad.shortcut.modifiers.slice() : [],
        key: pad.shortcut.key,
        display: pad.shortcut.display
      },
      shortcutOverride: null,
      label: pad.displayName || pad.label,
      actionId: pad.actionId || pad.action && pad.action.actionId || '',
      hotkey: null,
      pinnedSlot: pad.slot == null ? pad.pinnedSlot : pad.slot
    };
  }

  function read() {
    if (cachedPads !== null) return cachedPads.map(clonePin);
    var saved = R.disk.read(KEY, null);
    if (saved == null) {
      var initial = defaultPins();
      if (initial.length) return write(initial).map(clonePin);
      cachedPads = [];
      return [];
    }
    if (!Array.isArray(saved)) {
      throw new Error('Saved shortcuts could not be loaded. Reset the Shortcut Pad to continue.');
    }
    var pinIdMigrations = Object.create(null);
    var pads = normalizeAll(saved, pinIdMigrations);
    if (JSON.stringify(stableList(pads)) !== JSON.stringify(saved)) {
      var migrated = write(pads);
      if (R.globalHotkeys && R.globalHotkeys.migratePinBindings &&
          Object.keys(pinIdMigrations).length) {
        R.globalHotkeys.migratePinBindings(pinIdMigrations);
      }
      return migrated.map(clonePin);
    }
    cachedPads = pads.map(clonePin);
    return cachedPads.map(clonePin);
  }

  function write(pads) {
    var normalized = normalizeAll(pads);
    var writer = R.disk.writeAtomic || R.disk.write;
    if (!writer.call(R.disk, KEY, stableList(normalized))) {
      throw new Error('Could not save your shortcuts.');
    }
    cachedPads = normalized.map(clonePin);
    return cachedPads.map(clonePin);
  }

  function replaceAll(items) {
    if (!Array.isArray(items)) throw new Error('Shortcut Pad changes are invalid.');
    var requestedSlots = Object.create(null);
    items.forEach(function (item) {
      if (!item) return;
      var rawSlot = hasOwn(item, 'pinnedSlot') ? item.pinnedSlot : item.slot;
      if (rawSlot == null) return;
      var requestedSlot = Number(rawSlot);
      if (Math.floor(requestedSlot) !== requestedSlot || requestedSlot < 0 ||
          requestedSlot >= SLOT_COUNT) {
        throw new Error('Choose one of the 36 Shortcut Pad slots.');
      }
      if (requestedSlots[requestedSlot]) {
        throw new Error('Shortcut Pad changes contain a duplicate slot.');
      }
      requestedSlots[requestedSlot] = true;
    });
    var normalized = normalizeAll(items);
    if (normalized.length !== items.length) {
      throw new Error('Shortcut Pad changes contain an invalid or duplicate shortcut.');
    }
    var ids = Object.create(null);
    var slots = Object.create(null);
    normalized.forEach(function (pad) {
      if (ids[pad.id]) throw new Error('Shortcut Pad changes contain a duplicate shortcut.');
      ids[pad.id] = true;
      if (pad.pinnedSlot != null && slots[pad.pinnedSlot]) {
        throw new Error('Shortcut Pad changes contain a duplicate slot.');
      }
      if (pad.pinnedSlot != null) slots[pad.pinnedSlot] = true;
    });
    return sorted(write(normalized));
  }

  function defaultPins() {
    var entries = R.afterEffectsShortcuts && R.afterEffectsShortcuts.catalogEntries
      ? R.afterEffectsShortcuts.catalogEntries() : [];
    var seen = {};
    var candidates = entries.filter(function (entry) {
      if (!entry || !entry.actionId || !entry.label ||
          entry.deliveryRoute !== 'host-command' || seen[entry.actionId]) return false;
      var action = actionForId(entry.actionId);
      if (!isVerifiedAeCommand(action) || (R.actionRouter && R.actionRouter.selectRoute &&
          R.actionRouter.selectRoute(action) !== 'host-command')) return false;
      seen[entry.actionId] = true;
      return true;
    }).slice(0, DEFAULT_PIN_COUNT);
    return candidates.map(function (entry, index) {
      return {
        id: 'pin-default-' + encodeURIComponent(entry.actionId).slice(0, 112),
        label: cleanLabel(entry.label, entry, 'Shortcut'),
        actionId: entry.actionId,
        hotkey: null,
        pinnedSlot: index
      };
    });
  }

  function sorted(pads) {
    return pads.slice().sort(function (left, right) {
      var leftSlot = left.pinnedSlot == null ? SLOT_COUNT : left.pinnedSlot;
      var rightSlot = right.pinnedSlot == null ? SLOT_COUNT : right.pinnedSlot;
      return leftSlot - rightSlot;
    });
  }

  function all() {
    return sorted(read());
  }

  function byId(id) {
    var pads = read();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i].id === id) return pads[i];
    }
    return null;
  }

  function atSlot(slot) {
    var pads = read();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i].pinnedSlot === slot) return pads[i];
    }
    return null;
  }

  function firstEmptySlot(pads) {
    pads = pads || read();
    var occupied = {};
    pads.forEach(function (pad) {
      if (pad.pinnedSlot != null) occupied[pad.pinnedSlot] = true;
    });
    for (var slot = 0; slot < SLOT_COUNT; slot++) {
      if (!occupied[slot]) return slot;
    }
    return null;
  }

  function effectiveChord(pad) {
    if (!pad || !pad.enabled) return '';
    var action = actionForId(pad.actionId);
    if (!isVerifiedAeCommand(action) ||
        Number(pad.commandId) !== action.commandId ||
        !sameIdentity(pad.commandName, action.commandName || action.label) ||
        !sameIdentity(pad.menuPath, menuPathFor(action, action.commandName || action.label))) {
      return '';
    }
    return action && action.activeChord ||
      action && action.canonicalRecord && action.canonicalRecord.activeChord || '';
  }

  function displayChord(pad) {
    var chord = effectiveChord(pad);
    if (!chord) return '';
    var action = actionForId(pad && pad.actionId);
    return action && action.displayChord
      ? formatShortcutForDisplay(action.displayChord)
      : formatShortcutForDisplay(chord);
  }

  function resolve(pad) {
    if (!pad) return { enabled: false, label: 'Shortcut', chord: '' };
    var action = actionForId(pad.actionId);
    var route = routeForAction(pad.actionId, action);
    var currentName = action && (action.commandName || action.label) || '';
    var currentPath = action && menuPathFor(action, currentName) || '';
    var enabled = !!(action && pad.enabled && isVerifiedAeCommand(action) &&
      route === 'host-command' &&
      Number(pad.commandId) === action.commandId &&
      sameIdentity(pad.commandName, currentName) &&
      sameIdentity(pad.menuPath, currentPath));
    return {
      enabled: enabled,
      label: cleanLabel(pad.label, action, 'Shortcut'),
      displayName: pad.displayName || pad.label,
      chord: enabled ? displayChord(pad) : '',
      activeChord: enabled ? effectiveChord(pad) : '',
      category: action && (action.workflowCategory || action.category || action.group) || '',
      route: route,
      action: action,
      actionType: pad.actionType,
      commandId: pad.commandId,
      commandIdSource: pad.commandIdSource,
      commandName: pad.commandName,
      menuPath: pad.menuPath,
      status: enabled ? 'ready' : pad.status === 'disabled' ? 'disabled' : 'unavailable',
      unavailableReason: pad.unavailableReason ||
        (enabled ? '' : 'Action unavailable. Edit this pin to repair it.')
    };
  }

  function resolvePin(pinId) {
    var pin = byId(pinId);
    return pin ? { pin: pin, resolution: resolve(pin) } : null;
  }

  function markUnavailable(pinId, reason) {
    var pads = read();
    var pin = null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i].id === pinId) {
        pin = pads[i];
        break;
      }
    }
    if (!pin) return false;
    pin.enabled = false;
    pin.status = 'unavailable';
    pin.unavailableReason = String(reason || 'The action could not be resolved.');
    cachedPads = pads.map(clonePin);
    if (R.bus) R.bus.emit('ae-shortcut-pads:updated');
    return clonePin(pin);
  }

  function validateAll() {
    return all().map(function (pad) {
      return { pin: pad, resolution: resolve(pad) };
    });
  }

  function nextId() {
    return 'pin-' + Date.now().toString(36) + '-' + (++sequence).toString(36) +
      '-' + Math.floor(Math.random() * 0x100000000).toString(16);
  }

  function add(label, options) {
    options = options || {};
    var name = cleanLabel(label, null, '');
    if (!trim(label)) throw new Error('Enter a name for this shortcut.');
    var actionId = typeof options.actionId === 'string' ? trim(options.actionId) : '';
    var action = actionForId(actionId);
    if (!actionId || !isVerifiedAeCommand(action)) {
      throw new Error('Choose an available After Effects command with a verified numeric command ID.');
    }
    name = cleanLabel(label, action, '');
    var pads = read();
    var requestedSlot = hasOwn(options, 'pinnedSlot')
      ? options.pinnedSlot : firstEmptySlot(pads);
    if (requestedSlot != null &&
        (Math.floor(Number(requestedSlot)) !== Number(requestedSlot) ||
         Number(requestedSlot) < 0 || Number(requestedSlot) >= SLOT_COUNT)) {
    throw new Error('Choose one of the 36 Shortcut Pad slots.');
    }
    var pad = {
      id: nextId(),
      pinId: '',
      label: name,
      actionId: actionId.slice(0, 256),
      hotkey: null,
      pinnedSlot: requestedSlot == null ? null : Number(requestedSlot)
    };
    pad.pinId = pad.id;
    pads.push(pad);
    var saved = write(pads);
    for (var i = 0; i < saved.length; i++) {
      if (saved[i].id === pad.id) return saved[i];
    }
    throw new Error('The pin was written but could not be resolved afterward.');
  }

  function update(id, changes) {
    changes = changes || {};
    var pads = read();
    var found = false;
    var next = pads.map(function (pad) {
      if (pad.id !== id) return pad;
      found = true;
      var actionId = hasOwn(changes, 'actionId')
        ? trim(changes.actionId) : pad.actionId;
      var action = actionForId(actionId);
      if (actionId && !isVerifiedAeCommand(action)) {
        throw new Error('Choose an available After Effects command with a verified numeric command ID.');
      }
      var label = hasOwn(changes, 'label')
        ? cleanLabel(changes.label, action, '') : pad.label;
      if (!label) throw new Error('Enter a name for this shortcut.');
      var pinnedSlot = hasOwn(changes, 'pinnedSlot')
        ? changes.pinnedSlot : pad.pinnedSlot;
      return {
        id: pad.id,
        label: label,
        actionId: actionId.slice(0, 256),
        hotkey: null,
        pinnedSlot: pinnedSlot
      };
    });
    if (!found) return false;
    write(next);
    return true;
  }

  function pinAt(id, slot) {
    slot = Number(slot);
    if (Math.floor(slot) !== slot || slot < 0 || slot >= SLOT_COUNT) {
      throw new Error('Choose one of the 36 Shortcut Pad slots.');
    }
    var pads = read();
    var target = null;
    var occupied = null;
    pads.forEach(function (pad) {
      if (pad.id === id) target = pad;
      else if (pad.pinnedSlot === slot) occupied = pad;
    });
    if (!target) return false;
    if (target.pinnedSlot === slot) return target;
    var previousSlot = target.pinnedSlot;
    target.pinnedSlot = slot;
    if (occupied) occupied.pinnedSlot = previousSlot == null ? null : previousSlot;
    write(pads);
    return byId(id);
  }

  function replaceAt(id, slot) {
    slot = Number(slot);
    if (Math.floor(slot) !== slot || slot < 0 || slot >= SLOT_COUNT) {
      throw new Error('Choose one of the 36 Shortcut Pad slots.');
    }
    var pads = read();
    var target = null;
    pads.forEach(function (pad) {
      if (pad.id === id) target = pad;
    });
    if (!target) return false;
    pads.forEach(function (pad) {
      if (pad.pinnedSlot === slot && pad.id !== id) pad.pinnedSlot = null;
    });
    target.pinnedSlot = slot;
    write(pads);
    return byId(id);
  }

  function move(id, offset) {
    if (offset !== -1 && offset !== 1) {
      throw new Error('Shortcuts can move one slot at a time.');
    }
    var pad = byId(id);
    if (!pad || pad.pinnedSlot == null) return false;
    var target = pad.pinnedSlot + offset;
    if (target < 0 || target >= SLOT_COUNT) return false;
    return !!pinAt(id, target);
  }

  function clearFromPad(id) {
    return update(id, { pinnedSlot: null });
  }

  function remove(id) {
    var pads = read();
    var next = pads.filter(function (pad) { return pad.id !== id; });
    if (next.length === pads.length) return false;
    write(next);
    return true;
  }

  function resetPins() {
    var pads = read().map(function (pad) {
      return {
        id: pad.id,
        label: pad.label,
        actionId: pad.actionId,
        hotkey: pad.hotkey,
        pinnedSlot: null
      };
    });
    var defaults = defaultPins();
    defaults.forEach(function (item, index) {
      var existing = pads.filter(function (pad) {
        return pad.actionId === item.actionId;
      })[0];
      if (existing) {
        existing.label = item.label;
        existing.pinnedSlot = index;
      } else {
        pads.push(item);
      }
    });
    write(pads);
    return all();
  }

  function fixedColumns(value) {
    if (value != null && Number(value) !== 6) {
      throw new Error('The Compact Shortcut Pad uses a fixed 6 × 6 grid.');
    }
    return 6;
  }

  R.shortcutPads = {
    all: all,
    byId: byId,
    atSlot: atSlot,
    firstEmptySlot: firstEmptySlot,
    effectiveChord: effectiveChord,
    displayChord: displayChord,
    formatShortcutForDisplay: formatShortcutForDisplay,
    normalizeHotkey: cleanHotkey,
    hotkeyChord: hotkeyChord,
    displayHotkey: displayHotkey,
    resolve: resolve,
    resolvePin: resolvePin,
    markUnavailable: markUnavailable,
    refreshActionCache: function () {
      actionCache = {};
      routeCache = {};
    },
    invalidateActionCache: function () {
      actionCache = {};
      routeCache = {};
    },
    actionForId: actionForId,
    validateAll: validateAll,
    refresh: function () {
      invalidateCaches();
      return all();
    },
    add: add,
    update: update,
    replaceAll: replaceAll,
    pinAt: pinAt,
    replaceAt: replaceAt,
    move: move,
    clearFromPad: clearFromPad,
    remove: remove,
    reset: resetPins,
    columns: function () { return 6; },
    setColumns: fixedColumns,
    slotCount: function () { return SLOT_COUNT; }
  };

  if (R.bus && R.bus.on) {
    R.bus.on('ae-shortcut-map:updated', invalidateCaches);
    R.bus.on('ae-shortcut-runtime-commands:updated', invalidateCaches);
    R.bus.on('ae-shortcut-pads:updated', function () {
      actionCache = {};
      routeCache = {};
    });
  }
})(window.Rebound = window.Rebound || {});
