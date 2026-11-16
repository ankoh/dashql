//! Whether a Salesforce connection is set up for params, e.g. before a link reuses it.
//!
//! Ported from `packages/dashql/src/runtime/connections/connector_setup_check.ts`.

use serde_json::Value;

use super::{ConnectionState, JsonObject};

/// How far the setup of a Salesforce connection got for params
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionSetupCheck {
    Unknown,
    ConnectionNull,
    ConnectionTypeMismatch,
    Authenticated,
    AuthenticationFailed,
    AuthenticationInProgress,
    AuthenticationNotStarted,
    ClientIdMismatch,
}

/// A field of token JSON, none unless it is a non-empty string
fn token_field<'a>(token: Option<&'a Value>, path: &[&str]) -> Option<&'a str> {
    path.iter().try_fold(token?, |value, key| value.get(key))?.as_str().filter(|text| !text.is_empty())
}

/// Check the setup of a Salesforce connection for params. A setup error wins over the tokens, both tokens must be
/// there: the core access token and the exchanged Data Cloud token.
pub fn check_salesforce_connection_setup(state: Option<&ConnectionState>, params: &JsonObject) -> ConnectionSetupCheck {
    let Some(state) = state else {
        return ConnectionSetupCheck::ConnectionNull;
    };
    let Some(salesforce) = state.details().salesforce() else {
        return ConnectionSetupCheck::ConnectionTypeMismatch;
    };
    let Some(setup_params) = state.details().setup_params.as_ref() else {
        return ConnectionSetupCheck::AuthenticationNotStarted;
    };
    let consumer_key = |params: &JsonObject| params.get("appConsumerKey").filter(|key| !key.is_null()).cloned();
    if consumer_key(setup_params) != consumer_key(params) {
        return ConnectionSetupCheck::ClientIdMismatch;
    }
    if salesforce.setup_error.is_some() {
        return ConnectionSetupCheck::AuthenticationFailed;
    }
    // The tokens are opaque JSON
    let oauth = salesforce.oauth_state.as_ref();
    let parse = |token: Option<&String>| token.and_then(|token| serde_json::from_str::<Value>(token).ok());
    let core_token = parse(oauth.and_then(|oauth| oauth.core_access_token.as_ref()));
    let data_cloud_token = parse(oauth.and_then(|oauth| oauth.data_cloud_access_token.as_ref()));
    if token_field(core_token.as_ref(), &["accessToken"]).is_some()
        && token_field(data_cloud_token.as_ref(), &["jwt", "raw"]).is_some()
    {
        return ConnectionSetupCheck::Authenticated;
    }
    if state.details().setup_timings.auth_started_at.is_some() {
        return ConnectionSetupCheck::AuthenticationInProgress;
    }
    ConnectionSetupCheck::Unknown
}
