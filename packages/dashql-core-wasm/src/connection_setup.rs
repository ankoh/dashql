//! The wasm-bindgen API of the setups of the connectors and the health checks (`dashql_core_runtime::connection_setup`).
//!
//! A setup runs on a host of its own, a JavaScript object (`ConnectionSetupHost`): the clock, timers, the log, fetch
//! through the HTTP client of the platform, the OAuth flow of the platform with the PKCE challenge and a random id, the
//! connection that the actions go to and the channels of the setup. A run starts with its params as JSON and returns a
//! `ConnectionSetupRun`: `done` resolves with the outcome, `cancel` stops it.

use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_core_runtime::connection_setup::{
    authenticate_salesforce, check_health, setup_action_json, setup_hyper, setup_salesforce, setup_trino, HyperChannelRequest,
    OAuthEvents, OAuthHost, ProbeResult, SetupFailure, SetupHost,
};
use dashql_core_runtime::connections::{ChannelId, ConnectionAction, ConnectorType, DetailedError, JsonObject, OAuthPkceChallenge};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::host::CANCELLED_MESSAGE;
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::QueryMetadata;
use dashql_core_runtime::salesforce::setup::SalesforceChannelSetup;
use dashql_core_runtime::salesforce::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, SalesforceOAuthConfig};
use dashql_core_runtime::trino::{OAuthCallback, TrinoChannel};
use js_sys::{Function, Object, Promise, Reflect, JSON};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

use super::query_executor::{field, host_call, host_error, request_value, response_of};

#[wasm_bindgen(typescript_custom_section)]
const CONNECTION_SETUP_HOST: &str = r#"
/** An action of a setup for its connection. The type is the name of the action of the connector, a channel is its id. */
export interface ConnectionSetupAction {
    connector: 'connection' | 'trino' | 'salesforce' | 'hyper';
    type: string;
    value: any;
}
/** How the platform takes the user through the redirect page */
export interface ConnectionSetupOAuthFlowInfo {
    redirectVariant: 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    redirectCallbackUrl: string | null;
    debugMode: boolean;
    flavor: string | null;
}
/** A Trino channel: the endpoint, the default catalog and schema and the OAuth access token */
export interface ConnectionSetupTrinoChannel {
    endpoint: string;
    catalog: string | null;
    schema: string | null;
    accessToken: any | null;
}
/** The Hyper channel of a Salesforce connection over HTTP with its tokens */
export interface ConnectionSetupSalesforceChannel {
    endpoint: string;
    requestMetadata: Record<string, string>;
    attachedDatabases: { path: string; alias: string }[];
    tokens: { core: any; dataCloud: any };
}
/** The outcome of a run: the result of a success, the error of a failure */
export type ConnectionSetupOutcome =
    | { status: 'succeeded'; result: any }
    | { status: 'failed'; message: string; data: Record<string, string>; hasValue: boolean; value: unknown }
    | { status: 'cancelled'; message: string };
