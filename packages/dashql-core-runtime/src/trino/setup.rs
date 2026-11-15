//! The setup of a Trino connection as a state machine: the OAuth flow if the connection uses OAuth, the channel and
//! the health check.
//!
//! The setup reports every step as an action on the connection (`ConnectionAction`) and asks the host for what it
//! can't do itself: a PKCE challenge and a random state (the crypto of the platform), the login in the browser with
//! the loopback redirect (`OAuthFlow`), the request of the access token, keeping the channel under its id and the
//! health check, which runs through the query executor so that it shows up like any other query. The host passes the
//! answers back with the time they arrived.
//!
//! Ported from `packages/dashql-runtime/src/connections/trino/trino_connection_setup.ts` and `performHealthCheck` of
//! `health_check.ts`.

use super::error::{TrinoError, TrinoErrorKind};
use crate::http::url::form_encode;
use crate::http::{FetchOutcome, HttpRequest};
use super::protocol::{read_token_response, token_request, TrinoAuthType, TrinoChannel, TrinoOAuthParams};
use super::time::{iso_timestamp, Millis};
use crate::connections::{ChannelId, ConnectionAction, DetailedError, JsonObject, OAuthPkceChallenge, TemporaryToken, TrinoAction};

/// The redirect of the OAuth flow if the connection doesn't configure one: the loopback server of the platform
pub const DEFAULT_OAUTH_CALLBACK_URL: &str = "http://localhost:56512/Callback";
/// The scopes of the OAuth flow if the connection doesn't configure any
pub const DEFAULT_OAUTH_SCOPES: [&str; 4] = ["openid", "email", "profile", "offline_access"];
/// The query of the health check of a Trino connection
pub const HEALTH_CHECK_QUERY: &str = "select 1";

/// The options of a setup
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TrinoSetupOptions {
    /// Make the identity provider ask for the login again instead of reusing a session of the browser
    pub force_relogin: bool,
    /// Run the health check once the channel is ready
    pub health_check: bool,
}

/// What the loopback redirect of the OAuth flow received
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

/// How the health check went
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthCheckOutcome {
    /// The query returned a result
    Succeeded,
    /// The query failed, e.g. the server rejected the login
    Failed(DetailedError),
    /// The query returned no result
    NoResult,
}

