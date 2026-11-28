# The origin of the Tauri app

The Tauri app on macOS and iOS serves DashQL to its WKWebView from `https://127.0.0.1:47823`, with a self-signed
certificate that the app makes at every launch and pins. This document says why, what pinning is, what it protects
and what it doesn't, and which WebKit behavior it rests on. The measurements are in
[../reports/tauri_results.md](../reports/tauri_results.md), the experiments that produced them in
[../reports/tauri_experiments.md](../reports/tauri_experiments.md).

## Why not the custom scheme

The embedded Hyper is a threaded wasm32 build with a shared memory, so it needs `SharedArrayBuffer`, which a page
gets only when it is cross-origin isolated (see [document_isolation_policy.md](document_isolation_policy.md)).
Tauri serves the app from `tauri://localhost`, through a `WKURLSchemeHandler`. On macOS 27.2 and iOS 27.1, such a
page reports `crossOriginIsolated=true`, yet the `SharedArrayBuffer` global is missing, and the engine refuses to
start. WebKit's source explains the mismatch:

- `Document::crossOriginIsolated()` follows the headers of the document, so COOP and COEP make it true.
- `JSDOMGlobalObject` exposes `SharedArrayBuffer` only when the web process was launched as isolated
  (`ScriptExecutionContext::crossOriginMode() == CrossOriginMode::Isolated`). Only COOP enforcement puts a page
  into such a process, and loads of a scheme handler skip COOP enforcement (WebKit `10740b3a1f`: "These loads skip
  COOP enforcement, so they cannot stay cross-origin isolated").
- A shared `WebAssembly.Memory` checks neither, so a one-line shim
  (`SharedArrayBuffer = new WebAssembly.Memory({initial: 0, maximum: 0, shared: true}).buffer.constructor`) brings the
  engine up.

The shim is not used. It runs shared memory in a process that WebKit never isolated. Closing that gap would break
the engine with an OS update. WebKit bug 314080 (custom schemes don't get isolation) is open without an answer.
Document-Isolation-Policy is no way out either. In WebKit it is `testable` and off by default, its process placement
needs site isolation, which is `unstable` and off, and an app can turn neither on without private API.

An HTTP(S) page with COOP and COEP gets an isolated process, so the app serves itself over loopback.

## Why HTTPS and a pin, not plain HTTP

The origin keys the storage (OPFS) of the app, so the port is fixed: a new port would be a new origin with empty
storage. A fixed port can be taken by another program. Over plain HTTP, the webview then loads that program's code as
DashQL's origin, with DashQL's storage and its `host` bridge. Measured (E3, E4, E5):

- A rogue server that takes the port mid-session serves every new load: scripts, dynamic imports, workers, the
  engine's pthread workers, loads inside existing workers, the wasm.
- Two apps on one port on iOS: the second app's request waits in the backlog of the suspended first app. When the
  first app returns, it answers, and the second app runs the first app's code with its own storage.
  cordova-plugin-ionic-webview#165 is the same, from 2018.
- A program listening on `[::1]:47823` takes `localhost` over while the app listens on `127.0.0.1`, without any bind
  error.

A page can't check who served it, and workers and dynamic imports have no subresource integrity. TLS can: the webview
asks the app about every new TLS connection, and the app accepts only its own server.

## What pinning is

In normal TLS, a client accepts a server's certificate when a certificate authority (CA) that the system trusts
signed it and it names the host. Anyone with such a certificate for the name is accepted. Pinning means the client
also knows in advance exactly which certificate the server must present, usually as a SHA-256 fingerprint. Any other
certificate is refused, even a correctly signed one.

The app has no CA at all:

1. At launch, before any window, the app makes an ECDSA P-256 key pair and a self-signed certificate for
   `IP:127.0.0.1` in memory, and keeps its SHA-256 fingerprint.
2. Its server presents that certificate.
3. For every new TLS connection, the webview asks the app (`webView:didReceiveAuthenticationChallenge:` with
   `NSURLAuthenticationMethodServerTrust`). The app hashes the leaf certificate it is shown and compares it with the
   fingerprint. A match gets `useCredential` with `URLCredential(trust:)`. A mismatch gets
   `cancelAuthenticationChallenge`, and that load fails. Challenges for other hosts, ports or methods get
   `performDefaultHandling`.

A rogue server can copy the certificate, because certificates are public. But the handshake also requires a
signature with the private key, and that key exists only in the memory of the running app. A copy fails the
handshake, and a rogue server with its own key has a different fingerprint.

## The simplest form: a new certificate at every launch

The certificate is not part of the origin. The origin is scheme, host and port, so OPFS stays where it is when the
certificate changes. The app therefore keeps nothing:

- no key file, no Keychain item, no entitlement, no migration of keys;
- no expiry or renewal: a certificate lives only as long as its process;
- no secret in the bundle, so nothing for an extracted app to reveal (the key shipped in the bundle was the mistake
  of the Spotify and Blizzard loopback certificates, which their CAs revoked);
- two installs, or two apps, never share a certificate, so neither can answer for the other.

A server that has to bind again in the same process (iOS after suspension) keeps the certificate of the process.

The rest follows the same rule of doing the least that is safe:

- **Host `127.0.0.1` only.** Never `localhost`, the server binds IPv4 loopback only, and the webview may navigate
  only to the origin (links to other sites go through `openExternal`).
- **The server only serves files.** It answers `GET` and `HEAD` with files of the bundle (paths checked like
  `resolveAppRequest` of `packages/dashql-native/src/app_protocol.ts`), with the COOP, COEP, CORP, nosniff, CSP and
  `Cache-Control: no-store` headers. `no-store` keeps a webview from using files of an earlier version after an
  update. Everything else goes through the one Tauri command `host`, so the server has nothing worth taking.
  Another program that connects gets the public files of the app and no token is needed.
- **The port is taken: no window.** The server binds in `setup`, before the webview exists. When the bind fails,
  the app says that port 47823 is in use and exits. There is no second port, which would mean a new origin. On macOS,
  the single-instance lock keeps a second DashQL away.
- **The hook is added at run time.** wry 0.57.4's navigation delegate has no challenge method. The app adds one to
  the delegate's class with `class_addMethod` (public Objective-C runtime) and sets the delegate again, because WebKit
  records a delegate's methods when the delegate is set. The window starts on `about:blank`, and the first HTTPS load
  comes after the hook. If the delegate already had the method (`respondedBefore`), the app refuses to start, because
  then wry's code and not ours would decide trust. No patch of wry is carried.

## What it protects and what it doesn't

| Case | Result |
|---|---|
| Another program holds the port at launch | The app exits with a message; it never shows that program's page |
| A rogue server takes the port mid-session | Every new connection fails the pin; nothing of it runs (E4.3, E4.4) |
| Another app on iOS on the same port | Its certificate doesn't match; nothing loads (E5.2) |
| A program on `[::1]` | Irrelevant, the app never uses `localhost` |
| Another program reads the app's files from the server | Possible and harmless; the server has only public files |
| Malware running as the user on macOS | Not covered. It can read DashQL's data on disk directly |

## Which WebKit behavior it rests on

| Assumption | Basis | If it changes |
|---|---|---|
| Server-trust challenges go to the navigation delegate, and `URLCredential(trust:)` accepts the certificate | Public API, since 2015 (WebKit bug 135327) | The default check rejects the self-signed certificate: the app doesn't load |
| Setting the delegate again makes WebKit see the added method | Observed | Same: the app doesn't load |
| Workers, pthread workers and loads inside workers get challenges too | Observed (E4.4) | Same: the engine fails |
| Every new TLS connection is challenged, no approval carries over to another certificate | Observed (E4.3) | **A rogue server would be trusted** |
| The default check rejects a self-signed certificate for `127.0.0.1` | System trust evaluation | Matters only if WebKit also skipped our method (WebKit bug 158877) |

All but one of these fail closed. The tests below watch the one that doesn't.

## Tests

- Unit test of the pin decision (Rust): the pinned leaf is accepted, other leaves are cancelled, other hosts, ports
  and methods get default handling.
- Startup smoke test of the macOS app in CI, started with an explicit `--smoke-test`. It requires the engine ready,
  `crossOriginIsolated`, and the hook added with `respondedBefore=false`.
- Attack test: a wrong pin at start loads nothing. A server swapped mid-session, with another certificate, gets no
  request, while the page starts imports, workers and an engine. The test-only switches (release the port on request)
  exist only under a cargo feature for tests.
- The smoke and attack tests also run in the iOS simulator (main and nightly). A weekly run on the newest macOS image
  catches WebKit updates. A real iPhone is checked by hand before each TestFlight build.

## Development

`pnpm dev` keeps the Vite dev server (`http://localhost:9002`), which sends COOP and COEP and is isolated over
loopback HTTP (E3). Debug builds grant the `host` command to that origin as well; release builds only to
`https://127.0.0.1:47823`.
