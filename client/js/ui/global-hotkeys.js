/*
 * AE shortcut display normalization. Physical-key dispatch and global hooks
 * are deliberately disabled so After Effects retains native keyboard input.
 */
;(function (R) {
  'use strict';

  var aliases = {
    arrowdown: 'DownArrow',
    arrowleft: 'LeftArrow',
    arrowright: 'RightArrow',
    arrowup: 'UpArrow',
    backquote: '`',
    backslash: 'Backslash',
    backspace: 'Backspace',
    capslock: 'CapsLock',
    clear: 'Pad5',
    comma: 'Comma',
    delete: 'Delete',
    del: 'Delete',
    downarrow: 'DownArrow',
    end: 'End',
    enter: 'Enter',
    escape: 'Esc',
    esc: 'Esc',
    home: 'Home',
    insert: 'Insert',
    leftarrow: 'LeftArrow',
    numpadadd: 'PadPlus',
    numpadclear: 'Pad5',
    numpadcomma: 'PadComma',
    numpaddecimal: 'PadDecimal',
    numpaddelete: 'PadDecimal',
    numpaddivide: 'PadSlash',
    numpadend: 'Pad1',
    numpadenter: 'PadEnter',
    numpadhome: 'Pad7',
    numpadinsert: 'Pad0',
    numpadmultiply: 'PadMultiply',
    numpadpagedown: 'Pad3',
    numpadpageup: 'Pad9',
    numpadsubtract: 'PadMinus',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    padclear: 'Pad5',
    padcomma: 'PadComma',
    paddecimal: 'PadDecimal',
    paddelete: 'PadDecimal',
    padend: 'Pad1',
    padenter: 'PadEnter',
    padhome: 'Pad7',
    padinsert: 'Pad0',
    padminus: 'PadMinus',
    padmultiply: 'PadMultiply',
    padpagedown: 'Pad3',
    padpageup: 'Pad9',
    padplus: 'PadPlus',
    padslash: 'PadSlash',
    period: '.',
    quote: 'SingleQuote',
    return: 'Enter',
    rightarrow: 'RightArrow',
    singlequote: 'SingleQuote',
    space: 'Space',
    spacebar: 'Space',
    tab: 'Tab',
    uparrow: 'UpArrow'
  };

  var eventCodes = {
    ArrowDown: 'DownArrow',
    ArrowLeft: 'LeftArrow',
    ArrowRight: 'RightArrow',
    ArrowUp: 'UpArrow',
    Backquote: '`',
    Backslash: 'Backslash',
    Backspace: 'Backspace',
    BracketLeft: '[',
    BracketRight: ']',
    CapsLock: 'CapsLock',
    Comma: 'Comma',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Equal: '=',
    Escape: 'Esc',
    Home: 'Home',
    Insert: 'Insert',
    Minus: '-',
    NumpadAdd: 'PadPlus',
    NumpadClear: 'Pad5',
    NumpadComma: 'PadComma',
    NumpadDecimal: 'PadDecimal',
    NumpadDelete: 'PadDecimal',
    NumpadDivide: 'PadSlash',
    NumpadEnd: 'Pad1',
    NumpadEnter: 'PadEnter',
    NumpadHome: 'Pad7',
    NumpadInsert: 'Pad0',
    NumpadMultiply: 'PadMultiply',
    NumpadSubtract: 'PadMinus',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Period: '.',
    Quote: 'SingleQuote',
    Semicolon: ';',
    Slash: '/',
    Space: 'Space',
    Tab: 'Tab'
  };

  function cleanPadKey(value) {
    var key = String(value || '').replace(/^\s+|\s+$/g, '');
    if (/^[A-Za-z0-9]$/.test(key)) return key.toUpperCase();
    if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
    var digit = /^(?:Numpad|Pad)([0-9])$/i.exec(key);
    if (digit) return 'Pad' + digit[1];
    if (key === ' ') return 'Space';
    return aliases[key.toLowerCase()] || null;
  }

  function cleanPadChord(chord) {
    var modifiers = {};
    var key = '';
    var invalid = false;
    String(chord || '').split('+').forEach(function (part) {
      var token = part.replace(/^\s+|\s+$/g, '');
      if (/^(?:Mod|Ctrl|Control)$/i.test(token)) modifiers.Ctrl = true;
      else if (/^(?:Alt|Option)$/i.test(token)) modifiers.Alt = true;
      else if (/^Shift$/i.test(token)) modifiers.Shift = true;
      else if (/^(?:Win|Windows|Meta|Cmd|Command)$/i.test(token)) modifiers.Win = true;
      else {
        var normalized = cleanPadKey(token);
        if (!normalized || key) invalid = true;
        else key = normalized;
      }
    });
    if (invalid || !key) return null;
    var parts = [];
    if (modifiers.Ctrl) parts.push('Ctrl');
    if (modifiers.Alt) parts.push('Alt');
    if (modifiers.Shift) parts.push('Shift');
    if (modifiers.Win) parts.push('Win');
    parts.push(key);
    return parts.join('+');
  }

  function padKeyFromEvent(event) {
    if (!event) return null;
    var code = String(event.code || '');
    var key = eventCodes[code] || null;
    if (!key) {
      var match = /^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9])|(F(?:[1-9]|1[0-9]|2[0-4])))$/i.exec(code);
      if (match) key = match[1] || match[2] ||
        (match[3] ? 'Pad' + match[3] : match[4].toUpperCase());
    }
    return key ? cleanPadKey(key) : null;
  }

  function padChordFromEvent(event) {
    if (!event) return null;
    var key = padKeyFromEvent(event);
    if (!key) return null;
    var parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Win');
    parts.push(key);
    return cleanPadChord(parts.join('+'));
  }

  function retireLegacyHelper() {
    var cepNode = window.cep_node;
    if (!cepNode || !cepNode.require || !R.disk || !R.disk.dir) return;
    try {
      var node = {
        fs: cepNode.require('fs'),
        path: cepNode.require('path'),
        childProcess: cepNode.require('child_process'),
        process: cepNode.require('process')
      };
      var dir = R.disk.dir();
      if (!dir) return;
      var statusFile = node.path.join(dir, 'ae-global-hotkeys.status.json');
      if (!node.fs.existsSync(statusFile)) return;
      var status = JSON.parse(node.fs.readFileSync(statusFile, 'utf8'));
      var pid = Number(status && status.pid);
      if (!pid || Math.floor(pid) !== pid) return;
      var windowsRoot = node.process.env.SystemRoot || node.process.env.WINDIR;
      if (!windowsRoot) return;
      var powershell = node.path.join(windowsRoot, 'System32', 'WindowsPowerShell',
        'v1.0', 'powershell.exe');
      var safeDir = String(dir).replace(/'/g, "''");
      var command = "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid +
        "' -ErrorAction SilentlyContinue; if ($p -and " +
        "$p.CommandLine -match 'global-hotkeys[.]ps1' -and " +
        "$p.CommandLine.IndexOf('" + safeDir +
        "', [StringComparison]::OrdinalIgnoreCase) -ge 0) { " +
        "Stop-Process -Id " + pid + " -Force }";
      node.childProcess.execFile(powershell, [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command
      ], { windowsHide: true }, function (error) {
        if (error && R.log) {
          R.log.error('Could not retire the legacy Rebound keyboard hook.', error);
        }
      });
    } catch (error) {
      if (R.log) R.log.error('Could not inspect the legacy Rebound keyboard hook.', error);
    }
  }

  var disabledMessage = 'Global keyboard hooks are disabled to preserve native After Effects shortcuts.';

  R.globalHotkeys = {
    supported: false,
    hotkeyCapture: { active: false, sessionId: '' },
    bindings: function () { return {}; },
    bindingFor: function () { return null; },
    setBinding: function () { return { ok: false, error: disabledMessage }; },
    clearBinding: function () { return { ok: true }; },
    migratePinBindings: function () { return false; },
    beginCaptureSession: function () { return ''; },
    endCaptureSession: function () { return true; },
    isCaptureActive: function () { return false; },
    start: function () { retireLegacyHelper(); return false; },
    stop: function () { retireLegacyHelper(); return true; },
    executeChord: function () { return Promise.reject(new Error(disabledMessage)); },
    executeSequence: function () { return Promise.reject(new Error(disabledMessage)); },
    focusStatusText: function () { return 'was not changed by Rebound'; },
    status: function () {
      return { running: false, ready: false, error: disabledMessage };
    },
    cleanChord: cleanPadChord,
    cleanPadKey: cleanPadKey,
    cleanPadChord: cleanPadChord,
    isSafeGlobalChord: function () { return false; },
    padKeyFromEvent: padKeyFromEvent,
    padChordFromEvent: padChordFromEvent
  };

  retireLegacyHelper();
})(window.Rebound = window.Rebound || {});
