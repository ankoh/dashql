//! The Salesforce connector: the REST APIs of the setup and the metadata (`api`), the OAuth flow with PKCE (`auth`), the
//! channel of a connection with its tokens (`shared`) and the binding of the Data 360 client functions
//! (`client_functions`). Sans-IO: the functions build requests and read responses, the host sends them. The setup of a
//! connection is `connection_setup::setup_salesforce`, its actions on the connection state are
//! `connections::SalesforceAction`.

pub mod api;
pub mod auth;
pub mod client_functions;
pub mod connector;
pub mod shared;
pub mod types;

use serde_json::Value;

use crate::connections::JsonObject;

pub use api::{SalesforceError, SalesforceMetadataLoad};
pub use auth::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, OAuthState};
pub use client_functions::{resolve_salesforce_client_function_host, salesforce_client_function_variables};
pub use shared::SharedSalesforceChannel;
pub use types::*;

/// The login hint of the params, none if empty
pub fn login_hint(params: &JsonObject) -> Option<&str> {
    params.get("login").and_then(Value::as_str).filter(|l| !l.is_empty())
}
