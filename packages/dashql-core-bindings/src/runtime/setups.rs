//! The setups of the connections and the logins of the runtime (docs/design/dashql_core.md): the commands
//! `setupConnection`, `authenticateSalesforce` and `cancelSetup`.
//!
//! A setup drives the setup of the connector of its connection (`dashql_core_runtime::connection_setup`) on a host of
//! the runtime: its actions go to the connection right away, the OAuth flows, the requests and the channels go through
//! the platform, and the health check runs its probe as a query of the connection on the executor of the runtime. A
//! connection whose channel is ready but that is not online yet runs the health check. A setup is known by an id, the
//! id of its connection or of a login; a new setup of an id cancels the one that runs, a reset or a delete of the
//! connection cancels it as well. Params that don't read fail the setup before it cancels the one that runs. A login
//! has no connection: its listener hears the names of its steps (`LoginStep`), never a code, a verifier or a token,
//! and its outcome holds the tokens.

use std::collections::BTreeMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use dashql_core_runtime::connection_setup::{
    authenticate_salesforce, check_health, setup_hyper, setup_salesforce, setup_trino, HyperChannelRequest, LoginStep, OAuthCallback, OAuthEvents, OAuthHost,
    ProbeResult, SetupFailure, SetupHost, LOG_TARGET,
};
use dashql_core_runtime::connections::open_setup::OpenSetup;
use dashql_core_runtime::connections::{
    ChannelId, ConnectionAction, ConnectionHealth, ConnectorType, DetailedError, HyperAction, JsonObject, OAuthPkceChallenge, SalesforceAction,
    TrinoAction,
};
use dashql_core_runtime::executor::FailureKind;
use dashql_core_runtime::host::{Host, HostError, LogLevel, OnHost};
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::QueryMetadata;
use dashql_core_runtime::salesforce::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, SalesforceOAuthConfig, SalesforceTokens};
use js_sys::Function;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tsify::Tsify;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use super::changes::Slice;
use super::connections::Connections;
use crate::runtime::connections::view::JsonParams;
use crate::host::{field, host_value, JsPlatform};
use crate::views::JsonValue;

/// How a setup runs
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct SetupOptions {
    /// The params of the setup, the params of the connection by default
    #[serde(default)]
    #[tsify(optional)]
    pub params: Option<JsonParams>,
    /// The params that the channel connects with when they differ from the ones that the connection keeps, e.g. the
    /// credentials of the environment that are never written
    #[serde(default)]
    #[tsify(optional)]
    pub channel_params: Option<JsonParams>,
    /// Log in again instead of using a session of the browser
    #[serde(default)]
    #[tsify(optional)]
    pub force_relogin: Option<bool>,
    /// The redirect page of the app that an OAuth flow of Salesforce returns to
    #[serde(default)]
    #[tsify(optional)]
    pub oauth_redirect: Option<String>,
}

/// The tokens and the user of a login
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct SetupAuthentication {
    #[tsify(type = "{ core: any; dataCloud: any }")]
    pub tokens: JsonValue,
    #[tsify(type = "any | null")]
    pub user_info: Option<JsonValue>,
}

/// How a setup or a login ended
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct SetupOutcome {
    #[tsify(type = "'succeeded' | 'failed' | 'cancelled'")]
    pub status: &'static str,
    /// The error of a setup that didn't succeed
    pub message: Option<String>,
    /// The details of the error, e.g. the status of a rejected request
    pub data: BTreeMap<String, String>,
    /// The tokens of a login
    pub authentication: Option<SetupAuthentication>,
}

impl SetupOutcome {
    fn succeeded(authentication: Option<SetupAuthentication>) -> Self {
        SetupOutcome { status: "succeeded", message: None, data: BTreeMap::new(), authentication }
    }

    fn of(failure: SetupFailure) -> Self {
        let status = if failure.cancelled { "cancelled" } else { "failed" };
        SetupOutcome { status, message: Some(failure.message), data: failure.data, authentication: None }
    }
}

/// A setup that runs
pub(crate) struct RunningSetup {
    /// The id of the setup, the id of its connection or of a login
    pub id: String,
    /// The number of the setup, a later setup of the same id has a larger one
    pub number: u64,
    /// Cancels the setup
    pub token: CancellationToken,
}

/// The host of a setup: the platform and the connection of the setup
pub(crate) struct RuntimeSetupHost {
    connections: Weak<Connections>,
    platform: JsPlatform,
    /// The id of the setup
    setup_id: String,
    /// The connection that the actions go to, none for a login
    connection_id: Option<String>,
    /// The setup attempt of the connection that the actions belong to, the connection ignores them once a later setup,
    /// a reset or a delete replaced the attempt
    epoch: u64,
    /// The params that the connection keeps when the channel connects with others
    kept_params: Option<JsonObject>,
    /// The listener of the steps of a login, it hears their names
    events: Option<Function>,
}