/** The host of a setup */
export interface ConnectionSetupHost {
    /** The time in milliseconds since the epoch */
    now(): number;
    /** Call back after a duration in milliseconds */
    setTimer(ms: number, callback: () => void): unknown;
    clearTimer(timer: unknown): void;
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string, target: string): void;
    /** Send a request, `abortFetch` with its id stops it */
    fetch(requestId: number, request: QueryExecutorHttpRequest): Promise<QueryExecutorHttpResponse>;
    abortFetch(requestId: number): void;
    /** A PKCE challenge: a random verifier and the base64url of its SHA-256 digest */
    generatePkce(): Promise<{ value: string; verifier: string }>;
    /** A random id */
    randomId(): string;
    oauthFlowInfo(): ConnectionSetupOAuthFlowInfo;
    /** Open the authorization URL and wait for the loopback redirect. The events are 'WINDOW_OPENED', 'WINDOW_CLOSED' and 'EXTERNAL_BROWSER_OPENED'. */
    authorizeWithLoopback(url: string, callbackUrl: string, onEvent: (event: string) => void): Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
    /** Open the authorization URL and wait for the callback of the redirect page whose state has the flow id */
    authorizeWithRedirectPage(url: string, flowId: string, onEvent: (event: string) => void): Promise<unknown>;
    /** Apply an action to the connection */
    dispatch(action: ConnectionSetupAction): void;
    /** Keep a Trino channel under its id */
    openTrinoChannel(channel: number, description: ConnectionSetupTrinoChannel): void;
    /** Connect the Hyper channel of a Salesforce connection, its id */
    connectSalesforceChannel(description: ConnectionSetupSalesforceChannel): Promise<number>;
    /** Connect a Hyper channel with its params, its id */
    connectHyperChannel(kind: 'embedded' | 'grpc' | 'http', params: any): Promise<number>;
    /** The token of the link to a Hyper that the page holds */
    hyperLinkToken(): string | null;
    closeChannel(channel: number): void;
    /** Run the probe query of a health check through the query executor */
    runProbe(channel: number, query: string, metadata: { queryType: number; title: string | null; issuer: string | null }): Promise<{ hasTable: boolean } | { error: { message: string; data?: Record<string, string> } }>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "ConnectionSetupHost")]
    #[derive(Clone)]
    pub type JsConnectionSetupHost;

    #[wasm_bindgen(method, catch)]
    fn now(this: &JsConnectionSetupHost) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = setTimer)]
    fn set_timer(this: &JsConnectionSetupHost, ms: f64, callback: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = clearTimer)]
    fn clear_timer(this: &JsConnectionSetupHost, timer: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn log(this: &JsConnectionSetupHost, level: &str, message: &str, details: &str, target: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn fetch(this: &JsConnectionSetupHost, request_id: f64, request: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = abortFetch)]
    fn abort_fetch(this: &JsConnectionSetupHost, request_id: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = generatePkce)]
    fn generate_pkce(this: &JsConnectionSetupHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = randomId)]
    fn random_id(this: &JsConnectionSetupHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = oauthFlowInfo)]
    fn oauth_flow_info(this: &JsConnectionSetupHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = authorizeWithLoopback)]
    fn authorize_with_loopback(this: &JsConnectionSetupHost, url: &str, callback_url: &str, on_event: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = authorizeWithRedirectPage)]
    fn authorize_with_redirect_page(this: &JsConnectionSetupHost, url: &str, flow_id: &str, on_event: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn dispatch(this: &JsConnectionSetupHost, action: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = openTrinoChannel)]
    fn open_trino_channel(this: &JsConnectionSetupHost, channel: u32, description: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = connectSalesforceChannel)]
    fn connect_salesforce_channel(this: &JsConnectionSetupHost, description: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = connectHyperChannel)]
    fn connect_hyper_channel(this: &JsConnectionSetupHost, kind: &str, params: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = hyperLinkToken)]
    fn hyper_link_token(this: &JsConnectionSetupHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = closeChannel)]
    fn close_channel(this: &JsConnectionSetupHost, channel: u32) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = runProbe)]
    fn run_probe(this: &JsConnectionSetupHost, channel: u32, query: &str, metadata: &JsValue) -> Result<JsValue, JsValue>;
}

/// A timer of the host, dropping it clears the timer
struct JsSleep {
    future: JsFuture,
    timer: JsValue,
    host: JsConnectionSetupHost,
}

impl Future for JsSleep {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        Pin::new(&mut self.future).poll(cx).map(|_| ())
    }
}

impl Drop for JsSleep {
    fn drop(&mut self) {
        let _ = self.host.clear_timer(&self.timer);
    }
}

/// The host of a setup over the JS object
pub struct JsHost {
    host: JsConnectionSetupHost,
    next_request: Cell<f64>,
}

/// A JSON value as a JS value
fn js_json(value: &Value) -> JsValue {
    JSON::parse(&value.to_string()).unwrap_or(JsValue::NULL)
}

/// A JS value as JSON, null for what JSON can't hold
fn json_of(value: &JsValue) -> Value {
    JSON::stringify(value).ok().and_then(|text| text.as_string()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null)
}

fn string_field(value: &JsValue, name: &str) -> Option<String> {
    field(value, name).and_then(|value| value.as_string())
}

/// The id of a channel that the host returned
fn channel_of(value: &JsValue) -> Result<ChannelId, HostError> {
    value.as_f64().filter(|id| *id >= 0.0 && *id <= u32::MAX as f64).map(|id| id as ChannelId).ok_or_else(|| HostError::new("the host returned no channel id"))
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

/// The callback of the events of a flow. It lives while the flow runs, the host must not call it afterwards.
fn events_callback(events: OAuthEvents) -> Closure<dyn FnMut(JsValue)> {
    Closure::wrap(Box::new(move |event: JsValue| {
        if let Some(event) = event.as_string().as_deref().and_then(flow_event) {
            events(event);
        }
    }) as Box<dyn FnMut(JsValue)>)
}

impl JsHost {
    fn next_request(&self) -> f64 {
        let id = self.next_request.get() + 1.0;
        self.next_request.set(id);
        id
    }

    /// Await a call of the host that the token may stop
    fn call(&self, sent: Result<JsValue, JsValue>, cancellation: &CancellationToken) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let token = cancellation.clone();
        // The promise is awaited right away, a rejection after a cancellation is handled
        let future = sent.map(|value| JsFuture::from(Promise::resolve(&value)));
        async move {
            match token.run(future.map_err(host_error)?).await {
                None => Err(HostError::new(CANCELLED_MESSAGE)),
                Some(result) => result.map_err(host_error),
            }
        }
    }
}

