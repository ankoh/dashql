//! What an OAuth flow asks of the platform.
//!
//! The connectors build the authorization URL and exchange the code for a token over `HttpHost::fetch`. The platform
//! generates the PKCE challenge and the random state (the core has no SHA-256 and no randomness of its own), opens the
//! authorization page and hands back the callback: a loopback server for Trino, the redirect page of the app for
//! Salesforce, in the browser as a window and in the desktop app as a link. A flow stops when its token is cancelled.

use std::future::Future;
use std::rc::Rc;

use crate::connections::OAuthPkceChallenge;
use crate::host::HostError;
use crate::http::{CancellationToken, HttpHost};
use crate::salesforce::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData};

/// What the loopback redirect of an OAuth flow received
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OAuthCallback {
    /// The authorization code
    pub code: Option<String>,
    /// The state of the authorization request
    pub state: Option<String>,
    /// The error of the identity provider
    pub error: Option<String>,
    /// The description of the error
    pub error_description: Option<String>,
}

/// Learns what the platform shows while the user authorizes
pub type OAuthEvents = Rc<dyn Fn(OAuthFlowEvent)>;

/// The OAuth flows of the platform
pub trait OAuthHost: HttpHost {
    /// A PKCE challenge: a random verifier and the base64url of its SHA-256 digest
    fn generate_pkce(&self) -> impl Future<Output = Result<OAuthPkceChallenge, HostError>> + 'static;
    /// A random id, e.g. the state of an authorization request. A flow never runs without one: an empty id would bind
    /// the callback to nothing.
    fn random_id(&self) -> Result<String, HostError>;
    /// How the platform takes the user through the redirect page, it goes into the state of a flow
    fn flow_info(&self) -> OAuthFlowInfo;
    /// Receive the redirect on a loopback server at the callback URL, open the authorization URL and wait for the
    /// callback. Fails if the platform has no loopback server.
    fn authorize_with_loopback(
        &self,
        url: &str,
        callback_url: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthCallback, HostError>> + 'static;
    /// Open the authorization URL and wait until the redirect page hands over the callback whose state has the flow id
    fn authorize_with_redirect_page(
        &self,
        url: &str,
        flow_id: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthRedirectData, HostError>> + 'static;
}