/// The event of an OAuth flow by its name
fn flow_event(name: &str) -> Option<OAuthFlowEvent> {
    match name {
        "WINDOW_OPENED" => Some(OAuthFlowEvent::WindowOpened),
        "WINDOW_CLOSED" => Some(OAuthFlowEvent::WindowClosed),
        "EXTERNAL_BROWSER_OPENED" => Some(OAuthFlowEvent::ExternalBrowserOpened),
        _ => None,
    }
}

/// The callback of the events of a flow. It lives while the flow runs, the platform must not call it afterwards.
fn events_callback(events: OAuthEvents) -> Closure<dyn FnMut(JsValue)> {
    Closure::wrap(Box::new(move |event: JsValue| {
        if let Some(event) = event.as_string().as_deref().and_then(flow_event) {
            events(event);
        }
    }) as Box<dyn FnMut(JsValue)>)
}

fn string_field(value: &JsValue, name: &str) -> Option<String> {
    field(value, name).and_then(|value| value.as_string())
}

/// A JSON value as a JS value, objects as plain objects
fn js_json(value: Value) -> JsValue {
    JsonValue(value).to_js().unwrap_or(JsValue::NULL)
}

/// The tokens of Salesforce as JSON
fn tokens_json(tokens: &SalesforceTokens) -> Value {
    json!({
        "core": serde_json::to_value(&tokens.core).unwrap_or(Value::Null),
        "dataCloud": serde_json::to_value(&tokens.data_cloud).unwrap_or(Value::Null),
    })
}

impl RuntimeSetupHost {
    /// An action with the params that the connection keeps
    fn kept(&self, action: &ConnectionAction) -> ConnectionAction {
        let Some(params) = &self.kept_params else { return action.clone() };
        match action {
            ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { .. }) => {
                ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: params.clone() })
            }
            ConnectionAction::Trino(TrinoAction::OAuthStarted { .. }) => ConnectionAction::Trino(TrinoAction::OAuthStarted { params: params.clone() }),
            ConnectionAction::Salesforce(SalesforceAction::SetupStarted { .. }) => {
                ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params: params.clone() })
            }
            ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { .. }) => {
                ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() })
            }
            ConnectionAction::Hyper(HyperAction::ChannelReady { channel, .. }) => {
                ConnectionAction::Hyper(HyperAction::ChannelReady { channel: channel.clone(), params: params.clone() })
            }
            action => action.clone(),
        }
    }

    /// Connect a channel through the platform
    fn connect(&self, request: Value) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        self.platform.connect_channel(&self.setup_id, &js_json(request))
    }
}

impl OnHost for RuntimeSetupHost {
    type Inner = JsPlatform;

    fn inner_host(&self) -> &JsPlatform {
        &self.platform
    }

    /// The detail `target` names the target of the log
    fn log_on_host(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let target = details.iter().find(|(key, _)| *key == "target").map_or(LOG_TARGET, |(_, value)| value);
        let mut details: Vec<(&str, &str)> = details.iter().filter(|(key, _)| *key != "target").copied().collect();
        if let Some(connection_id) = &self.connection_id {
            details.push(("connectionId", connection_id));
        }
        self.platform.log_on(level, message, &details, target);
    }
}

impl HttpHost for RuntimeSetupHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, false)
    }
}

