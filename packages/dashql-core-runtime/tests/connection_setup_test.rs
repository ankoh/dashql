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
    authenticate_salesforce, check_health, setup_hyper, setup_salesforce, setup_trino, HyperChannelKind,
    HyperChannelRequest, LoginStep, OAuthCallback, OAuthEvents, OAuthHost, ProbeResult, SetupFailure, SetupHost,
};
use dashql_core_runtime::connections::{
    ChannelId, ConnectionAction, ConnectionChannel, ConnectionHealth, ConnectionParams, ConnectionState, ConnectorType,
    DetailedError, HyperAction, JsonObject, OAuthPkceChallenge, SalesforceAction, TrinoAction,
};
use dashql_core_runtime::host::signal::{oneshot, Receiver};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::{QueryMetadata, QueryType};
use dashql_core_runtime::salesforce::{
    OAuthFlowEvent, OAuthFlowInfo, OAuthRedirectData, OAuthState, SalesforceOAuthConfig,
};
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_runtime::trino::TrinoRequest;

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
    /// The actions as they were dispatched
    dispatched: RefCell<Vec<ConnectionAction>>,
    /// Is the host the one of a login? It hears the steps of the login then.
    login: Cell<bool>,
    /// The steps that the listener of a login heard
    login_steps: RefCell<Vec<&'static str>>,
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
    hyper_channels: RefCell<Vec<HyperChannelRequest>>,
    connect_error: RefCell<Option<String>>,
    closed: RefCell<Vec<ChannelId>>,
    link_token: RefCell<Option<String>>,
    probe: RefCell<Option<Result<ProbeResult, HostError>>>,
    probes: RefCell<Vec<(String, QueryMetadata)>>,
    /// A connect of a Hyper channel that hangs until the test sends the channel, the user cancels meanwhile
    connect_later: RefCell<Option<Receiver<ChannelId>>>,
    /// The platform has no random ids
    no_random_id: Cell<bool>,
}

impl FakeHost {
    fn actions(&self) -> Vec<String> {
        self.actions.borrow().clone()
    }

    /// The first action of a type
    fn action(&self, action: &str) -> ConnectionAction {
        let index =
            self.actions.borrow().iter().position(|a| a == action).unwrap_or_else(|| panic!("no action {action}"));
        self.dispatched.borrow()[index].clone()
    }

    /// The params of the first action of a type that carries params
    fn params(&self, action: &str) -> JsonObject {
        match self.action(action) {
            ConnectionAction::Trino(
                TrinoAction::OAuthStarted { params } | TrinoAction::ChannelSetupStarted { params },
            )
            | ConnectionAction::Hyper(
                HyperAction::ChannelSetupStarted { params } | HyperAction::ChannelReady { params, .. },
            )
            | ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params }) => params,
            other => panic!("no params in {other:?}"),
        }
    }

    /// The error of the first action of a type that fails
    fn error(&self, action: &str) -> DetailedError {
        match self.action(action) {
            ConnectionAction::HealthCheckFailed(error)
            | ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error))
            | ConnectionAction::Trino(TrinoAction::OAuthFailed(error))
            | ConnectionAction::Salesforce(SalesforceAction::SetupFailed(error)) => error,
            other => panic!("no error in {other:?}"),
        }
    }

    /// The channel of the ready step
    fn ready_channel(&self) -> ConnectionChannel {
        let ready = self.dispatched.borrow().iter().find_map(|action| match action {
            ConnectionAction::Hyper(HyperAction::ChannelReady { channel, .. }) => Some(channel.clone()),
            ConnectionAction::Trino(TrinoAction::ChannelReady(channel)) => {
                Some(ConnectionChannel::Trino(channel.clone()))
            }
            ConnectionAction::Salesforce(SalesforceAction::ChannelReady(channel)) => {
                Some(ConnectionChannel::Salesforce(channel.clone()))
            }
            _ => None,
        });
        ready.expect("a ready step")
    }

    fn flow<T: 'static>(
        &self,
        cancellation: &CancellationToken,
        events: OAuthEvents,
        answer: Result<T, HostError>,
    ) -> impl Future<Output = Result<T, HostError>> + 'static {
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

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl HttpHost for FakeHost {
    fn fetch(
        &self,
        request: HttpRequest,
        _cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
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
        OAuthFlowInfo {
            redirect_variant: "WEB_OPENER_FLOW".into(),
            redirect_callback_url: None,
            debug_mode: false,
            flavor: None,
        }
    }

    fn authorize_with_loopback(
        &self,
        url: &str,
        _callback_url: &str,
        events: OAuthEvents,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<OAuthCallback, HostError>> + 'static {
        self.opened.borrow_mut().push(url.to_string());
        let answer = self
            .loopback
            .borrow()
            .as_ref()
            .map_or_else(|| Err(HostError::new("no loopback server")), |answer| answer(url));
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
        let answer = self
            .redirect
            .borrow()
            .as_ref()
            .map_or_else(|| Err(HostError::new("no redirect page")), |answer| answer(url));
        self.flow(cancellation, events, answer)
    }
}

