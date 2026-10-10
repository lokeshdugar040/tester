/*
 * Compatibility store for pinned commands from the active After Effects keymap.
 */
;(function (R) {
  'use strict';

  var KEY = 'shortcut-actions';
  function isAfterEffectsShortcut(action) {
    return !!(action && action.kind === 'apply' && action.isAfterEffectsShortcut === true &&
      action.aeMapShortcut === true);
  }

  function available(id) {
    return !!(R.homeActions && R.homeActions.byId && isAfterEffectsShortcut(R.homeActions.byId(id)));
  }

  function ids() {
    var saved = R.disk.read(KEY, null);
    var source = Array.isArray(saved) ? saved : [];
    var result = [];
    function append(validIds) {
      var seen = {};
      validIds.forEach(function (id) {
        if (typeof id !== 'string' || seen[id] || !available(id)) return;
        seen[id] = true;
        result.push(id);
      });
    }
    append(source);
    return result;
  }

  function all() {
    return ids().map(function (id) { return R.homeActions.byId(id); }).filter(function (action) { return !!action; });
  }

  function save(next) {
    var clean = [], seen = {};
    next.forEach(function (id) {
      if (typeof id !== 'string' || seen[id] || !available(id)) return;
      seen[id] = true;
      clean.push(id);
    });
    R.disk.write(KEY, clean);
    return clean;
  }

  function add(id) {
    var current = ids();
    if (!available(id) || current.indexOf(id) !== -1) return false;
    current.push(id);
    save(current);
    return true;
  }

  function remove(id) {
    var current = ids(), index = current.indexOf(id);
    if (index === -1) return false;
    current.splice(index, 1);
    save(current);
    return true;
  }

  R.shortcutActions = {
    ids: ids,
    all: all,
    add: add,
    remove: remove,
    isAfterEffectsShortcut: isAfterEffectsShortcut,
    set: save,
    defaults: []
  };
})(window.Rebound = window.Rebound || {});
