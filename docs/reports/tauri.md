# Tauri and WebKit: can DashQL run from loopback HTTPS?

Report of the experiments E1–E8 of the handoff `tauri_webkit_experiments.md`, run on 2026-11-28. They test whether a
Tauri host on macOS and iOS can serve DashQL from loopback HTTPS with a pinned self-signed certificate, with the
threaded wasm32 hyperdb-wasm in a `crossOriginIsolated` WKWebView. The harnesses and the raw output live outside the
repo, in `~/dashql-experiments/` on the machine that ran them (`logs/` has one `.log` per run, named after the
experiment); section 5 lists them.

## 1. Environment

| | |
|---|---|
| macOS | 27.2.1 (26B131), Apple M3 Max, 96 GiB |
| Xcode | 27.1 (27A9275) |
| Safari | 27.2 |
| Simulator runtimes | iOS 27.0 (24A434), iOS 27.1 (24A94425) |
| Simulator device | iPhone Duo, iOS 27.1, UDID `4FD2096F-E179-404D-BB2E-0BB5AF6D4B71` (the only device type runtime 27.1 accepts; iPhone 17/18 Pro etc. are "Incompatible device"). Runs headless (Simulator.app is not at the Xcode path). UA: `iPhone OS 18_7 … Version/27.0 Mobile/15E148` |
| Real iPhone | **none available**, so the iPhone column is n/a everywhere |
| Engine | `hyperdb-wasm@0.0.27500-dev.wasm.g04a478aa` from the repo's `node_modules` (branch `dev`; `main` pins 0.0.27368). `version()` = `Hyper 9.1.0 emulation, hyper version __UNVERSIONED_HYPER__.0.0.0.r00000000` |
| Tauri | tauri 2.12.7, wry 0.57.4, objc2 0.6.5, objc2-web-kit 0.3.2, @tauri-apps/cli 2, create-tauri-app 4.7.5 |

## 2. Summary

