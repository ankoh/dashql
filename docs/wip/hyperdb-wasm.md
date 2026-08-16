# HyperDB WASM

> **Status: WIP investigation.** This document records the current HyperDB WASM integration work
> and, in particular, the WebKit compatibility findings for the macOS Tauri application. Update it
> as newer WebKit builds ship in macOS.

## WebKit compatibility

### HyperDB requirements

The tested package is `hyperdb-wasm@0.0.26268-dev.wasm.g87cb62b6`. Its engine is built with:

- WebAssembly Memory64 (`-m64` / wasm64).
- WebAssembly exceptions.
- WebAssembly pthreads, which require `SharedArrayBuffer` and a cross-origin-isolated page.
- A preallocated Emscripten pthread worker pool.
- WasmFS and browser OPFS support.

These are independent requirements. Supporting ordinary wasm32 does not imply Memory64 support,
and setting COOP/COEP headers does not help if the WebKit build cannot compile Memory64.

### Shipping macOS WebKit

DashQL's macOS application uses Tauri's system `WKWebView`. It does not bundle Chromium or select
the WebKit included with Safari Technology Preview. The tested machine ran macOS 26.6.1 with
WebKit framework version `623.1.14`.

The exact HyperDB module fails to compile in that system JavaScriptCore:

```text
CompileError: WebAssembly.Module doesn't parse at byte 5509: Memory64 is not enabled
```

Therefore, the current HyperDB wasm64 package cannot run in a normally packaged DashQL release on
macOS 26.6.1. The failure happens before HyperDB initialization or query execution.

### Memory64 in WebKit main

WebKit enabled Memory64 by default on July 30, 2026 in
[`318257@main`](https://commits.webkit.org/318257@main), tracked by
[WebKit bug 320570](https://bugs.webkit.org/show_bug.cgi?id=320570). This is a WebKit-main change;
it does not imply that an already released macOS system WebKit has the feature.

Safari Technology Preview 250 contains changes only through `317934@main`, so it predates the
default-on Memory64 change. Installing Safari Technology Preview also does not replace the system
WebKit used by a third-party `WKWebView` application.

For development, WebKit publishes unsigned
[build archives](https://webkit.org/build-archives/). A client application can be launched with
the archive's frameworks and XPC services by setting `DYLD_FRAMEWORK_PATH`,
`DYLD_LIBRARY_PATH`, and the corresponding `__XPC_*` variables. WebKit documents the equivalent
workflow through [`run-webkit-app`](https://webkit.org/running-webkit/). This is a local test
harness, not a distributable application configuration.

### Exact package test on preview WebKit

The exact HyperDB package was tested against WebKit build `319159@main` from August 13, 2026, which
is newer than the Memory64 enablement change. The test used the packaged browser API and compressed
engine asset, not only a synthetic Memory64 feature probe.

Over an isolated loopback HTTP origin with the required COOP/COEP headers, the test completed:

1. The 94 MB HyperDB wasm64 module validated and compiled.
2. The HyperDB browser worker initialized.
3. Emscripten pthread workers started.
4. `SELECT 42 AS answer` executed successfully.
5. The result returned `42`.

The page reported:

```json
{
    "status": "passed",
    "detail": "42",
    "crossOriginIsolated": true,
    "sharedArrayBuffer": true
}
```

This proves that current WebKit main can execute the actual HyperDB wasm64 package. It does not yet
establish which future macOS release will ship a sufficiently new system WebKit.

### Tauri custom-scheme isolation

Production Tauri assets are served through a custom URL scheme backed by `WKURLSchemeHandler`, not
an HTTP server. `packages/dashql-native/tauri.conf.json` already sets:

```json
{
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp"
}
```

[WebKit bug 314080](https://bugs.webkit.org/show_bug.cgi?id=314080) reports that these headers do
not enable cross-origin isolation for custom-scheme responses. The public bug remains open.

A standalone `WKWebView` harness was created to reproduce the important Tauri behavior:

- `app://localhost` origin.
- `WKURLSchemeHandler` asset responses.
- COOP and COEP headers on every response.
- The exact HyperDB browser package and wasm64 engine.

The results differed by WebKit version:

| Runtime | `crossOriginIsolated` | `SharedArrayBuffer` | HyperDB result |
| --- | --- | --- | --- |
| macOS 26.6.1 system WebKit | `false` | `false` | Failed during startup |
| WebKit `319159@main` | `true` | unavailable in the top-level probe | Reached engine initialization, then raised a generic `WebAssembly.Exception` |

The preview result indicates that current WebKit main has progressed beyond the behavior described
by bug 314080: a custom-scheme page can report itself as cross-origin isolated. The remaining
custom-scheme failure occurred after the module was fetched and compiled, during engine
initialization. It still needs a focused stack trace and may involve worker-specific isolation,
custom-scheme loading semantics, OPFS setup, or another Emscripten runtime assumption.

The successful loopback HTTP test separately proves that Memory64, WebAssembly exceptions, threads,
and the HyperDB engine itself work together in current WebKit main.

## Current decision

- Keep native DuckDB for released macOS Tauri builds until a sufficiently new system WebKit is
  broadly available and the custom-scheme startup failure is resolved.
- Treat HyperDB WASM on macOS `WKWebView` as feasible on a future WebKit release, not as a permanent
  platform incompatibility.
- Use WebKit build archives for development experiments only.
- Test the ordinary DashQL Tauri build on macOS 27 beta or later once its system WebKit contains
  `318257@main` or a corresponding released Memory64 implementation.
- Do not use Safari Technology Preview support as evidence of Tauri support; Tauri loads the system
  `WKWebView` supplied by macOS.
- Prefer capability detection over user-agent checks. At minimum, validate or compile a small
  representative Memory64 module and verify `crossOriginIsolated` plus `SharedArrayBuffer` before
  loading the full engine.

## Follow-up verification

1. Run the custom-scheme harness with worker-side logging for `crossOriginIsolated`,
   `SharedArrayBuffer`, OPFS setup, and Emscripten abort details.
2. Run the exact package in a normal DashQL Tauri build using WebKit `319159@main`, rather than only
   the standalone `WKWebView` harness.
3. Repeat without framework injection on the newest macOS 27 beta to measure the shipping system
   WebKit behavior.
4. Verify OPFS write, application termination, relaunch, and read in the packaged Tauri application.
5. Add a browser/Tauri runtime gate before selecting HyperDB so unsupported systems retain the
   existing DuckDB path instead of failing during module compilation.
