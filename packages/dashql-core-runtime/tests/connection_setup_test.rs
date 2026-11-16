// The setups of the connectors and the health checks as services on a fake host: the OAuth flows answer what the test
// sets, the requests take the responses of the test, the actions of the connection are recorded by their names. The
// semantics follow trino_connection_setup.test.ts, salesforce_connection_setup.test.ts and hyper_connection_setup.test.ts
// of the app.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use serde_json::{json, Value};

use dashql_core_runtime::connection_setup::{
    authenticate_salesforce, check_health, setup_action_json, setup_hyper, setup_salesforce, setup_trino, HyperChannelKind,
    HyperChannelRequest, OAuthEvents, OAuthHost, ProbeResult, SetupFailure, SetupHost,
};
use dashql_core_runtime::connections::{ChannelId, ConnectionAction, ConnectorType, DetailedError, JsonObject, OAuthPkceChallenge};
use dashql_core_runtime::host::signal::{oneshot, Receiver};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::{QueryMetadata, QueryType};
use dashql_core_runtime::salesforce::setup::SalesforceChannelSetup;
use dashql_core_runtime::salesforce::{OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, OAuthState, SalesforceOAuthConfig};
use dashql_core_runtime::trino::{OAuthCallback, TrinoChannel};

// ---------------------------------------------------------------------------------------------------------------------
// The executor: the fake host answers at once or after the token was cancelled, polling until done is enough

struct NoopWaker;
impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

thread_local! {
    /// The tasks that the host spawned, `block_on` runs them next to its future
    static TASKS: RefCell<Vec<LocalTask>> = RefCell::new(Vec::new());
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut cx = Context::from_waker(&waker);
    let mut future = pin!(future);
    let run_tasks = |cx: &mut Context<'_>| {
        let mut tasks = TASKS.with(|tasks| std::mem::take(&mut *tasks.borrow_mut()));
        tasks.retain_mut(|task| task.as_mut().poll(cx).is_pending());
        TASKS.with(|pending| pending.borrow_mut().extend(tasks));
    };
    for _ in 0..1000 {
        run_tasks(&mut cx);
        if let Poll::Ready(output) = future.as_mut().poll(&mut cx) {
            // The tasks that the future left run until they stall, e.g. a connect that the setup stopped waiting for
            for _ in 0..10 {
                run_tasks(&mut cx);
            }
            return output;
        }
    }
    panic!("the setup didn't end");
}

// ---------------------------------------------------------------------------------------------------------------------
// The host

/// What the loopback redirect answers, from the authorization URL
type LoopbackAnswer = Box<dyn Fn(&str) -> Result<OAuthCallback, HostError>>;
/// What the redirect page answers, from the authorization URL
type RedirectAnswer = Box<dyn Fn(&str) -> Result<OAuthRedirectData, HostError>>;

#[derive(Default)]
struct FakeHost {
    now: Cell<f64>,
    /// The actions, `connector:TYPE`
    actions: RefCell<Vec<String>>,
    /// The values of the actions
    values: RefCell<Vec<Value>>,
    logs: RefCell<Vec<(LogLevel, String)>>,
    sent: RefCell<Vec<HttpRequest>>,
    responses: RefCell<VecDeque<HttpResponse>>,
    loopback: RefCell<Option<LoopbackAnswer>>,
    redirect: RefCell<Option<RedirectAnswer>>,
    /// The URLs that the flows opened
    opened: RefCell<Vec<String>>,
    /// The event the flow reports while it waits
    event: Cell<Option<OAuthFlowEvent>>,
    /// Cancel the token while a flow waits, like a user who closes the dialog
    cancel_in_flow: Cell<bool>,
    trino_channels: RefCell<Vec<(ChannelId, TrinoChannel)>>,
    salesforce_channels: RefCell<Vec<SalesforceChannelSetup>>,
    hyper_channels: RefCell<Vec<HyperChannelRequest>>,
    connect_error: RefCell<Option<String>>,
    closed: RefCell<Vec<ChannelId>>,
    link_token: RefCell<Option<String>>,
    probe: RefCell<Option<Result<ProbeResult, HostError>>>,
    probes: RefCell<Vec<(ChannelId, String, QueryMetadata)>>,
    /// A connect of a Hyper channel that hangs until the test sends the channel, the user cancels meanwhile
    connect_later: RefCell<Option<Receiver<ChannelId>>>,
    /// The platform has no random ids
    no_random_id: Cell<bool>,
}

