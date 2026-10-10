/*
 * Persistent, local-only diagnostics for shortcut execution.
 */
;(function (R) {
  'use strict';

  var LOG_KEY = 'ae-shortcut-execution-log';
  var RECENT_KEY = 'ae-shortcut-recent-actions';
  var MAX_ENTRIES = 300;
  var MAX_RECENT = 20;

  function clean(value, maxLength) {
    return String(value == null ? '' : value).replace(/[\r\n\t]/g, ' ').slice(0, maxLength || 500);
  }

  function recent() {
    var saved = R.disk.read(RECENT_KEY, []);
    return Array.isArray(saved) ? saved.filter(function (id) {
      return typeof id === 'string';
    }).slice(0, MAX_RECENT) : [];
  }

  function remember(actionId) {
    if (!actionId) return;
    var next = recent().filter(function (id) { return id !== actionId; });
    next.unshift(String(actionId).slice(0, 256));
    if (!R.disk.write(RECENT_KEY, next.slice(0, MAX_RECENT)) && R.log) {
      R.log.error('Shortcut diagnostics: could not persist recently used actions.');
    }
  }

  function record(event) {
    if (!event || typeof event !== 'object') throw new Error('Shortcut diagnostic data must be an object.');
    var entry = {
      timestamp: new Date().toISOString(),
      actionId: clean(event.actionId, 256),
      triggerSource: clean(event.triggerSource, 128),
      actorCategory: clean(event.actorCategory, 64),
      label: clean(event.label, 256),
      shortcut: clean(event.shortcut, 256),
      bindingAlternatives: Array.isArray(event.bindingAlternatives)
        ? event.bindingAlternatives.map(function (part) { return clean(part, 128); }).slice(0, 32) : [],
      workflowCategory: clean(event.workflowCategory, 128),
      aeContext: clean(event.aeContext, 128),
      requiredState: clean(event.requiredState, 500),
      requiredContext: clean(event.requiredContext, 128),
      detectedContext: clean(event.detectedContext, 128),
      route: clean(event.route, 128),
      executionRoute: clean(event.executionRoute || event.route, 128),
      routeAvailable: event.routeAvailable === true,
      requestId: clean(event.requestId, 128),
      latencyMs: event.latencyMs == null ? null : Math.max(0, Number(event.latencyMs) || 0),
      expectedResult: clean(event.expectedResult, 500),
      status: clean(event.status, 64),
      result: clean(event.result, 500),
      error: clean(event.error, 1000),
      errorStack: clean(event.errorStack, 4000),
      sendResult: clean(event.sendResult, 1000),
      observedResult: clean(event.observedResult, 1000),
      verificationStatus: clean(event.verificationStatus, 64),
      verified: event.verified === true,
      delivered: event.delivered === true,
      executed: event.executed === true,
      contextVerified: event.contextVerified === true,
      targetPid: Number(event.targetPid) || null,
      targetHwnd: clean(event.targetHwnd, 64),
      foregroundHwndBefore: clean(event.foregroundHwndBefore, 64),
      focusedHwndBefore: clean(event.focusedHwndBefore, 64),
      focusedClass: clean(event.focusedClass, 256),
      focusedTitle: clean(event.focusedTitle, 512),
      focusStatus: clean(event.focusStatus, 64),
      commandId: Number(event.commandId) || null,
      commandIdSource: clean(event.commandIdSource, 128)
    };
    var saved = R.disk.read(LOG_KEY, []);
    var entries = Array.isArray(saved) ? saved : [];
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
    if (!R.disk.write(LOG_KEY, entries)) {
      if (R.log) R.log.error('Shortcut diagnostics: could not persist an execution record.', entry);
      return false;
    }
    remember(entry.actionId);
    if (R.bus) R.bus.emit('ae-shortcut-diagnostics:updated');
    return entry;
  }

  function list(limit) {
    var saved = R.disk.read(LOG_KEY, []);
    var entries = Array.isArray(saved) ? saved : [];
    var count = Math.max(0, Math.min(entries.length, Number(limit) || entries.length));
    return entries.slice(entries.length - count).reverse();
  }

  function developmentEnabled() {
    return !!(window.location && /(?:^|[?&])shortcutDiagnostics=1(?:&|$)/.test(window.location.search || ''));
  }

  R.shortcutDiagnostics = {
    record: record,
    list: list,
    recent: recent,
    remember: remember,
    developmentEnabled: developmentEnabled,
    clear: function () {
      if (!R.disk.write(LOG_KEY, [])) throw new Error('Could not clear local shortcut diagnostics.');
      if (R.bus) R.bus.emit('ae-shortcut-diagnostics:updated');
    }
  };
})(window.Rebound = window.Rebound || {});
