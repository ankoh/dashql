//! dashql-cloud — one Cloudflare Worker exposing an OpenAI-compatible SLM gateway on
//! `ai.dashql.app` and a Sign-in-with-Apple account dashboard on `account.dashql.app`.
//!
//! The `fetch` entrypoint branches on the request host first (see [`Surface`]), then
//! delegates to a per-surface router. See `docs/wip/account.md` for the full design.

use worker::*;

mod ai;
mod apple;
mod dashboard;
mod keys;
mod session;

/// Which front door a request hit, decided by hostname.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Surface {
    /// Machine API: `/v1/models`, `/v1/chat/completions`.
    Api,
    /// Human dashboard: `/`, `/auth/apple/callback`, `/keys`.
    Account,
}

/// Classify the request host into a [`Surface`].
///
/// `account.*` hosts map to the dashboard; everything else — including `ai.*` and local
/// dev hosts (`localhost`, `127.0.0.1`) — maps to the API, so the `wrangler dev` curl
/// checks in the design doc exercise the API surface without extra host juggling.
fn classify_host(host: &str) -> Surface {
    if host.starts_with("account.") {
        Surface::Account
    } else {
        Surface::Api
    }
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let host = req.url()?.host_str().unwrap_or_default().to_string();
    match classify_host(&host) {
        Surface::Api => ai::router().run(req, env).await,
        Surface::Account => dashboard::router().run(req, env).await,
    }
}
