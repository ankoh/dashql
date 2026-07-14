//! The `account.dashql.app` human surface: Sign in with Apple + API-key management.
//!
//! Server-rendered HTML, no client JS. Flow:
//!   GET  /                      -> login button, or (if session) the key dashboard
//!   POST /auth/apple/callback   -> verify Apple id_token, set session cookie, redirect to /
//!   POST /keys                  -> mint a key (session + allowlist gated); show it once
//!   POST /keys/revoke           -> revoke a key by hash (ownership-checked)

use worker::*;

use crate::apple;
use crate::keys::{self, KeyRecord};
use crate::session;

/// Build the account router. Shared data is the `Env` (for secrets/vars/KV access).
pub fn router() -> Router<'static, ()> {
    Router::new()
        .get_async("/", |req, ctx| async move { index(req, ctx).await })
        .get_async("/auth/apple/login", |_req, ctx| async move { apple_login(ctx).await })
        .post_async("/auth/apple/callback", |req, ctx| async move {
            apple_callback(req, ctx).await
        })
        .post_async("/keys", |req, ctx| async move { create_key(req, ctx).await })
        .post_async("/keys/revoke", |req, ctx| async move { revoke(req, ctx).await })
}

// ---- helpers --------------------------------------------------------------------------

/// Read + verify the session cookie from the request, if any.
fn current_session(req: &Request, env: &Env) -> Option<session::Session> {
    let secret = env.secret("SESSION_SECRET").ok()?.to_string();
    let cookie_header = req.headers().get("Cookie").ok().flatten()?;
    let value = session::from_cookie_header(&cookie_header)?;
    session::verify(&secret, value, Date::now().as_millis())
}

fn html(body: String) -> Result<Response> {
    let mut resp = Response::from_html(body)?;
    resp.headers_mut().set("Content-Type", "text/html; charset=utf-8")?;
    Ok(resp)
}

/// Minimal HTML escape for interpolated user-controlled strings (email).
fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

// ---- handlers -------------------------------------------------------------------------

async fn index(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    match current_session(&req, &ctx.env) {
        None => html(page(
            "Sign in",
            r#"<h1>dashql AI</h1>
               <p>Sign in to manage your API keys.</p>
               <form method="GET" action="/auth/apple/login">
                 <button type="submit">Sign in with Apple</button>
               </form>"#
                .to_string(),
        )),
        Some(sess) => dashboard_page(&ctx.env, &sess).await,
    }
}

/// Render the signed-in dashboard: allowlist status + existing keys (or the not-authorized
/// message).
async fn dashboard_page(env: &Env, sess: &session::Session) -> Result<Response> {
    let allowed = keys::is_email_allowed(env, &sess.email).await;
    let mut body = format!("<h1>dashql AI</h1><p>Signed in as <strong>{}</strong></p>", esc(&sess.email));

    if !allowed {
        body.push_str(
            "<p class=\"error\">Your Apple account isn't authorized to create API keys. \
             Contact the admin.</p>",
        );
        return html(page("Not authorized", body));
    }

    // The reset cadence is deployment-wide, so state it once rather than per key.
    let window = keys::humanize_window(keys::quota_window_secs(env));
    let key_list = keys::list_keys(env, &sess.apple_sub).await?;
    body.push_str(&format!("<h2>Your API keys</h2><p>Quotas reset every {window}.</p>"));
    if key_list.is_empty() {
        body.push_str("<p>No keys yet.</p>");
    } else {
        body.push_str("<ul>");
        for k in &key_list {
            // Live usage for the current window (best-effort; 0/0 if the counters are absent).
            let (reqs_used, neuron_micros) = keys::window_usage(env, &k.hash).await?;
            let neurons_used = keys::neurons_from_micros(neuron_micros);
            body.push_str(&format!(
                "<li><code>{}…</code> · {} / {} req · {} / {} neurons \
                 <form method=\"POST\" action=\"/keys/revoke\" style=\"display:inline\">\
                 <input type=\"hidden\" name=\"hash\" value=\"{}\">\
                 <button type=\"submit\">Revoke</button></form></li>",
                &k.hash[..k.hash.len().min(12)],
                reqs_used,
                k.request_limit,
                neurons_used,
                k.neuron_limit,
                esc(&k.hash),
            ));
        }
        body.push_str("</ul>");
    }
    body.push_str(
        "<form method=\"POST\" action=\"/keys\"><button type=\"submit\">Create API key</button></form>",
    );
    html(page("Your keys", body))
}

