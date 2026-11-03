# Content Security Policy of the app

The app forbids inline scripts and evaluated code everywhere, and allows WebAssembly compilation only where
Wasm runs. This document lists where each policy comes from, how they combine, and what code has to respect.

## Where the policies come from

| Source | Covers | Defined in |
|--------|--------|------------|
| `<meta http-equiv="Content-Security-Policy">` | the html entry page that carries it | `packages/dashql-app/*.html` |
| `Content-Security-Policy` header on `/static/js/*` | workers on Cloudflare Pages | `packages/dashql-app/_headers` |
| `Content-Security-Policy` header on every response | pages and workers in Electron | `packages/dashql-native/src/app_protocol.ts` |

A document enforces every policy it receives, the `<meta>` one and the header one. A request is allowed
only if all of them allow it, so a page can narrow the Electron header but never widen it.

A worker does not see the `<meta>` policy of the page that starts it. A worker loaded from a URL takes the
policy of its own script response, and without one it runs unrestricted. A worker or an iframe created from
a `blob:` URL or `srcdoc` inherits the policy of its creator. An iframe loaded from a URL takes its own.

The policy header on `/static/js/*` reaches more than workers. A page ignores the policy header of a script
that it loads as `<script>` or `import`, so the header only takes effect when the script starts a worker.

## Pages

| Page | `script-src` | Loads Wasm |
|------|--------------|------------|
| `index.html` | `'wasm-unsafe-eval' 'self'` + Cloudflare Insights | yes |
| `shell.html` | `'wasm-unsafe-eval' 'self'` + Cloudflare Insights | yes |
| `demos.html` | `'wasm-unsafe-eval' 'self'` + Cloudflare Insights | yes |
| `oauth.html` | `'self'` + Cloudflare Insights | no |
| `tests.html` | `'wasm-unsafe-eval' 'self'` | yes |
| `tests-frame.html` | no policy | yes |
| `hyperdb-capability.html` | no policy | |

Every policy sets `default-src 'self'`. `connect-src`, `worker-src` and `frame-src` follow what each page
talks to, read them in the files.

## Workers

| Worker | Script | Needs |
|--------|--------|-------|
| core batch worker | `batch_worker.js` of `dashql-core-js`, a module worker | `'wasm-unsafe-eval'` |
| HyperDB worker | `hyperdb_worker_bridge.js`, imports the `hyperdb-wasm` worker script into its own scope | `'wasm-unsafe-eval'`, `blob:` scripts (the engine), `blob:` fetches (mounted files) |

The `_headers` policy of `/static/js/*` and the Electron header grant both:
`script-src 'self' 'wasm-unsafe-eval' blob:`, `worker-src 'self' blob:`, and a `connect-src` that
includes `blob:` and remote origins.

## `'wasm-unsafe-eval'`

It allows `WebAssembly.compile`, `instantiate`, `compileStreaming`, `instantiateStreaming` and
`new WebAssembly.Module`. Without it (or the wider `'unsafe-eval'`), all of them throw, even for a module
from `'self'`. CSP has no hash or source list for Wasm, the keyword is the only switch.

It does not evaluate JavaScript strings. An attacker would need to feed their own bytes into a compile
call, and the module reaches only the imports that the page hands it.

A page carries it in `script-src` only when its bundle loads a Wasm module. In `default-src` it does
nothing, `script-src` overrides it there.

## Rules for code

- **No inline scripts.** Every script of an html page is a file. The dev server injects the React Refresh
  preamble inline, so the pages it serves allow `'unsafe-inline'`, a build never does.
- **No evaluated code.** No `eval`, `new Function`, or string timers, in the app and in what it depends on
  at runtime. The Arrow builders (`vectorFromArray`, `tableFromArrays` of plain arrays, `makeBuilder`)
  compile their null check with `new Function`. App code assembles vectors from their buffers with
  `packages/dashql-app/src/utils/arrow_vectors.ts` instead.
- **A test for eval-free code** runs it with `forbidEval` (`src/tests/forbid_eval.ts`), which makes
  `Function` throw like the policy does.

## Build checks

`packages/dashql-app/vite.config.tpl.ts` fails a build when a page breaks the rules above:

- `dashql-inline-scripts`: an inline script, or `'unsafe-inline'` in `script-src`.
- `dashql-wasm-compilation`: `'wasm-unsafe-eval'` in `default-src`, a page that allows it but loads no Wasm,
  or a page that loads Wasm without allowing it. A page loads Wasm when its entry chunk, or a chunk that it
  imports statically or dynamically, references a `.wasm` asset (or a precompressed `.wasm.<hash>.br`).
  Pages without a policy are skipped.

## Tests

The static server of the browser tests (`packages/dashql-app/test/browser_test_driver.mjs`) applies the
`_headers` of the bundle, so the workers in the tests run under the worker policy of Pages.

The test frame has no policy yet, so code under test can still evaluate strings there. About 50 test
files build their Arrow fixtures with the builders. Once they use `arrow_vectors.ts`, the frame can take
the policy of `tests.html`.

## Electron

The renderer is served by the custom `app:` protocol, and the protocol handler adds the same header to
every response. Because of that, the header has to allow everything that any page or worker needs. The
`<meta>` policy of each page then narrows it, as above. For example, the OAuth page cannot compile Wasm in
Electron either, its `<meta>` policy does not allow it.
