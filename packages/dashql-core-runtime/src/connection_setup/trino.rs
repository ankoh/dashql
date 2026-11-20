//! The setup of a Trino connection.
//!
//! Basic auth opens the channel right away. OAuth asks the host for the PKCE challenge and the state, opens the login
//! with the loopback redirect of the platform, requests the access token over fetch and opens the channel with it. Every
//! step is an action of the connection (`TrinoAction`); the PKCE verifier and the code stay in the setup, the connection
//! owns the channel with the access token. The health check is a step of its own (`check_health`), the caller runs it
//! once the channel is ready.

use std::cell::Cell;
use std::rc::Rc;

use super::{cancellable, OAuthCallback, OAuthEvents, OAuthHost, SetupFailure, SetupHost, LOG_TARGET};
use crate::connections::{ConnectionAction, DetailedError, JsonObject, OAuthPkceChallenge, TrinoAction};
use crate::executor::HostValue;
use crate::host::{HostError, LogLevel};
use crate::http::url::form_encode;
use crate::http::{CancellationToken, FetchOutcome};
use crate::salesforce::OAuthFlowEvent;
use crate::time::iso_timestamp;
use crate::trino::protocol::{read_token_response, token_request, TrinoAuthType, TrinoChannel, TrinoOAuthParams};
use crate::trino::SharedTrinoChannel;

/// The redirect of the OAuth flow if the connection doesn't configure one: the loopback server of the platform
pub const DEFAULT_OAUTH_CALLBACK_URL: &str = "http://localhost:56512/Callback";
/// The scopes of the OAuth flow if the connection doesn't configure any
pub const DEFAULT_OAUTH_SCOPES: [&str; 4] = ["openid", "email", "profile", "offline_access"];

