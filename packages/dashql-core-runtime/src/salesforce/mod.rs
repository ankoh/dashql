//! The Salesforce connector: the REST APIs of the setup and the metadata (`api`), the OAuth flow with PKCE (`auth`) and
//! the channel of a connection with its tokens (`shared`). Sans-IO: the functions build requests and read responses,
//! the host sends them. The setup of a connection is `connection_setup::setup_salesforce`, its actions on the
//! connection state are `connections::SalesforceAction`.

pub mod api;
pub mod auth;
pub mod connector;
pub mod json;
pub mod shared;
pub mod types;

use serde_json::Value;

use crate::connections::JsonObject;

pub use api::{SalesforceError, SalesforceMetadataLoad};
pub use auth::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, OAuthState};
pub use shared::SharedSalesforceChannel;
pub use types::*;

/// The login hint of the params, none if empty
pub fn login_hint(params: &JsonObject) -> Option<&str> {
    params.get("login").and_then(Value::as_str).filter(|l| !l.is_empty())
}