impl OAuthHost for RuntimeSetupHost {
    fn generate_pkce(&self) -> impl Future<Output = Result<OAuthPkceChallenge, HostError>> + 'static {
        let pkce = self.platform.oauth_pkce();
        async move {
            let value = pkce.await?;
            let (Some(challenge), Some(verifier)) = (string_field(&value, "value"), string_field(&value, "verifier")) else {
                return Err(HostError::new("the platform generated no PKCE challenge"));
            };
            Ok(OAuthPkceChallenge { value: challenge, verifier })
        }
    }

    fn random_id(&self) -> Result<String, HostError> {
        self.platform.random_uuid()
    }

    fn flow_info(&self) -> OAuthFlowInfo {
        let value = self.platform.oauth_flow_info(&self.setup_id);
        OAuthFlowInfo {
            redirect_variant: string_field(&value, "redirectVariant").unwrap_or_default(),
            redirect_callback_url: string_field(&value, "redirectCallbackUrl"),
            debug_mode: field(&value, "debugMode").and_then(|debug| debug.as_bool()).unwrap_or(false),
            flavor: string_field(&value, "flavor"),
        }
    }

    fn authorize_with_loopback(
        &self,
        url: &str,
        callback_url: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthCallback, HostError>> + 'static {
        let callback = events_callback(events);
        let args = [JsValue::from_str(url), JsValue::from_str(callback_url), callback.as_ref().clone()];
        let flow = self.platform.oauth_authorize("authorizeWithLoopback", &self.setup_id, &args, cancellation);
        async move {
            let value = flow.await;
            drop(callback);
            let value = value?;
            Ok(OAuthCallback {
                code: string_field(&value, "code"),
                state: string_field(&value, "state"),
                error: string_field(&value, "error"),
                error_description: string_field(&value, "errorDescription"),
            })
        }
    }

    fn authorize_with_redirect_page(
        &self,
        url: &str,
        flow_id: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthRedirectData, HostError>> + 'static {
        let callback = events_callback(events);
        let args = [JsValue::from_str(url), JsValue::from_str(flow_id), callback.as_ref().clone()];
        let flow = self.platform.oauth_authorize("authorizeWithRedirectPage", &self.setup_id, &args, cancellation);
        async move {
            let value = flow.await;
            drop(callback);
            serde_json::from_value(JsonValue::of(&value?).0).map_err(|e| HostError::new(format!("invalid OAuth callback: {e}")))
        }
    }
}

impl SetupHost for RuntimeSetupHost {
    fn dispatch(&self, action: &ConnectionAction) {
        // A login reports the names of its steps to its listener
        let Some(connection_id) = &self.connection_id else {
            if let (Some(events), Some(step)) = (&self.events, LoginStep::of(action)) {
                let _ = events.call1(&JsValue::NULL, &JsValue::from_str(step.name()));
            }
            return;
        };
        let Some(connections) = self.connections.upgrade() else { return };
        let step = ConnectionAction::SetupStep { epoch: self.epoch, step: Box::new(self.kept(action)) };
        connections.apply_setup_step(connection_id, step);
    }

    fn connect_hyper_channel(
        &self,
        channel: &HyperChannelRequest,
        _cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        self.connect(json!({ "type": "hyper", "kind": channel.kind.name(), "params": channel.params }))
    }

    fn hyper_link_token(&self) -> Option<String> {
        self.platform.hyper_link_token(self.connection_id.as_deref()?)
    }

    /// The queries of the connection, the ones of the user, as the Hyper log attributes them
    fn client_context(&self) -> Option<Value> {
        let connection_id = self.connection_id.as_deref()?;
        Some(json!({ "dashql": { "connectionId": connection_id, "queryType": "user" } }))
    }

    fn close_channel(&self, id: ChannelId) {
        self.platform.push_close(id);
    }

    fn error_details(&self, error: &HostError) -> BTreeMap<String, String> {
        let value = host_value(error.value());
        let Some(key_values) = field(&value, "keyValues") else { return BTreeMap::new() };
        match JsonValue::of(&key_values).0 {
            Value::Object(values) => values.into_iter().filter_map(|(key, value)| Some((key, value.as_str()?.to_string()))).collect(),
            _ => BTreeMap::new(),
        }
    }

    fn run_probe(
        &self,
        query: &str,
        metadata: &QueryMetadata,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static {
        // The probe runs on the channel that the connection took when it was ready
        let probe = match (self.connections.upgrade(), &self.connection_id) {
            (Some(connections), Some(connection_id)) => {
                Some(connections.run_internal(connection_id, query, metadata.clone(), None, false, cancellation).1)
            }
            _ => None,
        };
        async move {
            let Some(probe) = probe else { return Err(HostError::new("a login has no connection to check")) };
            match probe.await {
                Ok(table) => Ok(ProbeResult::Finished { has_table: table.is_some() }),
                Err(failure) if failure.kind == FailureKind::Cancelled => Err(HostError::new(failure.message)),
                Err(failure) => {
                    let mut error = DetailedError::new(failure.message);
                    error.data = failure.details.into_iter().collect();
                    Ok(ProbeResult::Failed(error))
                }
            }
        }
    }
}

/// The params of a connector of JSON params, e.g. the value of `trino` of `{"trino": {...}}`
fn connector_params(params: JsonParams, connector: ConnectorType) -> Result<JsonObject, String> {
    let params = params.connection_params().map_err(|error| error.what().to_string())?;
    if params.connector != connector {
        return Err(format!("the params are no params of {}", connector.connector().display_name()));
    }
    Ok(params.params)
}

impl Connections {
    /// Apply a step of a setup to its connection. The connection doesn't take the channel of a step that fails, a
    /// channel of the host that belongs to no connection is closed.
    pub(crate) fn apply_setup_step(self: &Rc<Self>, connection_id: &str, action: ConnectionAction) {
        let channel = action.ready_channel();
        if let Err(error) = self.apply(connection_id, action, None) {
            if let Some(channel) = channel {
                self.platform.push_close(channel);
            }
            self.log(LogLevel::Warn, error.what(), &[("connectionId", connection_id)]);
        }
    }

