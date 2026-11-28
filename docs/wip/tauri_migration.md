# Tauri migration

DashQL's native host moves from Electron to Tauri v2, first on macOS (replacing `packages/dashql-native`), then the
same host goes to iOS. This document is the plan, written for a coding agent on a Mac with Xcode. Read first:

- [../design/tauri_origin.md](../design/tauri_origin.md): how the app serves itself, as decided. It covers
  `https://127.0.0.1:47823`, a certificate made and pinned at every launch, and the trust hook. This plan doesn't
  repeat it.
- [../reports/tauri_results.md](../reports/tauri_results.md): what was measured on macOS 27.2.1 and the iOS 27.1
  simulator. [../reports/tauri_experiments.md](../reports/tauri_experiments.md) defines the experiments E1–E8. The
  probe harness of those runs is in `~/dashql-experiments/` on the Mac that ran them. Its `tauri-probe/` has working
  code for the server, the hook, the `host` command and the capability.
- [../design/electron.md](../design/electron.md): the host being replaced.
- [../design/agent_integration.md](../design/agent_integration.md): the agent integration that has to come along.
- [../agents/build_bazel_targets.md](../agents/build_bazel_targets.md): every build and test is a Bazel target.

Rules of the work:

- Land each phase in steps that keep Electron working, until phase 4 deletes it.
- Nothing is posted outside the repo: no GitHub issues or comments, no upstream PRs, no bug reports. Anything meant
  for outside goes into a report for the user.
- Don't lower the engine's 4 GiB memory maximum to make something pass. A refusal is a result.

## Why, in short

Tauri was the desktop host from 2024-02 to 2026-08 (`git show 8a86a0350^`). It was dropped because WKWebView had no
memory64 and the custom-scheme page wasn't cross-origin isolated. hyperdb-wasm is wasm32 now (0.0.27500, which `main`
pins), so memory64 is gone as a blocker. Isolation is solved by serving over loopback HTTPS (the design doc). The
cost back then was Tauri's ACL: one capability file edited about 15 times, and ACL generation under Bazel that
embedded an empty ACL and cached it remotely (`5ddad9274`, `e67c4b470`, `e70f12704`). The design below avoids that.

Decided by the user:

- Tauri replaces Electron on macOS, then the same host goes to iOS.
- Existing Electron users get the Tauri app through the auto-updater, with their data.
- iOS has no agent at first: it shows the notice that the web shows.

## Principles

1. **One bridge, by capability, not by host.** The page sees `globalThis.dashqlHost` (today `dashqlElectron`, typed
   in `packages/dashql-app/types/electron.d.ts`). A host leaves out the members it lacks (`agent`, `updates`,
   `oauthLoopback`, `openDirectory`), and the app treats an absent member as the web does.
2. **The page reaches exactly one Tauri command.** Every bridge method goes through `host(op, args)`. Pushed events
   (deep links, update status, agent events and calls, flush) come over one `tauri::ipc::Channel`. The page invokes
   no plugin or core command, and `withGlobalTauri` is false.
   - The one capability is added at run time (`app.add_capability`) with `remote.urls` = the origin and the
     permission `allow-host` only, from `tauri_build::AppManifest::new().commands(&["host"])`.
   - A `Channel` needs no permission (E7.3). It has to be a required argument, not an `Option`.
   - A new feature is a new `op` in Rust, never a new ACL entry.
3. **Plugins only from Rust, as few as possible.**
   - Deep links: `RunEvent::Opened`.
   - Dialogs: `rfd`, macOS only.
   - Opening URLs: `open` on macOS, `objc2` on iOS.
   - Updates: `tauri-plugin-updater`, called from Rust.

   No plugin permission is referenced. `build.rs` fails on any `tauri_build` error.
4. **Host logic in Rust.** Tauri has no Node, so the TS of the Electron main process (`packages/dashql-native/src/`)
   is ported, with its tests. The native proxy is Rust already (`packages/dashql-native/proxy/`, `proxy_router.rs`)
   and is called directly, without N-API and the utility process.
