# Electron Native Stack

## Status

This document tracks a proof of concept and possible migration from Tauri to
Electron. Tauri remains the production native host until the Electron stack has
passed the capability, security, packaging, and update gates below.

Current execution state:

| Area | State |
|---|---|
| Architecture and framework selection | Complete |
| Minimal Electron host | Complete |
| Secure application protocol and isolation | Complete for development host |
| Runtime Memory64 and shared-memory checks | Synthetic probes complete; real HyperDB pending |
| Rust native proxy integration | Planned |
| Native platform API migration | Planned |
| Universal macOS packaging | Planned |
| Signing and notarization | Planned |
| R2 incremental updates | Planned |
| Tauri replacement decision | Planned |

## Motivation

The current Tauri stack provides useful native behavior with a compact bundle:

- `dashql://` deep links and OAuth callback delivery.
- Native windows, dialogs, filesystem access, file watching, shell integration,
  process restart, logging, and drag and drop.
- A Rust custom-protocol backend for DuckDB, gRPC, HTTP, and Docker access.
- Signed incremental updates hosted on Cloudflare R2.
- Universal arm64/x86_64 macOS builds with signing and notarization.

The macOS system webview currently blocks two required web-platform features:

- WebAssembly Memory64 is not available in the required form.
- Cross-origin isolation is not reliable for the custom-scheme application,
  preventing `SharedArrayBuffer`, shared Wasm memory, and Wasm threads.

Electron ships Chromium. Electron 35 and newer contain Chromium versions where
Memory64 is enabled by default, and Electron custom protocols can return normal
responses with the COOP and COEP headers needed for cross-origin isolation.

The main tradeoff is distribution size and baseline memory use. A universal
Electron app is expected to add roughly 250-400 MiB installed and 90-170 MiB to
the compressed initial download. These estimates must be replaced by measured
release artifacts before making a migration decision.

## Proposed Stack

| Layer | Choice |
|---|---|
| Runtime | A currently supported Electron release, minimum Electron 35 |
| Main/preload/renderer build | `electron-vite` |
| Packaging | `electron-builder` |
| Updates | `electron-updater` with an R2-hosted generic feed |
| Renderer origin | Secure, standard `app://bundle/` custom protocol |
| Renderer privilege boundary | Sandboxed preload with narrow typed methods |
| Native backend | Existing Rust router in a supervised sidecar |
| Initial macOS artifact | Universal DMG plus signed update ZIP/blockmap |
| Build and verification | Bazel targets only |

Electron Forge remains the fallback if official Electron governance becomes
more important than the unified `electron-builder` update pipeline. Nextron is
not justified because DashQL does not require Next.js. Template projects such
as Electron React Boilerplate are references rather than architecture
dependencies.

## Target Architecture

The renderer must remain an unprivileged web application. It must not receive
Node.js, filesystem, process, shell, Docker, or arbitrary IPC access.

```text
app://bundle/index.html
        |
        | contextBridge methods and events
        v
Electron preload (sandboxed, narrow API)
        |
        | validated IPC
        v
Electron main process
        |
        | framed private IPC; supervised child process
        v
Rust native sidecar
        |
        +-- DuckDB
        +-- gRPC and TLS
        +-- streaming HTTP
        +-- Docker socket and registry
```

The production `BrowserWindow` settings are:

```js
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  preload
}
```

The application protocol must be registered before Electron is ready with at
least `standard`, `secure`, and `supportFetchAPI` privileges. Its handler must:

- Map requests only into the packaged renderer directory.
- Validate the URL host and reject traversal and malformed encoding.
- Return correct MIME types, including `application/wasm`.
- Set `Cross-Origin-Opener-Policy: same-origin`.
- Set `Cross-Origin-Embedder-Policy: require-corp`.
- Set a restrictive Content Security Policy.
- Set `X-Content-Type-Options: nosniff`.
- Never enable `bypassCSP` or disable `webSecurity`.

The renderer startup gate must test actual capabilities, not infer them from an
Electron version:

