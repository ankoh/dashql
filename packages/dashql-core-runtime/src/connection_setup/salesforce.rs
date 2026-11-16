//! The setup of a Salesforce or Database.com connection: drives `SalesforceSetup` over the host.
//!
//! The host generates the PKCE challenge and the flow id, opens the authorization page through the redirect page of the
//! app and hands back its callback. The setup exchanges the code for the core token, reads the user info, exchanges
//! the core token for the Data Cloud token over fetch and hands the channel with the tokens to the connection.
//! `authenticate_salesforce` is a login without a connection, e.g. of the shell: its listener hears the names of the
//! steps (`LoginStep`), the tokens are in its outcome.
//!
//! Ported from `packages/dashql/src/runtime/connections/salesforce/salesforce_connection_setup.ts` and
//! `salesforce_authentication.ts`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::{cancellable, SetupFailure, SetupHost, CANCELLED_MESSAGE};
use crate::connections::{ConnectionAction, ConnectorType, JsonObject, SalesforceAction};
use crate::executor::HostValue;
use crate::host::LogLevel;
use crate::http::CancellationToken;
use crate::salesforce::setup::{SalesforceSetupLog, SalesforceSetupResult};
use crate::salesforce::{
    SalesforceCoreUserInfo, SalesforceOAuthConfig, SalesforceSetup, SalesforceSetupOutput, SalesforceSetupStep,
    SalesforceTokens,
};

/// The target of the log messages of the setup
const LOG_TARGET: &str = "salesforce_setup";

/// The tokens of a login, without a channel
#[derive(Debug, Clone, PartialEq)]
pub struct SalesforceAuthentication {
    pub tokens: SalesforceTokens,
    pub user_info: Option<SalesforceCoreUserInfo>,
}

/// A step of a login as its listener hears it: the progress, never a code, a verifier or a token
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginStep {
    Started,
    Cancelled,
    Failed,
    GeneratingPkceChallenge,
    GeneratedPkceChallenge,
    NativeLinkOpened,
    WebWindowOpened,
    WebWindowClosed,
    ReceivedCoreAuthCode,
    RequestingCoreAuthToken,
    ReceivedCoreAuthToken,
    ReceivedCoreUserInfo,
    RequestingDataCloudAccessToken,
    ReceivedDataCloudAccessToken,
}

impl LoginStep {
    /// The step of a login of an action of the setup, none for the steps of the channel
    pub fn of(action: &ConnectionAction) -> Option<Self> {
        let ConnectionAction::Salesforce(action) = action else { return None };
        Some(match action {
            SalesforceAction::SetupStarted { .. } => LoginStep::Started,
            SalesforceAction::SetupCancelled(_) => LoginStep::Cancelled,
            SalesforceAction::SetupFailed(_) => LoginStep::Failed,
            SalesforceAction::GeneratingPkceChallenge => LoginStep::GeneratingPkceChallenge,
            SalesforceAction::GeneratedPkceChallenge => LoginStep::GeneratedPkceChallenge,
            SalesforceAction::OAuthNativeLinkOpened => LoginStep::NativeLinkOpened,
            SalesforceAction::OAuthWebWindowOpened => LoginStep::WebWindowOpened,
            SalesforceAction::OAuthWebWindowClosed => LoginStep::WebWindowClosed,
            SalesforceAction::ReceivedCoreAuthCode { .. } => LoginStep::ReceivedCoreAuthCode,
            SalesforceAction::RequestingCoreAuthToken => LoginStep::RequestingCoreAuthToken,
            SalesforceAction::ReceivedCoreAuthToken => LoginStep::ReceivedCoreAuthToken,
            SalesforceAction::ReceivedCoreUserInfo { .. } => LoginStep::ReceivedCoreUserInfo,
            SalesforceAction::RequestingDataCloudAccessToken => LoginStep::RequestingDataCloudAccessToken,
            SalesforceAction::ReceivedDataCloudAccessToken => LoginStep::ReceivedDataCloudAccessToken,
            SalesforceAction::ChannelSetupStarted
            | SalesforceAction::ChannelSetupCancelled(_)
            | SalesforceAction::ChannelSetupFailed(_)
            | SalesforceAction::ChannelReady(_) => return None,
        })
    }

    /// The name of the step, the name of the action of the setup
    pub fn name(self) -> &'static str {
        match self {
            LoginStep::Started => "SETUP_STARTED",
            LoginStep::Cancelled => "SETUP_CANCELLED",
            LoginStep::Failed => "SETUP_FAILED",
            LoginStep::GeneratingPkceChallenge => "GENERATING_PKCE_CHALLENGE",
            LoginStep::GeneratedPkceChallenge => "GENERATED_PKCE_CHALLENGE",
            LoginStep::NativeLinkOpened => "OAUTH_NATIVE_LINK_OPENED",
            LoginStep::WebWindowOpened => "OAUTH_WEB_WINDOW_OPENED",
            LoginStep::WebWindowClosed => "OAUTH_WEB_WINDOW_CLOSED",
            LoginStep::ReceivedCoreAuthCode => "RECEIVED_CORE_AUTH_CODE",
            LoginStep::RequestingCoreAuthToken => "REQUESTING_CORE_AUTH_TOKEN",
            LoginStep::ReceivedCoreAuthToken => "RECEIVED_CORE_AUTH_TOKEN",
            LoginStep::ReceivedCoreUserInfo => "RECEIVED_CORE_USER_INFO",
            LoginStep::RequestingDataCloudAccessToken => "REQUESTING_DATA_CLOUD_ACCESS_TOKEN",
            LoginStep::ReceivedDataCloudAccessToken => "RECEIVED_DATA_CLOUD_ACCESS_TOKEN",
        }
    }
}

