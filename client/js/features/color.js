/*
 * Rebound, Color tool.
 * Sets the fill color of selected layers from a swatch palette or from Hue and
 * Lightness sliders. Shape layers recolor every fill, solids recolor their
 * source, and any other layer gets a Fill effect. Colors are sent as 0..1 RGB.
 */
;(function (R) {
  'use strict';

  var el = R.dom.el;
  var svg = R.dom.svg;
  var ui = R.ui;

  var PALETTE = [
    '#f4453a', '#f5910b', '#f7d000', '#54c245',
    '#1fa6e0', '#3a52d6', '#9b3fd6', '#f0f1f5'
  ];

  // A large sample shape recolored with the current color. The fill follows the
  // color when the target is Fill or Both, the stroke follows it when the target
  // is Stroke or Both, and a small hue strip plus the swatch sit underneath so
  // hue, saturation, lightness, hex, and the target all drive the preview.
  function colorSvg(state, h) {
    var rgb = hslToRgb(state.hue, state.saturation / 100, state.lightness / 100);
    var css = rgbCss(rgb);
    var target = state.target;
    var fillCss = (target === 'fill' || target === 'both') ? css : 'none';
    var hasStroke = (target === 'stroke' || target === 'both');
    var hueOnly = rgbCss(hslToRgb(state.hue, 1, 0.5));
    var kids = [
      svg('rect', { x: 1, y: 1, width: 158, height: 88, fill: 'var(--rb-bg)', stroke: 'var(--rb-border)', 'stroke-width': 1, rx: 3 }),
      svg('rect', { x: 34, y: 22, width: 92, height: 46, rx: 8, fill: fillCss, stroke: hasStroke ? css : 'none', 'stroke-width': hasStroke ? 4 : 0 }),
      svg('rect', { x: 34, y: 76, width: 92, height: 6, rx: 3, fill: hueOnly, opacity: '0.85' }),
      svg('circle', { cx: 22, cy: 45, r: 9, fill: css, stroke: 'var(--rb-border)', 'stroke-width': 1 })
    ];
    return svg('svg', { viewBox: '0 0 160 90', width: '100%', height: h }, kids);
  }

  function rgbCss(rgb) {
    return 'rgb(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ')';
  }

  R.tools.register({
    id: 'color',
    title: 'Color',
    group: 'Color',
    order: 0,
    keywords: ['color', 'colour', 'fill', 'tint', 'swatch', 'palette', 'hue', 'recolor'],
    mount: mount
  });

  function mount(ctx) {
    var hue = 210;
    var saturation = 100;
    var lightness = 55;
    var target = 'fill';

    // Widget: click a swatch to recolour the selection's fill. Edit mode opens
    // After Effects' native colour dialog to add or change swatches.
    if (ctx.widget) {
      var DEFAULT_COLORS = ['#4990e2', '#22b07d', '#e8a838', '#e5534b', '#eef0f4'];
      var hasSavedColors = ctx.config && Array.isArray(ctx.config.colors);
      var colors = hasSavedColors ? ctx.config.colors.slice() : DEFAULT_COLORS.slice();
      var editing = false;
      var destroyed = false;
      var screenSampleTimer = null;
      var dropperButton = null;
      var persistColors = function () { ctx.setConfig({ colors: colors.slice() }); };
      var nodeModules = null;
      var screenSession = null;
      var pickNativeColor = function (initialHex, onPicked) {
        if (typeof ctx.invoke !== 'function') {
          ctx.toast('The After Effects color picker requires the host application.', { kind: 'error' });
          return;
        }
        ctx.invoke('color.pick', { hex: initialHex }).then(function (result) {
          if (!result) return;
          if (typeof result.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(result.hex)) {
            ctx.toast('After Effects returned an invalid color.', { kind: 'error' });
            return;
          }
          onPicked(result.hex.toLowerCase());
        }).catch(function (err) {
          ctx.toast((err && err.message) || 'Could not open the After Effects color picker.', { kind: 'error' });
        });
      };

      var MIN_CELL = 44, MAX_CELL = 96, GAP = 6;
      var grid = el('div.rb-wgt-pick.rb-wgt-color-grid');
      var addButton = null;
      var updateColor = function (idx, value) {
        colors[idx] = value;
        var cell = grid.children[idx];
        if (cell) { cell.style.background = value; cell.title = 'Click to change this colour'; }
        persistColors();
      };
      var render = function () {
        var r = grid.getBoundingClientRect();
        var W = r.width || root.getBoundingClientRect().width || 220;
        var cols = Math.max(1, Math.min(3, Math.floor((W + GAP) / (MIN_CELL + GAP))));
        var cellSize = Math.min(MAX_CELL, Math.floor((W - (cols - 1) * GAP) / cols));
        var rows = colors.length ? Math.ceil(colors.length / cols) : 1;
        var gridHeight = colors.length ? rows * cellSize + (rows - 1) * GAP : cellSize;
        grid.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cellSize + 'px)';
        grid.style.gridTemplateRows = 'repeat(' + rows + ', ' + cellSize + 'px)';
        grid.style.gap = GAP + 'px';
        grid.style.minHeight = gridHeight + 'px';
        grid.classList.toggle('is-editing', editing);
        R.dom.clear(grid);
        for (var i = 0; i < colors.length; i++) {
          (function (idx) {
            var hex = colors[idx];
            if (editing) {
              var cell = el('label.rb-wgt-swatch.rb-wgt-swatchedit', {
                title: 'Click to change this colour',
                style: { background: hex },
                onclick: function (e) {
                  if (e.target.closest && e.target.closest('.rb-wgt-swx')) return;
                  pickNativeColor(hex, function (value) { updateColor(idx, value); });
                }
              });
              cell.appendChild(el('span.rb-wgt-swx', { title: 'Remove colour',
                onclick: function (e) { e.preventDefault(); e.stopPropagation(); colors.splice(idx, 1); persistColors(); render(); } }, ['×']));
              grid.appendChild(cell);
            } else {
              var sw = el('button.rb-wgt-swatch', { type: 'button', title: 'Set ' + hex, style: { background: hex } });
              sw.addEventListener('click', function () { apply(hexToRgb(hex)); });
              grid.appendChild(sw);
            }
          })(i);
        }
        if (typeof ctx.setWidgetContentHeight === 'function') {
          ctx.setWidgetContentHeight(gridHeight + (editing ? 30 : 0));
        }
      };
      var addColor = function () {
        pickNativeColor('#1fa6e0', function (value) {
          colors.push(value);
          persistColors();
          render();
        });
      };
      var screenSamplerModules = function () {
        if (nodeModules) return nodeModules;
        if (!window.cep_node || !window.cep_node.require) {
          throw new Error('The Windows screen sampler requires the CEP Node runtime.');
        }
        var req = window.cep_node.require;
        nodeModules = {
          childProcess: req('child_process'),
          crypto: req('crypto'),
          fs: req('fs'),
          os: req('os'),
          path: req('path'),
          process: req('process')
        };
        if (nodeModules.process.platform !== 'win32') {
          throw new Error('Screen color sampling currently requires Windows.');
        }
        return nodeModules;
      };
      var removeScreenFiles = function (session) {
        ['resultPath', 'cancelPath'].forEach(function (key) {
          try { session.modules.fs.unlinkSync(session[key]); }
          catch (err) { if (err.code !== 'ENOENT' && R.log) R.log.warn('Could not remove a screen sampler file.', err); }
        });
      };
      var requestScreenCancel = function (session) {
        if (session.cancelRequested) return;
        session.cancelRequested = true;
        try {
          session.modules.fs.writeFileSync(session.cancelPath, 'CANCEL', 'ascii');
        } catch (err) {
          if (R.log) R.log.warn('Could not signal the screen sampler to stop.', err);
        }
      };
      var finishScreenSample = function (session, response) {
        if (screenSession !== session) return;
        screenSession = null;
        if (screenSampleTimer) { clearTimeout(screenSampleTimer); screenSampleTimer = null; }
        if (session.cleanupTimer) { clearTimeout(session.cleanupTimer); session.cleanupTimer = null; }
        removeScreenFiles(session);
        if (dropperButton) dropperButton.disabled = false;
        if (destroyed || response === 'CANCEL') return;
        if (response.indexOf('ERROR|') === 0) {
          ctx.toast(response.substring(6) || 'The Windows screen sampler failed.', { kind: 'error' });
          return;
        }
        if (response.indexOf('OK|') !== 0 || !/^#[0-9a-f]{6}$/i.test(response.substring(3))) {
          ctx.toast('The Windows screen sampler returned an invalid response.', { kind: 'error' });
          return;
        }
        colors.push(response.substring(3).toLowerCase());
        persistColors();
        render();
      };
      var pollScreenSample = function (session) {
        if (destroyed || screenSession !== session) return;
        var response = '';
        try {
          response = session.modules.fs.readFileSync(session.resultPath, 'ascii').replace(/^\s+|\s+$/g, '');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            finishScreenSample(session, 'ERROR|' + (err.message || String(err)));
            return;
          }
        }
        if (response && response !== 'READY') {
          finishScreenSample(session, response);
          return;
        }
        if (session.error) {
          finishScreenSample(session, 'ERROR|' + (session.error.message || String(session.error)));
          return;
        }
        if (session.exited && !response) {
          finishScreenSample(session, 'ERROR|The Windows screen sampler exited before returning a color.');
          return;
        }
        if (!session.cancelRequested && Date.now() - session.startedAt > 120000) {
          ctx.toast('Screen sampling timed out; cancelling the picker.', { kind: 'warn' });
          requestScreenCancel(session);
        }
        screenSampleTimer = setTimeout(function () { pollScreenSample(session); }, 150);
      };
      var sampleScreenColor = function () {
        if (screenSession) return;
        try {
          var modules = screenSamplerModules();
          var rootPath = R.bridge.cs.getSystemPath(SystemPath.EXTENSION);
          var helperPath = modules.path.join(rootPath, 'tools', 'screen-color-picker.ps1');
          if (!modules.fs.existsSync(helperPath)) throw new Error('The Windows screen sampler is missing from the extension.');
          var id = modules.crypto.randomBytes(16).toString('hex');
          var session = {
            modules: modules,
            resultPath: modules.path.join(modules.os.tmpdir(), 'rebound-screen-' + id + '.txt'),
            cancelPath: modules.path.join(modules.os.tmpdir(), 'rebound-screen-' + id + '.cancel'),
            startedAt: Date.now(),
            error: null,
            exited: false,
            cancelRequested: false,
            cleanupTimer: null
          };
          try { modules.fs.unlinkSync(session.resultPath); } catch (oldResult) { if (oldResult.code !== 'ENOENT') throw oldResult; }
          try { modules.fs.unlinkSync(session.cancelPath); } catch (oldCancel) { if (oldCancel.code !== 'ENOENT') throw oldCancel; }
          var child = modules.childProcess.spawn('powershell.exe', [
            '-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', helperPath,
            '-ResultFile', session.resultPath,
            '-CancelFile', session.cancelPath
          ], { windowsHide: true, stdio: 'ignore' });
          session.child = child;
          screenSession = session;
          child.on('error', function (err) {
            session.error = err;
          });
          child.on('exit', function (code) {
            session.exited = true;
            session.exitCode = code;
            if (destroyed && screenSession === session) {
              if (session.cleanupTimer) { clearTimeout(session.cleanupTimer); session.cleanupTimer = null; }
              screenSession = null;
              removeScreenFiles(session);
            }
          });
          if (typeof child.unref === 'function') child.unref();
          if (dropperButton) dropperButton.disabled = true;
          ctx.toast('Click a screen pixel to sample it. Press Esc to cancel.', { kind: 'info' });
          pollScreenSample(session);
        } catch (err) {
          if (dropperButton) dropperButton.disabled = false;
          ctx.toast((err && err.message) || 'Could not start screen color sampling.', { kind: 'error' });
        }
      };

      // No persistent chrome during use: just your colours. Hovering reveals a
      // small Edit pill (top-right) to enter edit mode. The edit bar keeps Add and
      // Done together above the grid so neither action overlaps a swatch.
      var root = el('div.rb-wgt');
      var rebuild = function () {
        R.dom.clear(root);
        addButton = null;
        if (editing) {
          addButton = el('button.rb-wgt-addbtn', {
            type: 'button',
            title: 'Add a colour',
            onclick: addColor
          }, ['+']);
          root.appendChild(el('div.rb-wgt-editbar', null, [
            el('span.rb-wgt-editlabel', { text: 'Edit colours' }),
            addButton,
            dropperButton = el('button.rb-wgt-dropperbtn', {
              type: 'button',
              title: 'Sample a colour from anywhere on screen',
              onclick: sampleScreenColor
            }, ['Dropper']),
            el('button.rb-wgt-donebtn', { type: 'button', title: 'Finish editing your colours', onclick: function () { editing = false; rebuild(); } }, ['Done'])
          ]));
        } else {
          root.appendChild(el('button.rb-wgt-fab', { type: 'button', title: 'Add, change or remove your colours', onclick: function () { editing = true; rebuild(); } }, ['Edit']));
        }
        root.appendChild(grid);
        render();
      };

      ctx.body.appendChild(root);
      rebuild();
      var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(function () { render(); }) : null;
      if (ro) ro.observe(grid);
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(render);
      return { destroy: function () {
        destroyed = true;
        if (screenSampleTimer) { clearTimeout(screenSampleTimer); screenSampleTimer = null; }
        if (screenSession) {
          var session = screenSession;
          requestScreenCancel(session);
          session.cleanupTimer = setTimeout(function () {
            try { if (!session.exited) session.child.kill(); }
            catch (err) { if (R.log) R.log.warn('Could not stop the screen sampler after widget close.', err); }
            if (screenSession === session) screenSession = null;
            removeScreenFiles(session);
          }, 1500);
        }
        if (ro) { try { ro.disconnect(); } catch (e) { /* ignore */ } }
      } };
    }

    function currentRgb() { return hslToRgb(hue, saturation / 100, lightness / 100); }
    function currentState() { return { hue: hue, saturation: saturation, lightness: lightness, target: target }; }

    var previewHost = el('div.rb-color-preview');
    function renderPreview() { R.dom.clear(previewHost); previewHost.appendChild(colorSvg(currentState(), 90)); }

    var applyEls = []; // every button that applies a color: dead without layers

    var swatchRow = el('div.rb-color-swatches');
    for (var i = 0; i < PALETTE.length; i++) {
      swatchRow.appendChild(makeSwatch(PALETTE[i]));
    }

    var applyBtn = el('button.rb-btn.is-icon', {
      title: 'Apply the slider color',
      onclick: function () { apply(currentRgb()); }
    });
    applyEls.push(applyBtn);
    paint(applyBtn, currentRgb());

    // '#rrggbb' of the current slider color, for the shared picker swatch.
    function currentHex() {
      var c = currentRgb();
      return ui.colorUtil.rgbToHex(Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255));
    }

    // Shared themed picker: pick any color, load it into the sliders, and
    // refresh the preview; the sliders push back into the picker via set().
    var picker = ui.colorPicker({
      value: '#1fa6e0',
      storageKey: 'color-recents',
      title: 'Pick any color to load it into the sliders',
      onChange: function (c) { setFromHex(c.hex); }
    });

    // Sliders push into the picker; the picker pushes into the sliders (via
    // setFromHex). picker.set() never re-emits, so the two cannot loop.
    // `user` marks slider-driven syncs (a user edit: they apply even while the
    // hex field holds uncommitted text); without it the call counts as an
    // external sync, which the picker ignores while the user is editing.
    function syncPicker(user) { picker.set(currentHex(), { user: !!user }); }

    var hueSlider = ui.slider({ label: 'Hue', min: 0, max: 360, step: 1, value: hue,
      format: function (v) { return Math.round(v) + '°'; },
      onInput: function (v) { hue = v; updatePreview(); syncPicker(true); } });
    var satSlider = ui.slider({ label: 'Saturation', min: 0, max: 100, step: 1, value: saturation,
      format: function (v) { return Math.round(v) + '%'; },
      onInput: function (v) { saturation = v; updatePreview(); syncPicker(true); } });
    var lightSlider = ui.slider({ label: 'Lightness', min: 0, max: 100, step: 1, value: lightness,
      format: function (v) { return Math.round(v) + '%'; },
      onInput: function (v) { lightness = v; updatePreview(); syncPicker(true); } });

    var targetCtl = ui.segmented([
      { value: 'fill', label: 'Fill', title: 'Recolor fills' },
      { value: 'stroke', label: 'Stroke', title: 'Recolor strokes (shape layers)' },
      { value: 'both', label: 'Both', title: 'Recolor fills and strokes' }
    ], { value: target, onChange: function (v) { target = v; renderPreview(); } });

    renderPreview();
    ctx.body.appendChild(el('div.rb-col.rb-bento-layout.rb-color-layout', null, [
      el('section.rb-bento-section.is-feature.rb-color-preview-card', null, [
        el('div.rb-section-label', { text: 'Preview' }),
        previewHost
      ]),
      el('section.rb-bento-section.rb-color-controls-card', null, [
        el('div.rb-section-label', { text: 'Color controls' }),
        el('div.rb-faint.rb-color-intro', { text: 'Choose a swatch or tune the color. Set whether to apply it to fills, strokes, or both.' }),
        el('div.rb-color-control-group', null, [
          el('div.rb-color-group-label', { text: 'Palette' }),
          swatchRow
        ]),
        el('div.rb-color-slider-grid', null, [hueSlider.el, satSlider.el, lightSlider.el]),
        el('div.rb-color-control-group', null, [
          el('div.rb-color-group-label', { text: 'Apply to' }),
          targetCtl.el
        ]),
        el('div.rb-color-current-row', null, [
          applyBtn,
          el('span.rb-faint.rb-grow', { text: 'Current color' }),
          picker.el
        ])
      ])
    ]));
    syncPicker();

    function updatePreview() {
      paint(applyBtn, currentRgb());
      renderPreview();
    }

    function setFromHex(hex) {
      var hsl = rgbToHsl(hexToRgb(hex));
      hue = hsl[0]; saturation = hsl[1]; lightness = hsl[2];
      hueSlider.set(hue); satSlider.set(saturation); lightSlider.set(lightness);
      updatePreview();
    }

    function makeSwatch(hex) {
      var rgb = hexToRgb(hex);
      var b = el('button.rb-btn.is-icon.rb-color-swatch', { title: 'Set ' + hex });
      b.style.background = hex;
      b.style.borderColor = hex;
      b.addEventListener('click', function () { apply(rgb); });
      applyEls.push(b);
      return b;
    }

    function paint(node, rgb) {
      var css = rgbCss(rgb);
      node.style.background = css;
      node.style.borderColor = css;
    }

    var scopeText = el('span.rb-scope', { text: '' });
    ctx.footer.appendChild(scopeText);
    ctx.footer.appendChild(el('button.rb-btn', { title: 'Read the selected layer colour into the sliders', onclick: doRead }, ['Read']));

    // Applying only makes sense with layers selected (recoil.js syncButtons
    // pattern); the sliders and Read stay live.
    function setEnabled(sel) {
      var ok = !!(sel && sel.hasComp && sel.selectedLayerCount);
      for (var k = 0; k < applyEls.length; k++) {
        applyEls[k].disabled = !ok;
        applyEls[k].classList.toggle('is-disabled', !ok);
      }
    }

    var off = ctx.onSelection(function (sel) { scopeText.textContent = describe(sel); setEnabled(sel); });
    var initSel = ctx.getSelection();
    scopeText.textContent = describe(initSel);
    setEnabled(initSel);

    // Scan the selected layer's current colour into the sliders, so you tune the
    // existing colour instead of dialing one from scratch.
    function doRead() {
      ctx.invoke('color.read', {})
        .then(function (res) {
          if (!res || !res.found) { ctx.toast('Select a layer with a colour to read', { kind: 'error' }); return; }
      var hsl = rgbToHsl(res.rgb);
      hue = hsl[0]; saturation = hsl[1]; lightness = hsl[2];
      hueSlider.set(hue); satSlider.set(saturation); lightSlider.set(lightness);
      if (res.target) { target = res.target; targetCtl.set(res.target); }
      updatePreview();
      syncPicker(true); // explicit Read: apply even over an uncommitted edit
      ctx.toast('Read colour from ' + (res.layerName || 'layer'), { kind: 'info' });
        })
        .catch(function (err) { ctx.toast(err.message || 'Could not read colour', { kind: 'error' }); });
    }

    function apply(rgb) {
      ctx.invoke('color.apply', { rgb: rgb, target: target })
        .then(function (res) {
          if (!res.colored) {
            ctx.toast('No layers were colored', { kind: 'info' });
          } else {
            ctx.toast('Colored ' + res.colored + ' layer' + (res.colored === 1 ? '' : 's'), { kind: 'success' });
          }
          if (res.skipped && res.skipped.length) {
            ctx.toast('Skipped ' + res.skipped.length + ' layer' + (res.skipped.length === 1 ? '' : 's'), { kind: 'info' });
          }
          ctx.refreshSelection();
        })
        .catch(function (err) { ctx.toast(err.message || 'Could not set color', { kind: 'error' }); });
    }

    // Selecting a colored layer loads its current fill colour into the sliders.
    function loadColor(res) {
      if (!res || !res.found) return;
      // An AE read must never clobber an in-progress picker edit (typed hex,
      // live drag): the user's edit wins until it commits or is abandoned.
      if (picker.editing && picker.editing()) return;
      var hsl = rgbToHsl(res.rgb);
      hue = hsl[0]; saturation = hsl[1]; lightness = hsl[2];
      hueSlider.set(hue); satSlider.set(saturation); lightSlider.set(lightness);
      if (res.target) { target = res.target; targetCtl.set(res.target); }
      updatePreview();
      syncPicker();
    }
    return {
      destroy: function () { off(); picker.destroy(); },
      selectionRead: {
        matches: function (sel) { return !!(sel && sel.selectedLayerCount); },
        method: 'color.read',
        apply: function (res) { loadColor(res); }
      }
    };
  }

  // Hex string ('#rrggbb') to 0..1 RGB triplet.
  function hexToRgb(hex) {
    var h = hex.charAt(0) === '#' ? hex.substring(1) : hex;
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return [r / 255, g / 255, b / 255];
  }

  // HSL (h 0..360, s/l 0..1) to a 0..1 RGB triplet.
  function hslToRgb(h, s, l) {
    h = (h % 360) / 360;
    if (s === 0) return [l, l, l];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  }

  // 0..1 RGB triplet to HSL (h 0..360, s/l 0..100) for loading the sliders.
  function rgbToHsl(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h / 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function describe(sel) {
    if (!sel || !sel.hasComp) return 'Open a composition';
    if (!sel.selectedLayerCount) return 'Select layers to color';
    return sel.selectedLayerCount + ' layer' + (sel.selectedLayerCount === 1 ? '' : 's') + ' selected';
  }
})(window.Rebound = window.Rebound || {});