impl Host for JsHost {
    fn now(&self) -> f64 {
        self.host.now().unwrap_or_default()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let mut timer = JsValue::UNDEFINED;
        let host = self.host.clone();
        let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
            timer = host.set_timer(ms, &resolve).unwrap_or(JsValue::UNDEFINED);
        });
        JsSleep { future: JsFuture::from(promise), timer, host }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    /// The detail `target` names the target of the log
    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let target = details.iter().find(|(key, _)| *key == "target").map_or("connection_setup", |(_, value)| value);
        let details: Map<String, Value> = details
            .iter()
            .filter(|(key, _)| *key != "target")
            .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
            .collect();
        let details = serde_json::to_string(&details).unwrap_or_default();
        let _ = self.host.log(level.name(), message, &details, target);
    }
}

impl HttpHost for JsHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let id = self.next_request();
        let host = self.host.clone();
        let token = cancellation.clone();
        // The promise is awaited right away, a rejection after a cancellation is handled
        let sent = if token.is_cancelled() {
            None
        } else {
            Some(self.host.fetch(id, &request_value(&request)).map(|value| JsFuture::from(Promise::resolve(&value))))
        };
        async move {
            let Some(sent) = sent else {
                return Err(HostError::new(CANCELLED_MESSAGE));
            };
            match token.run(sent.map_err(host_error)?).await {
                None => {
                    let _ = host.abort_fetch(id);
                    Err(HostError::new(CANCELLED_MESSAGE))
                }
                Some(Ok(value)) => response_of(&value),
                Some(Err(value)) => Err(host_error(value)),
            }
        }
    }
}

impl OAuthHost for JsHost {
    fn generate_pkce(&self) -> impl Future<Output = Result<OAuthPkceChallenge, HostError>> + 'static {
        let call = self.host.generate_pkce();
        async move {
            let value = host_call(call).await?;
            let (Some(challenge), Some(verifier)) = (string_field(&value, "value"), string_field(&value, "verifier")) else {
                return Err(HostError::new("the host generated no PKCE challenge"));
            };
            Ok(OAuthPkceChallenge { value: challenge, verifier })
        }
    }

    fn random_id(&self) -> String {
        self.host.random_id().ok().and_then(|id| id.as_string()).unwrap_or_default()
    }

    fn flow_info(&self) -> OAuthFlowInfo {
        let value = self.host.oauth_flow_info().unwrap_or(JsValue::NULL);
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
        let sent = self.host.authorize_with_loopback(url, callback_url, callback.as_ref().unchecked_ref());
        let call = self.call(sent, cancellation);
        async move {
            let value = call.await;
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
        let sent = self.host.authorize_with_redirect_page(url, flow_id, callback.as_ref().unchecked_ref());
        let call = self.call(sent, cancellation);
        async move {
            let value = call.await;
            drop(callback);
            serde_json::from_value(json_of(&value?)).map_err(|e| HostError::new(format!("invalid OAuth callback: {e}")))
        }
    }
}

impl SetupHost for JsHost {
    fn dispatch(&self, action: &ConnectionAction) {
        if let Some(action) = setup_action_json(action) {
            let _ = self.host.dispatch(&js_json(&action));
        }
    }

    fn open_trino_channel(&self, id: ChannelId, channel: &TrinoChannel) -> Result<(), HostError> {
        let description = json!({
            "endpoint": channel.endpoint,
            "catalog": channel.defaults.catalog,
            "schema": channel.defaults.schema,
            "accessToken": channel.access_token.as_ref().map(|token| token.to_json()),
        });
        self.host.open_trino_channel(id, &js_json(&description)).map_err(host_error)
    }