- `window.isSecureContext === true`.
- `window.crossOriginIsolated === true`.
- A small Memory64 Wasm probe validates.
- Shared Wasm memory can be passed to a worker.
- The real HyperDB Memory64 module initializes and runs a representative query.

## Native Backend Strategy

The existing Rust implementation should be preserved. Most proxy code is
independent of Tauri except for incidental `tauri::http` imports and host event
delivery.

The repository already contains `//packages/dashql-native:ipc_bridge`, which
accepts newline-delimited JSON requests on stdin and invokes the same native
router used by the Tauri custom protocol. It is suitable for initial functional
proofs, but JSON integer arrays are not an acceptable production transport for
large Arrow or protobuf bodies.

Migration steps:

1. Launch and supervise `ipc_bridge` from Electron main.
2. Prove DuckDB, unary gRPC, streaming gRPC, HTTP, and Docker operations.
3. Measure JSON bridge CPU, memory, latency, and allocation overhead.
4. Replace JSON lines with length-prefixed binary frames.
5. Add request cancellation, backpressure, process-exit propagation, bounded
   message sizes, startup timeout, and graceful shutdown.
6. Extract the router into a Tauri-independent Rust library and replace
   `tauri::http` re-exports with the direct `http` crate.
7. Build arm64 and x86_64 sidecars through Bazel and merge the release sidecar
   with `lipo` for the universal application.

The renderer's existing `dashql-native://localhost/...` request contract can be
kept during the proof of concept by adapting Electron protocol requests to the
sidecar. The long-term API should be a typed preload surface unless retaining
the HTTP-shaped contract proves materially simpler and equally secure.

## Native Platform APIs

Port Tauri integrations behind framework-neutral TypeScript interfaces rather
than scattering Electron checks through the application.

| Current responsibility | Electron implementation |
|---|---|
| Native runtime detection | Build-time platform adapter selection |
| Deep links | Protocol client, `open-url`, `second-instance` |
| Single instance | `app.requestSingleInstanceLock()` |
| Window and titlebar | `BrowserWindow` with titlebar overlay |
| File drag and drop | Renderer drop event plus validated preload path handling |
| Open/save dialogs | `dialog` in main through typed preload calls |
| Filesystem and watching | Main process or native sidecar with scoped grants |
| Open external URL | Main-process allowlist around `shell.openExternal` |
| Relaunch | `app.relaunch()` followed by `app.exit()` |
| Logging | Renderer event to structured main/native logger |
| OAuth loopback callback | Reuse Rust server with host-neutral event callback |
| Updates | Main-process `electron-updater` state machine |

Deep links are untrusted input. The host must validate scheme, host, path, query
keys, payload size, and payload encoding before forwarding an event. Cold-start
and already-running delivery must use the same parsing function. Integration
tests must cover both paths.

## Packaging And Size

`electron-builder` should initially emit separate arm64 and x86_64 artifacts as
well as a universal artifact. This provides measurements and leaves open the
option of architecture-specific public downloads.

Expected universal artifacts:

```text
DashQL-<version>-universal.dmg
DashQL-<version>-universal-mac.zip
DashQL-<version>-universal-mac.zip.blockmap
latest-mac.yml
```

The size gate records, for Tauri, Electron arm64, Electron x86_64, and Electron
universal builds:

- Installed `.app` bytes.
- Compressed DMG bytes.
- Compressed update archive bytes.
- N to N+1 transferred update bytes for a renderer-only change.
- N to N+1 transferred update bytes for a Rust-sidecar change.
- N to N+1 transferred update bytes for an Electron runtime change.
- Cold-start time, idle RSS, and representative workload RSS.

Do not optimize bundle size until these measurements identify the dominant
components. Likely safe optimizations include pruning unused locales, excluding
source maps and debug artifacts, avoiding duplicate architecture-independent
resources, and keeping optional large data assets outside the initial bundle.

## Signing And Notarization

The existing Apple certificate and notarization credentials remain useful, but
Electron's nested bundle must be signed from the inside out. The current
single-executable bundle assembly and broad `codesign --deep` operation are not
sufficient as the final Electron signing design.

The release pipeline must:

