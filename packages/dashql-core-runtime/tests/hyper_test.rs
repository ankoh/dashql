//! The Hyper connector and the connection helpers, against a fake server.

use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use arrow_array::{Int32Array, RecordBatch};
use arrow_schema::{DataType, Field, Schema};
use dashql_core_runtime::connections::health_check::*;
use dashql_core_runtime::connections::import::*;
use dashql_core_runtime::connections::label::*;
use dashql_core_runtime::connections::sharing::sanitize_connection_params_for_sharing;
use dashql_core_runtime::connections::*;
use dashql_core_runtime::hyper::descriptor::{cache_signature, reads_attachments};
use dashql_core_runtime::hyper::embedded::*;
use dashql_core_runtime::hyper::link::*;
use dashql_core_runtime::hyper::local_cloud::*;
use dashql_core_runtime::http::{Body, HostBytes};
use dashql_core_runtime::hyper::*;
use serde_json::{json, Value};

const NOW: i64 = 1_767_225_600_000;
const ENDPOINT: &str = "https://mock.hyperdb.local";
const ARROW: &str = "application/vnd.apache.arrow.stream";
/// Not Arrow, the client passes the bytes through
const MOCK_ARROW: &[u8] = b"ARROW1";

fn object(value: Value) -> JsonObject {
    value.as_object().cloned().unwrap()
}

/// A table of one Int32 column as an Arrow stream: schema, batch, end of stream
fn int_table(name: &str, values: &[i32]) -> Vec<u8> {
    let schema = Arc::new(Schema::new(vec![Field::new(name, DataType::Int32, false)]));
    let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(values.to_vec()))]).unwrap();
    let mut writer = arrow_ipc::writer::StreamWriter::try_new(Vec::new(), &schema).unwrap();
    writer.write(&batch).unwrap();
    writer.finish().unwrap();
    writer.into_inner().unwrap()
}

fn int_values(batch: &RecordBatch) -> Vec<i32> {
    batch.column(0).as_any().downcast_ref::<Int32Array>().unwrap().values().to_vec()
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake server
// ---------------------------------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct MockQuery {
    query_id: String,
    completion_status: &'static str,
    arrow_bytes: Vec<u8>,
    chunk_count: u64,
    row_count: u64,
    execution_stats: (f64, f64),
}

#[derive(Default)]
struct MockResult {
    query_id: Option<String>,
    completion_status: Option<&'static str>,
    arrow_bytes: Option<Vec<u8>>,
    error: Option<(u16, Value)>,
}

type Handler = Box<dyn FnMut(&str, &Value) -> MockResult>;

#[derive(Default)]
struct MockServer {
    queries: HashMap<String, MockQuery>,
    handler: Option<Handler>,
    next_query_id: u64,
    requests: Vec<HttpRequest>,
}

fn json_response(status: u16, body: &Value) -> HttpResponse {
    HttpResponse::new(status, body.to_string()).with_header("Content-Type", "application/json")
}

fn not_found(message: &str) -> HttpResponse {
    json_response(404, &json!({ "error": "NOT_FOUND", "message": message }))
}

impl MockServer {
    fn set_handler(&mut self, handler: impl FnMut(&str, &Value) -> MockResult + 'static) {
        self.handler = Some(Box::new(handler));
    }

    fn register(&mut self, query: MockQuery) {
        self.queries.insert(query.query_id.clone(), query);
    }

    fn status_of(query: &MockQuery) -> Value {
        json!({
            "queryId": query.query_id,
            "completionStatus": query.completion_status,
            "chunkCount": query.chunk_count,
            "rowCount": query.row_count,
            "progress": if query.completion_status == "RUNNING_OR_UNSPECIFIED" { 0 } else { 100 },
            "expirationTime": "2026-01-01T00:05:00.000Z",
            "executionStats": { "wallClockTime": query.execution_stats.0, "rowsProcessed": query.execution_stats.1 },
        })
    }

    fn arrow_response(bytes: &[u8], status: Option<&Value>) -> HttpResponse {
        let response = HttpResponse::new(200, bytes.to_vec()).with_header("Content-Type", ARROW).with_status_text("OK");
        match status {
            Some(status) => response.with_header("x-hyperdb-status", &status.to_string()),
            None => response,
        }
    }

    fn fetch(&mut self, request: &HttpRequest) -> HttpResponse {
        self.requests.push(request.clone());
        let url = request.url.strip_prefix(ENDPOINT).expect("a request to the endpoint");
        let path = url.split('?').next().unwrap_or_default();
        let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        match (&request.method, segments.as_slice()) {
            (HttpMethod::Post, ["api", "v3", "query"]) => self.execute(request),
            (HttpMethod::Get, ["api", "v3", "query", id]) => match self.queries.get(*id) {
                Some(query) => json_response(200, &Self::status_of(query)),
                None => not_found(&format!("Query {id} not found")),
            },
            (HttpMethod::Delete, ["api", "v3", "query", id]) => {
                self.queries.remove(*id);
                HttpResponse::new(204, Vec::new()).with_status_text("No Content")
            }
            (HttpMethod::Get, ["api", "v3", "query", id, "chunk", _]) => match self.queries.get(*id) {
                Some(query) => Self::arrow_response(&query.arrow_bytes, Some(&Self::status_of(query))),
                None => not_found(&format!("Query {id} not found")),
            },
            (HttpMethod::Get, ["api", "v3", "query", id, "row"]) => match self.queries.get(*id) {
                Some(query) => Self::arrow_response(&query.arrow_bytes, None),
                None => not_found(&format!("Query {id} not found")),
            },
            _ => not_found(&format!("No mock for {} {path}", request.method)),
        }
    }

    fn execute(&mut self, request: &HttpRequest) -> HttpResponse {
        let body: Value = serde_json::from_str(request.body.as_deref().unwrap_or("{\"sql\":\"\"}")).unwrap();
        let sql = body.get("sql").and_then(Value::as_str).unwrap_or_default().to_string();
        let result = match self.handler.as_mut() {
            Some(handler) => handler(&sql, &body),
            None => MockResult { completion_status: Some("RESULTS_PRODUCED"), ..Default::default() },
        };
        if let Some((status, error)) = result.error {
            return json_response(status, &error);
        }
        let query_id = result.query_id.unwrap_or_else(|| {
            self.next_query_id += 1;
            format!("mock-query-{}", self.next_query_id)
        });
        let completion_status = result.completion_status.unwrap_or("RESULTS_PRODUCED");
        let query = MockQuery {
            query_id: query_id.clone(),
            completion_status,
            arrow_bytes: result.arrow_bytes.unwrap_or_default(),
            chunk_count: if completion_status == "RUNNING_OR_UNSPECIFIED" { 0 } else { 1 },
            row_count: 0,
            execution_stats: (1.0, 0.0),
        };
        let response = Self::arrow_response(&query.arrow_bytes, Some(&Self::status_of(&query)));
        self.queries.insert(query_id, query);
        response
    }
}

fn mock_client() -> HyperHttpClient {
    HyperHttpClient::new(ENDPOINT).unwrap()
}

fn mock_auth() -> Headers {
    Headers::from_pairs([("Authorization", "Bearer mock-token")])
}

fn produced(query_id: &str, bytes: Vec<u8>) -> MockResult {
    MockResult {
        query_id: Some(query_id.to_string()),
        completion_status: Some("RESULTS_PRODUCED"),
        arrow_bytes: Some(bytes),
        ..Default::default()
    }
}

fn running(query_id: &str) -> MockResult {
    MockResult {
        query_id: Some(query_id.to_string()),
        completion_status: Some("RUNNING_OR_UNSPECIFIED"),
        ..Default::default()
    }
}

/// Submit a query through the client
fn execute(server: &mut MockServer, sql: &str) -> Result<QueryResponse, HyperError> {
    let request = mock_client().execute_query(&ExecuteQueryRequest::new(sql), None, &mock_auth());
    read_query_response(server.fetch(&request))
}

