# dashql-slack

The Slack app of DashQL: a Cloudflare Worker that turns embed links (`/embed?file=…`, `?zip=…`, `#script=…`) into
Work Objects whose side panel loads the embed. How it works, the Slack settings and what to look at when nothing
shows: `docs/design/slack_app.md`. The embed itself: `docs/wip/embeds.md`.

The Worker keeps no state. Every unfurl is a function of the link, the secrets are there because Slack takes an
unfurl only as a call with the bot token of the app, not as the answer to its event.

## Channels

One Worker and one Slack app per channel, all on `slack.dashql.app`:

| Channel | Worker | Request URL | Unfurls and embeds |
|---------|--------|-------------|--------------------|
| dev | `dashql-slack-dev` | `https://slack.dashql.app/dev/events` | `dev.dashql.app` |
| stable | `dashql-slack-stable` | `https://slack.dashql.app/stable/events` | `stable.dashql.app` |
| latest | `dashql-slack-latest` | `https://slack.dashql.app/latest/events` | `dashql.app` |

`GET /<channel>/health` answers `ok`.

## Events

- `link_shared` → `chat.unfurl` with one entity per embed link of the channel's origin, `full_size_preview` without
  a URL. Links to other hosts or paths are left alone.
- `entity_details_requested` → `entity.presentDetails` with the same entity and `preview_url` set to the link.

Every request is checked with the signing secret and a 5-minute window. The Worker answers 200 at once and calls
Slack in `waitUntil`; a retry of Slack (`X-Slack-Retry-Num`) is answered without a second call. Failed calls to Slack
are logged, see them with `wrangler tail --env <channel>` or in Workers Observability.

## Setting up a channel

1. The route needs a proxied DNS record for `slack.dashql.app` (once): `AAAA slack 100::`, proxied.
2. `wrangler deploy --env <channel>` in this folder.
3. Create the Slack app from `manifests/<channel>.yaml` (api.slack.com/apps → Create New App → From a manifest) and
   install it in the workspace.
4. `wrangler secret put SLACK_SIGNING_SECRET --env <channel>` (Basic Information → App Credentials → Signing
   Secret) and `wrangler secret put SLACK_BOT_TOKEN --env <channel>` (OAuth & Permissions → Bot User OAuth Token).
5. If the app was created before the Worker had its secrets, verify the request URL again under Event
   Subscriptions.

For `wrangler dev`, put the secrets in `.dev.vars`, which git ignores.

## Tests

`bazel test //packages/dashql-slack:all`: the type check against the WebWorker lib, and the Worker in Node with a
fake Slack API.
