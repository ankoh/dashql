# Embeds

Status: a probe is built, the views are planned. This document fixes the shape of the page that other applications
frame, the embed, with two modes: DashQL for data files and workbooks, and Hyper, a shell scoped to Hyper. The first
host is the side panel of a Slack Work Object, the same page fits notebooks, docs, MCP Apps and extensions later.
Why a framed page can run the embedded Hyper at all: [document_isolation_policy.md](../design/document_isolation_policy.md).

## The probe

`embed.html` (`src/embed/embed.ts`, no React) is a probe for testing Document-Isolation-Policy in the Slack clients.
It lists what the frame got (origin, whether it is framed, `crossOriginIsolated`, `SharedArrayBuffer`, OPFS), then
parses `select count(*), sum(v) from generate_series(1, 5000000)` with the core in its batch worker and runs it in
the embedded Hyper in its worker, and shows each step as ok or failed with its time. The page test `embed` of
`browser_page_tests.mjs` checks it at the top level.

Both workers start from `blob:` URLs and keep nothing in OPFS, so the probe works without an origin (case 2 below):

- Hyper: `HyperDB.create({ worker: 'blob', storage: 'memory', … })` of `hyperdb-wasm` (since 0.0.27368). The package
  fetches its worker and engine scripts with CORS, joins them into one classic `blob:` worker that also starts the
  pthreads, and keeps `/mnt/fs` in memory.
- Core: `@ankoh/dashql-core/batch-worker?worker&url` gives the URL of the bundled batch worker, a classic `blob:`
  worker `import()`s it and queues the messages that arrive before. In an opaque origin a module worker from a
  `blob:` URL does not start at all, even an empty one, and `importScripts` can't load an ES module.

Measured 2026-11-15 with Chrome for Testing (Playwright 1.65, headless): the bundle on `127.0.0.1` with the headers of
`_headers`, framed by a host page on `localhost` without isolation headers. Both steps pass at the top level, in an
iframe, in `sandbox="allow-scripts allow-same-origin"` and in `sandbox="allow-scripts"` (origin `null`, OPFS denied):
the core in about 0.16 s, Hyper with its startup in about 0.8 s.

## Two modes, one entry

| | DashQL mode | Hyper mode |
|---|---|---|
| Entry | `embed.html`, served as `/embed` | the same |
| Links use | `https://dashql.app/embed?…` | `https://hyperdb.sh/embed#…` |
| For | anyone who wants to look at data: a schema, rows, a chart | people who write SQL: a script, its results, the plan |
| Modes | data file, workbook | script |
| Built from | `packages/dashql-runtime`, `views/query_result`, `views/visualization` (Vega-Lite) | the shell (`src/shell`, `src/shell_app`): terminal, file mounts, `#script=` sharing, plan and format dialogs |

Both domains serve the same Pages deployment, so `/embed` exists on both. The domain only tells people which product
a link belongs to, the parameters pick the mode: `#script=` is the Hyper mode, anything else the DashQL mode.

The two overlap on files on purpose: the DashQL mode shows a file, the Hyper mode queries it. A link to a data file
opens the DashQL mode; a script that reads a file opens the Hyper mode.

## Why a separate entry

Framing `index.html` boots the whole app in a storage partition of the host: it migrates an empty storage, shows an
empty workbook list, and offers logins whose popups the host's sandbox blocks. None of the user's workbooks or
connections are there. An embed entry instead

- boots only the core, the embedded Hyper and the views it shows, no OAuth, workbook storage, feed or cloud setup,
- takes all of its input from its URL and keeps nothing it needs across reloads,
- carries its own `frame-ancestors`, so the embed is framable by the hosts we choose while `index.html` can be
  limited to `frame-ancestors 'self'` (today no other page restricts framing),
- stays small: one line in `rolldownOptions.input` of `vite.config.tpl.ts`, next to `shell` and `demos`.

## URL contract

Every input is in the URL, and every input is untrusted.

DashQL mode:

| Mode | Parameters |
|------|------------|
| data file | `file=<https URL>`, optional `format=parquet\|csv\|arrow\|hyper` (else from the extension and the bytes), optional `sql=<base64url>`, the query whose result the view shows instead of the first rows |
| workbook | `zip=<base64url>` as in the links of the app (`workbook_tables.md`), or `workbook=<URL>` of a hosted workbook folder; optional `script=<position>` |

Hyper mode, in the fragment so that scripts never reach a server log, like the shell's sharing:

| Parameter | Meaning |
|-----------|---------|
| `script=<payload>` | the script, in the format of `shell_share.ts` |
| `file=<https URL>` | a file mounted before the script runs, repeatable, mounted under its file name |

The embed fetches files with CORS from the browser of the viewer: the file never passes through a server of ours, and
its host must send `Access-Control-Allow-Origin`. Pre-signed URLs work. A file the host doesn't serve with CORS can't
be opened. Proxying it through a server of ours is the documented alternative, not a default.

## What runs where

A Slack Work Object has a link preview, which our server computes when a link is posted, and a side panel, which
loads the embed in the viewer's client.

