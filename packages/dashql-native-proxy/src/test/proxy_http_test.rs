//! The HTTP proxy through the routes the app calls, against a server that the tests answer by hand.

use std::net::SocketAddr;
use std::time::Duration;

use http::{Request, Response};

use crate::route_proxy_request;
use crate::test::http_server_mock::spawn_http_server;

const GUARD: Duration = Duration::from_secs(10);

fn request(method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Request<Vec<u8>> {
    let mut builder = Request::builder().method(method).uri(format!("dashql-native://localhost{path}"));
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    builder.body(body.to_vec()).unwrap()
}

fn header<'a>(response: &'a Response<Vec<u8>>, name: &str) -> Option<&'a str> {
    response.headers().get(name).map(|value| value.to_str().unwrap())
}

fn error_message(response: &Response<Vec<u8>>) -> String {
    assert_eq!(header(response, "dashql-error"), Some("true"), "{response:?}");
    let body: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    body["message"].as_str().unwrap().to_string()
}

async fn start_stream(address: SocketAddr, method: &str, path: &str, search: &str, extra: &[(&str, &str)], body: &[u8]) -> Response<Vec<u8>> {
    let endpoint = format!("http://{address}");
    let mut headers = vec![
        ("dashql-method", method),
        ("dashql-endpoint", endpoint.as_str()),
        ("dashql-path", path),
        ("dashql-search-params", search),
        ("dashql-read-timeout", "60000"),
    ];
    headers.extend_from_slice(extra);
    route_proxy_request(request("POST", "/http/streams", &headers, body)).await
}

fn stream_id(response: &Response<Vec<u8>>) -> String {
    assert_eq!(response.status(), 200, "{response:?}");
    header(response, "dashql-stream-id").unwrap().to_string()
}

async fn read_stream(id: &str, read_ms: &str, batch_ms: &str, bytes: &str) -> Response<Vec<u8>> {
    let headers = [("dashql-read-timeout", read_ms), ("dashql-batch-timeout", batch_ms), ("dashql-batch-bytes", bytes)];
    route_proxy_request(request("GET", &format!("/http/stream/{id}"), &headers, &[])).await
}

#[tokio::test]
async fn answers_the_health_check() {
    let response = route_proxy_request(request("GET", "/health", &[], &[])).await;
    assert_eq!(response.status(), 200);
    assert_eq!(response.body(), br#"{"status":"ok"}"#);
}

#[tokio::test]
async fn rejects_unknown_routes_and_methods() {
    assert_eq!(route_proxy_request(request("GET", "/unknown", &[], &[])).await.status(), 400);
    assert_eq!(route_proxy_request(request("POST", "/health", &[], &[])).await.status(), 400);
    assert_eq!(route_proxy_request(request("GET", "/http/streams", &[], &[])).await.status(), 404);
    assert_eq!(route_proxy_request(request("POST", "/http/stream/1", &[], &[])).await.status(), 404);
}

#[tokio::test]
async fn requires_every_parameter_of_a_request() {
    let all = [
        ("dashql-method", "GET"),
        ("dashql-endpoint", "http://127.0.0.1:1"),
        ("dashql-path", "/"),
        ("dashql-search-params", ""),
        ("dashql-read-timeout", "10"),
    ];
    for missing in 0..all.len() {
        let headers: Vec<(&str, &str)> = all.iter().enumerate().filter(|(i, _)| *i != missing).map(|(_, h)| *h).collect();
        let response = route_proxy_request(request("POST", "/http/streams", &headers, &[])).await;
        assert_eq!(response.status(), 400);
        assert_eq!(error_message(&response), "header is missing", "without {:?}", all[missing].0);
    }
}

#[tokio::test]
async fn rejects_invalid_parameters() {
    let headers = |method: &'static str, endpoint: &'static str, timeout: &'static str| [
        ("dashql-method", method),
        ("dashql-endpoint", endpoint),
        ("dashql-path", "/"),
        ("dashql-search-params", ""),
        ("dashql-read-timeout", timeout),
    ];
    let cases = [
        (headers("GET", "not a url", "10"), "header stores invalid endpoint"),
        (headers("BAD METHOD", "http://127.0.0.1:1", "10"), "header stores invalid method"),
        (headers("GET", "http://127.0.0.1:1", "soon"), "header is not an unsigned integer"),
    ];
    for (headers, message) in cases {
        let response = route_proxy_request(request("POST", "/http/streams", &headers, &[])).await;
        assert_eq!(error_message(&response), message);
    }
}