impl FakeHost {
    fn actions(&self) -> Vec<String> {
        self.actions.borrow().clone()
    }

    /// The value of the first action of a type
    fn value(&self, action: &str) -> Value {
        let index = self.actions.borrow().iter().position(|a| a == action).unwrap_or_else(|| panic!("no action {action}"));
        self.values.borrow()[index].clone()
    }

    fn flow<T: 'static>(&self, cancellation: &CancellationToken, events: OAuthEvents, answer: Result<T, HostError>) -> impl Future<Output = Result<T, HostError>> + 'static {
        if let Some(event) = self.event.get() {
            events(event);
        }
        let cancel = self.cancel_in_flow.get();
        let token = cancellation.clone();
        async move {
            if cancel {
                token.cancel();
                std::future::pending::<()>().await;
            }
            answer
        }
    }
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        self.now.get()
    }

    fn sleep(&self, _ms: f64) -> impl Future<Output = ()> + 'static {
        std::future::ready(())
    }

    fn spawn(&self, task: LocalTask) {
        TASKS.with(|tasks| tasks.borrow_mut().push(task));
    }

    fn log(&self, level: LogLevel, message: &str, _details: &[(&str, &str)]) {
        self.logs.borrow_mut().push((level, message.to_string()));
    }
}

impl HttpHost for FakeHost {
    fn fetch(&self, request: HttpRequest, _cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.sent.borrow_mut().push(request);
        let response = self.responses.borrow_mut().pop_front().ok_or_else(|| HostError::new("no response"));
        std::future::ready(response)
    }
}

impl OAuthHost for FakeHost {
    fn generate_pkce(&self) -> impl Future<Output = Result<OAuthPkceChallenge, HostError>> + 'static {
        std::future::ready(Ok(OAuthPkceChallenge { value: "challenge".into(), verifier: "verifier".into() }))
    }

    fn random_id(&self) -> Result<String, HostError> {
        if self.no_random_id.get() {
            return Err(HostError::new("the platform has no crypto"));
        }
        Ok("state-1".into())
    }

    fn flow_info(&self) -> OAuthFlowInfo {
        OAuthFlowInfo { redirect_variant: "WEB_OPENER_FLOW".into(), redirect_callback_url: None, debug_mode: false, flavor: None }
    }

    fn authorize_with_loopback(
        &self,
        url: &str,
        _callback_url: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthCallback, HostError>> + 'static {
        self.opened.borrow_mut().push(url.to_string());
        let answer = self.loopback.borrow().as_ref().map_or_else(|| Err(HostError::new("no loopback server")), |answer| answer(url));
        self.flow(cancellation, events, answer)
    }

    fn authorize_with_redirect_page(
        &self,
        url: &str,
        _flow_id: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthRedirectData, HostError>> + 'static {
        self.opened.borrow_mut().push(url.to_string());
        let answer = self.redirect.borrow().as_ref().map_or_else(|| Err(HostError::new("no redirect page")), |answer| answer(url));
        self.flow(cancellation, events, answer)
    }
}

impl SetupHost for FakeHost {
    fn dispatch(&self, action: &ConnectionAction) {
        let json = setup_action_json(action).expect("an action of a setup");
        self.actions.borrow_mut().push(format!("{}:{}", json["connector"].as_str().unwrap(), json["type"].as_str().unwrap()));
        self.values.borrow_mut().push(json["value"].clone());
    }