1. Assemble and merge the universal application.
2. Sign the Rust sidecar and all Electron helpers and frameworks.
3. Sign the outer application with hardened runtime and explicit entitlements.
4. Verify the designated requirements and every nested executable.
5. Build the DMG and update ZIP.
6. Notarize the distributed artifacts.
7. Staple the application/DMG where supported.
8. Test launch and update on clean arm64 and x86_64 systems, including Rosetta.

## R2 Updates

The first Electron updater implementation should use `electron-updater` with a
generic HTTPS provider backed by the existing R2 bucket. A native R2 publisher
can be adopted after the corresponding stable tool versions are qualified.

Suggested object layout:

```text
releases/<version>/macos/DashQL-<version>-universal.dmg
releases/<version>/macos/DashQL-<version>-universal-mac.zip
releases/<version>/macos/DashQL-<version>-universal-mac.zip.blockmap
channels/stable/latest-mac.yml
channels/canary/latest-mac.yml
```

Publishing rules:

- Versioned artifacts are immutable and uploaded first.
- Channel metadata is mutable, uses `no-cache`, and is uploaded last.
- Previous update archives and blockmaps remain available.
- R2/custom-domain responses support correct single byte ranges.
- CDN transformations and recompression are disabled for update artifacts.
- A release is promoted only after hash, signature, range, and N to N+1 tests.

Electron's default update authenticity model differs from Tauri. Tauri verifies
an application-specific Ed25519 signature; Electron normally uses manifest
SHA-512 plus Apple code signing or Windows Authenticode. Before production,
decide whether to add a signed Electron manifest verified in main with the
existing release key. Treat R2 manifest-write credentials as release-signing
credentials either way.

Use client-side stable cohorts for an initial staged rollout. Add a Cloudflare
Worker only if account-level rollout rings, private artifact authorization, a
central kill switch, or eligibility telemetry is required. Recover from a bad
release with a higher-version fix rather than relying on downgrade behavior.

## Execution Plan

### Phase 0: Baseline

- Record release Tauri app, DMG, and updater sizes.
- Record startup time and idle/workload RSS.
- Preserve current native tests as the behavioral baseline.
- Add no Electron dependency to production release targets.

Exit criteria: reproducible baseline measurements from signed or release-mode
artifacts.

### Phase 1: Chromium Capability Proof

- Add a parallel `packages/dashql-electron` package and Bazel targets.
- Start Electron against the existing native renderer bundle.
- Serve assets through `app://bundle/` with COOP, COEP, CSP, and MIME headers.
- Keep renderer sandboxing and context isolation enabled.
- Add a narrow preload API for runtime capability reporting.
- Verify secure context, cross-origin isolation, Memory64, shared memory, worker
  transfer, and the real HyperDB module.

Exit criteria: all runtime capability checks pass without Chromium experimental
flags or weakened Electron security settings.

### Phase 2: Native Proxy Proof

- Spawn `//packages/dashql-native:ipc_bridge` from Electron main.
- Route one existing DuckDB request through the bridge.
- Prove unary and streaming gRPC, HTTP streaming, and Docker operations.
- Add crash, cancellation, timeout, malformed-message, and shutdown tests.
- Measure bridge overhead with representative large Arrow responses.

Exit criteria: native behavior matches Tauri and measured overhead is acceptable
or a binary bridge implementation is scoped from evidence.

### Phase 3: Native Integration

- Implement deep-link cold start and second-instance delivery.
- Port dialogs, scoped filesystem access, watching, shell opening, relaunch,
  logging, drag and drop, and OAuth callbacks.
- Remove direct Tauri imports from application feature code in favor of shared
  platform interfaces.
- Validate navigation, external URL, IPC sender, and path allowlists.

Exit criteria: application workflows run in Electron without granting Node.js
to the renderer.

### Phase 4: Packaging

- Add arm64, x86_64, and universal Electron packaging targets.
- Package and sign the universal Rust sidecar.
- Configure exact file inclusion and ASAR boundaries.
- Sign nested components, notarize, and staple.
- Measure all size and resource gates.

