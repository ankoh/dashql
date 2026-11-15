# Embeds

Status: planned, nothing is built. This document fixes the shape of two pages that other applications frame: the
DashQL embed for data files and workbooks, and the Hyper embed, a shell scoped to Hyper. The first host is the
side panel of a Slack Work Object, the same pages fit notebooks, docs, MCP Apps and extensions later.
Why a framed page can run the embedded Hyper at all: [document_isolation_policy.md](../design/document_isolation_policy.md).

## Two embeds

| | DashQL embed | Hyper embed |
|---|---|---|
| Entry | `embed.html`, served as `/embed` | `shell-embed.html`, served as `/shell-embed` |
| Links use | `https://dashql.app/embed?…` | `https://hyperdb.sh/shell-embed#…` |
| For | anyone who wants to look at data: a schema, rows, a chart | people who write SQL: a script, its results, the plan |
| Modes | data file, workbook | script |
| Built from | `packages/dashql-runtime`, `views/query_result`, `views/visualization` (Vega-Lite) | the shell (`src/shell`, `src/shell_app`): terminal, file mounts, `#script=` sharing, plan and format dialogs |

Both domains serve the same Pages deployment, so both paths exist on both. The domain only tells people which product
a link belongs to. Separate paths on one domain would work as well.

The two overlap on files on purpose: the DashQL embed shows a file, the Hyper embed queries it. A link to a data file
opens the DashQL embed; a script that reads a file opens the Hyper embed.

## Why separate entries

Framing `index.html` boots the whole app in a storage partition of the host: it migrates an empty storage, shows an
empty workbook list, and offers logins whose popups the host's sandbox blocks. None of the user's workbooks or
connections are there. An embed entry instead

- boots only the core, the embedded Hyper and the views it shows, no OAuth, workbook storage, feed or cloud setup,
- takes all of its input from its URL and keeps nothing it needs across reloads,
- carries its own `frame-ancestors`, so the embeds are framable by the hosts we choose while `index.html` can be
  limited to `frame-ancestors 'self'` (today no page restricts framing),
- stays small: one more line in `rolldownOptions.input` of `vite.config.tpl.ts`, next to `shell` and `demos`.

## URL contract

Every input is in the URL, and every input is untrusted.

DashQL embed:

| Mode | Parameters |
|------|------------|
| data file | `file=<https URL>`, optional `format=parquet\|csv\|arrow\|hyper` (else from the extension and the bytes), optional `sql=<base64url>`, the query whose result the view shows instead of the first rows |
| workbook | `zip=<base64url>` as in the links of the app (`workbook_tables.md`), or `workbook=<URL>` of a hosted workbook folder; optional `script=<position>` |

Hyper embed, in the fragment so that scripts never reach a server log, like the shell's sharing:

| Parameter | Meaning |
|-----------|---------|
| `script=<payload>` | the script, in the format of `shell_share.ts` |
| `file=<https URL>` | a file mounted before the script runs, repeatable, mounted under its file name |

The embeds fetch files with CORS from the browser of the viewer: the file never passes through a server of ours, and
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
2. **Isolated, opaque origin** (a sandbox without `allow-same-origin`, Slack's default): the engine can't start until
   `hyperdb-wasm` starts its worker and pthreads from one `blob:` URL and runs without OPFS (the list is in
   `document_isolation_policy.md`). Until then: as 3.
3. **Not isolated** (Firefox, Safari, an Electron below Chromium 137): no engine. The workbook mode still shows cached
   results, everything else shows what the link carries and says that the view needs Chrome or Edge.

The way out of the embed is the entity `url` of the Work Object, which the host shows as a link in its own chrome.
It points to the full app (`dashql.app/?zip=…`, `hyperdb.sh/shell#script=…`), which isolates itself at the top level
in Firefox too. A button in the embed can't be relied on: the sandbox of the Slack embed has no `allow-popups` or
`allow-top-navigation`.

The engine download (`hyperdb-wasm.wasm.br`, about 12 MB) is cached by the browser per top-level site, so the first
side panel in a host downloads it once.

What the embeds don't do: log in to connections. A workbook whose scripts need Trino, a Hyper server or Data Cloud
shows its cached results, and running it is left to the full app.

## Headers

The embeds get the global headers (COOP, COEP, DIP) and a rule of their own in `_headers` for `/embed`,
`/embed.html`, `/shell-embed` and `/shell-embed.html`: a `Content-Security-Policy` with `frame-ancestors` that lists
the hosts (for Slack: `https://*.slack.com https://*.slack-gov.com https://*.slack-mcps.com https://slack-mcps-host.com`).
`frame-ancestors` has no effect in a `<meta>` policy, it has to be the header. The policy of the page itself stays in
its `<meta>` tag like the other entries (`app_csp.md`), with `connect-src https:` for the files.

## Slack

One Slack app serves both embeds. Its settings list `dashql.app` and `hyperdb.sh` as unfurl domains and in the embed
allow list, with `allow-same-origin` on.

| Object | `entity_type` | `external_ref.type` | `full_size_preview.preview_url` |
|--------|---------------|---------------------|---------------------------------|
| data file | `slack#/entities/file` | `data_file` | `https://dashql.app/embed?file=…` |
| workbook | `slack#/entities/content_item` | `workbook` | `https://dashql.app/embed?zip=…` |
| Hyper script | `slack#/entities/item` | `hyper_script` | `https://hyperdb.sh/shell-embed#script=…` |

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

1. The DashQL embed with the data file mode. It is useful alone, needs no credentials, and tests DIP in the real
   Slack clients (desktop, browser, Android).
2. The Hyper embed with `script=` and `file=`.
3. The workbook mode with cached results, which runs in every client.
4. Running self-contained workbooks in the embed.
5. Published workbooks of a cloud as Work Objects, with Slack's list of conversations as the discussion of a version.

## Open

- The width of the side panel, and whether it can be widened.
- The Chromium version of the Slack desktop client, and whether its flexpane frame gets its own process.
- The `allow` attribute of the Slack embed frame.
- Whether the MCP Apps hosts let a view frame `dashql.app` and `hyperdb.sh`.
- Where the Slack app runs.