fn http_error(result: Result<impl std::fmt::Debug, HyperError>) -> HyperHttpError {
    match result {
        Err(HyperError::Http(error)) => error,
        other => panic!("expected an HTTP error, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The status of a query
// ---------------------------------------------------------------------------------------------------------------------

fn status(overrides: impl FnOnce(&mut QueryStatus)) -> QueryStatus {
    let mut status = QueryStatus::new("q1");
    overrides(&mut status);
    status
}

#[test]
fn reads_counts_that_are_serialized_as_strings() {
    let read = QueryStatus::read(&json!({
        "queryId": "q1",
        "completionStatus": "FINISHED",
        "chunkCount": "10",
        "rowCount": "1234",
        "progress": 100,
        "executionStats": { "wallClockTime": 12.5, "rowsProcessed": "5000" },
    }));
    assert_eq!(
        read,
        status(|s| {
            s.completion_status = CompletionStatus::Finished;
            s.chunk_count = Some(10.0);
            s.row_count = Some(1234.0);
            s.progress = Some(100.0);
            s.execution_stats = Some(ExecutionStats { wall_clock_time: 12.5, rows_processed: 5000.0 });
        })
    );
}

#[test]
fn defaults_missing_fields_of_a_status() {
    assert_eq!(QueryStatus::read(&json!({ "queryId": "q1" })), status(|_| {}));
    assert_eq!(QueryStatus::read(&json!({ "queryId": "q1", "chunkCount": "many", "rowCount": null })), status(|_| {}));
}

#[test]
fn merging_does_not_roll_back_a_newer_status() {
    let newer = status(|s| {
        s.completion_status = CompletionStatus::Finished;
        s.chunk_count = Some(8.0);
        s.row_count = Some(800.0);
        s.progress = Some(100.0);
        s.execution_stats = Some(ExecutionStats { wall_clock_time: 20.0, rows_processed: 1000.0 });
    });
    let older = status(|s| {
        s.chunk_count = Some(3.0);
        s.row_count = Some(300.0);
        s.progress = Some(40.0);
        s.execution_stats = Some(ExecutionStats { wall_clock_time: 5.0, rows_processed: 400.0 });
    });
    assert_eq!(newer.merge(&older), newer);
}

#[test]
fn merging_advances_to_a_newer_status() {
    let current = status(|s| {
        s.chunk_count = Some(1.0);
        s.progress = Some(10.0);
    });
    let update = status(|s| {
        s.completion_status = CompletionStatus::ResultsProduced;
        s.chunk_count = Some(4.0);
        s.row_count = Some(400.0);
        s.progress = Some(100.0);
        s.expiration_time = Some("2026-10-30T12:00:00Z".to_string());
        s.execution_stats = Some(ExecutionStats { wall_clock_time: 3.0, rows_processed: 400.0 });
    });
    assert_eq!(current.merge(&update), update);
}

#[test]
fn merging_keeps_known_values_when_an_update_omits_them() {
    let current = status(|s| {
        s.chunk_count = Some(2.0);
        s.row_count = Some(200.0);
        s.expiration_time = Some("2026-10-30T12:00:00Z".to_string());
        s.execution_stats = Some(ExecutionStats { wall_clock_time: 3.0, rows_processed: 200.0 });
    });
    assert_eq!(current.merge(&status(|_| {})), current);
}

// ---------------------------------------------------------------------------------------------------------------------
// The client against the fake server
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn execute_returns_results_produced_and_the_arrow_bytes_of_a_fast_query() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| produced("q-fast", MOCK_ARROW.to_vec()));
    let response = execute(&mut server, "SELECT n FROM t").unwrap();
    let status = response.status.unwrap();
    assert_eq!(status.completion_status, CompletionStatus::ResultsProduced);
    assert_eq!(status.chunk_count, Some(1.0));
    assert_eq!(response.body, MOCK_ARROW);
}

#[test]
fn execute_returns_running_with_empty_bytes_for_an_async_query() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| running("q-slow"));
    let response = execute(&mut server, "SELECT slow()").unwrap();
    let status = response.status.unwrap();
    assert_eq!(status.completion_status, CompletionStatus::RunningOrUnspecified);
    assert_eq!(status.chunk_count, Some(0.0));
    assert_eq!(status.progress, Some(0.0));
    assert!(response.body.is_empty());
}

#[test]
fn execute_sends_the_sql_and_the_arrow_accept_header() {
    let mut server = MockServer::default();
    let captured = std::rc::Rc::new(std::cell::RefCell::new(String::new()));
    let sink = captured.clone();
    server.set_handler(move |sql, _| {
        *sink.borrow_mut() = sql.to_string();
        MockResult { completion_status: Some("RESULTS_PRODUCED"), ..Default::default() }
    });
    execute(&mut server, "SELECT 42").unwrap();
    assert_eq!(*captured.borrow(), "SELECT 42");
    let request = &server.requests[0];
    assert_eq!(request.method, HttpMethod::Post);
    assert_eq!(request.url, "https://mock.hyperdb.local/api/v3/query");
    assert_eq!(request.headers.get("Accept"), Some(ARROW));
    assert_eq!(request.headers.get("content-type"), Some("application/json"));
    assert_eq!(request.headers.get("authorization"), Some("Bearer mock-token"));
}

#[test]
fn execute_fails_with_the_error_of_a_4xx_response() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| MockResult {
        error: Some((400, json!({ "error": "42601", "message": "syntax error at position 7" }))),
        ..Default::default()
    });
    let error = http_error(execute(&mut server, "SELCT 1"));
    assert_eq!(error.http_status, 400);
    assert_eq!(error.error_response.as_ref().unwrap().error, "42601");
    assert_eq!(error.message(), "syntax error at position 7");
}

#[test]
fn execute_uses_the_error_code_when_the_message_is_empty() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| MockResult {
        error: Some((400, json!({ "error": "INVALID_ARGUMENT", "message": "" }))),
        ..Default::default()
    });
    assert_eq!(http_error(execute(&mut server, "SELECT 1")).message(), "INVALID_ARGUMENT");
}

#[test]
fn status_of_a_known_and_an_unknown_query() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| running("q-abc"));
    execute(&mut server, "SELECT 1").unwrap();
    let params = GetQueryStatusParams { query_id: "q-abc".to_string(), wait_time_ms: None };
    let status = read_status_response(&server.fetch(&mock_client().get_query_status(&params, &mock_auth()))).unwrap();
    assert_eq!(status.query_id, "q-abc");
    assert_eq!(status.completion_status, CompletionStatus::RunningOrUnspecified);

    let params = GetQueryStatusParams { query_id: "does-not-exist".to_string(), wait_time_ms: Some(250) };
    let request = mock_client().get_query_status(&params, &mock_auth());
    assert_eq!(request.url, "https://mock.hyperdb.local/api/v3/query/does-not-exist?waitTimeMs=250");
    assert_eq!(http_error(read_status_response(&server.fetch(&request))).http_status, 404);
}

#[test]
fn cancel_removes_the_query() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| running("q-del"));
    execute(&mut server, "SELECT sleep(9999)").unwrap();
    let cancel = mock_client().cancel_query("q-del", &mock_auth());
    assert_eq!(cancel.method, HttpMethod::Delete);
    read_cancel_response(&server.fetch(&cancel)).unwrap();
    let params = GetQueryStatusParams { query_id: "q-del".to_string(), wait_time_ms: None };
    assert!(read_status_response(&server.fetch(&mock_client().get_query_status(&params, &mock_auth()))).is_err());
}

#[test]
fn chunks_of_a_known_and_an_unknown_query() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| produced("q-chunk", MOCK_ARROW.to_vec()));
    execute(&mut server, "SELECT val FROM t").unwrap();
    let params = GetQueryChunkParams { query_id: "q-chunk".to_string(), chunk_id: 0, omit_schema: true };
    let request = mock_client().get_query_chunk(&params, None, &mock_auth());
    assert_eq!(request.url, "https://mock.hyperdb.local/api/v3/query/q-chunk/chunk/0?omitSchema=true");
    let response = read_query_response(server.fetch(&request)).unwrap();
    assert_eq!(response.status.unwrap().completion_status, CompletionStatus::ResultsProduced);
    assert_eq!(response.body, MOCK_ARROW);

    let params = GetQueryChunkParams { query_id: "nope".to_string(), chunk_id: 0, omit_schema: false };
    let request = mock_client().get_query_chunk(&params, None, &mock_auth());
    assert_eq!(http_error(read_query_response(server.fetch(&request))).http_status, 404);
}