    fn connect_trino_channel(&self, channel: &TrinoChannel) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        self.trino_channels.borrow_mut().push((1, channel.clone()));
        std::future::ready(Ok(1))
    }

    fn connect_salesforce_channel(&self, channel: &SalesforceChannelSetup, _cancellation: &CancellationToken) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        self.salesforce_channels.borrow_mut().push(channel.clone());
        let error = self.connect_error.borrow().clone();
        std::future::ready(error.map_or(Ok(5), |error| Err(HostError::new(error))))
    }

    fn connect_hyper_channel(&self, channel: &HyperChannelRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
        self.hyper_channels.borrow_mut().push(channel.clone());
        if let Some(later) = self.connect_later.borrow_mut().take() {
            let token = cancellation.clone();
            let connect: std::pin::Pin<Box<dyn Future<Output = Result<ChannelId, HostError>>>> = Box::pin(async move {
                token.cancel();
                later.await.ok_or_else(|| HostError::new("no channel"))
            });
            return connect;
        }
        let error = self.connect_error.borrow().clone();
        // A channel that connects while the user cancels
        if self.cancel_in_flow.get() {
            cancellation.cancel();
        }
        Box::pin(std::future::ready(error.map_or(Ok(9), |error| Err(HostError::new(error)))))
    }

    fn hyper_link_token(&self) -> Option<String> {
        self.link_token.borrow().clone()
    }

    fn close_channel(&self, id: ChannelId) {
        self.closed.borrow_mut().push(id);
    }

    fn run_probe(&self, channel: ChannelId, query: &str, metadata: &QueryMetadata, _cancellation: &CancellationToken) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static {
        self.probes.borrow_mut().push((channel, query.to_string(), metadata.clone()));
        let result = self.probe.borrow_mut().take().unwrap_or(Ok(ProbeResult::Finished { has_table: true }));
        std::future::ready(result)
    }
}

fn object(value: Value) -> JsonObject {
    match value {
        Value::Object(object) => object,
        _ => panic!("not an object"),
    }
}

/// The value of a query parameter of a URL
fn query_param(url: &str, name: &str) -> Option<String> {
    let (_, query) = url.split_once('?')?;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| value.replace("%2F", "/").replace("%3A", ":"))
    })
}

fn json_response(body: Value) -> HttpResponse {
    let mut response = HttpResponse::new(200, body.to_string().into_bytes());
    response.headers.append("content-type", "application/json");
    response
}