5. **The renderer is a resource, not embedded.** The app serves the bundle from its resources with its own server
   (the design doc). Tauri's `frontendDist` is a stub page (`about:blank` first, then the origin), so the 110 MB of
   the engine don't go through `generate_context!`.

## Phase 0: the shell in the repo

`packages/dashql-tauri/`:

- A crate with a `lib.rs` (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`), a `main.rs` for desktop, and a
  `tauri.conf.json`. The identifier is `app.dashql`, as in `electron-builder.yml`.
- The loopback server, as in the design doc:
  - it binds in `setup`, before any window, on `127.0.0.1:47823`;
  - a certificate in memory per launch (`rcgen`), served with `rustls`;
  - only `GET` and `HEAD` of bundle files, with paths checked like `resolveAppRequest` of `app_protocol.ts`;
  - the headers COOP, COEP, CORP, nosniff, the CSP of `app_protocol.ts`, and `Cache-Control: no-store`.
- The trust hook (`class_addMethod` on the delegate's class, set the delegate again, pin check). The app refuses to
  start when `respondedBefore` is true.
- **Port taken:** on macOS, a message that names port 47823, then exit. On iOS an app must not quit, so it shows a
  native error view instead of the webview.
- The `host` command with `startup.report`, and the one capability.
- The renderer: the bundle of `//packages/dashql-app:electron_bundle`, whose Vite mode becomes `native`, shared by
  both hosts while Electron lives.
- An explicit `--smoke-test` argument prints the startup result `__DASHQL_STARTUP__` to stdout:
  `embeddedDatabase === 'hyperdb-wasm'`, `crossOriginIsolated`, and the hook state. Then the app exits. Don't use an
  environment variable for this.
- `pnpm dev` keeps the Vite dev server (`http://localhost:9002`). Debug builds grant `host` to that origin too.

Tests (Bazel, `target_compatible_with` macOS):

- `:test`: the pin decision. The pinned leaf is accepted, another leaf is cancelled, and other hosts, ports and
  methods get default handling. Also the path checks of the server.
- `:startup_smoke_test`: the real app, with the same pattern as `//packages/dashql-native:startup_smoke_test`.
- `:trust_attack_test`: two runs.
  - A wrong pin at start: nothing loads.
  - A server swapped mid-session with another certificate gets 0 requests while the page starts imports, workers and
    an engine.

  The switches it needs (release the port on request, a pin given on the command line) exist only under a cargo
  feature for tests.
- All three run in the `macos_electron_arm64` job of `.github/workflows/build_trusted.yml`, on `macos-26`. That's an
  older macOS than the experiments ran on, so its first green run also sets the minimum macOS version.

Done when the smoke test and the attack test are green locally and in CI, and a manual run shows OPFS surviving a
relaunch.

## Phase 1: a host-neutral bridge (Electron keeps shipping)

- Renames:
  - `dashqlElectron` → `dashqlHost`
  - `DashQLElectronBridge` → `DashQLHostBridge`
  - the startup `host` field: `'electron' | 'tauri' | 'web'`
  - `AppHost` in `packages/dashql-react/src/dom/app_host.ts`: `NATIVE` instead of `ELECTRON`, and `getAppHost()`
    checks `dashqlHost`
  - `ELECTRON_FILE_SYSTEM` (`packages/dashql/src/platform/electron_fs.ts`) → `NATIVE_FILE_SYSTEM`, same ops
- The members iOS lacks become optional. The switch points stay where they are:
  - `host/runtime_provider.tsx`
  - `host/http/http_client_provider.tsx`
  - `host/events/event_listener_provider.tsx`
  - `host/version/version_check.tsx`
  - `agent/agent_provider.tsx`
  - `config/color_scheme.tsx`
  - `oauth/app_oauth_flow.ts`
- `packages/dashql-app/src/host/tauri_bridge.ts` builds a `DashQLHostBridge` over `invoke('host')` and the
  `Channel`, and installs it as `globalThis.dashqlHost` before the app boots. The Electron preload provides the same
  object.

Done when:

- the app tests pass;
- the typecheck passes (`:tsc` with `--output_groups=typecheck`; a plain build skips it);
- ESLint passes;
- the Electron `:startup_smoke_test` is still green.

## Phase 2: the macOS host, member by member

Each member is ported from `packages/dashql-native/src/`, with its tests, into `packages/dashql-tauri/src/`:

| Member | Electron | Tauri |
|---|---|---|
| `fs.*`, folder grants, `claimWorkbookFolder` | `main.ts` `dashql:fs`, `folder_grants.ts`, `atomic_write.ts` | `fs.rs`, the same `<appData>/DashQL/folder-grants.json` |
| `openDirectory`, `confirm` | the dialogs in `main.ts` | `rfd` |
| `openExternal` (https only) | `main.ts` | `open` |
| deep links | `deep_link.ts` `DeepLinkQueue` | `RunEvent::Opened`, the same queue, `CFBundleURLTypes` `dashql` |
| `nativeProxyRequest` | `native_proxy.ts`, a utility process, N-API | a direct call of `proxy_router` |
| `oauthLoopback` | `oauth_loopback.ts` | a server on `127.0.0.1` (plain HTTP like today, it only receives a redirect) |
| `onFlush` | `dashql:flush`, 5 s | `WindowEvent::CloseRequested` and `RunEvent::ExitRequested` are held until the page answers, at most 5 s |
| `setColorScheme` | `nativeTheme` | `Window::set_theme` |
| `updates` | `updater.ts`, `update_feed.ts` | `tauri-plugin-updater`, feed `get.dashql.app/channels/<ch>/macos/<arch>/latest.json` |
| `agent` | `agent/agent_host.ts`, `agent_server.ts`, `harness.ts`, `readers.ts` | a Rust port (below) |

The agent port is the largest piece:

- `tokio::process`, one harness per question, in its own process group, with the `PATH` of the login shell.
- The `127.0.0.1` `/v1/call` server, with its token, the 16 MiB cap, and the 409 and 413 answers.
- The readers of the three harness streams, with their tests.
- The `dashql` CLI and `packages/dashql-cli/src/commands.rs` stay as they are.
- `//tests/agents`, which today runs `AgentHost` compiled without Electron, moves to the Rust host.

**Measure IPC.** From the `https://` origin, Tauri's `ipc://` fetch fails and every invoke goes through postMessage
(E7.3). Measure `nativeProxyRequest` (gRPC and HTTP streams) and `fs` reads of large files. Only if postMessage is too
slow, carry those bytes over the loopback server, behind a token per launch that the page gets through `host`. Write
the numbers into the results report either way.

**Packaging:**

- `tauri build`, universal, signed and notarized with the same Developer ID (`docs/misc/build_signing.md`, the
  `CSC_*` and `APPLE_API_*` secrets).
- `.app.tar.gz` with a minisign signature for the updater.
- `//tools/pack` publishes it next to the Electron artifacts.

Done when every member works by hand: folder sync, Salesforce OAuth, Trino OAuth, deep links, updates from a test
channel, and an agent question with Claude Code. The ported Rust tests and `//tests/agents` against the Tauri host
must pass.

## Phase 3: the handoff from Electron, with the users' data

The workbooks, connections, results and manifest live in the OPFS of `app://bundle`, in Chromium's profile, which
WKWebView can't read. Native folders, `folder-grants.json` and `agent/workbooks/*` are plain files under
`<appData>/DashQL` and carry over as they are.

- **Electron N**, the handoff release, ships normally first. When an update to a Tauri version is downloaded, and
  before it installs:
  1. The page flushes.
  2. It copies the OPFS root without `instances/`, file by file, into `<appData>/DashQL/handoff/`. These are plain
     files, the tree of `storage_root.ts`, plus `key-value.json` of `KeyValueStorage`.
  3. It writes `handoff/complete.json` (`storageVersion`, app version) last.

  The page shows progress. For that update `autoInstallOnAppQuit` is false, so quitting before the copy finishes
  doesn't install, and the next start repeats it.
- **Feeds.** Versions before N update to N through `latest-mac.yml`, as today. N reads its own channel file,
  `handoff-mac.yml`, which points at the signed Tauri zip with `minimumSystemVersion` from phase 0. An older macOS
  stays on N.
- **The swap.** Squirrel.Mac should accept the Tauri bundle because the bundle id `app.dashql` and the team match.
  Verify that on a real install.
- **The Tauri app's first start.** If the OPFS has no manifest and `handoff/complete.json` exists, the page copies the
  tree into OPFS, and `migrateStorage` runs as usual. The folder is renamed to `handoff-imported/`, not deleted.
  Migration steps and old-format fallbacks stay.

Done when an Electron profile with workbooks, a native folder and an agent conversation comes out the same in the
Tauri app. Test it on signed builds, from N and from N-2 (two hops).

## Phase 4: delete Electron

After N's handoff has been out for a while:

- Remove `packages/dashql-native` (main, preload, N-API wrapper, utility worker, electron-builder) and the `electron`
  Vite mode.
- Rename `electron.d.ts` to `host.d.ts`.
- Rewrite `docs/design/electron.md` as `docs/design/tauri.md` (the bridge, the one command, the handoff), linking
  `tauri_origin.md`, and update the AGENTS.md index.
- Keep `handoff-mac.yml` and N published for late updaters.

## Phase 5: iOS

- **Same crate.** `#[cfg(mobile)]` drops `agent`, `oauthLoopback`, `updates`, `openDirectory` and `confirm` (the page
  uses its own dialog). It keeps `fs` on the app container, deep links, `nativeProxyRequest`, `onFlush` on
  `applicationWillResignActive`, and `setColorScheme`.
- **Agent:** the bridge has no `agent`, so the existing `AgentDesktopNotice` shows.
- **OAuth:** Salesforce works as today through `openExternal` and the `dashql://` deep link. Trino's loopback OAuth
  isn't available and shows a notice.
- **Reload means a new WKWebView, never `webView.reload()`.** The simulator fits only about 3 engines per web process
  (E6): a stopped engine's memory doesn't come back. Recreating the webview gives a new process. Write a note on the
  leak into the results report for the user to pass on to hyperdb-wasm.
- **The engine keeps its 4 GiB maximum.** The `pagehide`, wait-for-memory and stall handling of
  `packages/dashql/src/platform/hyperdb/hyperdb_web.ts` applies.
- **iOS 27 requires the UIScene lifecycle.** Tauri's tao launched fine with it in E7.
- **Build:**
  - check in the output of `tauri ios init` (`gen/apple`; it needs CocoaPods);
  - a script target `:ios_package`, like `scripts/package_macos.sh`, running `tauri ios build`;
  - upload to TestFlight with an App Store Connect key;
  - the smoke and attack tests run in the simulator on main and nightly. Tauri's iOS app writes nothing to
    `simctl launch --console`, so the app writes its result to a file in its container, and the test reads it via
    `simctl get_app_container`.
- **Needs a real iPhone** (none was available for the experiments). Check these by hand before the first TestFlight
  build and record them in the results report:
  - which ATS keys are needed (none in the simulator);
  - the listener while suspended;
  - two apps on one port;
  - memory on the smallest supported device;
  - whether iOS shows the local network prompt.
- Phone layouts are separate work.

## Per WebKit release

For each WebKit release (macOS and iOS, betas included):

- Rerun E2 and E7.1 of the experiments: the custom scheme with and without the shim, and a DIP variant of E2 once
  WebKit ships DIP.
- Add the results to the results report.
- When a custom-scheme page gets the `SharedArrayBuffer` global without the shim, switching back to `tauri://`
  becomes a plan of its own. The server and the hook go away, IPC is back on `ipc://`, and the OPFS moves to the new
  origin with the handoff code of phase 3.

A weekly CI run on the newest macOS image repeats the smoke and attack tests.

## Open risks

- A program holding port 47823 means the app can't start. It's a clear failure, never a takeover.
- A wry update that brings its own challenge method stops the app at start (`respondedBefore`) and needs a review.
- postMessage IPC may be too slow for proxy and file bytes (phase 2 measures it).
- Memory on real iOS devices may be worse than the simulator's 3 engines per process.
- The Rust port of the agent host is the largest piece of work.
