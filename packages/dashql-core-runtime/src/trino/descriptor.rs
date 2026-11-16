//! What the Trino connector says about its params and queries: the login hint, the signature of
//! cached results and the limits of the executor.
//!
//! The default params, the draft rows and the catalog name defaults are in `connections`.

use serde_json::{json, Value};

use crate::connections::{trino_session_defaults, JsonObject};

/// The queries that run on a Trino connection at the same time
pub const MAX_CONCURRENT_QUERIES: usize = 1;
/// Does the catalog of a Trino connection outlive the app? It is saved and restored.
pub const CATALOG_IS_DURABLE: bool = true;
/// Does a Trino connection read the attachments of a workbook? It doesn't.
pub const READS_ATTACHMENTS: bool = false;

/// The login hint of the params: the user of basic auth, none if it is empty
pub fn login_hint(params: &JsonObject) -> Option<String> {
    params
        .get("auth")
        .and_then(|auth| auth.pointer("/basic/username"))
        .and_then(Value::as_str)
        .filter(|username| !username.is_empty())
        .map(str::to_string)
}

/// The params that identify the results of a query in the query result cache. The results of a user are the user's,
/// row-level security may show another user other rows: the user of basic auth is part of the signature, a new token
/// of the same login reuses the cached results. The principal behind an OAuth token is unknown to the params, those
/// results are keyed by the identity provider and the client. The defaults resolve the names that statements leave
/// out, the catalogs only decide what the catalog loader reads. Missing fields are left out like `JSON.stringify`
/// leaves out `undefined`.
pub fn cache_signature(params: &JsonObject) -> Value {
    let auth = params.get("auth");
    let field = |pointer: &str| auth.and_then(|auth| auth.pointer(pointer)).cloned();
    let mut auth_signature = JsonObject::new();
    for (key, pointer) in [
        ("authType", "/authType"),
        ("oauthAuthUrl", "/oauth/authorizationUrl"),
        ("oauthTokenUrl", "/oauth/tokenUrl"),
        ("oauthRedirectUrl", "/oauth/callbackUrl"),
        ("oauthClientId", "/oauth/clientId"),
        ("oauthScopes", "/oauth/scopes"),
    ] {
        if let Some(value) = field(pointer) {
            auth_signature.insert(key.into(), value);
        }
    }
    if let Some(user) = login_hint(params) {
        auth_signature.insert("user".into(), Value::String(user));
    }
    let defaults = trino_session_defaults(params);
    let mut signature = JsonObject::new();
    signature.insert("case".into(), json!("trino"));
    if let Some(endpoint) = params.get("endpoint") {
        signature.insert("endpoint".into(), endpoint.clone());
    }
    signature.insert("auth".into(), Value::Object(auth_signature));
    signature.insert("defaults".into(), json!({ "catalog": defaults.catalog, "schema": defaults.schema }));
    Value::Object(signature)
}
