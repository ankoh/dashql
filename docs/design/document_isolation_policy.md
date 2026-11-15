# Document-Isolation-Policy

The embedded Hyper needs `SharedArrayBuffer` for its threads, and a browser exposes it only to a document that is
cross-origin isolated. COOP and COEP isolate a top-level page. `Document-Isolation-Policy` (DIP) isolates a single
document, wherever it is embedded. This document says what DIP is, which headers the app sends, what was measured, and
what it means for embedding the engine in other hosts such as Slack and MCP Apps.

## How the two mechanisms work

Isolation exists because of Spectre: a shared buffer gives a precise timer, and a precise timer can read any memory of
its process. A browser exposes the buffer only when nothing of another site can end up in that process.

- **COOP + COEP** guarantee it for the whole page. COOP `same-origin` separates the top-level page from its popups,
  COEP makes every subresource and every frame opt in. A frame is isolated only if every page above it is, so a page
  inside an iframe of a site without these headers is never isolated, whatever it sends itself.
- **DIP** guarantees it with a process. The browser puts the document into its own agent cluster and its own process,
  dedicated workers inherit the isolation from their creator, and subresources follow the same rule as COEP
  (`isolate-and-require-corp`: no-cors cross-origin responses need `Cross-Origin-Resource-Policy`,
  `isolate-and-credentialless`: they are fetched without credentials). The embedder, the subframes and popups don't
  matter. An isolated document has no synchronous access to same-origin documents that are not isolated, and a
  `SharedArrayBuffer` cannot be posted to them. When the browser cannot afford the process, `crossOriginIsolated`
  stays false, so code has to check it at runtime (`hyperdb_web_support.ts` already does).

## Browser support

| Browser | DIP |
|---------|-----|
| Chrome, Edge desktop | since 137 |
| Chrome Android | announced for M146, including devices below 2 GB of RAM |
| Android WebView | not planned, it has no process isolation |
| Firefox | positive position (2026-08), not implemented in 159 |
| Safari | portability concern resolved (2026-09), only the venue concern is left: DIP should move into Fetch and HTML; the engine is blocked there anyway, WebKit has no memory64 |