Exit criteria: clean-machine installation and launch pass on Apple Silicon,
Intel, and Rosetta, with recorded size and performance results.

### Phase 5: Updates

- Generate update ZIPs, blockmaps, and channel metadata.
- Publish an isolated test channel to R2.
- Test full and differential N to N+1 updates.
- Test interrupted download, restart, bad hash, bad signature, stale metadata,
  paused rollout, and recovery release behavior.
- Decide and implement the additional signed-manifest policy.

Exit criteria: signed universal applications update reliably through R2 and a
failed update cannot replace the installed app.

### Phase 6: Decision And Migration

- Compare capability, size, memory, startup, maintenance, and release evidence.
- Decide between Electron, Tauri, or maintaining both hosts.
- If Electron wins, ship a Tauri bridge release that installs/migrates to the
  Electron product while preserving user data, protocol ownership, bundle
  identity, and uninstall behavior.
- Retire Tauri only after production rollout and rollback windows close.

Exit criteria: an explicit decision backed by measured artifacts and a tested
installed-product migration.

## Decision Gates

Electron is accepted only if:

- The real Memory64 workload passes.
- `crossOriginIsolated` and shared Wasm workers pass in packaged builds.
- No renderer receives Node integration or an unrestricted native API.
- Native proxy correctness and throughput remain acceptable.
- Deep links and OAuth work for cold and running applications.
- Universal signing, notarization, and clean-machine launch pass.
- R2 full and differential updates pass failure-injection tests.
- The measured size, startup, and memory costs are accepted explicitly.

Any failed gate keeps Tauri as the production host while the relevant proof is
reworked or the migration is abandoned.

## Immediate Work

The first checked-in slice is intentionally narrow:

1. Create the parallel Electron package without modifying Tauri release targets.
2. Add a Bazel-built Electron main/preload host.
3. Serve the existing `//packages/dashql-app:native` output through the secure
   custom protocol.
4. Expose and display runtime isolation capability results.
5. Add Bazel verification for protocol path validation and response headers.

Sidecar integration follows only after this capability proof is green.

## Execution Log

### 2026-08-28: Initial Capability Host

The first parallel Electron package now exists at
`packages/dashql-electron`. It does not alter the Tauri application or release
targets.

Implemented:

- Electron 38.8.6, embedding Chromium 140.0.7339.249 and Node 22.22.0.
- Bazel TypeScript compilation and Vitest targets.
- A Bazel development launcher using the existing
  `//packages/dashql-app:native` renderer bundle.
- A secure standard `app://bundle/` protocol with path confinement, MIME
  handling, COOP, COEP, CORP, CSP, and `nosniff` response headers.
- A sandboxed `BrowserWindow` with Node integration disabled and context
  isolation enabled.
- A narrow preload method for runtime-version and isolation reporting.
- A headless-by-lifecycle capability runner at
  `//packages/dashql-electron:capability_test`.
- Unit tests for application URL validation, isolation headers, and Wasm MIME
  handling.

Verified through Bazel:

```text
bazel build //packages/dashql-electron:compile
bazel build //packages/dashql-electron:dev //packages/dashql-electron:capability_test
bazel test //packages/dashql-electron:test
bazel run //packages/dashql-electron:capability_test
```

Observed capability result:

```json
{
  "crossOriginIsolated": true,
  "memory64": true,
  "secureContext": true,
  "sharedArrayBuffer": true,
  "sharedMemoryWorker": true,
  "chrome": "140.0.7339.249",
  "electron": "38.8.6",
  "node": "22.22.0"
}
```

The Memory64 result comes from validating a minimal Memory64 module. The shared
memory result creates a shared `WebAssembly.Memory` and transfers it to a real
worker. This closes the synthetic Chromium capability part of Phase 1. It does
not yet prove that the full HyperDB module initializes or that its representative
workload succeeds.

Next execution slice:

1. Add the real HyperDB Memory64 initialization and query capability test.
2. Adapt native-platform detection so the existing renderer can distinguish
   Electron from Tauri without invoking Tauri plugin implementations.
3. Spawn `//packages/dashql-native:ipc_bridge` and prove one DuckDB request.
