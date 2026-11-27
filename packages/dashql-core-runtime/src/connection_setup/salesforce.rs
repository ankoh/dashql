//! The setup of a Salesforce or Database.com connection.
//!
//! The host generates the PKCE challenge and the flow id, opens the authorization page through the redirect page of the
//! app and hands back its callback. The setup exchanges the code for the core token, reads the user info, exchanges
//! the core token for the Data Cloud token over fetch and hands the channel with the tokens to the connection.
//! `authenticate_salesforce` is a login without a connection, e.g. of the shell: its listener hears the names of the
//! steps (`login_step_name`), the tokens are in its outcome.

use std::cell::Cell;
use std::rc::Rc;

use super::{cancellable, OAuthEvents, SetupFailure, SetupHost, CANCELLED_MESSAGE};
use crate::connections::{ConnectionAction, ConnectorType, DetailedError, JsonObject, SalesforceAction};
use crate::executor::HostValue;
use crate::host::{HostError, LogLevel};
use crate::http::CancellationToken;
use crate::salesforce::api::{
    core_access_token_request, core_user_info_request, data_cloud_access_token_request,
    read_core_access_token_response, read_core_user_info_response, read_data_cloud_access_token_response,
    SalesforceError,
};
use crate::salesforce::auth::{
    build_salesforce_authorization_url, salesforce_oauth_state, validate_salesforce_oauth_callback_state,
    OAuthFlowEvent, OAuthState,
};
use crate::salesforce::{
    SalesforceConnectionParams, SalesforceCoreUserInfo, SalesforceOAuthConfig, SalesforceTokens,
    SharedSalesforceChannel,
};
use crate::time::iso_timestamp;

/// The target of the log messages of the setup
const LOG_TARGET: &str = "salesforce_setup";

/// The tokens of a login, without a channel
#[derive(Debug, Clone, PartialEq)]
pub struct SalesforceAuthentication {
    pub tokens: SalesforceTokens,
    pub user_info: Option<SalesforceCoreUserInfo>,
}

/// The name of the step of a login of an action of the setup, the name of the action, none for the steps of the channel.
/// The listener of a login hears these: the progress, never a code, a verifier or a token.
pub fn login_step_name(action: &ConnectionAction) -> Option<&'static str> {
    let ConnectionAction::Salesforce(action) = action else { return None };
    Some(match action {
        SalesforceAction::SetupStarted { .. } => "SETUP_STARTED",
        SalesforceAction::SetupCancelled(_) => "SETUP_CANCELLED",
        SalesforceAction::SetupFailed(_) => "SETUP_FAILED",
        SalesforceAction::GeneratingPkceChallenge => "GENERATING_PKCE_CHALLENGE",
        SalesforceAction::GeneratedPkceChallenge => "GENERATED_PKCE_CHALLENGE",
        SalesforceAction::OAuthNativeLinkOpened => "OAUTH_NATIVE_LINK_OPENED",
        SalesforceAction::OAuthWebWindowOpened => "OAUTH_WEB_WINDOW_OPENED",
        SalesforceAction::OAuthWebWindowClosed => "OAUTH_WEB_WINDOW_CLOSED",
        SalesforceAction::ReceivedCoreAuthCode { .. } => "RECEIVED_CORE_AUTH_CODE",
        SalesforceAction::RequestingCoreAuthToken => "REQUESTING_CORE_AUTH_TOKEN",
        SalesforceAction::ReceivedCoreAuthToken => "RECEIVED_CORE_AUTH_TOKEN",
        SalesforceAction::ReceivedCoreUserInfo { .. } => "RECEIVED_CORE_USER_INFO",
        SalesforceAction::RequestingDataCloudAccessToken => "REQUESTING_DATA_CLOUD_ACCESS_TOKEN",
        SalesforceAction::ReceivedDataCloudAccessToken => "RECEIVED_DATA_CLOUD_ACCESS_TOKEN",
        SalesforceAction::ChannelSetupStarted
        | SalesforceAction::ChannelSetupCancelled(_)
        | SalesforceAction::ChannelSetupFailed(_)
        | SalesforceAction::ChannelReady(_) => return None,
    })
}

