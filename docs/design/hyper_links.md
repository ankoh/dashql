# Hyper links

A Hyper link points DashQL at a Hyper that speaks the HTTP v3 API: new sessions, and with them their scripts and
composer prompts, run on it. Compute (data frames, visualizations) and the monitoring databases stay in the embedded
HyperDB WASM. The main producer is `hyperd run --ui`, which opens DashQL against the hyperd on the machine, but a link
may also name a remote HTTP v3 server.

hyperd is not part of this repository. The first half of this document is the contract that hyperd implements, the
second half describes the app.

## Link format

A Hyper link is an app event, like the links of shared sessions: the query parameter `data` holds the base64url
encoding (without padding) of the UTF-8 JSON

```json
{"hyperLink": {"endpoint": "http://127.0.0.1:7484", "token": "<token>"}}
```

(`proto/json/dashql/app_event.json`). The same payload works for the browser and the native app:

```
https://dashql.app/?data=<base64url>
dashql://localhost?data=<base64url>
```

- `endpoint` is the base url of the HTTP v3 API. An endpoint on this machine (`127.0.0.1`, `localhost`, `[::1]`) may
  use `http:` and applies right away. Any other endpoint must use `https:`, and the user confirms its host first: the
  server receives the queries of the new sessions.
- `token` is sent as bearer token. The app never stores it durably.
- Pasting a link into the app works like opening it.

## hyperd contract

### Flags

| Flag | Meaning |
|---|---|
| `--ui [port]` | Listen for the HTTP v3 API on `127.0.0.1:<port>` and print the DashQL links. Without a port, `7484`, and a free port if it is taken |
| `--ui-app-url <url>` | The app that the browser link opens, `https://dashql.app` by default. For dev servers and pinned builds |

The fixed default port matters: the app recognizes the connection of a link by its endpoint, a rerun on the same port
finds its connection silently, a run on another port asks whether to reuse it.

### Output

```
hyperd: listening for DashQL on http://127.0.0.1:7484
DashQL (browser): https://dashql.app/?data=<base64url>
DashQL (app):     dashql://localhost?data=<base64url>
```

`token` is generated for every run: at least 128 random bits, url-safe.

### Requests

- **Endpoints**: the HTTP v3 API of `docs/misc/salesforce_v3_http.md` under `/api/v3`, with Arrow content negotiation,
  chunks, rows and cancel. The query status is returned in the `x-hyperdb-status` response header.
- **Authentication**: every `/api/v3/*` request carries `Authorization: Bearer <token>`, others are refused with `401`.
  Preflight `OPTIONS` requests carry no credentials and are exempt.
- **Host check**: requests whose `Host` is neither `127.0.0.1:<port>` nor `localhost:<port>` are refused, against DNS
  rebinding.
- **Log**: `hyper_log()` is queryable on the listener, i.e. hyperd runs with
  `experimental_hyper_introspection_functions`, and with `log_resource_usage_interval` for the resource samples. The
  connection overview polls the log from a watermark into the monitoring database of the connection, which lives in the
  embedded Hyper. Without the log the connection works, its monitor stays unavailable.

### CORS

dashql.app is a public origin that calls a loopback address, the browser sends a preflight for every request.

| Response header | Value |
|---|---|
| `Access-Control-Allow-Origin` | the origin of the app url, `https://dashql.app` by default |
| `Access-Control-Allow-Methods` | `GET, POST, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `authorization, content-type, accept, x-hyperdb-workload, x-hyperdb-external-client-context, x-hyperdb-adaptive-timeout` |
| `Access-Control-Expose-Headers` | `x-hyperdb-status` |
| `Access-Control-Allow-Private-Network` | `true`, when the preflight carries `Access-Control-Request-Private-Network: true` |
| `Access-Control-Max-Age` | e.g. `600` |

### Native app

The native app sends its requests through its main process, they are not subject to CORS or the browser's local
network rules. The token and the host check apply as for the browser.

### Browsers

Chrome and Firefox let an `https` page call `http://127.0.0.1`. Chrome may ask the user once to allow access to the
local network. Safari blocks the request as mixed content, local hyperd links do not support it.

## App

The connection to the Hyper of a link is an ordinary Hyper connection with the protocol `V3_HTTP_LINK`: it is stored in
the app manifest and in the sessions like every connection, with its endpoint, and its catalog and monitoring database
live in its connection folder. Only the token is not stored. There can be several such connections, e.g. to two
hyperd.

- **Receiving**: the app event of a link arrives like every app event, from the address of the page, from the native
  app, or pasted (`PlatformEventListener.dispatchAppEvent`). The listener keeps the latest link until `useHyperLinks`
  (`app/hyper_link/hyper_links.ts`) subscribes.
- **Following**: once the app opened its first session, `useHyperLinks`
  1. confirms the host of a link to another machine, unless a connection to it exists (`confirmHyperLink`),
  2. binds the link to a connection (`bindHyperLink`): the connection to the endpoint of the link, otherwise the user
     may reuse the connection of the latest link, which is saved with the new endpoint, otherwise a new connection,
  3. remembers the token of the connection in the session storage of the tab and makes it the connection of new
     sessions (`setHyperLinkToken`), a reload keeps both and closing the tab ends them,
  4. opens the open session if it runs on the connection, otherwise the first session on it, otherwise a new one.
- **Connecting**: `V3_HTTP_LINK` connects like `V3_HTTP` (`setupHyperConnection`) with the token of the tab as
  `authorization` header (`hyperLinkChannelParams`). Without a token the setup asks to open the link again. The
  connection of an open session connects right away, as the embedded Hyper does, and again for every new link
  (`useInitialMemorySetup`).
- **New sessions**: `newSessionConnection` (`app/connections/embedded_connection.ts`) starts new sessions on the
  connection of the latest link of the tab, otherwise on the embedded Hyper. A session has a single default
  connection, so the composer prompt and new scripts run on it. Detaching the connection falls back to the embedded
  Hyper. Sessions that existed before keep their default connection.
- **Compute and monitoring**: query results arrive as Arrow and are computed on in the embedded Hyper. The monitoring
  database of the connection lives in the embedded Hyper as for every remote Hyper, see `HyperLogMetrics`.

## Manual test

1. Build a hyperd that implements the contract, start it with `hyperd run --ui --ui-app-url <dev server> ...`.
2. Open the printed browser link: a session on hyperd opens and its queries run. Open the printed app link with the
   native app closed and while it runs: the app opens a session on hyperd. Paste the link into the app: the same.
3. The connection overview shows the queries of hyperd.
4. Reload: new sessions still start on hyperd.
5. Open the app in a new tab without the link: new sessions start on the embedded Hyper, the hyperd connection is
   listed and does not connect.
6. Restart hyperd on the same port and open its new link: the sessions run on it without a question. Start it on
   another port: the app asks whether to reuse the connection, declining creates a second one.
7. Open a link to an https endpoint of another machine: the app asks before using it.