| Experiment | macOS | iOS simulator | iPhone |
|---|---|---|---|
| **E1** Safari baseline | pass: coi, SAB, 4 GiB, OPFS 1, engine 42 (206 ms) | pass: coi, 4 GiB, OPFS 1, engine 42 (288 ms), same version | n/a |
| **E2** custom scheme `app://localhost` | **unexpected:** `crossOriginIsolated=true`, but the `SharedArrayBuffer` global is missing, so the engine refuses ("does not support WebAssembly threads"). A shared `WebAssembly.Memory` works (buffer is a SharedArrayBuffer, 4 GiB ok). With a 1-line shim, the engine works (42) | same as macOS; shim: engine 42 (206/228 ms) | n/a |
| E2 without headers | coi false (control) | – | n/a |
| **E3.1** loopback HTTP, 3 relaunches | pass: OPFS 1→2→3, engine 42, 6 connections / 169 requests | pass: OPFS 1→2→3, engine 42 | n/a |
| E3.2 local network prompt | – | none shown (screenshot `E3_ios_sim_localhost.png`); the simulator uses the Mac's stack, so this proves little | n/a |
| E3.3 `http://localhost:47823` | pass, separate origin (OPFS 1). **Danger:** a rogue on `[::1]:47823` takes `localhost` over while the app listens on 127.0.0.1 | pass, separate origin | n/a |
| **E4.1** HTTPS + pin, positive | pass: 6 challenges = 6 TLS connections, all pin matches, engine 42 | pass (both ATS variants) | n/a |
| **E4.2** rogue at start | pass: 2 challenges cancelled, `NAV failProvisional -999`, rogue served 0 requests | pass (both ATS variants) | n/a |
| **E4.3** rogue mid-session | pass: every new load fails; 7 new challenges (one per new connection), all cancelled; rogue 0 requests. No cached trust | pass (both ATS variants) | n/a |
| **E4.4** engine + in-worker loads after the swap | pass: engine fails ("Importing a module script failed"); importScripts, nested worker and fetch inside an old worker all fail; 11 challenges cancelled, rogue 0 requests. No-pin control: everything incl. engine, pthread workers and in-worker loads came from the rogue (168 requests) | pass, same; no-pin control identical | n/a |
| E4 `localhost` / `::1` takeover over HTTPS | pass with pin (10 cancelled, 0 requests); without pin all phase-2 loads came from the rogue | – | n/a |
| **E4.5** ATS: only `NSAllowsLocalNetworking` | – | pass | n/a |
| E4.5 ATS: `NSExceptionDomains` | – | pass | n/a |
| E4.5 ATS: no ATS keys | – | pass (HTTPS and HTTP) | n/a |
| **E5.1** background 1 min | – | proxy: listener stays `ready`, no accepts while suspended (curl timeout); on return old connections reset, new loads and a new engine work, no rebind needed | n/a |
| E5.1 background 15 min | – | proxy: same as 1 min (`E5_1_ios_sim_bg900`) | n/a |
| **E5.2** two apps on one port | – | proxy: second bind fails `POSIX 48 EADDRINUSE` (both orders). Ignoring it, the second app's page hangs while the first is suspended. **HTTP: takeover on resume** (B's queued request is served by A). HTTPS + pin: B cancels A's certificate, nothing loads | n/a |
| **E5.3** port held by another process | pass: `NWListener` fails `POSIX 48`; holder named via `proc_pidinfo` (`holder=Python/32591`); exit 3, no window | – (shares the Mac's ports) | n/a |
| **E6.1** cold start | pass | pass | n/a |
| **E6.2** 5 reloads | pass (5 of 5 engines) | **fail:** from reload 2/3 on, 4 GiB memories and engines fail with `RangeError: Out of memory`; with the repo's handling (stop on pagehide, OOM waits up to 3.2 s) reloads 3–5 still fail | n/a |
| E6.2b engine cycles in one page | pass (6 of 6) | **fail:** engines 1–2 ok, 3–5 OOM; bare 4 GiB memories 8 of 8 ok | n/a |
| **E6.3** kill + relaunch ×3 | pass (OPFS 21, 23) | pass (OPFS 32, 33, 34) | n/a |
| **E6.4** background 15 min | – | pass (engine 42 before and after) | n/a |
| **E7.1** `tauri://localhost` + `app.security.headers` | like E2: coi true, SAB global missing, engine refuses; shim: engine 42 (1.5 s boot, debug build) | same as macOS | n/a |
| **E7.2** loopback HTTPS, wry as is | fail as expected: TLS refused, 0 requests reach the server | same | n/a |
| E7.2 with the run-time trust hook | pass: 6 pin matches, 170 requests, engine 42 (363 ms) | pass: engine 42 (355 ms) | n/a |
| E7.2 hook with a wrong pin | pass: challenges cancelled, 0 requests | – | n/a |
| **E7.3** `invoke` + Channel from the loopback origin | pass with one capability, `remote.urls` = origin, permission `allow-host` only; 100 Channel messages in order; no extra permission needed | same | n/a |
| E7.3 IPC transport | `ipc://localhost` fetch **fails from https://** ("Load failed") and Tauri falls back to postMessage; from `http://127.0.0.1` the fetch works | same as macOS (https) | n/a |
| **E7.4** port taken / second instance | pass: `BIND-FAILED Address already in use (os error 48)`, exit 3, no window | – | n/a |
| **E8** dashql.app with App-Bound Domains | coi true, SAB, 4 GiB ok; no service worker (the app registers none); engine not started by the page within 15 s | same | n/a |

## 3. Answers

### Is a custom-scheme page isolated on this OS? (E2, E7.1)

Not in a way the engine can use, but **not as described in "What is known" either**. On macOS 27.2.1 and the iOS
27.1 simulator, an `app://localhost` (WKURLSchemeHandler) page with COOP/COEP reports `crossOriginIsolated=true`. A
shared `WebAssembly.Memory` works, and the 4 GiB maximum is accepted. Only the `SharedArrayBuffer` *global* is
missing, in the page and in workers. hyperdb-wasm checks for that global and refuses:

```
PROBE phase1 origin=app://localhost coi=True sab=False sabToWorker=False mem4G=False opfs=1      (E2_macos_scheme)
  sharedWasmMemory: ok, bufferType [object SharedArrayBuffer], sabGlobalInWorker undefined
  engine=FAIL: HyperDB cannot initialize because this browser does not support WebAssembly threads
```

Without the headers, coi is false (`E2_macos_scheme_noheaders`), so WebKit does read the headers. Restoring the
global from the memory's buffer is enough for the engine (`shim=1`, page and worker, `site/hyperdb_shim_worker.js`):

```js
globalThis.SharedArrayBuffer = new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true }).buffer.constructor;
```

```
PROBE phase1 origin=app://localhost coi=True sab=True shim=True sabToWorker=True mem4G=True opfs=5   engine={'answer': 42, 'bootMs': 270}
```

Tauri's `tauri://localhost` behaves the same, on macOS and in the simulator (`E7_1_scheme`, `E7_1_scheme_shim`,
`E7_ios_sim_scheme`, `E7_ios_sim_scheme_shim`). With the shim, the engine answered 42 in both. The boot took 1.5 s
instead of 0.3 s, probably because the debug build serves the 110 MB wasm from compressed embedded assets.

