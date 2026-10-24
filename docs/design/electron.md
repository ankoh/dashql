# Electron Host

The desktop build of DashQL is an Electron app in `packages/dashql-native`. It replaced the former Tauri
host, whose macOS system webview could not run HyperDB WASM: WKWebView lacked WebAssembly Memory64 and
reliable cross-origin isolation for a custom scheme, so `SharedArrayBuffer`, shared Wasm memory and Wasm
threads were unavailable. Electron ships Chromium, which supports Memory64, and its custom protocols can
return the COOP and COEP headers that cross-origin isolation needs. The tradeoff is distribution size and
baseline memory use.

The renderer is the same web application as https://dashql.app. It stays unprivileged and reaches native
capabilities only through a narrow preload bridge.

## Architecture

```text
app://bundle/index.html  (renderer: the web app, HyperDB WASM in Chromium)
        │ window.dashqlElectron (contextBridge methods and events)
        ▼
preload.cjs  (sandboxed)
        │ IPC, every handler checks the sender frame
        ▼
main.ts  (Electron main process)
        │ utility-process messages
        ▼
native_utility_worker.ts  (Electron utility process)
        │ Node-API with binary buffers
        ▼
dashql_native_napi.node  (Rust addon, packages/dashql-native-proxy)
        ├── streaming HTTP
        └── gRPC and TLS
```

The `BrowserWindow` uses `contextIsolation`, `sandbox` and `webSecurity`, without `nodeIntegration`
(`src/main.ts`). New windows are denied and navigation away from the app is blocked. The window uses
`titleBarStyle: "hiddenInset"`; the app styles its navbar for `PlatformType.DESKTOP`.

## Application Protocol

The `app` scheme is registered before the app is ready with the `standard`, `secure` and `supportFetchAPI`
privileges, and serves the packaged renderer at the origin `app://bundle` (`src/app_protocol.ts`). The
handler:

- maps requests only into the renderer directory and rejects other hosts, credentials, ports, traversal, NUL
  bytes and backslashes,
- returns correct MIME types, including `application/wasm`,
- sets `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`,
  `Cross-Origin-Resource-Policy`, a restrictive Content Security Policy and `X-Content-Type-Options: nosniff`.

`isTrustedRendererUrl` accepts the packaged origin and, in development, the Vite dev server origin. Every IPC
handler checks the sender frame against it.

## Embedded Database

The embedded database is HyperDB WASM, as on the web. HyperDB requires Memory64, Wasm exceptions, Wasm
pthreads (`SharedArrayBuffer` and a cross-origin-isolated page), a preallocated pthread worker pool, and
WasmFS with OPFS. Capabilities are tested, not inferred from the Electron version:

- `//packages/dashql-native:capability_test` (manual) validates a Memory64 module, passes shared memory to a
  worker and runs a real HyperDB query through `hyperdb-capability.html`.
- `//packages/dashql-native:startup_smoke_test` launches the app and waits for the startup result the app
  publishes as `__DASHQL_STARTUP__` (`packages/dashql-app/src/app/loading/app_setup.ts`). It runs in CI.

## Native Proxy

Remote connections that browsers cannot reach directly (gRPC, streaming HTTP without CORS) go through the
Rust addon. The renderer keeps an HTTP-shaped contract: `nativeProxyFetch`
(`packages/dashql-app/src/platform/electron_native_fetch.ts`) turns a `Request` for
`dashql-native://localhost/...` into a proxy request. `native_http_client.ts` and `native_grpc_client.ts`
build on it; there are no operation-specific typed APIs.

- The main process starts the utility process and multiplexes requests through `NativeProxyService`
  (`src/native_proxy.ts`): a ready handshake, increasing request IDs, a 30 s per-request timeout, and
  rejection of pending calls when the process exits. Requests are bounded to 64 MiB bodies, 128 headers and
  8192-character header values; methods are DELETE, GET, PATCH and POST; routes are `health`, `grpc/` and
  `http/`. The renderer cannot call `health`.
- The addon (`packages/dashql-native-proxy/src/napi.rs`) exports `health()` and an async `route()`. The router
  (`src/proxy_router.rs`) serves `/http/streams`, `/http/stream/{id}`, `/grpc/channels` and
  `/grpc/channel/{id}/{unary,streams,stream/{id}}`. Streams are polled in batches.
- `//packages/dashql-native:native_addon_utility_test` runs HTTP streaming and unary and streaming gRPC
  against loopback servers (`src/grpc_test_server.ts`).

