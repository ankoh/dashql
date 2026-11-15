# dashql-mcp

The MCP server of DashQL: a Cloudflare Worker with one tool, `probe_embed`, an MCP App whose view frames the embed
(`/embed`) of the channel's app. It tests whether a host such as ChatGPT can run the embedded Hyper: the view shows its
own origin, whether it is isolated, the `frameDomains` the host granted and its user agent, and the embed below it
reports the engine and its query. Why the engine needs the embed's frame: `docs/design/document_isolation_policy.md`,
the embed: `docs/wip/embeds.md`.

The server is stateless: Streamable HTTP with JSON responses and no session, no authentication, no data.

## Channels

| Channel | Worker | MCP URL | Embed |
|---------|--------|---------|-------|
| dev | `dashql-mcp-dev` | `https://mcp.dashql.app/dev/mcp` | `https://dev.dashql.app/embed` |
| stable | `dashql-mcp-stable` | `https://mcp.dashql.app/stable/mcp` | `https://stable.dashql.app/embed` |
| latest | `dashql-mcp-latest` | `https://mcp.dashql.app/latest/mcp` | `https://dashql.app/embed` |

The view may frame the embed because the resource declares the app's origin in `_meta.ui.csp.frameDomains`; ChatGPT
allows only origins of the MCP server's registrable domain, `dashql.app`. The embed allows the host in its
`frame-ancestors` (`packages/dashql-app/_headers`): the deployment of the channel's app needs that rule and the
Document-Isolation-Policy header, or the frame stays empty.

## Setting up a channel

1. The route needs a proxied DNS record for `mcp.dashql.app` (once): `AAAA mcp 100::`, proxied.
2. `wrangler deploy --env <channel>` in this folder.

## Trying it in ChatGPT

In ChatGPT on the web in Chrome: Settings → Apps & Connectors → Advanced → Developer mode, then add a connector with
the MCP URL of the channel and no authentication, and ask ChatGPT to run the DashQL embed probe. The engine runs only in
Chromium; the macOS app of ChatGPT probably renders views in WebKit.

The first run shows the view's origin, the sandbox host of ChatGPT. Narrow `https://*.web-sandbox.oaiusercontent.com` in
the embed's `frame-ancestors` to it, and set `_meta.ui.domain` once a host needs a fixed one.

## Tests

`bazel test //packages/dashql-mcp:all`: the type check against the WebWorker lib, and the Worker in Node with the client
of the MCP SDK.
