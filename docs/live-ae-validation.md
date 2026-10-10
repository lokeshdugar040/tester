# Live After Effects validation: Shortcut Pad

Status: **not yet run.** This document is the runbook and results template. The
sandbox that produced this branch has no After Effects, so no row below is
verified. Fill it in from a real run on the Windows machine.

Do not mark a command valid from fixture IDs or unit tests. A command is valid
only when the live probe below returns a positive integer for it in your AE
version.

## 0. What is in the build

- `aeShortcut.devProbe` (host, `host/commands/ae-shortcuts.jsx`). Runs only when
  the client sends `devMode: true`. It iterates the production allowlist, resolves
  each entry with `app.findMenuCommandId`, and dispatches through the same
  `executeRegisteredAction` path as production.
- `Rebound.shortcutDevProbe` (client, `shortcut-platform.js`). Refuses to run
  unless Rebound developer diagnostics are on.

No UI was added. The probe is called from the panel's devtools console.

## 1. Enable and run the probe

1. Enable Rebound developer diagnostics (the same switch that enables pin traces).
2. Open Rebound in After Effects. Open the panel's devtools console.
3. Resolve every allowlisted command:
   ```js
   Rebound.shortcutDevProbe.resolve().then(r => console.table(r.rows))
   ```
   Record `aeVersion` and `locale` from the same result object.
4. Dispatch one command at a time (dispatch runs the real command):
   ```js
   Rebound.shortcutDevProbe.dispatch('ae-undo').then(r => console.log(r))
   ```
   Each record contains `requestId` (must be non-empty), `commandId`,
   `commandIdSource`, `ok`, `error`, `elapsedMs`, and `aeVersion`.

Before each dispatch, set the AE state the command needs (see the preconditions
column in `host/commands/ae-shortcuts.jsx`). Example: Easy Ease needs selected
keyframes; Duplicate needs selected layers in the active composition.

## 2. Command-resolution table (to fill in)

Columns required by the acceptance brief. "Registry source" should read
`app.findMenuCommandId` for every row.

| Display name | Menu path | Real command ID | Registry source | Verified in live AE | Test status |
|---|---|---:|---|---|---|
| Undo | Edit › Undo | _run probe_ | _run probe_ | no | not run |
| Redo | Edit › Redo | _run probe_ | _run probe_ | no | not run |
| Duplicate | Edit › Duplicate | _run probe_ | _run probe_ | no | not run |
| Easy Ease | Animation › Keyframe Assistant › Easy Ease | _run probe_ | _run probe_ | no | not run |
| Add Marker (different category: Layer) | Layer › Add Marker | _run probe_ | _run probe_ | no | not run |

Note: the menu path column is taken from the client catalog. The host resolver
only returns the matched menu label, so check it against your AE menu.

Rule: do not record Redo, Duplicate, or Easy Ease as valid until the probe has
resolved their IDs from your live host.

## 3. Real interaction tests (to run manually)

Each pad click must produce exactly one intended AE action.

| # | Step | Expected | Observed | Pass? |
|---|---|---|---|---|
| 1 | Click each verified pad once | One AE action per click | | |
| 2 | Reload the panel, click each pad again | Same | | |
| 3 | Edit Pins → change a pin → Save → Done → reload → click | Pin still works, one action | | |

## 4. Native keyboard test (normal mode, no Rebound interference)

Press each key with focus on the Rebound panel, then on the AE timeline. The
expected result is the native AE behaviour, not a Rebound action.

| Key | Expected native behaviour | Observed | Pass? |
|---|---|---|---|
| Ctrl/Cmd + Z | Undo | | |
| Ctrl/Cmd + Shift + Z | Redo | | |
| Ctrl/Cmd + D | Duplicate | | |
| F9 | Easy Ease | | |
| P | Position property (native) | | |
| S | Scale property (native) | | |
| R | Rotation property (native) | | |
| T | Opacity property (native) | | |

If any key fails, stop. Record the focused element, whether a Rebound listener
was active (should be none in normal mode), and the code path. Do **not** work
around it with synthetic keyboard events.

Static evidence for this section: `test/shortcut-pad-reliability.test.mjs`
(keyboard audit) confirms no key listeners, no `preventDefault` or
`stopPropagation` in the platform, and no `.kys` or preference writes. It does
not replace the physical key test above.

## 5. Evidence to attach

- [ ] Resolution table (section 2), with the probe output pasted as text.
- [ ] Screen recording or screenshots of the five verified commands running.
- [ ] Console output from section 1 with non-empty `requestId` values.
- [ ] Native keyboard results (section 4).
- [ ] `git status` output (should show only intended source/test/doc changes).

## 6. Command categories that cannot go through `app.executeCommand` safely

These need a separate typed host-script implementation, not a menu ID:

- **Commands that need a dialog or a value from the user** (New Composition…,
  Pre-compose…, New Solid…). `executeCommand` opens the dialog and the bridge
  cannot supply the values. Needs a typed host script that builds the item.
- **Commands with a target that is not the current selection**, such as Mask
  or Effect operations on a specific mask or effect. The menu command acts on
  whatever is currently selected, so a pad cannot name the target. Needs a
  typed host script that selects the target first.
- **Property-level operations** such as Easy Ease's keyframe-type change in some
  AE versions. These depend on selection state and should be checked per version
  before they are trusted.
- **Commands with no stable menu label** (locale-dependent labels). Resolution
  by label fails in other AE languages. These need a per-locale label table or a
  typed host script.
- **Anything that writes files or preferences** (Save As, Preferences, keymap
  edits). Out of scope: the pad must never write `.kys` or AE preferences.

The current production allowlist is hard-coded in the host (13 entries). The
action browser can only offer those. Adding a command means adding a host entry
with a real label, then running the probe for it.

## 7. Known issues found while reviewing the host (not changed here)

- `aeShortcut.executeCustom` lets the bridge call any global ExtendScript
  function by name, with up to 32 arguments. It is outside the Shortcut Pad,
  but it is a broad surface. Recommend removing it or restricting it to an
  allowlist in a separate change.
- The host resolver matches menu labels exactly. A label change in a new AE
  version or language makes that command unresolved. The pad reports this as
  unavailable, not as success.
