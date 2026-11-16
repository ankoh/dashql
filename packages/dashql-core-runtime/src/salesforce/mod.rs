//! The Salesforce connector: the REST APIs of the setup and the metadata (`api`), the OAuth flow with PKCE (`auth`),
//! the setup of a connection as a state machine (`setup`) and the binding of the Data 360 client functions
//! (`client_functions`). Sans-IO: the functions build requests and read responses, the host sends them. The actions of
//! the setup on the connection state are `connections::SalesforceAction`.
//!
//! Ported from `connections/salesforce/` of `packages/dashql/src/runtime`, without the catalog update.

pub mod api;
pub mod auth;
pub mod client_functions;
pub mod setup;
pub mod types;

use serde_json::{json, Value};

use crate::connections::{ConnectorType, JsonObject};

pub use api::{SalesforceError, SalesforceMetadataLoad};
pub use auth::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, OAuthState};
pub use client_functions::{resolve_salesforce_client_function_host, salesforce_client_function_variables};
pub use setup::{SalesforceSetup, SalesforceSetupOutput, SalesforceSetupStep};
pub use types::*;

/// The params that a shared link or file carries: the instance, the connected app and, if asked for, the login hint.
/// The secret of the connected app never leaves.
pub fn sanitize_params_for_sharing(params: &JsonObject, with_login_hint: bool) -> JsonObject {
    let mut out = params.clone();
    out.insert("appConsumerSecret".to_string(), json!(""));
    if !with_login_hint {
        out.insert("login".to_string(), json!(""));
    }
    out
}

/// The login hint of the params, none if empty
pub fn login_hint(params: &JsonObject) -> Option<&str> {
    params.get("login").and_then(Value::as_str).filter(|l| !l.is_empty())
}

/// What a cached query result of a connection depends on. The login stays out, another user of the same org reuses
/// the cached results. Missing fields are left out like `JSON.stringify` leaves out `undefined`.
pub fn cache_signature(connector: ConnectorType, params: &JsonObject) -> Value {
    let mut signature = JsonObject::new();
    signature.insert("case".into(), json!(if connector == ConnectorType::Dbcom { "dbcom" } else { "salesforce" }));
    for key in ["instanceUrl", "appConsumerKey"] {
        if let Some(value) = params.get(key) {
            signature.insert(key.into(), value.clone());
        }
    }
    if connector == ConnectorType::Dbcom {
        signature.insert("databaseName".into(), json!(SalesforceConnectionParams::from_object(params).hyper_cloud_database()));
    }
    Value::Object(signature)
}