/// Set up a Salesforce or Database.com connection with its params, returns the tokens and the user info. The connection
/// takes the channel with the ready step.
pub async fn setup_salesforce<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceSetupResult, SetupFailure> {
    run(host, connector, params, config, force_relogin, cancellation).await
}

/// Log in to Salesforce and get the tokens, without a connection. The steps go to the host as the actions of a setup,
/// its listener hears them as `LoginStep`s.
pub async fn authenticate_salesforce<H: SetupHost>(
    host: Rc<H>,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceAuthentication, SetupFailure> {
    let connector = ConnectorType::SalesforceDataCloud;
    let result = run(host, connector, params, config, force_relogin, cancellation).await?;
    Ok(SalesforceAuthentication { tokens: result.tokens, user_info: result.user_info })
}

/// Apply the actions and the log of an output, the message of a failure if the setup failed
fn report<H: SetupHost>(host: &H, output: &SalesforceSetupOutput) -> Option<String> {
    let mut failure = None;
    for action in &output.actions {
        if let SalesforceAction::SetupFailed(error) = action {
            failure = Some(error.message.clone());
        }
        host.dispatch(&ConnectionAction::Salesforce(action.clone()));
    }
    for SalesforceSetupLog { warning, message, details } in &output.log {
        let mut pairs: Vec<(&str, &str)> = vec![("target", LOG_TARGET)];
        pairs.extend(details.iter().map(|(key, value)| (key.as_str(), value.as_str())));
        host.log(if *warning { LogLevel::Warn } else { LogLevel::Info }, message, &pairs);
    }
    failure
}

async fn run<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceSetupResult, SetupFailure> {
    let (setup, output) = SalesforceSetup::start(connector, &params, config, host.flow_info(), force_relogin);
    let setup = Rc::new(RefCell::new(setup));
    let mut output = output;
    // A setup that is cancelled before it starts reports its start and its cancellation
    let mut cancelled = false;
    if cancellation.is_cancelled() {
        output.actions.truncate(1);
        report(&*host, &output);
        cancelled = true;
        output = setup.borrow_mut().cancel(CANCELLED_MESSAGE);
    }
    // What the host failed with, the caller gets it back
    let mut host_value: Option<HostValue> = None;
    loop {
        let failure = report(&*host, &output);
        let step = output.step.clone();
        output = match step {
            SalesforceSetupStep::Done(result) => return Ok(result),
            SalesforceSetupStep::Stopped if cancelled => return Err(SetupFailure::cancelled()),
            SalesforceSetupStep::Stopped => {
                let message = failure.unwrap_or_else(|| "The Salesforce setup stopped".to_string());
                return Err(SetupFailure::failed(message).with_value(host_value));
            }
            // A step of the host, the setup stops at a cancellation first
            _ if cancellation.is_cancelled() => {
                cancelled = true;
                setup.borrow_mut().cancel(CANCELLED_MESSAGE)
            }
            SalesforceSetupStep::GeneratePkce => {
                let generated = cancellable(&cancellation, host.generate_pkce()).await;
                let now = host.now();
                match generated {
                    None => {
                        cancelled = true;
                        setup.borrow_mut().cancel(CANCELLED_MESSAGE)
                    }
                    // The flow id binds the callback to this flow, a flow without one fails
                    Some(Ok(pkce)) => match host.random_id() {
                        Ok(flow_id) if !flow_id.is_empty() => setup.borrow_mut().on_pkce(pkce, &flow_id, now),
                        Ok(_) => setup.borrow_mut().on_host_failed("The platform generated no flow id for the OAuth flow"),
                        Err(error) => {
                            host_value = error.value().cloned();
                            setup.borrow_mut().on_host_failed(error.message())
                        }
                    },
                    Some(Err(error)) => {
                        host_value = error.value().cloned();
                        setup.borrow_mut().on_host_failed(error.message())
                    }
                }
            }
            SalesforceSetupStep::Authorize { url, flow_id } => {
                // The host reports the authorization page while the setup waits for the callback
                let awaiting = Rc::new(Cell::new(true));
                let events: super::OAuthEvents = {
                    let host = host.clone();
                    let setup = setup.clone();
                    let awaiting = awaiting.clone();
                    Rc::new(move |event| {
                        if !awaiting.get() {
                            return;
                        }
                        let Ok(mut setup) = setup.try_borrow_mut() else { return };
                        let output = setup.on_flow_event(event);
                        drop(setup);
                        report(&*host, &output);
                    })
                };
                let call = host.authorize_with_redirect_page(&url, &flow_id, events, &cancellation);
                let callback = cancellable(&cancellation, call).await;
                awaiting.set(false);
                let now = host.now();
                match callback {
                    None => {
                        cancelled = true;
                        setup.borrow_mut().cancel(CANCELLED_MESSAGE)
                    }
                    Some(Ok(callback)) => setup.borrow_mut().on_callback(&callback, now),
                    Some(Err(error)) => {
                        host_value = error.value().cloned();
                        setup.borrow_mut().on_host_failed(error.message())
                    }
                }
            }
            SalesforceSetupStep::AwaitCallback => setup.borrow_mut().on_host_failed("The Salesforce setup lost its callback"),
            SalesforceSetupStep::Fetch(request) => {
                let response = cancellable(&cancellation, host.fetch(request, &cancellation)).await;
                let now = host.now();
                match response {
                    None => {
                        cancelled = true;
                        setup.borrow_mut().cancel(CANCELLED_MESSAGE)
                    }
                    Some(Ok(response)) => setup.borrow_mut().on_response(&response, now),
                    Some(Err(error)) => setup.borrow_mut().on_fetch_failed(error.message()),
                }
            }
        };
    }
}
