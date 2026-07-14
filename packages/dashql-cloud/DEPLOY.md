# Deploying dashql-cloud

These steps require credentials/resources only you have: a Cloudflare account with **Workers
AI** enabled, `dashql.app` as a **zone** on that account, and an **Apple Developer** account.

> **Run every `wrangler` command from `packages/dashql-cloud/`.** wrangler discovers
> `wrangler.jsonc` in the current directory, and that's the only copy in the repo — running from
> the repo root (or anywhere else) means it finds no config and fails with errors like
> *"No KV namespaces are configured"* or *"Missing entry-point"*. Either `cd packages/dashql-cloud`
> first, or pass `--config packages/dashql-cloud/wrangler.jsonc` on each command.

## 1. Cloudflare login

```sh
npx wrangler login
```

## 2. Create KV namespaces, paste ids into wrangler.jsonc

```sh
npx wrangler kv namespace create DASHQL_CLOUD_API_KEYS
npx wrangler kv namespace create DASHQL_CLOUD_API_KEY_USAGE
npx wrangler kv namespace create DASHQL_CLOUD_ACCOUNTS
```

Each prints an `id`. Paste them into the matching `kv_namespaces` entries in `wrangler.jsonc`
(replace any `REPLACE_WITH_…_NAMESPACE_ID` placeholder). `DASHQL_CLOUD_ACCOUNTS` holds the
allowlist (see "Managing the allowlist" below).

## 3. Session secret

```sh
# Use any high-entropy value, e.g. `openssl rand -base64 48`.
npx wrangler secret put SESSION_SECRET
```

## 4. Apple: create the Services ID (Sign in with Apple, web)

In the Apple Developer portal → Certificates, Identifiers & Profiles → Identifiers:

1. Create a **Services ID** (e.g. `app.dashql.account`). This value is `APPLE_SERVICE_ID` in
   `wrangler.jsonc` and the JWT `aud` we verify.
2. Enable **Sign in with Apple**, attach it to your primary App ID.
3. Under **Website URLs**, register:
   - Domain: `account.dashql.app`
   - Return URL: `https://account.dashql.app/auth/apple/callback`

No domain-verification file and no private key are needed for the `form_post` id_token flow.

## 5. Set vars

In `wrangler.jsonc` `vars`:
- `APPLE_SERVICE_ID` — the Services ID from step 4.
- `ACCOUNT_ORIGIN` — `https://account.dashql.app`.
- `REQUEST_LIMIT` — per-key request budget per window (default 500). Baked onto each key at
  creation, so editing it only affects keys minted afterwards.
- `NEURON_LIMIT` — per-key neuron budget per window (default 10000). Neurons are Cloudflare's
  GPU-compute unit and the thing that burns the 10k-neuron/day free tier; each request's cost
  is derived from its token counts via a fixed per-model rate. Also baked onto each key.
- `QUOTA_WINDOW_SECS` — reset cadence in seconds (default 18000 = 5h). Deployment-wide and
  read fresh per request, so redeploying with a new value re-buckets every key at once.
  Because usage counters are keyed by an absolute window-start timestamp, the new window's
  counters never collide with the old value's — the stale ones just TTL away.
- `AI_GATEWAY_ID` — name of the AI Gateway to route inference through (default `dashql`, set
  up in step 6). When non-empty, `/v1/chat/completions` calls Workers AI *via* this gateway;
  set it to `""` to call Workers AI directly and disable the gateway. See step 6 for why.

## 6. AI Gateway (global rate-limit circuit breaker)

The per-key `REQUEST_LIMIT`/`NEURON_LIMIT` quota (step 5) is our precise, per-user spend
control. The AI Gateway is the complementary **account-wide** backstop: one global ceiling that
still fires if a key leaks, the KV usage counter fails open, or a bug lets traffic past the
per-key logic. It's what Workers AI itself lacks — there's no native account-level hard spend
cap on `@cf/` models (pay-as-you-go past the free neuron allocation), so this rate limit is the
closest thing to a "stop everything" switch.

Use a **request-count sliding-window rate limit**, not the gateway's dollar `spend_limits`:
Workers AI (`@cf/…`) is billed in neurons through Workers AI pricing — *not* the Unified Billing
dollars `spend_limits` counts — and the docs don't confirm cost limits fire for `@cf/` models.
Request-count limiting is billing-agnostic, so it works regardless. Precise neuron spend is
already handled per-key in `keys.rs`.

