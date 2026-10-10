# Rebound AEGP command hook

This is the source skeleton for Rebound's optional in-process Windows AEGP
command dispatcher. It is intentionally not represented as an installed or
verified plugin: the Adobe After Effects SDK and its PiPL/build resources were
not present in the development environment.

## Dispatch contract

1. The host validates a version-1 typed request against its active keymap
   registry and dynamically resolves both the target AE command and this
   plugin's `Rebound: Native Shortcut Dispatch` menu command.
2. ExtendScript atomically publishes `request.json` under
   `%APPDATA%\\Rebound\\NativeCommands` and invokes the plugin's menu command.
3. The AEGP command hook consumes that request on AE's command thread and calls
   `AEGP_DoCommand` with the dynamic target ID.
4. The plugin writes a correlated `result.json`. ExtendScript captures AE
   state after the command and only returns `verified: true` when the expected
   postcondition is observed.

The plugin does not accept inline JSX or start a worker thread. Input JSON is
bounded, the request ID is restricted to a safe ASCII alphabet, and the target
command ID must be a positive integer.

## Build prerequisite

Obtain the official After Effects SDK that matches the target AE major version,
then integrate `src/ReboundAEGP.cpp` and an AEGP PiPL resource into an official
AEGP sample project. Adobe's SDK build process runs the sample PiPL conversion
step; this source tree does not vendor Adobe headers or binaries. Build and
install the resulting `.aex` into the user's AE plug-ins folder, restart AE,
and confirm the menu item is discoverable before enabling the native route.

The current source has not been compiled against an SDK and has not been
installed or live-tested. The panel therefore falls back to its existing
persistent ExtendScript route when the plugin menu item is absent.
