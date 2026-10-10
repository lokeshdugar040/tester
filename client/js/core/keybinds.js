/*
 * Rebound, user-assignable keyboard shortcuts.
 *
 * Legacy display/configuration helpers for Rebound-assigned chords. No runtime
 * keyboard dispatcher consumes these bindings; AE's native keymap is untouched.
 *
 * Chord format: modifier tokens then the key, e.g. "Alt+E", "Mod+Shift+R".
 * "Mod" = Cmd on macOS / Ctrl on Windows. Plain letters are normalized upper.
 */
;(function (R) {
  'use strict';

  var KEY = 'keybinds';

  // Chords the shell already owns — never let a user binding shadow these.
  var RESERVED = { 'Mod+K': 1, 'Mod+Enter': 1, '/': 1, 'Escape': 1, 'Enter': 1 };

  function load() { return R.disk.read(KEY, {}) || {}; }
  function save(map) { R.disk.write(KEY, map || {}); }

  function getAll() { return load(); }
  function bindingFor(actionId) { return load()[actionId] || null; }

  // Assign chord to actionId. A chord is unique: assigning it clears any other
  // action that held it. Passing a falsy chord clears the action's binding.
  function setBinding(actionId, chord) {
    var m = load(), k;
    if (chord) {
      for (k in m) if (m.hasOwnProperty(k) && m[k] === chord) delete m[k];
      m[actionId] = chord;
    } else {
      delete m[actionId];
    }
    save(m);
    return m;
  }
  function clearBinding(actionId) { return setBinding(actionId, null); }

  function isReserved(chord) { return !!RESERVED[chord]; }

  // Normalize a keydown into a chord string, or null if it is only a modifier.
  function chordFromEvent(e) {
    var key = e.key;
    if (!key || key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null;
    var parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Mod');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (key === ' ' || key === 'Spacebar') key = 'Space';
    else if (key.length === 1) {
      // Alt (Option) and dead keys can yield symbols or accented characters, so
      // fall back to the physical key for letters/digits.
      var m = (e.altKey || key.charCodeAt(0) > 127) && /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code || '');
      key = m ? (m[1] || m[2]) : key.toUpperCase();
    }
    parts.push(key);
    return parts.join('+');
  }

  function actionIdForChord(chord) {
    if (!chord) return null;
    var m = load();
    for (var k in m) if (m.hasOwnProperty(k) && m[k] === chord) return k;
    return null;
  }

  R.keybinds = {
    getAll: getAll,
    bindingFor: bindingFor,
    setBinding: setBinding,
    clearBinding: clearBinding,
    isReserved: isReserved,
    chordFromEvent: chordFromEvent,
    actionIdForChord: actionIdForChord
  };
})(window.Rebound = window.Rebound || {});
