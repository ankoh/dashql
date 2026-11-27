# dashql-slack

The Slack app of DashQL: a Cloudflare Worker that turns embed links (`/embed?file=…`, `?zip=…`, `#script=…`) into
Work Objects whose side panel loads the embed. The channels, the events, the checks, the secrets, the order of the
setup and what to look at when nothing shows: `docs/design/slack_app.md`. The embed itself: `docs/wip/embeds.md`.

Deploy a channel with `wrangler deploy --env <channel>` in this folder. For `wrangler dev`, put the secrets in
`.dev.vars`, which git ignores.

## Tests

`bazel test //packages/dashql-slack:all`: the type check against the WebWorker lib, and the Worker in Node with a
fake Slack API.