    /// Register a setup under its id, a setup of the same id that runs is cancelled. Returns the number of the setup
    /// and its token.
    fn start_setup(&self, setup_id: &str) -> (u64, CancellationToken) {
        let token = CancellationToken::new();
        let number = self.setup_numbers.get() + 1;
        self.setup_numbers.set(number);
        let previous = {
            let mut setups = self.setups.borrow_mut();
            let previous = setups.iter().position(|setup| setup.id == setup_id).map(|index| setups.swap_remove(index).token);
            setups.push(RunningSetup { id: setup_id.to_string(), number, token: token.clone() });
            previous
        };
        if let Some(previous) = previous {
            previous.cancel();
        }
        // The id of the setup of a connection is the id of the connection, its view shows that a setup runs
        self.platform.changed(Slice::Connection(setup_id), true);
        (number, token)
    }

    /// Forget a setup that ended, unless another one of its id replaced it
    fn end_setup(&self, setup_id: &str, number: u64) {
        self.setups.borrow_mut().retain(|setup| !(setup.id == setup_id && setup.number == number));
        self.platform.changed(Slice::Connection(setup_id), true);
    }

    /// Cancel the setup of an id that runs
    pub(crate) fn cancel_setup(&self, setup_id: &str) {
        let token = self.setups.borrow().iter().find(|setup| setup.id == setup_id).map(|setup| setup.token.clone());
        if let Some(token) = token {
            token.cancel();
        }
    }

    /// Does a setup of an id run?
    pub(crate) fn setup_running(&self, setup_id: &str) -> bool {
        self.setups.borrow().iter().any(|setup| setup.id == setup_id)
    }

    /// A host of a setup. The setup of a connection begins a setup attempt of the connection, its steps carry it.
    fn setup_host(self: &Rc<Self>, setup_id: &str, connection_id: Option<String>, kept_params: Option<JsonObject>, events: Option<Function>) -> Rc<RuntimeSetupHost> {
        let epoch = connection_id
            .as_deref()
            .and_then(|connection_id| self.registry.borrow().get(connection_id).cloned())
            .map(|connection| connection.state.borrow_mut().begin_setup())
            .unwrap_or_default();
        if let Some(connection_id) = connection_id.as_deref() {
            self.platform.changed(Slice::Connection(connection_id), true);
        }
        Rc::new(RuntimeSetupHost {
            connections: Rc::downgrade(self),
            platform: self.platform.clone(),
            setup_id: setup_id.to_string(),
            connection_id,
            epoch,
            kept_params,
            events,
        })
    }

    /// Set up a connection with its connector and check its health, see `Runtime.setupConnection`
    pub(crate) fn setup(self: &Rc<Self>, connection_id: String, options: SetupOptions) -> impl Future<Output = SetupOutcome> + 'static {
        let prepared = (|| -> Result<(ConnectorType, JsonObject, Option<JsonObject>), String> {
            let registry = self.registry.borrow();
            let connection = registry.get(&connection_id).ok_or_else(|| format!("no connection registered with id {connection_id}"))?;
            let state = connection.state.borrow();
            let connector = state.connector_type();
            let params = match options.params {
                Some(params) => connector_params(params, connector)?,
                None => state.params().without_draft_rows().params,
            };
            match options.channel_params {
                Some(channel) => Ok((connector, connector_params(channel, connector)?, Some(params))),
                None => Ok((connector, params, None)),
            }
        })();
        // Params that don't read fail the setup before it touches the connection: the setup that runs goes on. The
        // attempt of a setup begins right away, the steps of the setup that it cancelled change nothing from now on.
        let started = prepared.map(|(connector, params, kept)| {
            let (number, token) = self.start_setup(&connection_id);
            let host = self.setup_host(&connection_id, Some(connection_id.clone()), kept, None);
            (connector, params, number, token, host)
        });
        let connections = self.clone();
        async move {
            let (connector, params, number, token, host) = match started {
                Ok(started) => started,
                Err(message) => return SetupOutcome::of(SetupFailure::failed(message)),
            };
            let force_relogin = options.force_relogin.unwrap_or(false);
            let config = SalesforceOAuthConfig { oauth_redirect: options.oauth_redirect.unwrap_or_default() };
            let ready = match connector {
                ConnectorType::Hyper => setup_hyper(host.clone(), params, token.clone()).await,
                ConnectorType::Trino => setup_trino(host.clone(), params, force_relogin, token.clone()).await,
                ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => {
                    setup_salesforce(host.clone(), connector, params, config, force_relogin, token.clone()).await.map(|_| ())
                }
            };
            // A channel that is ready but not online yet answers a probe first
            let outcome = match ready {
                Ok(()) => {
                    let online = connections.health_of(&connection_id) == Some(ConnectionHealth::Online);
                    if online {
                        Ok(())
                    } else {
                        check_health(host, connector, token.clone()).await
                    }
                }
                Err(failure) => Err(failure),
            };
            connections.end_setup(&connection_id, number);
            match outcome {
                Ok(()) => SetupOutcome::succeeded(None),
                Err(failure) => SetupOutcome::of(failure),
            }
        }
    }