/// The name of an action of a setup, `connector:TYPE`
fn step_name(action: &ConnectionAction) -> String {
    let (connector, name) = match action {
        ConnectionAction::HealthCheckStarted => ("connection", "HEALTH_CHECK_STARTED"),
        ConnectionAction::HealthCheckCancelled => ("connection", "HEALTH_CHECK_CANCELLED"),
        ConnectionAction::HealthCheckSucceeded => ("connection", "HEALTH_CHECK_SUCCEEDED"),
        ConnectionAction::HealthCheckFailed(_) => ("connection", "HEALTH_CHECK_FAILED"),
        ConnectionAction::Trino(action) => (
            "trino",
            match action {
                TrinoAction::OAuthStarted { .. } => "OAUTH_STARTED",
                TrinoAction::OAuthCancelled(_) => "OAUTH_CANCELLED",
                TrinoAction::OAuthFailed(_) => "OAUTH_FAILED",
                TrinoAction::GeneratingPkceChallenge => "GENERATING_PKCE_CHALLENGE",
                TrinoAction::GeneratedPkceChallenge => "GENERATED_PKCE_CHALLENGE",
                TrinoAction::OAuthBrowserOpened => "OAUTH_BROWSER_OPENED",
                TrinoAction::ReceivedOAuthCode { .. } => "RECEIVED_OAUTH_CODE",
                TrinoAction::RequestingAccessToken => "REQUESTING_ACCESS_TOKEN",
                TrinoAction::ReceivedAccessToken => "RECEIVED_ACCESS_TOKEN",
                TrinoAction::ChannelSetupStarted { .. } => "TRINO_CHANNEL_SETUP_STARTED",
                TrinoAction::ChannelSetupCancelled(_) => "TRINO_CHANNEL_SETUP_CANCELLED",
                TrinoAction::ChannelSetupFailed(_) => "TRINO_CHANNEL_SETUP_FAILED",
                TrinoAction::ChannelReady(_) => "TRINO_CHANNEL_READY",
            },
        ),
        ConnectionAction::Salesforce(action) => (
            "salesforce",
            match action {
                SalesforceAction::ChannelSetupStarted => "SF_CHANNEL_SETUP_STARTED",
                SalesforceAction::ChannelSetupCancelled(_) => "SF_CHANNEL_SETUP_CANCELLED",
                SalesforceAction::ChannelSetupFailed(_) => "SF_CHANNEL_SETUP_FAILED",
                SalesforceAction::ChannelReady(_) => "SF_CHANNEL_READY",
                _ => LoginStep::of(&ConnectionAction::Salesforce(action.clone())).expect("a step of the login").name(),
            },
        ),
        ConnectionAction::Hyper(action) => (
            "hyper",
            match action {
                HyperAction::ChannelSetupStarted { .. } => "HYPER_CHANNEL_SETUP_STARTED",
                HyperAction::ChannelSetupCancelled(_) => "HYPER_CHANNEL_SETUP_CANCELLED",
                HyperAction::ChannelSetupFailed(_) => "HYPER_CHANNEL_SETUP_FAILED",
                HyperAction::ChannelReady { .. } => "HYPER_CHANNEL_READY",
            },
        ),
        other => panic!("no action of a setup: {other:?}"),
    };
    format!("{connector}:{name}")
}

impl SetupHost for FakeHost {
    fn dispatch(&self, action: &ConnectionAction) {
        self.actions.borrow_mut().push(step_name(action));
        self.dispatched.borrow_mut().push(action.clone());
        if self.login.get() {
            if let Some(step) = LoginStep::of(action) {
                self.login_steps.borrow_mut().push(step.name());
            }
        }
    }