/// Set up a Trino connection with its params, the connection takes the channel with the ready step
pub async fn setup_trino<H: SetupHost>(
    host: Rc<H>,
    mut params: JsonObject,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<(), SetupFailure> {
    params.remove("draftRows");
    let mut channel = TrinoChannel::from_params(&params);
    let dispatch = |action: TrinoAction| host.dispatch(&ConnectionAction::Trino(action));
    if channel.auth.auth_type != TrinoAuthType::OAuth {
        dispatch(TrinoAction::ChannelSetupStarted { params });
        if cancellation.is_cancelled() {
            dispatch(TrinoAction::ChannelSetupCancelled(DetailedError::new("The setup was aborted")));
            return Err(cancelled(&*host));
        }
        dispatch(TrinoAction::ChannelReady(SharedTrinoChannel::new(channel)));
        return Ok(());
    }

    dispatch(TrinoAction::OAuthStarted { params: params.clone() });
    // The flow fails or is cancelled with an action of the connection, the connection shows the error of the flow
    let abort = || {
        dispatch(TrinoAction::OAuthCancelled(DetailedError::new("OAuth flow was aborted")));
        cancelled(&*host)
    };
    let fail = |message: String, data, value: Option<HostValue>| {
        dispatch(TrinoAction::OAuthFailed(DetailedError::new(message.clone())));
        host.log(LogLevel::Warn, "Setup failed", &[("target", LOG_TARGET), ("error", &message)]);
        let mut failure = SetupFailure::failed(message).with_value(value);
        failure.data = data;
        failure
    };
    let fail_host = |error: HostError| fail(error.message().to_string(), Default::default(), error.value().cloned());
    let Some(oauth) = channel.auth.oauth.clone() else {
        return Err(fail("OAuth configuration is required for OAuth authentication".into(), Default::default(), None));
    };
    if cancellation.is_cancelled() {
        return Err(abort());
    }

    // The PKCE challenge and the state of the authorization request
    dispatch(TrinoAction::GeneratingPkceChallenge);
    let (pkce, state) = match cancellable(&cancellation, generate(&*host)).await {
        None => return Err(abort()),
        Some(Err(error)) => return Err(fail_host(error)),
        Some(Ok(generated)) => generated,
    };
    dispatch(TrinoAction::GeneratedPkceChallenge);
    let callback_url =
        if oauth.callback_url.is_empty() { DEFAULT_OAUTH_CALLBACK_URL.to_string() } else { oauth.callback_url.clone() };
    let url = authorization_url(&oauth, &callback_url, &pkce, &state, force_relogin);
    if cancellation.is_cancelled() {
        return Err(abort());
    }

    // The login in the browser, the host reports an opened browser while the flow waits for the callback
    let authorizing = Rc::new(Cell::new(true));
    let events: OAuthEvents = {
        let host = host.clone();
        let authorizing = authorizing.clone();
        Rc::new(move |event| {
            if event == OAuthFlowEvent::ExternalBrowserOpened && authorizing.get() {
                host.dispatch(&ConnectionAction::Trino(TrinoAction::OAuthBrowserOpened));
            }
        })
    };
    host.log(LogLevel::Debug, "Opening OAuth URL", &[("target", LOG_TARGET)]);
    let login = host.authorize_with_loopback(&url, &callback_url, events, &cancellation);
    let callback = cancellable(&cancellation, login).await;
    authorizing.set(false);
    let callback: OAuthCallback = match callback {
        None => return Err(abort()),
        Some(Err(error)) => return Err(fail_host(error)),
        Some(Ok(callback)) => callback,
    };
    if let Some(error) = callback.error.filter(|error| !error.is_empty()) {
        let message = callback.error_description.filter(|description| !description.is_empty()).unwrap_or(error);
        return Err(fail(message, Default::default(), None));
    }
    if callback.state.as_deref() != Some(state.as_str()) {
        return Err(fail(
            "OAuth callback state does not match the authorization request".into(),
            Default::default(),
            None,
        ));
    }
    let Some(code) = callback.code.filter(|code| !code.is_empty()) else {
        return Err(fail("No authorization code received".into(), Default::default(), None));
    };
    dispatch(TrinoAction::ReceivedOAuthCode { created_at: iso_timestamp(host.now() as i64) });

    // The access token for the code
    dispatch(TrinoAction::RequestingAccessToken);
    if cancellation.is_cancelled() {
        return Err(abort());
    }
    let request = token_request(
        &oauth.token_url,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &oauth.client_id),
            ("code", &code),
            ("redirect_uri", &callback_url),
            ("code_verifier", &pkce.verifier),
        ],
    );
    let outcome = match cancellable(&cancellation, host.fetch(request, &cancellation)).await {
        None => return Err(abort()),
        Some(Ok(response)) => FetchOutcome::Response(response),
        Some(Err(error)) => FetchOutcome::NetworkError(error.message().to_string()),
    };
    let token =
        read_token_response(&outcome, host.now() as i64).map_err(|error| fail(error.message, error.data, None))?;
    dispatch(TrinoAction::ReceivedAccessToken);
    channel.access_token = Some(token);
    dispatch(TrinoAction::ChannelSetupStarted { params });
    dispatch(TrinoAction::ChannelReady(SharedTrinoChannel::new(channel)));
    Ok(())
}

/// The URL of the login: the PKCE challenge, the state, the scopes and the redirect
fn authorization_url(
    oauth: &TrinoOAuthParams,
    callback_url: &str,
    pkce: &OAuthPkceChallenge,
    state: &str,
    force_relogin: bool,
) -> String {
    let scopes = if oauth.scopes.is_empty() { DEFAULT_OAUTH_SCOPES.join(" ") } else { oauth.scopes.join(" ") };
    let mut fields = vec![
        ("client_id", oauth.client_id.as_str()),
        ("redirect_uri", callback_url),
        ("response_type", "code"),
        ("code_challenge", pkce.value.as_str()),
        ("code_challenge_method", "S256"),
        ("scope", scopes.as_str()),
        ("state", state),
    ];
    if force_relogin {
        // Make the identity provider authenticate again instead of reusing a session cookie of the browser
        fields.push(("prompt", "login"));
    }
    format!("{}?{}", oauth.authorization_url, form_encode(fields.iter().copied()))
}

/// The end of a cancelled setup
fn cancelled<H: SetupHost>(host: &H) -> SetupFailure {
    host.log(LogLevel::Info, "Cancelled setup", &[("target", LOG_TARGET)]);
    SetupFailure::cancelled()
}

/// The PKCE challenge and the state of the authorization request
async fn generate<H: OAuthHost>(host: &H) -> Result<(OAuthPkceChallenge, String), HostError> {
    let pkce = host.generate_pkce().await?;
    let state = host.random_id()?;
    if state.is_empty() {
        return Err(HostError::new("The platform generated no random state for the OAuth flow"));
    }
    Ok((pkce, state))
}
