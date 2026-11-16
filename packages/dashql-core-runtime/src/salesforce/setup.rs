//! The setup of a Salesforce or Database.com connection as a state machine: the PKCE challenge, the authorization in
//! the OAuth flow of the platform, the core token, the user info, the Data Cloud token and the Hyper channel.
//!
//! Every step returns the actions for the connection state (`SalesforceAction`) and what the host does next. The host
//! generates the PKCE challenge and the flow id (randomness and SHA-256 stay with the platform), opens the
//! authorization page and sends the requests; it passes each outcome back. The channel is the HTTP API of the Hyper of
//! Data Cloud, the setup builds it with the tokens and the connection owns it. The PKCE verifier and the code stay in
//! the setup, the connection learns only that they arrived. A failed step stops the setup with `SetupFailed`, a
//! cancelled one with `SetupCancelled`.
//!
//! We use the web server flow with PKCE and without a consumer secret, see the comment in
//! `salesforce_connection_setup.ts`: never embed the secret of an External Client App.
//!
//! Ported from `connections/salesforce/salesforce_connection_setup.ts` and `salesforce_authentication.ts` of
//! `packages/dashql/src/runtime`.

use super::api::{
    core_access_token_request, core_user_info_request, data_cloud_access_token_request,
    read_core_access_token_response, read_core_user_info_response, read_data_cloud_access_token_response, SalesforceError,
};
use super::auth::{
    build_salesforce_authorization_url, salesforce_oauth_state, validate_salesforce_oauth_callback_state, OAuthFlowEvent,
    OAuthFlowInfo, OAuthRedirectData, OAuthState,
};
use super::types::*;
use crate::http::{HttpRequest, HttpResponse};
use crate::clfn::time::iso_timestamp;
use super::shared::SharedSalesforceChannel;
use crate::connections::{
    ConnectorType, DetailedError, JsonObject, OAuthPkceChallenge, SalesforceAction, SALESFORCE_CATALOG_DATABASE,
};

/// A database that a Hyper channel attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedDatabase {
    pub path: String,
    pub alias: String,
}

/// The attached database of a Database.com connection
pub fn hyper_cloud_attached_database(params: &SalesforceConnectionParams) -> AttachedDatabase {
    AttachedDatabase {
        path: format!("hyper.cloud:{}", params.hyper_cloud_database()),
        alias: SALESFORCE_CATALOG_DATABASE.to_string(),
    }
}

/// What the setup achieved: the tokens of the login, which the channel of the connection holds as well
#[derive(Debug, Clone, PartialEq)]
pub struct SalesforceSetupResult {
    pub tokens: SalesforceTokens,
    pub user_info: Option<SalesforceCoreUserInfo>,
}

/// What the host does next
#[derive(Debug, Clone, PartialEq)]
pub enum SalesforceSetupStep {
    /// Generate a PKCE challenge (a random verifier and its S256 digest) and a random flow id, pass them to `on_pkce`
    GeneratePkce,
    /// Open the authorization URL with the OAuth flow of the platform and wait for the callback whose state has the
    /// flow id. Pass the window events to `on_flow_event` and the callback to `on_callback`.
    Authorize { url: String, flow_id: String },
    /// Keep waiting for the callback of the authorization page
    AwaitCallback,
    /// Send the request, pass the response to `on_response` and a request that failed to `on_fetch_failed`
    Fetch(HttpRequest),
    /// The connection is set up, the channel is ready
    Done(SalesforceSetupResult),
    /// The setup stopped, the actions say why
    Stopped,
}

/// Something for the log of the host
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceSetupLog {
    /// Is it a warning?
    pub warning: bool,
    pub message: String,
    /// The details, credentials redacted
    pub details: Vec<(String, String)>,
}

/// The outcome of a step
#[derive(Debug, Clone, PartialEq)]
pub struct SalesforceSetupOutput {
    /// The actions for the connection state, in order
    pub actions: Vec<SalesforceAction>,
    /// What the host does next
    pub step: SalesforceSetupStep,
    /// What the host logs
    pub log: Vec<SalesforceSetupLog>,
}

