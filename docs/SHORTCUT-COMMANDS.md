# Shortcut command architecture

## Native keyboard input

After Effects owns its keyboard map. Rebound does not edit the AE preferences or
`.kys` files, install a global keyboard hook, synthesize key events, or dispatch
commands by replaying a displayed chord. The active keymap reader is read-only.
The former Windows `global-hotkeys.ps1` hook was removed; legacy helper
processes are retired by the panel.

AE shortcut text is display-only. A pin click is resolved through the current AE
command registry and sent through the CEP/ExtendScript bridge as a typed request
with a numeric command ID. The host validates its identity, command name, menu
path, version, and ID before calling:

```jsx
app.executeCommand(commandId);
```

## Saved pin record

```json
{
  "pinId": "pin-undo",
  "slot": 0,
  "displayName": "Undo",
  "enabled": true,
  "action": {
    "type": "ae-command",
    "actionId": "ae.map.CSwitchboard.Undo",
    "commandActionId": "ae-undo",
    "commandId": 2371,
    "commandIdSource": "verified-host-probe",
    "commandName": "Undo",
    "menuPath": "Edit › Undo",
    "registryVersion": "26.5x89"
  },
  "aeShortcutDisplay": "Ctrl + Z"
}
```

`actionId`, command identity, and registry metadata select the action. The
display name and `aeShortcutDisplay` never do. The shortcut display is derived
from the current active keymap entry for that same action; saved physical
hotkeys and stale chord text are discarded during normalization.

On panel load and active-keymap refresh, every saved pin is resolved against
the current AE registry. If AE's version changed, Rebound accepts the newly
probed numeric ID only when the stable action identity, command name, and menu
path still match; it then migrates the ID/version. A missing ID, a same-version
ID mismatch, or a name/path mismatch leaves the pin unavailable. Rebound does
not infer an action from a label, a pin ID, or a chord.

## Execution and failure

`R.actionRouter.executePin(pinId)` is the only pad-click execution path. It
rejects unknown, sample, unavailable, or non-AE actions before dispatch. A pin
activation sends one `aeShortcut.executeRequest` containing a non-empty request
ID and the verified numeric command ID. The host checks the request against its
current active-keymap registry and invokes `app.executeCommand(commandId)`.
Chord and sequence delivery routes are unsupported.

After Effects remains the source of truth for command results. A command with
no measurable postcondition is reported as dispatched but unverified, not as a
confirmed success. Failures stay visible in the card/toast and include the
request ID and command ID in local diagnostics.

## Unavailable pins

Normal mode omits unavailable pins and shows one compact `N shortcuts need
repair` notice. Selecting it opens Edit Pins filtered to broken records, where
the command name and repair state remain visible. The normal grid uses
left-to-right row flow; it contains only valid pins and at most one Add control.
The pad retains 36 logical slots for Edit Pins and persists slot changes with a
single atomic write.

## Validation boundary

`aeShortcut.readKeymap` reads the active AE shortcut preferences and selected
`aeks` file. It does not write them. `aeShortcut.resolveActiveKeymap` resolves
registered menu commands for the current AE version. Shortcut text may be
shown as a reference, but it is never sent back to AE as input and never
changes AE's shortcut configuration.

The panel has no global `keydown`, `keyup`, or `keypress` handler. Rebound-only
keyboard recording is currently disabled; no events are captured or blocked
after a dialog opens or closes.