#[tokio::test]
async fn sends_the_request_to_the_remote() {
    let (address, mut requests) = spawn_http_server().await;
    let start = start_stream(address, "POST", "/v1/query", "a=1&b=2", &[
        ("authorization", "Bearer token"),
        ("origin", "http://localhost:9002"),
        ("dashql-trace-id", "internal"),
    ], b"the body").await;
    stream_id(&start);

    let (received, _connection) = tokio::time::timeout(GUARD, requests.recv()).await.unwrap().unwrap();
    assert_eq!(received.line, "POST /v1/query?a=1&b=2 HTTP/1.1");
    assert_eq!(received.body, b"the body");
    assert_eq!(received.header("authorization"), Some("Bearer token"));
    // The fetch of the webview sets the origin, and our headers stop at the proxy
    assert_eq!(received.header("origin"), None);
    assert!(received.headers.iter().all(|(key, _)| !key.starts_with("dashql-")), "{:?}", received.headers);
}

#[tokio::test]
async fn omits_an_empty_query() {
    let (address, mut requests) = spawn_http_server().await;
    stream_id(&start_stream(address, "GET", "/v1/info", "", &[], &[]).await);
    let (received, _connection) = tokio::time::timeout(GUARD, requests.recv()).await.unwrap().unwrap();
    assert_eq!(received.line, "GET /v1/info HTTP/1.1");
}

#[tokio::test]
async fn streams_the_status_the_headers_and_the_body() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("201 Created", &[("x-hyperdb-status", "ok")]).await;
    connection.write_chunk("hello ").await;
    connection.write_chunk("world").await;
    connection.finish().await;

    let response = read_stream(&id, "5000", "5000", "1000000").await;
    assert_eq!(response.status(), 201);
    assert_eq!(header(&response, "dashql-response-started"), Some("true"));
    assert_eq!(header(&response, "dashql-batch-event"), Some("StreamFinished"));
    assert_eq!(header(&response, "dashql-batch-bytes"), Some("11"));
    assert_eq!(header(&response, "x-hyperdb-status"), Some("ok"));
    assert_eq!(response.body(), b"hello world");

    // A finished stream is gone
    assert_eq!(read_stream(&id, "10", "10", "10").await.status(), 404);
}

#[tokio::test]
async fn passes_an_error_of_the_remote_through_as_a_response() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("503 Service Unavailable", &[]).await;
    connection.write_chunk("overloaded").await;
    connection.finish().await;

    let response = read_stream(&id, "5000", "5000", "1000000").await;
    assert_eq!(response.status(), 503);
    assert_eq!(header(&response, "dashql-error"), None);
    assert_eq!(response.body(), b"overloaded");
}

#[tokio::test]
async fn flushes_a_batch_after_the_size_limit() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[]).await;
    connection.write_chunk("0123456789").await;

    let response = read_stream(&id, "5000", "5000", "5").await;
    assert_eq!(header(&response, "dashql-batch-event"), Some("FlushAfterBytes"));
    assert_eq!(response.body(), b"0123456789");
    assert_eq!(header(&response, "dashql-response-started"), Some("true"));

    // Later batches continue the body without another status
    connection.write_chunk("abc").await;
    connection.finish().await;
    let response = read_stream(&id, "5000", "5000", "1000").await;
    assert_eq!(header(&response, "dashql-batch-event"), Some("StreamFinished"));
    assert_eq!(header(&response, "dashql-response-started"), None);
    assert_eq!(response.body(), b"abc");
}

#[tokio::test]
async fn flushes_a_batch_after_the_batch_timeout() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[]).await;
    connection.write_chunk("partial").await;

    let response = read_stream(&id, "5000", "100", "1000000").await;
    assert_eq!(header(&response, "dashql-batch-event"), Some("FlushAfterTimeout"));
    assert_eq!(response.body(), b"partial");
}

#[tokio::test]
async fn reports_a_read_timeout_before_the_remote_answers() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, _connection) = requests.recv().await.unwrap();
    let response = read_stream(&id, "50", "50", "1000").await;
    assert_eq!(error_message(&response), "reading from http stream timed out");
}

#[tokio::test]
async fn keeps_the_status_when_the_body_is_slower_than_the_read_timeout() {
    // The remote answers, then computes for a while. The status and the headers must not get lost.
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("503 Service Unavailable", &[("x-hyperdb-status", "busy")]).await;

    let first = read_stream(&id, "200", "50", "1000").await;
    assert_eq!(header(&first, "dashql-error"), None, "{first:?}");
    assert_eq!(first.status(), 503);
    assert_eq!(header(&first, "dashql-response-started"), Some("true"));
    assert_eq!(header(&first, "x-hyperdb-status"), Some("busy"));
    assert_eq!(header(&first, "dashql-batch-event"), Some("FlushAfterTimeout"));

    connection.write_chunk("late").await;
    connection.finish().await;
    let rest = read_stream(&id, "5000", "5000", "1000").await;
    assert_eq!(rest.body(), b"late");
    assert_eq!(header(&rest, "dashql-batch-event"), Some("StreamFinished"));
}