#[test]
fn the_query_id_is_encoded_in_the_path_and_the_endpoint_path_is_dropped() {
    let client = HyperHttpClient::new("https://hyper.example:443/some/path?x=1").unwrap();
    assert_eq!(client.cancel_query("a b/c", &Headers::new()).url, "https://hyper.example/api/v3/query/a%20b%2Fc");
    assert!(matches!(HyperHttpClient::new(""), Err(HyperError::MissingEndpoint)));
    assert!(matches!(HyperHttpClient::new("not a url"), Err(HyperError::InvalidUrl(_))));
}

#[test]
fn optional_request_headers() {
    let extra = HyperRequestHeaders {
        workload: Some("dashql".to_string()),
        external_client_context: Some("{}".to_string()),
        adaptive_timeout: Some(String::new()),
    };
    let request = mock_client().execute_query(&ExecuteQueryRequest::new("select 1"), Some(&extra), &Headers::new());
    assert_eq!(request.headers.get("x-hyperdb-workload"), Some("dashql"));
    assert_eq!(request.headers.get("x-hyperdb-external-client-context"), Some("{}"));
    assert!(!request.headers.has("x-hyperdb-adaptive-timeout"));
}

/// Read a whole result, answering every request of a poll before the next poll
fn read_result(reader: &mut HyperResultReader, server: &mut MockServer) -> Vec<ResultEvent> {
    let mut events = Vec::new();
    for _ in 0..100 {
        let poll = reader.poll(&mock_auth()).unwrap();
        events.extend(poll.events);
        if poll.done {
            return events;
        }
        assert!(!poll.requests.is_empty(), "a poll that is not done asks for something");
        for request in poll.requests {
            let response = server.fetch(&request.request);
            reader.receive(request.id, response, NOW).unwrap();
        }
    }
    panic!("the result did not end");
}

/// The chunks of a result, the reader passes them on as they arrived
fn chunks(events: &[ResultEvent]) -> Vec<Vec<u8>> {
    events
        .iter()
        .filter_map(|event| match event {
            ResultEvent::Chunk(Body::Bytes(bytes)) => Some(bytes.clone()),
            _ => None,
        })
        .collect()
}

/// The values of a chunk that is a whole stream of one Int32 column
fn chunk_values(chunk: &[u8]) -> Vec<i32> {
    let reader = arrow_ipc::reader::StreamReader::try_new(std::io::Cursor::new(chunk), None).unwrap();
    reader.flat_map(|batch| int_values(&batch.unwrap())).collect()
}

#[test]
fn async_query_lifecycle_execute_poll_chunk() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| running("q-async"));
    let channel =
        HyperHttpChannel::connect(&object(json!({ "endpoint": ENDPOINT })), HyperChannelContext::default(), None)
            .unwrap();
    let response = server.fetch(&channel.execute_query("SELECT x", &mock_auth()));
    let mut reader = channel.open_result(response, NOW).unwrap();
    assert_eq!(reader.status().completion_status, CompletionStatus::RunningOrUnspecified);

    // The query runs without chunks, the reader polls its status
    let poll = reader.poll(&mock_auth()).unwrap();
    assert_eq!(poll.requests.len(), 1);
    assert!(poll.requests[0].request.url.ends_with("/api/v3/query/q-async?waitTimeMs=250"));
    // A status poll carries no part of the result, its body is read
    assert!(!poll.requests[0].chunk);

    server.register(MockQuery {
        query_id: "q-async".to_string(),
        completion_status: "RESULTS_PRODUCED",
        arrow_bytes: int_table("x", &[7]),
        chunk_count: 1,
        row_count: 1,
        execution_stats: (42.0, 1.0),
    });
    let status_request = &poll.requests[0];
    reader.receive(status_request.id, server.fetch(&status_request.request), NOW).unwrap();
    assert_eq!(reader.status().completion_status, CompletionStatus::ResultsProduced);
    assert_eq!(reader.status().chunk_count, Some(1.0));

    // The first chunk asks for the schema
    let poll = reader.poll(&mock_auth()).unwrap();
    assert_eq!(poll.requests.len(), 1);
    let chunk_request = &poll.requests[0];
    assert!(chunk_request.request.url.ends_with("/api/v3/query/q-async/chunk/0"));
    reader.receive(chunk_request.id, server.fetch(&chunk_request.request), NOW).unwrap();
    let events = read_result(&mut reader, &mut server);
    assert_eq!(chunks(&events), [int_table("x", &[7])]);
    assert!(reader.is_done());
}

// ---------------------------------------------------------------------------------------------------------------------
// The web channel, web_hyperdb_http_client.test.ts
// ---------------------------------------------------------------------------------------------------------------------

fn hyper_params() -> JsonObject {
    object(json!({
        "protocol": "V3_HTTP",
        "endpoint": ENDPOINT,
        "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" },
    }))
}

fn connect(context: HyperChannelContext) -> HyperHttpChannel {
    HyperHttpChannel::connect(&hyper_params(), context, None).unwrap()
}

/// Run a query on a channel against the fake server, the error of the query response or the reader
fn run(
    channel: &HyperHttpChannel,
    server: &mut MockServer,
    sql: &str,
) -> Result<(HyperResultReader, Vec<ResultEvent>), HyperError> {
    let response = server.fetch(&channel.execute_query(sql, &channel.context().metadata));
    let mut reader = channel.open_result(response, NOW)?;
    let events = read_result(&mut reader, server);
    Ok((reader, events))
}

#[test]
fn connect_rejects_a_missing_endpoint() {
    let mut params = hyper_params();
    params.insert("endpoint".to_string(), json!(""));
    let error = HyperHttpChannel::connect(&params, HyperChannelContext::default(), None).unwrap_err();
    assert!(error.message().contains("endpoint"));
}

#[test]
fn forwards_the_auth_headers_of_the_context() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| produced("q-auth", int_table("n", &[1])));
    let mut params = hyper_params();
    params.insert("metadata".to_string(), json!({ "Authorization": "Bearer test-token" }));
    let channel = connect(HyperChannelContext::from_params(&params, None));
    run(&channel, &mut server, "select 1 as n").unwrap();
    assert_eq!(server.requests[0].headers.get("Authorization"), Some("Bearer test-token"));
}

#[test]
fn sends_the_client_context_of_the_connection() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| produced("q-context", int_table("n", &[1])));
    let context = json!({ "dashql": { "connectionId": "c1", "queryType": "user" } });
    let channel = connect(HyperChannelContext { client_context: Some(context.clone()), ..Default::default() });
    run(&channel, &mut server, "select 1 as n").unwrap();
    let header = server.requests[0].headers.get("x-hyperdb-external-client-context").unwrap();
    assert_eq!(serde_json::from_str::<Value>(header).unwrap(), context);

    server.requests.clear();
    run(&connect(HyperChannelContext::default()), &mut server, "select 1 as n").unwrap();
    assert!(!server.requests[0].headers.has("x-hyperdb-external-client-context"));
}

#[test]
fn cancels_the_backend_query_of_a_result() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| running("q-cancel"));
    let channel = connect(HyperChannelContext::default());
    let response = server.fetch(&channel.execute_query("select slow()", &Headers::new()));
    let reader = channel.open_result(response, NOW).unwrap();
    let cancel = reader.cancel_request(&Headers::new());
    assert_eq!(cancel.method, HttpMethod::Delete);
    assert_eq!(cancel.url, "https://mock.hyperdb.local/api/v3/query/q-cancel");
}

#[test]
fn forwards_query_parameters_as_settings_and_the_attached_databases() {
    let mut server = MockServer::default();
    let captured = std::rc::Rc::new(std::cell::RefCell::new(Value::Null));
    let sink = captured.clone();
    server.set_handler(move |_, body| {
        *sink.borrow_mut() = body.clone();
        produced("q-settings", int_table("n", &[1]))
    });
    let mut params = hyper_params();
    params.insert("queryParameters".to_string(), json!({ "lc_time": "de_DE", "time_zone": "UTC" }));
    params.insert("attachedDatabases".to_string(), json!([{ "path": "hyper.cloud:tenant-id", "alias": "lakehouse" }]));
    run(&connect(HyperChannelContext::from_params(&params, None)), &mut server, "select 1 as n").unwrap();
    assert_eq!(captured.borrow()["settings"], json!({ "lc_time": "de_DE", "time_zone": "UTC" }));
    assert_eq!(captured.borrow()["databases"], json!([{ "path": "hyper.cloud:tenant-id", "alias": "lakehouse" }]));

    // Without query parameters and databases the request has neither
    run(&connect(HyperChannelContext::default()), &mut server, "select 1 as n").unwrap();
    assert_eq!(*captured.borrow(), json!({ "sql": "select 1 as n" }));
}