There is **no `wrangler` command** for AI Gateway — create it in the dashboard (**AI → AI
Gateway → Create Gateway**, name it `dashql`) or via the REST API (needs a token with *AI
Gateway Read + Edit*):

```sh
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai-gateway/gateways" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "dashql",
    "cache_invalidate_on_update": false,
    "cache_ttl": 0,
    "collect_logs": true,
    "rate_limiting_interval": 60,
    "rate_limiting_limit": 100,
    "rate_limiting_technique": "sliding"
  }'
```

`interval`/`limit` define the window (here 100 requests / 60 s); `sliding` makes it a continuous
trailing window rather than a bucket that resets on a clock boundary. Over the limit → the
gateway returns **429** before the request reaches Workers AI. Size it *above* aggregate
expected traffic — it's a global ceiling shared by every key, so setting it near normal peak
would 429 legitimate users during bursts. The gateway id here must match `AI_GATEWAY_ID`
(step 5); the Worker's `ai.rs` passes it as the `{ gateway: { id } }` option on each `AI.run`.
Tune the limit (and optionally enable caching / logs) later from the gateway's dashboard.

## 7. Deploy

```sh
npx wrangler deploy
```

`wrangler` runs `worker-build` (installing it on first run), compiles the crate to WASM,
`wasm-opt`s it, and publishes to both `ai.dashql.app` and `account.dashql.app` custom
domains. Ensure the two custom-domain routes resolve (they attach automatically because
`dashql.app` is a zone on the account).

## 8. Verify end-to-end

First seed your own email into the allowlist (see "Managing the allowlist" below), otherwise
every account is denied:

```sh
npx wrangler kv key put --remote --binding DASHQL_CLOUD_ACCOUNTS "me@icloud.com" '{"enabled":true}'
```

- **Login:** open `https://account.dashql.app/`, Sign in with Apple.
  - Allowlisted account → "Create API key" works; copy the shown key.
  - Non-allowlisted account → "not authorized" message, no key.
- **API:** in dashql AI settings, set Endpoint URL `https://ai.dashql.app`, Model an enabled
  `@cf/…` id, add header `Authorization: Bearer <key>`; click **Test** (→ "Reachable"), then
  run an agent action.
- **Quota:** repeat requests past `REQUEST_LIMIT`, or run enough tokens to exceed
  `NEURON_LIMIT`, within one window → HTTP 429 (the message says which budget was hit); both
  counters reset at the next `QUOTA_WINDOW_SECS` boundary. The dashboard shows live
  requests/neurons used per key for the current window.
- **Gateway:** after a request or two, the `dashql` gateway's dashboard (AI → AI Gateway) shows
  the traffic — confirming inference is routed through it. The global rate limit trips at
  `rate_limiting_limit` requests per window (a plain 429 from the gateway, distinct from the
  quota 429's typed error body).

## Managing the allowlist

The allowlist lives in the `DASHQL_CLOUD_ACCOUNTS` KV namespace — one entry per email, so it's
edited with `wrangler kv key` commands and takes effect immediately, no redeploy. The email is
the key (lowercased); the value is `{ "enabled": bool, "added_at": epoch_millis }`, and a bare
`{}` counts as enabled. **No entry means not allowed** — the gate fails closed.

```sh
# Allow an email (seed at least one before the verify step below):
npx wrangler kv key put --remote --binding DASHQL_CLOUD_ACCOUNTS "me@icloud.com" '{"enabled":true}'

# Suspend without deleting (keeps the entry; flips them back with "enabled":true):
npx wrangler kv key put --remote --binding DASHQL_CLOUD_ACCOUNTS "me@icloud.com" '{"enabled":false}'

# Remove entirely:
npx wrangler kv key delete --remote --binding DASHQL_CLOUD_ACCOUNTS "me@icloud.com"

# List / inspect:
npx wrangler kv key list --remote --binding DASHQL_CLOUD_ACCOUNTS
npx wrangler kv key get  --remote --binding DASHQL_CLOUD_ACCOUNTS "me@icloud.com"
```

Note: `--remote` targets the deployed Cloudflare KV namespace (what the live Worker reads).
Without it, `wrangler kv key` operates on the *local* Miniflare store used by `wrangler dev`, so
your changes wouldn't reach production. Allowlist by the exact email Apple returns — if you use
Hide My Email, that's the private-relay address, not your real one.