/// Where the setup is
#[derive(Debug, Clone)]
enum Phase {
    Pkce,
    Authorizing { state: OAuthState, pkce: OAuthPkceChallenge },
    CoreToken { request: HttpRequest },
    UserInfo { core: SalesforceCoreAccessToken },
    DataCloudToken { core: SalesforceCoreAccessToken, user_info: Option<SalesforceCoreUserInfo>, request: HttpRequest },
    Stopped,
}

/// The setup of a Salesforce or Database.com connection
#[derive(Debug, Clone)]
pub struct SalesforceSetup {
    connector: ConnectorType,
    params: SalesforceConnectionParams,
    config: SalesforceOAuthConfig,
    flow: OAuthFlowInfo,
    force_relogin: bool,
    phase: Phase,
}

impl SalesforceSetup {
    /// Start the setup with the params of the connection
    pub fn start(
        connector: ConnectorType,
        params: &JsonObject,
        config: SalesforceOAuthConfig,
        flow: OAuthFlowInfo,
        force_relogin: bool,
    ) -> (Self, SalesforceSetupOutput) {
        let mut setup = Self {
            connector,
            params: SalesforceConnectionParams::from_object(params),
            config,
            flow,
            force_relogin,
            phase: Phase::Pkce,
        };
        let mut actions = vec![SalesforceAction::SetupStarted { params: params.clone() }];
        if setup.config.oauth_redirect.is_empty() {
            let mut output = setup.fail(SalesforceError::new("missing oauth redirect url"));
            actions.append(&mut output.actions);
            return (setup, SalesforceSetupOutput { actions, ..output });
        }
        actions.push(SalesforceAction::GeneratingPkceChallenge);
        (setup, SalesforceSetupOutput { actions, step: SalesforceSetupStep::GeneratePkce, log: Vec::new() })
    }

    /// Stop the setup with an error
    fn fail(&mut self, error: SalesforceError) -> SalesforceSetupOutput {
        self.phase = Phase::Stopped;
        let mut log = Vec::new();
        if let Some(diagnostics) = &error.diagnostics {
            let mut details = vec![("oauthResponse".to_string(), diagnostics.oauth_response.clone())];
            if let Some(endpoint) = &diagnostics.endpoint {
                details.push(("endpoint".to_string(), endpoint.clone()));
            }
            if let Some(status) = diagnostics.status {
                details.push(("status".to_string(), status.to_string()));
            }
            log.push(SalesforceSetupLog { warning: true, message: diagnostics.message.clone(), details });
        }
        log.push(SalesforceSetupLog {
            warning: true,
            message: "Failed OAuth flow".to_string(),
            details: vec![("error".to_string(), error.message.clone())],
        });
        SalesforceSetupOutput {
            actions: vec![SalesforceAction::SetupFailed(DetailedError::new(error.message))],
            step: SalesforceSetupStep::Stopped,
            log,
        }
    }

    /// An output that continues
    fn next(actions: Vec<SalesforceAction>, step: SalesforceSetupStep) -> SalesforceSetupOutput {
        SalesforceSetupOutput { actions, step, log: Vec::new() }
    }

    /// The setup got an input it didn't wait for
    fn unexpected(&mut self, input: &str) -> SalesforceSetupOutput {
        self.fail(SalesforceError::new(format!("the Salesforce setup didn't wait for {input}")))
    }