fn failing_server(response: HttpResponse) -> impl Fn() -> Result<HyperResultReader, HyperError> {
    move || connect(HyperChannelContext::default()).open_result(response.clone(), NOW)
}

#[test]
fn reports_the_http_status_of_an_error_response_with_an_empty_body() {
    let open = failing_server(HttpResponse::new(502, "{}").with_status_text("Bad Gateway"));
    let error = open().unwrap_err();
    assert_eq!(error.message(), "HTTP 502");
    assert_eq!(error.target(), "hyperdb_http_client");
    let values: HashMap<String, String> = error.key_values().into_iter().collect();
    assert_eq!(values["status"], "502");
    assert_eq!(values["statusText"], "Bad Gateway");
    assert_eq!(values["bodyType"], "object");
    assert_eq!(values["bodyKeys"], "");
    assert_eq!(values["hyperdbStatusPresent"], "false");
    assert_eq!(values["hyperErrorRecognized"], "false");
    assert!(!values.contains_key("contentType"));

    // A body that isn't JSON at all
    let error = failing_server(HttpResponse::new(502, ""))().unwrap_err();
    assert_eq!(error.key_values().into_iter().find(|(key, _)| key == "bodyType").unwrap().1, "unreadable");
}

#[test]
fn reports_the_http_status_of_an_error_that_is_not_hyper_json() {
    let open = failing_server(
        HttpResponse::new(503, json!({ "detail": "proxy unavailable" }).to_string())
            .with_header("content-type", "text/html"),
    );
    let Err(HyperError::Http(error)) = open() else { panic!("expected an HTTP error") };
    assert_eq!(error.message(), "HTTP 503");
    assert_eq!(error.diagnostic("status"), Some("503"));
    assert_eq!(error.diagnostic("contentType"), Some("text/html"));
    assert_eq!(error.diagnostic("bodyKeys"), Some("detail"));
    assert_eq!(error.diagnostic("hyperErrorRecognized"), Some("false"));
}

#[test]
fn surfaces_salesforce_array_errors() {
    let body = json!([{ "message": "Invalid data space", "errorCode": "INVALID_ARGUMENT" }]);
    let open = failing_server(HttpResponse::new(400, body.to_string()).with_header("content-type", "application/json"));
    let Err(HyperError::Query(error)) = open() else { panic!("expected a query error") };
    assert_eq!(error.info.primary_message, "Invalid data space");
    assert_eq!(error.target, "web_hyperdb_http_client");
    // The diagnostics of the response
    let Err(HyperError::Http(response)) = read_query_response(HttpResponse::new(400, body.to_string())) else {
        panic!()
    };
    assert_eq!(response.diagnostic("bodyType"), Some("array"));
    assert_eq!(response.diagnostic("bodyKeys"), Some("message,errorCode"));
    assert_eq!(response.diagnostic("hyperErrorRecognized"), Some("true"));
    assert_eq!(response.diagnostic("hyperErrorOrigin"), Some("body"));
}

#[test]
fn surfaces_an_error_nested_in_the_status_header_when_the_body_is_empty() {
    let status = json!({
        "queryId": "q-err",
        "completionStatus": "RUNNING_OR_UNSPECIFIED",
        "error": {
            "error": "42P01",
            "message": "table \"foo\" does not exist",
            "details": { "customerHint": "check the table name", "errorSource": "User" },
        },
    });
    let response = HttpResponse::new(400, "{}").with_header("x-hyperdb-status", &status.to_string());
    let error = failing_server(response.clone())().unwrap_err();
    assert_eq!(error.message(), "table \"foo\" does not exist");
    assert_eq!(
        error.key_values(),
        vec![
            ("sqlstate".to_string(), "42P01".to_string()),
            ("source".to_string(), "User".to_string()),
            ("hint".to_string(), "check the table name".to_string()),
        ]
    );
    let error = check_response(&response).unwrap_err();
    assert_eq!(error.diagnostic("hyperdbStatusPresent"), Some("true"));
    assert_eq!(error.diagnostic("hyperErrorRecognized"), Some("true"));
    assert_eq!(error.diagnostic("hyperErrorOrigin"), Some("x-hyperdb-status"));
}

#[test]
fn unpacks_an_error_info_from_a_google_rpc_status_in_the_status_header() {
    let status = json!({
        "queryId": "q-err",
        "status": {
            "code": 3,
            "message": "INVALID_ARGUMENT",
            "details": [{
                "@type": "type.googleapis.com/salesforce.hyperdb.grpc.v1.ErrorInfo",
                "primaryMessage": "syntax error at or near \"selec\"",
                "sqlstate": "42601",
                "systemDetail": "parser",
                "position": { "errorBeginCharacterOffset": "0", "errorEndCharacterOffset": "5" },
            }],
        },
    });
    let response = HttpResponse::new(400, "{}").with_header("x-hyperdb-status", &status.to_string());
    let error = failing_server(response)().unwrap_err();
    assert_eq!(error.message(), "syntax error at or near \"selec\"");
    assert_eq!(
        error.key_values(),
        vec![
            ("sqlstate".to_string(), "42601".to_string()),
            ("systemDetail".to_string(), "parser".to_string()),
            ("position".to_string(), "0..5".to_string()),
        ]
    );
}

#[test]
fn keeps_an_unrecognized_status_header_verbatim_in_the_diagnostics() {
    let raw = json!({ "queryId": "q-err", "completionStatus": "FINISHED" }).to_string();
    let error = failing_server(HttpResponse::new(400, "{}").with_header("x-hyperdb-status", &raw))().unwrap_err();
    assert_eq!(error.message(), "HTTP 400");
    let values: HashMap<String, String> = error.key_values().into_iter().collect();
    assert_eq!(values["hyperdbStatus"], raw);
    assert_eq!(values["hyperErrorRecognized"], "false");
    assert_eq!(values["hyperErrorOrigin"], "none");
}

#[test]
fn reads_a_single_chunk_result_from_the_query_response() {
    let mut server = MockServer::default();
    let bytes = int_table("n", &[1, 2, 3]);
    let length = bytes.len() as u64;
    server.set_handler(move |_, _| produced("q-1", bytes.clone()));
    let (reader, events) = run(&connect(HyperChannelContext::default()), &mut server, "select n from t").unwrap();
    // The chunk goes on byte for byte
    let chunks = chunks(&events);
    assert_eq!(chunks, [int_table("n", &[1, 2, 3])]);
    assert_eq!(chunk_values(&chunks[0]), vec![1, 2, 3]);
    assert_eq!(reader.metrics().total_data_bytes_received, length);
    // The query response is the only request
    assert_eq!(server.requests.len(), 1);
}

#[test]
fn reports_the_server_status_as_progress() {
    let mut server = MockServer::default();
    server.set_handler(|_, _| produced("q-progress", int_table("n", &[1])));
    let (_, events) = run(&connect(HyperChannelContext::default()), &mut server, "select 1 as n").unwrap();
    let ResultEvent::Progress(progress) = &events[0] else { panic!("the first event is the progress") };
    assert_eq!(progress.progress_percent, Some(100.0));
    assert_eq!(progress.result_rows, Some(0));
    assert_eq!(progress.rows_processed, Some(0));
    assert_eq!(progress.execution_time_ms, Some(1));
    assert!(matches!(events[1], ResultEvent::Chunk(_)));
}

#[test]
fn fails_when_the_query_response_has_no_status_header() {
    let response = HttpResponse::new(200, Vec::new()).with_header("content-type", ARROW);
    let error = failing_server(response)().unwrap_err();
    assert!(error.message().contains("missing status header"));
}

