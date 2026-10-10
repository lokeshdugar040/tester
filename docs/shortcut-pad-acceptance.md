# Shortcut Pad: engineering assessment and acceptance record

Branch: `arena/ae1c2dd0-tester` (base `6d05c8b`).

## 1. Assessment (before this work)

| Area | Finding |
| --- | --- |
| Broken mappings | Pins could carry `pad:sample-*` action IDs and seeded demo data. The host then rejected requests with an empty `requestId`, which surfaced as "stale mapping" errors. |
| Cause of stale errors | Stale-keymap rejections were retried through pad-ID keyed refresh loops. Demo pins were auto-seeded on first run and then persisted as user config. |
| Cause of lag | Each unresolved pin triggered `refreshActiveKeymap` on click. The forensic execution log records `latencyMs: 384323` for one Undo attempt, and `requestId: ''`. |
| Effect on native AE keys | None found. The bridge only calls `app.executeCommand(commandId)`. No `.kys` or preference writes, no synthetic keys, no global key listeners in normal use. The recording capture is disabled. |
| Persistence | Reads auto-seeded over an empty store, and legacy migration could write unresolved records as valid. |
| Layout | Normal mode had trailing Add cells and blank slots. Card labels used `break-all`, and keys were forced to uppercase. |

## 2. What changed

- **Execution (`shortcut-platform.js`)**: one path, `executePin(pinId)`. Non-empty `requestId`. Validation at the bridge boundary: positive numeric `commandId`, verified source, matching `commandActionId`. One bridge call, no retry, no registry rebuild on click. A host stale rejection fires one background refresh and a visible failure. The pin is never re-dispatched. Development-only structured record per activation.
- **Persistence (`shortcut-pads.js`)**: no auto-seed. A missing store reads as `[]` with no write. Legacy migration writes only once the AE registry is loaded. Sample and placeholder action IDs are cleared to `unavailable`, never sent.
- **UI (`shortcut-pad-widget.js`, `home.css`)**: normal mode packs valid populated pins top-left, with one header `+ Add` and a single empty-state CTA "Add your first shortcut". Non-blocking "N shortcuts need repair" notice. Edit Pins is compact, with at most one trailing Add and an explicit "Show all 36 slots" toggle. Click-after-drag no longer calls `stopPropagation` or `preventDefault`. Scoped `.rb-shortcut-pad-*` rules only.
- **Concepts kept separate**: Rebound Pin (`id`, `pinnedSlot`, `label`, status), AE Action (`commandId`, `commandName`, `menuPath`, `resolvedAt`), and display-only chord text. Only `commandId` reaches the bridge.

## 3. Mapping table (reliability milestone)

| Pin | Action ID | commandActionId | commandId | Source |
| --- | --- | --- | --- | --- |
| Undo | `ae.map.CSwitchboard.Undo` | `ae-undo` | _not routed_ | **unavailable**: no reliable automation route (superseded; 2371 is not used) |
| Redo | `ae.app.redo` (test fixture) | `ae-redo` | 2372 | **fixture value**; live ID comes from the host probe |
| Duplicate | `ae.layer.duplicate` | `ae-duplicate` | live probe | verified by user test (Duplicate 5 → 6); re-run probe to confirm the ID |
| Easy Ease | `ae.keyframes.easy-ease` (test fixture) | `ae-easy-ease` | 2500 | **fixture value**; live ID comes from the host probe |

Action-to-command mapping (`ACTION_METADATA` in `ae-shortcut-map.js`) is verified against `commandActionId`. The numeric IDs in the table are not confirmed against a running After Effects instance.

## 4. Reload test record

Method: `test/shortcut-pad-reliability.test.mjs`. Pins are saved in one panel session. A new session is created over the same persisted storage, with the registry unloaded, to simulate a panel reload. The keymap is then loaded and each pin is activated once.

| Pin | Before keymap load | After keymap load | Bridge calls | Settings writes during click | Registry refresh |
| --- | --- | --- | --- | --- | --- |
| Undo | Loading, no dispatch | Done, 1 dispatch (2371) | 1 | 0 | 0 |
| Redo | (same) | Done, 1 dispatch (2372) | 1 | 0 | 0 |
| Duplicate | (same) | Done, 1 dispatch (2400) | 1 | 0 | 0 |
| Easy Ease | (same) | Done, 1 dispatch (2500) | 1 | 0 | 0 |

**Limitation:** this is a simulated reload in Node against a host fake. It has not been run against live After Effects, so AE-side execution is unverified.

## 5. Keyboard audit

| Check | Result |
| --- | --- |
| Key listeners installed during load and execution | None (`listenerTypes` tested) |
| `keydown`, `keyup`, `keypress`, `KeyboardEvent`, `dispatchEvent` in pad modules | None |
| `preventDefault` / `stopPropagation` in platform and widget | Only `preventDefault` inside drag handlers (edit mode) |
| `.kys` or AE preference writes | None. Host opens the keymap for read only |
| Keystroke or `SendInput` injection in host | None |
| Global hotkey capture | Disabled. `beginCaptureSession()` returns `''`, `start()` returns false, chord execution refused |
| Displayed shortcut strings executed | No. Chords are display text only |

## 6. Test output

```
Test Files  51 passed (51)
Tests       595 passed (595)
npx eslint (changed files): clean
```

Relevant suites: `shortcut-pad-reliability` 17/17, `shortcut-pad-widget` 13/13, `shortcut-platform` 15/15, `shortcut-pads` 17/17, `ae-shortcuts` 16/16.

## 7. Changed files

- `client/js/ui/shortcut-platform.js`
- `client/js/ui/shortcut-pads.js`
- `client/js/ui/shortcut-pad-widget.js`
- `client/css/home.css` (scoped `.rb-shortcut-pad-*` rules only)
- `.gitignore` (`invalidParam/`, from an earlier commit)
- `test/shortcut-platform.test.mjs`, `test/shortcut-pads.test.mjs`, `test/shortcut-pad-widget.test.mjs`, `test/shortcut-pad-reliability.test.mjs` (new), `test/ae-shortcuts.test.mjs` (one assertion: 92px→72px)

Untouched: color picker, gradients, palette, import, anchor, library, navigation, global theme, and other home tools.

## 8. Limitations and not verified

- **No screenshots.** The sandbox has no browser and can only reach npm and PyPI, so browser binaries cannot be downloaded. Layout (72px cards, 6-column grid, 12/10px type) is verified by static CSS and DOM-structure tests, not by pixel inspection.
- **No live AE run.** Execution is verified against a host fake only. The Undo/Redo/Duplicate/Easy Ease reload has not been exercised in After Effects.
- **Three of the four command IDs** (2372, 2400, 2500) are fixture values. Only Undo's 2371 is documented from a probe.
- **Postcondition unverified.** Success means "sent to After Effects" (`verified: false`). It does not confirm the visible project state changed.
- **Edit Pin modal** labels and save states are present in code and were already covered by earlier tests. No new interaction test was added in this pass.
- **Duplicate-activation window** of 120 ms drops a second click on the same pin. This is a deliberate guard, not a bug.