fn failure_message(result: Result<impl std::fmt::Debug, SetupFailure>) -> String {
    match result {
        Err(failure) if !failure.cancelled => failure.message,
        other => panic!("expected a failure, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Trino

const TRINO_ENDPOINT: &str = "https://trino.example.com";

fn trino_basic_params() -> JsonObject {
    object(json!({
        "endpoint": TRINO_ENDPOINT,
        "defaultCatalog": "hive",
        "defaultSchema": "sales",
        "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": "secret" } },
        "draftRows": [],
    }))
}

fn trino_oauth_params() -> JsonObject {
    object(json!({
        "endpoint": TRINO_ENDPOINT,
        "auth": {
            "authType": "AUTH_OAUTH",
            "oauth": {
                "authorizationUrl": "https://idp.example.com/auth",
                "tokenUrl": "https://idp.example.com/token",
                "clientId": "test-client",
                "callbackUrl": "http://localhost:56512/Callback",
                "scopes": ["openid", "offline_access"],
            },
        },
    }))
}

#[test]
fn trino_basic_auth_opens_the_channel_with_the_default_catalog_and_schema() {
    let host = Rc::new(FakeHost::default());
    let channel = block_on(setup_trino(host.clone(), trino_basic_params(), false, CancellationToken::new())).unwrap();
    assert_eq!(host.actions(), ["trino:TRINO_CHANNEL_SETUP_STARTED", "trino:TRINO_CHANNEL_READY"]);
    assert_eq!(host.value("trino:TRINO_CHANNEL_READY"), json!(channel));
    // The params of the action are without the draft rows
    assert!(host.value("trino:TRINO_CHANNEL_SETUP_STARTED").get("draftRows").is_none());
    let channels = host.trino_channels.borrow();
    let [(id, opened)] = channels.as_slice() else { panic!("{channels:?}") };
    assert_eq!(*id, channel);
    assert_eq!(opened.endpoint, TRINO_ENDPOINT);
    assert_eq!((opened.defaults.catalog.as_deref(), opened.defaults.schema.as_deref()), (Some("hive"), Some("sales")));
}

#[test]
fn trino_reports_a_setup_that_was_cancelled_before_it_started() {
    let host = Rc::new(FakeHost::default());
    let token = CancellationToken::new();
    token.cancel();
    let result = block_on(setup_trino(host.clone(), trino_basic_params(), false, token));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["trino:TRINO_CHANNEL_SETUP_STARTED", "trino:TRINO_CHANNEL_SETUP_CANCELLED"]);
    assert!(host.trino_channels.borrow().is_empty());

    let host = Rc::new(FakeHost::default());
    let token = CancellationToken::new();
    token.cancel();
    let result = block_on(setup_trino(host.clone(), trino_oauth_params(), false, token));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["trino:OAUTH_STARTED", "trino:OAUTH_CANCELLED"]);

    // Salesforce as well, with or without the redirect page of the app
    for config in [salesforce_config(), SalesforceOAuthConfig::default()] {
        let host = Rc::new(FakeHost::default());
        let token = CancellationToken::new();
        token.cancel();
        let run = setup_salesforce(host.clone(), ConnectorType::Dbcom, salesforce_params(), config, false, token);
        assert!(matches!(block_on(run), Err(SetupFailure { cancelled: true, .. })));
        assert_eq!(host.actions(), ["salesforce:SETUP_STARTED", "salesforce:SETUP_CANCELLED"]);
    }
}

#[test]
fn trino_oauth_authorizes_through_the_loopback_server_and_requests_the_token() {
    let host = Rc::new(FakeHost::default());
    *host.loopback.borrow_mut() = Some(Box::new(|url| Ok(OAuthCallback { code: Some("auth-code".into()), state: query_param(url, "state"), ..Default::default() })));
    host.event.set(Some(OAuthFlowEvent::ExternalBrowserOpened));
    host.responses.borrow_mut().push_back(json_response(json!({
        "access_token": "access-1", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 300,
    })));
    let channel = block_on(setup_trino(host.clone(), trino_oauth_params(), true, CancellationToken::new())).unwrap();
    assert_eq!(
        host.actions(),
        [
            "trino:OAUTH_STARTED",
            "trino:GENERATING_PKCE_CHALLENGE",
            "trino:GENERATED_PKCE_CHALLENGE",
            "trino:OAUTH_BROWSER_OPENED",
            "trino:RECEIVED_OAUTH_CODE",
            "trino:REQUESTING_ACCESS_TOKEN",
            "trino:RECEIVED_ACCESS_TOKEN",
            "trino:TRINO_CHANNEL_SETUP_STARTED",
            "trino:TRINO_CHANNEL_READY",
        ]
    );
    let url = host.opened.borrow()[0].clone();
    assert!(url.starts_with("https://idp.example.com/auth?client_id=test-client&redirect_uri=http"), "{url}");
    assert_eq!(query_param(&url, "scope").as_deref(), Some("openid+offline_access"));
    assert_eq!(query_param(&url, "code_challenge_method").as_deref(), Some("S256"));
    assert_eq!(query_param(&url, "prompt").as_deref(), Some("login"));
    let sent = host.sent.borrow();
    assert_eq!(sent[0].url, "https://idp.example.com/token");
    let body = sent[0].body.clone().unwrap_or_default();
    assert!(body.contains("grant_type=authorization_code") && body.contains("code=auth-code") && body.contains("code_verifier=verifier"), "{body}");
    assert_eq!(host.value("trino:RECEIVED_ACCESS_TOKEN")["accessToken"], "access-1");
    let channels = host.trino_channels.borrow();
    assert_eq!(channels[0].0, channel);
    assert_eq!(channels[0].1.access_token.as_ref().map(|token| token.access_token.as_str()), Some("access-1"));
}

