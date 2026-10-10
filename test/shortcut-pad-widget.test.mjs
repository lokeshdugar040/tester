import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, '../client/js/ui/shortcut-pad-widget.js'), 'utf8');
const padsSource = readFileSync(path.join(testDir, '../client/js/ui/shortcut-pads.js'), 'utf8');
const mapSource = readFileSync(path.join(testDir, '../client/js/ui/ae-shortcut-map.js'), 'utf8');
const domSource = readFileSync(path.join(testDir, '../client/js/core/dom.js'), 'utf8');

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.document = document;
    this.childNodes = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.draggable = false;
    this.parentNode = null;
    this._text = '';
    this._classNames = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this._classNames.add(name)),
      remove: (...names) => names.forEach((name) => this._classNames.delete(name)),
      contains: (name) => this._classNames.has(name),
      toggle: (name, force) => {
        const next = force === undefined ? !this._classNames.has(name) : !!force;
        if (next) this._classNames.add(name);
        else this._classNames.delete(name);
        return next;
      }
    };
  }

  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((node) => node instanceof FakeElement); }
  get className() { return Array.from(this._classNames).join(' '); }
  set className(value) {
    this._classNames = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }
  get textContent() {
    if (!this.childNodes.length) return this._text;
    return this.childNodes.map((node) => node.textContent || '').join('');
  }
  set textContent(value) {
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
    this._text = String(value == null ? '' : value);
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) {
    (this.listeners[name] || (this.listeners[name] = [])).push(listener);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    (this.listeners[event.type] || []).slice().forEach((listener) => listener(event));
  }
  focus() { this.document.activeElement = this; }
  contains(node) {
    if (this === node) return true;
    return this.childNodes.some((child) =>
      child instanceof FakeElement && child.contains(node));
  }
  querySelector(selector) {
    const slot = /\[data-slot=["']?(\d+)["']?\]/.exec(selector);
    if (slot) {
      return findElement(this, (node) =>
        node !== this && node.getAttribute('data-slot') === slot[1]);
    }
    const className = /\.([\w-]+)/.exec(selector);
    const wantedClass = className && className[1];
    const wantedTag = selector.split('.')[0].toUpperCase();
    return findElement(this, (node) =>
      node !== this && (!wantedTag || node.tagName === wantedTag) &&
      (!wantedClass || node.classList.contains(wantedClass)));
  }
  querySelectorAll(selector) {
    const className = /\.([\w-]+)/.exec(selector);
    const wantedClass = className && className[1];
    return allElements(this, (node) =>
      !wantedClass || node.classList.contains(wantedClass));
  }
}

class FakeText {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
  createTextNode(text) { return new FakeText(text); }
}

function findElement(root, predicate) {
  for (const child of root.childNodes || []) {
    if (child instanceof FakeElement) {
      if (predicate(child)) return child;
      const nested = findElement(child, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function allElements(root, predicate = () => true) {
  const found = [];
  function visit(node) {
    for (const child of node.childNodes || []) {
      if (!(child instanceof FakeElement)) continue;
      if (predicate(child)) found.push(child);
      visit(child);
    }
  }
  visit(root);
  return found;
}

function click(element) {
  element.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {}
  });
}

function createRuntime(options = {}) {
  const document = new FakeDocument();
  const frameQueue = [];
  const timerQueue = [];
  const toasts = [];
  const errors = [];
  const dialogs = [];
  const storageWrites = [];
  const executionCalls = [];
  const settings = {};
  const actions = options.actions || [
    {
      id: 'ae.undo',
      label: 'Undo',
      commandName: 'Undo',
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      commandActionId: 'ae-undo',
      deliveryRoute: 'host-command',
      aeMapShortcut: true,
      aeVersion: '26.5x89',
      activeChord: 'Ctrl+Z',
      displayChord: 'Ctrl + Z',
      menuPath: 'Edit › Undo',
      workflowCategory: 'General',
      commandRequest: {
        commandActionId: 'ae-undo',
        commandId: 2371,
        commandIdSource: 'verified-host-probe',
        preferredRoute: 'host-command'
      }
    },
    {
      id: 'ae.redo',
      label: 'Redo',
      commandName: 'Redo',
      commandId: 2372,
      commandIdSource: 'verified-host-probe',
      commandActionId: 'ae-redo',
      deliveryRoute: 'host-command',
      aeMapShortcut: true,
      aeVersion: '26.5x89',
      activeChord: 'Ctrl+Shift+Z',
      displayChord: 'Ctrl + Shift + Z',
      menuPath: 'Edit › Redo',
      workflowCategory: 'General',
      commandRequest: {
        commandActionId: 'ae-redo',
        commandId: 2372,
        commandIdSource: 'verified-host-probe',
        preferredRoute: 'host-command'
      }
    }
  ];
  const entries = actions.map((action) => Object.assign({
    actionId: action.id,
    deliveryRoute: 'host-command'
  }, action));
  // Explicit default pins (the production store does not auto-seed them).
  const defaultPins = [
    { id: 'pin-undo', label: 'Undo', actionId: 'ae.undo', pinnedSlot: 0 },
    { id: 'pin-redo', label: 'Redo', actionId: 'ae.redo', pinnedSlot: 1 }
  ];
  let stored = options.initialPads !== undefined ? options.initialPads : defaultPins;
  let writeFails = options.writeFails === true;
  const R = {
    log: {
      info() {},
      warn() {},
      error(message, error) { errors.push({ message, error }); }
    },
    afterEffectsShortcuts: {
      catalogEntries() { return entries; },
      resolveAction(id) { return actions.find((action) => action.id === id) || null; }
    },
    actionRouter: {
      resolveAction(id) { return actions.find((action) => action.id === id) || null; },
      selectRoute(action) { return action ? 'host-command' : 'unsupported'; },
      executePin(pinId, source) {
        executionCalls.push({ pinId, source });
        return Promise.resolve(options.executionResult || {
          state: 'Done',
          verified: true,
          userMessage: 'The action completed.'
        });
      }
    },
    homeActions: { byId(id) { return actions.find((action) => action.id === id) || null; } },
    globalHotkeys: {
      supported: true,
      hotkeyCapture: { active: false, sessionId: '' },
      cleanPadKey(key) {
        const value = String(key || '');
        return /^[a-z]$/i.test(value) ? value.toUpperCase() : value || null;
      },
      cleanPadChord(chord) {
        return String(chord || '').replace(/\s+/g, '').split('+').join('+');
      },
      beginCaptureSession() { return ''; },
      endCaptureSession() { return true; },
      isCaptureActive() { return false; },
      bindingFor() { return null; },
      bindings() { return {}; },
      setBinding() { return { ok: true }; },
      clearBinding() { return { ok: true }; }
    },
    disk: {
      read(key, fallback) {
        if (key === 'home-shortcut-pads') return stored == null ? fallback : stored;
        return settings[key] === undefined ? fallback : settings[key];
      },
      write(key, value) {
        return this.writeAtomic(key, value);
      },
      writeAtomic(key, value) {
        if (writeFails && key === 'home-shortcut-pads') return false;
        storageWrites.push(key);
        if (key === 'home-shortcut-pads') stored = JSON.parse(JSON.stringify(value));
        else settings[key] = JSON.parse(JSON.stringify(value));
        return true;
      }
    }
  };
  const window = {
    Rebound: R,
    navigator: { platform: 'Win32' },
    requestAnimationFrame(callback) { frameQueue.push(callback); },
    setTimeout(callback) { timerQueue.push(callback); return timerQueue.length; },
    addEventListener() {},
    removeEventListener() {}
  };
  new Function('window', 'document', mapSource)(window, document);
  new Function('window', 'document', domSource)(window, document);
  new Function('window', 'document', padsSource)(window, document);

  const padApi = {
    all() { return R.shortcutPads.all(); },
    byId(id) { return R.shortcutPads.byId(id); },
    atSlot(slot) { return R.shortcutPads.atSlot(slot); },
    firstEmptySlot() { return R.shortcutPads.firstEmptySlot(); },
    add(label, actionId, hotkey, pinnedSlot) {
      const config = { actionId, hotkey };
      if (arguments.length > 3) config.pinnedSlot = pinnedSlot;
      return R.shortcutPads.add(label, config);
    },
    update(id, changes) {
      if (!R.shortcutPads.update(id, changes)) return false;
      return R.shortcutPads.byId(id);
    },
    replaceAll(pads) { return R.shortcutPads.replaceAll(pads); },
    pinAt(id, slot) { return R.shortcutPads.pinAt(id, slot); },
    replaceAt(id, slot) { return R.shortcutPads.replaceAt(id, slot); },
    clearFromPad(id) { return R.shortcutPads.clearFromPad(id); },
    remove(id) { return R.shortcutPads.remove(id); },
    reset() { return R.shortcutPads.reset(); }
  };
  R.ui = {
    modal(modalOptions) {
      if (R.ui.current && R.ui.current.isOpen()) R.ui.current.close('programmatic');
      const title = R.dom.el('h2.rb-modal-title', { text: modalOptions.title || '' });
      const body = R.dom.el('div.rb-modal-body', null, modalOptions.body || []);
      const footer = R.dom.el('div.rb-modal-foot', null, modalOptions.footer || []);
      const box = R.dom.el('div.rb-modal', null, [title, body, footer]);
      let open = true;
      const handle = {
        box,
        options: modalOptions,
        close(reason) {
          if (!open) return;
          if (modalOptions.onCloseRequest &&
              modalOptions.onCloseRequest(reason) === false) return;
          open = false;
          if (R.ui.current === handle) R.ui.current = null;
        },
        isOpen() { return open; }
      };
      R.ui.current = handle;
      dialogs.push(handle);
      return handle;
    }
  };
  new Function('window', 'document', source)(window, document);
  const host = document.createElement('div');
  R.shortcutPadWidget.mount({
    body: host,
    shortcutPads: padApi,
    toast(message, options) { toasts.push({ message, options }); }
  });

  function flushFrames() {
    var count = 0;
    while ((frameQueue.length || timerQueue.length) && count < 20) {
      timerQueue.splice(0).forEach((callback) => callback());
      const callbacks = frameQueue.splice(0);
      callbacks.forEach((callback) => callback());
      count++;
    }
    if (frameQueue.length || timerQueue.length) {
      throw new Error('UI callback queue did not settle.');
    }
  }

  function findButton(label, root = host) {
    return allElements(root, (node) =>
      node.tagName === 'BUTTON' && node.textContent.trim() === label)[0] || null;
  }

  function enterEditPins() {
    const menu = allElements(host, (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Shortcut Pad menu')[0];
    click(menu);
    click(findButton('Edit Pins', R.ui.current.box));
  }

  return {
    R, host, dialogs, errors, toasts, padApi, executionCalls, storageWrites,
    setWriteFails(value) { writeFails = value === true; },
    readStored: () => stored,
    flushFrames,
    findButton,
    enterEditPins,
    getHeader() {
      return findElement(host, (node) => node.classList.contains('rb-shortcut-pad-header'));
    },
    getGrid() {
      return findElement(host, (node) => node.classList.contains('rb-shortcut-pad-grid'));
    },
    getEditModal() { return R.ui.current; }
  };
}

describe('Shortcut Pad widget editing', () => {
  it('renders only populated pins with one header Add and dispatches one pin without storage writes', async () => {
    const runtime = createRuntime();
    const beforeWrites = runtime.storageWrites.length;
    const cells = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') !== null);
    const pinnedCount = runtime.padApi.all().filter((pad) => pad.pinnedSlot != null).length;
    // Normal mode renders only valid populated pins: no blank or trailing Add cells.
    expect(cells).toHaveLength(pinnedCount);
    expect(cells.filter((cell) => cell.classList.contains('is-empty'))).toHaveLength(0);
    const headerAdd = runtime.findButton('+ Add', runtime.getHeader());
    expect(headerAdd).not.toBeNull();
    expect(headerAdd.hidden).toBe(false);
    expect(runtime.getGrid().getAttribute('aria-label')).toBe('Shortcut Pad');
    runtime.getGrid().clientWidth = 876;
    runtime.getGrid().parentNode.clientWidth = 876;
    runtime.flushFrames();
    expect(runtime.getGrid().style.gridTemplateColumns)
      .toBe('repeat(6, minmax(0, 1fr))');
    expect(runtime.getGrid().style.gridAutoRows).toBe('135px');
    expect(runtime.getGrid().style.height).toBe('159px');

    const undoCell = cells.find((cell) => cell.getAttribute('data-slot') === '0');
    const runStatus = findElement(undoCell, (node) =>
      node.classList.contains('rb-shortcut-pad-run-status'));
    click(undoCell);

    expect(runtime.executionCalls).toHaveLength(1);
    expect(runtime.executionCalls[0].pinId).toBe(runtime.padApi.atSlot(0).id);
    expect(undoCell.classList.contains('is-running')).toBe(true);
    expect(runStatus.textContent).toBe('Running');
    expect(runtime.storageWrites).toHaveLength(beforeWrites);

    await Promise.resolve();
    expect(runStatus.textContent).toBe('Done');
    expect(runtime.storageWrites).toHaveLength(beforeWrites);
  });

  it('opens Add Shortcut from the header control', () => {
    const runtime = createRuntime();
    click(runtime.findButton('+ Add', runtime.getHeader()));

    expect(runtime.getEditModal().box.querySelector('.rb-modal-title').textContent)
      .toBe('Add Shortcut');
  });

  it('shows one deliberate empty state with a single CTA when no pins are valid', () => {
    const runtime = createRuntime({ initialPads: [] });
    const cells = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') !== null);
    expect(cells).toHaveLength(0);
    const cta = allElements(runtime.getGrid(), (node) =>
      node.classList.contains('rb-shortcut-pad-empty-cta'));
    expect(cta).toHaveLength(1);
    expect(cta[0].textContent).toBe('Add your first shortcut');

    click(cta[0]);
    expect(runtime.getEditModal().box.querySelector('.rb-modal-title').textContent)
      .toBe('Add Shortcut');
  });

  it('packs sparse pins top-left with no blank or trailing add cells in normal mode', () => {
    const actions = [0, 1, 2].map((index) => ({
      id: 'ae.sparse-' + index,
      label: 'Sparse ' + index,
      commandName: 'Sparse ' + index,
      menuPath: 'Test \u203a Sparse ' + index,
      commandId: 4100 + index,
      commandIdSource: 'verified-host-probe',
      commandActionId: 'ae-sparse-' + index,
      deliveryRoute: 'host-command',
      aeMapShortcut: true,
      aeVersion: '26.5x89',
      commandRequest: {
        commandActionId: 'ae-sparse-' + index,
        commandId: 4100 + index,
        commandIdSource: 'verified-host-probe',
        preferredRoute: 'host-command'
      }
    }));
    const runtime = createRuntime({
      actions,
      initialPads: [0, 5, 20].map((slot, index) => ({
        id: 'pin-sparse-' + index,
        label: 'Sparse ' + index,
        actionId: actions[index].id,
        pinnedSlot: slot
      }))
    });
    const cells = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') !== null);
    expect(cells).toHaveLength(3);
    expect(cells.some((cell) => cell.classList.contains('is-empty'))).toBe(false);
    expect(cells.map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Sparse 0'),
        expect.stringContaining('Sparse 1'), expect.stringContaining('Sparse 2')]));
    expect(allElements(runtime.getGrid(), (node) =>
      node.classList.contains('rb-shortcut-pad-add-mark'))).toHaveLength(0);
  });

  it('renders a full pad as a compact 6 by 6 grid with no empty cards', () => {
    const actions = Array.from({ length: 36 }, (_value, slot) => {
      const actionId = 'ae.action-' + slot;
      const commandId = 3000 + slot;
      return {
        id: actionId,
        label: 'Action ' + (slot + 1),
        commandName: 'Action ' + (slot + 1),
        menuPath: 'Test › Action ' + (slot + 1),
        commandId,
        commandIdSource: 'verified-host-probe',
        commandActionId: 'ae-command-' + slot,
        deliveryRoute: 'host-command',
        aeMapShortcut: true,
        aeVersion: '26.5x89',
        commandRequest: {
          commandActionId: 'ae-command-' + slot,
          commandId,
          commandIdSource: 'verified-host-probe',
          preferredRoute: 'host-command'
        }
      };
    });
    const runtime = createRuntime({
      actions,
      initialPads: Array.from({ length: 36 }, (_value, slot) => ({
        id: 'pin-' + slot,
        label: 'Action ' + (slot + 1),
        actionId: actions[slot].id,
        pinnedSlot: slot
      }))
    });
    const grid = runtime.getGrid();
    const widget = grid.parentNode;
    grid.clientWidth = 876;
    widget.clientWidth = 876;
    runtime.flushFrames();

    const cells = allElements(grid, (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') !== null);
    expect(cells).toHaveLength(36);
    expect(cells.filter((cell) => cell.classList.contains('is-empty'))).toHaveLength(0);
    expect(grid.style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
    expect(grid.style.gridAutoRows).toBe('135px');
    expect(grid.style.height).toBe('874px');
    expect(runtime.findButton('+ Add', runtime.getHeader()).hidden).toBe(false);
  });

  it('opens repair for an unavailable action and never dispatches it', () => {
    const runtime = createRuntime({
      initialPads: [{
        id: 'pin-missing',
        label: 'Unknown Command',
        actionId: 'ae.no-longer-registered',
        pinnedSlot: 0
      }]
    });
    const repairNotice = runtime.findButton('1 shortcut needs repair', runtime.getHeader());
    expect(repairNotice).not.toBeNull();
    expect(allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')).toHaveLength(0);
    click(repairNotice);

    const cell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
    expect(cell.textContent).not.toContain('Action unavailable');
    expect(cell.textContent).toContain('Needs repair');
    click(cell);

    expect(runtime.executionCalls).toHaveLength(0);
    expect(runtime.getEditModal().box.querySelector('.rb-modal-title').textContent)
      .toBe('Edit pin');
  });

  it('shows the resolved AE command label and chord instead of stale pin text', () => {
    const runtime = createRuntime({
      initialPads: [{
        pinId: 'pin-koi',
        slot: 0,
        displayName: 'koi',
        enabled: true,
        action: {
          type: 'ae-command',
          actionId: 'ae.undo',
          commandActionId: 'ae-undo',
          commandId: 2371,
          commandIdSource: 'verified-host-probe',
          commandName: 'Undo',
          menuPath: 'Edit › Undo',
          registryVersion: '26.5x89'
        },
        shortcut: { modifiers: ['Ctrl'], key: 'D', display: 'Ctrl + D' }
      }]
    });
    const cell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];

    expect(cell.textContent).toContain('Undo');
    expect(cell.textContent).toContain('Ctrl + Z');
    expect(cell.textContent).not.toContain('koi');
    expect(cell.textContent).not.toContain('Ctrl + D');
  });

  it('hides duplicate actions in normal mode and filters them into repair mode', () => {
    const actionRecord = {
      type: 'ae-command',
      actionId: 'ae.undo',
      commandActionId: 'ae-undo',
      commandId: 2371,
      commandIdSource: 'verified-host-probe',
      commandName: 'Undo',
      menuPath: 'Edit › Undo',
      registryVersion: '26.5x89'
    };
    const runtime = createRuntime({
      initialPads: [
        { pinId: 'pin-undo', slot: 0, displayName: 'Undo', enabled: true, action: actionRecord },
        { pinId: 'pin-koi', slot: 9, displayName: 'koi', enabled: true, action: actionRecord }
      ]
    });
    const visibleCells = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') !== null);

    // Duplicate pins are hidden from normal mode: one valid card, no Add cell.
    expect(visibleCells).toHaveLength(1);
    expect(visibleCells.map((cell) => cell.textContent.trim())).toEqual(['UndoCtrl + Z']);
    const repairNotice = runtime.findButton('1 shortcut needs repair', runtime.getHeader());
    expect(repairNotice).not.toBeNull();
    click(repairNotice);

    const repairCell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '9')[0];
    expect(repairCell.textContent).toContain('Duplicate action');
    expect(repairCell.textContent).not.toContain('koi');
  });

  it('saves an edited pin, shows feedback, exits Edit Pins with Done, and persists after reload', () => {
    const runtime = createRuntime();
    runtime.enterEditPins();
    const done = runtime.findButton('Done', runtime.getHeader());
    expect(done).not.toBeNull();
    expect(done.hidden).toBe(false);

    const undoCell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
    expect(allElements(undoCell, (node) =>
      node.classList.contains('rb-shortcut-pad-label'))[0].textContent).toBe('Undo');
    expect(allElements(undoCell, (node) =>
      node.classList.contains('rb-shortcut-pad-chord'))[0].textContent).toBe('Ctrl + Z');
    click(undoCell);
    expect(runtime.getEditModal().box.querySelector('.rb-modal-title').textContent)
      .toBe('Edit pin');

    const nameInput = findElement(runtime.getEditModal().box, (node) =>
      node.classList.contains('rb-shortcut-pad-name'));
    nameInput.value = 'My Undo';
    click(runtime.findButton('Save', runtime.getEditModal().box));
    const saveButton = runtime.findButton('Saving…', runtime.getEditModal().box);
    expect(saveButton).not.toBeNull();
    expect(saveButton.disabled).toBe(true);
    runtime.flushFrames();

    expect(runtime.getEditModal()).toBeNull();
    expect(runtime.readStored().find((pad) => pad.slot === 0).displayName).toBe('My Undo');
    expect(allElements(runtime.getGrid(), (node) =>
      node.classList.contains('rb-shortcut-pad-label'))[0].textContent).toBe('Undo');
    expect(runtime.toasts.map((toast) => toast.message)).toContain('Pin saved.');
    expect(done.hidden).toBe(false);

    click(done);
    expect(done.hidden).toBe(true);
    expect(runtime.getGrid().parentNode.classList.contains('is-editing')).toBe(false);

    const reloaded = createRuntime({ initialPads: runtime.readStored() });
    expect(allElements(reloaded.getGrid(), (node) =>
      node.classList.contains('rb-shortcut-pad-label'))[0].textContent).toBe('Undo');
  });

  it('keeps the pin modal open with a visible error when the atomic write fails', () => {
    const runtime = createRuntime({
      initialPads: [{
        id: 'pin-undo',
        label: 'Undo',
        actionId: 'ae.undo',
        hotkey: null,
        pinnedSlot: 0
      }],
    });
    runtime.setWriteFails(true);
    runtime.enterEditPins();
    const cell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
    click(cell);
    const modal = runtime.getEditModal();
    const input = findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-name'));
    input.value = 'My Undo';
    click(runtime.findButton('Save', modal.box));
    runtime.flushFrames();

    expect(modal.isOpen()).toBe(true);
    expect(findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-save-error')).textContent)
      .toBe('Couldn’t save this pin: Could not save your shortcuts.');
    expect(runtime.readStored()[0].displayName).toBe('Undo');
    expect(runtime.toasts.map((toast) => toast.message)).not.toContain('Pin saved.');
    expect(runtime.errors.some((entry) => /Edit Pin could not be saved/.test(entry.message)))
      .toBe(true);
  });

  it('opens a focused action browser and updates the selected action in the pin editor', () => {
    const runtime = createRuntime();
    runtime.enterEditPins();
    const undoCell = allElements(runtime.getGrid(), (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
    click(undoCell);
    const modal = runtime.getEditModal();

    expect(findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-action-path')).textContent)
      .toBe('Edit › Undo');
    click(runtime.findButton('Change', modal.box));
    expect(modal.box.querySelector('.rb-modal-title').textContent).toBe('Choose Action');
    const search = findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-library-search'));
    expect(search.document.activeElement).toBe(search);
    search.value = 'Redo';
    search.dispatchEvent({ type: 'input' });
    click(allElements(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-action-choice'))[0]);

    expect(modal.box.querySelector('.rb-modal-title').textContent).toBe('Edit pin');
    expect(findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-selected-action')).textContent).toBe('Redo');
    expect(findElement(modal.box, (node) =>
      node.classList.contains('rb-shortcut-pad-action-default')).textContent)
      .toBe('Adobe After Effects default: Ctrl + Shift + Z');
    expect(runtime.findButton('Record shortcut', modal.box)).toBeNull();
    expect(runtime.findButton('Use AE default', modal.box)).toBeNull();
  });

  it('prompts for staged slot edits and supports Cancel, Discard, and Save and Done', () => {
    const runtime = createRuntime({
      initialPads: [
        { id: 'pin-undo', label: 'Undo', actionId: 'ae.undo', hotkey: null, pinnedSlot: 0 },
        { id: 'pin-redo', label: 'Redo', actionId: 'ae.redo', hotkey: null, pinnedSlot: 1 }
      ]
    });
    function moveUndoToEmptySlot() {
      const grid = runtime.getGrid();
      const source = allElements(grid, (node) =>
        node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
      const target = allElements(grid, (node) =>
        node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '2')[0];
      let draggedId = '';
      const dataTransfer = {
        setData(_type, value) { draggedId = value; },
        getData() { return draggedId; }
      };
      source.dispatchEvent({ type: 'dragstart', dataTransfer });
      target.dispatchEvent({
        type: 'drop',
        dataTransfer,
        preventDefault() {},
        stopPropagation() {}
      });
    }

    runtime.enterEditPins();
    const done = runtime.findButton('Done', runtime.getHeader());
    moveUndoToEmptySlot();
    click(done);
    expect(runtime.getEditModal().box.querySelector('.rb-modal-title').textContent)
      .toBe('Edit Pins');
    expect(findElement(runtime.getEditModal().box, (node) =>
      node.classList.contains('rb-shortcut-pad-confirm-copy')).textContent)
      .toBe('Save changes before leaving?');
    click(runtime.findButton('Cancel', runtime.getEditModal().box));
    expect(done.hidden).toBe(false);

    click(done);
    click(runtime.findButton('Discard', runtime.getEditModal().box));
    expect(done.hidden).toBe(true);
    expect(runtime.readStored().find((pad) => pad.pinId === 'pin-undo').slot).toBe(0);

    runtime.enterEditPins();
    moveUndoToEmptySlot();
    click(done);
    const confirmation = runtime.getEditModal();
    click(runtime.findButton('Save and Done', confirmation.box));
    expect(runtime.findButton('Saving…', confirmation.box).disabled).toBe(true);
    runtime.flushFrames();
    expect(done.hidden).toBe(true);
    expect(runtime.readStored().find((pad) => pad.pinId === 'pin-undo').slot).toBe(2);
  });

  it('keeps Edit Pins active if Save and Done cannot commit the staged layout', () => {
    const runtime = createRuntime({
      initialPads: [
        { id: 'pin-undo', label: 'Undo', actionId: 'ae.undo', hotkey: null, pinnedSlot: 0 },
        { id: 'pin-redo', label: 'Redo', actionId: 'ae.redo', hotkey: null, pinnedSlot: 1 }
      ]
    });
    runtime.setWriteFails(true);
    runtime.enterEditPins();
    const grid = runtime.getGrid();
    const sourceCell = allElements(grid, (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '0')[0];
    const targetCell = allElements(grid, (node) =>
      node.tagName === 'BUTTON' && node.getAttribute('data-slot') === '2')[0];
    let draggedId = '';
    const dataTransfer = {
      setData(_type, value) { draggedId = value; },
      getData() { return draggedId; }
    };
    sourceCell.dispatchEvent({ type: 'dragstart', dataTransfer });
    targetCell.dispatchEvent({
      type: 'drop',
      dataTransfer,
      preventDefault() {},
      stopPropagation() {}
    });
    const done = runtime.findButton('Done', runtime.getHeader());
    click(done);
    const confirmation = runtime.getEditModal();
    click(runtime.findButton('Save and Done', confirmation.box));
    runtime.flushFrames();

    expect(confirmation.isOpen()).toBe(true);
    expect(findElement(confirmation.box, (node) =>
      node.classList.contains('rb-shortcut-pad-save-error')).textContent)
      .toBe('Couldn’t save these changes: Could not save your shortcuts.');
    expect(done.hidden).toBe(false);
    expect(runtime.readStored().find((pad) => pad.pinId === 'pin-undo').slot).toBe(0);
  });
});
