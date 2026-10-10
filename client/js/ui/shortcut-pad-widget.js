/*
 * The focused Home Shortcut Pad and its small, in-context library sheets.
 */
;(function (R) {
  'use strict';

  var el = R.dom.el;
  var SLOT_COUNT = 36;
  var MAPPING_MESSAGE = 'Mapping unavailable — assign an action or check AE keymap.';

  function mount(ctx) {
    var padApi = ctx.shortcutPads || (R.shell && R.shell.shortcutPads);
    var host = ctx.body;
    var shortcutPad = {
      mode: 'normal',
      selectedSlot: null,
      dirty: false,
      saving: false,
      savedPads: [],
      pendingPads: [],
      repairOnly: false,
      showAllSlots: false
    };
    var resizeObserver = null;
    var renderQueued = false;
    var lastContentHeight = -1;
    var dataError = '';
    var actionOptionsCache = null;
    var libraryItemsCache = null;
    var disposed = false;
    var dragId = '';
    var ignoreNextClick = false;

    var root = el('div.rb-shortcut-pad-widget');
    var title = el('span.rb-shortcut-pad-title', { text: 'Shortcut Pad' });
    var doneButton = el('button.rb-shortcut-pad-done', {
      type: 'button',
      hidden: true,
      onclick: leaveEditPinsMode
    }, ['Done']);
    var repairNotice = el('button.rb-shortcut-pad-repair-notice', {
      type: 'button',
      hidden: true,
      onclick: function () {
        try {
          enterEditPinsMode(true);
        } catch (error) {
          toast(error.message || 'Could not open pins that need repair.', 'error');
        }
      }
    });
    var addButton = el('button.rb-shortcut-pad-add-full', {
      type: 'button',
      title: 'Add shortcut',
      onclick: function () { openAddSheet(null, null); }
    }, ['+ Add']);
    var slotsToggle = el('button.rb-shortcut-pad-slots-toggle', {
      type: 'button',
      hidden: true,
      onclick: function () {
        shortcutPad.showAllSlots = !shortcutPad.showAllSlots;
        render();
      }
    });
    var searchButton = el('button.rb-shortcut-pad-tool', {
      type: 'button',
      title: 'Search shortcuts',
      'aria-label': 'Search shortcuts',
      onclick: function () { openLibrarySheet('Search Shortcuts'); }
    });
    searchButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>';
    var menuButton = el('button.rb-shortcut-pad-tool', {
      type: 'button',
      title: 'Shortcut Pad menu',
      'aria-label': 'Shortcut Pad menu',
      onclick: openMenu
    });
    menuButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
    var header = el('div.rb-shortcut-pad-header', null, [
      title,
      el('div.rb-shortcut-pad-tools', null, [
        repairNotice, slotsToggle, addButton, searchButton, menuButton, doneButton
      ])
    ]);
    var grid = el('div.rb-shortcut-pad-grid', {
      role: 'group',
      'aria-label': 'Shortcut Pad'
    });
    root.appendChild(header);
    root.appendChild(grid);
    host.style.overflow = 'hidden';
    host.style.padding = '0';
    host.appendChild(root);

    function toast(message, kind) {
      if (message && ctx.toast) ctx.toast(message, { kind: kind || 'info' });
    }

    function readShortcuts() {
      if (!R.shortcutPads || !R.shortcutPads.all) {
        throw new Error('The Shortcut Library is unavailable.');
      }
      return R.shortcutPads.all();
    }

    function clonePads(pads) {
      return pads.map(function (pad) {
        return {
          id: pad.id,
          pinId: pad.pinId || pad.id,
          label: pad.label,
          displayName: pad.displayName || pad.label,
          actionId: pad.actionId,
          action: pad.action,
          actionType: pad.actionType,
          commandId: pad.commandId,
          commandIdSource: pad.commandIdSource,
          commandName: pad.commandName,
          menuPath: pad.menuPath,
          enabled: pad.enabled,
          status: pad.status,
          unavailableReason: pad.unavailableReason,
          hotkey: pad.hotkey && {
            ctrl: pad.hotkey.ctrl,
            alt: pad.hotkey.alt,
            shift: pad.hotkey.shift,
            win: pad.hotkey.win,
            key: pad.hotkey.key,
            display: pad.hotkey.display
          },
          pinnedSlot: pad.pinnedSlot
        };
      });
    }

    function isEditing() {
      return shortcutPad.mode === 'editing';
    }

    function padsForRender() {
      return isEditing() ? shortcutPad.pendingPads : readShortcuts();
    }

    function actionForId(actionId) {
      if (!actionId) return null;
      if (R.actionRouter && R.actionRouter.resolveAction) {
        return R.actionRouter.resolveAction(actionId);
      }
      return R.shortcutPads && R.shortcutPads.actionForId
        ? R.shortcutPads.actionForId(actionId) : null;
    }

    function displayChord(chord) {
      if (!chord) return '';
      return R.shortcutPads && R.shortcutPads.formatShortcutForDisplay
        ? R.shortcutPads.formatShortcutForDisplay(chord)
        : R.aeShortcutMap && R.aeShortcutMap.formatShortcutForDisplay
          ? R.aeShortcutMap.formatShortcutForDisplay(chord) : chord;
    }

    function chordFor(pad) {
      if (!pad) return '';
      if (R.shortcutPads && R.shortcutPads.displayChord) {
        return R.shortcutPads.displayChord(pad);
      }
      return displayChord(pad.hotkey || '');
    }

    function activeActionChord(action) {
      if (!action) return '';
      if (action.displayChord) return action.displayChord;
      var chord = action.activeChord ||
        action.canonicalRecord && action.canonicalRecord.activeChord ||
        action.displayChord || '';
      return displayChord(chord);
    }

    function displayLabelFor(pad) {
      var commandName = String(pad && pad.commandName || pad && pad.label || 'Shortcut');
      var displayName = String(pad && pad.displayName || pad && pad.label || '').replace(/^\s+|\s+$/g, '');
      var normalizedCommand = commandName.toLowerCase();
      var normalizedDisplay = displayName.toLowerCase();
      return normalizedDisplay && (normalizedCommand === normalizedDisplay ||
        normalizedCommand.indexOf(normalizedDisplay + ' ') === 0)
        ? displayName : commandName;
    }

    function render() {
      if (disposed) return;
      var pads;
      try {
        pads = padsForRender();
        dataError = '';
      } catch (error) {
        pads = [];
        if (dataError !== error.message) {
          dataError = error.message || 'Could not load your shortcuts.';
          toast(dataError, 'error');
        }
      }
      var pinnedPads = [];
      var bySlot = Object.create(null);
      var broken = [];
      var brokenReasons = Object.create(null);
      var seenActions = Object.create(null);
      pads.forEach(function (pad) {
        if (pad.pinnedSlot == null) return;
        bySlot[pad.pinnedSlot] = pad;
        var duplicateAction = isRunnablePin(pad) && seenActions[pad.actionId];
        if (isRunnablePin(pad) && !duplicateAction) {
          pinnedPads.push(pad);
          seenActions[pad.actionId] = true;
        } else {
          broken.push(pad);
          brokenReasons[pad.id] = duplicateAction
            ? 'Another pin already represents this AE command.'
            : pad.unavailableReason || 'The AE command ID is unavailable.';
        }
      });
      pinnedPads.sort(function (left, right) {
        return left.pinnedSlot - right.pinnedSlot;
      });
      broken.sort(function (left, right) {
        return left.pinnedSlot - right.pinnedSlot;
      });
      root.classList.toggle('is-editing', isEditing());
      root.classList.toggle('is-repair-filtered', !!shortcutPad.repairOnly);
      root.classList.toggle('is-empty', !isEditing() && pinnedPads.length === 0 &&
        broken.length === 0);
      repairNotice.hidden = isEditing() || broken.length === 0;
      repairNotice.textContent = broken.length + ' shortcut' +
        (broken.length === 1 ? ' needs repair' : 's need repair');
      var firstEmptySlot = padApi.firstEmptySlot();
      addButton.hidden = isEditing();
      addButton.disabled = firstEmptySlot == null;
      addButton.title = firstEmptySlot == null
        ? 'The Shortcut Pad is full (36 slots)' : 'Add shortcut';
      searchButton.hidden = isEditing();
      menuButton.hidden = isEditing();
      doneButton.hidden = !isEditing();
      slotsToggle.hidden = !isEditing() || shortcutPad.repairOnly;
      slotsToggle.textContent = shortcutPad.showAllSlots
        ? 'Compact view' : 'Show all 36 slots';
      R.dom.clear(grid);
      if (!isEditing()) {
        if (pinnedPads.length === 0 && broken.length === 0) {
          grid.appendChild(renderEmptyState());
        } else {
          // Packed top-left, no reserved coordinates, no trailing Add cell.
          pinnedPads.forEach(function (pad) {
            grid.appendChild(renderSlot(pad.pinnedSlot, pad));
          });
        }
      } else if (shortcutPad.repairOnly) {
        broken.forEach(function (pad) {
          grid.appendChild(renderSlot(pad.pinnedSlot, pad, brokenReasons[pad.id]));
        });
      } else if (shortcutPad.showAllSlots) {
        for (var editSlot = 0; editSlot < SLOT_COUNT; editSlot++) {
          var editPad = bySlot[editSlot] || null;
          grid.appendChild(renderSlot(editSlot, editPad,
            editPad && brokenReasons[editPad.id]));
        }
      } else {
        // Compact edit view: populated pins (valid or needing repair) in slot
        // order, plus at most one trailing Add tile.
        var editPads = pads.filter(function (pad) {
          return pad.pinnedSlot != null;
        }).sort(function (left, right) { return left.pinnedSlot - right.pinnedSlot; });
        editPads.forEach(function (pad) {
          grid.appendChild(renderSlot(pad.pinnedSlot, pad, brokenReasons[pad.id]));
        });
        if (firstEmptySlot != null) grid.appendChild(renderSlot(firstEmptySlot, null));
      }
      scheduleFit();
    }

    function renderEmptyState() {
      return el('div.rb-shortcut-pad-empty', null, [
        el('p.rb-shortcut-pad-empty-title', { text: 'No shortcuts on this pad yet' }),
        el('button.rb-shortcut-pad-empty-cta', {
          type: 'button',
          onclick: function () { openAddSheet(null, null); }
        }, ['Add your first shortcut'])
      ]);
    }

    function isRunnablePin(pad) {
      if (!pad || pad.enabled !== true || pad.actionType !== 'ae-command' ||
          typeof pad.commandId !== 'number' || !isFinite(pad.commandId) ||
          pad.commandId <= 0 ||
          pad.commandIdSource !== 'verified-host-probe') return false;
      var resolution = R.shortcutPads && R.shortcutPads.resolve
        ? R.shortcutPads.resolve(pad) : null;
      return !!(resolution && resolution.enabled === true &&
        resolution.route === 'host-command' &&
        resolution.commandId === pad.commandId);
    }

    function updateEditPinsDirty() {
      var savedById = {};
      shortcutPad.savedPads.forEach(function (pad) {
        savedById[pad.id] = pad.pinnedSlot;
      });
      shortcutPad.dirty = shortcutPad.savedPads.length !== shortcutPad.pendingPads.length ||
        shortcutPad.pendingPads.some(function (pad) {
        return !Object.prototype.hasOwnProperty.call(savedById, pad.id) ||
          savedById[pad.id] !== pad.pinnedSlot;
      });
    }

    function enterEditPinsMode(repairOnly) {
      var saved = clonePads(readShortcuts());
      shortcutPad.mode = 'editing';
      shortcutPad.repairOnly = repairOnly === true;
      shortcutPad.selectedSlot = null;
      shortcutPad.savedPads = clonePads(saved);
      shortcutPad.pendingPads = clonePads(saved);
      shortcutPad.dirty = false;
      render();
    }

    function leaveEditPinsMode() {
      if (shortcutPad.saving) return;
      if (!shortcutPad.dirty) {
        shortcutPad.mode = 'normal';
        shortcutPad.repairOnly = false;
        shortcutPad.showAllSlots = false;
        shortcutPad.selectedSlot = null;
        shortcutPad.savedPads = [];
        shortcutPad.pendingPads = [];
        render();
        return;
      }
      openDoneConfirmation();
    }

    function stagePinAt(id, slot) {
      slot = Number(slot);
      if (Math.floor(slot) !== slot || slot < 0 || slot >= SLOT_COUNT) {
        throw new Error('Choose one of the 36 Shortcut Pad slots.');
      }
      var target = null;
      var occupied = null;
      shortcutPad.pendingPads.forEach(function (pad) {
        if (pad.id === id) target = pad;
        else if (pad.pinnedSlot === slot) occupied = pad;
      });
      if (!target) return false;
      if (target.pinnedSlot === slot) return target;
      var previousSlot = target.pinnedSlot;
      target.pinnedSlot = slot;
      if (occupied) occupied.pinnedSlot = previousSlot == null ? null : previousSlot;
      shortcutPad.selectedSlot = slot;
      updateEditPinsDirty();
      render();
      return target;
    }

    function stageClearPin(id) {
      var target = shortcutPad.pendingPads.filter(function (pad) {
        return pad.id === id;
      })[0];
      if (!target || target.pinnedSlot == null) return false;
      target.pinnedSlot = null;
      shortcutPad.selectedSlot = null;
      updateEditPinsDirty();
      render();
      return true;
    }

    function updateSavedPin() {
      if (!isEditing()) return;
      var saved = clonePads(readShortcuts());
      var stagedSlots = Object.create(null);
      shortcutPad.pendingPads.forEach(function (item) {
        stagedSlots[item.id] = item.pinnedSlot;
      });
      shortcutPad.savedPads = clonePads(saved);
      shortcutPad.pendingPads = saved.map(function (item) {
        var pending = clonePads([item])[0];
        if (Object.prototype.hasOwnProperty.call(stagedSlots, item.id)) {
          pending.pinnedSlot = stagedSlots[item.id];
        }
        return pending;
      });
      updateEditPinsDirty();
    }

    function persistPendingSlots() {
      var current = clonePads(readShortcuts());
      var pendingById = {};
      shortcutPad.pendingPads.forEach(function (pad) { pendingById[pad.id] = pad; });
      current.forEach(function (pad) {
        if (Object.prototype.hasOwnProperty.call(pendingById, pad.id)) {
          pad.pinnedSlot = pendingById[pad.id].pinnedSlot;
        }
      });
      return padApi.replaceAll(current);
    }

    function renderSlot(slot, pad, repairReason) {
      var label = pad
        ? displayLabelFor(pad)
        : 'Add shortcut';
      var chord = pad ? chordFor(pad) : '';
      var resolution = pad && R.shortcutPads.resolve
        ? R.shortcutPads.resolve(pad) : null;
      var unavailable = !!(pad && (repairReason || !pad.enabled ||
        resolution && !resolution.enabled));
      var titleLines = [label];
      if (pad && (pad.menuPath || resolution && resolution.action &&
          resolution.action.label)) {
        titleLines.push(pad.menuPath || resolution.action.label);
      }
      if (chord) titleLines.push(chord);
      if (unavailable) {
        titleLines.push('Action unavailable: ' +
          (repairReason || pad.unavailableReason || MAPPING_MESSAGE));
      }
      var accessibleName = titleLines.filter(Boolean).join(', ');
      var runStatus = el('span.rb-shortcut-pad-run-status', {
        'aria-live': 'polite',
        hidden: true
      });
      var cell = el('button.rb-shortcut-pad-cell' +
        (pad ? '' : '.is-empty') +
        (isEditing() ? '.is-editing' : '') +
        (shortcutPad.selectedSlot === slot ? '.is-selected' : ''), {
        type: 'button',
        draggable: !!(isEditing() && pad),
        tabindex: '0',
        'aria-label': accessibleName,
        title: titleLines.join('\n'),
        'data-slot': slot == null ? '' : String(slot),
        onclick: function (event) {
          // The click that ends a drag is swallowed by state, not by
          // stopping the event: this is pointer input, never keyboard input.
          if (ignoreNextClick) {
            ignoreNextClick = false;
            return;
          }
          if (!pad) {
            openAddSheet(null, isEditing() ? slot : null);
          } else if (isEditing()) {
            shortcutPad.selectedSlot = slot;
            openPinEditor(pad, slot);
          } else if (unavailable) {
            openPinEditor(pad, slot);
          } else {
            runPad(pad, cell);
          }
        }
      });
      if (pad) {
        cell.appendChild(el('span.rb-shortcut-pad-label', {
          text: label
        }));
        if (chord && !unavailable) {
          cell.appendChild(el('span.rb-shortcut-pad-chord', { text: chord }));
        }
        if (unavailable) {
          cell.appendChild(el('span.rb-shortcut-pad-unavailable', {
            text: repairReason && /Another pin/.test(repairReason)
              ? 'Duplicate action' : 'Needs repair'
          }));
          cell.classList.add('is-unavailable');
        }
          cell.appendChild(runStatus);
      } else {
        cell.appendChild(el('span.rb-shortcut-pad-add-mark', { text: '+' }));
        cell.appendChild(el('span.rb-shortcut-pad-add-label', { text: 'Add' }));
      }
      if (isEditing()) attachDragHandlers(cell, pad, slot);
      return cell;
    }

    function attachDragHandlers(cell, pad, slot) {
      cell.addEventListener('dragstart', function (event) {
        if (!pad || !event.dataTransfer) {
          event.preventDefault();
          return;
        }
        dragId = pad.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', pad.id);
        cell.classList.add('is-dragging');
      });
      cell.addEventListener('dragend', function () {
        cell.classList.remove('is-dragging');
        dragId = '';
        ignoreNextClick = true;
        window.setTimeout(function () { ignoreNextClick = false; }, 0);
      });
      cell.addEventListener('dragover', function (event) {
        if (!dragId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        cell.classList.add('is-drop-target');
      });
      cell.addEventListener('dragleave', function () {
        cell.classList.remove('is-drop-target');
      });
      cell.addEventListener('drop', function (event) {
        event.preventDefault();
        cell.classList.remove('is-drop-target');
        var sourceId = event.dataTransfer && event.dataTransfer.getData('text/plain') || dragId;
        if (!sourceId || sourceId === (pad && pad.id)) return;
        try {
          stagePinAt(sourceId, slot);
        } catch (error) {
          toast(error.message || 'Could not move that shortcut.', 'error');
        }
      });
    }

    function scheduleFit() {
      if (renderQueued || disposed) return;
      renderQueued = true;
      window.requestAnimationFrame(function () {
        renderQueued = false;
        fitWidget();
      });
    }

    function afterPaint(callback) {
      window.setTimeout(callback, 16);
    }

    function fitWidget() {
      var width = grid.clientWidth || root.clientWidth;
      if (!width) return;
      var columns = width >= 616 ? 6
        : width >= 516 ? 5
          : width >= 416 ? 4
            : width >= 316 ? 3
              : width >= 216 ? 2 : 1;
      var rows = Math.max(1, Math.ceil(grid.children.length / columns));
      var cellSize = Math.max(72,
        Math.floor((width - 24 - (columns - 1) * 8) / columns));
      var gridHeight = rows * cellSize + (rows - 1) * 8 + 24;
      grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))';
      grid.style.gridAutoRows = cellSize + 'px';
      grid.style.height = gridHeight + 'px';
      var contentHeight = Math.ceil(gridHeight + header.offsetHeight);
      if (ctx.setWidgetContentHeight && contentHeight !== lastContentHeight) {
        lastContentHeight = contentHeight;
        ctx.setWidgetContentHeight(contentHeight);
      }
      var chords = grid.querySelectorAll('.rb-shortcut-pad-chord');
      for (var i = 0; i < chords.length; i++) {
        chords[i].hidden = chords[i].scrollWidth > chords[i].clientWidth;
      }
    }

    function runPad(pad, button) {
      var pinId = pad && (pad.pinId || pad.id);
      if (!pinId || !R.actionRouter || !R.actionRouter.executePin) {
        toast('The shortcut action handler is unavailable.', 'error');
        return;
      }
      var pending;
      var statusNode = button.querySelector('.rb-shortcut-pad-run-status');
      var originalTitle = button.title || '';
      try {
        button.disabled = true;
        button.classList.add('is-running');
        if (statusNode) {
          statusNode.textContent = 'Running';
          statusNode.hidden = false;
        }
        pending = R.actionRouter.executePin(pinId, {
          source: 'shortcut-pad',
          kind: 'shortcut-pad',
          actorCategory: 'human-user',
          pinId: pinId
        });
      } catch (error) {
        button.disabled = false;
        button.classList.remove('is-running');
        if (statusNode) {
          statusNode.hidden = true;
          statusNode.textContent = '';
        }
        toast(error && error.message || 'The shortcut could not be run.', 'error');
        return;
      }
      Promise.resolve(pending).then(function (result) {
        var state = result && result.state || 'Failed';
        var failed = state === 'Failed' || state === 'Unsupported';
        button.classList.toggle('is-failed', failed);
        if (statusNode) statusNode.textContent = state;
        if (failed) button.title = originalTitle + '\n' +
          (result.error || result.userMessage || 'Action failed.');
        showRunResult(result, pad.commandName || pad.label);
      }).catch(function (error) {
        button.classList.add('is-failed');
        if (statusNode) statusNode.textContent = 'Failed';
        toast(error && error.message || 'The shortcut could not be run.', 'error');
      }).then(function () {
        button.disabled = false;
        button.classList.remove('is-running');
        window.setTimeout(function () {
          button.classList.remove('is-failed');
          button.title = originalTitle;
          if (statusNode) {
            statusNode.hidden = true;
            statusNode.textContent = '';
          }
        }, 900);
      });
    }

    function showRunResult(result, label) {
      if (!result) {
        toast('The shortcut could not be run.', 'error');
        return;
      }
      if (result.state === 'Done') {
        // Done = After Effects accepted and ran the command. Verified only when
        // the command has an observable postcondition; otherwise "sent".
        toast(result.userMessage || label + ' completed.',
          result.verified === true ? 'success' : 'info');
        return;
      }
      if (result.state === 'Loading') {
        toast(result.userMessage || 'After Effects shortcuts are still loading.', 'info');
        return;
      }
      if (result.state === 'Ready' && !result.userMessage) return;
      if (result.userMessage) {
        var contextNeeded = /^Needs /.test(result.state || '');
        toast(result.userMessage, contextNeeded ? 'warn' : 'error');
      }
    }

    function actionOptions() {
      if (actionOptionsCache) return actionOptionsCache;
      var items = [];
      var seen = {};
      function add(actionId, label, category, action, chord, isAE) {
        if (!actionId || seen[actionId]) return;
        action = action || actionForId(actionId);
        if (!isAE || !action || action.aeMapShortcut !== true ||
            action.deliveryRoute !== 'host-command' ||
            typeof action.commandId !== 'number' || !isFinite(action.commandId) ||
            action.commandId <= 0 ||
            action.commandIdSource !== 'verified-host-probe') return;
        seen[actionId] = true;
        items.push({
          actionId: actionId,
          label: label || action && action.label || 'Shortcut',
          category: category || action &&
            (action.workflowCategory || action.category || action.group) || '',
          action: action,
          chord: chord || activeActionChord(action),
          isAE: !!isAE
        });
      }
      var aeEntries = R.afterEffectsShortcuts && R.afterEffectsShortcuts.catalogEntries
        ? R.afterEffectsShortcuts.catalogEntries() : [];
      aeEntries.forEach(function (entry) {
        add(entry.actionId || entry.id, entry.label,
          entry.workflowCategory || entry.category, entry,
          entry.displayChord || activeActionChord(entry), true);
      });
      items.sort(function (left, right) {
        var a = left.label.toLowerCase();
        var b = right.label.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
      });
      actionOptionsCache = items;
      return actionOptionsCache;
    }

    function libraryItems() {
      if (libraryItemsCache) return libraryItemsCache;
      var pads = readShortcuts();
      var savedActionIds = {};
      pads.forEach(function (pad) {
        if (pad.actionId) savedActionIds[pad.actionId] = true;
      });
      var items = pads.map(function (pad) {
        var action = actionForId(pad.actionId);
        var route = action && R.actionRouter && R.actionRouter.selectRoute
          ? R.actionRouter.selectRoute(action) : action ? 'bridge-jsx' : 'unsupported';
        return {
          key: 'shortcut:' + pad.id,
          id: pad.id,
          pad: pad,
          actionId: pad.actionId,
          label: pad.label || action && action.label || 'Shortcut',
          category: action &&
            (action.workflowCategory || action.category || action.group) || '',
          chord: chordFor(pad),
          action: action,
          saved: true,
          pinned: pad.pinnedSlot != null,
          mappingUnavailable: !action || route === 'unsupported'
        };
      });
      actionOptions().forEach(function (item) {
        if (savedActionIds[item.actionId]) return;
        var route = item.action && R.actionRouter && R.actionRouter.selectRoute
          ? R.actionRouter.selectRoute(item.action) : item.action ? 'bridge-jsx' : 'unsupported';
        items.push({
          key: 'action:' + item.actionId,
          id: '',
          pad: null,
          actionId: item.actionId,
          label: item.label,
          category: item.category,
          chord: item.chord,
          action: item.action,
          saved: false,
          pinned: false,
          mappingUnavailable: !item.action || route === 'unsupported'
        });
      });
      items.sort(function (left, right) {
        var a = left.label.toLowerCase();
        var b = right.label.toLowerCase();
        return a < b ? -1 : a > b ? 1 : 0;
      });
      libraryItemsCache = items;
      return libraryItemsCache;
    }

    function runLibraryItem(item, button) {
      var savedPin = item.pad && (item.pad.pinId || item.pad.id);
      if (!R.actionRouter || !item.actionId ||
          savedPin && !R.actionRouter.executePin ||
          !savedPin && !R.actionRouter.executeFreshAction) {
        toast(MAPPING_MESSAGE, 'error');
        return;
      }
      var pending;
      try {
        pending = savedPin
          ? R.actionRouter.executePin(savedPin, {
            kind: 'shortcut-search',
            actorCategory: 'human-user'
          })
          : R.actionRouter.executeFreshAction(item.actionId, {
            kind: 'shortcut-search',
            actorCategory: 'human-user'
          });
      } catch (error) {
        toast(error && error.message || 'The shortcut could not be run.', 'error');
        return;
      }
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      Promise.resolve(pending).then(function (result) {
        showRunResult(result, item.label);
      }).catch(function (error) {
        toast(error && error.message || 'The shortcut could not be run.', 'error');
      }).then(function () {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      });
    }

    function pinLibraryItem(item, handle) {
      if (!padApi || !item.actionId) {
        toast(MAPPING_MESSAGE, 'error');
        return;
      }
      if (item.pinned && item.pad) return;
      try {
        var slot = padApi.firstEmptySlot();
        if (slot == null) {
          showSlotPicker(handle, {
            pad: item.pad,
            actionId: item.actionId,
            label: item.label,
            hotkey: item.pad ? item.pad.hotkey : null,
            createdFromAdd: false
          });
          return;
        }
        var pad = item.pad
          ? padApi.pinAt(item.pad.id, slot)
          : padApi.pinAction(item.actionId).pad;
        if (pad && pad.pinnedSlot != null) {
          toast('Added to Shortcut Pad.', 'success');
          render();
          return;
        }
        showSlotPicker(handle, {
          pad: pad || item.pad,
          actionId: item.actionId,
          label: item.label,
          hotkey: item.pad ? item.pad.hotkey : null,
          createdFromAdd: false
        });
      } catch (error) {
        toast(error.message || 'Could not pin that shortcut.', 'error');
      }
    }

    function openLibrarySheet(sheetTitle) {
      var searchInput = el('input.rb-shortcut-library-search', {
        type: 'search',
        placeholder: 'Search actions or keys',
        'aria-label': 'Search the Shortcut Library',
        'data-autofocus': 'true'
      });
      var results = el('div.rb-shortcut-library-results', {
        role: 'list',
        'aria-label': 'Shortcut Library results'
      });
      var body = el('div.rb-shortcut-library', null, [searchInput, results]);
      var handle;

      function renderResults() {
        var query = String(searchInput.value || '').toLowerCase()
          .replace(/^\s+|\s+$/g, '');
        var items;
        try {
          items = libraryItems().filter(function (item) {
            if (!query) return true;
            return (item.label + ' ' + item.chord + ' ' + item.category)
              .toLowerCase().indexOf(query) !== -1;
          });
        } catch (error) {
          items = [];
          toast(error.message || 'Could not load the Shortcut Library.', 'error');
        }
        R.dom.clear(results);
        if (!items.length) {
          results.appendChild(el('div.rb-shortcut-library-empty', {
            text: query ? 'No shortcuts match this search.' : 'No shortcuts are available yet.'
          }));
          return;
        }
        items.slice(0, 100).forEach(function (item) {
          results.appendChild(renderLibraryRow(item, handle));
        });
      }

      var closeButton = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () { handle.close('close'); }
      }, ['Close']);
      handle = R.ui.modal({
        title: sheetTitle || 'Search Shortcuts',
        width: 580,
        className: 'rb-modal-shortcut-library',
        body: body,
        footer: [closeButton],
        initialFocus: searchInput
      });
      searchInput.addEventListener('input', renderResults);
      renderResults();
    }

    function renderLibraryRow(item, handle) {
      var chordText = item.mappingUnavailable ? MAPPING_MESSAGE : item.chord;
      var copy = el('span.rb-shortcut-library-copy', null, [
        el('span.rb-shortcut-library-label', { text: item.label }),
        el('span.rb-shortcut-library-chord', { text: chordText || 'No hotkey assigned' })
      ]);
      var runButton = el('button.rb-btn.is-primary.rb-shortcut-library-action', {
        type: 'button',
        disabled: !item.actionId,
        onclick: function () { runLibraryItem(item, runButton); }
      }, ['Run']);
      var pinButton = el('button.rb-btn.is-ghost.rb-shortcut-library-action', {
        type: 'button',
        disabled: !item.actionId || item.pinned,
        title: item.pinned ? 'Already on the Shortcut Pad' : 'Pin to Shortcut Pad',
        onclick: function () { pinLibraryItem(item, handle); }
      }, [item.pinned ? 'On Pad' : 'Pin to Shortcut Pad']);
      var editButton = el('button.rb-btn.is-ghost.rb-shortcut-library-action', {
        type: 'button',
        onclick: function () {
          if (item.saved && item.pad) {
            closeThen(handle, function () {
              if (item.pinned && !isEditing()) enterEditPinsMode();
              if (item.pinned) shortcutPad.selectedSlot = item.pad.pinnedSlot;
              openEditorSheet(item.pad, { isPin: item.pinned });
            });
          } else {
            closeThen(handle, function () {
              openEditorSheet(null, { isNew: true, initialAction: item });
            });
          }
        }
      }, ['Edit']);
      return el('div.rb-shortcut-library-row', {
        role: 'listitem'
      }, [copy, el('div.rb-shortcut-library-actions', null, [
        runButton, pinButton, editButton
      ])]);
    }

    function closeThen(handle, callback) {
      handle.close('select');
      window.setTimeout(callback, 280);
    }

    function openDoneConfirmation() {
      var message = el('p.rb-shortcut-pad-confirm-copy', {
        text: 'Save changes before leaving?'
      });
      var errorText = el('p.rb-shortcut-pad-save-error', {
        text: '',
        hidden: true,
        role: 'alert'
      });
      var handle;
      var cancelButton = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () { handle.close('cancel'); }
      }, ['Cancel']);
      var discardButton = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () {
          shortcutPad.pendingPads = clonePads(shortcutPad.savedPads);
          shortcutPad.dirty = false;
          shortcutPad.mode = 'normal';
          shortcutPad.repairOnly = false;
          shortcutPad.selectedSlot = null;
          handle.close('discard');
          render();
        }
      }, ['Discard']);
      var saveButton = el('button.rb-btn.is-primary', {
        type: 'button',
        onclick: saveAndDone
      }, ['Save and Done']);

      function saveAndDone() {
        if (shortcutPad.saving) return;
        shortcutPad.saving = true;
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
        cancelButton.disabled = true;
        discardButton.disabled = true;
        errorText.hidden = true;
        afterPaint(function () {
          if (!handle.isOpen()) {
            shortcutPad.saving = false;
            return;
          }
          try {
            var saved = persistPendingSlots();
            shortcutPad.savedPads = clonePads(saved);
            shortcutPad.pendingPads = clonePads(saved);
            shortcutPad.dirty = false;
            shortcutPad.mode = 'normal';
            shortcutPad.repairOnly = false;
            shortcutPad.selectedSlot = null;
            shortcutPad.saving = false;
            render();
            handle.close('save');
            toast('Changes saved.', 'success');
          } catch (error) {
            shortcutPad.saving = false;
            saveButton.disabled = false;
            saveButton.textContent = 'Save and Done';
            cancelButton.disabled = false;
            discardButton.disabled = false;
            errorText.textContent = 'Couldn’t save these changes: ' +
              (error && error.message || 'An unknown error occurred.');
            errorText.hidden = false;
            if (R.log) R.log.error('Shortcut Pad changes could not be saved.', error);
          }
        });
      }

      handle = R.ui.modal({
        title: 'Edit Pins',
        width: 390,
        className: 'rb-modal-shortcut-pad',
        body: el('div.rb-shortcut-pad-confirm', null, [message, errorText]),
        footer: [cancelButton, discardButton, saveButton],
        closeImmediately: true,
        onCloseRequest: function () { return !shortcutPad.saving; }
      });
    }

    function openMenu() {
      var handle;
      function menuAction(label, action) {
        return el('button.rb-shortcut-pad-menu-item', {
          type: 'button',
          onclick: function () {
            handle.close('select');
            action();
          }
        }, [label]);
      }
      var body = el('div.rb-shortcut-pad-menu', null, [
        menuAction('Edit Pins', function () {
          try {
            enterEditPinsMode();
          } catch (error) {
            toast(error.message || 'Could not open Edit Pins mode.', 'error');
          }
        }),
        menuAction('Add Shortcut', function () { openEditorSheet(null, { isNew: true }); }),
        menuAction('Manage Shortcuts', function () { openLibrarySheet('Manage Shortcuts'); }),
        menuAction('Reset Pins', function () { openResetSheet(); })
      ]);
      handle = R.ui.modal({
        title: 'Shortcut Pad',
        width: 360,
        className: 'rb-modal-shortcut-pad-menu',
        body: body
      });
    }

    function openResetSheet() {
      var message = el('p.rb-shortcut-pad-confirm-copy', {
        text: 'Reset the pad to its default shortcuts? Saved shortcuts will remain in your library.'
      });
      var handle;
      var cancel = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () { handle.close('cancel'); }
      }, ['Cancel']);
      var reset = el('button.rb-btn.is-primary', {
        type: 'button',
        onclick: function () {
          try {
            padApi.reset();
            shortcutPad.mode = 'normal';
            shortcutPad.repairOnly = false;
            shortcutPad.selectedSlot = null;
            shortcutPad.dirty = false;
            shortcutPad.savedPads = [];
            shortcutPad.pendingPads = [];
            render();
            handle.close('confirm');
            toast('Shortcut Pad reset.', 'success');
          } catch (error) {
            toast(error.message || 'Could not reset the Shortcut Pad.', 'error');
          }
        }
      }, ['Reset Pins']);
      handle = R.ui.modal({
        title: 'Reset Pins',
        width: 380,
        className: 'rb-modal-shortcut-pad',
        body: message,
        footer: [cancel, reset]
      });
    }

    function openAddSheet(initialAction, targetSlot) {
      openEditorSheet(null, {
        isNew: true,
        initialAction: initialAction || null,
        targetSlot: targetSlot
      });
    }

    function openPinEditor(pad, slot) {
      shortcutPad.selectedSlot = slot == null ? pad.pinnedSlot : slot;
      openEditorSheet(pad, { isPin: true, repair: !isEditing() });
    }

    function openEditorSheet(pad, options) {
      options = options || {};
      var isNew = !!options.isNew;
      var isPin = !!options.isPin;
      if (isPin && !isEditing() && !options.repair) {
        toast('Enter Edit Pins mode to edit a pin.', 'info');
        return;
      }
      var current = pad ? R.shortcutPads.byId(pad.id) || pad : null;
      var original = current ? {
        id: current.id,
        label: current.label,
        actionId: current.actionId,
        hotkey: current.hotkey,
        pinnedSlot: current.pinnedSlot
      } : null;
      var selectedActionId = current && current.actionId ||
        options.initialAction && options.initialAction.actionId || '';
      var selectedAction = actionForId(selectedActionId) ||
        options.initialAction && options.initialAction.action || null;
      var labelTouched = false;
      var hotkey = null;
      var saveError = null;
      var saveConflictPanel = null;
      var saveConflict = null;
      var saveConflictReplaceButton = null;
      var pendingHotkeyConflict = null;
      var allowPendingHotkeyConflict = false;
      var browserBody = null;
      var browserSearch = null;
      var browserResults = null;
      var browserSuggestions = null;
      var builderModifiers = null;
      var builderMainKey = '';
      var builderConflict = null;
      var builderBody = null;
      var builderFooter = null;
      var builderPreview = null;
      var builderMainKeyButton = null;
      var builderHint = null;
      var builderConflictPanel = null;
      var builderCategoryButtons = {};
      var builderKeyGroups = {};
      var builderSaveButton = null;
      var builderCancelButton = null;
      var builderReplaceButton = null;
      var builderChooseButton = null;
      var handle;

      var labelInput = el('input.rb-shortcut-pad-name', {
        type: 'text',
        maxlength: '64',
        placeholder: 'Shortcut name',
        'aria-label': 'Display name',
        value: current && current.label || selectedAction && selectedAction.label ||
          options.initialAction && options.initialAction.label || ''
      });
      var displayNameHelper = el('span.rb-shortcut-pad-helper', {
        text: 'This is the name shown on the pad.'
      });
      var selectedActionLabel = el('span.rb-shortcut-pad-selected-action', {
        text: selectedAction && selectedAction.label || 'Choose an action'
      });
      var selectedActionPath = el('span.rb-shortcut-pad-action-path');
      var selectedActionDefault = el('span.rb-shortcut-pad-action-default');
      var actionPickerButton = el('button.rb-btn.is-ghost.rb-shortcut-pad-action-change', {
        type: 'button',
        onclick: showActionBrowser
      }, [selectedAction ? 'Change' : 'Choose']);
      var selectedActionCopy = el('div.rb-shortcut-pad-action-copy', null, [
        selectedActionLabel,
        selectedActionPath
      ]);
      var selectedActionRow = el('div.rb-shortcut-pad-action-row', null, [
        selectedActionCopy,
        actionPickerButton
      ]);
      var actionField = el('div.rb-shortcut-pad-action-field', null, [
        el('div.rb-shortcut-pad-field-label', { text: 'Action' }),
        selectedActionRow,
        selectedActionDefault
      ]);
      var hotkeyText = el('span.rb-shortcut-pad-hotkey-value');
      var hotkeyHint = el('span.rb-shortcut-pad-record-hint');
      var shortcutLabel = el('div.rb-shortcut-pad-field-label', {
        text: 'AE shortcut (display only)'
      });
      var hotkeyField = el('div.rb-shortcut-pad-hotkey-field', null, [
        shortcutLabel,
        el('div.rb-shortcut-pad-shortcut-value', null, [hotkeyText]),
        hotkeyHint
      ]);
      saveError = el('p.rb-shortcut-pad-save-error', {
        hidden: true,
        role: 'alert',
        'aria-live': 'polite'
      });
      saveConflictPanel = el('div.rb-shortcut-pad-save-conflict', {
        hidden: true,
        role: 'alert'
      });
      var body = el('div.rb-shortcut-pad-editor', null, [
        el('label.rb-shortcut-pad-field', null, [
          el('span.rb-shortcut-pad-field-label', { text: 'Display name' }),
          labelInput,
          displayNameHelper
        ]),
        actionField,
        hotkeyField,
        saveConflictPanel,
        saveError
      ]);

      labelInput.addEventListener('input', function () { labelTouched = true; });
      syncHotkeyText();
      syncSelectedAction();

      var cancelButton = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () { handle.close('cancel'); }
      }, ['Cancel']);
      var clearButton = el('button.rb-btn.is-ghost.rb-shortcut-pad-clear', {
        type: 'button',
        hidden: !isPin,
        onclick: function () {
          try {
            if (isEditing()) {
              if (!stageClearPin(current.id)) {
                throw new Error('Could not remove this shortcut from the pad.');
              }
            } else if (!padApi.clearFromPad(current.id)) {
              throw new Error('Could not remove this shortcut from the pad.');
            }
            handle.close('clear');
            render();
            if (!isEditing()) toast('Removed from Shortcut Pad.', 'success');
          } catch (error) {
            toast(error.message || 'Could not remove this shortcut from the pad.', 'error');
          }
        }
      }, ['Remove from pad']);
      var clearPinButton = clearButton;
      var saveButton = el('button.rb-btn.is-primary', {
        type: 'button',
        onclick: function () { saveCurrent(true); }
      }, ['Save']);
      var editorTitle = isNew ? 'Add Shortcut' : isPin ? 'Edit pin' : 'Edit Shortcut';
      var editorFooter = isPin
        ? [clearButton, cancelButton, saveButton] : [cancelButton, saveButton];
      handle = R.ui.modal({
        title: editorTitle,
        width: 500,
        className: 'rb-modal-shortcut-pad',
        body: body,
        footer: editorFooter,
        initialFocus: labelInput,
        closeImmediately: true,
        onCloseRequest: function () {
          if (shortcutPad.saving) return false;
          return true;
        }
      });

      function actionPathFor(action) {
        if (!action) return 'Choose an action from the browser.';
        var path = action.menuPath || action.workflowCategory ||
          action.category || action.group || '';
        var label = action.label || selectedActionLabel.textContent;
        if (!path) return label;
        if (String(path).toLowerCase().indexOf(String(label).toLowerCase()) !== -1) {
          return path;
        }
        return path + ' \u203a ' + label;
      }

      function defaultChordFor(action) {
        return activeActionChord(action);
      }

      function syncSelectedAction() {
        selectedActionLabel.textContent = selectedAction && selectedAction.label ||
          'Choose an action';
        selectedActionPath.textContent = actionPathFor(selectedAction);
        var defaultChord = defaultChordFor(selectedAction);
        selectedActionDefault.textContent = defaultChord
          ? 'Adobe After Effects default: ' + defaultChord
          : 'No default shortcut available.';
        selectedActionDefault.classList.toggle('is-unavailable', !defaultChord);
        actionPickerButton.textContent = selectedAction ? 'Change' : 'Choose';
        actionPickerButton.setAttribute('aria-label',
          selectedAction ? 'Change action' : 'Choose action');
      }

      function showActionBrowser() {
        if (!browserBody) {
          browserSearch = el('input.rb-shortcut-library-search', {
            type: 'search',
            placeholder: 'Search by action or category',
            'aria-label': 'Search actions by name or category'
          });
          browserSuggestions = el('div.rb-shortcut-pad-action-suggestions');
          browserResults = el('div.rb-shortcut-library-results', {
            role: 'listbox',
            'aria-label': 'Available actions'
          });
          browserBody = el('div.rb-shortcut-pad-action-browser', null, [
            browserSearch,
            browserSuggestions,
            browserResults
          ]);
          browserSearch.addEventListener('input', renderActionBrowser);
        }
        browserSearch.value = '';
        renderActionBrowser();
        setDialogView(handle, 'Choose Action', browserBody, [
          el('button.rb-btn.is-ghost', {
            type: 'button',
            onclick: returnToEditor
          }, ['Cancel'])
        ]);
        browserSearch.focus();
      }

      function returnToEditor() {
        setDialogView(handle, editorTitle, body, editorFooter);
        syncSelectedAction();
        syncHotkeyText();
        actionPickerButton.focus();
      }

      function renderActionBrowser() {
        var query = String(browserSearch.value || '').toLowerCase()
          .replace(/^\s+|\s+$/g, '');
        var options;
        try {
          options = actionOptions();
        } catch (error) {
          options = [];
          if (R.log) R.log.error('Shortcut Pad action browser could not load actions.', error);
        }
        var filtered = options.filter(function (item) {
          return !query || (item.label + ' ' + item.category + ' ' + item.chord)
            .toLowerCase().indexOf(query) !== -1;
        });
        R.dom.clear(browserResults);
        R.dom.clear(browserSuggestions);
        if (!query) renderActionSuggestions(options);
        if (!filtered.length) {
          browserResults.appendChild(el('div.rb-shortcut-library-empty', {
            text: query ? 'No actions match this search.' : 'No actions are available.'
          }));
          return;
        }
        filtered.slice(0, 80).forEach(function (item) {
          browserResults.appendChild(renderActionChoice(item));
        });
      }

      function renderActionSuggestions(options) {
        var byId = {};
        options.forEach(function (item) { byId[item.actionId] = item; });
        var recentIds = R.disk.read('shortcut-pad-recent-actions', []) || [];
        var recent = recentIds.map(function (id) { return byId[id]; })
          .filter(Boolean).slice(0, 5);
        var pinnedIds = [];
        readShortcuts().filter(function (pad) {
          return pad.pinnedSlot != null;
        }).sort(function (a, b) {
          return a.pinnedSlot - b.pinnedSlot;
        }).forEach(function (pad) {
          if (pinnedIds.indexOf(pad.actionId) === -1) pinnedIds.push(pad.actionId);
        });
        options.filter(function (item) { return item.isAE; }).forEach(function (item) {
          if (pinnedIds.length < 6 && pinnedIds.indexOf(item.actionId) === -1) {
            pinnedIds.push(item.actionId);
          }
        });
        var common = pinnedIds.map(function (id) { return byId[id]; })
          .filter(Boolean).slice(0, 6);
        if (recent.length) {
          browserSuggestions.appendChild(el('div.rb-shortcut-pad-action-suggestion-group', null, [
            el('div.rb-shortcut-pad-field-label', { text: 'Recently used' }),
            el('div.rb-shortcut-pad-action-suggestion-grid', null,
              recent.map(renderActionSuggestion))
          ]));
        }
        if (common.length) {
          browserSuggestions.appendChild(el('div.rb-shortcut-pad-action-suggestion-group', null, [
            el('div.rb-shortcut-pad-field-label', { text: 'Common actions' }),
            el('div.rb-shortcut-pad-action-suggestion-grid', null,
              common.map(renderActionSuggestion))
          ]));
        }
      }

      function renderActionSuggestion(item) {
        return el('button.rb-shortcut-pad-action-suggestion', {
          type: 'button',
          onclick: function () { chooseAction(item); }
        }, [item.label]);
      }

      function renderActionChoice(item) {
        var categoryPath = actionPathFor(item.action || item);
        var key = item.chord
          ? displayChord(item.chord) : 'No default shortcut available.';
        return el('button.rb-shortcut-pad-action-choice', {
          type: 'button',
          role: 'option',
          'aria-selected': 'false',
          onclick: function () { chooseAction(item); }
        }, [
          el('span.rb-shortcut-pad-action-choice-name', { text: item.label }),
          el('span.rb-shortcut-pad-action-choice-path', { text: categoryPath }),
          el('span.rb-shortcut-pad-action-choice-chord', { text: key })
        ]);
      }

      function chooseAction(item) {
        if (!item || !item.actionId || !item.action) {
          toast('Choose an available action.', 'error');
          return;
        }
        selectedActionId = item.actionId;
        selectedAction = item.action;
        if (!labelTouched && (isNew || !labelInput.value)) labelInput.value = item.label;
        setDialogView(handle, editorTitle, body, editorFooter);
        syncSelectedAction();
        syncHotkeyText();
        labelInput.focus();
      }

      function syncHotkeyText() {
        var defaultChord = defaultChordFor(selectedAction);
        hotkeyText.textContent = defaultChord
          ? displayChord(defaultChord) : 'No AE shortcut assigned';
        hotkeyHint.textContent = 'Displayed for reference only. Pad clicks run the verified AE command ID.';
      }

      function openHotkeyBuilder() {
        if (typeof createBuilderView !== 'function') return;
        toast('AE shortcut display is read-only; Rebound does not record or dispatch physical shortcuts.', 'info');
      }

      function keyLabel(key) {
        var normalized = R.shortcutPads.normalizeHotkey({ key: key });
        return normalized ? normalized.display : key;
      }

      function renderBuilderPreview() {
        if (!builderPreview || !builderModifiers) return;
        var parts = [];
        if (builderModifiers.ctrl) parts.push('Ctrl');
        if (builderModifiers.alt) parts.push('Alt');
        if (builderModifiers.shift) parts.push('Shift');
        if (builderModifiers.win) parts.push('Win');
        var chord = builderMainKey
          ? parts.concat([builderMainKey]).join('+')
          : parts.length ? parts.join('+') + '+Press a key combination…'
            : 'Press a key combination…';
        builderPreview.textContent = displayChord(chord);
        if (builderMainKeyButton) {
          builderMainKeyButton.textContent = builderMainKey
            ? keyLabel(builderMainKey) : 'Press a key combination…';
        }
        if (builderSaveButton) builderSaveButton.disabled = !builderMainKey;
      }

      function setBuilderMainKey(key) {
        builderMainKey = key;
        clearBuilderConflict();
        renderBuilderPreview();
        if (builderHint) builderHint.textContent = 'Press another key to replace this one.';
      }

      function createBuilderView() {
        var modifierRow = el('div.rb-hotkey-modifiers', {
          role: 'group',
          'aria-label': 'Hotkey modifiers'
        });
        [
          { id: 'ctrl', label: 'Ctrl' },
          { id: 'alt', label: 'Alt' },
          { id: 'shift', label: 'Shift' },
          { id: 'win', label: 'Win' }
        ].forEach(function (item) {
          var button = el('button.rb-hotkey-modifier', {
            type: 'button',
            'aria-pressed': builderModifiers[item.id] ? 'true' : 'false',
            onclick: function () {
              builderModifiers[item.id] = !builderModifiers[item.id];
              button.classList.toggle('is-active', builderModifiers[item.id]);
              button.setAttribute('aria-pressed', builderModifiers[item.id] ? 'true' : 'false');
              clearBuilderConflict();
              renderBuilderPreview();
            }
          }, [item.label]);
          if (builderModifiers[item.id]) button.classList.add('is-active');
          modifierRow.appendChild(button);
        });

        builderPreview = el('div.rb-hotkey-preview', {
          role: 'status',
          'aria-live': 'polite'
        });
        builderMainKeyButton = el('button.rb-hotkey-main-key', {
          type: 'button',
          'aria-label': 'Press a key combination to assign it as the shortcut',
          onclick: function () { builderMainKeyButton.focus(); }
        }, ['Press a key combination…']);
        var clearHotkeyButton = el('button.rb-btn.is-ghost.rb-hotkey-clear', {
          type: 'button',
          onclick: function () {
            builderMainKey = '';
            clearBuilderConflict();
            renderBuilderPreview();
            builderHint.textContent = 'Hotkey cleared. Capture remains active.';
            builderMainKeyButton.focus();
          }
        }, ['Clear hotkey']);
        var keyPicker = createKeyPicker();
        builderHint = el('p.rb-hotkey-hint', {
          text: 'Press a key combination… Escape cancels; choose Escape from the picker to assign it.'
        });
        builderConflictPanel = el('div.rb-hotkey-conflict', { hidden: true });
        builderBody = el('div.rb-hotkey-builder', null, [
          builderPreview,
          el('div.rb-hotkey-capture-row', null, [builderMainKeyButton, clearHotkeyButton]),
          modifierRow,
          keyPicker,
          builderConflictPanel,
          builderHint
        ]);

        builderCancelButton = el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: finishHotkeyBuilder
        }, ['Cancel']);
        builderSaveButton = el('button.rb-btn.is-primary', {
          type: 'button',
          disabled: !builderMainKey,
          onclick: function () { saveBuilderHotkey(false); }
        }, ['Save shortcut']);
        builderReplaceButton = el('button.rb-btn.is-primary', {
          type: 'button',
          onclick: function () { saveBuilderHotkey(true); }
        }, ['Replace']);
        builderChooseButton = el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: function () {
            clearBuilderConflict();
            builderMainKeyButton.focus();
          }
        }, ['Choose another']);
        builderFooter = [builderCancelButton, builderSaveButton];
        renderBuilderPreview();
      }

      function createKeyPicker() {
        var groups = [
          { id: 'letters', label: 'Letters', keys: [] },
          { id: 'numbers', label: 'Numbers', keys: [] },
          { id: 'function', label: 'F-keys', keys: [] },
          {
            id: 'navigation',
            label: 'Navigation',
            keys: ['Esc', 'Tab', 'Backspace', 'Enter', 'Space', 'Delete',
              'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'LeftArrow',
              'UpArrow', 'DownArrow', 'RightArrow']
          },
          {
            id: 'numpad',
            label: 'Numpad',
            keys: ['Pad0', 'Pad1', 'Pad2', 'Pad3', 'Pad4', 'Pad5', 'Pad6',
              'Pad7', 'Pad8', 'Pad9', 'PadEnter', 'PadPlus', 'PadMinus',
              'PadMultiply', 'PadSlash', 'PadDecimal', 'PadComma']
          },
          {
            id: 'symbols',
            label: 'Symbols',
            keys: ['`', '-', '=', '[', ']', '\\', ';', ',', '.', '/',
              'SingleQuote']
          }
        ];
        for (var letter = 65; letter <= 90; letter++) {
          groups[0].keys.push(String.fromCharCode(letter));
        }
        for (var digit = 0; digit <= 9; digit++) groups[1].keys.push(String(digit));
        for (var functionNumber = 1; functionNumber <= 24; functionNumber++) {
          groups[2].keys.push('F' + functionNumber);
        }

        var tabs = el('div.rb-hotkey-key-categories', {
          role: 'group',
          'aria-label': 'Key categories'
        });
        var panels = el('div.rb-hotkey-key-panels');
        groups.forEach(function (group, groupIndex) {
          var tab = el('button.rb-hotkey-key-category' +
            (groupIndex === 0 ? '.is-active' : ''), {
            type: 'button',
            'aria-pressed': groupIndex === 0 ? 'true' : 'false',
            onclick: function () { selectKeyGroup(group.id); }
          }, [group.label]);
          builderCategoryButtons[group.id] = tab;
          tabs.appendChild(tab);
          var panel = el('div.rb-hotkey-key-grid', {
            role: 'group',
            'aria-label': group.label,
            hidden: groupIndex !== 0
          });
          builderKeyGroups[group.id] = panel;
          group.keys.forEach(function (key) {
            var canonical = R.globalHotkeys.cleanPadKey(key);
            if (!canonical) return;
            panel.appendChild(el('button.rb-hotkey-key', {
              type: 'button',
              'aria-label': keyLabel(canonical),
              title: keyLabel(canonical),
              onclick: function () { setBuilderMainKey(canonical); }
            }, [keyLabel(canonical)]));
          });
          panels.appendChild(panel);
        });
        selectKeyGroup('letters');
        return el('div.rb-hotkey-picker', null, [
          el('div.rb-shortcut-pad-field-label', { text: 'Choose a key' }),
          tabs,
          panels
        ]);
      }

      function selectKeyGroup(groupId) {
        Object.keys(builderKeyGroups).forEach(function (id) {
          builderKeyGroups[id].hidden = id !== groupId;
          builderCategoryButtons[id].classList.toggle('is-active', id === groupId);
          builderCategoryButtons[id].setAttribute('aria-pressed', id === groupId ? 'true' : 'false');
        });
      }

      function findHotkeyConflict(chord) {
        var bindings = R.globalHotkeys && R.globalHotkeys.bindings
          ? R.globalHotkeys.bindings() : {};
        var targetId = current && 'pad:' + current.id;
        var ids = Object.keys(bindings);
        for (var i = 0; i < ids.length; i++) {
          if (ids[i] === targetId || bindings[ids[i]] !== chord) continue;
          var padMatch = /^pad:(.+)$/.exec(ids[i]);
          var conflictPad = padMatch && R.shortcutPads.byId(padMatch[1]);
          var conflictAction = !conflictPad && actionForId(ids[i]);
          return {
            id: ids[i],
            label: conflictPad && conflictPad.label ||
              conflictAction && conflictAction.label || 'another shortcut',
            pad: conflictPad || null,
            kind: 'rebound'
          };
        }
        var entries = R.afterEffectsShortcuts && R.afterEffectsShortcuts.catalogEntries
          ? R.afterEffectsShortcuts.catalogEntries() : [];
        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          var entryChord = entry && R.globalHotkeys.cleanPadChord(entry.activeChord);
          if (entry && entryChord === chord && entry.actionId !== selectedActionId &&
              entry.userStatus !== 'Unsupported') {
            return {
              id: entry.actionId,
              label: entry.label || 'an After Effects shortcut',
              pad: null,
              kind: 'after-effects'
            };
          }
        }
        return null;
      }

      function showBuilderConflict(conflict) {
        builderConflict = conflict;
        R.dom.clear(builderConflictPanel);
        builderConflictPanel.classList.add('is-conflict');
        builderConflictPanel.appendChild(el('strong', {
          text: 'Already assigned to ' + conflict.label
        }));
        builderConflictPanel.appendChild(el('span', {
          text: conflict.kind === 'after-effects'
            ? 'Replace routes this key to your Shortcut Pad while After Effects is active.'
            : 'Replace moves this hotkey from the existing Rebound shortcut.'
        }));
        builderConflictPanel.hidden = false;
        builderHint.textContent = 'Choose Replace, Choose another, or Cancel.';
        setDialogView(handle, 'Assign Hotkey', builderBody,
          [builderReplaceButton, builderChooseButton, builderCancelButton]);
      }

      function clearBuilderConflict() {
        if (!builderConflict) return;
        builderConflict = null;
        builderConflictPanel.hidden = true;
        builderConflictPanel.classList.remove('is-conflict');
        if (handle && handle.isOpen()) {
          setDialogView(handle, 'Assign Hotkey', builderBody, builderFooter);
        }
      }

      function saveBuilderHotkey(allowConflict) {
        if (!builderMainKey) {
          toast('Choose a key before saving the hotkey.', 'error');
          return;
        }
        var nextHotkey;
        try {
          nextHotkey = R.shortcutPads.normalizeHotkey({
            ctrl: builderModifiers.ctrl,
            alt: builderModifiers.alt,
            shift: builderModifiers.shift,
            win: builderModifiers.win,
            key: builderMainKey
          });
        } catch (error) {
          toast(error.message || 'Choose a supported key combination.', 'error');
          return;
        }
        var chord = R.shortcutPads.hotkeyChord(nextHotkey);
        var conflict = allowConflict ? builderConflict : findHotkeyConflict(chord);
        if (conflict && !allowConflict) {
          showBuilderConflict(conflict);
          return;
        }
        if (isPin) {
          pendingHotkeyConflict = conflict;
          allowPendingHotkeyConflict = !!allowConflict;
          hotkey = nextHotkey;
          syncHotkeyText();
          finishHotkeyBuilder();
          return;
        }
        persistBuilderHotkey(nextHotkey, chord, !!allowConflict, conflict);
      }

      function persistBuilderHotkey(nextHotkey, chord, allowConflict, conflict) {
        var label = String(labelInput.value || '').replace(/^\s+|\s+$/g, '');
        if (!selectedActionId || !selectedAction) {
          toast('Choose an action for this shortcut.', 'error');
          return;
        }
        if (!label) {
          toast('Enter a name for this shortcut.', 'error');
          labelInput.focus();
          return;
        }
        var creating = !current;
        var previous = current && {
          id: current.id,
          label: current.label,
          actionId: current.actionId,
          hotkey: current.hotkey,
          pinnedSlot: current.pinnedSlot
        };
        var previousBinding = current && R.globalHotkeys.bindingFor('pad:' + current.id);
        var conflictPad = conflict && conflict.pad;
        var previousConflictBinding = conflict && conflict.id &&
          R.globalHotkeys.bindingFor(conflict.id);
        var conflictCleared = false;
        var saved = null;
        try {
          if (conflictPad) {
            if (!padApi.update(conflictPad.id, { hotkey: null })) {
              throw new Error('Could not release the existing shortcut hotkey.');
            }
            conflictCleared = true;
          }
          if (creating) {
            saved = padApi.add(label, selectedActionId, nextHotkey);
          } else {
            saved = padApi.update(current.id, { hotkey: nextHotkey });
          }
          if (!saved) throw new Error('This shortcut is no longer available.');
          var binding = R.globalHotkeys.setBinding('pad:' + saved.id, chord, {
            allowConflict: allowConflict
          });
          if (!binding || !binding.ok) {
            throw new Error(binding && binding.error || 'Could not save this hotkey.');
          }
        } catch (error) {
          rollbackBuilderHotkey(saved, creating, previous, previousBinding,
            conflictPad, conflictCleared, previousConflictBinding);
          toast(error.message || 'Could not save this hotkey.', 'error');
          return;
        }
        current = saved;
        isNew = false;
        hotkey = saved.hotkey;
        original = {
          id: saved.id,
          label: saved.label,
          actionId: saved.actionId,
          hotkey: saved.hotkey,
          pinnedSlot: saved.pinnedSlot
        };
        render();
        syncHotkeyText();
        toast('Hotkey saved.', 'success');
        finishHotkeyBuilder();
      }

      function rollbackBuilderHotkey(saved, creating, previous, previousBinding,
          conflictPad, conflictCleared, previousConflictBinding) {
        var failures = [];
        try {
          if (creating && saved) {
            if (!padApi.remove(saved.id)) failures.push('The new shortcut could not be removed.');
          } else if (previous) {
            padApi.update(previous.id, {
              label: previous.label,
              actionId: previous.actionId,
              hotkey: previous.hotkey
            });
          }
        } catch (error) {
          failures.push(error.message || 'The shortcut could not be restored.');
        }
        if (saved && R.globalHotkeys) {
          try {
            if (previousBinding) {
              var restored = R.globalHotkeys.setBinding('pad:' + saved.id, previousBinding, {
                allowConflict: true
              });
              if (!restored || !restored.ok) failures.push('The previous hotkey could not be restored.');
            } else {
              R.globalHotkeys.clearBinding('pad:' + saved.id);
            }
          } catch (error2) {
            failures.push(error2.message || 'The previous hotkey could not be restored.');
          }
        }
        if (conflictPad && conflictCleared) {
          try {
            padApi.update(conflictPad.id, { hotkey: conflictPad.hotkey });
            if (previousConflictBinding) {
              var restoredConflict = R.globalHotkeys.setBinding(
                'pad:' + conflictPad.id, previousConflictBinding, { allowConflict: true });
              if (!restoredConflict || !restoredConflict.ok) {
                failures.push('The other shortcut binding could not be restored.');
              }
            }
          } catch (error3) {
            failures.push(error3.message || 'The other shortcut could not be restored.');
          }
        }
        if (failures.length && R.log) {
          R.log.error('Hotkey save rollback was incomplete.', failures);
        }
      }

      function finishHotkeyBuilder() {
        builderConflict = null;
        if (handle && handle.isOpen()) {
          setDialogView(handle, editorTitle, body, editorFooter);
          syncHotkeyText();
        }
      }

      function saveCurrent(closeAfterSave, afterSave) {
        if (isPin) return savePin();
        if (!selectedActionId || !selectedAction) {
          toast('Choose an action for this shortcut.', 'error');
          return false;
        }
        var label = String(labelInput.value || '').replace(/^\s+|\s+$/g, '');
        if (!label) {
          toast('Enter a name for this shortcut.', 'error');
          labelInput.focus();
          return false;
        }
        var saved;
        var previousBinding = current && R.globalHotkeys &&
          R.globalHotkeys.bindingFor ? R.globalHotkeys.bindingFor('pad:' + current.id) : null;
        try {
          if (isNew) {
            if (isEditing() && options.targetSlot != null) {
              saved = padApi.add(label, selectedActionId, hotkey, null);
            } else {
              saved = padApi.add(label, selectedActionId, hotkey);
            }
          } else {
            saved = padApi.update(current.id, {
              label: label,
              actionId: selectedActionId,
              hotkey: hotkey
            });
            if (!saved) throw new Error('This shortcut is no longer available.');
          }
          syncGlobalHotkey(saved.id, hotkey, previousBinding);
        } catch (error) {
          rollbackSave(saved, previousBinding, error);
          return false;
        }

        current = saved;
        original = {
          id: saved.id,
          label: saved.label,
          actionId: saved.actionId,
          hotkey: saved.hotkey,
          pinnedSlot: saved.pinnedSlot
        };
        if (isEditing()) updateSavedPin(saved);
        render();
        if (isNew && isEditing() && options.targetSlot != null) {
          stagePinAt(saved.id, options.targetSlot);
          handle.close('save');
          toast('Shortcut staged on the pad. Click Done to save.', 'info');
          return true;
        }
        if (typeof afterSave === 'function') {
          afterSave();
          return true;
        }
        if (saved.pinnedSlot == null) {
          showSlotPicker(handle, {
            pad: saved,
            actionId: saved.actionId,
            label: saved.label,
            hotkey: saved.hotkey,
            createdFromAdd: true
          });
        } else if (isNew) {
          toast('Added to Shortcut Pad.', 'success');
          if (closeAfterSave) handle.close('save');
        } else {
          toast('Saved to your shortcuts.', 'success');
        }
        return true;
      }

      function savePin(allowConflict, selectedConflict) {
        if (shortcutPad.saving) return false;
        var label = String(labelInput.value || '').replace(/^\s+|\s+$/g, '');
        var action = selectedActionId && actionForId(selectedActionId);
        if (!label) {
          labelInput.focus();
          showPinSaveError(new Error('Enter a display name for this pin.'));
          return false;
        }
        if (!action || action.id !== selectedActionId ||
            action.aeMapShortcut !== true ||
            action.deliveryRoute !== 'host-command' ||
            typeof action.commandId !== 'number' || !isFinite(action.commandId) ||
            action.commandId <= 0 ||
            action.commandIdSource !== 'verified-host-probe') {
          showPinSaveError(new Error(
            'Choose an available After Effects command with a verified numeric command ID.'));
          return false;
        }
        var nextHotkey = null;
        var physicalChord = '';
        try {
          nextHotkey = hotkey == null ? null : R.shortcutPads.normalizeHotkey(hotkey);
          physicalChord = nextHotkey
            ? R.shortcutPads.hotkeyChord(nextHotkey) : '';
          if (nextHotkey && !physicalChord) {
            throw new Error('Choose a supported shortcut.');
          }
        } catch (error) {
          showPinSaveError(error);
          return false;
        }
        var conflict = physicalChord
          ? findHotkeyConflict(physicalChord) : null;
        var approvedConflict = selectedConflict ||
          (allowPendingHotkeyConflict ? pendingHotkeyConflict : null);
        var approved = !!((allowConflict || allowPendingHotkeyConflict) &&
          approvedConflict && conflict && approvedConflict.id === conflict.id);
        if (conflict && !approved) {
          showPinSaveConflict(conflict);
          return false;
        }
        return persistPin(label, action, nextHotkey, physicalChord,
          approved ? conflict : null);
      }

      function persistPin(label, action, nextHotkey, physicalChord, conflict) {
        shortcutPad.saving = true;
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
        cancelButton.disabled = true;
        clearPinButton.disabled = true;
        saveError.hidden = true;
        saveConflictPanel.hidden = true;
        syncSelectedAction();
        syncHotkeyText();
        afterPaint(function () {
          if (!handle || !handle.isOpen()) {
            shortcutPad.saving = false;
            return;
          }
          var previousPads;
          var previousSavedPins = isEditing() ? clonePads(shortcutPad.savedPads) : [];
          var previousPendingPins = isEditing() ? clonePads(shortcutPad.pendingPads) : [];
          var previousDirty = shortcutPad.dirty;
          var previousBinding = R.globalHotkeys &&
            R.globalHotkeys.bindingFor('pad:' + current.id);
          var conflictId = conflict && conflict.id;
          var conflictPad = conflict && conflict.pad;
          var previousConflictBinding = conflict && conflict.id &&
            R.globalHotkeys.bindingFor(conflict.id);
          var saved = null;
          var bindingChanged = false;
          try {
            previousPads = clonePads(readShortcuts());
            var nextPads = clonePads(previousPads);
            var found = false;
            nextPads = nextPads.map(function (item) {
              if (item.id === current.id) {
                found = true;
                return {
                  id: item.id,
                  label: label,
                  actionId: action.id,
                  hotkey: nextHotkey,
                  pinnedSlot: item.pinnedSlot
                };
              }
              if (conflictPad && item.id === conflictPad.id) {
                return {
                  id: item.id,
                  label: item.label,
                  actionId: item.actionId,
                  hotkey: null,
                  pinnedSlot: item.pinnedSlot
                };
              }
              return item;
            });
            if (!found) throw new Error('This pin is no longer available.');
            var persisted = padApi.replaceAll(nextPads);
            saved = persisted.filter(function (item) { return item.id === current.id; })[0];
            if (!saved) throw new Error('This pin is no longer available.');
            syncGlobalHotkey(saved.id, nextHotkey, previousBinding, !!conflict);
            bindingChanged = true;
            if (isEditing()) updateSavedPin();
            render();
          } catch (error) {
            rollbackPinSave(previousPads, saved, previousBinding, conflictId,
              previousConflictBinding, bindingChanged, error);
            if (isEditing()) {
              shortcutPad.savedPads = previousSavedPins;
              shortcutPad.pendingPads = previousPendingPins;
              shortcutPad.dirty = previousDirty;
              try { render(); }
              catch (renderError) {
                if (R.log) R.log.error('Edit Pin rollback could not refresh the pad.', renderError);
              }
            }
            shortcutPad.saving = false;
            saveButton.disabled = false;
            saveButton.textContent = 'Save';
            cancelButton.disabled = false;
            clearPinButton.disabled = false;
            saveError.textContent = 'Couldn’t save this pin: ' +
              (error && error.message || 'An unknown error occurred.');
            saveError.hidden = false;
            if (R.log) R.log.error('Edit Pin could not be saved.', error);
            syncSelectedAction();
            syncHotkeyText();
            return;
          }
          shortcutPad.saving = false;
          current = saved;
          isNew = false;
          hotkey = saved.hotkey;
          original = {
            id: saved.id,
            label: saved.label,
            actionId: saved.actionId,
            hotkey: saved.hotkey,
            pinnedSlot: saved.pinnedSlot
          };
          pendingHotkeyConflict = null;
          allowPendingHotkeyConflict = false;
          handle.close('save');
          toast('Pin saved.', 'success');
        });
        return true;
      }

      function showPinSaveError(error) {
        if (R.log) R.log.error('Edit Pin validation or save failed.', error);
        saveError.textContent = 'Couldn’t save this pin: ' +
          (error && error.message || 'An unknown error occurred.');
        saveError.hidden = false;
        return false;
      }

      function showPinSaveConflict(conflict) {
        saveConflict = conflict;
        R.dom.clear(saveConflictPanel);
        saveConflictPanel.appendChild(el('strong', {
          text: 'Shortcut already used by ' + conflict.label
        }));
        saveConflictPanel.appendChild(el('span', {
          text: conflict.kind === 'after-effects'
            ? 'Replace routes this key to the pin while After Effects is active; the AE keymap itself is unchanged.'
            : 'Replace moves this shortcut from the other Shortcut Pad assignment.'
        }));
        saveConflictReplaceButton = el('button.rb-btn.is-primary', {
          type: 'button',
          onclick: function () { savePin(true, saveConflict); }
        }, ['Replace']);
        var chooseAnother = el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: function () {
            saveConflictPanel.hidden = true;
            saveConflict = null;
            pendingHotkeyConflict = null;
            allowPendingHotkeyConflict = false;
            openHotkeyBuilder();
          }
        }, ['Record another shortcut']);
        var cancelConflict = el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: function () {
            saveConflictPanel.hidden = true;
            saveConflict = null;
          }
        }, ['Cancel']);
        saveConflictPanel.appendChild(el('div.rb-shortcut-pad-conflict-actions', null, [
          saveConflictReplaceButton, chooseAnother, cancelConflict
        ]));
        saveConflictPanel.hidden = false;
        saveError.hidden = true;
      }

      function rollbackPinSave(previousPads, saved, previousBinding, conflictId,
          previousConflictBinding, bindingChanged, saveErrorValue) {
        var failures = [];
        if (previousPads) {
          try {
            padApi.replaceAll(previousPads);
          } catch (restoreError) {
            failures.push(restoreError.message || 'The saved pin data could not be restored.');
          }
        }
        if (R.globalHotkeys && saved) {
          try {
            if (previousBinding) {
              var restored = R.globalHotkeys.setBinding('pad:' + saved.id,
                previousBinding, { allowConflict: true });
              if (!restored || !restored.ok) failures.push('The previous shortcut binding could not be restored.');
            } else {
              var cleared = R.globalHotkeys.clearBinding('pad:' + saved.id);
              if (!cleared || !cleared.ok) failures.push('The attempted shortcut binding could not be cleared.');
            }
          } catch (bindingError) {
            failures.push(bindingError.message || 'The previous shortcut binding could not be restored.');
          }
        }
        if (R.globalHotkeys && conflictId && previousConflictBinding) {
          try {
            var restoredConflict = R.globalHotkeys.setBinding(
              conflictId, previousConflictBinding, { allowConflict: true });
            if (!restoredConflict || !restoredConflict.ok) {
              failures.push('The other shortcut binding could not be restored.');
            }
          } catch (conflictError) {
            failures.push(conflictError.message || 'The other shortcut binding could not be restored.');
          }
        }
        if (failures.length && R.log) {
          R.log.error('Edit Pin rollback was incomplete.', {
            cause: saveErrorValue,
            failures: failures,
            bindingChanged: bindingChanged
          });
        }
      }

      function syncGlobalHotkey(id, chord, previousChord, allowConflict) {
        var physicalChord = chord ? R.shortcutPads.hotkeyChord(chord) : '';
        if (!R.globalHotkeys) {
          if (physicalChord) throw new Error('Global hotkey support is unavailable.');
          return;
        }
        var bindingId = 'pad:' + id;
        if (physicalChord) {
          if (previousChord === physicalChord) return;
          var result = R.globalHotkeys.setBinding(bindingId, physicalChord, {
            allowConflict: !!allowConflict
          });
          if (!result || !result.ok) {
            throw new Error(result && result.error || 'Could not save this hotkey.');
          }
        } else if (previousChord) {
          var cleared = R.globalHotkeys.clearBinding(bindingId);
          if (!cleared || !cleared.ok) {
            throw new Error(cleared && cleared.error || 'Could not clear the previous hotkey.');
          }
        }
      }

      function rollbackSave(saved, previousBinding, saveError) {
        var failures = [];
        try {
          if (isNew && saved) {
            if (!padApi.remove(saved.id)) failures.push('The new shortcut could not be removed.');
          } else if (original) {
            padApi.update(original.id, {
              label: original.label,
              actionId: original.actionId,
              hotkey: original.hotkey
            });
          }
        } catch (rollbackError) {
          failures.push(rollbackError.message || 'The previous shortcut could not be restored.');
        }
        if (saved && R.globalHotkeys) {
          try {
            if (previousBinding) {
              var restored = R.globalHotkeys.setBinding('pad:' + saved.id, previousBinding, {
                allowConflict: true
              });
              if (!restored || !restored.ok) failures.push('The previous hotkey could not be restored.');
            } else {
              R.globalHotkeys.clearBinding('pad:' + saved.id);
            }
          } catch (bindingError) {
            failures.push(bindingError.message || 'The previous hotkey could not be restored.');
          }
        }
        if (failures.length && R.log) {
          R.log.error('Shortcut save rollback was incomplete.', failures);
        }
        toast((saveError.message || 'Could not save this shortcut.') +
          (failures.length ? ' ' + failures.join(' ') : ''), 'error');
      }
    }

    function showSlotPicker(handle, candidate) {
      var intro = el('p.rb-shortcut-pad-confirm-copy', {
        text: 'Your Shortcut Pad is full. Choose a shortcut to replace.'
      });
      var slotGrid = el('div.rb-shortcut-pad-grid.rb-shortcut-pad-slot-picker', {
        role: 'group',
        'aria-label': 'Choose a shortcut to replace'
      });
      for (var slot = 0; slot < SLOT_COUNT; slot++) {
        (function (slotIndex) {
          var oldPad = R.shortcutPads.atSlot(slotIndex);
          var oldLabel = oldPad && oldPad.label || 'Add shortcut';
          var button = el('button.rb-shortcut-pad-cell' + (oldPad ? '' : '.is-empty'), {
            type: 'button',
            'aria-label': [oldLabel, oldPad && chordFor(oldPad)].filter(Boolean).join(', '),
            onclick: function () {
              if (!oldPad) {
                replaceCandidate(handle, candidate, slotIndex, null);
              } else if (candidate.pad && candidate.pad.id === oldPad.id) {
                toast('That shortcut is already in this slot.', 'info');
              } else {
                showReplaceConfirmation(handle, candidate, slotIndex, oldPad, function () {
                  showSlotPicker(handle, candidate);
                });
              }
            }
          }, [
            el('span.rb-shortcut-pad-label', { text: oldLabel }),
            oldPad && chordFor(oldPad)
              ? el('span.rb-shortcut-pad-chord', { text: chordFor(oldPad) }) : null
          ].filter(Boolean));
          slotGrid.appendChild(button);
        })(slot);
      }
      var cancel = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: function () {
          if (candidate.createdFromAdd) toast('Saved to your shortcuts.', 'success');
          handle.close('cancel');
        }
      }, ['Cancel']);
      setDialogView(handle, 'Shortcut Pad full',
        el('div.rb-shortcut-pad-slot-flow', null, [intro, slotGrid]), [cancel]);
    }

    function showReplaceConfirmation(handle, candidate, slot, oldPad, onCancel) {
      var message = el('p.rb-shortcut-pad-confirm-copy', {
        text: 'Replace ' + oldPad.label + ' with ' + candidate.label + '?'
      });
      var cancel = el('button.rb-btn.is-ghost', {
        type: 'button',
        onclick: onCancel
      }, ['Cancel']);
      var replace = el('button.rb-btn.is-primary', {
        type: 'button',
        onclick: function () {
          var currentOccupant = R.shortcutPads.atSlot(slot);
          if (!currentOccupant || currentOccupant.id !== oldPad.id) {
            toast('The pad changed. Choose a slot again.', 'warn');
            showSlotPicker(handle, candidate);
            return;
          }
          replaceCandidate(handle, candidate, slot, oldPad);
        }
      }, ['Replace']);
      setDialogView(handle, 'Replace shortcut',
        el('div.rb-shortcut-pad-confirm', null, [message]), [cancel, replace]);
    }

    function replaceCandidate(handle, candidate, slot) {
      try {
        var pad = candidate.pad;
        if (!pad) {
          pad = padApi.add(candidate.label, candidate.actionId, candidate.hotkey || null, null);
        }
        var replaced = padApi.replaceAt(pad.id, slot);
        if (!replaced) throw new Error('Could not add that shortcut to the pad.');
        render();
        toast('Added to Shortcut Pad.', 'success');
        handle.close('replace');
      } catch (error) {
        toast(error.message || 'Could not replace that shortcut.', 'error');
      }
    }

    function setDialogView(handle, dialogTitle, bodyNode, footerButtons) {
      if (!handle || !handle.isOpen()) return;
      var titleNode = handle.box.querySelector('.rb-modal-title');
      var body = handle.box.querySelector('.rb-modal-body');
      var footer = handle.box.querySelector('.rb-modal-foot');
      if (titleNode) titleNode.textContent = dialogTitle;
      if (body) {
        R.dom.clear(body);
        body.appendChild(bodyNode);
      }
      if (footer) {
        R.dom.clear(footer);
        (footerButtons || []).forEach(function (button) { footer.appendChild(button); });
      }
    }

    function bindEvents() {
      function refreshCatalog() {
        actionOptionsCache = null;
        libraryItemsCache = null;
        render();
      }
      var offPads = R.bus ? R.bus.on('ae-shortcut-pads:updated', refreshCatalog) : function () {};
      var offMap = R.bus ? R.bus.on('ae-shortcut-map:updated', refreshCatalog) : function () {};
      var offMapError = R.bus ? R.bus.on('ae-shortcut-map:error', refreshCatalog) : function () {};
      var offRoutes = R.bus
        ? R.bus.on('ae-shortcut-runtime-commands:updated', refreshCatalog) : function () {};
      return function () {
        offPads();
        offMap();
        offMapError();
        offRoutes();
      };
    }

    var offEvents = bindEvents();
    if (window.ResizeObserver) {
      resizeObserver = new window.ResizeObserver(scheduleFit);
      resizeObserver.observe(root);
    } else {
      window.addEventListener('resize', scheduleFit);
    }
    render();

    return {
      destroy: function () {
        disposed = true;
        offEvents();
        if (resizeObserver) resizeObserver.disconnect();
        else window.removeEventListener('resize', scheduleFit);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  R.shortcutPadWidget = { mount: mount };
})(window.Rebound = window.Rebound || {});