    /// The PKCE challenge and the id of the flow are there: open the authorization page
    pub fn on_pkce(&mut self, pkce: OAuthPkceChallenge, flow_id: &str, now: f64) -> SalesforceSetupOutput {
        if !matches!(self.phase, Phase::Pkce) {
            return self.unexpected("a PKCE challenge");
        }
        let state = salesforce_oauth_state(&self.params, &self.flow, flow_id, now as i64);
        let url = match build_salesforce_authorization_url(&self.params, &self.config, &pkce, &state, self.force_relogin) {
            Ok(url) => url,
            Err(error) => return self.fail(error),
        };
        let actions = vec![SalesforceAction::GeneratedPkceChallenge];
        // The log names the parameters of the request, the state, the challenge and the login hint are redacted
        let redacted = "<redacted>";
        let mut parameters = serde_json::Map::new();
        parameters.insert("client_id".into(), self.params.app_consumer_key.clone().into());
        parameters.insert("redirect_uri".into(), self.config.oauth_redirect.clone().into());
        parameters.insert("code_challenge".into(), redacted.into());
        parameters.insert("code_challenge_method".into(), "S256".into());
        parameters.insert("response_type".into(), "code".into());
        parameters.insert("state".into(), redacted.into());
        if self.force_relogin {
            parameters.insert("prompt".into(), "login".into());
        }
        if !self.params.login.is_empty() {
            parameters.insert("login_hint".into(), redacted.into());
        }
        let provider = state.salesforce_provider.as_ref();
        let logged_state = serde_json::json!({
            "flowId": redacted,
            "flowVariant": state.flow_variant,
            "debugMode": state.debug_mode,
            "callbackUrl": state.callback_url,
            "flavor": state.flavor,
            "salesforceProvider": {
                "instanceUrl": provider.map(|p| p.instance_url.clone()),
                "appConsumerKey": provider.map(|p| p.app_consumer_key.clone()),
                "requestedAt": provider.map(|p| p.requested_at),
                "expiresAt": provider.map(|p| p.expires_at),
            },
        });
        self.phase = Phase::Authorizing { state, pkce };
        let mut output = Self::next(actions, SalesforceSetupStep::Authorize { url: url.clone(), flow_id: flow_id.to_string() });
        let endpoint = url.split_once('?').map_or(url.as_str(), |(endpoint, _)| endpoint).to_string();
        output.log.push(SalesforceSetupLog {
            warning: false,
            message: "Opening Salesforce OAuth authorization URL".to_string(),
            details: vec![
                ("endpoint".to_string(), endpoint),
                ("flowVariant".to_string(), self.flow.redirect_variant.clone()),
                ("authorizationParameters".to_string(), serde_json::Value::Object(parameters).to_string()),
                ("oauthState".to_string(), logged_state.to_string()),
            ],
        });
        output
    }

    /// The OAuth flow of the platform showed or closed the authorization page
    pub fn on_flow_event(&mut self, event: OAuthFlowEvent) -> SalesforceSetupOutput {
        let action = match event {
            OAuthFlowEvent::ExternalBrowserOpened => SalesforceAction::OAuthNativeLinkOpened,
            OAuthFlowEvent::WindowOpened => SalesforceAction::OAuthWebWindowOpened,
            OAuthFlowEvent::WindowClosed => SalesforceAction::OAuthWebWindowClosed,
        };
        if !matches!(self.phase, Phase::Authorizing { .. }) {
            return self.unexpected("an event of the authorization page");
        }
        Self::next(vec![action], SalesforceSetupStep::AwaitCallback)
    }