DIP is proposed for Interop 2027. Sources: the
[Chrome blog post](https://developer.chrome.com/blog/document-isolation-policy), the
[explainer](https://github.com/explainers-by-googlers/document-isolation-policy/), the
[WebKit position](https://github.com/WebKit/standards-positions/issues/399), the
[Mozilla position](https://github.com/mozilla/standards-positions/issues/1074).

## Headers of the app

Every response of the Pages deployment and of the Vite dev server carries all three:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Document-Isolation-Policy: isolate-and-require-corp
```

Defined in `packages/dashql-app/_headers` and `packages/dashql-app/vite.config.tpl.ts`.

- At the top level nothing changes: COOP and COEP isolate the page in every browser, and DIP applies the same
  subresource rule as COEP, so nothing that loads today stops loading.
- In an iframe of another site, Chromium isolates the page through DIP, and the engine starts. Firefox ignores the
  header, so there the framed app stays without the engine, as before.
- COOP and COEP stay. Without them Firefox would lose isolation at the top level, and choosing headers per browser
  needs a Pages Function. The popup of the OAuth flow, which COOP separates from the app, already works through a
  `BroadcastChannel` (see [oauth_salesforce.md](oauth_salesforce.md)).
- The Electron app keeps COOP and COEP only (`packages/dashql-native/src/app_protocol.ts`). Its pages are always
  top-level, no site embeds them.

No document sets `frame-ancestors` or `X-Frame-Options`, so any site can frame the app. That was the case before DIP;
DIP only makes the framed app work.

## Measurements

A host page on `localhost` without isolation headers embedded a probe page and the browser example of `hyperdb-wasm`
on `127.0.0.1`, a different site. The probe reports `crossOriginIsolated`, the Wasm features of the engine (memory64,
table64, exnref, threads), a shared memory64 of 1 GiB, a `SharedArrayBuffer` passed to workers from a URL and from a
`blob:` URL, and OPFS. The engine page boots the engine and runs
`select count(*), sum(v) from generate_series(1, 5000000) as s(v)`. Measured 2026-11-15 with Chrome for Testing 158
(headless, Playwright, third-party storage partitioning on), Firefox 159, `hyperdb-wasm` 0.0.27367.

| Embedding (Chrome 158) | DIP | COOP + COEP | COOP + COEP + DIP | none |
|------------------------|-----|-------------|-------------------|------|
| top-level page | engine runs | engine runs | engine runs | no isolation |
| iframe | engine runs | no isolation | engine runs | no isolation |
| `sandbox="allow-scripts allow-same-origin"` | engine runs | no isolation | engine runs | no isolation |
| proxy origin → `srcdoc` view → iframe, like MCP Apps | engine runs | no isolation | engine runs | no isolation |
| `sandbox="allow-scripts"` | isolated, engine fails | no isolation | isolated, engine fails | no isolation |

Both values of DIP behave the same. The engine is ready after about 0.5 s and the query finishes after about 0.9 s in
every case where it runs. In Firefox only the top-level page with COOP and COEP is isolated, DIP changes nothing.

What the probe shows beyond the table:

- **A sandbox without `allow-same-origin`** gives the document an opaque origin. DIP still isolates it:
  `SharedArrayBuffer`, Atomics and a 1 GiB shared memory64 work, and a worker from a `blob:` URL receives a shared
  buffer. But `new Worker(url)` throws `SecurityError`, since no URL is same-origin with an opaque origin, and OPFS
  is denied in a sandboxed context. The engine fails at the first: its client starts the worker from a URL, and the
  Emscripten pthreads start from the URL of the engine script (`new Worker(_scriptName)`). Its storage would fail
  at the second, the engine mounts OPFS under `/mnt/fs`.
- **Storage is partitioned.** A framed page gets an OPFS of its own per top-level site, empty at first, not the OPFS of
  `dashql.app`. Playwright turns partitioning off by default (`--disable-features=ThirdPartyStoragePartitioning`),
  which hides this, so measure with the browser's default flags.

## Embedding the engine in other hosts

The table decides it: a host works when it loads a page of our server, without a sandbox or with
`allow-same-origin`, and does not block framing it with its CSP.

### Slack

A Work Objects embed loads an HTTPS URL of the app in an iframe of the flexpane. By default the iframe has the sandbox
`allow-scripts` and an opaque origin, and the app settings of a Slack app can enable `allow-same-origin`
([Work Objects embeds](https://docs.slack.dev/messaging/work-objects-embeds)).

- **With `allow-same-origin`** the embed is the third row of the table: the engine runs as it is, with an OPFS
  partitioned under Slack. This is the path. The page does not need cookies: data arrives through the URL, a
  pre-signed snapshot, or a fetch with an `Authorization` header.
- **With the default sandbox** the engine needs changes in `hyperdb-wasm`, all inside the package:
  - Start the engine worker from a `blob:` URL instead of a URL. The worker and the engine read their settings from
    the search parameters of `self.location.href` today; a `blob:` URL has none, so they have to take them from a
    global set by the bootstrap or from the first message.
  - Start the pthreads from that same blob. Emscripten starts them from `_scriptName`, the URL the engine was loaded
    from, so the engine source has to be part of the blob instead of an `importScripts` of a URL.
  - Run without OPFS: an in-memory file system for `/mnt/fs` and the logs, nothing survives a reload.
  - Load cross-origin. From an opaque origin every request to the app is cross-origin: fetches need
    `Access-Control-Allow-Origin` (sent), `importScripts` and other no-cors loads need
    `Cross-Origin-Resource-Policy: cross-origin` under `isolate-and-require-corp`, or the page uses
    `isolate-and-credentialless`.

  Measured with a patched copy of `hyperdb-wasm` 0.0.27367 in the sandbox without `allow-same-origin` (Chrome 158,
  both values of DIP): the worker script of the package as one `blob:` with `self.HYPERDB_WASM_ENGINE_URL` set in
  front of it, the query that the client appends to the worker URL dropped, and the `FS.mount(runtime.OPFS, …)` of
  `/mnt/fs` removed, so `/mnt/fs` stays in the default in-memory file system. The engine starts in about 0.4 s, the
  pthreads start from that blob (`blob:null/…`), the query over 5M rows and a temporary table of 1M rows run, and a
  `File` mounted at `/mnt/external/att.csv` reads with `external()`. What the package would have to offer instead of
  the patch: a worker that takes its settings from a global or its first message, and a root in memory instead of
  OPFS. Not available there: `COPY … TO`, Hyper copies only into registered targets, which are OPFS directories.
- Not measured in Slack itself: the Electron version of the desktop client, the mobile clients, and whether the
  flexpane sets an `allow` attribute that withholds anything.

### MCP Apps

The view of an MCP App is HTML that the host injects into a sandboxed iframe of a proxy origin, so it cannot carry a
response header. A nested iframe from the server of the app can (fourth row of the table), if the CSP of the view
allows framing that origin. Claude.ai and ChatGPT are not measured.
