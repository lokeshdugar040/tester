/*
 * Rebound host, Gradient (fill shape layers or apply effects to other layers).
 *
 * For each selected shape layer (one that carries a Root Vectors Group), we
 * recurse the vectors tree and add a Gradient Fill operator to every shape
 * group's contents collection. The ramp type is set to linear (1) or radial
 * (2), and the start/end points are spread horizontally so the ramp is visible.
 * Stop COLOURS cannot be written directly ('ADBE Vector Grad Colors' is
 * NO_VALUE; setValue is silently ignored), so they go through the shared .ffx
 * preset trick in $.__rebound.grad (host/lib/grad.jsx). When that path fails,
 * the failure and its reason are surfaced in the response instead of pretending
 * success over a black-to-white ramp. Other effect-capable layers receive an
 * editable Gradient Ramp or four-colour gradient effect.
 */
(function () {
  var R = $.__rebound;
  var util = R.util;

  var ROOT = 'ADBE Root Vectors Group';
  var VGROUP = 'ADBE Vector Group';      // a group wrapper ("Rectangle 1")
  var GROUP_CONTENTS = 'ADBE Vectors Group'; // its child container
  var GFILL = 'ADBE Vector Graphic - G-Fill';
  var FILL = 'ADBE Vector Graphic - Fill';
  var GRAD_TYPE = 'ADBE Vector Grad Type';
  var GRAD_START = 'ADBE Vector Grad Start Pt';
  var GRAD_END = 'ADBE Vector Grad End Pt';
  var GRAD_COLORS = 'ADBE Vector Grad Colors';

  function clamp01(v) {
    if (v == null || isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function readColor(rgb, fallback) {
    if (!rgb || rgb.length < 3) return fallback;
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  }

  function clampPos(v) {
    if (v == null || isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Add a gradient fill to a shape group's contents collection. Replacing the
  // existing Fill/G-Fill operators avoids the old solid colour covering the
  // gradient and prevents repeated applies from stacking stale gradients.
  // Returns the number of gradient fills added.
  function addGradientFill(contents, state) {
    var grad = $.__rebound.grad;
    var hasSolidFill = false;
    for (var i = contents.numProperties; i >= 1; i--) {
      var child = contents.property(i);
      if (child.matchName === FILL || (state.replaceFill && child.matchName === GFILL)) {
        if (state.replaceFill) child.remove();
        else hasSolidFill = true;
      }
    }
    var gfill = contents.addProperty(GFILL);
    if (hasSolidFill) {
      // Render on top of the solid Fill, not invisibly behind it.
      try { gfill.moveTo(1); gfill = contents.property(1); } catch (eMv) {}
    }

    grad.applyGradient(gfill, { type: state.gradType, start: state.sp, end: state.ep });
    if (!grad.applyGradientColors(gfill, state.stops)) {
      state.colorsFailed = true;
      state.layerColorsFailed = true;
      if (!state.reason) state.reason = grad.reason();
    }
    return 1;
  }

  // Walk a vectors group. Every nested shape group's contents collection
  // ('ADBE Vectors Group') receives a gradient fill; nested groups recurse.
  // Returns the number of gradient fills added in this subtree.
  function fillGroups(group, state) {
    // Snapshot the nested contents collections first; adding a G-Fill mutates
    // a collection while we iterate over its siblings.
    var nested = [];
    for (var i = 1; i <= group.numProperties; i++) {
      var child = group.property(i);
      if (child.matchName === GROUP_CONTENTS) {
        nested.push(child);
      } else if (child.matchName === VGROUP) {
        // A group wrapper ("Rectangle 1"): its contents collection is one level
        // deeper. Tool-drawn shapes always sit inside such a wrapper.
        var contents = child.property(GROUP_CONTENTS);
        if (contents) nested.push(contents);
      }
    }

    var added = 0;
    for (var k = 0; k < nested.length; k++) {
      added += addGradientFill(nested[k], state);
      added += fillGroups(nested[k], state);
    }
    return added;
  }

  function sourceBounds(layer, comp) {
    var bounds = null;
    try { bounds = layer.sourceRectAtTime(comp.time, false); } catch (e) {}
    if (bounds && bounds.width > 0 && bounds.height > 0) return bounds;
    var width = 0, height = 0;
    try { width = layer.width; height = layer.height; } catch (e2) {}
    if (width > 0 && height > 0) return { left: 0, top: 0, width: width, height: height };
    return null;
  }

  function pointOnLine(start, end, t, bounds) {
    return [
      bounds.left + (start.x + (end.x - start.x) * t) * bounds.width,
      bounds.top + (start.y + (end.y - start.y) * t) * bounds.height
    ];
  }

  function colorAt(stops, pos) {
    var i;
    for (i = 0; i < stops.length - 1; i++) {
      if (pos <= stops[i + 1].pos) break;
    }
    var a = stops[Math.min(i, stops.length - 1)];
    var b = stops[Math.min(i + 1, stops.length - 1)];
    var span = b.pos - a.pos;
    var t = span > 0 ? clamp01((pos - a.pos) / span) : 0;
    return [
      a.color[0] + (b.color[0] - a.color[0]) * t,
      a.color[1] + (b.color[1] - a.color[1]) * t,
      a.color[2] + (b.color[2] - a.color[2]) * t
    ];
  }

  function namedEffect(effects, name) {
    for (var i = effects.numProperties; i >= 1; i--) {
      var effect = effects.property(i);
      if (effect && effect.name === name) return effect;
    }
    return null;
  }

  function removeNamedEffects(layer, name) {
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) return 0;
    var removed = 0;
    for (var i = effects.numProperties; i >= 1; i--) {
      var effect = effects.property(i);
      if (effect && effect.name === name) {
        effect.remove();
        removed++;
      }
    }
    return removed;
  }

  function removeFillOperators(group) {
    for (var i = group.numProperties; i >= 1; i--) {
      var child = group.property(i);
      if (child.matchName === FILL || child.matchName === GFILL) {
        child.remove();
      } else if (child.matchName === GROUP_CONTENTS) {
        removeFillOperators(child);
      } else if (child.matchName === VGROUP) {
        var contents = child.property(GROUP_CONTENTS);
        if (contents) removeFillOperators(contents);
      }
    }
  }

  // Address by matchName, falling back to the property's position in the effect
  // (matchNames differ slightly between AE versions; the order is stable).
  function setEffectValue(effect, matchName, value, index) {
    var prop = null;
    try { prop = effect.property(matchName); } catch (eMatch) {}
    if (!prop && index) { try { prop = effect.property(index); } catch (eIdx) {} }
    if (!prop) throw new Error('Gradient effect property is unavailable: ' + matchName);
    prop.setValue(value);
  }

  function applyEffectGradient(layer, comp, state, start, end) {
    var effects = layer.property('ADBE Effect Parade');
    var bounds = sourceBounds(layer, comp);
    if (!effects || !bounds) return false;

    var effectName = 'Rebound Gradient';
    var previous = namedEffect(effects, effectName);
    var effect;

    if (state.stops.length <= 2) {
      effect = effects.addProperty('ADBE Ramp');
      if (!effect) throw new Error('After Effects could not add a Gradient Ramp to ' + layer.name + '.');
      try {
        effect.name = effectName;
        setEffectValue(effect, 'ADBE Ramp-0001', pointOnLine(start, end, 0, bounds), 1);
        setEffectValue(effect, 'ADBE Ramp-0002', state.stops[0].color, 2);
        setEffectValue(effect, 'ADBE Ramp-0003', pointOnLine(start, end, 1, bounds), 3);
        setEffectValue(effect, 'ADBE Ramp-0004', state.stops[state.stops.length - 1].color, 4);
        setEffectValue(effect, 'ADBE Ramp-0005', state.gradType, 5);
        setEffectValue(effect, 'ADBE Ramp-0007', 0, 7);
      } catch (rampError) {
        try { effect.remove(); } catch (eRm) {}
        throw rampError;
      }
      if (previous) previous.remove();
      return 'ramp';
    }

    effect = effects.addProperty('ADBE 4ColorGradient');
    if (!effect) throw new Error('After Effects could not add a 4-Color Gradient to ' + layer.name + '.');
    try {
      effect.name = effectName;
      var pointNames = ['ADBE 4ColorGradient-0002', 'ADBE 4ColorGradient-0004', 'ADBE 4ColorGradient-0006', 'ADBE 4ColorGradient-0008'];
      var colorNames = ['ADBE 4ColorGradient-0003', 'ADBE 4ColorGradient-0005', 'ADBE 4ColorGradient-0007', 'ADBE 4ColorGradient-0009'];
      for (var i = 0; i < 4; i++) {
        var pos = i / 3;
        setEffectValue(effect, pointNames[i], pointOnLine(start, end, pos, bounds), 2 + i * 2);
        setEffectValue(effect, colorNames[i], colorAt(state.stops, pos), 3 + i * 2);
      }
      setEffectValue(effect, 'ADBE 4ColorGradient-0010', 100, 10);
    } catch (fourError) {
      try { effect.remove(); } catch (eRm2) {}
      throw fourError;
    }
    if (previous) previous.remove();
    return 'four-color';
  }

  function apply(args) {
    var comp = util.activeComp();
    var layers = comp.selectedLayers;
    if (!layers || !layers.length) throw new Error('Select one or more layers to apply a gradient.');

    var gradType = (args && args.type === 'radial') ? 2 : 1;

    // Multi-stop: args.stops = [{ pos, color:[r,g,b] }]. Fall back to a two-stop
    // gradient from startColor/endColor for older callers.
    var stops = [];
    if (args && args.stops && args.stops.length >= 2) {
      for (var si = 0; si < args.stops.length; si++) {
        var st = args.stops[si];
        stops.push({ pos: clampPos(st.pos), color: readColor(st.color, [0, 0, 0]) });
      }
    } else {
      stops.push({ pos: 0, color: readColor(args && args.startColor, [0, 0, 0]) });
      stops.push({ pos: 1, color: readColor(args && args.endColor, [1, 1, 1]) });
    }
    // Ramp endpoints. Prefer the explicit line (normalized 0..1, mapped to a
    // +/-100 box so a line dragged outside the shape extends past it); fall back
    // to rotating a centered line by the angle for older callers.
    var sp, ep;
    if (args && args.start && args.end) {
      sp = [(args.start.x - 0.5) * 200, (args.start.y - 0.5) * 200];
      ep = [(args.end.x - 0.5) * 200, (args.end.y - 0.5) * 200];
    } else {
      var ang = (args && args.angle != null) ? args.angle : 0;
      var t = ang * Math.PI / 180;
      sp = [Math.cos(t) * -100, Math.sin(t) * -100];
      ep = [Math.cos(t) * 100, Math.sin(t) * 100];
    }

    stops.sort(function (a, b) { return a.pos - b.pos; });
    var effectStart = args && args.start ? args.start : { x: sp[0] / 200 + 0.5, y: sp[1] / 200 + 0.5 };
    var effectEnd = args && args.end ? args.end : { x: ep[0] / 200 + 0.5, y: ep[1] / 200 + 0.5 };
    var applied = 0;
    var skipped = 0;

    // Shared walk state: geometry, stops, the explicit replace option, and the
    // honest record of whether the preset colour path held everywhere.
    var state = {
      gradType: gradType,
      stops: stops,
      sp: sp,
      ep: ep,
      replaceFill: !args || args.replaceFill !== false,
      colorsFailed: false,
      reason: '',
      effectsApplied: 0,
      approximated: 0,
      layerColorsFailed: false,
      fallbackFailed: false
    };
    var skippedReasons = [];
    // Applying native colours deselects layers/properties (preset trick); put the
    // user's selection back so the next click still sees a selection.
    var keepSelected = [];
    for (var ks = 0; ks < layers.length; ks++) keepSelected.push(layers[ks]);

    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (state.replaceFill) {
        removeNamedEffects(layer, 'Rebound Fill');
        removeNamedEffects(layer, 'Rebound Gradient');
      }
      var root = layer.property(ROOT);
      if (root) {
        if (state.replaceFill) removeFillOperators(root);
        state.layerColorsFailed = false;
        var fillsAdded = fillGroups(root, state);
        if (fillsAdded > 0) {
          applied++;
          if (state.layerColorsFailed) {
            try {
              var fallbackKind = applyEffectGradient(layer, comp, state, effectStart, effectEnd);
              if (fallbackKind) {
                state.effectsApplied++;
                if (fallbackKind === 'four-color') state.approximated++;
              } else {
                state.fallbackFailed = true;
                state.reason = 'Native stop colours failed (' + state.reason + '); this layer cannot host a gradient effect.';
              }
            } catch (fallbackError) {
              state.fallbackFailed = true;
              state.reason = 'Native stop colours failed (' + state.reason + '); effect fallback failed: ' + fallbackError.message;
            }
          }
        } else {
          skipped++;
          skippedReasons.push((layer.name || 'Selected layer') + ' has no shape groups to fill.');
        }
      } else {
        try {
          var effectKind = applyEffectGradient(layer, comp, state, effectStart, effectEnd);
          if (effectKind) {
            applied++;
            state.effectsApplied++;
            if (effectKind === 'four-color') state.approximated++;
          } else {
            skipped++;
            skippedReasons.push((layer.name || 'Selected layer') + ' does not support gradient effects.');
          }
        } catch (effectError) {
          skipped++;
          skippedReasons.push((layer.name || 'Selected layer') + ': ' + effectError.message);
        }
      }
    }

    for (var rs = 0; rs < keepSelected.length; rs++) {
      try { keepSelected[rs].selected = true; } catch (eSel) {}
    }

    return {
      applied: applied,
      skipped: skipped,
      colorsApplied: !state.colorsFailed,
      reason: state.colorsFailed ? state.reason : '',
      effectsApplied: state.effectsApplied,
      approximated: state.approximated,
      fallbackFailed: state.fallbackFailed,
      skippedReasons: skippedReasons
    };
  }

  // ---- Read the current gradient off the selected layer ---------------------

  // Find the first Gradient Fill anywhere in a vectors tree (depth first).
  function findFirstGFill(group) {
    for (var i = 1; i <= group.numProperties; i++) {
      var child = group.property(i);
      if (child.matchName === GFILL) return child;
      if (child.matchName === GROUP_CONTENTS) {
        var found = findFirstGFill(child);
        if (found) return found;
      } else if (child.matchName === VGROUP) {
        var contents = child.property(GROUP_CONTENTS);
        if (contents) {
          var fg = findFirstGFill(contents);
          if (fg) return fg;
        }
      }
    }
    return null;
  }

  // Decode the flat Grad Colors array back to [{ pos, color:[r,g,b] }]. The array
  // is N color stops (4 numbers each: pos,r,g,b) then N alpha stops (2 each), so a
  // well-formed value length is divisible by 6; we take the first 4N as colours.
  // In practice AE usually can't hand this stream back ('ADBE Vector Grad Colors'
  // is NO_VALUE), so callers must expect null and NOT fabricate a ramp.
  function decodeStops(data) {
    if (!data || !data.length || data.length % 6 !== 0) return null;
    var n = data.length / 6, stops = [];
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      stops.push({ pos: clampPos(data[o]), color: [clamp01(data[o + 1]), clamp01(data[o + 2]), clamp01(data[o + 3])] });
    }
    return stops;
  }

  function read() {
    var comp = util.activeComp();
    var layers = comp.selectedLayers;
    if (!layers || !layers.length) return { found: false };
    for (var i = 0; i < layers.length; i++) {
      var root = layers[i].property(ROOT);
      if (!root) continue;
      var gfill = findFirstGFill(root);
      if (!gfill) continue;
      var type = (gfill.property(GRAD_TYPE).value === 2) ? 'radial' : 'linear';
      var sp = [-100, 0], ep = [100, 0], stops = null;
      try { sp = gfill.property(GRAD_START).value; ep = gfill.property(GRAD_END).value; } catch (e) {}
      try { stops = decodeStops(gfill.property(GRAD_COLORS).value); } catch (e2) {}
      // When the colour stream can't be decoded (the usual AE case), say so
      // instead of fabricating black-to-white: geometry and type are still real,
      // but stops:null + colorsUnreadable lets the panel keep the user's stops.
      var colorsUnreadable = false;
      if (!stops || stops.length < 2) { stops = null; colorsUnreadable = true; }
      return {
        found: true,
        layerName: layers[i].name,
        type: type,
        angle: Math.atan2(ep[1] - sp[1], ep[0] - sp[0]) * 180 / Math.PI,
        start: { x: sp[0] / 200 + 0.5, y: sp[1] / 200 + 0.5 },
        end: { x: ep[0] / 200 + 0.5, y: ep[1] / 200 + 0.5 },
        stops: stops,
        colorsUnreadable: colorsUnreadable
      };
    }
    return { found: false };
  }

  R.register('gradient.apply', apply, 'Rebound: Gradient');
  R.register('gradient.read', read); // read-only, no undo group
})();
