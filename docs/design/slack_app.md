# The Slack app

A link to the embed (`/embed`, see [embeds.md](../wip/embeds.md)) posted in Slack becomes a Work Object: a card in the
message, and a side panel that frames the embed when someone clicks the card. This document says which parts take
part, what each one does, how they are configured, and what to look at when something doesn't show.

Status: built and deployed for dev, stable and latest. In the dev workspace a posted `https://dev.dashql.app/embed`
unfurls as a Work Object, and the probe in the side panel runs the core and the embedded Hyper through
Document-Isolation-Policy (2026-11-15).

## The parts

| Part | Where | What it does |
|------|-------|--------------|
| The embed | Cloudflare Pages: `dev.dashql.app`, `stable.dashql.app`, `dashql.app` | Serves `/embed` with `frame-ancestors` for Slack and DIP, runs the core and Hyper in the viewer's client |
| The Worker | Cloudflare Workers: `slack.dashql.app/<channel>/*`, code in `packages/dashql-slack` | Receives Slack's events, answers them with calls to Slack's API |
| The Slack app | api.slack.com, one per channel, manifests in `packages/dashql-slack/manifests/` | Registers the unfurl domain, the events, the entity types and the embed allow list, holds the bot token |

One channel is one embed origin, one Worker and one Slack app:

| Channel | Embed origin | Worker | Request URL | Slack app |
|---------|--------------|--------|-------------|-----------|
| dev | `https://dev.dashql.app` | `dashql-slack-dev` | `https://slack.dashql.app/dev/events` | DashQL Dev |
| stable | `https://stable.dashql.app` | `dashql-slack-stable` | `https://slack.dashql.app/stable/events` | DashQL Stable |
| latest | `https://dashql.app` | `dashql-slack-latest` | `https://slack.dashql.app/latest/events` | DashQL |

A Slack app has one request URL, so it can't serve two Workers, and a Worker on its own path keeps its own signing
secret: Slack's `url_verification` request carries no app id, so a shared path would have to try every secret.

## The flow

```
user posts https://dev.dashql.app/embed?file=…
  Slack ── link_shared ──────────────▶ Worker ── 200 (body ignored)
  Worker ── chat.unfurl (bot token) ─▶ Slack       entity, full_size_preview without a URL
  Slack shows the card

user clicks the card
  Slack ── entity_details_requested ─▶ Worker ── 200
  Worker ── entity.presentDetails ───▶ Slack       same entity, preview_url = the link
  Slack opens the side panel and frames the preview_url in a sandboxed iframe
  the embed checks crossOriginIsolated, starts the core and Hyper from blob: workers
```

Slack never takes an unfurl as the answer to its event: the body of the answer is ignored, except for the challenge
of `url_verification`. The unfurl is a separate call to `chat.unfurl` with the bot token of the app, and the side
panel one to `entity.presentDetails` with the `trigger_id` of the event. That is the only reason for a server: there
is nothing to authenticate on our side, every answer is a function of the link, but something has to run code and
hold the token. A static Pages deployment can't.

The Worker answers every event with 200 at once and makes the call in `waitUntil`. Slack expects the answer within
3 seconds, and the `trigger_id` expires after a few, so the call starts right away.

## Why a Worker

The Worker keeps no state: no database, no KV, no sessions. Unfurling a link needs only the link. The engine runs in
the side panel, in the viewer's client, not on the server.

What a Worker can't do is run Hyper: it has 128 MB and no threads, Hyper needs threads and about 0.85 GB. The previews
of the server that [embeds.md](../wip/embeds.md) lists (schema, a few rows, a chart image in the card) would need a
Node service on Lambda, Vercel Functions or a container, which the Worker would call. They are not built, the card
shows what the link carries.

Socket Mode, where the app keeps a WebSocket to Slack instead of receiving POSTs, needs a process that stays up, and
doesn't fit a Worker. The apps use HTTP events.

## The entities

`src/entity.ts` reads a link and builds its entity. A link counts only if its origin is the origin of the channel and
its path is `/embed` or `/embed.html`; everything else in a message is left alone.

| Link | `external_ref.type` | `entity_type` | Title |
|------|---------------------|---------------|-------|
| `#script=…` | `hyper_script` | `slack#/entities/item` | Hyper script |
| `?file=<https URL>` | `data_file` | `slack#/entities/file` | the last segment of the file's path, else its host |
| `?zip=…`, `?workbook=…` | `workbook` | `slack#/entities/content_item` | Workbook |
| none of these | `embed` | `slack#/entities/file` | DashQL embed |

- `external_ref.id` is the first 128 bits of the SHA-256 of the normalized link. Slack matches the entity of
  `entity.presentDetails` to the card by it (`entity_metadata_does_not_match_trigger` otherwise), and the same link
  always gives the same id without storing anything.
- `url` is the link itself, the way out of the side panel into a top-level tab.
- `product_name` is DashQL, `display_type` says the kind. A data file adds `custom_fields` for its host and format.
- `full_size_preview` is `{is_supported: true, mime_type: "application/vnd.slack-embed"}` in the unfurl, and gets
  `preview_url` only in `entity.presentDetails`. It sits inside `attributes`.
- `chat.unfurl` names the message by `unfurl_id` and `source` when the event has them (links still in the composer
  too), else by `channel` and `ts`. One call carries one entity per distinct embed link of the message.

The content is public: no tokens are in the links, so Slack's rule of short-lived tokens in preview URLs doesn't apply
yet. A link to a private file would need a signed URL, at most 10 minutes long.