    fn connect_salesforce_channel(
        &self,
        channel: &SalesforceChannelSetup,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        let metadata: Map<String, Value> = channel.request_metadata.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
        let description = json!({
            "endpoint": channel.endpoint,
            "requestMetadata": metadata,
            "attachedDatabases": channel.attached_databases.iter().map(|db| json!({ "path": db.path, "alias": db.alias })).collect::<Vec<_>>(),
            "tokens": {
                "core": serde_json::to_value(&channel.tokens.core).unwrap_or(Value::Null),
                "dataCloud": serde_json::to_value(&channel.tokens.data_cloud).unwrap_or(Value::Null),
            },
        });
        let sent = self.host.connect_salesforce_channel(&js_json(&description));
        // The connect runs to its end, the setup closes a channel that is ready after a cancellation
        let call = self.call(sent, &CancellationToken::new());
        let _ = cancellation;
        async move { channel_of(&call.await?) }
    }

    fn connect_hyper_channel(
        &self,
        channel: &HyperChannelRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        let sent = self.host.connect_hyper_channel(channel.kind.name(), &js_json(&Value::Object(channel.params.clone())));
        let call = self.call(sent, &CancellationToken::new());
        let _ = cancellation;
        async move { channel_of(&call.await?) }
    }

    fn hyper_link_token(&self) -> Option<String> {
        self.host.hyper_link_token().ok().and_then(|token| token.as_string())
    }

    fn close_channel(&self, id: ChannelId) {
        let _ = self.host.close_channel(id);
    }

    fn run_probe(
        &self,
        channel: ChannelId,
        query: &str,
        metadata: &QueryMetadata,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static {
        let metadata = json!({
            "queryType": metadata.query_type as u8,
            "title": metadata.title,
            "issuer": metadata.issuer,
        });
        let sent = self.host.run_probe(channel, query, &js_json(&metadata));
        let call = self.call(sent, cancellation);
        async move {
            let value = call.await?;
            if let Some(error) = field(&value, "error") {
                let mut detailed = DetailedError::new(string_field(&error, "message").unwrap_or_default());
                if let Value::Object(data) = json_of(&field(&error, "data").unwrap_or(JsValue::NULL)) {
                    detailed.data = data.into_iter().filter_map(|(k, v)| v.as_str().map(|v| (k, v.to_string()))).collect();
                }
                return Ok(ProbeResult::Failed(detailed));
            }
            Ok(ProbeResult::Finished { has_table: field(&value, "hasTable").and_then(|has| has.as_bool()).unwrap_or(false) })
        }
    }
}

fn set(object: &Object, key: &str, value: &JsValue) {
    let _ = Reflect::set(object, &JsValue::from_str(key), value);
}

/// The outcome of a run as a JS value
fn outcome_value(outcome: Result<Value, SetupFailure>) -> JsValue {
    let object = Object::new();
    match outcome {
        Ok(result) => {
            set(&object, "status", &JsValue::from_str("succeeded"));
            set(&object, "result", &js_json(&result));
        }
        Err(failure) if failure.cancelled => {
            set(&object, "status", &JsValue::from_str("cancelled"));
            set(&object, "message", &JsValue::from_str(&failure.message));
        }
        Err(failure) => {
            set(&object, "status", &JsValue::from_str("failed"));
            set(&object, "message", &JsValue::from_str(&failure.message));
            set(&object, "data", &js_json(&json!(failure.data)));
            let value = failure.value.as_ref().and_then(|value| value.downcast_ref::<JsValue>()).cloned();
            set(&object, "hasValue", &JsValue::from_bool(value.is_some()));
            set(&object, "value", &value.unwrap_or(JsValue::UNDEFINED));
        }
    }
    object.into()
}

/// A run of a setup or a health check: `done` resolves with its outcome, `cancel` stops it
#[wasm_bindgen]
pub struct ConnectionSetupRun {
    token: CancellationToken,
    done: Promise,
}

#[wasm_bindgen]
impl ConnectionSetupRun {
    /// Stop the run, it ends as cancelled at its next step
    pub fn cancel(&self) {
        self.token.cancel();
    }

