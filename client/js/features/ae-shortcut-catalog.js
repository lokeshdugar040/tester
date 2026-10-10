/*
 * Browse and launch the active After Effects shortcut map.
 */
;(function (R) {
  'use strict';

  var el = R.dom.el;
  var CATEGORY_KEY = 'ae-shortcuts-category';
  var SEARCH_KEY = 'ae-shortcuts-search';
  var RECENT_CATEGORY = '__recent__';
  var WORKFLOW_CATEGORIES = R.aeShortcutMap && R.aeShortcutMap.workflowCategories
    ? R.aeShortcutMap.workflowCategories.slice() : ['Needs Review'];
  R.tools.register({
    id: 'ae-shortcuts',
    title: 'Shortcut Pad',
    group: 'Workflow',
    order: 80,
    keywords: ['after effects', 'keyboard', 'shortcut pad', 'hotkey', 'keymap', 'drum pad'],
    mount: mount
  });

  function mount(ctx) {
    if (ctx.widget && R.shortcutPadWidget) return R.shortcutPadWidget.mount(ctx);
    return mountCatalog(ctx);
  }

  function mountCatalog(ctx) {
    var widget = !!ctx.widget;
    var padApi = ctx.shortcutPads || (R.shell && R.shell.shortcutPads);
    var category = R.disk && R.disk.read ? R.disk.read(CATEGORY_KEY, '*') : '*';
    if (typeof category !== 'string' || !category) category = '*';
    var query = R.disk && R.disk.read ? R.disk.read(SEARCH_KEY, '') : '';
    if (typeof query !== 'string') query = '';
    var padsEditing = false;
    var mapError = null;
    var widgetSearchOpen = false;
    var selectedPadId = null;
    var searchSaveTimer = null;
    var padResizeObserver = null;
    var padResizeFallback = false;
    var padStates = {};
    var root = el('div.rb-aeshortcuts' + (widget ? '.rb-aeshortcuts-widget' : '.rb-aeshortcuts-full'));
    var categorySelect = el('select.rb-wgt-picksel', { 'aria-label': 'Shortcut workflow category' });
    var searchInput = el('input.rb-aeshortcuts-search', {
      type: 'search',
      placeholder: 'Search actions or keys',
      'aria-label': 'Search After Effects actions or keys',
      value: query
    });
    var browseToolbar = el('div.rb-aeshortcuts-toolbar', null, [
      categorySelect,
      searchInput
    ]);
    var grid = el('div.rb-aeshortcuts-grid', { 'aria-label': 'Shortcut catalog' });
    var summary = el('div.rb-aeshortcuts-summary');
    var status = el('div.rb-aeshortcuts-status');

    var searchToggle = el('button.rb-aeshortcuts-iconbutton', {
      type: 'button',
      title: 'Search all shortcuts',
      'aria-label': 'Search all shortcuts',
      'aria-expanded': 'false',
      onclick: toggleWidgetSearch
    });
    searchToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>';
    var menuButton = el('button.rb-aeshortcuts-iconbutton', {
      type: 'button',
      title: 'Shortcut widget menu',
      'aria-label': 'Shortcut widget menu',
      onclick: openShortcutMenu
    });
    menuButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.8.1 1.7 1.7 0 0 0-.9 1.5v.2h-3.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8-.1l-.2.1-1.7-2.9.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6v-3.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L9 4.7l.2.1a1.7 1.7 0 0 0 1.8-.1 1.7 1.7 0 0 0 .9-1.5V3h3.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8.1l.2-.1 1.7 2.9-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    var padList = el('div.rb-aeshortcuts-padgrid');
    var padSummary = el('div.rb-aeshortcuts-summary');
    var padsSection = el('section.rb-aeshortcuts-pads', { 'aria-label': 'Pinned shortcut drum pad' }, [
      el('div.rb-aeshortcuts-padhead', null, [
        el('span.rb-aeshortcuts-padhelp', { text: widget ? 'Shortcut Pad' : 'Pinned actions' }),
        el('div.rb-aeshortcuts-padtools', null, [
          widget ? searchToggle : null,
          menuButton
        ].filter(Boolean))
      ]),
      padList,
      el('div.rb-aeshortcuts-footer', null, [padSummary])
    ]);

    root.appendChild(padsSection);
    root.appendChild(browseToolbar);
    root.appendChild(grid);
    root.appendChild(el('div.rb-aeshortcuts-footer', null, [summary]));
    root.appendChild(status);
    if (widget) {
      ctx.body.style.overflow = 'hidden';
      ctx.body.style.padding = '0';
      categorySelect.hidden = true;
      browseToolbar.hidden = true;
      grid.hidden = true;
    }
    ctx.body.appendChild(root);
    if (window.ResizeObserver) {
      padResizeObserver = new window.ResizeObserver(fitPadColumns);
      padResizeObserver.observe(padList);
    } else {
      padResizeFallback = true;
      window.addEventListener('resize', fitPadColumns);
    }

    categorySelect.addEventListener('change', function () {
      category = categorySelect.value;
      if (R.disk && !R.disk.write(CATEGORY_KEY, category) && ctx.toast) {
        ctx.toast('Could not save the selected shortcut category.', { kind: 'error' });
      }
      renderBrowse();
    });
    searchInput.addEventListener('input', function () {
      query = searchInput.value.toLowerCase().replace(/^\s+|\s+$/g, '');
      if (searchSaveTimer) window.clearTimeout(searchSaveTimer);
      searchSaveTimer = window.setTimeout(function () {
        searchSaveTimer = null;
        if (R.disk && !R.disk.write(SEARCH_KEY, query) && ctx.toast) {
          ctx.toast('Could not save the shortcut search preference.', { kind: 'error' });
        }
      }, 250);
      renderPads();
      if (widget && widgetSearchOpen) renderWidgetSearch();
      else renderBrowse();
    });
    function toggleWidgetSearch() {
      if (!widget) return;
      widgetSearchOpen = !widgetSearchOpen;
      root.classList.toggle('is-searching', widgetSearchOpen);
      searchToggle.setAttribute('aria-expanded', widgetSearchOpen ? 'true' : 'false');
      searchToggle.setAttribute('aria-label', widgetSearchOpen
        ? 'Close shortcut search' : 'Search all shortcuts');
      searchToggle.title = widgetSearchOpen ? 'Close shortcut search' : 'Search all shortcuts';
      browseToolbar.hidden = !widgetSearchOpen;
      grid.hidden = !widgetSearchOpen;
      padList.hidden = widgetSearchOpen;
      if (!widgetSearchOpen) {
        query = '';
        searchInput.value = '';
        if (searchSaveTimer) window.clearTimeout(searchSaveTimer);
        searchSaveTimer = null;
        if (R.disk && !R.disk.write(SEARCH_KEY, '') && ctx.toast) {
          ctx.toast('Could not clear the shortcut search.', { kind: 'error' });
        }
        renderPads();
      } else {
        searchInput.focus();
        renderWidgetSearch();
      }
    }

    function fitPadColumns() {
      if (!padList || !padApi || !padApi.columns) return;
      Array.prototype.forEach.call(
        padList.querySelectorAll('.rb-home-shortcut-group-grid'),
        function (gridNode) {
          var gap = 6;
          var minCellWidth = 42;
          var availableWidth = gridNode.clientWidth || padList.clientWidth;
          var widthColumns = Math.max(1,
            Math.floor((availableWidth + gap) / (minCellWidth + gap)));
          var preferredColumns = padApi.columns();
          var columnsForWidth = Math.min(preferredColumns, widthColumns);
          gridNode.style.gridTemplateColumns =
            'repeat(' + columnsForWidth + ', minmax(0, 1fr))';
        }
      );
    }

    function readEntries() {
      return R.afterEffectsShortcuts && R.afterEffectsShortcuts.catalogEntries
        ? R.afterEffectsShortcuts.catalogEntries().filter(function (entry) {
          return !!entry && !!entry.label &&
            (!!entry.activeChord || (entry.sequence && entry.sequence.length > 1));
        }) : [];
    }

    function readPads() {
      return padApi && padApi.all ? padApi.all() : [];
    }

    function renderCategories(entries) {
      var counts = {};
      entries.forEach(function (entry) {
        counts[entry.category] = (counts[entry.category] || 0) + 1;
      });
      if (category !== '*' && category !== RECENT_CATEGORY &&
          WORKFLOW_CATEGORIES.indexOf(category) === -1) category = '*';
      R.dom.clear(categorySelect);
      categorySelect.appendChild(el('option', { value: '*', text: 'All workflows · ' + entries.length }));
      var recentCount = R.shortcutDiagnostics && R.shortcutDiagnostics.recent
        ? R.shortcutDiagnostics.recent().length : 0;
      categorySelect.appendChild(el('option', {
        value: RECENT_CATEGORY,
        text: 'Recently used · ' + recentCount
      }));
      WORKFLOW_CATEGORIES.forEach(function (value) {
        categorySelect.appendChild(el('option', {
          value: value,
          text: value + ' · ' + (counts[value] || 0)
        }));
      });
      categorySelect.value = category;
    }

    function filteredEntries(entries) {
      var recentIds = category === RECENT_CATEGORY && R.shortcutDiagnostics &&
        R.shortcutDiagnostics.recent ? R.shortcutDiagnostics.recent() : [];
      return entries.filter(function (entry) {
        if (category === RECENT_CATEGORY && recentIds.indexOf(entry.actionId) === -1) return false;
        if (category !== '*' && category !== RECENT_CATEGORY && entry.category !== category) return false;
        if (!query) return true;
        var haystack = (entry.label + ' ' + entry.category + ' ' +
          entry.context + ' ' + entry.activeKeymapCommandId + ' ' + entry.shortcut).toLowerCase();
        return haystack.indexOf(query) !== -1;
      });
    }

    function widgetSearchItems() {
      var items = [];
      readPads().forEach(function (pad) {
        var resolution = padApi && padApi.resolve ? padApi.resolve(pad) : null;
        items.push({
          type: 'pad',
          key: 'pad:' + pad.id,
          id: pad.id,
          actionId: pad.actionId,
          pinId: pad.pinId || pad.id,
          label: pad.label,
          chord: resolution && (resolution.displayChord || resolution.activeChord) || ''
        });
      });
      if (R.afterEffectsShortcuts && R.afterEffectsShortcuts.catalogEntries) {
        R.afterEffectsShortcuts.catalogEntries().forEach(function (entry) {
          items.push({
            type: 'ae',
            key: 'ae:' + entry.actionId,
            id: entry.actionId,
            actionId: entry.actionId,
            label: entry.label,
            chord: entry.displayChord || ''
          });
        });
      }
      var actions = R.homeActions && R.homeActions.shortcutCatalog
        ? R.homeActions.shortcutCatalog() : [];
      actions.forEach(function (item) {
        if (!item || item.source !== 'rebound' || !item.action) return;
        items.push({
          type: 'rebound',
          key: 'rebound:' + item.id,
          id: item.id,
          actionId: item.id,
          label: item.label,
          chord: ''
        });
      });
      return items;
    }

    function runWidgetSearchItem(item, button, statusNode) {
      button.disabled = true;
      button.classList.add('is-running');
      statusNode.textContent = 'Running';
      var operation = item.type === 'pad' && R.actionRouter.executePin
        ? R.actionRouter.executePin(item.pinId, {
          kind: 'shortcut-search',
          actorCategory: 'human-user',
          pinId: item.pinId
        })
        : R.actionRouter.executeAction(item.actionId, {
          kind: 'shortcut-search',
          actorCategory: 'human-user'
        });
      Promise.resolve(operation).then(function (result) {
        statusNode.textContent = result.state;
        button.title = result.userMessage;
        button.classList.remove('is-running');
        button.classList.toggle('is-done', result.state === 'Done');
        button.classList.toggle('is-failed',
          result.state === 'Failed' || result.state === 'Unsupported');
        button.disabled = false;
        if (ctx.toast && result.userMessage) {
          ctx.toast(result.userMessage, {
            kind: result.verified ? 'success' : result.state === 'Ready' ? 'warn' : 'error'
          });
        }
      }).catch(function (err) {
        statusNode.textContent = 'Failed';
        button.classList.remove('is-running');
        button.classList.add('is-failed');
        button.disabled = false;
        if (ctx.toast) ctx.toast(err && err.message || 'Could not run this shortcut.', { kind: 'error' });
      });
    }

    function renderWidgetSearch() {
      if (!widget || !widgetSearchOpen) return;
      var queryValue = String(searchInput.value || '').toLowerCase()
        .replace(/^\s+|\s+$/g, '');
      var results = widgetSearchItems().filter(function (item) {
        if (!queryValue) return false;
        return (item.label + ' ' + item.category + ' ' + item.chord)
          .toLowerCase().indexOf(queryValue) !== -1;
      });
      R.dom.clear(grid);
      if (!queryValue) {
        grid.appendChild(el('div.rb-aeshortcuts-empty', {
          text: 'Search all After Effects shortcuts, Rebound actions, and pinned pads.'
        }));
      } else if (!results.length) {
        grid.appendChild(el('div.rb-aeshortcuts-empty', { text: 'No shortcuts match this search.' }));
      } else {
        results.forEach(function (item) {
          var statusNode = el('span.rb-aeshortcuts-search-status.rb-aeshortcuts-meta', {
            text: item.chord ? '' : 'Mapping unavailable — assign an action or check AE keymap.'
          });
          var resultButton = el('button.rb-aeshortcuts-search-result', {
            type: 'button',
            'aria-label': [item.label, item.chord]
              .filter(Boolean).join(', '),
            onclick: function () { runWidgetSearchItem(item, resultButton, statusNode); }
          }, [
            el('span.rb-aeshortcuts-search-label', { text: item.label }),
            el('span.rb-aeshortcuts-keylist', {
              text: item.chord || 'Mapping unavailable — assign an action or check AE keymap.'
            }),
            statusNode
          ]);
          grid.appendChild(resultButton);
        });
      }
      summary.textContent = results.length + ' result' + (results.length === 1 ? '' : 's');
    }

    function send(entry, button) {
      var meta = button && button.querySelector('.rb-aeshortcuts-meta');
      if (meta) meta.textContent = 'Running';
      if (button) button.disabled = true;
      R.actionRouter.executeAction(entry.actionId, {
        kind: 'ae-catalog',
        actorCategory: 'human-user'
      }).then(function (result) {
        if (meta) meta.textContent = result.state;
        if (button) {
          button.title = result.userMessage;
          button.disabled = false;
        }
        if (ctx.toast && result.userMessage) {
          ctx.toast(result.userMessage, {
            kind: result.verified ? 'success' : result.state === 'Ready' ? 'warn' : 'error',
            duration: 6000
          });
        }
      }).catch(function (err) {
        if (meta) meta.textContent = 'Failed';
        if (button) button.disabled = false;
        if (ctx.toast) ctx.toast((err && err.message) || ('Could not run ' + entry.label), { kind: 'error' });
      });
    }

    function tile(entry, pinnedIds) {
      var chord = entry.displayChord ||
        'Mapping unavailable — assign an action or check AE keymap.';
      var run = el('button.rb-aeshortcuts-run', {
        type: 'button',
        title: chord,
        'aria-label': [entry.label, chord].filter(Boolean).join(', '),
        onclick: function () { send(entry, run); }
      }, [
        el('span.rb-aeshortcuts-text', null, [
          el('span.rb-aeshortcuts-label', { text: entry.label }),
          el('span.rb-aeshortcuts-meta', { text: '' })
        ]),
        el('span.rb-aeshortcuts-keylist', { text: chord })
      ]);
      var pinButton = el('button.rb-aeshortcuts-pin', {
        type: 'button',
        title: 'Pin to the drum pad',
        'aria-label': 'Pin ' + entry.label + ' to the drum pad',
        disabled: !padApi || !padApi.pinAction ||
          !entry.actionId ||
          !!pinnedIds[entry.actionId],
        onclick: function () {
          try {
            if (padApi.pinAction(entry.actionId)) {
              renderPads();
              if (ctx.toast) ctx.toast(entry.label + ' pinned to the drum pad.', { kind: 'success' });
            }
          } catch (err) {
            if (ctx.toast) ctx.toast(err.message || 'Could not pin this action.', { kind: 'error' });
          }
        }
      }, ['+']);
      return el('div.rb-aeshortcuts-row', null, [run, pinButton]);
    }

    function updateStatus(entries) {
      if (mapError || !R.afterEffectsShortcuts || !R.afterEffectsShortcuts.keymapLoaded ||
          !R.afterEffectsShortcuts.keymapLoaded()) {
        status.textContent = 'Mapping unavailable — assign an action or check AE keymap.';
      } else {
        status.textContent = entries.length + ' shortcuts in the active AE keymap.';
      }
    }

    function renderBrowse() {
      if (widget) {
        if (widgetSearchOpen) renderWidgetSearch();
        return;
      }
      var entries = readEntries();
      renderCategories(entries);
      var filtered = filteredEntries(entries);
      if (category === RECENT_CATEGORY && R.shortcutDiagnostics && R.shortcutDiagnostics.recent) {
        var recentIds = R.shortcutDiagnostics.recent();
        filtered.sort(function (a, b) {
          return recentIds.indexOf(a.actionId) - recentIds.indexOf(b.actionId);
        });
      }
      var pinnedIds = {};
      readPads().forEach(function (pad) {
        if (pad.actionType === 'ae-command' || pad.actionType === 'rebound') {
          pinnedIds[pad.actionId] = true;
        }
      });
      R.dom.clear(grid);
      if (!filtered.length) {
        grid.appendChild(el('div.rb-aeshortcuts-empty', {
          text: mapError || !R.afterEffectsShortcuts || !R.afterEffectsShortcuts.keymapLoaded ||
            !R.afterEffectsShortcuts.keymapLoaded()
            ? 'Mapping unavailable — assign an action or check AE keymap.'
            : 'No shortcuts match this search.'
        }));
      } else {
        filtered.forEach(function (entry) { grid.appendChild(tile(entry, pinnedIds)); });
      }
      summary.textContent = filtered.length + ' shortcut' + (filtered.length === 1 ? '' : 's');
      updateStatus(entries);
    }

    function keyLabel(key) {
      return R.aeShortcutMap && R.aeShortcutMap.displayChord
        ? R.aeShortcutMap.displayChord(key) : key;
    }

    function appendKeycaps(button, chord) {
      var strip = el('span.rb-home-shortcut-keycaps');
      String(chord || '').split(' \u2192 ').forEach(function (step, stepIndex) {
        if (stepIndex) strip.appendChild(el('span.rb-home-shortcut-keyjoin', { text: '\u2192' }));
        step.split('+').forEach(function (key, index) {
          if (index) strip.appendChild(el('span.rb-home-shortcut-keyjoin', { text: '+' }));
          strip.appendChild(el('kbd.rb-home-shortcut-keycap', { text: keyLabel(key) }));
        });
      });
      button.appendChild(strip);
    }

    function applyPadColor(button, color) {
      if (!color) return;
      var red = parseInt(color.slice(1, 3), 16);
      var green = parseInt(color.slice(3, 5), 16);
      var blue = parseInt(color.slice(5, 7), 16);
      button.style.setProperty('--rb-shortcut-pad-rgb', red + ', ' + green + ', ' + blue);
    }

    function cleanPadStatus(statusValue) {
      if (statusValue === 'Needs Layer' || statusValue === 'Needs Selected Layer' ||
          statusValue === 'Needs Mask' || statusValue === 'Needs Mask Selection' ||
          statusValue === 'Needs Keyframes' || statusValue === 'Needs Selected Keyframes') {
        return 'Needs Selection';
      }
      if (statusValue === 'Needs Viewer') return 'Needs Composition';
      if (statusValue === 'Ready' || statusValue === 'Needs Composition' ||
          statusValue === 'Needs Selection' || statusValue === 'Needs Timeline' ||
          statusValue === 'Running' || statusValue === 'Done' ||
          statusValue === 'Failed' || statusValue === 'Unsupported') return statusValue;
      return 'Unsupported';
    }

    function padCategory(value) {
      if (/layer/i.test(value)) return 'Layer Management';
      if (/keyframe|graph|animation/i.test(value)) return 'Keyframes';
      if (/mask|matte/i.test(value)) return 'Masks';
      if (/timeline|marker|properties/i.test(value)) return 'Timeline';
      if (/composition|comp/i.test(value)) return 'Composition';
      if (/tool|tracking|navigation|camera/i.test(value)) return 'Tools';
      if (/rebound/i.test(value)) return 'Rebound Tools';
      if (/eas|physics|motion|effect|text|render|audio|timing|generator|general|project|file/i.test(value)) {
        return 'Animation';
      }
      return value ? 'Tools' : 'Rebound Tools';
    }

    function runPad(pad, button) {
      if (!pad || !(pad.pinId || pad.id) || !R.actionRouter ||
          !R.actionRouter.executePin) {
        if (ctx.toast) ctx.toast('This shortcut pad is invalid.', { kind: 'error' });
        return;
      }
      setPadButtonStatus(pad, button, 'Running');
      button.disabled = true;
      button.classList.add('is-sending');
      function finish(message) {
        button.classList.remove('is-sending');
        button.disabled = false;
        if (message) button.title = message;
      }
      var operation;
      try {
        operation = R.actionRouter.executePin(pad.pinId || pad.id, {
            kind: 'shortcut-pad',
            actorCategory: 'human-user',
            pinId: pad.pinId || pad.id
          });
      } catch (error) {
        operation = Promise.reject(error);
      }
      Promise.resolve(operation).then(function (result) {
        var status = cleanPadStatus(result && result.state || 'Unsupported');
        setPadButtonStatus(pad, button, status);
        finish(result && result.userMessage || '');
        if (result && result.state === 'Done' && result.verified === true &&
            ctx.toast) {
          ctx.toast(result.userMessage || pad.label + ' completed.', { kind: 'success' });
        } else if (result && result.userMessage && ctx.toast) {
          ctx.toast(result.userMessage, {
            kind: result.verified ? 'success' : result.state === 'Ready' ? 'warn' : 'error'
          });
        }
      }).catch(function (error) {
        setPadButtonStatus(pad, button, 'Failed');
        var message = 'Couldn’t run "' + (pad.displayName || pad.label || 'Shortcut') +
          '". Open Edit Pin to repair it.';
        finish(message);
        if (ctx.toast) ctx.toast(message, { kind: 'error' });
      });
    }

    function setPadButtonStatus(pad, button, statusValue) {
      padStates[pad.id] = statusValue;
      var statusNode = button.querySelector('.rb-home-shortcut-action');
      if (statusNode) statusNode.textContent = statusValue;
      button.classList.toggle('is-running', statusValue === 'Running');
      button.classList.toggle('is-done', statusValue === 'Done');
      button.classList.toggle('is-failed', statusValue === 'Failed');
      button.setAttribute('aria-label', [
        pad.label, button.getAttribute('data-chord'), padStates[pad.id]
      ].filter(Boolean).join(', '));
    }

    function openPadEditor(id, isNew) {
      if (!padApi || !padApi.openEditor || !padApi.openEditor(id, isNew)) {
        if (ctx.toast) ctx.toast('Could not open the Quick Pad editor.', { kind: 'error' });
      }
    }

    function openShortcutMenu() {
      if (!R.ui || !R.ui.modal) {
        if (ctx.toast) ctx.toast('Shortcut widget menu is unavailable.', { kind: 'error' });
        return;
      }
      var menuItems = [];
      var menuHandle;
      function menuItem(label, action) {
        var button = el('button.rb-aeshortcuts-menu-item', {
          type: 'button',
          onclick: function () {
            if (menuHandle) menuHandle.close('confirm');
            action();
          }
        }, [label]);
        menuItems.push(button);
        return button;
      }
      function closeButton() {
        if (menuHandle) menuHandle.close('cancel');
      }
      var body = el('div.rb-col.rb-aeshortcuts-menu', null, [
        menuItem('Manage widgets', function () {
          var home = R.shell && R.shell.homeScreen;
          if (!home || !home.setEditing) {
            if (ctx.toast) ctx.toast('Home widget management is unavailable.', { kind: 'error' });
            return;
          }
          home.setEditing(true);
        }),
        menuItem('Shortcut settings', function () {
          if (!R.settings || !R.settings.openShortcutSettings ||
              !R.settings.openShortcutSettings()) {
            if (ctx.toast) ctx.toast('Shortcut settings are unavailable.', { kind: 'error' });
          }
        }),
        menuItem('Add shortcut', function () { openPadEditor(null, true); }),
        menuItem(padsEditing ? 'Finish editing shortcuts' : 'Edit shortcuts', function () {
          padsEditing = !padsEditing;
          renderPads();
        }),
        menuItem('Reset shortcuts', function () {
          if (typeof window.confirm !== 'function' ||
              !window.confirm('Reset the Shortcut Pad to its default layout? Custom pins will be removed.')) {
            return;
          }
          try {
            if (!padApi || !padApi.reset) throw new Error('Shortcut reset is unavailable.');
            padApi.reset();
            padsEditing = false;
            selectedPadId = null;
            padStates = {};
            renderPads();
            if (ctx.toast) ctx.toast('Shortcut Pad reset and saved on this device.', { kind: 'success' });
          } catch (err) {
            if (ctx.toast) ctx.toast(err.message || 'Could not reset the Shortcut Pad.', { kind: 'error' });
          }
        }),
        menuItem('Help', function () {
          R.ui.modal({
            title: 'Shortcut Pad help',
            width: 420,
            body: el('div.rb-col.rb-aeshortcuts-help', null, [
              el('p', { text: 'Tap a pad to run its action. Use the search icon to find any mapped After Effects shortcut, Rebound action, or pinned shortcut.' }),
              el('p', { text: 'Choose Edit shortcuts to rename pads, change their icon or color, record a key, reorder them, or remove them. Save writes changes to your Rebound user data.' }),
              el('p', { text: 'A pad shows Done only after the intended result is observed. Delivery alone is not proof that After Effects ran the action.' })
            ])
          });
        })
      ]);
      menuHandle = R.ui.modal({
        title: 'Shortcut widget menu',
        width: 380,
        className: 'rb-modal-shortcut-widget-menu',
        body: body,
        footer: [el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: closeButton
        }, ['Close'])],
        initialFocus: menuItems[0]
      });
    }

    function movePad(pad, offset) {
      try {
        if (!padApi || !padApi.move || !padApi.move(pad.id, offset)) return;
      } catch (err) {
        if (ctx.toast) ctx.toast(err.message || 'Could not reorder shortcut pads.', { kind: 'error' });
      }
    }

    function renderPads() {
      var pads = readPads();
      R.dom.clear(padList);
      padsSection.classList.toggle('is-editing', padsEditing);

      if (!pads.length && !widget) {
        padList.appendChild(el('div.rb-aeshortcuts-empty', {
          text: 'No pinned actions yet. Use + beside an action below, or add a custom pad.'
        }));
      } else {
        var groups = {};
        var groupOrder = [
          'Shortcut Pad',
          'Layer Management', 'Animation', 'Keyframes', 'Masks',
          'Timeline', 'Composition', 'Tools', 'Rebound Tools'
        ];
        var visible = pads.map(function (pad, index) {
          var resolution = padApi && padApi.resolve ? padApi.resolve(pad) : null;
          var category = widget ? 'Shortcut Pad'
            : padCategory(resolution && resolution.category || '');
          return { pad: pad, index: index, resolution: resolution, category: category };
        }).filter(function (item) {
          if (!query) return true;
          var text = (item.pad.label + ' ' + item.category + ' ' +
            (item.resolution && item.resolution.chord || '')).toLowerCase();
          return text.indexOf(query) !== -1;
        });
        visible.forEach(function (item) {
          if (!groups[item.category]) groups[item.category] = [];
          groups[item.category].push(item);
        });
        if (widget && !groups['Shortcut Pad']) groups['Shortcut Pad'] = [];
        groupOrder.forEach(function (category) {
          if (!groups[category] || (!groups[category].length && !widget)) return;
          var group = el('section.rb-home-shortcut-group');
          if (!widget) group.appendChild(el('div.rb-home-shortcut-group-title', {
            text: category + ' · ' + groups[category].length
          }));
          var groupGrid = el('div.rb-home-shortcut-group-grid');
          groups[category].forEach(function (entry) {
          var pad = entry.pad;
          var index = entry.index;
          var name = pad.label || 'Shortcut';
          var resolution = entry.resolution;
          var unavailable = !!(pad.enabled === false ||
            resolution && !resolution.enabled);
          var detail = unavailable ? 'Action unavailable'
            : padStates[pad.id] || '';
          var button = el('button.rb-home-shortcut-button', {
            type: 'button',
            'data-chord': resolution && resolution.chord || '',
            'aria-label': [name, resolution && resolution.chord, detail].filter(Boolean).join(', '),
            title: [name, pad.menuPath || resolution && resolution.menuPath,
              resolution && resolution.chord, unavailable
                ? pad.unavailableReason || 'Edit this pin to repair its action.'
                : detail].filter(Boolean).join(' · '),
            onclick: function () {
              selectedPadId = pad.id;
              Array.prototype.forEach.call(
                padList.querySelectorAll('.rb-home-shortcut-button.is-selected'),
                function (selected) { selected.classList.remove('is-selected'); }
              );
              button.classList.add('is-selected');
              if (padsEditing || unavailable) openPadEditor(pad.id, false);
              else runPad(pad, button);
            }
          });
          button.classList.toggle('is-selected', padsEditing || selectedPadId === pad.id);
          button.classList.toggle('is-running', detail === 'Running');
          button.classList.toggle('is-done', detail === 'Done');
          button.classList.toggle('is-failed', detail === 'Failed');
          button.classList.toggle('is-unavailable', unavailable);
          applyPadColor(button, pad.color);
          if (R.toolMeta && R.toolMeta.ICONS && R.toolMeta.svg) {
            var iconMarkup = R.toolMeta.ICONS[pad.icon || 'keyboard'];
            if (iconMarkup) {
              var icon = el('span.rb-home-shortcut-icon');
              icon.innerHTML = R.toolMeta.svg(iconMarkup);
              button.appendChild(icon);
            }
          }
          button.appendChild(el('span.rb-home-shortcut-name', { text: name }));
          button.appendChild(el('span.rb-home-shortcut-action', {
            text: detail,
            title: unavailable
              ? pad.unavailableReason || 'Edit this pin to repair its action.' : ''
          }));
          if (resolution && resolution.chord) appendKeycaps(button, resolution.chord);

          var item = el('div.rb-home-shortcut-item' + (padsEditing ? '.is-editing' : ''));
          if (padsEditing) {
            var controls = el('div.rb-home-shortcut-edittools', null, [
              el('button.rb-home-shortcut-move', {
                type: 'button',
                title: 'Move earlier',
                'aria-label': 'Move ' + name + ' earlier',
                disabled: index === 0,
                onclick: function () { movePad(pad, -1); }
              }, ['↑']),
              el('button.rb-home-shortcut-remove', {
                type: 'button',
                title: 'Remove ' + name,
                'aria-label': 'Remove ' + name,
                onclick: function () {
                  try {
                    if (padApi.remove(pad.id)) renderPads();
                  } catch (err) {
                    if (ctx.toast) ctx.toast(err.message || 'Could not remove this pad.', { kind: 'error' });
                  }
                }
              }, ['×']),
              el('button.rb-home-shortcut-move', {
                type: 'button',
                title: 'Move later',
                'aria-label': 'Move ' + name + ' later',
                disabled: index === pads.length - 1,
                onclick: function () { movePad(pad, 1); }
              }, ['↓'])
            ]);
            item.appendChild(controls);
          }
          item.appendChild(button);
          groupGrid.appendChild(item);
          });
          if (widget && category === 'Shortcut Pad') {
            var addItem = el('div.rb-home-shortcut-item');
            var addButton = el('button.rb-home-shortcut-button.rb-home-shortcut-add', {
              type: 'button',
              'aria-label': 'Add shortcut',
              title: 'Add a shortcut to the pad',
              onclick: function () { openPadEditor(null, true); }
            }, [
              el('span.rb-home-shortcut-add-icon', { text: '+' }),
              el('span.rb-home-shortcut-name', { text: 'Add' }),
              el('span.rb-home-shortcut-action', { text: 'Shortcut' })
            ]);
            addItem.appendChild(addButton);
            groupGrid.appendChild(addItem);
          }
          group.appendChild(groupGrid);
          padList.appendChild(group);
        });
      }

      var visibleCount = padList.querySelectorAll('.rb-home-shortcut-item').length;
      padSummary.textContent = query
        ? visibleCount + ' of ' + pads.length + ' pinned actions'
        : pads.length + ' pinned action' + (pads.length === 1 ? '' : 's');
      fitPadColumns();
    }

    var offUpdated = R.bus ? R.bus.on('ae-shortcut-map:updated', function () {
      mapError = null;
      renderPads();
      if (widget && widgetSearchOpen) renderWidgetSearch();
      else renderBrowse();
    }) : function () {};
    var offError = R.bus ? R.bus.on('ae-shortcut-map:error', function () {
      mapError = true;
      renderPads();
      renderBrowse();
    }) : function () {};
    var offRuntime = R.bus ? R.bus.on('ae-shortcut-runtime-commands:updated', function () {
      renderPads();
      renderBrowse();
    }) : function () {};
    var offContext = R.bus ? R.bus.on('ae-shortcut-context:updated', function () {
      renderPads();
      renderBrowse();
    }) : function () {};
    var offPads = R.bus ? R.bus.on('ae-shortcut-pads:updated', function () {
      renderPads();
      renderBrowse();
    }) : function () {};

    renderPads();
    renderBrowse();
    return {
      destroy: function () {
        if (searchSaveTimer) {
          window.clearTimeout(searchSaveTimer);
          searchSaveTimer = null;
          if (R.disk && !R.disk.write(SEARCH_KEY, query) && ctx.toast) {
            ctx.toast('Could not save the shortcut search preference.', { kind: 'error' });
          }
        }
        if (padResizeObserver) padResizeObserver.disconnect();
        if (padResizeFallback) window.removeEventListener('resize', fitPadColumns);
        offUpdated();
        offError();
        offRuntime();
        offContext();
        offPads();
      }
    };
  }
})(window.Rebound = window.Rebound || {});