## Platform APIs

The app detects the host at runtime: `'dashqlElectron' in globalThis` selects `AppHost.ELECTRON`
(`packages/dashql-app/src/platform/native_globals.ts`), and providers pick the HTTP, gRPC and event-listener
adapters accordingly. The bridge type is declared in `packages/dashql-app/types/electron.d.ts`.

| Capability | Implementation |
|---|---|
| Single instance | `app.requestSingleInstanceLock()` |
| Deep links | `dashql://` registered as protocol client and in `CFBundleURLTypes`; `open-url`, `second-instance` and cold-start argv go through `src/deep_link.ts`. It accepts `dashql://localhost`, `https://dashql.app` and `http://localhost:9002` links with exactly one `data` or `session` parameter (legacy `notebook`), up to 64 KiB. `DeepLinkQueue` buffers links until the renderer asks for them. |
| Dialogs | `dashql:open-directory` and a two-button `dashql:confirm` |
| Filesystem | `dashql:fs` (exists, mkdir, readDir, readFile, readTextFile, remove, rename, stat, writeFile, writeTextFile) for absolute paths without NUL; app wrapper `platform/electron_fs.ts` |
| File watching | Recursive `fs.watch` in main, cleaned up per renderer by `src/directory_watch_registry.ts`; see `native_file_sync.md` |
| Open external | `shell.openExternal` for `https:` URLs only |
| OAuth loopback | Node HTTP server in main (`src/oauth_loopback.ts`), used by Trino; Salesforce uses the deep-link relay (`oauth_salesforce.md`) |
| Drag and drop | Renderer DOM drop events, as on the web |
| Updates | `electron-updater` in main (`src/updater.ts`) |

## Build and Packaging

- Main and the utility worker compile with `ts_project` (`//packages/dashql-native:compile`); the preload is
  hand-written CommonJS (`src/preload.cjs`).
- The renderer is the Vite `electron` mode build of the app (`//packages/dashql-app:electron`,
  `:electron_bundle`), with a relative base and without wasm precompression.
- `electron-builder` packages one app per architecture: `//packages/dashql-native:mac_package_arm64` and
  `:mac_package_x86_64` (`scripts/package_macos.sh`, `electron-builder.yml`). Each produces
  `DashQL-<version>-<arch>.{dmg,zip}`, blockmaps and `latest-mac.yml`. The renderer and the addon ship as
  extra resources, the app uses the hardened runtime, and `Entitlements.plist` allows JIT, unsigned executable
  memory, disabled library validation, network client access and user-selected file access.
- The addon is built per architecture (`//packages/dashql-native-proxy:addon_aarch64`, `:addon_x86_64`).
- Only macOS is packaged.

## Signing and Notarization

`package_macos.sh` signs and notarizes through electron-builder when `CSC_LINK` or `CSC_NAME` is set, and
disables identity discovery otherwise. CI (`.github/workflows/build_trusted.yml`) packages both architectures
on macOS runners, signed on pushes to main and on tags. Setup is in `docs/misc/build_signing.md`.

## Updates

`//packages/dashql-pack:pack` publishes releases to the R2 bucket behind `https://get.dashql.app`
(`.github/workflows/publish.yml`):

- immutable artifacts at `releases/<version>/macos/<arch>/<artifact>` with
  `Cache-Control: public, max-age=31536000, immutable`, uploaded first,
- mutable manifests at `channels/<channel>/macos/<arch>/latest-mac.yml` with `no-cache`, uploaded last, with
  absolute artifact URLs. A stable release also updates the canary channel.

`:vacuum` removes expired versions (`--keep-stable 100 --keep-canary 10`). The updater reads the feed of its
channel (`src/update_feed.ts`), downloads only on request, installs on quit, and can switch between stable
and canary. Integrity relies on electron-updater's SHA-512 manifest and Apple code signing.

## Not Implemented

- Universal macOS app and DMG; the `lipo` rule in `bazel/macos_packaging.bzl` is unused.
- Signed update manifests, staged rollout cohorts, a kill switch, and update failure tests.
- Proxy request cancellation, backpressure, a startup timeout, response size bounds, and restart after a
  utility-process crash.
- Open-file and save-file dialogs, scoped filesystem grants, and a renderer-to-main logger.
- Size, cold-start and memory measurements of release artifacts.
- Windows and Linux packages.