/// Log in to Salesforce and get the tokens, without a connection. The steps go to the host as the actions of a setup,
/// its listener hears their names (`login_step_name`).
pub async fn authenticate_salesforce<H: SetupHost>(
    host: Rc<H>,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceAuthentication, SetupFailure> {
    setup_salesforce(host, ConnectorType::SalesforceDataCloud, params, config, force_relogin, cancellation).await
}

/// Set up a Salesforce or Database.com connection with its params, returns the tokens and the user info. The connection
/// takes the channel with the ready step.
///
/// The setup: the PKCE challenge, the authorization in the OAuth flow of the platform, the core token, the user info,
/// the Data Cloud token and the Hyper channel. We use the web server flow with PKCE and without a consumer secret: never
/// embed the secret of an External Client App. The PKCE verifier and the code stay here, the connection learns only
/// that they arrived. A failed step stops the setup with `SetupFailed`, a cancelled one with `SetupCancelled`.
pub async fn setup_salesforce<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceAuthentication, SetupFailure> {
    let dispatch = |action: SalesforceAction| host.dispatch(&ConnectionAction::Salesforce(action));
    let log = |level: LogLevel, message: &str, details: &[(&str, &str)]| {
        let mut pairs: Vec<(&str, &str)> = vec![("target", LOG_TARGET)];
        pairs.extend_from_slice(details);
        host.log(level, message, &pairs);
    };
    let cancel = || {
        dispatch(SalesforceAction::SetupCancelled(DetailedError::new(CANCELLED_MESSAGE)));
        log(LogLevel::Info, "Cancelled OAuth flow", &[]);
        SetupFailure::cancelled()
    };
    let fail = |error: SalesforceError, value: Option<HostValue>| {
        dispatch(SalesforceAction::SetupFailed(DetailedError::new(error.message.clone())));
        if let Some(diagnostics) = &error.diagnostics {
            let status = diagnostics.status.map(|status| status.to_string());
            let mut details = vec![("oauthResponse", diagnostics.oauth_response.as_str())];
            details.extend(diagnostics.endpoint.as_deref().map(|endpoint| ("endpoint", endpoint)));
            details.extend(status.as_deref().map(|status| ("status", status)));
            log(LogLevel::Warn, &diagnostics.message, &details);
        }
        log(LogLevel::Warn, "Failed OAuth flow", &[("error", &error.message)]);
        SetupFailure::failed(error.message).with_value(value)
    };
    let fail_host = |error: HostError| fail(SalesforceError::new(error.message()), error.value().cloned());

    dispatch(SalesforceAction::SetupStarted { params: params.clone() });
    if cancellation.is_cancelled() {
        return Err(cancel());
    }
    if config.oauth_redirect.is_empty() {
        return Err(fail(SalesforceError::new("missing oauth redirect url"), None));
    }

    // The PKCE challenge and the flow id, which binds the callback to this flow: a flow without one fails
    dispatch(SalesforceAction::GeneratingPkceChallenge);
    let pkce = match cancellable(&cancellation, host.generate_pkce()).await {
        None => return Err(cancel()),
        Some(Err(error)) => return Err(fail_host(error)),
        Some(Ok(pkce)) => pkce,
    };
    let now = host.now();
    let flow_id = match host.random_id() {
        Ok(flow_id) if !flow_id.is_empty() => flow_id,
        Ok(_) => return Err(fail(SalesforceError::new("The platform generated no flow id for the OAuth flow"), None)),
        Err(error) => return Err(fail_host(error)),
    };
    let sf_params = SalesforceConnectionParams::from_object(&params);
    let flow = host.flow_info();
    let state = salesforce_oauth_state(&sf_params, &flow, &flow_id, now as i64);
    let url = build_salesforce_authorization_url(&sf_params, &config, &pkce, &state, force_relogin)
        .map_err(|error| fail(error, None))?;
    dispatch(SalesforceAction::GeneratedPkceChallenge);
    let (parameters, logged_state) = logged_authorization(&sf_params, &config, &state, force_relogin);
    let endpoint = url.split_once('?').map_or(url.as_str(), |(endpoint, _)| endpoint);
    log(
        LogLevel::Info,
        "Opening Salesforce OAuth authorization URL",
        &[
            ("endpoint", endpoint),
            ("flowVariant", &flow.redirect_variant),
            ("authorizationParameters", &parameters),
            ("oauthState", &logged_state),
        ],
    );

    // The authorization page, the host reports it while the setup waits for the callback
    let awaiting = Rc::new(Cell::new(true));
    let events: OAuthEvents = {
        let host = host.clone();
        let awaiting = awaiting.clone();
        Rc::new(move |event| {
            if !awaiting.get() {
                return;
            }
            let action = match event {
                OAuthFlowEvent::ExternalBrowserOpened => SalesforceAction::OAuthNativeLinkOpened,
                OAuthFlowEvent::WindowOpened => SalesforceAction::OAuthWebWindowOpened,
                OAuthFlowEvent::WindowClosed => SalesforceAction::OAuthWebWindowClosed,
            };
            host.dispatch(&ConnectionAction::Salesforce(action));
        })
    };
    let login = host.authorize_with_redirect_page(&url, &flow_id, events, &cancellation);
    let callback = cancellable(&cancellation, login).await;
    awaiting.set(false);
    let now = host.now();
    let callback = match callback {
        None => return Err(cancel()),
        Some(Err(error)) => return Err(fail_host(error)),
        Some(Ok(callback)) => callback,
    };
    validate_salesforce_oauth_callback_state(&callback, &state, now as i64).map_err(|error| fail(error, None))?;
    if let Some(error) = callback.error.filter(|error| !error.is_empty()) {
        let message = callback.error_description.filter(|description| !description.is_empty()).unwrap_or(error);
        return Err(fail(SalesforceError::new(message), None));
    }
    let Some(code) = callback.code.filter(|code| !code.is_empty()) else {
        return Err(fail(SalesforceError::new("OAuth callback did not include an authorization code"), None));
    };

    // The core token for the code
    dispatch(SalesforceAction::ReceivedCoreAuthCode { created_at: iso_timestamp(now as i64) });
    dispatch(SalesforceAction::RequestingCoreAuthToken);
    let request = core_access_token_request(&config, &sf_params, &code, &pkce.verifier);
    let response = match cancellable(&cancellation, host.fetch(request.clone(), &cancellation)).await {
        None => return Err(cancel()),
        Some(Err(error)) => return Err(fail(SalesforceError::new(error.message()), None)),
        Some(Ok(response)) => response,
    };
    let core = read_core_access_token_response(&request, &response, host.now()).map_err(|error| fail(error, None))?;
    dispatch(SalesforceAction::ReceivedCoreAuthToken);

    // The user info is optional: without it, the login hint is skipped
    let user_info = match cancellable(&cancellation, host.fetch(core_user_info_request(&core), &cancellation)).await {
        None => return Err(cancel()),
        Some(Err(error)) => Err(error.message().to_string()),
        Some(Ok(response)) => read_core_user_info_response(&response).map_err(|error| error.message),
    };
    let user_info = match user_info {
        Ok(info) => {
            dispatch(SalesforceAction::ReceivedCoreUserInfo {
                preferred_username: info.preferred_username.clone(),
                email: info.email.clone(),
            });
            Some(info)
        }
        Err(error) => {
            log(LogLevel::Info, "Could not resolve core user info; login hint will be skipped", &[("error", &error)]);
            None
        }
    };

    // The Data Cloud token for the core token
    dispatch(SalesforceAction::RequestingDataCloudAccessToken);
    let request = data_cloud_access_token_request(&core);
    let response = match cancellable(&cancellation, host.fetch(request.clone(), &cancellation)).await {
        None => return Err(cancel()),
        Some(Err(error)) => return Err(fail(SalesforceError::new(error.message()), None)),
        Some(Ok(response)) => response,
    };
    let data_cloud =
        read_data_cloud_access_token_response(&request, &response, host.now()).map_err(|error| fail(error, None))?;
    let tokens = SalesforceTokens { core, data_cloud };
    // The connection owns the channel with the tokens from now on
    let channel = SharedSalesforceChannel::new(connector, &sf_params, tokens.clone())
        .map_err(|message| fail(SalesforceError::new(message), None))?;
    dispatch(SalesforceAction::ReceivedDataCloudAccessToken);
    dispatch(SalesforceAction::ChannelSetupStarted);
    dispatch(SalesforceAction::ChannelReady(channel));
    Ok(SalesforceAuthentication { tokens, user_info })
}

/// The parameters of the authorization request and its state for the log: the state, the challenge and the login hint
/// are redacted
fn logged_authorization(
    params: &SalesforceConnectionParams,
    config: &SalesforceOAuthConfig,
    state: &OAuthState,
    force_relogin: bool,
) -> (String, String) {
    let redacted = "<redacted>";
    let mut parameters = serde_json::Map::new();
    parameters.insert("client_id".into(), params.app_consumer_key.clone().into());
    parameters.insert("redirect_uri".into(), config.oauth_redirect.clone().into());
    parameters.insert("code_challenge".into(), redacted.into());
    parameters.insert("code_challenge_method".into(), "S256".into());
    parameters.insert("response_type".into(), "code".into());
    parameters.insert("state".into(), redacted.into());
    if force_relogin {
        parameters.insert("prompt".into(), "login".into());
    }
    if !params.login.is_empty() {
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
    (serde_json::Value::Object(parameters).to_string(), logged_state.to_string())
}