#[test]
fn trino_oauth_fails_on_a_foreign_state_an_error_and_a_missing_loopback_server() {
    let run = |answer: Option<LoopbackAnswer>| {
        let host = Rc::new(FakeHost::default());
        *host.loopback.borrow_mut() = answer;
        let message = failure_message(block_on(setup_trino(host.clone(), trino_oauth_params(), false, CancellationToken::new())));
        assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_FAILED"));
        message
    };
    let forged = run(Some(Box::new(|_| Ok(OAuthCallback { code: Some("code".into()), state: Some("forged".into()), ..Default::default() }))));
    assert!(forged.contains("state"), "{forged}");
    let denied = run(Some(Box::new(|_| {
        Ok(OAuthCallback { error: Some("access_denied".into()), error_description: Some("User denied access".into()), ..Default::default() })
    })));
    assert_eq!(denied, "User denied access");
    assert_eq!(run(None), "no loopback server");
}

#[test]
fn trino_oauth_is_cancelled_while_it_waits_for_the_callback() {
    let host = Rc::new(FakeHost::default());
    *host.loopback.borrow_mut() = Some(Box::new(|_| Ok(OAuthCallback::default())));
    host.cancel_in_flow.set(true);
    let result = block_on(setup_trino(host.clone(), trino_oauth_params(), false, CancellationToken::new()));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_CANCELLED"));
    assert!(host.sent.borrow().is_empty());
}

// ---------------------------------------------------------------------------------------------------------------------
// The health check

#[test]
fn the_health_check_runs_the_probe_of_the_connector_through_the_executor() {
    let host = Rc::new(FakeHost::default());
    block_on(check_health(host.clone(), ConnectorType::Trino, 3, CancellationToken::new())).unwrap();
    assert_eq!(host.actions(), ["connection:HEALTH_CHECK_STARTED", "connection:HEALTH_CHECK_SUCCEEDED"]);
    let probes = host.probes.borrow();
    let (channel, query, metadata) = &probes[0];
    assert_eq!((*channel, query.as_str()), (3, "select 1"));
    assert_eq!(metadata.query_type, QueryType::HealthCheck);
    assert_eq!(metadata.title.as_deref(), Some("Health Check"));
    assert_eq!(metadata.issuer.as_deref(), Some("Connection Setup"));
    drop(probes);

    let host = Rc::new(FakeHost::default());
    block_on(check_health(host.clone(), ConnectorType::Hyper, 1, CancellationToken::new())).unwrap();
    assert_eq!(host.probes.borrow()[0].1, "select 1 as healthy");
}

#[test]
fn the_health_check_fails_with_the_error_of_the_probe() {
    let host = Rc::new(FakeHost::default());
    let mut rejected = DetailedError::new("Unauthorized");
    rejected.data.insert("status".into(), "401".into());
    *host.probe.borrow_mut() = Some(Ok(ProbeResult::Failed(rejected.clone())));
    let failure = block_on(check_health(host.clone(), ConnectorType::Trino, 1, CancellationToken::new())).unwrap_err();
    assert_eq!((failure.message.as_str(), failure.data.get("status").map(String::as_str)), ("Unauthorized", Some("401")));
    assert_eq!(host.actions(), ["connection:HEALTH_CHECK_STARTED", "connection:HEALTH_CHECK_FAILED"]);
    assert_eq!(host.value("connection:HEALTH_CHECK_FAILED"), json!({ "message": "Unauthorized", "data": { "status": "401" } }));

    // A probe without a table fails as well
    let host = Rc::new(FakeHost::default());
    *host.probe.borrow_mut() = Some(Ok(ProbeResult::Finished { has_table: false }));
    assert_eq!(failure_message(block_on(check_health(host.clone(), ConnectorType::Trino, 1, CancellationToken::new()))), "health check failed");

    // A cancelled check is cancelled whatever the probe did
    let host = Rc::new(FakeHost::default());
    let token = CancellationToken::new();
    token.cancel();
    let result = block_on(check_health(host.clone(), ConnectorType::Trino, 1, token));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["connection:HEALTH_CHECK_STARTED", "connection:HEALTH_CHECK_CANCELLED"]);
    assert!(host.probes.borrow().is_empty());
}