/// Read a result of chunks, answering the chunk requests of a poll only once a number of them are in flight
fn max_chunks_in_flight(parallel_chunks: usize, chunk_count: u64) -> (usize, Vec<i32>) {
    let status = json!({
        "queryId": "q-parallel",
        "completionStatus": "RESULTS_PRODUCED",
        "chunkCount": chunk_count,
        "rowCount": chunk_count,
        "progress": 100,
        "executionStats": { "wallClockTime": 1, "rowsProcessed": chunk_count },
    })
    .to_string();
    let channel =
        HyperHttpChannel::connect(&hyper_params(), HyperChannelContext::default(), Some(parallel_chunks)).unwrap();
    let query_response = HttpResponse::new(200, Vec::new()).with_header("x-hyperdb-status", &status);
    let mut reader = channel.open_result(query_response, NOW).unwrap();
    let mut max_in_flight = 0;
    let mut values = Vec::new();
    loop {
        let poll = reader.poll(&Headers::new()).unwrap();
        max_in_flight = max_in_flight.max(reader.chunks_in_flight());
        values.extend(chunks(&poll.events).iter().flat_map(|chunk| chunk_values(chunk)));
        if poll.done {
            break;
        }
        for request in poll.requests {
            // Every chunk is a whole stream of one row: schema, batch and end of stream
            let chunk: u64 =
                request.request.url.rsplit('/').next().unwrap().split('?').next().unwrap().parse().unwrap();
            let response =
                HttpResponse::new(200, int_table("n", &[chunk as i32])).with_header("x-hyperdb-status", &status);
            reader.receive(request.id, response, NOW).unwrap();
        }
    }
    (max_in_flight, values)
}

#[test]
fn prefetches_up_to_the_parallel_chunks() {
    assert_eq!(max_chunks_in_flight(4, 8), (4, (0..8).collect()));
    assert_eq!(max_chunks_in_flight(1, 4), (1, (0..4).collect()));
    assert_eq!(max_chunks_in_flight(8, 3), (3, (0..3).collect()));
}

