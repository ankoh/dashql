# WebKit experiments for a Tauri host (handoff)

The results are in [tauri_results.md](tauri_results.md).

For a coding agent on a Mac with Xcode. The work is experiments only. Nothing in the repo changes: the harnesses live
in `~/dashql-experiments/` (outside the checkout), and the deliverable is one report,
`~/dashql-experiments/REPORT.md` (see [The report](#the-report)). Don't commit, don't push, don't edit files of the
repo.

## Why

DashQL wants Tauri back, first on macOS (replacing Electron in `packages/dashql-native`), then on iOS. Tauri uses
the system WKWebView. The embedded engine, hyperdb-wasm, is a threaded wasm32 build with a shared memory
(`new WebAssembly.Memory({initial: 4096, maximum: 65536, shared: true})`, i.e. 256 MiB up to 4 GiB, 12 pthreads).
It needs `SharedArrayBuffer`, so the page must be `crossOriginIsolated`.

What is known (2026-11-28):

- **Memory64 is no longer a blocker.** hyperdb-wasm 0.0.27500 is wasm32 (`git show 4a77f176e`). It runs in Safari
  from an HTTP(S) page with COOP/COEP.
- **The custom scheme is not isolated.** Tauri serves the app from `tauri://localhost` through `WKURLSchemeHandler`.
  WebKit bug 314080 ("WKURLSchemeHandler responses don't enable cross-origin isolation even with COOP/COEP headers")
  is NEW and unassigned, rdar://176877650. WebKit commit `10740b3a1f` (2026-10-03) says "custom URL scheme handler
  loads skip COOP enforcement". In August, macOS 26.6.1 gave `crossOriginIsolated=false`
  (`git show 8a86a0350^:docs/wip/hyperdb-wasm.md`).
- **Loopback HTTP is the known workaround.** The plan is to serve the app from `127.0.0.1:<fixed port>` inside the
  app. The port has to stay fixed because OPFS is keyed by the origin. Ionic ran this way until 2018, and port
  collisions between apps happened: in ionic-team/cordova-plugin-ionic-webview#165, a second app showed the first
  app's content. That is the danger. If another program holds the port, the webview loads its code as DashQL's
  origin.
- **The proposed defense is unproven.** Serve loopback **HTTPS** with a self-signed certificate made per install,
  and answer the webview's server-trust challenge only for that certificate. Nobody documents this for every load
  of a page (document, chunks, workers, pthread workers, wasm). Apple forum thread 820730 reports that self-signed
  localhost subresources broke in iOS 26.4 (`TLSv1_ALERT_UNKNOWN_CA`) until an ATS key changed. WebKit bug 158877
  (open) says a challenge handler can be skipped entirely.

The experiments decide whether loopback with a pinned certificate is safe enough on macOS and iOS, and what Tauri
needs for it.

## Setup

- Record the environment first:
  - `sw_vers`, `xcodebuild -version`, `xcrun simctl list runtimes`, the Safari version.
  - Every iOS device used (model, RAM, iOS build).
- **Engine package:** `hyperdb-wasm@0.0.27500-dev.wasm.g04a478aa`, the version that `package.json` of the repo pins.
  Take it from the repo's `node_modules/hyperdb-wasm` after `pnpm install`, or with
  `npm pack hyperdb-wasm@0.0.27500-dev.wasm.g04a478aa`. Copy it into the experiments folder.
  - It ships `examples/browser.html` and `examples/serve.mjs`: a page that boots the engine with `HyperDB.create()`
    and runs SQL, and a Node server with COOP/COEP that serves `.wasm.br` with `Content-Encoding: br`. Start from
    these.
  - A custom scheme handler has no content decoding, so serve a decompressed `.wasm` there.
- **Fixed port for all experiments:** `47823`.
- **Native harness:** one Swift source for a WKWebView app, shared by macOS and iOS. Use an Xcode project, from
  XcodeGen (`brew install xcodegen`) or written by hand. The harness:
  - Loads a URL given as a launch argument (`-url`) and an origin mode (`-mode scheme|http|https`).
  - Implements `WKURLSchemeHandler` for `app://localhost`, serving a folder with given headers.
  - Embeds a loopback server, HTTP and HTTPS (Network.framework `NWListener`, TLS from a `SecIdentity`), serving the
    same folder with the same headers.
  - Logs every `webView(_:didReceive:completionHandler:)` challenge: the host, the port, the protection space, the
    certificate's SHA-256, and the decision.
  - Receives the probe result via `window.webkit.messageHandlers.probe.postMessage(json)` and prints it to stdout as
    one line `PROBE {...}`. That way `xcrun simctl launch --console` and the macOS terminal can read it.
- **Headers** on every response:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `X-Content-Type-Options: nosniff`
  - `Content-Type` correct, `application/wasm` for wasm.

## The probe page

One page, `probe.html`, served from the same folder in every experiment. It reports one JSON object:

| Field | How |
|---|---|
| `origin`, `isSecureContext`, `crossOriginIsolated` | `location.origin`, globals |
| `sab` | `typeof SharedArrayBuffer === 'function'` |
| `sabToWorker` | post a `SharedArrayBuffer` to a module worker, the worker writes into it with `Atomics.store`, the page reads it back |
| `sharedMemory4G` | `new WebAssembly.Memory({initial: 4096, maximum: 65536, shared: true})` succeeds; on failure the error text |
| `engine` | `HyperDB.create()`, `connect()`, `SELECT 42::INTEGER AS answer`; the answer, the version, the boot time in ms, or the error with its stack |
| `opfs` | in a worker: `navigator.storage.getDirectory()`, `createSyncAccessHandle()`; read a counter file, increment it, write it back; report the value |
| `loads` | one each of: a static `<script type="module">`, a dynamic `import()`, a module worker, a classic worker using `importScripts`, a `fetch()` of a JSON file, a `fetch()` of the wasm. For each: ok or the error. The engine adds its own pthread workers and the wasm. |

The counter of `opfs` shows persistence: after a quit and relaunch it must be one higher.

## Experiments

Run each on macOS and in the iOS simulator. Also run E3, E4, E5 and E6 on a real iPhone. The simulator shares the
Mac's network stack, so its port behavior is not iOS behavior. Record the raw `PROBE` lines.

### E1 Safari baseline

`node serve.mjs` (port 47823), `probe.html` in Safari on macOS and in Safari of the iOS simulator.

- **Expected:** all pass. If not, stop and report, because everything below assumes this.

### E2 Custom scheme (confirm bug 314080 on this OS)

The harness in `-mode scheme`, `app://localhost/probe.html`, same headers.

- **Expected:** `crossOriginIsolated=false` and the engine fails.
- If it passes, that is big news. Repeat it, then report with the exact OS and WebKit versions.

### E3 Loopback HTTP

`-mode http`, `http://127.0.0.1:47823/probe.html`. iOS: `NSAppTransportSecurity` with only `NSAllowsLocalNetworking`.

1. Check that the probe passes: isolated, the engine answers 42, and the OPFS counter increments over 3 relaunches.
2. Note whether iOS shows the local network permission prompt. It is expected not to for loopback.
3. Also try `http://localhost:47823`, which is a different origin. Note whether it behaves the same.

### E4 Loopback HTTPS with a pinned certificate (the core experiment)

`-mode https`, `https://127.0.0.1:47823/probe.html`.

- **Certificate:** a self-signed one generated with `openssl` (subjectAltName `IP:127.0.0.1` and `DNS:localhost`),
  imported as the server's identity.
- **Trust decision:** for `NSURLAuthenticationMethodServerTrust` on `127.0.0.1:47823`, the challenge handler
  compares the leaf certificate's SHA-256 with the pinned one. It answers `.useCredential` with
  `URLCredential(trust:)` on a match and `.cancelAuthenticationChallenge` otherwise. All other challenges get
  `.performDefaultHandling`.

1. **Positive:** the probe passes with `crossOriginIsolated=true`, and all `loads` and the engine are ok.
   - Log how many challenges came and for which loads. Challenges are per TLS connection, not per request, so
     count connections, not files.
2. **Negative at start:** a different self-signed certificate on the same port (a second server process), with the
   harness still pinning the first one.
   - Required: the document does not load, nothing from that server runs, and the challenge log shows the cancel.
3. **Negative mid-session (the attack):** load the page with the real server.
   1. Stop the real server and start the rogue one (different certificate) on the same port.
   2. From the page (a button, or a timer in the probe), trigger a new dynamic `import()`, a new module worker, a
      new classic worker and a `fetch()`.
   - Required: every one of them fails.
   - Record whether WebKit asked again for the new connection, or reused a cached trust decision for
     `127.0.0.1:47823`. This is the crucial result.
4. **Workers specifically:** do pthread workers of the engine and `importScripts` inside a worker go through the same
   challenge path? Run part 3 with the engine starting after the swap.
5. **ATS variants on iOS:**
   - only `NSAllowsLocalNetworking`;
   - `NSExceptionDomains` for `127.0.0.1` and `localhost` with `NSExceptionAllowsInsecureHTTPLoads`, the fix
     reported in forum thread 820730.

   Record which variant makes the positive case work. Make sure neither makes the negative cases load.

If part 3 lets anything load, the pinning defense fails. Note exactly what loaded.

### E5 Port behavior on a real iPhone

1. **Suspension:** open the HTTPS harness, send it to the background for 1 minute and for 15 minutes, then return.
   - Is the listener still accepting?
   - Does a new request from the page work without re-binding?
   - If the listener died, can the app re-bind the same port in `applicationWillEnterForeground`, before the page's
     next request?
2. **Two apps on the same port**, as in Ionic #165: build the harness twice with different bundle ids, both on port
   47823.
   1. Open A, go home, open B.
   2. Record whether B's bind fails, and with what error.
   3. Record what B's webview shows when B ignores the failure. With pinning it must refuse A's certificate. Without
      pinning (E3 mode) record what happens, because that is the takeover.
   4. Swap the order and repeat.
3. **macOS:** run the harness while another process (`nc -l 127.0.0.1 47823`) holds the port. Record the bind error,
   and whether the process holding the port can be named (`lsof -nP -iTCP:47823 -sTCP:LISTEN`, or `proc_pidinfo`
   from the app).

### E6 Memory on iOS devices

On the device with the least RAM available, in the HTTPS harness:

1. Cold start.
2. Reload the page 5 times (`webView.reload()`).
3. Kill and relaunch 3 times.
4. Background for 15 minutes and return.

Record `sharedMemory4G` and the engine result each time, every `RangeError: Out of memory`, and any WebContent
process termination (`webViewWebContentProcessDidTerminate`). Don't lower the memory maximum to make it pass. A
refusal is a result. The repo's handling of iOS reloads is in `packages/dashql/src/platform/hyperdb/hyperdb_web.ts`
(stop the worker on `pagehide`, wait for memory, fail on stall). Copy that behavior into the probe when it explains a
failure.

### E7 Tauri v2

A minimal Tauri v2 app (`npm create tauri-app`, vanilla) serving the probe folder, on macOS and the iOS simulator
(`tauri ios init`, `tauri ios dev`).

1. Default `tauri://localhost` with `app.security.headers` set to the headers above.
   - Expected: like E2. Confirm.
2. **Loopback:** a small HTTPS server in the Rust side, bound before the window opens, and the window's URL set to
   `https://127.0.0.1:47823/probe.html`. Find out how our code can answer the server-trust challenge in Tauri:
   - Read wry's WKWebView navigation delegate (`wry/src/wkwebview/`, the version Tauri pulls). Does it implement
     `webView:didReceiveAuthenticationChallenge:completionHandler:`?
   - Can a Tauri plugin (Swift on iOS, Rust with `objc2` on macOS) get at the `WKWebView` and its delegate without
     replacing wry's?
   - Report the smallest change that works: a config, a plugin hook, or a patch of wry with the diff.
3. **IPC from the loopback origin:**
   - Define one app command `host(op: String, args: serde_json::Value)`.
   - One capability with `remote.urls: ["https://127.0.0.1:47823"]` and that command's permission only.
   - Call it from the page with `invoke` and get a result back.
   - Also stream 100 messages back over a `tauri::ipc::Channel`. Record whether `Channel` needs any extra
     permission.
   - Record whether Tauri's IPC (`ipc://localhost`) works from a COEP `require-corp` page, or falls back to
     `postMessage`.
   - Record the exact errors of every permission problem.
4. **Single instance and bind order:** the app exits with a clear message when the port is taken (E5.3). It must
   never open the window in that case.

### E8 Reference: HTTPS site with App-Bound Domains (optional)

The harness loading `https://dashql.app/` with `WKAppBoundDomains` = `["dashql.app"]` and
`limitsNavigationsToAppBoundDomains = true`. Record `crossOriginIsolated`, whether the engine starts, and whether a
service worker registers. This is only a reference point for an offline-capable non-loopback path.

## The report

`~/dashql-experiments/REPORT.md`, plain Markdown:

1. **Environment** (from Setup).
2. **Summary table:** rows E1–E8 with their sub-steps, columns macOS, iOS simulator, iPhone. Each cell is pass, fail
   or n/a, with one line of detail.
3. **Answers**, each with the evidence (the `PROBE` lines, the challenge logs):
   - Is a custom-scheme page isolated on this OS? (E2, E7.1)
   - Does a loopback HTTPS page with a pinned certificate run the engine? (E4.1)
   - Does pinning stop a rogue server at start and mid-session, for documents, imports, workers, pthread workers
     and wasm? Does WebKit cache trust per host and port? (E4.2–4)
   - Which ATS keys does iOS need? (E4.5)
   - Does iOS keep or drop the listener in the background, and can the same port be re-bound? What happens with two
     apps on one port? (E5)
   - Does the 4 GiB shared memory hold up on the smallest device, across reloads and relaunches? (E6)
   - What is the smallest Tauri/wry change for the trust challenge, and how many permissions does the capability
     need? (E7)
4. **Surprises:** anything that contradicts the "What is known" section above.
5. **Harness:** the location of the code and the commands to run each experiment again.

## How the results are used

| Result | Consequence |
|---|---|
| E2 passes | The custom scheme comes back; loopback is not needed |
| E4.1–4 pass | Loopback HTTPS with a pinned certificate is the origin of the Tauri app on macOS and iOS |
| E4.3 fails (a rogue server's code runs) | Loopback is unsafe without more; then a hyperdb-wasm build without threads, or the HTTPS-site path (E8), becomes the iOS option |
| E5 shows iOS keeps ports of background apps | Port collisions are an expected failure; the app needs a clear error screen and a rarely used port |
| E6 fails on a device | Report it as WebKit's limit; the minimum supported device follows from it |
| E7.2 needs a wry patch | The patch is carried or upstreamed before phase 2 |
