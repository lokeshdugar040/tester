/*
 * Rebound, custom color picker (R.ui.colorPicker).
 * A real picker: a saturation/value square, a hue strip, an optional alpha
 * strip, a hex field, and recent swatches. No native <input type=color> (CEP's
 * is unreliable and unthemeable). Returns { r, g, b } in 0..1 for AE setValue,
 * plus hex and a. Shared by any tool that needs full theming.
 */
; (function (R) {
  'use strict';

  var el = R.dom.el, on = R.dom.on;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0, s = max === 0 ? 0 : d / max, v = max;
    if (d !== 0) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, s, v];
  }
  function hx2(n) { if (!isFinite(n)) n = 0; var s = Math.round(clamp(n, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }
  function rgbToHex(r, g, b) { return '#' + hx2(r) + hx2(g) + hx2(b); }
  function hexToRgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(('' + hex).trim()); if (!m) return null; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // Lenient front door for colour text (the hex field, opts.value, set()):
  // trims, lowercases, drops '#', expands 3/4-digit shorthand and accepts 6 or
  // 8 digits (#rrggbbaa). Returns '#rrggbb' — or '#rrggbbaa' when keepAlpha —
  // or null when the text is not a colour at all.
  function normalizeHex(raw, keepAlpha) {
    if (raw == null) return null;
    var s = ('' + raw).trim().toLowerCase();
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s) || /^[0-9a-f]{4}$/.test(s)) {
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) +
        (s.length === 4 ? s.charAt(3) + s.charAt(3) : '');
    }
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return null;
    return '#' + (keepAlpha ? s : s.slice(0, 6));
  }

  // Every live picker instance, so the shell can close all popups at once on a
  // view change (no popup may outlive its tool with a stale open flag).
  var LIVE = [];

  function colorPicker(opts) {
    opts = opts || {};
    var state = { h: 200, s: 0.7, v: 1, a: 1 };
    function setFromHex(raw) {
      var hxv = normalizeHex(raw, opts.alpha);
      if (!hxv) return false;
      var rgbv = hexToRgb(hxv.slice(0, 7));
      if (!rgbv) return false;
      var hsv = rgbToHsv(rgbv[0], rgbv[1], rgbv[2]);
      state.h = hsv[0]; state.s = hsv[1]; state.v = hsv[2];
      if (hxv.length === 9) state.a = parseInt(hxv.slice(7, 9), 16) / 255;
      return true;
    }
    if (opts.value) { if (typeof opts.value === 'string') setFromHex(opts.value); else if (opts.value.hex) { setFromHex(opts.value.hex); if (opts.value.a != null) state.a = opts.value.a; } }

    var sv = el('div.rb-cp-sv'); var svThumb = el('div.rb-cp-sv-thumb'); sv.appendChild(svThumb);
    var hue = el('div.rb-cp-hue'); var hueThumb = el('div.rb-cp-hue-thumb'); hue.appendChild(hueThumb);
    var alphaEl = opts.alpha ? el('div.rb-cp-alpha') : null;
    var alphaThumb = opts.alpha ? el('div.rb-cp-alpha-thumb') : null; if (alphaEl) alphaEl.appendChild(alphaThumb);
    var hexInput = el('input.rb-cp-hex', { type: 'text', spellcheck: 'false', 'aria-label': 'Hex color', maxlength: '9' });
    var recentsRow = el('div.rb-cp-recents');
    var popKids = [sv, hue]; if (alphaEl) popKids.push(alphaEl); popKids.push(el('div.rb-cp-row', null, [hexInput]), recentsRow);
    var pop = el('div.rb-cp-pop', null, popKids); pop.style.display = 'none';
    var swatch = el('span.rb-cp-swatch'); var trigText = el('span.rb-cp-hex-text');
    var trigger = el('button.rb-cp-trigger', { type: 'button', title: opts.title || 'Pick a color', onclick: toggle }, [swatch, trigText]);
    var root = el('div.rb-cp', null, [trigger, pop]);
    // True while a pointer drag drives the color (SV / hue / alpha). While it
    // lasts, paint() may overwrite the hex field even if it holds focus: the
    // pointer is down, so the user cannot be typing, and the field must keep
    // its live readout.
    var dragPainting = false;
    // The user's uncommitted hex text (null when the field shows the committed
    // colour). While it is set, paint() leaves the field alone (caret + partial
    // input must survive) and external set() calls are ignored — an AE read
    // must never clobber an edit in progress. See the hex handlers and set().
    var pending = null;

    function rgb() { return hsvToRgb(state.h, state.s, state.v); }
    function hex() { var c = rgb(); return rgbToHex(c[0], c[1], c[2]); }
    function emit() { var c = rgb(); if (opts.onChange) opts.onChange({ r: c[0] / 255, g: c[1] / 255, b: c[2] / 255, hex: hex(), a: state.a }); }
    function paint() {
      var hxv = hex();
      swatch.style.background = hxv; if (opts.alpha) swatch.style.opacity = state.a;
      trigText.textContent = hxv;
      sv.style.background = 'linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,hsl(' + Math.round(state.h) + ',100%,50%))';
      svThumb.style.left = (state.s * 100) + '%'; svThumb.style.top = ((1 - state.v) * 100) + '%'; svThumb.style.background = hxv;
      hueThumb.style.left = ((state.h / 360) * 100) + '%';
      if (alphaEl) { alphaEl.style.backgroundImage = 'linear-gradient(to right, rgba(0,0,0,0), ' + hxv + ')'; alphaThumb.style.left = (state.a * 100) + '%'; }
      // Never clobber the field while the user's uncommitted text is in it
      // (caret + partial input must survive), EXCEPT while a pointer drag is
      // repainting: during a drag no keystrokes can arrive, and the field must
      // keep its live hex.
      if (dragPainting || pending === null) hexInput.value = hxv;
    }
    function dragSV(e) { var r = sv.getBoundingClientRect(); state.s = clamp((e.clientX - r.left) / r.width, 0, 1); state.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); paint(); emit(); }
    function dragHue(e) { var r = hue.getBoundingClientRect(); state.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 360; paint(); emit(); }
    function dragAlpha(e) { var r = alphaEl.getBoundingClientRect(); state.a = clamp((e.clientX - r.left) / r.width, 0, 1); paint(); emit(); }
    function bindDrag(elm, handler) {
      on(elm, 'pointerdown', function (e) {
        e.preventDefault(); dragPainting = true; pending = null; handler(e);
        var mv = function (ev) { if (ev.buttons === 0) return up(); handler(ev); }; // lost mouseup outside the panel (CEP)
        var up = function () { dragPainting = false; document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', up, true); pushRecent(hex()); };
        document.addEventListener('pointermove', mv, true); document.addEventListener('pointerup', up, true);
      });
    }
    bindDrag(sv, dragSV); bindDrag(hue, dragHue); if (alphaEl) bindDrag(alphaEl, dragAlpha);
    // Hex field state machine: `pending` is the user's in-progress text.
    //  - input: remember the text; a fully-valid colour also previews live.
    //  - change (Enter or blur): commit — valid text is already in `state`,
    //    invalid text snaps back to the committed colour — then it becomes a
    //    recent. Nothing is pushed that the user did not choose.
    //  - blur without change (e.g. popup closed around the edit): revert.
    on(hexInput, 'input', function () {
      pending = hexInput.value;
      if (setFromHex(pending)) { paint(); emit(); }
    });
    on(hexInput, 'change', function () {
      if (pending !== null) {
        setFromHex(pending);
        pending = null;
        paint();
      }
      pushRecent(hex());
    });
    on(hexInput, 'blur', function () { if (pending !== null) { pending = null; paint(); } });

    // ---- CEP keyboard focus guard -------------------------------------------
    // A CEP panel only keeps the keyboard while a text input (or dropdown) is
    // the focused element; otherwise every key is routed to the host app
    // (After Effects), which runs its own shortcuts instead. Some CEP/CEF
    // builds additionally fail to move DOM focus when a click lands inside a
    // popup: the field looks active but the trigger button stays focused, so
    // typed characters reach AE and Enter/Space re-activate the trigger, whose
    // click toggles the popup closed mid-edit. Force DOM focus onto the hex
    // field for any press inside the popup that does not land on a naturally
    // focusable control (the field and the recent-swatch buttons keep native
    // focus), so keys always stay in the panel. Both event families are bound
    // because CEF can drop pointer events on some elements while still firing
    // mouse events (the same quirk the curve editor binds around).
    //
    // The press is ALSO default-prevented. The default focus action of a
    // mousedown runs AFTER this handler: focusHex() would set focus on the
    // field and the default would immediately move it off again (the popup
    // itself is not focusable, so focus falls to BODY) — that default, not a
    // missing guard, was the focus bug. Only presses that are neither on the
    // field itself (native caret placement must survive) nor on a real control
    // are prevented.
    function focusHex() {
      if (document.activeElement === hexInput) return;
      try { hexInput.focus({ preventScroll: true }); } catch (err) { hexInput.focus(); }
    }
    function focusTrigger() {
      try { trigger.focus({ preventScroll: true }); } catch (err) { trigger.focus(); }
    }
    function onPopDown(e) {
      var t = e.target;
      if (t === hexInput) { focusHex(); return; }
      if (t && typeof t.focus === 'function' && /^(button|input|select|textarea)$/i.test(String(t.tagName))) return;
      e.preventDefault();
      focusHex();
    }
    on(pop, 'pointerdown', onPopDown);
    on(pop, 'mousedown', onPopDown);

    var skey = opts.storageKey || 'colorpicker-recents';
    // Validate the persisted shape: junk in storage (a non-array `items`) used
    // to crash recents().forEach at boot and take the whole tool down with it.
    function recents() { try { var items = R.disk.read(skey, { items: [] }).items; return Array.isArray(items) ? items : []; } catch (e) { return []; } }
    function pushRecent(hxv) { var items = recents().filter(function (x) { return x !== hxv; }); items.unshift(hxv); items = items.slice(0, 8); try { R.disk.write(skey, { items: items }); } catch (e) { /* storage may be unavailable */ } renderRecents(); }
    function renderRecents() { R.dom.clear(recentsRow); recents().forEach(function (hxv) { recentsRow.appendChild(el('button.rb-cp-recent', { type: 'button', title: hxv, style: { background: hxv }, onclick: function () { setFromHex(hxv); paint(); emit(); } })); }); }
    renderRecents();

    var open = false;
    function toggle() {
      open = !open;
      pop.style.display = open ? '' : 'none';
      // Opening the popup takes the keyboard for the panel: a CEP panel only
      // receives keys while a text input holds DOM focus, so put it in the
      // hex field right away. Enter/Space then edit the field instead of
      // reaching AE or re-activating the trigger (which would close the popup).
      if (open) { paint(); focusHex(); }
    }
    // Single close path: resets the open flag, hides the popup, reverts any
    // uncommitted hex text and (when asked) hands focus back to the trigger.
    function closePopup(focusBack) {
      if (pending !== null) { pending = null; paint(); }
      open = false;
      pop.style.display = 'none';
      if (focusBack) {
        var a = document.activeElement;
        if (a && root.contains(a) && a !== trigger) focusTrigger();
      }
    }
    function onDocDown(e) { if (open && !root.contains(e.target)) closePopup(false); }
    // Track the unsubscribe so destroy() can actually remove the listener —
    // removeEventListener only matches when the capture flag is identical to
    // the one addEventListener used (a mismatched flag silently leaks the
    // document-level handler for the life of the panel).
    var offDocDown = on(document, 'pointerdown', onDocDown, false);
    // Escape closes the popup before anything else reacts: the shell's Escape
    // navigates Home and a modal's Escape closes the dialog, so the picker
    // must be the first responder while its popup is the top layer (capture
    // phase + stopImmediatePropagation). When a modal overlay is stacked
    // above us and the popup is not inside it, stay quiet so the dialog
    // closes first instead.
    function onKey(e) {
      if (!open || e.key !== 'Escape') return;
      var overlay = document.querySelector('.rb-modal-overlay');
      if (overlay && !overlay.contains(pop)) return;
      closePopup(true);
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
    var offKey = on(document, 'keydown', onKey, true);

    paint();
    var api = {
      el: root,
      get: function () { var c = rgb(); return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255, hex: hex(), a: state.a }; },
      // External colour sync (AE reads, tool state, presets) must never
      // overwrite an in-progress user edit: while a drag is live or
      // uncommitted hex text sits in the field, external set() is ignored.
      // A user-driven sync (slider drag, quick swatch, explicit Read) passes
      // { user: true } and always applies, superseding the field text.
      set: function (v, syncOpts) {
        if ((!syncOpts || !syncOpts.user) && (dragPainting || pending !== null)) return;
        pending = null;
        if (typeof v === 'string') setFromHex(v);
        else if (v && v.hex) { setFromHex(v.hex); if (v.a != null) state.a = v.a; }
        paint();
      },
      close: function () { if (open) closePopup(false); },
      editing: function () { return !!(dragPainting || pending !== null); },
      destroy: function () {
        offDocDown();
        offKey();
        var i = LIVE.indexOf(api); if (i !== -1) LIVE.splice(i, 1);
      }
    };
    LIVE.push(api);
    return api;
  }

  R.ui = R.ui || {};
  R.ui.colorPicker = colorPicker;
  R.ui.colorUtil = { hsvToRgb: hsvToRgb, rgbToHsv: rgbToHsv, rgbToHex: rgbToHex, hexToRgb: hexToRgb };
  // Close every live picker popup (the shell calls this on view changes so no
  // popup survives a tool switch or a trip to the Home with a stale open flag).
  R.ui.closeColorPickers = function () { for (var i = LIVE.length - 1; i >= 0; i--) LIVE[i].close(); };
})(window.Rebound = window.Rebound || {});