/// What a setup asks of the host or reports, in order
#[derive(Debug, Clone, PartialEq)]
pub enum SetupOutput {
    /// Apply an action to the connection
    Dispatch(ConnectionAction),
    /// Generate a PKCE challenge and a random state and pass them to `on_pkce`
    GeneratePkce,
    /// Open the login in the browser and wait for the redirect to the callback URL. Report an opened external
    /// browser with `on_browser_opened` and the redirect with `on_callback`.
    Authorize { url: String, callback_url: String },
    /// Send the request of the access token and pass the outcome to `on_token_response`
    RequestToken(HttpRequest),
    /// Keep the channel under its id, the connection refers to it once it is ready
    OpenChannel { id: ChannelId, channel: TrinoChannel },
    /// Run the query of the health check on the channel through the query executor and pass the outcome to
    /// `on_health_check`
    RunHealthCheck { channel: ChannelId, query: &'static str },
    /// The setup succeeded
    Succeeded,
    /// The setup failed or was aborted
    Failed(TrinoError),
}

/// How far a setup got
#[derive(Debug, Clone, PartialEq, Eq)]
enum Phase {
    /// The host generates the PKCE challenge
    GeneratingPkce,
    /// The user logs in
    Authorizing { pkce: OAuthPkceChallenge, state: String, callback_url: String },
    /// The access token is requested
    RequestingToken,
    /// The health check runs
    HealthCheck,
    /// The setup ended
    Done,
}

/// The setup of a Trino connection
#[derive(Debug, Clone)]
pub struct TrinoSetup {
    /// The params of the connector without the draft rows
    params: JsonObject,
    /// The channel of the params
    channel: TrinoChannel,
    /// The id that the host keeps the channel under
    channel_id: ChannelId,
    /// The options
    options: TrinoSetupOptions,
    /// How far the setup got
    phase: Phase,
}

impl TrinoSetup {
    /// Start the setup of a connection with the params of the connector. The host keeps the channel under an id that
    /// it chose.
    pub fn start(params: &JsonObject, channel_id: ChannelId, options: TrinoSetupOptions) -> (Self, Vec<SetupOutput>) {
        let mut params = params.clone();
        params.remove("draftRows");
        let channel = TrinoChannel::from_params(&params);
        let oauth = channel.auth.auth_type == TrinoAuthType::OAuth;
        let mut setup = Self { params, channel, channel_id, options, phase: Phase::Done };
        let mut out = Vec::new();
        if !oauth {
            setup.open_channel(&mut out);
            return (setup, out);
        }
        if setup.channel.auth.oauth.is_none() {
            out.push(SetupOutput::Failed(TrinoError::new(
                TrinoErrorKind::OAuth,
                "OAuth configuration is required for OAuth authentication",
            )));
            return (setup, out);
        }
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::OAuthStarted { params: setup.params.clone() })));
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::GeneratingPkceChallenge)));
        out.push(SetupOutput::GeneratePkce);
        setup.phase = Phase::GeneratingPkce;
        (setup, out)
    }

    /// Has the setup ended?
    pub fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// The OAuth settings, the setup checked that there are some before the flow started
    fn oauth(&self) -> TrinoOAuthParams {
        self.channel.auth.oauth.clone().unwrap_or_default()
    }

    /// The host generated the PKCE challenge and a random state
    pub fn on_pkce(&mut self, pkce: OAuthPkceChallenge, state: String) -> Vec<SetupOutput> {
        let mut out = Vec::new();
        if self.phase != Phase::GeneratingPkce {
            return out;
        }
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::GeneratedPkceChallenge(pkce.clone()))));
        let oauth = self.oauth();
        let callback_url =
            if oauth.callback_url.is_empty() { DEFAULT_OAUTH_CALLBACK_URL.to_string() } else { oauth.callback_url.clone() };
        let scopes = if oauth.scopes.is_empty() {
            DEFAULT_OAUTH_SCOPES.join(" ")
        } else {
            oauth.scopes.join(" ")
        };
        let mut fields = vec![
            ("client_id", oauth.client_id.as_str()),
            ("redirect_uri", callback_url.as_str()),
            ("response_type", "code"),
            ("code_challenge", pkce.value.as_str()),
            ("code_challenge_method", "S256"),
            ("scope", scopes.as_str()),
            ("state", state.as_str()),
        ];
        if self.options.force_relogin {
            // Make the identity provider authenticate again instead of reusing a session cookie of the browser
            fields.push(("prompt", "login"));
        }
        let url = format!("{}?{}", oauth.authorization_url, form_encode(fields.iter().copied()));
        out.push(SetupOutput::Authorize { url, callback_url: callback_url.clone() });
        self.phase = Phase::Authorizing { pkce, state, callback_url };
        out
    }

    /// The login opened in an external browser
    pub fn on_browser_opened(&mut self) -> Vec<SetupOutput> {
        if !matches!(self.phase, Phase::Authorizing { .. }) {
            return Vec::new();
        }
        vec![SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::OAuthBrowserOpened))]
    }

    /// The redirect of the login arrived at a time
    pub fn on_callback(&mut self, callback: OAuthCallback, now: Millis) -> Vec<SetupOutput> {
        let mut out = Vec::new();
        let Phase::Authorizing { pkce, state, callback_url } = std::mem::replace(&mut self.phase, Phase::Done) else {
            return out;
        };
        let oauth_error = |message: String| TrinoError::new(TrinoErrorKind::OAuth, message);
        if let Some(error) = callback.error.filter(|error| !error.is_empty()) {
            let message = callback.error_description.filter(|description| !description.is_empty()).unwrap_or(error);
            self.fail_oauth(oauth_error(message), &mut out);
            return out;
        }
        if callback.state.as_deref() != Some(state.as_str()) {
            self.fail_oauth(oauth_error("OAuth callback state does not match the authorization request".into()), &mut out);
            return out;
        }
        let Some(code) = callback.code.filter(|code| !code.is_empty()) else {
            self.fail_oauth(oauth_error("No authorization code received".into()), &mut out);
            return out;
        };
        let auth_code = TemporaryToken { token: code.clone(), created_at: iso_timestamp(now) };
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::ReceivedOAuthCode(auth_code))));
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::RequestingAccessToken)));
        let oauth = self.oauth();
        out.push(SetupOutput::RequestToken(token_request(
            &oauth.token_url,
            &[
                ("grant_type", "authorization_code"),
                ("client_id", &oauth.client_id),
                ("code", &code),
                ("redirect_uri", &callback_url),
                ("code_verifier", &pkce.verifier),
            ],
        )));
        self.phase = Phase::RequestingToken;
        out
    }

    /// The answer of the token endpoint arrived at a time
    pub fn on_token_response(&mut self, outcome: &FetchOutcome, now: Millis) -> Vec<SetupOutput> {
        let mut out = Vec::new();
        if self.phase != Phase::RequestingToken {
            return out;
        }
        self.phase = Phase::Done;
        match read_token_response(outcome, now) {
            Err(error) => self.fail_oauth(error, &mut out),
            Ok(token) => {
                out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::ReceivedAccessToken(
                    token.to_json().to_string(),
                ))));
                self.channel.access_token = Some(token);
                self.open_channel(&mut out);
            }
        }
        out
    }

    /// The health check ended
    pub fn on_health_check(&mut self, outcome: HealthCheckOutcome) -> Vec<SetupOutput> {
        let mut out = Vec::new();
        if self.phase != Phase::HealthCheck {
            return out;
        }
        self.phase = Phase::Done;
        let error = match outcome {
            HealthCheckOutcome::Succeeded => {
                out.push(SetupOutput::Dispatch(ConnectionAction::HealthCheckSucceeded));
                out.push(SetupOutput::Succeeded);
                return out;
            }
            HealthCheckOutcome::Failed(error) => error,
            HealthCheckOutcome::NoResult => DetailedError::new("health check failed"),
        };
        out.push(SetupOutput::Dispatch(ConnectionAction::HealthCheckFailed(error.clone())));
        out.push(SetupOutput::Failed(TrinoError {
            kind: TrinoErrorKind::HealthCheck,
            message: error.message,
            data: error.data,
        }));
        out
    }

    /// Abort the setup, e.g. the user cancelled it
    pub fn abort(&mut self) -> Vec<SetupOutput> {
        let mut out = Vec::new();
        let action = match std::mem::replace(&mut self.phase, Phase::Done) {
            Phase::Done => return out,
            Phase::GeneratingPkce | Phase::Authorizing { .. } | Phase::RequestingToken => {
                ConnectionAction::Trino(TrinoAction::OAuthCancelled(DetailedError::new("OAuth flow was aborted")))
            }
            Phase::HealthCheck => ConnectionAction::HealthCheckCancelled,
        };
        out.push(SetupOutput::Dispatch(action));
        out.push(SetupOutput::Failed(TrinoError::new(TrinoErrorKind::Aborted, "The setup was aborted")));
        out
    }

    /// Set up the channel, then run the health check
    fn open_channel(&mut self, out: &mut Vec<SetupOutput>) {
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: self.params.clone() })));
        out.push(SetupOutput::OpenChannel { id: self.channel_id, channel: self.channel.clone() });
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::ChannelReady(self.channel_id))));
        if self.options.health_check {
            out.push(SetupOutput::Dispatch(ConnectionAction::HealthCheckStarted));
            out.push(SetupOutput::RunHealthCheck { channel: self.channel_id, query: HEALTH_CHECK_QUERY });
            self.phase = Phase::HealthCheck;
        } else {
            self.phase = Phase::Done;
            out.push(SetupOutput::Succeeded);
        }
    }

    /// The OAuth flow failed, the connection keeps only the message
    fn fail_oauth(&mut self, error: TrinoError, out: &mut Vec<SetupOutput>) {
        self.phase = Phase::Done;
        out.push(SetupOutput::Dispatch(ConnectionAction::Trino(TrinoAction::OAuthFailed(DetailedError::new(error.message.clone())))));
        out.push(SetupOutput::Failed(error));
    }
}
