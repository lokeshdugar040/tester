/*
 * Read-only parser for the shortcut preference text written by After Effects.
 */
;(function (R) {
  'use strict';

  function titleize(value) {
    return String(value || '')
      .replace(/_/g, ' ')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function humanLabel(context, command, known) {
    if (known) return known.label;
    var category = workflowCategoryForContext(context);
    if (!/\s/.test(command) &&
        (/^(?:[A-Z]{2,}|AEGP|POutline|TLOutline|RQOutline|FloPano|CameraToolUI|TextLayerUI|Tracker)/.test(command) ||
        /[a-z][A-Z]|_|[0-9]/.test(command))) {
      return category + ' shortcut';
    }
    return titleize(command);
  }

  var CONTEXT_CATEGORIES = {
    AE_TopLevelWindow: 'App & Menus',
    CCompCloneCmd: 'Composition',
    CCompCmd: 'Composition',
    CCompCompCmd: 'Composition',
    CCompMarkerCmd: 'Markers',
    CCompPaintCmd: 'Paint & Roto',
    CCompTime: 'Timeline',
    CDirItemTabPanelTime: 'Project & Footage',
    CDirTabPanel: 'Project & Footage',
    CEggApp: 'App & Menus',
    CEggAppTool: 'Tools & Tracking',
    CItem: 'Project & Footage',
    COutline: 'Layers & Masks',
    CPanoECOutline: 'Effects & Controls',
    CPanoProjFootage: 'Project & Footage',
    CPanoProjItem: 'Project & Footage',
    CPanoProjLayer: 'Layers & Masks',
    CPanoProjLayerPano: 'Layers & Masks',
    CPanoProjLayerPanoMask: 'Layers & Masks',
    CPanoRender: 'Render Queue',
    CSwitchboard: 'App & Menus',
    CSwitchboardModal: 'Dialogs',
    CTopic: 'App & Menus',
    CameraToolUI: 'Tools & Tracking',
    FloPano: 'Panels & Workspaces',
    POutlinePano: 'Project & Footage',
    RQOutlinePano: 'Render Queue',
    TLOutlinePano: 'Timeline',
    TextLayerUI: 'Text',
    Tracker: 'Tools & Tracking'
  };

  var WORKFLOW_CATEGORIES = [
    'Project & Files',
    'Composition Setup',
    'Layer Management',
    'Keyframes & Graph',
    'Properties & Timeline',
    'Masks & Mattes',
    'Effects & Expressions',
    'Text & Typography',
    '3D & Cameras',
    'Audio',
    'Render & Export',
    'Tools & Navigation',
    'Views & Panels',
    'Markers & Tracking',
    'Paint & Roto',
    'Motion Design',
    'Clipboard & Transfer',
    'General',
    'Needs Review'
  ];

  var ACTION_METADATA = {
    'CSwitchboard|Duplicate': {
      id: 'ae.layer.duplicate',
      label: 'Duplicate Selected Layer',
      workflowCategory: 'Layer Management',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition with one or more selected layers.',
      route: 'host-menu-command',
      commandActionId: 'ae-duplicate',
      verificationStatus: 'unverified',
      successCriteria: 'The selected layer count increases by the number of selected layers.'
    },
    'CSwitchboard|EasyEase': {
      id: 'ae.keyframes.easy-ease',
      label: 'Easy Ease Selected Keyframes',
      workflowCategory: 'Keyframes & Graph',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition with one or more selected keyframes.',
      route: 'host-menu-command',
      commandActionId: 'ae-easy-ease',
      verificationStatus: 'unverified',
      successCriteria: 'The selected keyframes change from Linear to Bezier interpolation.'
    },
    'CSwitchboard|SplitLayer': {
      id: 'ae.layer.split',
      label: 'Split Selected Layer',
      workflowCategory: 'Layer Management',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition, a selected layer, and the current time inside its duration.',
      route: 'host-menu-command',
      commandActionId: 'ae-split-layer',
      verificationStatus: 'unverified',
      successCriteria: 'The selected layer is replaced by two segments at the current time.'
    },
    'CSwitchboard|Save': {
      id: 'ae.project.save',
      label: 'Save Project',
      workflowCategory: 'Project & Files',
      actionKind: 'host-menu-command',
      requiredState: 'An open project with a saved file path.',
      route: 'host-menu-command',
      commandActionId: 'ae-save-project',
      verificationStatus: 'unverified',
      successCriteria: 'The project dirty flag clears and the saved project file is updated.'
    },
    'CSwitchboard|Undo': {
      id: 'ae.app.undo',
      label: 'Undo',
      menuPath: 'Edit \u203a Undo',
      workflowCategory: 'General',
      actionKind: 'history-command',
      requiredState: 'An open project with a reversible edit.',
      route: 'host-menu-command',
      commandActionId: 'ae-undo',
      verificationStatus: 'unverified',
      successCriteria: 'The visible project state must change to the prior state; task completion alone is insufficient.'
    },
    'CSwitchboard|Redo': {
      id: 'ae.app.redo',
      label: 'Redo',
      menuPath: 'Edit \u203a Redo',
      workflowCategory: 'General',
      actionKind: 'history-command',
      requiredState: 'An open project with a verified redo history state.',
      route: 'host-menu-command',
      commandActionId: 'ae-redo',
      verificationStatus: 'unverified',
      successCriteria: 'The visible project state must change to the redone state.'
    },
    'CSwitchboard|NewSolidInComp': {
      id: 'ae.composition.new-solid',
      label: 'New Solid',
      workflowCategory: 'Composition Setup',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition.',
      route: 'host-menu-command',
      commandActionId: 'ae-new-solid',
      verificationStatus: 'unverified',
      successCriteria: 'Solid Settings opens or a new solid appears in the active composition.'
    },
    'CSwitchboard|NewNull': {
      id: 'ae.layer.new-null',
      label: 'New Null',
      workflowCategory: 'Layer Management',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition.',
      route: 'host-menu-command',
      commandActionId: 'ae-new-null',
      verificationStatus: 'unverified',
      successCriteria: 'A new Null layer appears in the active composition.'
    },
    'CSwitchboard|NullObject': {
      id: 'ae.layer.new-null',
      label: 'New Null',
      workflowCategory: 'Layer Management',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition.',
      route: 'host-menu-command',
      commandActionId: 'ae-new-null',
      verificationStatus: 'unverified',
      successCriteria: 'A new Null layer appears in the active composition.'
    },
    'CSwitchboard|Precompose': {
      id: 'ae.layer.precompose',
      label: 'Pre-compose Selected Layers',
      workflowCategory: 'Layer Management',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition with two or more selected layers.',
      route: 'host-menu-command',
      commandActionId: 'ae-pre-compose',
      verificationStatus: 'unverified',
      successCriteria: 'The selected layers are replaced by a precomposition.'
    },
    'CCompCmd|AddMarker': {
      id: 'ae.timeline.add-marker',
      label: 'Add Marker',
      workflowCategory: 'Markers & Tracking',
      actionKind: 'host-menu-command',
      requiredState: 'An active composition with a selected layer.',
      route: 'host-menu-command',
      commandActionId: 'ae-add-marker',
      verificationStatus: 'unverified',
      successCriteria: 'A marker appears on the selected layer at the current time.'
    }
  };

  function categoryForContext(context) {
    if (CONTEXT_CATEGORIES[context]) return CONTEXT_CATEGORIES[context];
    if (/^CComp/.test(context)) return 'Composition';
    if (/PanoProjLayer|^COutline$|^TLOutline/.test(context)) return 'Layers & Masks';
    if (/PanoProj|^CDir|^CItem$|^POutline/.test(context)) return 'Project & Footage';
    if (/Render|^RQOutline/.test(context)) return 'Render Queue';
    if (/Tool|Tracker/.test(context)) return 'Tools & Tracking';
    return 'Other Shortcuts';
  }

  function workflowCategoryForContext(context) {
    if (/^TextLayer/.test(context)) return 'Text & Typography';
    if (/^Camera|3D/.test(context)) return '3D & Cameras';
    if (/^RQ|Render/.test(context)) return 'Render & Export';
    if (/^Tracker|Track/.test(context)) return 'Markers & Tracking';
    if (/^CCompMarker/.test(context)) return 'Markers & Tracking';
    if (/Paint|Roto/.test(context)) return 'Paint & Roto';
    if (/PanoECOutline|Effect/.test(context)) return 'Effects & Expressions';
    if (/PanoProjLayerPanoMask|Mask/.test(context)) return 'Masks & Mattes';
    if (/PanoProjLayer|^COutline|^TLOutline/.test(context)) return 'Layer Management';
    if (/^CCompTime/.test(context)) return 'Properties & Timeline';
    if (/^CComp/.test(context)) return 'Composition Setup';
    if (/^CDir|^CItem|^POutline|^PanoProj/.test(context)) return 'Project & Files';
    if (/Tool|Tracker/.test(context)) return 'Tools & Navigation';
    if (/FloPano|Panel|Workspace/.test(context)) return 'Views & Panels';
    if (/Audio|Sound/.test(context)) return 'Audio';
    if (/Switchboard|TopLevel|EggApp|Topic/.test(context)) return 'General';
    return 'Needs Review';
  }

  function contextLabelForContext(context) {
    if (/^CSwitchboardModal$/.test(context)) return 'After Effects dialog';
    if (/^CSwitchboard$|^AE_TopLevelWindow$/.test(context)) return 'After Effects';
    if (/Time/.test(context)) return 'Timeline';
    return categoryForContext(context);
  }

  function formatShortcutForDisplay(chord) {
    if (Array.isArray(chord)) {
      return chord.map(formatShortcutForDisplay).join(' \u2192 ');
    }
    var isMac = !!(window.navigator &&
      /mac/i.test(String(window.navigator.platform || '')));
    var labels = {
      arrowdown: 'Arrow Down',
      arrowleft: 'Arrow Left',
      arrowright: 'Arrow Right',
      arrowup: 'Arrow Up',
      backspace: 'Backspace',
      backquote: '`',
      backslash: '\\',
      capslock: 'Caps Lock',
      clear: 'Numpad 5',
      comma: ',',
      control: 'Ctrl',
      ctrl: 'Ctrl',
      delete: 'Delete',
      del: 'Delete',
      downarrow: 'Arrow Down',
      end: 'End',
      enter: 'Enter',
      esc: 'Escape',
      escape: 'Escape',
      fwddel: 'Delete',
      home: 'Home',
      insert: 'Insert',
      leftarrow: 'Arrow Left',
      numpadmultiply: 'Numpad *',
      numpadplus: 'Numpad +',
      numpadminus: 'Numpad -',
      numpadslash: 'Numpad /',
      numpaddecimal: 'Numpad .',
      numpadcomma: 'Numpad ,',
      numpadenter: 'Numpad Enter',
      maccontrol: 'Ctrl',
      meta: isMac ? 'Cmd' : 'Win',
      command: 'Cmd',
      option: 'Option',
      alt: isMac ? 'Option' : 'Alt',
      num0: 'Numpad 0',
      num1: 'Numpad 1',
      num2: 'Numpad 2',
      num3: 'Numpad 3',
      num4: 'Numpad 4',
      num5: 'Numpad 5',
      num6: 'Numpad 6',
      num7: 'Numpad 7',
      num8: 'Numpad 8',
      num9: 'Numpad 9',
      'num*': 'Numpad *',
      'num+': 'Numpad +',
      'num-': 'Numpad -',
      'num/': 'Numpad /',
      'num.': 'Numpad .',
      'num,': 'Numpad ,',
      pageDown: 'Page Down',
      pagedown: 'Page Down',
      pageup: 'Page Up',
      rightarrow: 'Arrow Right',
      shift: 'Shift',
      space: 'Space',
      spacebar: 'Space',
      singlequote: "'",
      tab: 'Tab',
      uparrow: 'Arrow Up',
      win: isMac ? 'Cmd' : 'Win',
      windows: isMac ? 'Cmd' : 'Win',
      padmultiply: 'Numpad *',
      padplus: 'Numpad +',
      padminus: 'Numpad -',
      padslash: 'Numpad /',
      paddecimal: 'Numpad .',
      padcomma: 'Numpad ,',
      padhome: 'Numpad 7',
      paduparrow: 'Numpad 8',
      padpageup: 'Numpad 9',
      padleftarrow: 'Numpad 4',
      padclear: 'Numpad 5',
      padrightarrow: 'Numpad 6',
      padend: 'Numpad 1',
      paddownarrow: 'Numpad 2',
      padpagedown: 'Numpad 3',
      padinsert: 'Numpad 0',
      paddelete: 'Numpad .'
    };
    var digits = /^pad([0-9])$/i;
    var parts = String(chord || '').split('+').map(function (part) {
      var token = part.replace(/^\s+|\s+$/g, '');
      var canonical = token.replace(/\s+/g, '').toLowerCase();
      var padDigit = digits.exec(token);
      if (padDigit) return 'Numpad ' + padDigit[1];
      if (/^numpad\s*[0-9]$/i.test(token)) {
        return 'Numpad ' + token.replace(/\D/g, '');
      }
      if (/^key[a-z]$/i.test(token)) return token.slice(3).toUpperCase();
      return labels[canonical] || token;
    });
    var modifierOrder = isMac
      ? { Ctrl: 0, Cmd: 1, Option: 2, Shift: 3, Alt: 4, Win: 5 }
      : { Ctrl: 0, Alt: 1, Shift: 2, Win: 3 };
    parts.sort(function (left, right) {
      var leftOrder = Object.prototype.hasOwnProperty.call(modifierOrder, left)
        ? modifierOrder[left] : 10;
      var rightOrder = Object.prototype.hasOwnProperty.call(modifierOrder, right)
        ? modifierOrder[right] : 10;
      return leftOrder - rightOrder;
    });
    return parts.join(' + ');
  }

  function displayChord(chord) {
    return formatShortcutForDisplay(chord);
  }

  function actionKindFor(chord, sequence, known, bindings) {
    if (sequence && sequence.length > 1) return 'ae-sequence';
    if ((bindings || []).some(isGestureBinding)) return 'unsupported';
    if (!chord) return 'unsupported';
    if (/^(?:Numpad|Pad)/i.test(chord.split('+').pop())) return 'ae-keypad';
    if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(chord.split('+').pop())) return 'ae-function';
    if (known && known.commandActionId) return 'ae-command';
    if (/mouse|drag|hold|gesture|double.?click/i.test(chord)) return 'unsupported';
    if (!/\+/.test(chord) && /^[A-Za-z0-9]$/.test(chord)) return 'ae-bare-key';
    return 'ae-chord';
  }

  function isGestureBinding(binding) {
    return /mouse|drag|hold|gesture|double.?click|alt.?click|ctrl.?click|middle.?click/i
      .test(String(binding || ''));
  }

  function requirementsForRecord(record) {
    var context = String(record.aeContext || '');
    var command = String(record.keymapCommand || '');
    var text = command + ' ' + String(record.requiredState || '');
    var needs = {
      composition: false,
      layer: false,
      mask: false,
      keyframes: false,
      timeline: false,
      viewer: false
    };
    if (/mask.*(shape|path|vertex)|(?:shape|path|vertex).*mask/i.test(text)) {
      needs.composition = true;
      needs.mask = true;
      needs.viewer = true;
    } else if (/keyframe|easy.?ease|graph/i.test(text)) {
      needs.composition = true;
      needs.keyframes = true;
    } else if (/selected layer|layer.*(duplicate|split|delete|trim)|(?:position|scale|rotation|opacity|anchor|transform)|show.*(?:properties|effects)/i.test(text)) {
      needs.composition = true;
      needs.layer = true;
    } else if (/CComp|^TLOutlinePano$|^RQOutlinePano$/.test(context)) {
      needs.composition = true;
    }
    if (/^CCompTime|^TLOutlinePano/.test(context)) {
      needs.composition = true;
      needs.timeline = true;
    }
    if (/^CCompCompCmd|^CEggAppTool|^CameraToolUI/.test(context)) {
      needs.composition = true;
      needs.viewer = true;
    }
    if (/^CPanoECOutline/.test(context)) {
      needs.composition = true;
      needs.layer = true;
    }
    return needs;
  }

  function requiredContextFor(record) {
    var needs = requirementsForRecord(record);
    if (needs.mask) return 'Mask selection';
    if (needs.keyframes) return 'Selected keyframes';
    if (needs.layer) return 'Selected layer';
    if (needs.timeline) return 'Timeline';
    if (needs.viewer) return 'Composition viewer';
    if (needs.composition) return 'Composition';
    return panelForContext(record.aeContext) || contextLabelForContext(record.aeContext);
  }

  function panelForContext(context) {
    if (/^CCompTime|^TLOutlinePano|^CCompMarkerCmd/.test(context)) return 'Timeline';
    if (/^CCompCompCmd|^CCompCmd|^CCompCloneCmd|^CCompPaintCmd|^CEggAppTool|^CameraToolUI/.test(context)) {
      return 'Composition Viewer';
    }
    if (/^CPanoECOutline/.test(context)) return 'Effect Controls';
    if (/^CPanoProjLayer/.test(context)) return 'Composition Viewer';
    if (/^CPanoRender|^RQOutlinePano/.test(context)) return 'Render Queue';
    if (/^CDir|^POutlinePano|^CPanoProj|^CItem$/.test(context)) return 'Project Panel';
    return '';
  }

  function canonicalRecord(entry) {
    var key = entry.context + '|' + entry.commandId;
    var known = ACTION_METADATA[key] || null;
    var alternatives = Array.isArray(entry.shortcuts) ? entry.shortcuts.slice() : [];
    var sequence = Array.isArray(entry.sequence) ? entry.sequence.slice() : [];
    var selectedIndex = -1;
    var activeChord = '';
    if (sequence.length > 1) {
      if (alternatives.length) selectedIndex = 0;
      sequence = sequence.map(function (key) {
        return R.globalHotkeys && R.globalHotkeys.cleanPadChord
          ? R.globalHotkeys.cleanPadChord(key) : key;
      });
      if (sequence.some(function (key) { return !key; })) sequence = [];
    }
    for (var i = 0; !sequence.length && i < alternatives.length; i++) {
      var parts = sequenceParts(alternatives[i]);
      if (parts.length > 1) {
        sequence = parts.map(function (key) {
          return R.globalHotkeys && R.globalHotkeys.cleanPadChord
            ? R.globalHotkeys.cleanPadChord(key) : key;
        });
        if (sequence.some(function (key) { return !key; })) sequence = [];
        else selectedIndex = i;
      }
      if (sequence.length) break;
      var normalized = R.globalHotkeys && R.globalHotkeys.cleanPadChord
        ? R.globalHotkeys.cleanPadChord(alternatives[i]) : alternatives[i];
      if (normalized) {
        selectedIndex = i;
        activeChord = normalized;
        break;
      }
    }
    if (!sequence.length && !activeChord && alternatives.length &&
        !(R.globalHotkeys && R.globalHotkeys.cleanPadChord)) {
      selectedIndex = 0;
      activeChord = alternatives[0];
    }
    var alternateChords = sequence.length > 1
      ? alternatives.slice(Number(entry.sequenceBindingCount) || 1)
      : alternatives.filter(function (chord, index) { return index !== selectedIndex; });
    var contextLabel = contextLabelForContext(entry.context);
    var hasBinding = !!activeChord || sequence.length > 1;
    var verificationStatus = !hasBinding ? 'unsupported'
      : known ? known.verificationStatus : 'unverified';
    var selectedBinding = selectedIndex >= 0 ? [alternatives[selectedIndex]] : alternatives;
    var actionKind = actionKindFor(activeChord, sequence, known, selectedBinding);
    var hostRoute = !!(known && known.commandActionId);
    var deliveryRoute = !hasBinding || actionKind === 'unsupported' || !hostRoute
      ? 'unsupported' : 'host-command';
    var userStatus = deliveryRoute === 'unsupported' ? 'Unsupported' : 'Ready';
    var canonical = {
      schemaVersion: 1,
      id: 'ae.map.' + encodeURIComponent(entry.context) + '.' +
        encodeURIComponent(entry.commandId),
      actionId: 'ae.map.' + encodeURIComponent(entry.context) + '.' +
        encodeURIComponent(entry.commandId),
      metadataId: known ? known.id : null,
      label: humanLabel(entry.context, entry.commandId, known),
      workflowCategory: known ? known.workflowCategory : workflowCategoryForContext(entry.context),
      menuPath: known && known.menuPath || '',
      aeContext: entry.context,
      contextLabel: contextLabel,
      requiredContext: '',
      keymapCommand: entry.commandId,
      commandIdentity: {
        context: entry.context,
        command: entry.commandId
      },
      activeKeymapCommandId: entry.commandId,
      commandId: null,
      commandIdSource: null,
      activeChord: activeChord,
      displayChord: sequence.length > 1
        ? sequence.map(displayChord).join(' \u2192 ') : displayChord(activeChord),
      alternateChords: alternateChords,
      bindingAlternatives: alternatives,
      sequence: sequence,
      actionKind: actionKind,
      requiredState: known ? known.requiredState : 'Required AE state has not been verified.',
      deliveryRoute: deliveryRoute,
      executionRoute: deliveryRoute,
      fallbackRoute: null,
      route: deliveryRoute,
      commandActionId: known ? known.commandActionId : null,
      verificationStatus: verificationStatus,
      userStatus: userStatus,
      reason: !hasBinding ? 'No AE shortcut assigned'
        : deliveryRoute === 'unsupported' ? 'This shortcut requires a gesture or has no safe delivery route.' : '',
      successCriteria: known ? known.successCriteria : 'Command meaning and a measurable postcondition have not been verified.',
      expectedResult: known ? known.successCriteria : 'Command meaning and a measurable postcondition have not been verified.',
      description: known ? known.successCriteria : 'This active-keymap entry has not been semantically verified.'
    };
    var record = {
      aeContext: entry.context,
      keymapCommand: entry.commandId,
      requiredState: known ? known.requiredState : '',
      actionKind: actionKind,
      activeChord: activeChord
    };
    canonical.requiredContext = requiredContextFor(record);
    canonical.requirements = requirementsForRecord(record);
    return canonical;
  }

  function chords(value) {
    var result = [], matcher = /\(([^()]*)\)/g, match;
    while ((match = matcher.exec(value))) {
      if (match[1]) result.push(match[1]);
    }
    return result;
  }

  function sequenceParts(value) {
    var parts = String(value || '').split(/\s*(?:,|->|=>|\u2192|\bthen\b)\s*/i)
      .map(function (part) { return part.replace(/^\s+|\s+$/g, ''); })
      .filter(function (part) { return !!part; });
    return parts.length > 1 ? parts : [];
  }

  function parse(contents) {
    if (typeof contents !== 'string' || !contents) {
      throw new Error('After Effects returned an empty shortcut map.');
    }
    var lines = contents.split(/\r\n|\r|\n/);
    var context = '';
    var entries = [];
    var version = '';
    var i, match;

    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      match = /^\s*\["([^"]+)"\]\s*$/.exec(line);
      if (match) {
        context = match[1];
        continue;
      }
      if (!context || /^\s*#/.test(line)) continue;
      match = /^\s*"([^"]+)"\s*=\s*"([^"]*)"\s*$/.exec(line);
      if (!match) continue;
      if (match[1] === 'major_version') {
        version = match[2];
        continue;
      }
      if (context === '** header **') continue;
      var bindings = chords(match[2]);
      var sequence = [];
      var sequenceBindingCount = 0;
      if (bindings.length) {
        sequence = sequenceParts(bindings[0]);
        if (sequence.length > 1) sequenceBindingCount = 1;
        else if (bindings.length > 1 && /^[A-Za-z0-9]$/.test(bindings[0]) &&
            bindings.every(function (binding) { return binding === bindings[0]; })) {
          sequence = bindings.slice();
          sequenceBindingCount = bindings.length;
        }
      }
      entries.push({
        context: context,
        contextLabel: contextLabelForContext(context),
        commandId: match[1],
        label: titleize(match[1]),
        shortcuts: bindings,
        sequence: sequence,
        sequenceBindingCount: sequenceBindingCount
      });
    }

    if (!entries.length) throw new Error('No shortcut entries were found in the After Effects map.');
    var assigned = 0;
    entries.forEach(function (entry) { if (entry.shortcuts.length) assigned++; });
    return {
      version: version,
      entries: entries,
      total: entries.length,
      assigned: assigned,
      unassigned: entries.length - assigned
    };
  }

  R.aeShortcutMap = {
    parse: parse,
    titleize: titleize,
    categoryForContext: categoryForContext,
    contextLabelForContext: contextLabelForContext,
    displayChord: displayChord,
    formatShortcutForDisplay: formatShortcutForDisplay,
    workflowCategoryForContext: workflowCategoryForContext,
    panelForContext: panelForContext,
    workflowCategories: WORKFLOW_CATEGORIES.slice(),
    canonicalRecord: canonicalRecord,
    actionMetadata: function () { return ACTION_METADATA; }
  };
})(window.Rebound = window.Rebound || {});