Whether the shim is a sound basis is open. It depends on WebKit keeping the shared memory usable while hiding the
global. That half-state looks like a WebKit bug that may be fixed in either direction.

### Does a loopback HTTPS page with a pinned certificate run the engine? (E4.1)

Yes, on macOS and in the simulator. One challenge comes per TLS connection: 6 connections for 169 requests, including
the engine's pthread workers and the wasm.

```
CHALLENGE n=1 host=127.0.0.1 port=47823 protocol=https method=NSURLAuthenticationMethodServerTrust … chain=1 leaf=c85e1576…750e decision=useCredential (pin match)
… n=2..6 the same
PROBE phase1 origin=https://127.0.0.1:47823 coi=True sab=True sabToWorker=True mem4G=True opfs=3   engine={'answer': 42, 'bootMs': 309}
STATS challenges=6 serverConnections=6 serverRequests=169                                         (E4_1_macos_https)
```

### Does pinning stop a rogue server? Does WebKit cache trust per host and port? (E4.2–4)

Pinning stopped the rogue server in every case. **WebKit caches no trust decision:** every new TLS connection asks
again, and a cancel fails exactly that load.

- **At start** (`E4_2_*`): 2 challenges with the rogue leaf, both cancelled. `NAV failProvisional
  domain=NSURLErrorDomain code=-999 cancelled`. The rogue's log shows 0 requests (only TLS alerts).
- **Mid-session** (`E4_3_*`): after the swap, the new script element, `import()`, module worker, classic worker,
  fetch and wasm fetch all failed, for example `TypeError: Importing a module script failed.` and `worker error
  event`. The challenges went from 6 to 13, all 7 new ones `PIN MISMATCH … cancel`. The rogue got 0 requests.
- **Engine and in-worker loads after the swap** (`E4_4_macos_engine_after_swap_late_pinned*`, the same in the
  simulator): 11 challenges, all cancelled, rogue 0 requests (11 TLS errors `CERTIFICATE_UNKNOWN`):
  - The engine failed with "Importing a module script failed."
  - A classic worker started before the swap failed `importScripts` (`NetworkError: Load failed`), a nested worker
    (error event) and a fetch (`Load failed`).

  So pthread workers and loads inside workers go through the same challenge path as the page.
- **The no-pin control matters.** Without the pin, the same sequence ran the rogue's code everywhere: the script
  element, import, both workers, fetch, wasm, the engine (42, from the rogue's `browser_worker.js` and the pthread
  worker), and importScripts, the nested worker and the fetch inside the old worker. That was 168 rogue requests. The
  attack is real, and the pin is what stops it.
- **Caveat (E4.4):** swapping servers while the engine was still booting measured a race in the test, not pinning. A
  request in flight on a connection being closed failed in the no-pin control too. The decisive runs are therefore
  the ones where the engine starts after the swap.
- **`localhost` and `::1`:** an app listening on `127.0.0.1` doesn't own `localhost`. A rogue listening on
  `[::1]:47823` binds fine (`BINDTEST ::1 plain: BOUND`) and gets every new connection to `localhost` (WebKit prefers
  IPv6). Over HTTP this is a full takeover of the origin `http://localhost:47823` (`E3_macos_localhost_v6takeover`:
  phase 2 all `rogue`). Over HTTPS with the pin it fails (10 cancelled, 0 requests). **Use `127.0.0.1`, never
  `localhost`.**

### Which ATS keys does iOS need? (E4.5)

In the simulator, none. Three builds all passed E4.1 over HTTPS, and E4.2–4 failed as required:

- `HarnessIOS`: only `NSAllowsLocalNetworking`.
- `HarnessIOSExc`: `NSExceptionDomains` for 127.0.0.1 and localhost with `NSExceptionAllowsInsecureHTTPLoads`.
- `HarnessIOSNoATS`: no ATS keys. It also passed over plain HTTP.

