/*
 * Rebound, Gradient tool.
 * A multi-stop gradient editor applied to selected layers: build color stops,
 * choose linear or radial, preview it on shapes or text, and apply the gradient.
 */
;(function (R) {
  'use strict';

  var el = R.dom.el;

  // '#rrggbb' to a 0..1 RGB triplet for the host.
  function hexToRgb01(hex) {
    var h = ('' + hex).replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  // 0..1 RGB triplet (from the host) back to '#rrggbb'.
  function rgb01ToHex(c) {
    function h(v) { var x = Math.max(0, Math.min(255, Math.round((v || 0) * 255))).toString(16); return x.length < 2 ? '0' + x : x; }
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }

  var DEFAULT = { type: 'linear', angle: 0, stops: [{ pos: 0, color: '#1e63ff' }, { pos: 1, color: '#16e0c0' }] };

  // Built-in presets, module-level so each is a pinnable Home action at load
  // (R.toolPresets), without the tool ever having been opened.
  var GRADIENT_DEFAULTS = [
    { name: 'Ocean', state: { type: 'linear', angle: 0, stops: [{ pos: 0, color: '#1e63ff' }, { pos: 1, color: '#16e0c0' }] } },
    { name: 'Sunset', state: { type: 'linear', angle: 0, stops: [{ pos: 0, color: '#ff5e3a' }, { pos: 0.5, color: '#ff2d75' }, { pos: 1, color: '#ffd166' }] } },
    { name: 'Grape', state: { type: 'radial', angle: 0, stops: [{ pos: 0, color: '#f72fb0' }, { pos: 1, color: '#7b2ff7' }] } },
    { name: 'Spectrum', state: { type: 'linear', angle: 0, stops: [{ pos: 0, color: '#e5534b' }, { pos: 0.33, color: '#e8a838' }, { pos: 0.66, color: '#22b07d' }, { pos: 1, color: '#4990e2' }] } },
    { name: 'Mono Fade', state: { type: 'linear', angle: 0, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#222222' }] } }
  ];
  R.toolPresets.declare('gradient', { defaults: GRADIENT_DEFAULTS });

  R.tools.register({
    id: 'gradient',
    title: 'Gradient',
    group: 'Color',
    order: 3,
    keywords: ['gradient', 'ramp', 'fill', 'linear', 'radial', 'blend', 'shape', 'stops', 'multi'],
    mount: mount
  });

  function mount(ctx) {
    if (ctx.widget) {
      var swatchGrid = el('div.rb-wgt-pick.rb-wgt-gradient-grid');
      var widgetRoot = el('div.rb-wgt');
      var resizeObserver;
      var editing = false;
      var savedGradients = ctx.config && Array.isArray(ctx.config.gradients) ? ctx.config.gradients : null;
      var gradients = savedGradients
        ? savedGradients.map(function (item) {
          if (!item || !item.state) return null;
          var state = copyGradient(item.state);
          return state ? { name: String(item.name || 'Custom gradient'), state: state } : null;
        }).filter(function (item) { return !!item; })
        : GRADIENT_DEFAULTS.map(function (preset) {
          return { name: preset.name, state: copyGradient(preset.state) };
        });
      var MIN_CELL = 44, MAX_CELL = 96, GAP = 6;

      ctx.body.appendChild(widgetRoot);

      function persistGradients() {
        if (typeof ctx.setConfig === 'function') {
          ctx.setConfig({ gradients: gradients.map(function (item) {
            return { name: item.name, state: copyGradient(item.state) };
          }) });
        }
      }

      function openGradientEditor(index) {
        var isNew = index == null;
        var model = isNew ? copyGradient(DEFAULT) : copyGradient(gradients[index].state);
        var editor = R.ui.gradientEditor({ value: model });
        var handle;
        var cancelButton = el('button.rb-btn.is-ghost', {
          type: 'button',
          onclick: function () { handle.close('close'); }
        }, ['Cancel']);
        var saveButton = el('button.rb-btn.is-primary', {
          type: 'button',
          onclick: function () {
            var state = copyGradient(editor.getValue());
            if (!state) {
              ctx.toast('The gradient is incomplete and was not saved.', { kind: 'error' });
              return;
            }
            if (isNew) gradients.push({ name: 'Custom gradient', state: state });
            else gradients[index].state = state;
            persistGradients();
            render();
            handle.close('confirm');
          }
        }, ['Save']);
        handle = R.ui.modal({
          title: isNew ? 'Add gradient swatch' : 'Edit gradient swatch',
          width: 'min(660px, 96vw)',
          className: 'rb-modal-gradient',
          body: editor.el,
          footer: [cancelButton, saveButton],
          onClose: function () {
            if (editor.destroy) editor.destroy();
          }
        });
      }

      function removeGradient(index) {
        gradients.splice(index, 1);
        persistGradients();
        render();
      }

      function render() {
        R.dom.clear(widgetRoot);
        R.dom.clear(swatchGrid);
        if (editing) {
          widgetRoot.appendChild(el('div.rb-wgt-editbar', null, [
            el('span.rb-wgt-editlabel', { text: 'Edit gradients' }),
            el('button.rb-wgt-addbtn', {
              type: 'button',
              title: 'Add a custom gradient',
              onclick: function () { openGradientEditor(null); }
            }, ['+']),
            el('button.rb-wgt-donebtn', {
              type: 'button',
              title: 'Finish editing gradients',
              onclick: function () { editing = false; render(); }
            }, ['Done'])
          ]));
        }
        gradients.forEach(function (item, index) {
          var swatch;
          if (editing) {
            swatch = el('div.rb-wgt-swatch.rb-wgt-gradient-swatchedit', {
              title: 'Click to edit ' + item.name,
              style: { background: R.ui.gradientCss(item.state) },
              onclick: function (event) {
                if (event.target.closest && event.target.closest('.rb-wgt-swx')) return;
                openGradientEditor(index);
              }
            }, [
              el('span.rb-wgt-swx', {
                title: 'Remove ' + item.name,
                onclick: function (event) {
                  event.preventDefault();
                  event.stopPropagation();
                  removeGradient(index);
                }
              }, ['×'])
            ]);
          } else {
            swatch = el('button.rb-wgt-swatch', {
              type: 'button',
              title: 'Apply ' + item.name + ' gradient',
              'aria-label': 'Apply ' + item.name + ' gradient',
              style: { background: R.ui.gradientCss(item.state) },
              onclick: function () {
                applyGradient(ctx, item.state);
              }
            });
          }
          swatchGrid.appendChild(swatch);
        });
        if (!editing) {
          widgetRoot.appendChild(el('button.rb-wgt-fab.rb-wgt-gradient-edit', {
            type: 'button',
            title: 'Add, edit or remove gradient swatches',
            onclick: function () { editing = true; render(); }
          }, ['Edit']));
        }
        widgetRoot.appendChild(swatchGrid);
        layoutSwatches();
      }

      function layoutSwatches() {
        var width = swatchGrid.getBoundingClientRect().width || widgetRoot.getBoundingClientRect().width || 220;
        var columns = Math.max(1, Math.min(3, Math.floor((width + GAP) / (MIN_CELL + GAP))));
        var cellSize = Math.min(MAX_CELL, Math.floor((width - (columns - 1) * GAP) / columns));
        var rows = Math.max(1, Math.ceil(gradients.length / columns));
        var gridHeight = rows * cellSize + (rows - 1) * GAP;
        swatchGrid.style.gridTemplateColumns = 'repeat(' + columns + ', ' + cellSize + 'px)';
        swatchGrid.style.gridTemplateRows = 'repeat(' + rows + ', ' + cellSize + 'px)';
        swatchGrid.style.gap = GAP + 'px';
        swatchGrid.style.minHeight = gridHeight + 'px';
        if (typeof ctx.setWidgetContentHeight === 'function') {
          ctx.setWidgetContentHeight(gridHeight + (editing ? 30 : 0));
        }
      }

      render();
      layoutSwatches();
      resizeObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(layoutSwatches) : null;
      if (resizeObserver) resizeObserver.observe(swatchGrid);
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(layoutSwatches);
      return { destroy: function () { if (resizeObserver) resizeObserver.disconnect(); } };
    }

    var editor = R.ui.gradientEditor({ value: DEFAULT });

    ctx.body.appendChild(el('div.rb-col', null, [
      el('div.rb-faint', { text: 'Build a multi-stop gradient and apply it to selected layers. Click the bar to add a stop, drag to move it, or select one to recolor or reposition. Shape layers get native fills; other compatible layers get editable effects.' }),
      editor.el
    ]));

    var scopeText = el('span.rb-scope', { text: '' });
    ctx.footer.appendChild(scopeText);
    ctx.footer.appendChild(el('button.rb-btn', { title: 'Read the selected layer gradient into the editor', onclick: doRead }, ['Read']));
    ctx.footer.appendChild(el('button.rb-btn.is-primary', { onclick: doApply }, ['Apply']));

    var off = ctx.onSelection(function (sel) { scopeText.textContent = describe(sel); });
    scopeText.textContent = describe(ctx.getSelection());

    // Scan the selected shape layer's current gradient fill into the editor, so you
    // can tweak what is already there instead of rebuilding it.
    function doRead() {
      ctx.invoke('gradient.read', {})
        .then(function (res) {
          if (!res || !res.found) { ctx.toast('Select a shape layer with a gradient fill to read', { kind: 'error' }); return; }
          // AE can't hand shape gradient stop colours back to scripts; when the
          // host says so, take the geometry/type but keep the editor's stops.
          var stops = res.colorsUnreadable
            ? editor.getValue().stops
            : res.stops.map(function (s) { return { pos: s.pos, color: rgb01ToHex(s.color) }; });
          editor.setValue({ type: res.type, angle: res.angle, stops: stops });
          if (res.colorsUnreadable) ctx.toast('AE cannot read gradient colours back; kept your stops', { kind: 'info' });
          else ctx.toast('Read gradient from ' + (res.layerName || 'layer'), { kind: 'info' });
        })
        .catch(function (err) { ctx.toast(err.message || 'Could not read gradient', { kind: 'error' }); });
    }

    function doApply() {
      applyGradient(ctx, editor.getValue());
    }

    return {
      presets: {
        toolId: 'gradient',
        get: function () { return editor.getValue(); },
        set: function (s) { editor.setValue(s); },
        thumbFor: function (state, opts) {
          return el('div', { style: { height: ((opts && opts.height) || 38) + 'px', borderRadius: 'var(--rb-radius-1)', background: R.ui.gradientCss(state) } });
        },
        defaults: GRADIENT_DEFAULTS
      },
      // Selecting a gradient-filled shape loads its current gradient. When AE
      // can't hand the stop colours back (colorsUnreadable), leave the editor
      // alone -- overwriting the user's stops with a fabricated ramp is worse.
      selectionRead: {
        matches: function (sel) { return !!(sel && sel.selectedLayerCount); },
        method: 'gradient.read',
        apply: function (res) {
          if (!res || !res.found || res.colorsUnreadable) return;
          editor.setValue({ type: res.type, angle: res.angle, stops: res.stops.map(function (s) { return { pos: s.pos, color: rgb01ToHex(s.color) }; }) });
        }
      },
      destroy: off
    };
  }

  function applyGradient(ctx, model) {
    var selection = ctx.getSelection ? ctx.getSelection() : null;
    if (selection && !selection.hasComp) {
      ctx.toast('Open a composition and select one or more layers before applying a gradient.', { kind: 'error' });
      return;
    }
    if (selection && selection.selectedLayerCount === 0) {
      ctx.toast('Select one or more layers in the active composition before applying a gradient.', { kind: 'error' });
      return;
    }
    var line = R.ui.gradientLineOf(model);
    var angle = Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x) * 180 / Math.PI;
    ctx.invoke('gradient.apply', {
      type: model.type,
      angle: angle,
      start: line.a,
      end: line.b,
      stops: model.stops.map(function (stop) { return { pos: stop.pos, color: hexToRgb01(stop.color) }; })
    })
      .then(function (res) {
      if (!res.applied) {
        ctx.toast((res.skippedReasons && res.skippedReasons[0]) || 'No selected layer could accept a gradient.', { kind: 'error' });
      } else if (res.fallbackFailed) {
        ctx.toast('Gradient could not be fully applied: ' + (res.reason || 'the colour fallback failed.'), { kind: 'error' });
      } else if (res.approximated) {
        ctx.toast('Applied to ' + res.applied + ' layer' + (res.applied === 1 ? '' : 's') +
          ' with an editable four-colour approximation' + (res.skipped ? '; ' + res.skipped + ' skipped' : ''), { kind: 'warn' });
      } else if (res.colorsApplied === false) {
        ctx.toast('Applied with an editable Gradient Ramp effect because native shape colours were unavailable' +
          (res.skipped ? '; ' + res.skipped + ' skipped' : ''), { kind: 'info' });
      } else {
        ctx.toast('Applied to ' + res.applied + ' layer' + (res.applied === 1 ? '' : 's') +
          (res.effectsApplied ? ' with an editable Gradient Ramp effect' : ' as native shape fills') +
          (res.skipped ? '; ' + res.skipped + ' skipped' : ''), { kind: 'success' });
      }
      if (res.skipped && res.skippedReasons && res.skippedReasons.length) {
        ctx.toast(res.skippedReasons[0], { kind: 'info' });
      }
      ctx.refreshSelection();
    })
      .catch(function (err) { ctx.toast(err.message || 'Could not add gradient', { kind: 'error' }); });
  }

  function copyGradient(model) {
    if (!model || !Array.isArray(model.stops) || model.stops.length < 2) return null;
    var stops = model.stops.map(function (stop) {
      if (!stop || !/^#[0-9a-f]{6}$/i.test(String(stop.color || ''))) return null;
      var pos = Number(stop.pos);
      if (!isFinite(pos)) return null;
      return { pos: Math.max(0, Math.min(1, pos)), color: stop.color.toLowerCase() };
    });
    if (stops.some(function (stop) { return !stop; })) return null;
    var result = {
      type: model.type === 'radial' ? 'radial' : 'linear',
      angle: isFinite(Number(model.angle)) ? Number(model.angle) : 0,
      stops: stops
    };
    if (model.start && model.end && isFinite(Number(model.start.x)) && isFinite(Number(model.start.y)) &&
        isFinite(Number(model.end.x)) && isFinite(Number(model.end.y))) {
      result.start = { x: Number(model.start.x), y: Number(model.start.y) };
      result.end = { x: Number(model.end.x), y: Number(model.end.y) };
    }
    return result;
  }

  function describe(sel) {
    if (!sel || !sel.hasComp) return 'Open a composition';
    if (!sel.selectedLayerCount) return 'Select layers';
    return sel.selectedLayerCount + ' layer' + (sel.selectedLayerCount === 1 ? '' : 's') + ' selected';
  }
})(window.Rebound = window.Rebound || {});