    /// The redirect page handed back the callback of the authorization: exchange the code for the core token
    pub fn on_callback(&mut self, callback: &OAuthRedirectData, now: f64) -> SalesforceSetupOutput {
        let Phase::Authorizing { state, pkce } = &self.phase else {
            return self.unexpected("an OAuth callback");
        };
        if let Err(error) = validate_salesforce_oauth_callback_state(callback, state, now as i64) {
            return self.fail(error);
        }
        if let Some(error) = callback.error.as_ref().filter(|e| !e.is_empty()) {
            let message = callback.error_description.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| error.clone());
            return self.fail(SalesforceError::new(message));
        }
        let Some(code) = callback.code.clone().filter(|c| !c.is_empty()) else {
            return self.fail(SalesforceError::new("OAuth callback did not include an authorization code"));
        };
        let request = core_access_token_request(&self.config, &self.params, &code, &pkce.verifier);
        let actions = vec![
            SalesforceAction::ReceivedCoreAuthCode { created_at: iso_timestamp(now as i64) },
            SalesforceAction::RequestingCoreAuthToken,
        ];
        self.phase = Phase::CoreToken { request: request.clone() };
        Self::next(actions, SalesforceSetupStep::Fetch(request))
    }

    /// The Data Cloud token is requested next
    fn request_data_cloud_token(
        &mut self,
        core: SalesforceCoreAccessToken,
        user_info: Option<SalesforceCoreUserInfo>,
        mut actions: Vec<SalesforceAction>,
    ) -> SalesforceSetupOutput {
        let request = data_cloud_access_token_request(&core);
        actions.push(SalesforceAction::RequestingDataCloudAccessToken);
        self.phase = Phase::DataCloudToken { core, user_info, request: request.clone() };
        Self::next(actions, SalesforceSetupStep::Fetch(request))
    }

    /// A response of a request of the setup
    pub fn on_response(&mut self, response: &HttpResponse, now: f64) -> SalesforceSetupOutput {
        match std::mem::replace(&mut self.phase, Phase::Stopped) {
            Phase::CoreToken { request } => match read_core_access_token_response(&request, response, now) {
                Ok(core) => {
                    let request = core_user_info_request(&core);
                    self.phase = Phase::UserInfo { core };
                    Self::next(vec![SalesforceAction::ReceivedCoreAuthToken], SalesforceSetupStep::Fetch(request))
                }
                Err(error) => self.fail(error),
            },
            Phase::UserInfo { core } => match read_core_user_info_response(response) {
                Ok(info) => {
                    let action = SalesforceAction::ReceivedCoreUserInfo {
                        preferred_username: info.preferred_username.clone(),
                        email: info.email.clone(),
                    };
                    self.request_data_cloud_token(core, Some(info), vec![action])
                }
                Err(error) => self.skip_user_info(core, &error.message),
            },
            Phase::DataCloudToken { core, user_info, request } => {
                match read_data_cloud_access_token_response(&request, response, now) {
                    Ok(data_cloud) => {
                        let tokens = SalesforceTokens { core, data_cloud };
                        // The connection owns the channel with the tokens from now on
                        let channel = match SharedSalesforceChannel::new(self.connector, &self.params, tokens.clone()) {
                            Ok(channel) => channel,
                            Err(message) => return self.fail(SalesforceError::new(message)),
                        };
                        Self::next(
                            vec![
                                SalesforceAction::ReceivedDataCloudAccessToken,
                                SalesforceAction::ChannelSetupStarted,
                                SalesforceAction::ChannelReady(channel),
                            ],
                            SalesforceSetupStep::Done(SalesforceSetupResult { tokens, user_info }),
                        )
                    }
                    Err(error) => self.fail(error),
                }
            }
            phase => {
                self.phase = phase;
                self.unexpected("a response")
            }
        }
    }

    /// The user info is optional: without it, the login hint is skipped
    fn skip_user_info(&mut self, core: SalesforceCoreAccessToken, error: &str) -> SalesforceSetupOutput {
        let mut output = self.request_data_cloud_token(core, None, Vec::new());
        output.log.push(SalesforceSetupLog {
            warning: false,
            message: "Could not resolve core user info; login hint will be skipped".to_string(),
            details: vec![("error".to_string(), error.to_string())],
        });
        output
    }

    /// A request of the setup failed without a response
    pub fn on_fetch_failed(&mut self, error: &str) -> SalesforceSetupOutput {
        match std::mem::replace(&mut self.phase, Phase::Stopped) {
            Phase::UserInfo { core } => self.skip_user_info(core, error),
            _ => self.fail(SalesforceError::new(error)),
        }
    }

    /// A step of the host failed, e.g. the authorization page couldn't open
    pub fn on_host_failed(&mut self, error: &str) -> SalesforceSetupOutput {
        self.fail(SalesforceError::new(error))
    }

    /// The setup was cancelled, e.g. the user closed the dialog
    pub fn cancel(&mut self, message: &str) -> SalesforceSetupOutput {
        self.phase = Phase::Stopped;
        SalesforceSetupOutput {
            actions: vec![SalesforceAction::SetupCancelled(DetailedError::new(message))],
            step: SalesforceSetupStep::Stopped,
            log: vec![SalesforceSetupLog { warning: false, message: "Cancelled OAuth flow".to_string(), details: Vec::new() }],
        }
    }
}