// ---------------------------------------------------------------------------------------------------------------------
// Salesforce

fn salesforce_params() -> JsonObject {
    object(json!({
        "instanceUrl": "https://example.my.salesforce.com",
        "appConsumerKey": "consumer-key",
        "appConsumerSecret": "",
        "login": "",
        "databaseName": "cloud-db",
    }))
}

fn salesforce_config() -> SalesforceOAuthConfig {
    SalesforceOAuthConfig { oauth_redirect: "https://dashql.app/oauth.html".into() }
}

/// The callback of the redirect page with the state of the authorization URL
fn redirect_callback(url: &str) -> Result<OAuthRedirectData, HostError> {
    use base64::Engine;
    let state = query_param(url, "state").ok_or_else(|| HostError::new("no state"))?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(state).map_err(|e| HostError::new(e.to_string()))?;
    let state: OAuthState = serde_json::from_slice(&bytes).map_err(|e| HostError::new(e.to_string()))?;
    Ok(OAuthRedirectData { state: Some(state), code: Some("core-code".into()), ..Default::default() })
}

/// The responses of the token, the user info and the Data Cloud token
fn salesforce_responses(host: &FakeHost, user_info: bool) {
    let mut responses = host.responses.borrow_mut();
    responses.push_back(json_response(json!({
        "access_token": "core-token", "instance_url": "https://example.my.salesforce.com", "id": "https://login/id/org/user",
        "issued_at": "1700000000000", "token_type": "Bearer", "scope": "api cdp_query_api",
    })));
    if user_info {
        responses.push_back(json_response(json!({ "preferred_username": "user@example.com", "organization_id": "org-1" })));
    } else {
        responses.push_back(HttpResponse::new(403, "forbidden"));
    }
    responses.push_back(json_response(json!({
        "access_token": "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE4MDAwMDAwMDAsImF1ZGllbmNlVGVuYW50SWQiOiJ0ZW5hbnQifQ.c2ln",
        "instance_url": "tenant.c360a.salesforce.com", "token_type": "Bearer", "expires_in": 7200,
    })));
}

#[test]
fn salesforce_logs_in_and_connects_the_hyper_channel_with_the_tokens() {
    let host = Rc::new(FakeHost::default());
    host.now.set(1_000.0);
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    host.event.set(Some(OAuthFlowEvent::WindowOpened));
    salesforce_responses(&host, true);
    let result = block_on(setup_salesforce(
        host.clone(),
        ConnectorType::Dbcom,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    ))
    .unwrap();
    assert_eq!(result.channel, 5);
    assert_eq!(result.user_info.as_ref().and_then(|info| info.preferred_username.as_deref()), Some("user@example.com"));
    assert_eq!(
        host.actions(),
        [
            "salesforce:SETUP_STARTED",
            "salesforce:GENERATING_PKCE_CHALLENGE",
            "salesforce:GENERATED_PKCE_CHALLENGE",
            "salesforce:OAUTH_WEB_WINDOW_OPENED",
            "salesforce:RECEIVED_CORE_AUTH_CODE",
            "salesforce:REQUESTING_CORE_AUTH_TOKEN",
            "salesforce:RECEIVED_CORE_AUTH_TOKEN",
            "salesforce:RECEIVED_CORE_USER_INFO",
            "salesforce:REQUESTING_DATA_CLOUD_ACCESS_TOKEN",
            "salesforce:RECEIVED_DATA_CLOUD_ACCESS_TOKEN",
            "salesforce:SF_CHANNEL_SETUP_STARTED",
            "salesforce:SF_CHANNEL_READY",
        ]
    );
    assert_eq!(host.value("salesforce:RECEIVED_CORE_AUTH_TOKEN")["accessToken"], "core-token");
    let channels = host.salesforce_channels.borrow();
    let channel = &channels[0];
    assert_eq!(channel.tokens.core.access_token, "core-token");
    assert_eq!(channel.attached_databases.len(), 1, "Database.com attaches its Hyper Cloud database");
    assert!(channel.request_metadata.iter().any(|(name, value)| name == "authorization" && value.starts_with("Bearer eyJ")));
}