    /// Set up the connections of a workbook that the app opens and that need nothing of the user: the embedded Hyper
    /// and the Hyper of a link once the tab holds its token (`open_setup` of the crate). Every connection is considered
    /// once, a connection to the Hyper of a link once per link. The setups run on their own, a failure is in the view
    /// of the connection and in the log.
    pub(crate) fn set_up_opened(self: &Rc<Self>, workbook_id: &str, connection_ids: Vec<String>) {
        for connection_id in connection_ids {
            // The token comes from JS, before anything is borrowed
            let token = self.platform.hyper_link_token(&connection_id);
            let decision = {
                let Ok(registry) = self.registry.try_borrow() else { continue };
                let Some(connection) = registry.get(&connection_id) else { continue };
                let Ok(state) = connection.state.try_borrow() else { continue };
                let Ok(mut open_setups) = self.open_setups.try_borrow_mut() else { continue };
                open_setups.consider(&state, token.as_deref())
            };
            match decision {
                OpenSetup::Skip => continue,
                OpenSetup::Setup => {}
                // The connection speaks to the Hyper of an earlier link
                OpenSetup::ResetAndSetup => {
                    if let Err(error) = self.apply(&connection_id, ConnectionAction::Reset, None) {
                        self.log(LogLevel::Warn, error.what(), &[("connectionId", &connection_id)]);
                    }
                }
            }
            let setup = self.setup(connection_id, SetupOptions::default());
            let connections = Rc::downgrade(self);
            let workbook_id = workbook_id.to_string();
            self.platform.spawn(Box::pin(async move {
                let outcome = setup.await;
                if let (Some(connections), "failed") = (connections.upgrade(), outcome.status) {
                    let error = outcome.message.unwrap_or_default();
                    connections.log(LogLevel::Warn, "Memory database setup failed", &[("workbookId", &workbook_id), ("error", &error)]);
                }
            }));
        }
    }

    /// The health of a connection, none for an unknown one
    fn health_of(&self, connection_id: &str) -> Option<ConnectionHealth> {
        self.registry.borrow().get(connection_id).map(|connection| connection.state.borrow().health())
    }

    /// Log in to Salesforce without a connection, see `Runtime.authenticateSalesforce`
    pub(crate) fn authenticate_salesforce(
        self: &Rc<Self>,
        setup_id: String,
        params: JsonObject,
        options: SetupOptions,
        events: Option<Function>,
    ) -> impl Future<Output = SetupOutcome> + 'static {
        let (number, token) = self.start_setup(&setup_id);
        let host = self.setup_host(&setup_id, None, None, events);
        let connections = self.clone();
        async move {
            let config = SalesforceOAuthConfig { oauth_redirect: options.oauth_redirect.unwrap_or_default() };
            let login = authenticate_salesforce(host, params, config, options.force_relogin.unwrap_or(false), token.clone()).await;
            connections.end_setup(&setup_id, number);
            match login {
                Ok(login) => SetupOutcome::succeeded(Some(SetupAuthentication {
                    tokens: JsonValue(tokens_json(&login.tokens)),
                    user_info: login.user_info.map(|info| JsonValue(serde_json::to_value(info).unwrap_or(Value::Null))),
                })),
                Err(failure) => SetupOutcome::of(failure),
            }
        }
    }
}

/// A listener of the steps of a login, none for null
pub(crate) fn listener(value: JsValue) -> Result<Option<Function>, JsError> {
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    value.dyn_into::<Function>().map(Some).map_err(|_| JsError::new("the listener of a login is no function"))
}
