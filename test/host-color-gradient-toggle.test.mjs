import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'ADBE Root Vectors Group';
const VGROUP = 'ADBE Vector Group';
const CONTENTS = 'ADBE Vectors Group';
const FILL = 'ADBE Vector Graphic - Fill';
const GFILL = 'ADBE Vector Graphic - G-Fill';
const FILL_EFFECT_COLOR = 'ADBE Fill-0003';
const PropertyValueType = { COLOR: 6418 };

class SolidSource {
  constructor(color) { this.color = color; }
}

function group(matchName) {
  const properties = [];
  const value = {
    matchName,
    name: matchName,
    value: null,
    numKeys: 0,
    expressionEnabled: false,
    expression: '',
    propertyValueType: matchName === FILL_EFFECT_COLOR ? PropertyValueType.COLOR : 0,
    get numProperties() { return properties.length; },
    setValue(next) { this.value = next; },
    addProperty(name) {
      const child = group(name);
      child.remove = () => {
        const index = properties.indexOf(child);
        if (index !== -1) properties.splice(index, 1);
      };
      child.moveTo = (index) => {
        child.remove();
        properties.splice(index - 1, 0, child);
      };
      properties.push(child);
      return child;
    },
    property(key) {
      if (typeof key === 'number') return properties[key - 1];
      return properties.find((item) => item.matchName === key) || value.addProperty(key);
    }
  };
  return value;
}

function createHarness(layers) {
  const commands = {};
  const comp = {
    selectedLayers: layers,
    numLayers: layers.length,
    layer(index) { return layers[index - 1]; },
    layers: {
      addSolid(color, name, width, height, pixelAspect) {
        const source = {
          name,
          width,
          height,
          pixelAspect,
          mainSource: new SolidSource(color.slice()),
          usedIn: []
        };
        return { source, remove() {} };
      }
    }
  };
  const $ = {
    __rebound: {
      util: { activeComp: () => comp },
      rig: {
        findByName(layer, name) {
          const effects = layer.property('ADBE Effect Parade');
          if (!effects) return null;
          for (let i = effects.numProperties; i >= 1; i--) {
            const effect = effects.property(i);
            if (effect.name === name) return effect;
          }
          return null;
        }
      },
      grad: {
        applyGradient() {},
        applyGradientColors() { return true; },
        reason() { return ''; }
      },
      register(name, handler) { commands[name] = handler; },
      beginUndo() {},
      endUndo() {}
    }
  };
  function load(file) {
    const source = readFileSync(path.join(dir, '..', file), 'utf8');
    new Function('$', 'SolidSource', 'PropertyValueType', source)($, SolidSource, PropertyValueType);
  }
  load('host/commands/color.jsx');
  load('host/commands/gradient.jsx');
  return { commands, comp };
}

function shapeLayer() {
  const root = group(ROOT);
  const wrapper = root.addProperty(VGROUP);
  const contents = wrapper.addProperty(CONTENTS);
  const effects = group('ADBE Effect Parade');
  return {
    name: 'Shape',
    selected: true,
    sourceRectAtTime() { return { left: 0, top: 0, width: 100, height: 100 }; },
    property(name) {
      if (name === ROOT) return root;
      if (name === 'ADBE Effect Parade') return effects;
      return null;
    },
    _root: root,
    _contents: contents,
    _effects: effects
  };
}

function solidLayer() {
  const layer = {
    name: 'Solid',
    selected: true,
    width: 100,
    height: 100,
    pixelAspect: 1,
    sourceRectAtTime() { return { left: 0, top: 0, width: 100, height: 100 }; },
    property(name) { return name === 'ADBE Effect Parade' ? this._effects : null; },
    _effects: group('ADBE Effect Parade')
  };
  layer.source = {
    width: 100,
    height: 100,
    pixelAspect: 1,
    mainSource: new SolidSource([0, 0, 0]),
    usedIn: []
  };
  return layer;
}

function footageLayer() {
  return {
    name: 'Footage',
    selected: true,
    sourceRectAtTime() { return { left: 0, top: 0, width: 100, height: 100 }; },
    property(name) { return name === 'ADBE Effect Parade' ? this._effects : null; },
    _effects: group('ADBE Effect Parade'),
    source: { mainSource: {} }
  };
}

const GRADIENT = {
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
  stops: [
    { pos: 0, color: [1, 0, 0] },
    { pos: 1, color: [0, 0, 1] }
  ]
};

describe('Color and Gradient replace each other cleanly', () => {
  it('replaces a root-level solid shape fill when applying a gradient', () => {
    const layer = shapeLayer();
    const { commands } = createHarness([layer]);

    commands['color.apply']({ rgb: [1, 0, 0] });
    expect(layer._root.property(2).matchName).toBe(FILL);

    commands['gradient.apply'](GRADIENT);

    expect(layer._root.numProperties).toBe(1);
    expect(layer._contents.numProperties).toBe(1);
    expect(layer._contents.property(1).matchName).toBe(GFILL);
  });

  it('replaces a native shape gradient when applying a solid color', () => {
    const layer = shapeLayer();
    const { commands } = createHarness([layer]);

    commands['gradient.apply'](GRADIENT);
    commands['color.apply']({ rgb: [1, 0, 0] });

    expect(layer._contents.numProperties).toBe(0);
    expect(layer._root.property(2).matchName).toBe(FILL);
    expect(layer._root.property(2).property('ADBE Vector Fill Color').value).toEqual([1, 0, 0]);
  });

  it('clears the prior Rebound gradient on solids and fill overlay on footage', () => {
    const solid = solidLayer();
    const solidHarness = createHarness([solid]);
    solid.source.usedIn = [solidHarness.comp];
    solidHarness.commands['gradient.apply'](GRADIENT);
    expect(solid._effects.property(1).name).toBe('Rebound Gradient');
    solidHarness.commands['color.apply']({ rgb: [1, 0, 0] });
    expect(solid._effects.numProperties).toBe(0);
    expect(solid.source.mainSource.color).toEqual([1, 0, 0]);

    const footage = footageLayer();
    const footageHarness = createHarness([footage]);
    footageHarness.commands['color.apply']({ rgb: [1, 0, 0] });
    expect(footage._effects.property(1).name).toBe('Rebound Fill');
    footageHarness.commands['gradient.apply'](GRADIENT);
    expect(footage._effects.numProperties).toBe(1);
    expect(footage._effects.property(1).name).toBe('Rebound Gradient');
  });
});
