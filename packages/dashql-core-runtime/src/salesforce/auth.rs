//! The OAuth web server flow of Salesforce with PKCE: the authorization URL with the state of the flow, and the check of
//! the callback that the redirect page hands back.
//!
//! Ported from `connections/salesforce/salesforce_authentication.ts` and `oauth/oauth_types.ts` of
//! `packages/dashql-runtime`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::api::SalesforceError;
use super::types::{SalesforceConnectionParams, SalesforceOAuthConfig};
use crate::http::Url;
use crate::connections::OAuthPkceChallenge;

/// How long an OAuth flow of Salesforce is valid
pub const OAUTH_FLOW_LIFETIME_MS: i64 = 2 * 60 * 60 * 1000;

/// The provider of a Salesforce flow in its state
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuthSalesforceProvider {
    pub instance_url: String,
    pub app_consumer_key: String,
    /// Milliseconds since the epoch
    pub requested_at: i64,
    /// Milliseconds since the epoch
    pub expires_at: i64,
}

/// The state of an OAuth flow, the redirect page hands it back with the callback
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuthState {
    pub flow_id: String,
    /// `UNSPECIFIED_FLOW`, `WEB_OPENER_FLOW` or `NATIVE_LINK_FLOW`
    pub flow_variant: String,
    pub debug_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_url: Option<String>,
    /// The flavor of the app that started the flow, the redirect page is branded with it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flavor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salesforce_provider: Option<OAuthSalesforceProvider>,
}

/// The callback of the redirect page
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OAuthRedirectData {
    pub state: Option<OAuthState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
}

/// How the platform takes the user through the authorization, the part that goes into the state
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OAuthFlowInfo {
    /// How the redirect page hands the callback back: `WEB_OPENER_FLOW` or `NATIVE_LINK_FLOW`
    pub redirect_variant: String,
    /// The page of the app that the redirect page sends the callback to in a web opener flow
    pub redirect_callback_url: Option<String>,
    /// Is the app a debug build?
    pub debug_mode: bool,
    /// The flavor of the app
    pub flavor: Option<String>,
}

/// What the OAuth flow of the platform shows while the user authorizes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthFlowEvent {
    /// A window of the app shows the authorization page
    WindowOpened,
    /// The window of the authorization page closed
    WindowClosed,
    /// The browser of the system shows the authorization page
    ExternalBrowserOpened,
}

/// The state of a new flow
pub fn salesforce_oauth_state(params: &SalesforceConnectionParams, flow: &OAuthFlowInfo, flow_id: &str, now: i64) -> OAuthState {
    OAuthState {
        flow_id: flow_id.to_string(),
        flow_variant: flow.redirect_variant.clone(),
        debug_mode: flow.debug_mode,
        callback_url: flow.redirect_callback_url.clone().filter(|u| !u.is_empty()),
        flavor: flow.flavor.clone().filter(|f| !f.is_empty()),
        salesforce_provider: Some(OAuthSalesforceProvider {
            instance_url: params.instance_url.clone(),
            app_consumer_key: params.app_consumer_key.clone(),
            requested_at: now,
            expires_at: now + OAUTH_FLOW_LIFETIME_MS,
        }),
    }
}

/// The URL of the authorization page
pub fn build_salesforce_authorization_url(
    params: &SalesforceConnectionParams,
    config: &SalesforceOAuthConfig,
    pkce: &OAuthPkceChallenge,
    state: &OAuthState,
    force_relogin: bool,
) -> Result<String, SalesforceError> {
    let instance = Url::parse(&params.instance_url).map_err(|e| SalesforceError::new(e.to_string()))?;
    let base = instance.join("/services/oauth2/authorize").map_err(|e| SalesforceError::new(e.to_string()))?;
    let state_json = serde_json::to_string(state).map_err(|e| SalesforceError::new(e.to_string()))?;
    let mut pairs = vec![
        ("client_id".to_string(), params.app_consumer_key.clone()),
        ("redirect_uri".to_string(), config.oauth_redirect.clone()),
        ("code_challenge".to_string(), pkce.value.clone()),
        ("code_challenge_method".to_string(), "S256".to_string()),
        ("response_type".to_string(), "code".to_string()),
        ("state".to_string(), URL_SAFE_NO_PAD.encode(state_json.as_bytes())),
    ];
    if force_relogin {
        pairs.push(("prompt".to_string(), "login".to_string()));
    }
    if !params.login.is_empty() {
        pairs.push(("login_hint".to_string(), params.login.clone()));
    }
    Ok(base.with_query_pairs(&pairs).to_string())
}

/// Check that a callback belongs to the flow that the app started and that the flow hasn't expired
pub fn validate_salesforce_oauth_callback_state(callback: &OAuthRedirectData, expected: &OAuthState, now: i64) -> Result<(), SalesforceError> {
    let actual = callback.state.as_ref();
    let (Some(actual), Some(actual_provider), Some(expected_provider)) = (
        actual,
        actual.and_then(|s| s.salesforce_provider.as_ref()),
        expected.salesforce_provider.as_ref(),
    ) else {
        return Err(SalesforceError::new("OAuth callback state is missing the Salesforce provider"));
    };
    if actual.flow_id != expected.flow_id {
        return Err(SalesforceError::new("OAuth callback flow ID does not match"));
    }
    if actual.flow_variant != expected.flow_variant {
        return Err(SalesforceError::new("OAuth callback flow variant does not match"));
    }
    if actual_provider.instance_url != expected_provider.instance_url
        || actual_provider.app_consumer_key != expected_provider.app_consumer_key
    {
        return Err(SalesforceError::new("OAuth callback Salesforce provider does not match"));
    }
    if actual_provider.expires_at != expected_provider.expires_at || actual_provider.expires_at <= now {
        return Err(SalesforceError::new("OAuth callback state has expired"));
    }
    Ok(())
}