| | Server (the Slack app, Node, `hyperdb-edge`) | Embed (the viewer's browser) |
|---|---|---|
| Data file | schema, row count, size, a few rows, a chart rendered to an image | schema, paged rows, a chart, a SQL box |
| Workbook | name, scripts, connections, the first cached result | the cached results, one script at a time, running self-contained workbooks |
| Hyper script | the script, whether it parses, the first result | the terminal with the script, run, plan, format |

The server can't run on Cloudflare Workers: Hyper needs threads and about 0.85 GB. It needs Node 24.15+ (or Node 24
with the flag that `hyperdb-edge` sets), so AWS Lambda, Vercel Functions or a container.

## Running in the embed

The embed checks what it got before it loads anything (`getHyperDBWebSupportError`):

1. **Isolated, with an origin** (Chromium 137+ with DIP; the Slack embed with `allow-same-origin`): the embedded Hyper
   starts, OPFS is available as a cache of its partition. Measured in the stand-ins of
   [document_isolation_policy.md](../design/document_isolation_policy.md).
2. **Isolated, opaque origin** (a sandbox without `allow-same-origin`, Slack's default): no storage at all, no OPFS,
   IndexedDB or `localStorage`, and no worker from a URL. The engine runs from one `blob:` worker with an in-memory
   root (`worker: 'blob'`, `storage: 'memory'` of `hyperdb-wasm`); attachments mount as `File`s. The core batch
   worker starts from a `blob:` URL as well, see the probe. What the embed still needs: its own state in memory.
3. **Not isolated** (Firefox, Safari, an Electron below Chromium 137): no engine. The workbook mode still shows cached
   results, everything else shows what the link carries and says that the view needs Chrome or Edge.

The way out of the embed is the entity `url` of the Work Object, which the host shows as a link in its own chrome.
It points to the full app (`dashql.app/?zip=…`, `hyperdb.sh/shell#script=…`), which isolates itself at the top level
in Firefox too. A button in the embed can't be relied on: the sandbox of the Slack embed has no `allow-popups` or
`allow-top-navigation`.

The engine download (`hyperdb-wasm.wasm.br`, about 12 MB) is cached by the browser per top-level site, so the first
side panel in a host downloads it once.

What the embed doesn't do: log in to connections. A workbook whose scripts need Trino, a Hyper server or Data Cloud
shows its cached results, and running it is left to the full app.

## Headers

The embed gets the global headers (COOP, COEP, DIP) and a rule of its own in `_headers` for `/embed` and
`/embed.html` (built): a `Content-Security-Policy` with `frame-ancestors` that lists `'self'` and the hosts (for
Slack: `https://*.slack.com https://*.slack-gov.com https://*.slack-mcps.com https://slack-mcps-host.com`).
`frame-ancestors` has no effect in a `<meta>` policy, it has to be the header. The policy of the page itself stays in
its `<meta>` tag like the other entries (`app_csp.md`), with `connect-src https:` for the files.

## Slack

One Slack app serves both modes. Its settings list `dashql.app` and `hyperdb.sh` as unfurl domains and in the embed
allow list, with `allow-same-origin` on.

| Object | `entity_type` | `external_ref.type` | `full_size_preview.preview_url` |
|--------|---------------|---------------------|---------------------------------|
| data file | `slack#/entities/file` | `data_file` | `https://dashql.app/embed?file=…` |
| workbook | `slack#/entities/content_item` | `workbook` | `https://dashql.app/embed?zip=…` |
| Hyper script | `slack#/entities/item` | `hyper_script` | `https://hyperdb.sh/embed#script=…` |

Slack sends `link_shared` only for links on the app's own domains. A link to a Parquet file on S3 or Hugging Face
reaches the app only as a `dashql.app/embed?file=` link, so the app offers the ways to make one: a slash command
(`/dashql <URL>`, `/hyper <SQL or URL>`) and a message shortcut on a message with a link. Files uploaded to Slack
need `files:read` and come later.

Slack's obligations for embeds apply: validate every parameter, render every value as text, keep tokens in URLs
short-lived (Slack recommends 10 minutes at most).

## Form factor

The side panel is narrow, its width isn't documented. The views are one column:

- data file: schema → rows → one chart → SQL box,
- workbook: one script at a time with its result or chart, a stack of cards, not the workbench,
- Hyper script: the terminal at the width of the panel.

## Order

1. The DashQL mode for data files. It is useful alone, needs no credentials, and tests DIP in the real
   Slack clients (desktop, browser, Android).
2. The Hyper mode with `script=` and `file=`.
3. The workbook mode with cached results, which runs in every client.
4. Running self-contained workbooks in the embed.
5. Published workbooks of a cloud as Work Objects, with Slack's list of conversations as the discussion of a version.

## Open

- The width of the side panel, and whether it can be widened.
- The Chromium version of the Slack desktop client, and whether its flexpane frame gets its own process.
- The `allow` attribute of the Slack embed frame.
- Whether the MCP Apps hosts let a view frame `dashql.app` and `hyperdb.sh`.
- Where the Slack app runs.