The `TLSv1_ALERT_UNKNOWN_CA` breakage of forum thread 820730 did not reproduce. ATS on a device can differ, so this
needs an iPhone.

### Does iOS keep the listener in the background, and can the port be re-bound? Two apps on one port? (E5)

These are simulator proxies only. The simulator shares the Mac's network stack, and E5 is about a real iPhone.

- **Suspension, 1 and 15 minutes** (`E5_1_ios_sim_bg60`, `E5_1_ios_sim_bg900`): `APP background listener=ready`. A
  curl from the Mac at +3 s and at +900 s timed out (`curl exit=28`), because the suspended app doesn't accept. On
  return, the listener was still `ready`, and the old keep-alive connections were reset (`POSIX 54 Connection reset
  by peer`, `-9816`). The page's new loads, the late worker's loads and a new engine all worked over new connections
  with pin matches (`engine 42, bootMs 281`). No rebind was needed. `-rebindOnForeground` exists in the harness but
  never ran, because the listener never died.
- **Two apps** (`E5_2_sim_*`):
  - The second app's bind fails with `POSIX 48 EADDRINUSE`, in both orders. iOS doesn't let the app name the holder.
  - If B ignores the failure, its page waits at `NAV start` (40 s), because A holds the port but is suspended. This
    happens over HTTP and HTTPS alike.
  - **The takeover still happens, later:** B's request waits in A's listen backlog. When A returns to the foreground,
    A serves it (`GET /probe.html?…tag=E5.2-resume-B` in A's log). B's page then runs A's code at the origin
    `http://127.0.0.1:47823`, with B's storage (OPFS 2). This is Ionic #165, with a delay.
  - Over HTTPS with per-install pins, B gets a challenge with A's leaf (`c85e…`), cancels it (`NAV -999`) and loads
    nothing (`E5_2_sim_resume_https_*`).
- **macOS, port held** (`E5_3_*`): `LISTENER state=failed(POSIXErrorCode(rawValue: 48): Address already in use)`.
  `lsof` and `proc_pidinfo` name the holder (`BIND-FAILED … holder=Python/32591`). The harness exits with code 3 and
  opens no window. A Python listener stood in for `nc`.

### Does the 4 GiB shared memory hold up across reloads and relaunches? (E6)

The smallest device was not available. On the iOS 27.1 simulator, a WebContent process gives memory back from
stopped engines poorly or not at all:

| Run | Result |
|---|---|
| 5 reloads, original probe (`E6_ios_sim_reloads`) | 4 GiB memory fails from reload 2 on; engine OOM in 3 of 5 |
| 5 reloads, repo behavior: `mem=0`, stop the worker on pagehide, OOM waits 100…3200 ms (`…_mem0_stop_retry`) | engines 1–3 ok, reloads 3–5 fail after 7 attempts each |
| 5 reloads 40 s apart (`…_slow`) | the 4th and 5th engines fail |
| engine cycles in one page, stop + 2 s wait (`E6_ios_sim_cycles`) | engines 1–2 ok, 3–5 `RangeError: Out of memory` |
| bare 4 GiB memories in new workers, 8 cycles (`E6_ios_sim_memcycles`) | 8 of 8 ok |
| kill + relaunch ×3 (`E6_ios_sim_relaunch*`) | all ok, OPFS 32→33→34 |
| background 15 min (`E5_1_ios_sim_bg900`) | engine 42 before and after |

So about three engines fit into one WebContent process, and time doesn't free more. A bare 4 GiB memory is freed
when its worker ends. A stopped engine's memory is not, probably because of its pthread workers or its wasm
instance. `webViewWebContentProcessDidTerminate` never fired. On macOS, 5 reloads, 6 engine cycles and 8 memory
cycles all passed. A relaunch (new process) always works. In this setup, a page reload on iOS is not safe for the
engine, while killing the WebContent process is. One option is to recreate the WKWebView instead of reloading it.
This needs confirmation on a device.

### What is the smallest Tauri/wry change for the trust challenge, and which permissions does the capability need? (E7)

**wry 0.57.4 has no `webView:didReceiveAuthenticationChallenge:completionHandler:`.**
`src/wkwebview/class/wry_navigation_delegate.rs` defines `WryNavigationDelegate` with only
decidePolicyForNavigationAction, decidePolicyForNavigationResponse, didFinish, didCommit, the two download methods and
WebContentProcessDidTerminate. The run confirms it (`respondedBefore=false`). Without a handler, WebKit's default
evaluation rejects the self-signed leaf, and nothing loads (`E7_2_https_nohook`: 0 requests).

**The smallest change that works needs no wry patch: a hook at run time from the app.** It is in
`tauri-probe/src-tauri/src/lib.rs`, `mod trust`, about 100 lines of Rust with objc2:

1. Create the window with `about:blank`. The hook has to be in place before the first HTTPS load.
2. In `window.with_webview`, take `platform.inner()` (the WKWebView), read `navigationDelegate`, and use
   `class_addMethod` to add the method (type `v@:@@@?`) to its class. The IMP pins on the SHA-256 of
   `SecTrustCopyCertificateChain[0]`, answers `UseCredential` with `credentialForTrust:` or `Cancel`, and gives every
   other challenge `PerformDefaultHandling`.
3. **Set the delegate again** (`setNavigationDelegate:` with the same object). WebKit caches which methods a delegate
   has when the delegate is set.
4. Navigate to `https://127.0.0.1:47823/probe.html`.

```
HOOK delegate class=wry::wkwebview::class::wry_navigation_delegate::WryNavigationDelegate0.57.4 respondedBefore=false added=true
CHALLENGE n=1 host=127.0.0.1 port=47823 method=NSURLAuthenticationMethodServerTrust leaf=c85e1576…750e decision=useCredential (pin match)
PROBE phase1 origin=https://127.0.0.1:47823 coi=True sab=True sabToWorker=True mem4G=True opfs=1   engine={'answer': 42, 'bootMs': 363}   (E7_2_https_hook)
```

The same binary code works in the iOS simulator (`E7_ios_sim_https_hook`, engine 42, 355 ms). A wrong pin cancels
everything (`E7_2_wrongpin`: `decision=cancel (PIN MISMATCH)`, 0 requests).

Limits of the hook:

- It changes wry's class, so every webview of the process gets the handler. The handler filters by host and port.
- It depends on wry's internal class name only through `object_getClass` of the delegate, not by name.
- The cleaner alternative is a wry patch, sketched in `patches/wry-0.57.4-server-trust.diff` (not built): a
  `server_trust_handler` attribute on the webview, the delegate method calling it, and a Tauri builder option that
  forwards it. A plugin alone can't add the method without the same class trick, because the delegate is wry's object.

**IPC from the loopback origin** (`E7_2_https_hook`, `E7_3_*`):

- One capability, added at run time with `app.add_capability`:
  `{"identifier":"loopback","windows":["main"],"remote":{"urls":["https://127.0.0.1:47823","http://127.0.0.1:47823"]},"permissions":["allow-host"]}`.
  `allow-host` comes from `tauri_build::AppManifest::new().commands(&["host"])`. The origin without a path matched.
- `invoke('host', {op:'echo'})` returned the result. `stream` sent 100 messages over a `tauri::ipc::Channel`, and all
  100 arrived in order. **A Channel needs no extra permission.** In Tauri 2.12 a Channel has to be a required
  argument, not `Option<Channel>` (no `Deserialize`).
- Exact errors:
  - No remote capability (`E7_3_nocap`): `host not allowed on window "main", webview "main", URL:
    https://127.0.0.1:47823/probe.html?tag=E7_3_nocap` / `allowed on: [windows: "main", URL: local]` / `referenced
    by: capability: local, permission: allow-host`.
  - A core command not granted to the remote origin: `app.version not allowed on window "main", webview "main",
    URL: https://127.0.0.1:47823/… allowed on: [windows: "main", URL: local] referenced by: capability: local,
    permission: allow-version`.
  - An unknown command: `greet not allowed. Command not found`.
- **Transport:**
  - From `https://127.0.0.1:47823`, the first `fetch('ipc://localhost/host')` fails with `TypeError: Load failed`.
    Tauri logs `IPC custom protocol failed, Tauri will now use the postMessage interface instead`, and every later
    invoke goes through postMessage, which works. This happens on macOS and in the simulator.
  - From `http://127.0.0.1:47823` with the same COEP, the ipc:// fetch works (`fetchOk: 4`, no warning). COEP is
    therefore not the cause. Probably WebKit treats `ipc:` from an https page as mixed content (inferred, not
    checked further).
  - Under `tauri://localhost` the fetch works (19 ok).

**Single instance and bind order** (`E7_4_second`, and earlier while the simulator held the port):

- The server binds in `setup` before any window. When the bind fails, the app prints `BIND-FAILED Address already
  in use (os error 48)` and `EXIT the port 47823 is taken, not opening the window`, then exits with code 3.
- Rust's std listener sets `SO_REUSEADDR`, so it isn't affected by the macOS TIME_WAIT gap that `NWListener` has
  (see Surprises).

## 4. Surprises (against "What is known")

1. **E2 and E7.1: custom-scheme pages are isolated, but the `SharedArrayBuffer` global is hidden.** This contradicts
   the description of bug 314080: `crossOriginIsolated=true`, shared wasm memory works, and only the global is
   missing. A 1-line shim in the page and in the worker makes the engine run under `app://` and `tauri://`. It is a
   possible third path besides loopback, but it rests on an inconsistency in WebKit.
2. **`localhost` can be taken over through `::1`** while the app listens on `127.0.0.1`, without a bind error. Over
   HTTP it is a full origin takeover.
3. **Two apps on one port (iOS simulator): the takeover is delayed, not prevented.** The second app's request waits
   in the suspended first app's backlog and is served when the first app returns. Over HTTP, B runs A's code with B's
   storage. HTTPS with a pin per install blocks it.
4. **iOS simulator: only about 3 engines per WebContent process.** A stopped engine's 4 GiB memory doesn't come
   back, even with the repo's pagehide stop and OOM waits. Reloads fail, relaunches work. Bare 4 GiB memories cycle
   fine.
5. **No ATS keys are needed in the simulator** for loopback HTTPS or HTTP. The 820730 breakage didn't reproduce.
6. **Tauri IPC from an https loopback page always falls back to postMessage** (the ipc:// fetch fails). It works,
   but the faster custom-protocol path is lost unless the page is http.
7. **iOS 27 requires the UIScene lifecycle.** An app without it crashes at launch
   (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, EXC_BREAKPOINT). The harness adopted it. The
   Tauri iOS app (tao) launched fine.
8. **macOS: `NWListener` can't bind for about 30–35 s after a simulator app on the port exits,** even with
   `allowLocalEndpointReuse = true`. A plain `bind()` also fails, while `SO_REUSEADDR` succeeds. Neither `lsof` nor
   `netstat` shows a holder (TIME_WAIT-like, msl 15000). Back-to-back macOS relaunches bind fine.
9. Minor:
   - App Nap delayed the harness's timers on macOS (a 45 s quit took 317 s), so the harness uses `beginActivity`.
   - The engine version differs between `main` (0.0.27368) and `dev` (0.0.27500).
   - Tauri's iOS app writes no stdout to `simctl launch --console`. The probe logs to a host file there.
   - `tauri ios init` needs CocoaPods.

## 5. Harness

Everything is in `~/dashql-experiments/`, not in the repo:

| Path | What |
|---|---|
| `site/` | the probe (`probe.html`, `probe.js`, workers, `hyperdb/` engine, `vendor/`). `site-rogue/` is the same with `WHO=rogue` (`sed 's/"real"/"rogue"/g' site/probe.js > site-rogue/probe.js` after edits) |
| `certs/` | `real`/`rogue` keys, certificates, `.p12`, `.sha256` pins |
| `servers/serve.mjs` | the Node server: `node servers/serve.mjs --root site [--port 47823] [--host 127.0.0.1] [--who real] [--tls certs/rogue] [--wait] [--reuseport]` (`--wait` retries the bind until the port is free: the rogue waiting for the real server) |
| `scripts/bindtest.py` | tries every way of binding 47823 another program could use, while the harness listens (E5.3, `::1`) |
| `harness/` | the Swift WKWebView harness (`Sources/main.swift`, `project.yml`). Regenerate with `xcodegen generate -q`. Targets: HarnessMac, HarnessMacAB, HarnessIOS, HarnessIOSB, HarnessIOSExc, HarnessIOSNoATS, HarnessIOSAB |
| `scripts/` | `mac.sh`, `sim.sh`, `attack.sh`, `sim_background.sh`, `sim_two_apps.sh`, `tauri.sh`, `tauri_sim.sh`, `brief.py` (summarizes PROBE lines) |
| `tauri-probe/` | the Tauri v2 app. `src-tauri/src/lib.rs` contains the server, the `host` command, the trust hook and the capability, configured by `PROBE_*` variables. `dist/` hard-links `site/` without the `.br` |
| `patches/` | the wry patch sketch |
| `logs/` | all runs |

Build:

```sh
cd ~/dashql-experiments/harness && xcodegen generate -q
xcodebuild -project WebKitHarness.xcodeproj -scheme HarnessMac -configuration Debug -derivedDataPath build -destination 'platform=macOS' build
xcodebuild -project WebKitHarness.xcodeproj -scheme HarnessIOS -configuration Debug -derivedDataPath build -destination "platform=iOS Simulator,id=$(cat ../sim.udid)" build   # likewise HarnessIOSB/Exc/NoATS/AB, HarnessMacAB
cd ~/dashql-experiments/tauri-probe/src-tauri && cargo build                                # macOS
cd ~/dashql-experiments/tauri-probe && npx tauri ios build --debug --target aarch64-sim      # simulator
```

Rerun (from `~/dashql-experiments`; `PIN=$(cat certs/real.sha256)`):

| Exp. | Command |
|---|---|
| E1 | `node servers/serve.mjs --root site`, open `http://127.0.0.1:47823/probe.html` in Safari (macOS) or `xcrun simctl openurl $(cat sim.udid) http://127.0.0.1:47823/probe.html`; PROBE lines in the server log |
| E2 | `scripts/mac.sh E2_macos_scheme -mode scheme -url 'app://localhost/probe.html'` (add `?shim=1`); simulator: `scripts/sim.sh E2_ios_sim_scheme -mode scheme -url …` |
| E3 | `scripts/mac.sh E3_macos_http_run1 -mode http -url http://127.0.0.1:47823/probe.html` ×3; `…localhost…`; simulator via `scripts/sim.sh` |
| E4.1 | `scripts/mac.sh E4_1_macos_https -mode https -url https://127.0.0.1:47823/probe.html -pin $PIN` (`APP=HarnessIOSExc scripts/sim.sh …` for the ATS variant) |
| E4.2 | rogue: `node servers/serve.mjs --root site-rogue --who rogue --tls certs/rogue`, then the harness with `-noServer YES -pin $PIN` |
| E4.3/4 | `scripts/attack.sh …` (`RUNNER=scripts/sim.sh` for the simulator): `-stopAfterPhase1 YES -phase2After 1 -phase2Engine YES`, the rogue `node servers/serve.mjs --root site-rogue --who rogue --tls certs/rogue --wait`; `::1` takeover: the rogue with `--host ::1`; `-pin none` for the control |
| E5.1 | `scripts/sim_background.sh E5_1_ios_sim_bg60 60 -mode https -url 'https://127.0.0.1:47823/probe.html?oomRetry=1' -pin $PIN -phase2Engine YES` (900 for 15 min) |
| E5.2 | `scripts/sim_two_apps.sh <name> A|B https|http [yes|no]` |
| E5.3 | hold the port (`python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",47823));s.listen();input()'`), then `scripts/mac.sh E5_3_macos_port_held -mode https …` |
| E6 | `scripts/sim.sh E6_ios_sim_reloads -mode https -url 'https://127.0.0.1:47823/probe.html?…' -reloads 5 -reloadDelay …`; cycles: `?cycles=5&cycleWait=2000`, `?memCycles=8&engine=0`; relaunch: `NOINSTALL=1 scripts/sim.sh E6_ios_sim_relaunchN …` |
| E7 | `scripts/tauri.sh <name> PROBE_MODE=scheme|https|http [PROBE_HOOK=0] [PROBE_PIN=…] [PROBE_REMOTE_URLS=none] [PROBE_QUERY='shim=1']`; simulator: `scripts/tauri_sim.sh <name> …` (same variables) |
| E8 | `APP=HarnessMacAB scripts/mac.sh E8_macos_appbound -noServer YES -appBound YES -url https://dashql.app/ -evalAfterLoad 15 -quitAfter 35`; `APP=HarnessIOSAB scripts/sim.sh E8_ios_sim_appbound …` |

Side effects outside the experiments folder:

- `rustup target add aarch64-apple-ios-sim`.
- `tauri ios init` ran `brew install libimobiledevice`. That upgraded `ca-certificates`, installed `openssl@4` and
  **unlinked openssl@3**, so `/opt/homebrew/bin/openssl` is now 4.1.0. To undo: `brew unlink openssl@4 && brew link
  openssl@3`.
- CocoaPods was installed by the user.