## Checks of the Worker

- The signature: HMAC-SHA256 of `v0:<timestamp>:<body>` with the signing secret, compared in constant time, and the
  timestamp within 5 minutes. A Worker without its secret rejects everything with 401.
- Only `POST /<channel>/events` and `GET /<channel>/health`, bodies up to 64 KB.
- A retry of Slack (`X-Slack-Retry-Num`) gets 200 without a second call: the first one may already have unfurled.
- A data file must be an `https` URL, `format` one of `parquet`, `csv`, `arrow`, `hyper`, titles are cut at 120
  characters. Slack renders every value as text.
- Failed calls to Slack (`ok: false`) are logged with their error. The answer to Slack stays 200.

## Slack settings

From `manifests/<channel>.yaml`:

| Manifest key | Value | Why |
|--------------|-------|-----|
| `features.unfurl_domains` | the embed host | Slack sends `link_shared` only for these domains |
| `features.rich_previews.is_active` | `true` | Work Object Previews on |
| `features.rich_previews.entity_types` | file, content_item, item | the types the Worker sends, others are refused |
| `features.rich_previews.domain_allowlist` | the embed host | Slack loads no embed until this list is set, and drops a `preview_url` outside it. `*.x` matches one level and not `x` itself |
| `features.rich_previews.allow_same_origin` | `true` | the embed keeps its origin and gets OPFS in its partition; without it the origin is `null` and the probe still works (memory root, `blob:` workers) |
| `oauth_config.scopes.bot` | `links:read`, `links:write` | `link_shared` and `chat.unfurl`; `entity.presentDetails` needs no scope |
| `settings.event_subscriptions` | the request URL, `link_shared`, `entity_details_requested` | |
| `settings.socket_mode_enabled` | `false` | HTTP events |

The app is not distributed: an app used in its own workspace gets embeds without applying to Slack. A Marketplace app
would need Slack's invitation.

### Secrets

Each Worker has two secrets, set with `wrangler secret put <name> --env <channel>` in `packages/dashql-slack`:

| Secret | From | Looks like |
|--------|------|------------|
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials → Signing Secret | 32 hex characters |
| `SLACK_BOT_TOKEN` | OAuth & Permissions → Bot User OAuth Token, after installing | `xoxb-…` |

Not the Client Secret or the Verification Token, not a `xoxp-` or `xapp-` token. Secrets survive deploys and are not
in `wrangler.jsonc`; local runs of `wrangler dev` read `.dev.vars`, which git ignores.

### Order of the setup

1. The DNS record of `slack.dashql.app`, once: `AAAA slack 100::`, proxied. Routes of Workers need a proxied record,
   and wrangler's login can read zones but not edit DNS.
2. `wrangler deploy --env <channel>`.
3. `SLACK_SIGNING_SECRET`. Slack verifies the request URL when the manifest is saved, and the Worker answers the
   challenge only with a valid signature.
4. The manifest: Create New App → From a manifest, or App Manifest of an existing app.
5. Install, or reinstall after the scopes changed. Then `SLACK_BOT_TOKEN`, again if the reinstall gave a new one.

## When nothing shows

`wrangler tail --env <channel> --format json` shows every request with its headers; Workers Observability keeps the
logs. The size of a body tells the event apart: Slack's `url_verification` is about 130 bytes, the events are around
1 KB.

| What the log shows | Cause |
|--------------------|-------|
| nothing when a link is posted | the app wasn't reinstalled after the manifest added `links:read`, or the unfurl domain or the events aren't saved. Seen on 2026-11-15: only the verification arrived until the settings of the app were fixed |
| 401 | wrong or missing signing secret |
| 200, a logged `chat.unfurl: <error>` | the bot token is wrong (`invalid_auth`) or the payload is refused (`invalid_metadata`) |
| 200, no error, a card without a side panel | the embed host is missing in `domain_allowlist` (Slack drops the preview), or the entity type isn't enabled |
| the side panel stays blank | the embed lacks `frame-ancestors` for Slack: the Pages deployment of the channel is older than the `_headers` rule |
| the probe says not isolated | a client without DIP (Firefox, Safari, an old desktop client), see [document_isolation_policy.md](document_isolation_policy.md) |

On the machine that runs the setup, `slack.dashql.app` may not resolve for up to 30 minutes after the record is
created if it was looked up before: the zone lets resolvers cache the negative answer that long. Slack resolves
through public DNS and isn't affected.

## Deploys

From `packages/dashql-slack`, logged in with `wrangler login`: `wrangler deploy --env dev | stable | latest`. The
three Workers run the same code with different `vars` (`CHANNEL`, `APP_ORIGIN`). CI doesn't deploy them yet.

Tests: `bazel test //packages/dashql-slack:all`, the type check against the WebWorker lib and the events against a
fake Slack API in Node, which has the same `Request`, `Response`, `fetch` and Web Crypto as Workers.

## Open

- stable.dashql.app and dashql.app serve the embed without the `frame-ancestors` rule until their next Pages publish;
  their cards show, their side panels stay blank.
- `hyperdb.sh` is no unfurl domain yet; the Hyper mode needs it in the manifest of latest.
- Deploying the Workers from `publish.yml`, with a token that may deploy Workers.
- The previews of the server, on Node.
- Links to files uploaded to Slack (`files:read`), and the slash command and message shortcut that make an embed link
  out of any file URL.
