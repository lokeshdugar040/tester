/*
 * Rebound, settings: shared preferences module.
 *
 * Settings live INSIDE the main panel (opened in an in-panel modal) instead of
 * a separate window, so there is one Rebound surface, not two. Exposes
 * R.settings: DEFAULTS, load, persist, applyTheme, and buildBody() which returns
 * the form for the modal. The same versioned file the panel already reads.
 */
;(function (R) {
  'use strict';

  var el = R.dom.el;
  var ui = R.ui;

  var SETTINGS_EVENT = 'com.meszmate.rebound.settingsChanged';
  var SCHEMA_VERSION = 1;
  var PANEL_VERSION = R.brand && R.brand.VERSION || 'unknown';

  var DEFAULTS = {
    schemaVersion: SCHEMA_VERSION,
    themeMode: 'auto', // auto | dark | light
    accent: '#4990e2',
    autoApply: false,
    applyMode: 'keys', // keys | expression
    handleLength: 45, // bezier tangent handle length / smoothness (20-70); ~45 = clean ease-in-out arc
    overshootMode: 'bake', // bake | expression
    defaultUnits: 'frames', // frames | seconds
    showUnitsOverlay: true
  };

  function load() {
    var saved = R.disk.read('settings', {}) || {};
    var out = {};
    for (var k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) out[k] = DEFAULTS[k];
    for (var s in saved) if (saved.hasOwnProperty(s)) out[s] = saved[s];
    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  function persist(settings) {
    R.disk.write('settings', settings);
    broadcast(settings);
  }

  function broadcast(settings) {
    try {
      if (R.bridge.cs && typeof CSEvent !== 'undefined') {
        var ev = new CSEvent(SETTINGS_EVENT, 'APPLICATION');
        ev.data = JSON.stringify(settings);
        R.bridge.cs.dispatchEvent(ev);
      }
    } catch (e) {
      R.log.warn('Could not broadcast settings change', e);
    }
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [73, 144, 226];
  }

  function applyTheme(settings) {
    R.theme.setAccent(hexToRgb(settings.accent));
  }

  function section(title, children) {
    return el('div.rb-card', { style: { marginBottom: '10px' } }, [
      el('div.rb-section-label', { text: title }),
      el('div.rb-col', null, children)
    ]);
  }

  function accentPicker(current, onPick) {
    var swatches = ['#4990e2', '#7c5cff', '#22b07d', '#e8a838', '#e5534b', '#e06cc4'];
    var row = el('div.rb-row', null, swatches.map(function (hex) {
      return el('button.rb-btn.is-icon', {
        style: { background: hex, borderColor: hex === current ? 'var(--rb-text)' : hex },
        title: hex,
        onclick: function () {
          onPick(hex);
          R.dom.qsa('button', row).forEach(function (b) { b.style.borderColor = b.title; });
          this.style.borderColor = 'var(--rb-text)';
        }
      }, ['']);
    }));
    return row;
  }

  function buildKeybindsSection() {
    return section('Keyboard shortcuts', [
      el('div.rb-faint', {
        text: 'Rebound panel shortcuts are disabled so native After Effects keyboard input is never intercepted.'
      })
    ]);
  }

  function buildGlobalHotkeysSection() {
    return section('Global After Effects shortcuts', [
      el('div.rb-faint', {
        text: 'Global shortcut interception is disabled. AE shortcut bindings remain native and unchanged.'
      })
    ]);
  }

  function buildAeShortcutMapSection() {
    var mapData = null;
    var supported = !!(R.bridge && R.bridge.available && R.aeShortcutMap);
    var search = el('input', {
      type: 'text',
      placeholder: 'Search command, context, or key…',
      'aria-label': 'Search the After Effects shortcut map',
      disabled: true
    });
    var loadButton = el('button.rb-btn.is-ghost.rb-btn-sm', {
      type: 'button',
      disabled: !supported
    }, ['Read active keymap']);
    var summary = el('div.rb-faint', {
      text: supported
        ? 'Read-only list from the active After Effects shortcut preference file.'
        : 'Reading the active keymap is currently supported on Windows inside After Effects.'
    });
    var list = el('div.rb-kbd-list.rb-shortcut-map-list.rb-scroll');

    function render() {
      R.dom.clear(list);
      if (!mapData) {
        list.appendChild(el('div.rb-faint', { text: 'Read the active AE keymap to show its commands and key combinations.' }));
        return;
      }
      var query = String(search.value || '').toLowerCase();
      var shown = 0;
      mapData.entries.forEach(function (entry) {
        var canonical = R.aeShortcutMap.canonicalRecord(entry);
        var keys = canonical.displayChord || 'No AE shortcut assigned';
        var haystack = (canonical.label + ' ' + canonical.workflowCategory + ' ' +
          canonical.requiredContext + ' ' + entry.commandId + ' ' +
          entry.context + ' ' + keys).toLowerCase();
        if (query && haystack.indexOf(query) === -1) return;
        var chord = el('span.rb-kbd', {
          text: keys || '—',
          title: keys
        });
        chord.classList.toggle('is-empty', !keys);
        list.appendChild(el('div.rb-kbd-row.rb-shortcut-map-row', null, [
          el('div.rb-shortcut-map-info', null, [
            el('span.rb-kbd-label', { text: canonical.label }),
            el('span.rb-faint', {
              text: canonical.workflowCategory + ' · ' + canonical.requiredContext +
                ' · ' + canonical.userStatus
            })
          ]),
          chord
        ]));
        shown++;
      });
      if (!shown) list.appendChild(el('div.rb-faint', { text: 'No AE commands match that search.' }));
      summary.textContent = shown + ' shown · ' + mapData.assigned + ' assigned · ' +
        mapData.unassigned + ' without a key · AE ' + mapData.appVersion;
    }

    search.addEventListener('input', render);
    loadButton.addEventListener('click', function () {
      if (!supported) return;
      loadButton.disabled = true;
      loadButton.textContent = 'Reading…';
      summary.textContent = 'Reading the active After Effects shortcut map…';
      R.bridge.invoke('aeShortcut.readKeymap', {}).then(function (result) {
        mapData = R.aeShortcutMap.parse(result.contents);
        mapData.filename = result.filename;
        mapData.appVersion = result.version;
        if (R.afterEffectsShortcuts && R.afterEffectsShortcuts.updateFromKeymap) {
          R.afterEffectsShortcuts.updateFromKeymap(mapData);
          if (R.shell && R.shell.refreshHomeShortcuts) R.shell.refreshHomeShortcuts();
        }
        search.disabled = false;
        render();
      }).catch(function (err) {
        mapData = null;
        if (R.afterEffectsShortcuts && R.afterEffectsShortcuts.markUnavailable) {
          R.afterEffectsShortcuts.markUnavailable();
        }
        if (R.bus) R.bus.emit('ae-shortcut-map:error', err);
        if (R.shell && R.shell.refreshHomeShortcuts) R.shell.refreshHomeShortcuts();
        summary.textContent = 'Mapping unavailable — assign an action or check AE keymap.';
        if (R.log) R.log.error('Could not read the active After Effects shortcut map', err);
        if (ui.toast) ui.toast('Mapping unavailable — assign an action or check AE keymap.', { kind: 'error' });
      }).then(function () {
        loadButton.disabled = false;
        loadButton.textContent = 'Read active keymap';
      });
    });
    render();
    return section('After Effects shortcut map · read only', [
      el('div.rb-faint', { text: 'Shows clean command labels, the active keymap binding, and availability for the keymap currently selected in After Effects.' }),
      el('div.rb-shortcut-list-tools.rb-shortcut-map-tools', null, [search, loadButton]),
      summary,
      list
    ]);
  }

  function buildBody(onChange, runAction) {
    var settings = load();
    applyTheme(settings);

    var body = el('div.rb-col');

    function update(patch) {
      for (var k in patch) if (patch.hasOwnProperty(k)) settings[k] = patch[k];
      persist(settings);
      applyTheme(settings);
      if (typeof onChange === 'function') onChange(settings);
    }

    body.appendChild(section('Appearance', [
      ui.row('Theme', ui.segmented([
        { value: 'auto', label: 'Auto' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' }
      ], { value: settings.themeMode, onChange: function (v) { update({ themeMode: v }); } }).el),
      ui.row('Accent', accentPicker(settings.accent, function (hex) { update({ accent: hex }); }))
    ]));

    body.appendChild(section('Easing', [
      ui.toggle({ label: 'Auto-apply curve edits to the selection', value: settings.autoApply,
        onChange: function (v) { update({ autoApply: v }); } }).el,
      ui.row('Apply as', ui.segmented([
        { value: 'keys', label: 'Keyframes' },
        { value: 'expression', label: 'Expression' }
      ], { value: settings.applyMode, onChange: function (v) { update({ applyMode: v }); } }).el),
      ui.slider({
        label: 'Smoothness (handle length)', min: 20, max: 70, step: 1, value: settings.handleLength,
        format: function (v) { return Math.round(v) + '%'; },
        onInput: function (v) { update({ handleLength: v }); }
      }).el,
      el('div.rb-faint', { text: 'Bezier handle length on baked keys. ~45% is a clean ease-in-out arc (recommended). Lower is snappier; too high flattens the peaks into shelves. Applies when baking keyframes.' }),
      ui.row('Overshoot', ui.segmented([
        { value: 'bake', label: 'Bake' },
        { value: 'expression', label: 'Expression' }
      ], { value: settings.overshootMode, onChange: function (v) { update({ overshootMode: v }); } }).el)
    ]));

    body.appendChild(section('Units', [
      ui.row('Default time', ui.segmented([
        { value: 'frames', label: 'Frames' },
        { value: 'seconds', label: 'Seconds' }
      ], { value: settings.defaultUnits, onChange: function (v) { update({ defaultUnits: v }); } }).el),
      ui.toggle({ label: 'Show real-unit overlay on the curve editor', value: settings.showUnitsOverlay,
        onChange: function (v) { update({ showUnitsOverlay: v }); } }).el
    ]));

    body.appendChild(section('Data', [
      el('div.rb-faint', { text: R.disk.available
        ? 'Presets and settings are stored in your user data folder.'
        : 'Running without file access, settings are kept in this session only.' })
    ]));

    // About: the mark, the version, one plain line.
    var aboutMark = el('span.rb-about-mark');
    aboutMark.innerHTML = (R.brand && R.brand.MARK) || '';
    body.appendChild(el('div.rb-card.rb-about', null, [
      el('div.rb-about-row', null, [
        aboutMark,
        el('span.rb-about-name', { text: 'Rebound' }),
        el('span.rb-about-ver', { text: 'v' + PANEL_VERSION })
      ]),
      el('div.rb-faint', { text: 'Animation tools for After Effects.' })
    ]));

    return body;
  }

  function buildShortcutSettings() {
    var body = el('div.rb-col');
    body.appendChild(buildKeybindsSection());
    body.appendChild(buildGlobalHotkeysSection());
    if (R.aeShortcutMap && R.bridge && R.bridge.available) {
      body.appendChild(buildAeShortcutMapSection());
    }
    if (!body.childNodes.length) {
      body.appendChild(el('div.rb-faint', {
        text: 'Shortcut settings are unavailable until the panel finishes loading.'
      }));
    }
    return body;
  }

  function openShortcutSettings() {
    if (!R.ui || !R.ui.modal) {
      if (ui.toast) ui.toast('Shortcut settings are unavailable.', { kind: 'error' });
      return false;
    }
    R.ui.modal({
      title: 'Shortcut settings',
      width: 'min(680px, 100%)',
      className: 'rb-modal-shortcut-settings',
      body: buildShortcutSettings()
    });
    return true;
  }

  R.settings = {
    DEFAULTS: DEFAULTS,
    load: load,
    persist: persist,
    applyTheme: applyTheme,
    buildBody: buildBody,
    openShortcutSettings: openShortcutSettings
  };
})(window.Rebound = window.Rebound || {});
