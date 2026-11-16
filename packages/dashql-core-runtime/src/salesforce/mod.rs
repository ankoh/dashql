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

/// The login hint of the params, none if empty
pub fn login_hint(params: &JsonObject) -> Option<&str> {
    params.get("login").and_then(Value::as_str).filter(|l| !l.is_empty())
}

/// What a cached query result of a connection depends on. The results of a user are the user's, sharing rules may show
/// another user of the same org other rows: the login is part of the signature, the setup sets it to the user that
/// logged in. Missing fields are left out like `JSON.stringify` leaves out `undefined`.
pub fn cache_signature(connector: ConnectorType, params: &JsonObject) -> Value {
    let mut signature = JsonObject::new();
    signature.insert("case".into(), json!(if connector == ConnectorType::Dbcom { "dbcom" } else { "salesforce" }));
    for key in ["instanceUrl", "appConsumerKey"] {
        if let Some(value) = params.get(key) {
            signature.insert(key.into(), value.clone());
        }
    }
    if let Some(login) = login_hint(params) {
        signature.insert("login".into(), json!(login));
    }
    if connector == ConnectorType::Dbcom {
        signature.insert("databaseName".into(), json!(SalesforceConnectionParams::from_object(params).hyper_cloud_database()));
    }
    Value::Object(signature)
}
