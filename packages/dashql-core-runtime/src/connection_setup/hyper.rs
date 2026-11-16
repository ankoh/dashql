//! The setup of a Hyper connection: which channel the params ask for and the actions of the connection.
//!
//! The embedded Hyper (`WASM`) and the gRPC channel of the desktop app (`V3_GRPC`, through its native proxy) are
//! channels of the host. A Hyper over HTTP (`V3_HTTP`) and the Hyper of a link (`V3_HTTP_LINK`, its HTTP API with the
//! token of the link) are channels that the module speaks itself: the setup resolves their params and the connection
//! keeps the channel with the headers of its requests. The token of a link is never stored, the page that opened the
//! link holds it and the channel keeps it in memory.
//!
//! Ported from `packages/dashql-app/src/connections/hyper/hyper_connection_setup.tsx`.

use std::rc::Rc;

use serde_json::Value;

use super::{connect_channel, SetupFailure, SetupHost, LOG_TARGET};
use crate::connections::{ConnectionAction, ConnectionChannel, DetailedError, HyperAction, JsonObject};
use crate::host::LogLevel;
use crate::http::CancellationToken;
use crate::hyper::link::hyper_link_channel_params;
use crate::hyper::{HyperChannelContext, HyperHttpChannel};

/// The message of a link whose token the page doesn't hold
pub const MISSING_LINK_TOKEN_MESSAGE: &str = "Open the link of this Hyper again, e.g. the one that `hyperd run --ui` prints";

/// What kind of channel a Hyper connection uses
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HyperChannelKind {
    /// The embedded Hyper of the platform
    Embedded,
    /// The gRPC API, through the native proxy of the desktop app
    Grpc,
    /// The HTTP API
    Http,
}

impl HyperChannelKind {
    pub fn name(self) -> &'static str {
        match self {
            HyperChannelKind::Embedded => "embedded",
            HyperChannelKind::Grpc => "grpc",
            HyperChannelKind::Http => "http",
        }
    }
}

/// The channel that a setup asks the host to connect
#[derive(Debug, Clone, PartialEq)]
pub struct HyperChannelRequest {
    pub kind: HyperChannelKind,
    /// The params of the channel: the params of the connection, those of a link with its token
    pub params: JsonObject,
}

/// The channel of the params of a connection, the token of a link if the page holds one
pub fn hyper_channel_request(params: &JsonObject, link_token: Option<&str>) -> Result<HyperChannelRequest, String> {
    let protocol = params.get("protocol").and_then(Value::as_str).unwrap_or("");
    match protocol {
        "WASM" => Ok(HyperChannelRequest { kind: HyperChannelKind::Embedded, params: params.clone() }),
        "V3_HTTP_LINK" => {
            let token = link_token.filter(|token| !token.is_empty()).ok_or_else(|| MISSING_LINK_TOKEN_MESSAGE.to_string())?;
            Ok(HyperChannelRequest { kind: HyperChannelKind::Http, params: hyper_link_channel_params(params, token) })
        }
        "V3_HTTP" => Ok(HyperChannelRequest { kind: HyperChannelKind::Http, params: params.clone() }),
        _ => Ok(HyperChannelRequest { kind: HyperChannelKind::Grpc, params: params.clone() }),
    }
}

/// The channel over the HTTP API of a request, with the metadata of the params as the headers of every request
fn http_channel(request: &HyperChannelRequest, client_context: Option<Value>) -> Result<ConnectionChannel, String> {
    let context = HyperChannelContext::from_params(&request.params, client_context);
    let auth = context.metadata.clone();
    let channel = HyperHttpChannel::connect(&request.params, context, None).map_err(|error| error.message())?;
    Ok(ConnectionChannel::HyperHttp { channel, auth })
}

/// Set up a Hyper connection with its params, the connection takes the channel with the ready step
pub async fn setup_hyper<H: SetupHost>(host: Rc<H>, params: JsonObject, cancellation: CancellationToken) -> Result<(), SetupFailure> {
    let mut params = params;
    params.remove("draftRows");
    host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() }));
    let cancel = |host: &H| {
        host.log(LogLevel::Warn, "Cancelled setup", &[("target", LOG_TARGET)]);
        host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(DetailedError::new(super::CANCELLED_MESSAGE))));
        Err(SetupFailure::cancelled())
    };
    let fail = |host: &H, failure: SetupFailure| {
        host.log(LogLevel::Warn, "Setup failed", &[("target", LOG_TARGET), ("error", &failure.message)]);
        let error = DetailedError { message: failure.message.clone(), data: failure.data.clone() };
        host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error)));
        Err(failure)
    };
    if cancellation.is_cancelled() {
        return cancel(&host);
    }
    let token = host.hyper_link_token();
    let request = match hyper_channel_request(&params, token.as_deref()) {
        Ok(request) => request,
        Err(message) => return fail(&host, SetupFailure::failed(message)),
    };
    // The module speaks the HTTP API itself
    if request.kind == HyperChannelKind::Http {
        let channel = match http_channel(&request, host.client_context()) {
            Ok(channel) => channel,
            Err(message) => return fail(&host, SetupFailure::failed(message)),
        };
        host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelReady { channel, params }));
        return Ok(());
    }
    // A cancellation stops the wait for the connect, a channel that is ready after it is closed
    let channel = match connect_channel(&host, host.connect_hyper_channel(&request, &cancellation), &cancellation).await {
        None => return cancel(&host),
        Some(Err(_)) if cancellation.is_cancelled() => return cancel(&host),
        Some(Err(error)) => {
            // The failure keeps the details of what the host failed with
            let mut failure = SetupFailure::failed(error.message()).with_value(error.value().cloned());
            failure.data = host.error_details(&error);
            return fail(&host, failure);
        }
        Some(Ok(channel)) => channel,
    };
    if cancellation.is_cancelled() {
        host.close_channel(channel);
        return cancel(&host);
    }
    host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelReady { channel: ConnectionChannel::Host(channel), params }));
    Ok(())
}