#[test]
fn passes_the_chunks_on_in_order_when_responses_arrive_out_of_order() {
    let status = json!({ "queryId": "q", "completionStatus": "FINISHED", "chunkCount": 3 }).to_string();
    let channel = connect(HyperChannelContext::default());
    let first = int_table("n", &[0]);
    let mut reader =
        channel.open_result(HttpResponse::new(200, first).with_header("x-hyperdb-status", &status), NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    assert_eq!(chunks(&poll.events).len(), 1);
    // The chunks after the first leave out the schema
    assert_eq!(poll.requests.len(), 2);
    assert!(poll.requests.iter().all(|request| request.request.url.ends_with("?omitSchema=true")));
    // The last chunk arrives first and waits for the one before it
    let (second, third) = (&poll.requests[0], &poll.requests[1]);
    reader.receive(third.id, HttpResponse::new(200, int_table("n", &[2])), NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    assert!(chunks(&poll.events).is_empty() && !poll.done);
    reader.receive(second.id, HttpResponse::new(200, int_table("n", &[1])), NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    assert_eq!(chunks(&poll.events).iter().map(|chunk| chunk_values(chunk)[0]).collect::<Vec<_>>(), vec![1, 2]);
    assert!(poll.done);
    assert!(matches!(reader.receive(99, HttpResponse::new(200, Vec::new()), NOW), Err(HyperError::Protocol(_))));
}

#[test]
fn a_failed_chunk_is_a_query_error() {
    let status = json!({ "queryId": "q", "completionStatus": "FINISHED", "chunkCount": 1 }).to_string();
    let channel = connect(HyperChannelContext::default());
    let mut reader =
        channel.open_result(HttpResponse::new(200, Vec::new()).with_header("x-hyperdb-status", &status), NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    let error = json!({ "error": "57014", "message": "canceling statement" }).to_string();
    let result = reader.receive(poll.requests[0].id, HttpResponse::new(400, error), NOW);
    let Err(HyperError::Query(error)) = result else { panic!("expected a query error") };
    assert_eq!(error.info.sqlstate.as_deref(), Some("57014"));
}

#[test]
fn passes_on_a_chunk_that_stayed_with_the_host() {
    let status = json!({ "queryId": "q", "completionStatus": "FINISHED", "chunkCount": 2 }).to_string();
    let channel = connect(HyperChannelContext::default());
    // A body that stayed with the host: the module knows its length only
    let kept = |length: usize| {
        let mut response = HttpResponse::new(200, Vec::new()).with_header("x-hyperdb-status", &status);
        response.host_body = Some(HostBytes::new(Rc::new(length), length));
        response
    };
    let first = kept(16);
    let first_body = first.host_body.clone().unwrap();
    let mut reader = channel.open_result(first, NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    assert!(poll.events.contains(&ResultEvent::Chunk(Body::Host(first_body))));
    assert!(poll.requests.iter().all(|request| request.chunk));
    let second = kept(8);
    let second_body = second.host_body.clone().unwrap();
    reader.receive(poll.requests[0].id, second, NOW).unwrap();
    let poll = reader.poll(&Headers::new()).unwrap();
    assert_eq!(poll.events.last(), Some(&ResultEvent::Chunk(Body::Host(second_body))));
    assert!(poll.done);
    assert_eq!(reader.metrics().total_data_bytes_received, 24);
}

// ---------------------------------------------------------------------------------------------------------------------
// The rich error model, hyper_error_info.test.ts
// ---------------------------------------------------------------------------------------------------------------------

fn varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 0x80 {
        out.push((value as u8) | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn bytes_field(field: u64, bytes: &[u8], out: &mut Vec<u8>) {
    varint(field << 3 | 2, out);
    varint(bytes.len() as u64, out);
    out.extend_from_slice(bytes);
}

#[derive(Default)]
struct ErrorInfoFields {
    primary_message: &'static str,
    sqlstate: &'static str,
    customer_hint: &'static str,
    customer_detail: &'static str,
    system_detail: &'static str,
    error_source: &'static str,
    position: Option<(u64, u64)>,
}

/// A base64 `google.rpc.Status` with a packed ErrorInfo, as the native proxy forwards it
fn encode_status_with_error_info(code: u64, message: &str, info: ErrorInfoFields) -> String {
    let mut error_info = Vec::new();
    for (field, text) in [
        (1, info.primary_message),
        (2, info.sqlstate),
        (3, info.customer_hint),
        (4, info.customer_detail),
        (5, info.system_detail),
        (7, info.error_source),
    ] {
        if !text.is_empty() {
            bytes_field(field, text.as_bytes(), &mut error_info);
        }
    }
    if let Some((begin, end)) = info.position {
        let mut position = Vec::new();
        varint(2 << 3, &mut position);
        varint(begin, &mut position);
        varint(3 << 3, &mut position);
        varint(end, &mut position);
        bytes_field(6, &position, &mut error_info);
    }
    let mut any = Vec::new();
    bytes_field(1, b"type.googleapis.com/salesforce.hyperdb.grpc.v1.ErrorInfo", &mut any);
    bytes_field(2, &error_info, &mut any);
    let mut status = Vec::new();
    varint(1 << 3, &mut status);
    varint(code, &mut status);
    bytes_field(2, message.as_bytes(), &mut status);
    bytes_field(3, &any, &mut status);
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(status)
}

#[test]
fn unpacks_a_packed_error_info_with_all_fields() {
    let encoded = encode_status_with_error_info(
        3,
        "invalid query",
        ErrorInfoFields {
            primary_message: "syntax error at end of input",
            sqlstate: "42601",
            customer_hint: "check your SQL",
            customer_detail: "unexpected EOF",
            system_detail: "parser failed in production stmt",
            error_source: "User",
            position: Some((7, 12)),
        },
    );
    let info = decode_grpc_status_details(&encoded, Some(3)).unwrap();
    assert_eq!(
        info,
        HyperErrorInfo {
            primary_message: "syntax error at end of input".to_string(),
            sqlstate: Some("42601".to_string()),
            customer_hint: Some("check your SQL".to_string()),
            customer_detail: Some("unexpected EOF".to_string()),
            system_detail: Some("parser failed in production stmt".to_string()),
            position: Some(HyperTextPosition { begin_character_offset: 7, end_character_offset: 12 }),
            error_source: HyperErrorSource::User,
            grpc_status_code: Some(3),
        }
    );
}

#[test]
fn normalizes_an_unknown_error_source_and_leaves_empty_fields_out() {
    let encoded = encode_status_with_error_info(
        13,
        "boom",
        ErrorInfoFields { primary_message: "boom", error_source: "somethingelse", ..Default::default() },
    );
    let info = decode_grpc_status_details(&encoded, None).unwrap();
    assert_eq!(info.error_source, HyperErrorSource::Unknown);
    assert_eq!((info.sqlstate, info.customer_hint, info.position), (None, None, None));
    // Without padding, as gRPC sends binary headers
    let unpadded = encoded.trim_end_matches('=');
    assert_eq!(decode_grpc_status_details(unpadded, None).unwrap().primary_message, "boom");
}

#[test]
fn rejects_invalid_base64_and_protobuf() {
    assert_eq!(decode_grpc_status_details("not-valid-base64!!!", None), None);
    use base64::Engine;
    let truncated = base64::engine::general_purpose::STANDARD.encode([0x12, 0x10, b'a']);
    assert_eq!(decode_grpc_status_details(&truncated, None), None);
}

#[test]
fn falls_back_to_the_message_of_a_status_without_error_info() {
    let mut status = Vec::new();
    varint(1 << 3, &mut status);
    varint(14, &mut status);
    bytes_field(2, b"unavailable", &mut status);
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(status);
    let info = decode_grpc_status_details(&encoded, None).unwrap();
    assert_eq!((info.primary_message.as_str(), info.grpc_status_code), ("unavailable", Some(14)));
}

#[test]
fn decodes_the_error_headers_of_the_proxy() {
    let encoded = encode_status_with_error_info(
        3,
        "m",
        ErrorInfoFields { primary_message: "primary", sqlstate: "42601", ..Default::default() },
    );
    let headers = Headers::from_pairs([(HEADER_GRPC_STATUS, "3"), (HEADER_GRPC_STATUS_DETAILS, encoded.as_str())]);
    let info = decode_grpc_error_headers(Some(&headers)).unwrap();
    assert_eq!((info.primary_message.as_str(), info.grpc_status_code), ("primary", Some(3)));

    // The terse grpc-message without details
    let headers = Headers::from_pairs([(HEADER_GRPC_STATUS, "14"), (HEADER_GRPC_MESSAGE, "unavailable")]);
    let info = decode_grpc_error_headers(Some(&headers)).unwrap();
    assert_eq!(info.primary_message, "unavailable");
    assert_eq!(info.error_source, HyperErrorSource::Unknown);
    assert_eq!(info.grpc_status_code, Some(14));

    // The percent-encoding of the proxy
    let headers = Headers::from_pairs([
        (HEADER_GRPC_STATUS, "3"),
        (HEADER_GRPC_MESSAGE, "syntax error at line 1%0Anear \"caf%C3%A9\" 100%25"),
    ]);
    assert_eq!(
        decode_grpc_error_headers(Some(&headers)).unwrap().primary_message,
        "syntax error at line 1\nnear \"café\" 100%"
    );
    // A message that is not percent-encoded
    let headers = Headers::from_pairs([(HEADER_GRPC_STATUS, "3"), (HEADER_GRPC_MESSAGE, "100% broken")]);
    assert_eq!(decode_grpc_error_headers(Some(&headers)).unwrap().primary_message, "100% broken");

    assert_eq!(decode_grpc_error_headers(Some(&Headers::new())), None);
    assert_eq!(decode_grpc_error_headers(None), None);
}

#[test]
fn maps_the_json_error_body() {
    let response = read_error_response(
        &json!({
            "error": "INVALID_ARGUMENT",
            "message": "syntax error",
            "details": {
                "customerHint": "fix it",
                "customerDetail": "near 'slect'",
                "errorSource": "User",
                "position": { "errorBeginCharacterOffset": "0", "errorEndCharacterOffset": "5" },
            },
        }),
        400,
    )
    .unwrap();
    let info = from_http_error_response(&response);
    assert_eq!(info.primary_message, "syntax error");
    assert_eq!(info.sqlstate, None);
    assert_eq!(info.customer_hint.as_deref(), Some("fix it"));
    assert_eq!(info.customer_detail.as_deref(), Some("near 'slect'"));
    assert_eq!(info.error_source, HyperErrorSource::User);
    assert_eq!(info.position, Some(HyperTextPosition { begin_character_offset: 0, end_character_offset: 5 }));

    let info = from_http_error_response(&QueryErrorResponse {
        error: "INTERNAL".to_string(),
        message: String::new(),
        details: None,
    });
    assert_eq!(info.primary_message, "INTERNAL");
    assert_eq!(info.error_source, HyperErrorSource::Unknown);
}

#[test]
fn reads_error_info_in_snake_case_and_stops_at_the_search_depth() {
    let snake = json!({ "primary_message": "boom", "sqlstate": "XX000", "error_source": "System" });
    let response = read_error_response(&snake, 500).unwrap();
    assert_eq!((response.error.as_str(), response.message.as_str()), ("XX000", "boom"));
    let deep = json!({ "a": { "b": { "c": { "d": { "message": "too deep" } } } } });
    assert_eq!(read_error_response(&deep, 500), None);
    let shallow = json!({ "a": { "b": { "c": { "message": "deep enough" } } } });
    assert_eq!(read_error_response(&shallow, 500).unwrap().message, "deep enough");
}

#[test]
fn key_values_include_only_populated_fields() {
    let info = HyperErrorInfo {
        sqlstate: Some("42601".to_string()),
        error_source: HyperErrorSource::User,
        position: Some(HyperTextPosition { begin_character_offset: 1, end_character_offset: 2 }),
        ..HyperErrorInfo::from_message("m")
    };
    assert_eq!(
        info.key_values(),
        vec![
            ("sqlstate".to_string(), "42601".to_string()),
            ("source".to_string(), "User".to_string()),
            ("position".to_string(), "1..2".to_string()),
        ]
    );
    assert!(HyperErrorInfo::from_message("m").key_values().is_empty());
}

// ---------------------------------------------------------------------------------------------------------------------
// Hyper links, hyper_link.test.ts
// ---------------------------------------------------------------------------------------------------------------------

fn target(endpoint: &str, token: &str) -> HyperLinkTarget {
    HyperLinkTarget { endpoint: endpoint.to_string(), token: token.to_string() }
}

#[test]
fn accepts_loopback_endpoints_and_https_endpoints_with_a_token() {
    assert_eq!(
        parse_hyper_link_target(Some("http://127.0.0.1:7484"), Some("secret")),
        Some(target("http://127.0.0.1:7484", "secret"))
    );
    assert_eq!(
        parse_hyper_link_target(Some("http://localhost:7484/"), Some("secret")).unwrap().endpoint,
        "http://localhost:7484"
    );
    assert_eq!(
        parse_hyper_link_target(Some("https://[::1]:7484"), Some("secret")).unwrap().endpoint,
        "https://[::1]:7484"
    );
    assert_eq!(
        parse_hyper_link_target(Some("https://hyper.example/api"), Some("secret")).unwrap().endpoint,
        "https://hyper.example"
    );
}

#[test]
fn refuses_http_to_other_machines_other_schemes_and_missing_tokens() {
    for (endpoint, token) in [
        (Some("http://hyper.example"), Some("secret")),
        (Some("http://127.0.0.1.example:7484"), Some("secret")),
        (Some("file:///tmp/hyperd"), Some("secret")),
        (Some("not a url"), Some("secret")),
        (Some("http://127.0.0.1:7484"), Some("")),
        (None, Some("secret")),
        (Some("http://127.0.0.1:7484"), None),
    ] {
        assert_eq!(parse_hyper_link_target(endpoint, token), None, "{endpoint:?}");
    }
}

#[test]
fn confirms_links_to_other_machines_only() {
    assert_eq!(hyper_link_confirmation(&target("http://127.0.0.1:7484", "secret")), None);
    assert!(hyper_link_confirmation(&target("https://hyper.example", "secret"))
        .unwrap()
        .contains("https://hyper.example"));
}

#[test]
fn stores_the_endpoint_but_not_the_token_the_channel_adds_the_token() {
    let tls = json!({ "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" });
    let params = create_hyper_link_connection_params("http://127.0.0.1:7484");
    assert_eq!(params.connector, ConnectorType::Hyper);
    assert_eq!(
        Value::Object(params.params.clone()),
        json!({ "protocol": "V3_HTTP_LINK", "endpoint": "http://127.0.0.1:7484", "tls": tls })
    );
    assert!(is_hyper_link_params(&params));

    let hyper = object(
        json!({ "protocol": "V3_HTTP_LINK", "endpoint": "http://127.0.0.1:7484", "tls": tls, "metadata": { "x-custom": "1" } }),
    );
    assert_eq!(
        Value::Object(hyper_link_channel_params(&hyper, "secret")),
        json!({
            "protocol": "V3_HTTP",
            "endpoint": "http://127.0.0.1:7484",
            "tls": tls,
            "metadata": { "x-hyperdb-workload": "dashql", "x-custom": "1", "authorization": "Bearer secret" },
        })
    );
}

#[test]
fn reads_the_links_of_the_tab_also_from_broken_storage() {
    let stored = json!({ "tokens": { "a": "secret", "b": 1 }, "current": "a" }).to_string();
    let state = HyperLinkTabState::read(Some(&stored));
    assert_eq!(state.tokens.into_iter().collect::<Vec<_>>(), vec![("a".to_string(), "secret".to_string())]);
    assert_eq!(state.current.as_deref(), Some("a"));
    assert_eq!(HyperLinkTabState::read(Some("not json")), HyperLinkTabState::default());
    assert_eq!(HyperLinkTabState::read(Some("null")), HyperLinkTabState::default());
    assert_eq!(HyperLinkTabState::read(None), HyperLinkTabState::default());
}

#[test]
fn keeps_the_token_of_a_link_and_reads_it_back() {
    let state = HyperLinkTabState::default().with_token("a", "secret");
    assert_eq!(state.current.as_deref(), Some("a"));
    // A reload reads the links again
    assert_eq!(HyperLinkTabState::read(Some(&state.to_json())), state);
    let next = state.with_token("b", "other");
    assert_eq!(next.tokens.len(), 2);
    assert_eq!(next.current.as_deref(), Some("b"));
}

fn linked(connection_id: &str, endpoint: &str) -> ConnectionState {
    ConnectionState::from_params(connection_id, create_hyper_link_connection_params(endpoint), 0.0)
}

#[test]
fn reuses_the_connection_to_the_endpoint_of_the_link_without_asking() {
    let link = target("http://127.0.0.1:2222", "second");
    let embedded = ConnectionState::from_params("embedded", ConnectionParams::default_for(ConnectorType::Hyper), 0.0);
    let connections = [embedded, linked("other", "http://127.0.0.1:1111"), linked("same", &link.endpoint)];
    assert_eq!(
        bind_hyper_link(&link, &connections, Some("other")),
        HyperLinkBinding::Existing { connection_id: "same".to_string() }
    );
}

#[test]
fn moves_the_connection_of_the_latest_link_if_the_user_reuses_it() {
    let link = target("http://127.0.0.1:2222", "second");
    let connections = [linked("first", "http://127.0.0.1:1111"), linked("latest", "http://127.0.0.1:3333")];
    let binding = bind_hyper_link(&link, &connections, Some("latest"));
    let HyperLinkBinding::AskToReuse { connection_id, params, .. } = binding.clone() else {
        panic!("expected a question")
    };
    assert_eq!(connection_id, "latest");
    assert_eq!(params, create_hyper_link_connection_params(&link.endpoint));
    assert_eq!(
        binding.answer(true).clone(),
        HyperLinkBinding::AskToReuse {
            connection_id,
            params,
            create: create_hyper_link_connection_params(&link.endpoint)
        }
    );
    // Without a recent connection, the latest one
    let HyperLinkBinding::AskToReuse { connection_id, .. } = bind_hyper_link(&link, &connections, Some("unknown"))
    else {
        panic!()
    };
    assert_eq!(connection_id, "latest");
}

#[test]
fn creates_another_connection_if_the_user_declines_or_if_there_is_none() {
    let link = target("http://127.0.0.1:2222", "second");
    let declined = bind_hyper_link(&link, &[linked("first", "http://127.0.0.1:1111")], None).answer(false);
    let HyperLinkBinding::Create { params } = declined else { panic!("expected a new connection") };
    assert!(is_hyper_link_params(&params));
    assert!(!params.to_json().contains(&link.token));
    let embedded = ConnectionState::from_params("embedded", ConnectionParams::default_for(ConnectorType::Hyper), 0.0);
    assert!(matches!(bind_hyper_link(&link, [&embedded], None), HyperLinkBinding::Create { .. }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The local cloud, the embedded Hyper and the descriptor
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_cloud_databases_of_the_embedded_hyper() {
    let local = json!({ "path": LOCAL_CLOUD_DATABASE_PATH, "alias": LOCAL_CLOUD_DATABASE_ALIAS });
    let params = object(
        json!({ "attachedDatabases": [local, { "path": "other.hyper", "alias": "x" }, { "path": "clouds/a.hyper" }] }),
    );
    assert_eq!(
        embedded_cloud_databases(Some(&params)),
        vec![CloudDatabase { path: "clouds/local.hyper".to_string(), alias: "dashql".to_string() }]
    );
    let server = object(json!({ "protocol": "V3_HTTP", "attachedDatabases": [local] }));
    assert!(embedded_cloud_databases(Some(&server)).is_empty());
    assert!(embedded_cloud_databases(None).is_empty());

    let options = embedded_session_options(Some(&params)).unwrap();
    assert_eq!(options.default_database, None);
    assert_eq!(
        options.attached_databases,
        vec![EmbeddedAttachedDatabase { path: "clouds/local.hyper".to_string(), alias: "dashql".to_string() }]
    );
    let options = embedded_session_options(None).unwrap();
    assert_eq!(options.default_database.as_deref(), Some("hyper"));
    let outside = object(json!({ "attachedDatabases": [{ "path": "clouds/../secret.hyper", "alias": "x" }] }));
    assert!(embedded_session_options(Some(&outside)).is_err());
}

#[test]
fn queries_of_the_embedded_hyper_run_one_at_a_time() {
    let mut queue = EmbeddedQueryQueue::new();
    let (first, runs) = queue.enqueue();
    assert!(runs);
    let (second, runs) = queue.enqueue();
    assert!(!runs);
    // The second query waits until the result of the first one is read, cancelled or failed
    assert_eq!(queue.finish(first), Some(second));
    assert_eq!(queue.running(), Some(second));
    assert_eq!(queue.finish(second), None);
    assert!(queue.enqueue().1);
}

#[test]
fn a_waiting_query_that_is_cancelled_leaves_the_queue() {
    let mut queue = EmbeddedQueryQueue::new();
    let (first, _) = queue.enqueue();
    let (second, _) = queue.enqueue();
    let (third, _) = queue.enqueue();
    // The cancellation does not wait for the running query
    assert_eq!(queue.finish(second), None);
    assert_eq!(queue.running(), Some(first));
    assert_eq!(queue.waiting().collect::<Vec<_>>(), vec![third]);
    assert_eq!(queue.finish(first), Some(third));
}

#[test]
fn the_metrics_of_a_result_of_the_embedded_hyper() {
    let mut metrics = EmbeddedStreamMetrics::new(100.0);
    assert_eq!(metrics.metrics().total_query_requests_started, 1);
    let yields: Vec<bool> = (0..8).map(|i| metrics.record_batch(10, 3, 110.0 + f64::from(i))).collect();
    assert_eq!(yields.iter().filter(|y| **y).count(), 1);
    metrics.succeed(150.0);
    let metrics = metrics.metrics();
    assert_eq!(metrics.duration_until_first_batch_ms, Some(10));
    assert_eq!(
        (metrics.total_batches_received, metrics.total_rows_received, metrics.total_data_bytes_received),
        (8, 24, 80)
    );
    assert_eq!((metrics.total_query_requests_succeeded, metrics.total_query_request_duration_ms), (1, 50));
}

#[test]
fn the_descriptor_of_the_hyper_connector() {
    let params = object(json!({
        "protocol": "V3_HTTP",
        "endpoint": "https://hyper.example",
        "tls": { "clientKeyPath": "/key", "clientCertPath": "", "caCertsPath": "" },
        "metadata": { "authorization": "Bearer x" },
        "queryParameters": { "time_zone": "UTC", "lc_time": "de_DE" },
        "attachedDatabases": [{ "path": "b", "alias": "y" }, { "path": "a", "alias": "x" }],
    }));
    let shared = sanitize_connection_params_for_sharing(&json!({ "hyper": params }), true);
    let shared = shared["hyper"].as_object().unwrap();
    assert!(!shared.contains_key("metadata") && !shared.contains_key("queryParameters"));
    assert_eq!(shared["tls"], json!({ "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" }));
    assert_eq!(
        cache_signature(&params).to_string(),
        r#"{"case":"hyper","protocol":"V3_HTTP","channelArgs":{"endpoint":"https://hyper.example","tls":{"clientKeyPath":"/key","clientCertPath":"","caCertsPath":""}},"attachedDatabases":[{"path":"a","alias":"x"},{"path":"b","alias":"y"}],"queryParameters":[["lc_time","de_DE"],["time_zone","UTC"]]}"#
    );
    assert!(reads_attachments(&ConnectionDetails::default_for(ConnectorType::Hyper)));
    assert!(!reads_attachments(&ConnectionDetails::new(&ConnectionParams::new(ConnectorType::Hyper, params))));
    assert!(!reads_attachments(&ConnectionDetails::default_for(ConnectorType::Trino)));
}

#[test]
fn the_channel_kind_of_a_protocol() {
    assert_eq!(HyperProtocol::of_params(None), Some(HyperProtocol::Wasm));
    assert_eq!(HyperProtocol::of_params(Some(&object(json!({ "protocol": "V3_GRPC" })))), Some(HyperProtocol::V3Grpc));
    assert!(HyperProtocol::V3HttpLink.is_http() && !HyperProtocol::V3Grpc.is_http());
    assert_eq!(HyperProtocol::of_params(Some(&object(json!({ "protocol": "SMOKE" })))), None);
}

// ---------------------------------------------------------------------------------------------------------------------
// The connection helpers
// ---------------------------------------------------------------------------------------------------------------------

#[test]
fn the_health_check_of_a_connection() {
    assert_eq!(ConnectorType::Trino.connector().health_probe(), "select 1");
    assert_eq!(ConnectorType::Hyper.connector().health_probe(), "select 1 as healthy");
    assert_eq!(health_check_metadata().title.as_deref(), Some("Health Check"));
    assert_eq!(
        health_check_outcome(HealthCheckResult::Finished { has_table: true }, false),
        ConnectionAction::HealthCheckSucceeded
    );
    assert_eq!(
        health_check_outcome(HealthCheckResult::Finished { has_table: false }, false),
        ConnectionAction::HealthCheckFailed(DetailedError::new("health check failed"))
    );
    assert_eq!(
        health_check_outcome(HealthCheckResult::Finished { has_table: true }, true),
        ConnectionAction::HealthCheckCancelled
    );
    // A failed probe keeps the details of the error, e.g. the status of a rejected login
    let error = failing_server(HttpResponse::new(401, "{}"))().unwrap_err().to_detailed_error();
    assert_eq!(error.message, "HTTP 401");
    assert_eq!(error.data.get("status").map(String::as_str), Some("401"));
    let ConnectionAction::HealthCheckFailed(failed) =
        health_check_outcome(HealthCheckResult::Failed(error.clone()), false)
    else {
        panic!()
    };
    assert_eq!(failed, error);
}

#[test]
fn decodes_the_connections_of_a_workbook_file() {
    for (key, connector, params) in [
        (
            "salesforce",
            ConnectorType::SalesforceDataCloud,
            json!({ "instanceUrl": "https://example.my.salesforce.com" }),
        ),
        ("dbcom", ConnectorType::Dbcom, json!({ "databases": ["main"] })),
        ("hyper", ConnectorType::Hyper, json!({ "endpoint": "http://127.0.0.1:7484" })),
        ("trino", ConnectorType::Trino, json!({ "endpoint": "http://127.0.0.1:8080", "catalog": "tpch" })),
    ] {
        // Flat params become the setup params
        let (decoded, details) = decode_connection(&json!({ key: params }), "workbook").unwrap();
        assert_eq!(decoded, connector);
        assert_eq!(details, ConnectionDetails::new(&ConnectionParams::new(connector, object(params.clone()))));
        // Details carry their setup params
        let proto = json!({ "setupTimings": { "startedAt": 1 }, "setupParams": params });
        let (_, details) = decode_connection(&json!({ key: proto }), "workbook").unwrap();
        assert_eq!(details.setup_params, Some(object(params.clone())));
        // Empty params
        let (_, details) = decode_connection(&json!({ key: null }), "workbook").unwrap();
        assert_eq!(details.setup_params, Some(JsonObject::new()));
    }
    let error = decode_connection(&json!({ "demo": {} }), "workbook").unwrap_err();
    assert!(error.what().contains("unsupported connection details"));
    assert!(decode_connection(&json!({}), "workbook").is_err());

    let (_, details) = decode_connection(&json!({ "hyper": { "protocol": "V3_HTTP" } }), "workbook").unwrap();
    let restored = ConnectionState::new("c1", details, ConnectionStateOptions { active: true, ..Default::default() }, 0.0);
    assert!(restored.active());
    assert_eq!(restored.params().params, object(json!({ "protocol": "V3_HTTP" })));
}

#[test]
fn labels_of_connection_params() {
    for (params, expected) in [
        (json!({ "hyper": {} }), "Hyper Wasm"),
        (json!({ "hyper": { "protocol": "WASM", "endpoint": "ignored" } }), "Hyper Wasm"),
        (
            json!({ "hyper": { "protocol": "V3_HTTP", "endpoint": "http://localhost:7484" } }),
            "Hyper / http://localhost:7484",
        ),
        (json!({ "hyper": { "protocol": "V3_GRPC" } }), "Hyper / "),
        (json!({ "trino": { "endpoint": "https://trino.example" } }), "Trino / https://trino.example"),
        (json!({ "trino": {} }), "Trino / "),
        (
            json!({ "salesforce": { "instanceUrl": "https://sf.example" } }),
            "Salesforce Data Cloud / https://sf.example",
        ),
        (json!({ "salesforce": {} }), "Salesforce Data Cloud / "),
        (json!({ "dbcom": { "instanceUrl": "https://dbcom.example" } }), "Database.com / https://dbcom.example"),
        (json!({ "dbcom": {} }), "Database.com / "),
        (json!({}), "Connection"),
    ] {
        assert_eq!(connection_params_label_of_json(&params.to_string()), expected);
    }
}

#[test]
fn labels_of_connections() {
    let mut hyper = ConnectionState::from_params("h", ConnectionParams::default_for(ConnectorType::Hyper), 0.0);
    assert_eq!(connection_label(&hyper, None), "Hyper Wasm");
    assert_eq!(connection_label(&hyper, Some(2)), "Hyper #2 Wasm");
    assert!(is_hyper_wasm_connection(&hyper) && supports_connection_overview(&hyper));
    hyper.apply(ConnectionAction::Rename("Mine".to_string()), 0.0).unwrap();
    assert_eq!(
        connection_label_parts(&hyper, Some(2)),
        ConnectionLabelParts { name: "Mine".to_string(), connector: "Hyper".to_string(), detail: "Wasm".to_string() }
    );

    let link = linked("l", "http://127.0.0.1:1");
    assert_eq!(connection_label(&link, None), "Hyper Link");
    assert!(!is_hyper_wasm_connection(&link));
    let cloud = ConnectionParams::new(
        ConnectorType::Hyper,
        object(
            json!({ "protocol": "WASM", "attachedDatabases": [{ "path": "clouds/local.hyper", "alias": "dashql" }] }),
        ),
    );
    assert!(!is_hyper_wasm_connection(&ConnectionState::from_params("cloud", cloud, 0.0)));
    let trino = ConnectionState::from_params("t", ConnectionParams::default_for(ConnectorType::Trino), 0.0);
    assert_eq!(connection_label(&trino, None), "Trino Http");
    assert!(!supports_connection_overview(&trino));
}

#[test]
fn the_catalog_refreshes_only_online_without_a_running_refresh() {
    let mut connection = ConnectionState::from_params("h", ConnectionParams::default_for(ConnectorType::Hyper), 0.0);
    assert!(!connection.can_refresh_catalog());
    let ready = HyperAction::ChannelReady { channel: ConnectionChannel::Host(1), params: object(json!({ "protocol": "WASM" })) };
    connection.apply(ConnectionAction::Hyper(ready), 0.0).unwrap();
    assert!(connection.can_refresh_catalog());
    let refresh = CatalogUpdateTask::new(7, CatalogUpdateVariant::FullCatalogRefresh, 0.0);
    connection.apply(ConnectionAction::UpdateCatalog(refresh), 0.0).unwrap();
    assert!(!connection.can_refresh_catalog());
    connection.apply(ConnectionAction::CatalogUpdateSucceeded { task_id: 7 }, 0.0).unwrap();
    assert!(connection.can_refresh_catalog());
    connection.apply(ConnectionAction::HealthCheckFailed(DetailedError::new("down")), 0.0).unwrap();
    assert!(!connection.can_refresh_catalog());
}