#[test]
fn salesforce_authenticates_without_a_channel_and_skips_a_missing_user_info() {
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    salesforce_responses(&host, false);
    let authentication = block_on(authenticate_salesforce(host.clone(), salesforce_params(), salesforce_config(), false, CancellationToken::new())).unwrap();
    assert_eq!(authentication.tokens.core.access_token, "core-token");
    assert!(authentication.user_info.is_none());
    assert!(host.salesforce_channels.borrow().is_empty());
    assert!(!host.actions().contains(&"salesforce:RECEIVED_CORE_USER_INFO".to_string()));
}

#[test]
fn salesforce_fails_and_cancels() {
    // A callback with an error
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(|url| {
        let mut callback = redirect_callback(url)?;
        callback.code = None;
        callback.error = Some("access_denied".into());
        callback.error_description = Some("User denied access".into());
        Ok(callback)
    }));
    let run = setup_salesforce(host.clone(), ConnectorType::SalesforceDataCloud, salesforce_params(), salesforce_config(), false, CancellationToken::new());
    assert_eq!(failure_message(block_on(run)), "User denied access");
    assert_eq!(host.actions().last().map(String::as_str), Some("salesforce:SETUP_FAILED"));

    // A channel that doesn't connect
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    *host.connect_error.borrow_mut() = Some("HTTP client is not available".into());
    salesforce_responses(&host, true);
    let run = setup_salesforce(host.clone(), ConnectorType::SalesforceDataCloud, salesforce_params(), salesforce_config(), false, CancellationToken::new());
    assert_eq!(failure_message(block_on(run)), "HTTP client is not available");

    // Cancelled while the redirect page waits
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    host.cancel_in_flow.set(true);
    let run = setup_salesforce(host.clone(), ConnectorType::SalesforceDataCloud, salesforce_params(), salesforce_config(), false, CancellationToken::new());
    assert!(matches!(block_on(run), Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions().last().map(String::as_str), Some("salesforce:SETUP_CANCELLED"));

    // Without the redirect page of the app
    let host = Rc::new(FakeHost::default());
    let config = SalesforceOAuthConfig::default();
    let run = setup_salesforce(host.clone(), ConnectorType::SalesforceDataCloud, salesforce_params(), config, false, CancellationToken::new());
    assert_eq!(failure_message(block_on(run)), "missing oauth redirect url");
}

// ---------------------------------------------------------------------------------------------------------------------
// Hyper

fn hyper_params(protocol: &str) -> JsonObject {
    object(json!({
        "protocol": protocol,
        "endpoint": "https://hyper.example.com",
        "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" },
        "metadata": { "ctx-tenant-id": "tenant-123" },
        "draftRows": [],
    }))
}

