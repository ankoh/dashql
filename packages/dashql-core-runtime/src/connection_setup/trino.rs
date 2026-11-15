//! The setup of a Trino connection: drives `TrinoSetup` over the host.
//!
//! Basic auth opens the channel right away. OAuth asks the host for the PKCE challenge and the state, opens the login
//! with the loopback redirect of the platform, requests the access token over fetch and opens the channel with it. The
//! health check is a step of its own (`check_health`), the caller runs it once the channel is ready.
//!
//! Ported from `packages/dashql-runtime/src/connections/trino/trino_connection_setup.ts`.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use super::{cancellable, OAuthHost, SetupFailure, SetupHost, LOG_TARGET};
use crate::connections::{ChannelId, JsonObject};
use crate::host::{HostError, LogLevel};
use crate::http::{CancellationToken, FetchOutcome};
use crate::salesforce::OAuthFlowEvent;
use crate::trino::{SetupOutput, TrinoErrorKind, TrinoSetup, TrinoSetupOptions};

/// The id of the channel of a Trino setup, the host keeps the channels of one setup
pub const TRINO_SETUP_CHANNEL: ChannelId = 1;

/// Set up a Trino connection with its params, returns the id of the channel that the host keeps
pub async fn setup_trino<H: SetupHost>(
    host: Rc<H>,
    params: JsonObject,
    force_relogin: bool,
    cancellation: CancellationToken,
) -> Result<ChannelId, SetupFailure> {
    let options = TrinoSetupOptions { force_relogin, health_check: false };
    let (setup, outputs) = TrinoSetup::start(&params, TRINO_SETUP_CHANNEL, options);
    let setup = Rc::new(RefCell::new(setup));
    let mut queue: VecDeque<SetupOutput> = outputs.into();
    // A setup that is cancelled before it starts reports its start and its cancellation
    if cancellation.is_cancelled() && matches!(queue.front(), Some(SetupOutput::Dispatch(_))) {
        queue.truncate(1);
        queue.extend(setup.borrow_mut().abort());
    }
    // What the host failed with, the caller gets it back
    let mut host_value = None;
    while let Some(output) = queue.pop_front() {
        let next = match output {
            SetupOutput::Dispatch(action) => {
                host.dispatch(&action);
                continue;
            }
            SetupOutput::Succeeded => return Ok(TRINO_SETUP_CHANNEL),
            SetupOutput::Failed(error) => {
                if error.kind == TrinoErrorKind::Aborted {
                    host.log(LogLevel::Info, "Cancelled setup", &[("target", LOG_TARGET)]);
                    return Err(SetupFailure::cancelled());
                }
                host.log(LogLevel::Warn, "Setup failed", &[("target", LOG_TARGET), ("error", &error.message)]);
                let mut failure = SetupFailure::failed(error.message).with_value(host_value);
                failure.data = error.data;
                return Err(failure);
            }
            // A step of the host, the setup stops at a cancellation first
            _ if cancellation.is_cancelled() => setup.borrow_mut().abort(),
            SetupOutput::GeneratePkce => match cancellable(&cancellation, generate(&*host)).await {
                None => setup.borrow_mut().abort(),
                Some(Ok((pkce, state))) => setup.borrow_mut().on_pkce(pkce, state),
                Some(Err(error)) => fail(&setup, &error, &mut host_value),
            },
            SetupOutput::Authorize { url, callback_url } => {
                // The host reports an opened browser while the flow waits for the callback
                let events: super::OAuthEvents = {
                    let host = host.clone();
                    let setup = setup.clone();
                    Rc::new(move |event| {
                        if event != OAuthFlowEvent::ExternalBrowserOpened {
                            return;
                        }
                        let outputs = setup.try_borrow_mut().map(|mut setup| setup.on_browser_opened()).unwrap_or_default();
                        for output in outputs {
                            if let SetupOutput::Dispatch(action) = output {
                                host.dispatch(&action);
                            }
                        }
                    })
                };
                host.log(LogLevel::Debug, "Opening OAuth URL", &[("target", LOG_TARGET)]);
                let call = host.authorize_with_loopback(&url, &callback_url, events, &cancellation);
                match cancellable(&cancellation, call).await {
                    None => setup.borrow_mut().abort(),
                    Some(Ok(callback)) => {
                        let now = host.now() as i64;
                        setup.borrow_mut().on_callback(callback, now)
                    }
                    Some(Err(error)) => fail(&setup, &error, &mut host_value),
                }
            }
            SetupOutput::RequestToken(request) => {
                let outcome = match cancellable(&cancellation, host.fetch(request, &cancellation)).await {
                    None => {
                        queue.extend(setup.borrow_mut().abort());
                        continue;
                    }
                    Some(Ok(response)) => FetchOutcome::Response(response),
                    Some(Err(error)) => FetchOutcome::NetworkError(error.message().to_string()),
                };
                let now = host.now() as i64;
                setup.borrow_mut().on_token_response(&outcome, now)
            }
            SetupOutput::OpenChannel { id, channel } => match host.open_trino_channel(id, &channel) {
                Ok(()) => setup.borrow_mut().on_channel_opened(),
                Err(error) => fail(&setup, &error, &mut host_value),
            },
            // The setup doesn't run the health check, the caller runs it on the channel
            SetupOutput::RunHealthCheck { .. } => setup.borrow_mut().fail("The setup doesn't run the health check"),
        };
        queue.extend(next);
    }
    Err(SetupFailure::failed("The Trino setup ended without a channel"))
}

/// The PKCE challenge and the state of the authorization request
async fn generate<H: OAuthHost>(host: &H) -> Result<(crate::connections::OAuthPkceChallenge, String), HostError> {
    let pkce = host.generate_pkce().await?;
    Ok((pkce, host.random_id()))
}

/// A step of the host failed, the setup keeps what the host failed with
fn fail(setup: &RefCell<TrinoSetup>, error: &HostError, host_value: &mut Option<crate::executor::HostValue>) -> Vec<SetupOutput> {
    *host_value = error.value().cloned();
    setup.borrow_mut().fail(error.message())
}