    /// The outcome of the run (`ConnectionSetupOutcome`)
    #[wasm_bindgen(getter)]
    pub fn done(&self) -> Promise {
        self.done.clone()
    }
}

/// Start a run on a host
fn start<F, Fut>(host: JsConnectionSetupHost, run: F) -> ConnectionSetupRun
where
    F: FnOnce(Rc<JsHost>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<Value, SetupFailure>> + 'static,
{
    let token = CancellationToken::new();
    let host = Rc::new(JsHost { host, next_request: Cell::new(0.0) });
    let future = run(host, token.clone());
    let done = future_to_promise(async move { Ok(outcome_value(future.await)) });
    ConnectionSetupRun { token, done }
}

fn params_of(text: &str) -> Result<JsonObject, JsError> {
    match serde_json::from_str(text) {
        Ok(Value::Object(params)) => Ok(params),
        Ok(_) => Err(JsError::new("the params of a setup must be an object")),
        Err(e) => Err(JsError::new(&format!("invalid params: {e}"))),
    }
}

/// Set up a Trino connection with its params (JSON), the result is `{ channel }`
#[wasm_bindgen(js_name = connectionSetupTrino)]
pub fn connection_setup_trino(host: JsConnectionSetupHost, params: &str, force_relogin: bool) -> Result<ConnectionSetupRun, JsError> {
    let params = params_of(params)?;
    Ok(start(host, move |host, token| async move {
        setup_trino(host, params, force_relogin, token).await.map(|channel| json!({ "channel": channel }))
    }))
}

/// The redirect page of the app from the config of the connector (JSON)
fn salesforce_config(config: &str) -> SalesforceOAuthConfig {
    let value: Value = serde_json::from_str(config).unwrap_or(Value::Null);
    SalesforceOAuthConfig { oauth_redirect: value.get("oauthRedirect").and_then(Value::as_str).unwrap_or("").to_string() }
}

fn tokens_json(tokens: &dashql_core_runtime::salesforce::SalesforceTokens) -> Value {
    json!({
        "core": serde_json::to_value(&tokens.core).unwrap_or(Value::Null),
        "dataCloud": serde_json::to_value(&tokens.data_cloud).unwrap_or(Value::Null),
    })
}

/// Set up a Salesforce (`dbcom` false) or Database.com connection with its params and the config of the connector
/// (JSON), the result is `{ channel, tokens, userInfo }`
#[wasm_bindgen(js_name = connectionSetupSalesforce)]
pub fn connection_setup_salesforce(
    host: JsConnectionSetupHost,
    dbcom: bool,
    params: &str,
    config: &str,
    force_relogin: bool,
) -> Result<ConnectionSetupRun, JsError> {
    let params = params_of(params)?;
    let config = salesforce_config(config);
    let connector = if dbcom { ConnectorType::Dbcom } else { ConnectorType::SalesforceDataCloud };
    Ok(start(host, move |host, token| async move {
        let result = setup_salesforce(host, connector, params, config, force_relogin, token).await?;
        Ok(json!({
            "channel": result.channel,
            "tokens": tokens_json(&result.tokens),
            "userInfo": result.user_info.map(|info| serde_json::to_value(info).unwrap_or(Value::Null)),
        }))
    }))
}

/// Log in to Salesforce with the params and the config of the connector (JSON), the result is `{ tokens, userInfo }`
#[wasm_bindgen(js_name = connectionSetupAuthenticateSalesforce)]
pub fn connection_setup_authenticate_salesforce(
    host: JsConnectionSetupHost,
    params: &str,
    config: &str,
    force_relogin: bool,
) -> Result<ConnectionSetupRun, JsError> {
    let params = params_of(params)?;
    let config = salesforce_config(config);
    Ok(start(host, move |host, token| async move {
        let authentication = authenticate_salesforce(host, params, config, force_relogin, token).await?;
        Ok(json!({
            "tokens": tokens_json(&authentication.tokens),
            "userInfo": authentication.user_info.map(|info| serde_json::to_value(info).unwrap_or(Value::Null)),
        }))
    }))
}

/// Set up a Hyper connection with its params (JSON), the result is `{ channel }`
#[wasm_bindgen(js_name = connectionSetupHyper)]
pub fn connection_setup_hyper(host: JsConnectionSetupHost, params: &str) -> Result<ConnectionSetupRun, JsError> {
    let params = params_of(params)?;
    Ok(start(host, move |host, token| async move { setup_hyper(host, params, token).await.map(|channel| json!({ "channel": channel })) }))
}

/// Check the health of a channel of a connector (`trino`, `hyper` or `salesforce`)
#[wasm_bindgen(js_name = connectionSetupHealthCheck)]
pub fn connection_setup_health_check(host: JsConnectionSetupHost, connector: &str, channel: u32) -> Result<ConnectionSetupRun, JsError> {
    let connector = match connector {
        "trino" => ConnectorType::Trino,
        "hyper" => ConnectorType::Hyper,
        "salesforce" => ConnectorType::SalesforceDataCloud,
        other => return Err(JsError::new(&format!("unknown connector {other}"))),
    };
    Ok(start(host, move |host, token| async move { check_health(host, connector, channel, token).await.map(|()| Value::Null) }))
}