/// Redirect the browser to Apple's authorize endpoint.
async fn apple_login(ctx: RouteContext<()>) -> Result<Response> {
    let service_id = ctx.env.var("APPLE_SERVICE_ID")?.to_string();
    let origin = ctx.env.var("ACCOUNT_ORIGIN")?.to_string();
    let redirect_uri = format!("{}/auth/apple/callback", origin.trim_end_matches('/'));
    let url = apple::authorize_url(&service_id, &redirect_uri);
    Response::redirect(Url::parse(&url)?)
}

async fn apple_callback(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let form = req.form_data().await?;
    let id_token = match form.get("id_token") {
        Some(FormEntry::Field(t)) => t,
        _ => return Ok(Response::error("Missing id_token", 400)?),
    };

    let service_id = ctx.env.var("APPLE_SERVICE_ID")?.to_string();
    let identity = match apple::verify_id_token(&id_token, &service_id, Date::now().as_millis()).await {
        Ok(id) => id,
        Err(e) => {
            console_error!("Apple id_token verification failed: {e}");
            return Ok(Response::error("Sign-in verification failed", 401)?);
        }
    };

    let secret = ctx.env.secret("SESSION_SECRET")?.to_string();
    let cookie = session::issue(&secret, &identity.sub, &identity.email, Date::now().as_millis());

    // Redirect back to the dashboard with the session cookie set.
    let headers = Headers::new();
    headers.set("Location", "/")?;
    headers.set("Set-Cookie", &session::set_cookie(&cookie))?;
    Ok(Response::empty()?.with_status(303).with_headers(headers))
}

async fn create_key(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let sess = match current_session(&req, &ctx.env) {
        Some(s) => s,
        None => return Ok(Response::error("Not signed in", 401)?),
    };
    if !keys::is_email_allowed(&ctx.env, &sess.email).await {
        return Ok(Response::error("Not authorized to create keys", 403)?);
    }

    // Per-key budgets; the reset cadence (window) is deployment-wide, not stored on the key.
    let request_limit = keys::env_num(&ctx.env, "REQUEST_LIMIT", keys::DEFAULT_REQUEST_LIMIT);
    let neuron_limit = keys::env_num(&ctx.env, "NEURON_LIMIT", keys::DEFAULT_NEURON_LIMIT);

    let key = keys::generate_key()?;
    let record = KeyRecord {
        apple_sub: sess.apple_sub.clone(),
        email: sess.email.clone(),
        created_at: Date::now().as_millis(),
        request_limit,
        neuron_limit,
    };
    keys::store_key(&ctx.env, &key, &record).await?;

    // Show the plaintext key exactly once, along with its budgets.
    let window = keys::humanize_window(keys::quota_window_secs(&ctx.env));
    let body = format!(
        "<h1>dashql AI</h1><h2>New API key</h2>\
         <p>Copy this now — it won't be shown again:</p>\
         <pre class=\"key\">{}</pre>\
         <p>Budget: <strong>{request_limit} requests</strong> and \
         <strong>{neuron_limit} neurons</strong> per {window}.</p>\
         <p>Set it in dashql AI settings as header <code>Authorization: Bearer &lt;key&gt;</code>, \
         with Endpoint URL <code>https://ai.dashql.app</code>.</p>\
         <p><a href=\"/\">Back to keys</a></p>",
        esc(&key),
    );
    html(page("New key", body))
}

async fn revoke(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let sess = match current_session(&req, &ctx.env) {
        Some(s) => s,
        None => return Ok(Response::error("Not signed in", 401)?),
    };
    let form = req.form_data().await?;
    let hash = match form.get("hash") {
        Some(FormEntry::Field(h)) => h,
        _ => return Ok(Response::error("Missing hash", 400)?),
    };
    keys::revoke_key(&ctx.env, &sess.apple_sub, &hash).await?;

    let headers = Headers::new();
    headers.set("Location", "/")?;
    Ok(Response::empty()?.with_status(303).with_headers(headers))
}

/// Wrap body content in a minimal styled HTML document.
fn page(title: &str, body: String) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{title} · dashql AI</title>\
         <style>body{{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}}\
         button{{padding:.5rem 1rem;font-size:1rem;cursor:pointer}}\
         code,pre{{background:#f4f4f5;padding:.15rem .35rem;border-radius:4px}}\
         pre.key{{padding:1rem;overflow-x:auto;word-break:break-all;white-space:pre-wrap}}\
         .error{{color:#b91c1c}}li{{margin:.5rem 0}}</style></head>\
         <body>{body}</body></html>"
    )
}
