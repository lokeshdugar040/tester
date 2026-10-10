# Developing Rebound

## Prerequisites

- Node.js 20+ and npm
- After Effects 2019+ (for host testing)
- Adobe ZXPSignCmd (only for packaging), see [INSTALL.md](INSTALL.md)

## Setup

```bash
npm install
npm run check        # lint + unit tests; do this before every commit
```

## The two halves

Rebound has a **panel** (browser-side, `client/`) and a **host**
(ExtendScript, `host/`). They communicate through `Rebound.bridge`.

### Iterating on the panel

You can develop most of the UI in a normal browser, with no After Effects:

```bash
node tools/serve.mjs            # serves client/ at http://localhost:8099
```

Outside the host, `Rebound.bridge.available` is `false`, host calls reject
gracefully, and selection polling is disabled, so the shell, curve editor,
controls, and presets all render and are fully interactive. Use this for fast
visual iteration.

Inside After Effects, use the CEP remote debugger at
`http://localhost:<Port>`, where `<Port>` is the `AEFT` host port in the root
`.debug` file (currently `8088`). The page lists inspectable targets; select
**Rebound** for the live CEP panel, including host round-trips. Its target URL
ending in `client/index.html` is expected: that file is the panel's manifest
`MainPath`, not the static `8099` preview. If DevTools reports a disconnected
WebSocket after a panel reload, reopen the `.debug` port and select **Rebound**
again to attach to the current target. Host JSX runs outside the Chromium DOM;
use the host debugger or the panel's host-reload control for that code.

### Iterating on the host

The host is reloaded by the panel on demand, click the **⟳** button in the
header (visible only inside AE) after editing any `host/*.jsx` file. No AE
restart needed. The bridge bootstraps `host/index.jsx`, which re-evaluates every
module idempotently.

If you prefer, run a `.jsx` directly from the ExtendScript Toolkit / VS Code
ExtendScript Debugger for line-level debugging.

### After Effects shortcut safety

The active, version-matched AE keymap is read-only. `aeShortcut.readKeymap`
reads the selected preference value and its `aeks` file; Rebound never writes
or reassigns AE shortcuts. A pad stores a stable active-map action identity,
verified numeric command ID, command name, menu path, AE version, and an
informational shortcut display.

Pad activation calls `R.actionRouter.executePin(pinId)`. The router validates
the saved identity against the current active AE registry and sends one typed
host request. ExtendScript validates the request and runs
`app.executeCommand(commandId)`. The displayed chord is never used to execute
an action. No Windows keyboard hook, SendInput route, or global DOM key listener
is used. Legacy global bindings are inert; a stale Rebound helper process is
retired when the panel loads.

Pins without a matching numeric command ID, command name, and menu path are
hidden in normal mode. On an AE-version change, a numeric ID is refreshed only
after the stable action identity, name, and menu path still match. A compact
repair notice opens Edit Pins filtered to unavailable records. Duplicate
command pins are filtered from normal mode as well. Existing/native AE
shortcuts remain under AE's control.

Gradient actions require at least one selected layer in an active composition.
On shape layers, applying a gradient replaces existing solid and Rebound
gradient-fill operators in each shape group so an older solid fill cannot cover
the newly applied gradient. The Easy Ease shortcut actions require at least one
selected keyframe. The panel reports these missing-selection cases instead of
presenting a no-op as a successful apply.

The Settings shortcut-map viewer is read-only. Its host command reads AE's
version-matched preferences to find the currently selected file under
`%APPDATA%\Adobe\After Effects\<version>\aeks`, then returns that file for
filtering in the panel. It does not write or replace the user's keymap. Adobe
stores command identities and chord strings in this file; the UI uses readable
labels and workflow categories instead of exposing AE's internal identifiers or
context strings. User-facing states include Ready, the specific missing
composition/selection/panel requirement, Running, Done, Failed, and Unsupported.
If the active map cannot be read, the UI reports that mapping is unavailable.
The **Shortcut Pad** Home widget has 36 logical slots. Normal mode shows only
validated AE commands, in deterministic left-to-right row flow, followed by one
Add control when a slot is free. The layout uses six columns at normal widths
and fewer columns only when needed to preserve a 92px minimum card size. Edit
Pins retains the 36-slot arrangement; Save and Done persist staged moves.

The catalog retains every entry from the active, version-matched AE map,
including unassigned records and alternate bindings. It selects one usable
binding deterministically and never joins unrelated chords in the UI.
Unsupported platform gestures or contexts without a safe route are disabled.
The optional `?shortcutDiagnostics=1` development view shows recent local-only
attempts, including internal context, route, HWNDs, delivery, and observed
result. Only explicit ordered sequences are sent as sequences; parenthesized
AE map bindings are alternatives unless the map explicitly encodes a sequence.

## Tests

The pure math (easing curves, springs, sampler, units) is unit-tested with
Vitest:

```bash
npm test             # run once
npm run test:watch   # watch mode
npm run test:cov     # coverage (client/js/easing)
```

Tests import the runtime modules directly (they're UMD), so the *exact* code
that ships in the panel is what's tested. New pure logic should live in
`client/js/easing/` (or a sibling pure module) and get tests in `test/`.

The ExtendScript host can't run under Node, so host logic is kept thin, it
receives already-resolved values from the tested JS core and writes them to AE.
The host JSON helper's algorithm is validated separately (see
`tools/_json-check.mjs`).

## Linting

```bash
npm run lint
npm run lint:fix
```

ESLint is scoped by path: browser globals for `client/js/**`, ES3 + AE globals
for `host/**`, and Node/ESM for `tools/**` and `test/**`.

## Project conventions

- Buildless. Add panel scripts as `<script>` tags in `client/index.html` in
  dependency order.
- `client/` is ES5-compatible; `host/` is ES3.
- One undo group per mutating action; report what changed via a toast.
- Address AE properties by matchName only.
- Keep all host access behind `Rebound.bridge`.

See [AGENTS.md](../AGENTS.md) for the module patterns and how to add a tool, and
[ARCHITECTURE.md](ARCHITECTURE.md) for the deeper design.

## Useful scripts

| Command | Does |
| --- | --- |
| `npm run debug:on` / `debug:off` | Toggle CEP PlayerDebugMode |
| `npm run install:dev` / `uninstall:dev` | Link/remove the dev build |
| `npm run cert` | Create a self-signed signing certificate |
| `npm run pack` | Build a signed `.zxp` |
| `node tools/gen-icons.mjs` | Regenerate panel icons |
| `node tools/serve.mjs` | Static-serve `client/` for browser preview |
