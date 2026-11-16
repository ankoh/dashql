//! The setup of a Salesforce or Database.com connection: drives `SalesforceSetup` over the host.
//!
//! The host generates the PKCE challenge and the flow id, opens the authorization page through the redirect page of the
//! app and hands back its callback. The setup exchanges the code for the core token, reads the user info, exchanges
//! the core token for the Data Cloud token over fetch and asks the host to connect the Hyper channel with the tokens.
//! `authenticate_salesforce` stops before the channel, e.g. for the login of the shell.
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

/// How far a run goes
#[derive(Clone, Copy, PartialEq, Eq)]
enum Goal {
    /// The tokens
    Authenticate,
    /// The tokens and the channel
    Connect,
}

/// What a run ended with
enum End {
    Authenticated(SalesforceAuthentication),
    Connected(SalesforceSetupResult),
}

/// Set up a Salesforce or Database.com connection with its params, returns the tokens, the user info and the id of the
/// channel that the host keeps
pub async fn setup_salesforce<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceSetupResult, SetupFailure> {
    match run(host, connector, params, config, force_relogin, cancellation, Goal::Connect).await? {
        End::Connected(result) => Ok(result),
        End::Authenticated(_) => Err(SetupFailure::failed("The Salesforce setup ended without a channel")),
    }
}

/// Log in to Salesforce and get the tokens, without a channel. The steps go to the host as the actions of a setup.
pub async fn authenticate_salesforce<H: SetupHost>(
    host: Rc<H>,
    params: JsonObject,
    config: SalesforceOAuthConfig,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<SalesforceAuthentication, SetupFailure> {
    let connector = ConnectorType::SalesforceDataCloud;
    match run(host, connector, params, config, force_relogin, cancellation, Goal::Authenticate).await? {
        End::Authenticated(authentication) => Ok(authentication),
        End::Connected(result) => Ok(SalesforceAuthentication { tokens: result.tokens, user_info: result.user_info }),
    }
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
    goal: Goal,
) -> Result<End, SetupFailure> {
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
            SalesforceSetupStep::Done(result) => return Ok(End::Connected(result)),
            SalesforceSetupStep::Stopped if cancelled => return Err(SetupFailure::cancelled()),
            SalesforceSetupStep::Stopped => {
                let message = failure.unwrap_or_else(|| "The Salesforce setup stopped".to_string());
                return Err(SetupFailure::failed(message).with_value(host_value));
            }
            SalesforceSetupStep::ConnectChannel(channel) if goal == Goal::Authenticate => {
                let user_info = setup.borrow().user_info().cloned();
                return Ok(End::Authenticated(SalesforceAuthentication { tokens: channel.tokens, user_info }));
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
                    Some(Ok(pkce)) => {
                        let flow_id = host.random_id();
                        setup.borrow_mut().on_pkce(pkce, &flow_id, now)
                    }
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
            SalesforceSetupStep::ConnectChannel(channel) => {
                // A connect runs to its end, a channel that is ready after a cancellation is closed
                match host.connect_salesforce_channel(&channel, &cancellation).await {
                    Ok(id) if cancellation.is_cancelled() => {
                        host.close_channel(id);
                        cancelled = true;
                        setup.borrow_mut().cancel(CANCELLED_MESSAGE)
                    }
                    Err(_) if cancellation.is_cancelled() => {
                        cancelled = true;
                        setup.borrow_mut().cancel(CANCELLED_MESSAGE)
                    }
                    Ok(id) => setup.borrow_mut().on_channel_ready(id),
                    Err(error) => {
                        host_value = error.value().cloned();
                        setup.borrow_mut().on_channel_failed(error.message())
                    }
                }
            }
        };
    }
}