#[tokio::test]
async fn the_remote_cannot_replace_the_headers_of_the_proxy() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[
        ("dashql-batch-event", "StreamFinished"),
        ("dashql-stream-id", "999"),
        ("dashql-error", "true"),
    ]).await;
    connection.write_chunk("0123456789").await;

    let response = read_stream(&id, "5000", "5000", "5").await;
    assert_eq!(header(&response, "dashql-batch-event"), Some("FlushAfterBytes"));
    assert_eq!(header(&response, "dashql-stream-id"), Some(id.as_str()));
    assert_eq!(header(&response, "dashql-error"), None);
}

#[tokio::test]
async fn keeps_every_value_of_a_repeated_response_header() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[("set-cookie", "a=1"), ("set-cookie", "b=2")]).await;
    connection.finish().await;

    let response = read_stream(&id, "5000", "5000", "1000").await;
    let cookies: Vec<&str> = response.headers().get_all("set-cookie").iter().map(|value| value.to_str().unwrap()).collect();
    assert_eq!(cookies, vec!["a=1", "b=2"]);
}

#[tokio::test]
async fn reports_a_remote_that_cannot_be_reached() {
    // Bind and close to get a port that nobody listens on
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let response = read_stream(&id, "5000", "5000", "1000").await;
    assert_eq!(error_message(&response), "http request failed");
    // The failed stream is gone
    assert_eq!(read_stream(&id, "10", "10", "10").await.status(), 404);
}

#[tokio::test]
async fn reports_a_body_that_breaks_off() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write("HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\nshort").await;
    drop(connection);

    let response = read_stream(&id, "5000", "5000", "1000").await;
    assert_eq!(error_message(&response), "reading chunk from http stream failed");
    assert_eq!(read_stream(&id, "10", "10", "10").await.status(), 404);
}

#[tokio::test]
async fn requires_the_limits_of_a_read() {
    for headers in [
        vec![("dashql-batch-timeout", "1"), ("dashql-batch-bytes", "1")],
        vec![("dashql-read-timeout", "1"), ("dashql-batch-bytes", "1")],
        vec![("dashql-read-timeout", "1"), ("dashql-batch-timeout", "1")],
    ] {
        let response = route_proxy_request(request("GET", "/http/stream/0", &headers, &[])).await;
        assert_eq!(error_message(&response), "header is missing");
    }
}

#[tokio::test]
async fn deleting_a_stream_ends_it() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, _connection) = requests.recv().await.unwrap();
    let response = route_proxy_request(request("DELETE", &format!("/http/stream/{id}"), &[], &[])).await;
    assert_eq!(response.status(), 200);
    assert_eq!(read_stream(&id, "10", "10", "10").await.status(), 404);
    // Deleting twice is fine, the stream may have ended on its own
    assert_eq!(route_proxy_request(request("DELETE", &format!("/http/stream/{id}"), &[], &[])).await.status(), 200);
}

#[tokio::test]
async fn deleting_a_stream_cancels_a_request_that_waits_for_the_remote() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    route_proxy_request(request("DELETE", &format!("/http/stream/{id}"), &[], &[])).await;
    tokio::time::timeout(GUARD, connection.closed()).await.expect("the proxy keeps the connection open");
}

#[tokio::test]
async fn deleting_a_stream_cancels_a_body_in_progress() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[]).await;
    connection.write_chunk("partial").await;
    assert_eq!(read_stream(&id, "5000", "100", "1000000").await.body(), b"partial");

    route_proxy_request(request("DELETE", &format!("/http/stream/{id}"), &[], &[])).await;
    tokio::time::timeout(GUARD, connection.closed()).await.expect("the proxy keeps the connection open");
}

#[tokio::test]
async fn deleting_a_stream_stops_a_reader_with_a_full_queue() {
    let (address, mut requests) = spawn_http_server().await;
    let id = stream_id(&start_stream(address, "GET", "/", "", &[], &[]).await);
    let (_, mut connection) = requests.recv().await.unwrap();
    connection.write_head("200 OK", &[]).await;
    // More chunks than the queue holds, nobody reads them
    for _ in 0..20 {
        connection.write_chunk("x").await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    route_proxy_request(request("DELETE", &format!("/http/stream/{id}"), &[], &[])).await;
    tokio::time::timeout(GUARD, connection.closed()).await.expect("the proxy keeps the connection open");
}