    fn connect_hyper_channel(
        &self,
        channel: &HyperChannelRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static {
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

    fn client_context(&self) -> Option<Value> {
        Some(json!({ "dashql": { "connectionId": "test", "queryType": "user" } }))
    }

    fn run_probe(
        &self,
        query: &str,
        metadata: &QueryMetadata,
        _cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static {
        self.probes.borrow_mut().push((query.to_string(), metadata.clone()));
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
    block_on(setup_trino(host.clone(), trino_basic_params(), false, CancellationToken::new())).unwrap();
    assert_eq!(host.actions(), ["trino:TRINO_CHANNEL_SETUP_STARTED", "trino:TRINO_CHANNEL_READY"]);
    // The params of the action are without the draft rows
    assert!(host.params("trino:TRINO_CHANNEL_SETUP_STARTED").get("draftRows").is_none());
    // The connection owns the channel, the host connects nothing
    let ConnectionChannel::Trino(opened) = host.ready_channel() else { panic!("a Trino channel") };
    let opened = opened.channel();
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
    *host.loopback.borrow_mut() = Some(Box::new(|url| {
        Ok(OAuthCallback { code: Some("auth-code".into()), state: query_param(url, "state"), ..Default::default() })
    }));
    host.event.set(Some(OAuthFlowEvent::ExternalBrowserOpened));
    host.responses.borrow_mut().push_back(json_response(json!({
        "access_token": "access-1", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 300,
    })));
    block_on(setup_trino(host.clone(), trino_oauth_params(), true, CancellationToken::new())).unwrap();
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
    assert!(
        body.contains("grant_type=authorization_code")
            && body.contains("code=auth-code")
            && body.contains("code_verifier=verifier"),
        "{body}"
    );
    // The channel is the one owner of the token, the steps carry neither the verifier, the code nor the token
    let ConnectionChannel::Trino(opened) = host.ready_channel() else { panic!("a Trino channel") };
    assert_eq!(opened.access_token().map(|token| token.access_token), Some("access-1".to_string()));
    let steps = format!(
        "{:?}",
        host.dispatched
            .borrow()
            .iter()
            .filter(|action| !matches!(action, ConnectionAction::Trino(TrinoAction::ChannelReady(_))))
            .collect::<Vec<_>>()
    );
    for secret in ["verifier", "auth-code", "access-1", "refresh-1"] {
        assert!(!steps.contains(secret), "{secret} in {steps}");
    }
}

#[test]
fn trino_oauth_fails_on_a_foreign_state_an_error_and_a_missing_loopback_server() {
    let run = |answer: Option<LoopbackAnswer>| {
        let host = Rc::new(FakeHost::default());
        *host.loopback.borrow_mut() = answer;
        let message =
            failure_message(block_on(setup_trino(host.clone(), trino_oauth_params(), false, CancellationToken::new())));
        assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_FAILED"));
        message
    };
    let forged = run(Some(Box::new(|_| {
        Ok(OAuthCallback { code: Some("code".into()), state: Some("forged".into()), ..Default::default() })
    })));
    assert!(forged.contains("state"), "{forged}");
    let denied = run(Some(Box::new(|_| {
        Ok(OAuthCallback {
            error: Some("access_denied".into()),
            error_description: Some("User denied access".into()),
            ..Default::default()
        })
    })));
    assert_eq!(denied, "User denied access");
    assert_eq!(run(None), "no loopback server");
}

/// Trino params with OAuth and neither a callback URL nor scopes of their own
fn trino_oauth_defaults_params() -> JsonObject {
    object(json!({
        "endpoint": TRINO_ENDPOINT,
        "auth": {
            "authType": "AUTH_OAUTH",
            "oauth": { "authorizationUrl": "https://idp/auth", "tokenUrl": "https://idp/token", "clientId": "dashql", "callbackUrl": "" },
        },
    }))
}

#[test]
fn trino_oauth_takes_the_default_redirect_and_scopes_and_hands_the_token_to_the_channel_only() {
    let host = Rc::new(FakeHost::default());
    host.now.set(5_000.0);
    *host.loopback.borrow_mut() = Some(Box::new(|url| {
        Ok(OAuthCallback { code: Some("code-1".into()), state: query_param(url, "state"), ..Default::default() })
    }));
    host.responses
        .borrow_mut()
        .push_back(json_response(json!({ "access_token": "token-1", "token_type": "Bearer", "expires_in": 60 })));
    let params = trino_oauth_defaults_params();
    block_on(setup_trino(host.clone(), params.clone(), true, CancellationToken::new())).unwrap();
    let url = host.opened.borrow()[0].clone();
    assert!(url.starts_with("https://idp/auth?"), "{url}");
    let redirect = query_param(&url, "redirect_uri").expect("a redirect");
    assert!(redirect.starts_with("http://localhost:"), "{redirect}");
    assert!(query_param(&url, "scope").expect("scopes").contains("offline_access"), "{url}");
    let body = host.sent.borrow()[0].body.clone().unwrap_or_default();
    for part in ["grant_type=authorization_code", "code=code-1", "code_verifier=verifier"] {
        assert!(body.contains(part), "{part}: {body}");
    }
    // The token request names the redirect of the authorization
    assert_eq!(query_param(&format!("?{body}"), "redirect_uri"), Some(redirect), "{body}");
    // The connection learns when the code arrived, the code stays with the setup
    let mut connection = ConnectionState::from_params("c1", ConnectionParams::new(ConnectorType::Trino, params), 0.0);
    for action in host.dispatched.borrow().iter() {
        connection.apply(action.clone(), 1000.0).unwrap();
    }
    let oauth = connection.details().trino().and_then(|trino| trino.oauth_state.clone());
    assert_eq!(oauth.as_ref().map(|state| state.pkce_generated), Some(true));
    assert_eq!(oauth.and_then(|state| state.auth_code_received_at).as_deref(), Some("1970-01-01T00:00:05.000Z"));
    assert_eq!(connection.health(), ConnectionHealth::Connecting);
    // The channel of the connection is the one owner of the token
    let Some(ConnectionChannel::Trino(shared)) = connection.details().channel.clone() else {
        panic!("a Trino channel")
    };
    let channel = shared.channel();
    let statement = channel.http_request(&TrinoRequest::SubmitStatement { text: "select 1".into() }).unwrap();
    assert_eq!(statement.header("Authorization"), Some("Bearer token-1"));
    assert_eq!(channel.access_token.as_ref().and_then(|token| token.expires_at), Some(65_000));
    assert!(!format!("{:?}", connection.details().trino()).contains("token-1"));
}

#[test]
fn trino_oauth_fails_on_bad_callbacks_and_tokens_and_without_its_settings() {
    let run = |params: JsonObject, callback: OAuthCallback, token: Option<HttpResponse>| {
        let host = Rc::new(FakeHost::default());
        *host.loopback.borrow_mut() = Some(Box::new(move |_| Ok(callback.clone())));
        host.responses.borrow_mut().extend(token);
        let message = failure_message(block_on(setup_trino(host.clone(), params, false, CancellationToken::new())));
        assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_FAILED"));
        assert_eq!(host.error("trino:OAUTH_FAILED").message, message);
        (message, host)
    };
    let callback = |code: Option<&str>, error: Option<&str>| OAuthCallback {
        code: code.map(Into::into),
        state: Some("state-1".into()),
        error: error.map(Into::into),
        error_description: None,
    };
    let params = trino_oauth_defaults_params;
    assert_eq!(run(params(), callback(None, Some("access_denied")), None).0, "access_denied");
    assert_eq!(run(params(), callback(None, None), None).0, "No authorization code received");
    let (message, host) = run(params(), callback(Some("code"), None), Some(HttpResponse::new(401, "unauthorized")));
    assert!(message.contains("401"), "{message}");
    assert!(!host.actions().iter().any(|action| action == "trino:TRINO_CHANNEL_READY"));
    // A response that echoes credentials is redacted
    let echoed =
        json!({ "error": "invalid_grant", "refresh_token": "refresh-secret", "code_verifier": "verifier-secret" });
    let (message, _) = run(params(), callback(Some("code"), None), Some(HttpResponse::new(400, echoed.to_string())));
    assert!(message.contains("400") && message.contains("invalid_grant"), "{message}");
    assert!(!message.contains("refresh-secret") && !message.contains("verifier-secret"), "{message}");

    // OAuth without its settings fails before the flow starts, the connection shows the error
    let mut without = params();
    without.insert("auth".into(), json!({ "authType": "AUTH_OAUTH" }));
    let (message, host) = run(without, OAuthCallback::default(), None);
    assert!(message.contains("OAuth configuration"), "{message}");
    assert_eq!(host.actions(), ["trino:OAUTH_STARTED", "trino:OAUTH_FAILED"]);
    assert!(host.opened.borrow().is_empty());
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
    block_on(check_health(host.clone(), ConnectorType::Trino, CancellationToken::new())).unwrap();
    assert_eq!(host.actions(), ["connection:HEALTH_CHECK_STARTED", "connection:HEALTH_CHECK_SUCCEEDED"]);
    let probes = host.probes.borrow();
    let (query, metadata) = &probes[0];
    assert_eq!(query.as_str(), ConnectorType::Trino.connector().health_probe());
    assert_eq!(metadata.query_type, QueryType::HealthCheck);
    drop(probes);

    let host = Rc::new(FakeHost::default());
    block_on(check_health(host.clone(), ConnectorType::Hyper, CancellationToken::new())).unwrap();
    assert_eq!(host.probes.borrow()[0].0, ConnectorType::Hyper.connector().health_probe());
}

#[test]
fn the_health_check_fails_with_the_error_of_the_probe() {
    let host = Rc::new(FakeHost::default());
    let mut rejected = DetailedError::new("Unauthorized");
    rejected.data.insert("status".into(), "401".into());
    *host.probe.borrow_mut() = Some(Ok(ProbeResult::Failed(rejected.clone())));
    let failure = block_on(check_health(host.clone(), ConnectorType::Trino, CancellationToken::new())).unwrap_err();
    assert_eq!(
        (failure.message.as_str(), failure.data.get("status").map(String::as_str)),
        ("Unauthorized", Some("401"))
    );
    assert_eq!(host.actions(), ["connection:HEALTH_CHECK_STARTED", "connection:HEALTH_CHECK_FAILED"]);
    assert_eq!(host.error("connection:HEALTH_CHECK_FAILED"), rejected);

    // A probe without a table fails as well
    let host = Rc::new(FakeHost::default());
    *host.probe.borrow_mut() = Some(Ok(ProbeResult::Finished { has_table: false }));
    assert_eq!(
        failure_message(block_on(check_health(host.clone(), ConnectorType::Trino, CancellationToken::new()))),
        "health check failed"
    );

    // A cancelled check is cancelled whatever the probe did
    let host = Rc::new(FakeHost::default());
    let token = CancellationToken::new();
    token.cancel();
    let result = block_on(check_health(host.clone(), ConnectorType::Trino, token));
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
    let bytes =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(state).map_err(|e| HostError::new(e.to_string()))?;
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
        responses
            .push_back(json_response(json!({ "preferred_username": "user@example.com", "organization_id": "org-1" })));
    } else {
        responses.push_back(HttpResponse::new(403, "forbidden"));
    }
    responses.push_back(json_response(json!({
        "access_token": "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE4MDAwMDAwMDAsImF1ZGllbmNlVGVuYW50SWQiOiJ0ZW5hbnQifQ.c2ln",
        "instance_url": "tenant.c360a.salesforce.com", "token_type": "Bearer", "expires_in": 7200,
    })));
}

#[test]
fn salesforce_logs_in_and_hands_the_hyper_channel_with_the_tokens_to_the_connection() {
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
    assert_eq!(result.user_info.as_ref().and_then(|info| info.preferred_username.as_deref()), Some("user@example.com"));
    // The steps of the login, the full list is pinned by the Trino login above
    let actions = host.actions();
    assert_eq!(actions.first().map(String::as_str), Some("salesforce:SETUP_STARTED"));
    assert_eq!(actions.last().map(String::as_str), Some("salesforce:SF_CHANNEL_READY"));
    for step in ["salesforce:RECEIVED_CORE_USER_INFO", "salesforce:RECEIVED_DATA_CLOUD_ACCESS_TOKEN"] {
        assert!(actions.iter().any(|action| action == step), "{step}: {actions:?}");
    }
    // The channel is the one owner of the tokens, the host connects nothing
    let ConnectionChannel::Salesforce(channel) = host.ready_channel() else { panic!("a Salesforce channel") };
    assert_eq!(channel.tokens().core.access_token, "core-token");
    let hyper = channel.hyper();
    assert_eq!(hyper.context().attached_databases.len(), 1, "Database.com attaches its Hyper Cloud database");
    assert_eq!(hyper.client().endpoint().origin(), "https://tenant.c360a.salesforce.com");
    let auth = channel.auth();
    assert!(auth.get("authorization").is_some_and(|value| value.starts_with("Bearer eyJ")));
    assert_eq!(auth.get("audience"), Some("tenant"));
    // The steps carry neither the verifier, the code nor a token
    let steps = format!(
        "{:?}",
        host.dispatched
            .borrow()
            .iter()
            .filter(|action| !matches!(action, ConnectionAction::Salesforce(SalesforceAction::ChannelReady(_))))
            .collect::<Vec<_>>()
    );
    for secret in ["verifier", "core-code", "core-token", "eyJ"] {
        assert!(!steps.contains(secret), "{secret} in {steps}");
    }
}

#[test]
fn salesforce_authenticates_without_a_channel_and_skips_a_missing_user_info() {
    let host = Rc::new(FakeHost::default());
    host.login.set(true);
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    salesforce_responses(&host, false);
    let authentication = block_on(authenticate_salesforce(
        host.clone(),
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    ))
    .unwrap();
    assert_eq!(authentication.tokens.core.access_token, "core-token");
    assert!(authentication.user_info.is_none());
    assert!(!host.actions().contains(&"salesforce:RECEIVED_CORE_USER_INFO".to_string()));
    // The listener of the login hears the names of the steps, the tokens are only in the outcome
    let steps = host.login_steps.borrow();
    assert_eq!(steps.first().copied(), Some("SETUP_STARTED"));
    assert_eq!(steps.last().copied(), Some("RECEIVED_DATA_CLOUD_ACCESS_TOKEN"));
    assert!(!steps.iter().any(|step| step.contains("USER_INFO") || step.contains("CHANNEL")), "{steps:?}");
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
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    );
    assert_eq!(failure_message(block_on(run)), "User denied access");
    assert_eq!(host.actions().last().map(String::as_str), Some("salesforce:SETUP_FAILED"));

    // Cancelled while the redirect page waits
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    host.cancel_in_flow.set(true);
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    );
    assert!(matches!(block_on(run), Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions().last().map(String::as_str), Some("salesforce:SETUP_CANCELLED"));

    // Without the redirect page of the app
    let host = Rc::new(FakeHost::default());
    let config = SalesforceOAuthConfig::default();
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        config,
        false,
        CancellationToken::new(),
    );
    assert!(failure_message(block_on(run)).contains("redirect"));
    assert_eq!(host.actions(), ["salesforce:SETUP_STARTED", "salesforce:SETUP_FAILED"]);

    // A callback of another flow, and one without a code
    for (answer, message) in [
        (
            Box::new(|url: &str| {
                let mut callback = redirect_callback(url)?;
                if let Some(state) = callback.state.as_mut() {
                    state.flow_id = "flow-2".into();
                }
                Ok(callback)
            }) as RedirectAnswer,
            "flow ID",
        ),
        (Box::new(|url: &str| Ok(OAuthRedirectData { code: None, ..redirect_callback(url)? })), "authorization code"),
    ] {
        let host = Rc::new(FakeHost::default());
        *host.redirect.borrow_mut() = Some(answer);
        let run = setup_salesforce(
            host.clone(),
            ConnectorType::SalesforceDataCloud,
            salesforce_params(),
            salesforce_config(),
            false,
            CancellationToken::new(),
        );
        let failure = failure_message(block_on(run));
        assert!(failure.contains(message), "{failure}");
        assert_eq!(host.error("salesforce:SETUP_FAILED").message, failure);
        assert!(host.sent.borrow().is_empty());
    }

    // A rejected core token stops the setup before the user info
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    host.responses.borrow_mut().push_back(HttpResponse::new(400, r#"{"error":"invalid_grant"}"#));
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    );
    failure_message(block_on(run));
    assert_eq!(host.sent.borrow().len(), 1);
    assert_eq!(host.actions().last().map(String::as_str), Some("salesforce:SETUP_FAILED"));
}

#[test]
fn salesforce_exchanges_the_code_with_the_verifier_and_attaches_no_database_for_data_cloud() {
    let host = Rc::new(FakeHost::default());
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    salesforce_responses(&host, true);
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    );
    block_on(run).unwrap();
    let sent = host.sent.borrow();
    assert_eq!(sent[0].url, "https://example.my.salesforce.com/services/oauth2/token");
    let body = sent[0].body.clone().unwrap_or_default();
    assert!(body.contains("code=core-code") && body.contains("code_verifier=verifier"), "{body}");
    assert!(sent[1].url.contains("/services/oauth2/userinfo"));
    assert!(sent[2].url.ends_with("/services/a360/token"));
    let ConnectionChannel::Salesforce(channel) = host.ready_channel() else { panic!("a Salesforce channel") };
    assert!(channel.hyper().context().attached_databases.is_empty());
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
    for (protocol, kind) in [("WASM", HyperChannelKind::Embedded), ("V3_GRPC", HyperChannelKind::Grpc)] {
        let host = Rc::new(FakeHost::default());
        block_on(setup_hyper(host.clone(), hyper_params(protocol), CancellationToken::new())).unwrap();
        assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_READY"]);
        assert_eq!(host.ready_channel(), ConnectionChannel::Host(9));
        let params = host.params("hyper:HYPER_CHANNEL_READY");
        assert!(params.get("draftRows").is_none());
        assert_eq!(params["protocol"], protocol);
        assert_eq!(host.hyper_channels.borrow()[0].kind, kind);
    }
}

#[test]
fn hyper_over_http_is_a_channel_of_the_connection_with_the_metadata_as_headers() {
    let host = Rc::new(FakeHost::default());
    block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP"), CancellationToken::new())).unwrap();
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_READY"]);
    // The host connects nothing
    assert!(host.hyper_channels.borrow().is_empty());
    let ConnectionChannel::HyperHttp { channel, auth } = host.ready_channel() else {
        panic!("a Hyper channel over HTTP")
    };
    assert_eq!(auth.get("ctx-tenant-id"), Some("tenant-123"));
    let request = channel.execute_query("select 1", &auth);
    assert_eq!(request.url, "https://hyper.example.com/api/v3/query");
    assert_eq!(
        channel.context().client_context,
        Some(json!({ "dashql": { "connectionId": "test", "queryType": "user" } }))
    );
    // An endpoint that is no URL fails the setup
    let host = Rc::new(FakeHost::default());
    let mut params = hyper_params("V3_HTTP");
    params.insert("endpoint".into(), json!(""));
    block_on(setup_hyper(host.clone(), params, CancellationToken::new())).unwrap_err();
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_FAILED"]);
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
    let message =
        failure_message(block_on(setup_trino(host.clone(), trino_oauth_params(), false, CancellationToken::new())));
    assert_eq!(message, "the platform has no crypto");
    assert!(host.opened.borrow().is_empty(), "no login without a state that binds its callback");
    assert_eq!(host.actions().last().map(String::as_str), Some("trino:OAUTH_FAILED"));

    let host = Rc::new(FakeHost::default());
    host.no_random_id.set(true);
    *host.redirect.borrow_mut() = Some(Box::new(redirect_callback));
    let run = setup_salesforce(
        host.clone(),
        ConnectorType::SalesforceDataCloud,
        salesforce_params(),
        salesforce_config(),
        false,
        CancellationToken::new(),
    );
    assert_eq!(failure_message(block_on(run)), "the platform has no crypto");
    assert!(host.opened.borrow().is_empty());
}

#[test]
fn hyper_links_need_their_token_and_speak_http() {
    let host = Rc::new(FakeHost::default());
    let message =
        failure_message(block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP_LINK"), CancellationToken::new())));
    assert!(message.starts_with("Open the link of this Hyper again"), "{message}");
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_FAILED"]);

    let host = Rc::new(FakeHost::default());
    *host.link_token.borrow_mut() = Some("link-token".into());
    block_on(setup_hyper(host.clone(), hyper_params("V3_HTTP_LINK"), CancellationToken::new())).unwrap();
    assert!(host.hyper_channels.borrow().is_empty());
    let ConnectionChannel::HyperHttp { auth, .. } = host.ready_channel() else { panic!("a Hyper channel over HTTP") };
    assert_eq!(auth.get("authorization"), Some("Bearer link-token"));
    assert_eq!(auth.get("ctx-tenant-id"), Some("tenant-123"));
    // The connection keeps the params of the link, without the token
    let params = host.params("hyper:HYPER_CHANNEL_READY");
    assert_eq!(params["protocol"], "V3_HTTP_LINK");
    assert!(!format!("{params:?}").contains("link-token"));
}

#[test]
fn hyper_fails_and_closes_a_channel_that_was_ready_after_the_cancellation() {
    let host = Rc::new(FakeHost::default());
    *host.connect_error.borrow_mut() = Some("gRPC client is not available".into());
    assert_eq!(
        failure_message(block_on(setup_hyper(host.clone(), hyper_params("V3_GRPC"), CancellationToken::new()))),
        "gRPC client is not available"
    );
    assert_eq!(host.error("hyper:HYPER_CHANNEL_SETUP_FAILED"), DetailedError::new("gRPC client is not available"));

    let host = Rc::new(FakeHost::default());
    host.cancel_in_flow.set(true);
    let result = block_on(setup_hyper(host.clone(), hyper_params("V3_GRPC"), CancellationToken::new()));
    assert!(matches!(result, Err(SetupFailure { cancelled: true, .. })));
    assert_eq!(host.actions(), ["hyper:HYPER_CHANNEL_SETUP_STARTED", "hyper:HYPER_CHANNEL_SETUP_CANCELLED"]);
    assert_eq!(*host.closed.borrow(), [9]);
}

// ---------------------------------------------------------------------------------------------------------------------
// The tokens of a Salesforce channel

/// A Salesforce channel whose Data Cloud token expires at a time, with a refresh token
fn expiring_salesforce_channel(expires_at: &str) -> dashql_core_runtime::salesforce::SharedSalesforceChannel {
    use dashql_core_runtime::salesforce::{
        SalesforceConnectionParams, SalesforceCoreAccessToken, SalesforceDataCloudAccessToken, SalesforceTokens,
        SharedSalesforceChannel,
    };
    let core = SalesforceCoreAccessToken {
        access_token: "core-1".into(),
        refresh_token: Some("refresh-1".into()),
        instance_url: Some("https://example.my.salesforce.com".into()),
        ..Default::default()
    };
    let data_cloud = SalesforceDataCloudAccessToken {
        instance_url: "https://tenant.c360a.salesforce.com/".into(),
        expires_at: expires_at.into(),
        ..Default::default()
    };
    let params = SalesforceConnectionParams { app_consumer_key: "consumer-key".into(), ..Default::default() };
    SharedSalesforceChannel::new(ConnectorType::SalesforceDataCloud, &params, SalesforceTokens { core, data_cloud })
        .unwrap()
}

#[test]
fn salesforce_refreshes_tokens_about_to_expire_with_the_refresh_token() {
    let host = Rc::new(FakeHost::default());
    // 2026-01-01T00:00:00Z, the token expires in 30 seconds
    host.now.set(1_767_225_600_000.0);
    let channel = expiring_salesforce_channel("2026-01-01T00:00:30.000Z");
    {
        let mut responses = host.responses.borrow_mut();
        responses.push_back(json_response(
            json!({ "access_token": "core-2", "instance_url": "https://example.my.salesforce.com" }),
        ));
        responses.push_back(json_response(json!({
            "access_token": "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjE4MDAwMDAwMDAsImF1ZGllbmNlVGVuYW50SWQiOiJ0ZW5hbnQifQ.c2ln",
            "instance_url": "tenant.c360a.salesforce.com", "token_type": "Bearer", "expires_in": 7200,
        })));
    }
    // Two callers share one refresh
    let first = channel.fresh(&host);
    let second = channel.fresh(&host);
    assert_eq!(block_on(async { (first.await, second.await) }), (Ok(()), Ok(())));
    let sent = host.sent.borrow();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].url, "https://example.my.salesforce.com/services/oauth2/token");
    let body = sent[0].body.clone().unwrap_or_default();
    assert!(
        body.contains("grant_type=refresh_token")
            && body.contains("refresh_token=refresh-1")
            && body.contains("client_id=consumer-key"),
        "{body}"
    );
    assert!(sent[1].url.ends_with("/services/a360/token"));
    drop(sent);
    // The channel keeps the new tokens and the refresh token of the login
    let tokens = channel.tokens();
    assert_eq!(tokens.core.access_token, "core-2");
    assert_eq!(tokens.core.refresh_token.as_deref(), Some("refresh-1"));
    assert!(channel.auth().get("authorization").is_some_and(|value| value.starts_with("Bearer eyJ")));
    // A fresh token is not refreshed again
    assert_eq!(block_on(channel.fresh(&host)), Ok(()));
    assert_eq!(host.sent.borrow().len(), 2);
}

#[test]
fn salesforce_keeps_the_tokens_of_a_failed_refresh() {
    let host = Rc::new(FakeHost::default());
    host.now.set(1_767_225_600_000.0);
    let channel = expiring_salesforce_channel("2026-01-01T00:00:30.000Z");
    host.responses.borrow_mut().push_back(HttpResponse::new(
        400,
        json!({ "error": "invalid_grant", "error_description": "expired" }).to_string(),
    ));
    assert_eq!(block_on(channel.fresh(&host)), Err("expired".to_string()));
    assert_eq!(channel.tokens().core.access_token, "core-1");
    // A token far from its expiry needs no refresh
    let host = Rc::new(FakeHost::default());
    host.now.set(1_767_225_600_000.0);
    assert_eq!(block_on(expiring_salesforce_channel("2026-01-01T02:00:00.000Z").fresh(&host)), Ok(()));
    assert!(host.sent.borrow().is_empty());
}