#[test]
fn hyper_connects_the_channel_of_its_protocol() {
    for (protocol, kind) in [("WASM", HyperChannelKind::Embedded), ("V3_GRPC", HyperChannelKind::Grpc), ("V3_HTTP", HyperChannelKind::Http)] {
        let host = Rc::new(FakeHost::default());
        let channel = block_on(setup_hyper(host.clone(), hyper_params(protocol), CancellationToken::new())).unwrap();
        assert_eq!(channel, 9);
        assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_READY"]);
        let ready = host.value("hyper:HYPER_CHANNEL_READY");
        assert_eq!(ready["channel"], 9);
        assert!(ready["params"].get("draftRows").is_none());
        assert_eq!(ready["params"]["protocol"], protocol);
        assert_eq!(host.hyper_channels.borrow()[0].kind, kind);
    }
}

#[test]
fn a_cancelled_setup_stops_waiting_for_a_connect_and_closes_its_channel_later() {
    let host = Rc::new(FakeHost::default());
    let (connected, later) = oneshot();
    *host.connect_later.borrow_mut() = Some(later);
    let result = block_on(setup_hyper(host.clone(), hyper_params("V3_GRPC"), CancellationToken::new()));
    // The setup ends at the cancellation while the connect hangs
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_CANCELLED"]);
    assert!(host.closed.borrow().is_empty());
    // The channel that connects later is closed
    connected.send(11);
    block_on(async {});
    assert_eq!(*host.closed.borrow(), [11]);
}

#[test]
fn an_oauth_flow_without_a_random_state_fails() {
    let host = Rc::new(FakeHost::default());
    host.no_random_id.set(true);
    let message = failure_message(block_on(setup_trino(host.clone(), trino_oauth_params(), false, CancellationToken::new())));
    assert_eq!(message, "the platform has no crypto");
    assert!(host.opened.borrow().is_empty(), "no login without a state that binds its callback");
    assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_FAILED"));

    let host = Rc::new(FakeHost::default());
    host.no_random_id.set(true);
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    let run = setup_salesforce(host.clone(), ConnectorType::SalesforceDataCloud, salesforce_params(), salesforce_config(), false, CancellationToken::new());
    assert_eq!(failure_message(block_on(run)), "the platform has no crypto");
    assert!(host.opened.borrow().is_empty());
}

#[test]
fn hyper_links_need_their_token_and_speak_http() {
    let host = Rc::new(FakeHost::default());
    let message = failure_message(block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP_LINK"), CancellationToken::new())));
    assert!(message.starts_with("Open the link of this Hyper again"), "{message}");
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_FAILED"]);

    let host = Rc::new(FakeHost::default());
    *host.link_token.borrow_mut() = Some("link-token".into());
    block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP_LINK"), CancellationToken::new())).unwrap();
    let request = host.hyper_channels.borrow()[0].clone();
    assert_eq!(request.kind, HyperChannelKind::Http);
    assert_eq!(request.params["protocol"], "V3_HTTP");
    assert_eq!(request.params["metadata"]["authorization"], "Bearer link-token");
    assert_eq!(request.params["metadata"]["ctx-tenant-id"], "tenant-123");
    // The connection keeps the params of the link, without the token
    assert_eq!(host.value("hyper:HYPER_CHANNEL_READY")["params"]["protocol"], "V3_HTTP_LINK");
}

#[test]
fn hyper_fails_and_closes_a_channel_that_was_ready_after_the_cancellation() {
    let host = Rc::new(FakeHost::default());
    *host.connect_error.borrow_mut() = Some("gRPC client is not available".into());
    assert_eq!(failure_message(block_on(setup_hyper(host.clone(), hyper_params("V3_GRPC"), CancellationToken::new()))), "gRPC client is not available");
    assert_eq!(host.value("hyper:HYPER_CHANNEL_SETUP_FAILED"), json!({ "message": "gRPC client is not available" }));

    let host = Rc::new(FakeHost::default());
    host.cancel_in_flow.set(true);
    let result = block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP"), CancellationToken::new()));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_CANCELLED"]);
    assert_eq!(*host.closed.borrow(), [9]);
}
