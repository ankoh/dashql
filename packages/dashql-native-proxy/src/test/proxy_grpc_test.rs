//! The gRPC proxy through the routes the app calls, against the mock of the test service.

use std::net::SocketAddr;
use std::time::Duration;

use http::{Request, Response};
use prost::Message;

use crate::proto::dashql_test::{TestServerStreamingRequest, TestServerStreamingResponse, TestUnaryRequest, TestUnaryResponse};
use crate::route_proxy_request;
use crate::test::grpc_service_mock::{spawn_grpc_test_service_mock, GrpcServiceMock};

const UNARY: &str = "/dashql.test.TestService/TestUnary";
const STREAMING: &str = "/dashql.test.TestService/TestServerStreaming";
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

fn error(response: &Response<Vec<u8>>) -> serde_json::Value {
    assert_eq!(header(response, "dashql-error"), Some("true"), "{response:?}");
    serde_json::from_slice(response.body()).unwrap()
}

async fn create_channel(address: SocketAddr) -> String {
    let endpoint = format!("http://{address}");
    let response = route_proxy_request(request("POST", "/grpc/channels", &[("dashql-endpoint", endpoint.as_str())], &[])).await;
    assert_eq!(response.status(), 200, "{response:?}");
    header(&response, "dashql-channel-id").unwrap().to_string()
}

async fn start_stream(channel: &str, extra: &[(&str, &str)]) -> Response<Vec<u8>> {
    let mut headers = vec![("dashql-path", STREAMING)];
    headers.extend_from_slice(extra);
    let body = TestServerStreamingRequest { data: "request".to_string() }.encode_to_vec();
    route_proxy_request(request("POST", &format!("/grpc/channel/{channel}/streams"), &headers, &body)).await
}

fn stream_id(response: &Response<Vec<u8>>) -> String {
    assert_eq!(response.status(), 200, "{response:?}");
    header(response, "dashql-stream-id").unwrap().to_string()
}

async fn read_stream(channel: &str, stream: &str, read_ms: &str, batch_ms: &str, bytes: &str) -> Response<Vec<u8>> {
    let headers = [("dashql-read-timeout", read_ms), ("dashql-batch-timeout", batch_ms), ("dashql-batch-bytes", bytes)];
    route_proxy_request(request("GET", &format!("/grpc/channel/{channel}/stream/{stream}"), &headers, &[])).await
}

/// The messages of a batch, each with its length as a little endian prefix
fn messages(body: &[u8]) -> Vec<String> {
    let mut messages = Vec::new();
    let mut position = 0;
    while position < body.len() {
        let length = u32::from_le_bytes(body[position..position + 4].try_into().unwrap()) as usize;
        position += 4;
        messages.push(TestServerStreamingResponse::decode(&body[position..position + length]).unwrap().data);
        position += length;
    }
    messages
}

fn message(data: &str) -> Result<TestServerStreamingResponse, tonic::Status> {
    Ok(TestServerStreamingResponse { data: data.to_string() })
}

#[tokio::test]
async fn a_channel_needs_an_endpoint() {
    let response = route_proxy_request(request("POST", "/grpc/channels", &[], &[])).await;
    assert_eq!(response.status(), 400);
    let body = error(&response);
    assert_eq!(body["message"], "header is missing");
    assert_eq!(body["details"]["header"], "dashql-endpoint");
}

#[tokio::test]
async fn rejects_an_invalid_endpoint() {
    let response = route_proxy_request(request("POST", "/grpc/channels", &[("dashql-endpoint", "not a url")], &[])).await;
    assert_eq!(error(&response)["message"], "header is not a valid endpoint");
}

#[tokio::test]
async fn reports_an_endpoint_that_cannot_be_reached() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let response = route_proxy_request(request("POST", "/grpc/channels", &[("dashql-endpoint", endpoint.as_str())], &[])).await;
    assert_eq!(error(&response)["message"], "connecting to gRPC endpoint failed");
}

#[tokio::test]
async fn a_client_certificate_needs_its_key_and_the_key_its_certificate() {
    let endpoint = ("dashql-endpoint", "https://127.0.0.1:1");
    let response = route_proxy_request(request("POST", "/grpc/channels", &[endpoint, ("dashql-tls-client-cert", "/cert.pem")], &[])).await;
    assert_eq!(error(&response)["details"]["header"], "dashql-tls-client-key");
    let response = route_proxy_request(request("POST", "/grpc/channels", &[endpoint, ("dashql-tls-client-key", "/key.pem")], &[])).await;
    assert_eq!(error(&response)["details"]["header"], "dashql-tls-client-cert");
}

#[tokio::test]
async fn reports_tls_files_that_cannot_be_read() {
    let endpoint = ("dashql-endpoint", "https://127.0.0.1:1");
    for headers in [
        vec![endpoint, ("dashql-tls-cacerts", "/missing/ca.pem")],
        vec![endpoint, ("dashql-tls-client-cert", "/missing/cert.pem"), ("dashql-tls-client-key", "/missing/key.pem")],
    ] {
        let body = error(&route_proxy_request(request("POST", "/grpc/channels", &headers, &[])).await);
        assert_eq!(body["message"], "gRPC tls config is invalid");
        assert!(body["details"]["error"].as_str().unwrap().contains("/missing/"), "{body}");
    }
}

#[tokio::test]
async fn tls_without_a_server_fails_to_connect() {
    let headers = [("dashql-endpoint", "https://127.0.0.1:1"), ("dashql-tls", "1")];
    let body = error(&route_proxy_request(request("POST", "/grpc/channels", &headers, &[])).await);
    assert_eq!(body["message"], "connecting to gRPC endpoint failed");
}

#[tokio::test]
async fn calls_a_unary_function() {
    let (mock, mut setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let metadata = mock.received_metadata.clone();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;

    let server = tokio::spawn(async move {
        let (param, sender) = setup_unary.recv().await.unwrap();
        sender.send(Ok(TestUnaryResponse { data: "response".to_string() })).await.unwrap();
        param
    });
    let body = TestUnaryRequest { data: "request".to_string() }.encode_to_vec();
    let response = route_proxy_request(request("POST", &format!("/grpc/channel/{channel}/unary"), &[
        ("dashql-path", UNARY),
        ("authorization", "Bearer token"),
        ("origin", "http://localhost"),
        ("accept", "*/*"),
    ], &body)).await;

    assert_eq!(response.status(), 200, "{response:?}");
    assert_eq!(header(&response, "dashql-channel-id"), Some(channel.as_str()));
    assert_eq!(TestUnaryResponse::decode(response.body().as_slice()).unwrap().data, "response");
    assert_eq!(server.await.unwrap().data, "request");

    let metadata = metadata.lock().unwrap()[0].clone();
    assert_eq!(metadata.get("authorization").unwrap(), "Bearer token");
    // Data Cloud refuses these, and our headers stop at the proxy
    for masked in ["origin", "accept", "dashql-path"] {
        assert!(metadata.get(masked).is_none(), "{masked}");
    }
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn forwards_the_rich_error_of_a_unary_function() {
    let (mock, mut setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    tokio::spawn(async move {
        let (_, sender) = setup_unary.recv().await.unwrap();
        let status = tonic::Status::with_details(tonic::Code::InvalidArgument, "bad query", vec![1, 2, 3].into());
        sender.send(Err(status)).await.unwrap();
    });
    let response = route_proxy_request(request("POST", &format!("/grpc/channel/{channel}/unary"), &[("dashql-path", UNARY)], &[])).await;
    assert_eq!(response.status(), 400);
    assert_eq!(header(&response, "dashql-grpc-status"), Some("3"));
    assert_eq!(header(&response, "dashql-grpc-message"), Some("bad query"));
    assert_eq!(header(&response, "dashql-grpc-status-details-bin"), Some("AQID"));
    assert_eq!(error(&response)["message"], "gRPC call failed");
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn survives_a_database_error_that_spans_lines() {
    let (mock, mut setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    tokio::spawn(async move {
        let (_, sender) = setup_unary.recv().await.unwrap();
        let status = tonic::Status::new(tonic::Code::InvalidArgument, "syntax error at line 1\nnear \"caf\u{e9}\"");
        sender.send(Err(status)).await.unwrap();
    });
    let response = route_proxy_request(request("POST", &format!("/grpc/channel/{channel}/unary"), &[("dashql-path", UNARY)], &[])).await;
    assert_eq!(response.status(), 400);
    assert_eq!(header(&response, "dashql-grpc-status"), Some("3"));
    assert!(error(&response)["details"]["error"].as_str().unwrap().contains("near"));
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn validates_a_call_before_sending_it() {
    let (mock, _setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;

    for route in ["unary", "streams"] {
        let path = format!("/grpc/channel/{channel}/{route}");
        let body = error(&route_proxy_request(request("POST", &path, &[], &[])).await);
        assert_eq!(body["message"], "header is missing");
        let body = error(&route_proxy_request(request("POST", &path, &[("dashql-path", "no path")], &[])).await);
        assert_eq!(body["message"], "header stores invalid path");
    }
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn refuses_an_unknown_channel() {
    for route in ["unary", "streams"] {
        let response = route_proxy_request(request("POST", &format!("/grpc/channel/999999/{route}"), &[("dashql-path", UNARY)], &[])).await;
        assert_eq!(response.status(), 404);
        assert_eq!(error(&response)["message"], "gRPC channel id is unknown");
    }
    assert_eq!(read_stream("999999", "0", "1", "1", "1").await.status(), 404);
}

#[tokio::test]
async fn a_deleted_channel_is_gone() {
    let (mock, _setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    assert_eq!(route_proxy_request(request("DELETE", &format!("/grpc/channel/{channel}"), &[], &[])).await.status(), 200);
    let response = route_proxy_request(request("POST", &format!("/grpc/channel/{channel}/unary"), &[("dashql-path", UNARY)], &[])).await;
    assert_eq!(response.status(), 404);
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn rejects_methods_a_route_does_not_have() {
    assert_eq!(route_proxy_request(request("GET", "/grpc/channels", &[], &[])).await.status(), 404);
    assert_eq!(route_proxy_request(request("GET", "/grpc/channel/1/unary", &[], &[])).await.status(), 404);
}

#[tokio::test]
async fn streams_batches_until_the_end() {
    let (mock, _setup_unary, mut setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;

    let server = tokio::spawn(async move {
        let (param, sender) = setup_streaming.recv().await.unwrap();
        sender.send(message("one")).await.unwrap();
        sender.send(message("two")).await.unwrap();
        param
    });
    let start = start_stream(&channel, &[]).await;
    let stream = stream_id(&start);
    assert_eq!(header(&start, "dashql-channel-id"), Some(channel.as_str()));
    assert_eq!(server.await.unwrap().data, "request");

    let response = read_stream(&channel, &stream, "5000", "5000", "1000000").await;
    assert_eq!(response.status(), 200, "{response:?}");
    assert_eq!(header(&response, "dashql-batch-event"), Some("StreamFinished"));
    assert_eq!(header(&response, "dashql-batch-messages"), Some("2"));
    assert_eq!(messages(response.body()), vec!["one", "two"]);

    assert_eq!(read_stream(&channel, &stream, "10", "10", "10").await.status(), 404);
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn flushes_a_batch_after_the_size_limit_and_after_the_timeout() {
    let (mock, _setup_unary, mut setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    let stream = {
        let server = tokio::spawn(async move { setup_streaming.recv().await.unwrap() });
        let stream = stream_id(&start_stream(&channel, &[]).await);
        let (_, sender) = server.await.unwrap();

        sender.send(message("a long enough message")).await.unwrap();
        let response = read_stream(&channel, &stream, "5000", "5000", "4").await;
        assert_eq!(header(&response, "dashql-batch-event"), Some("FlushAfterBytes"));
        assert_eq!(messages(response.body()), vec!["a long enough message"]);

        sender.send(message("partial")).await.unwrap();
        let response = read_stream(&channel, &stream, "5000", "100", "1000000").await;
        assert_eq!(header(&response, "dashql-batch-event"), Some("FlushAfterTimeout"));
        assert_eq!(messages(response.body()), vec!["partial"]);

        // Nothing arrives within the read timeout
        let response = read_stream(&channel, &stream, "50", "50", "1000").await;
        assert_eq!(error(&response)["message"], "reading from gRPC stream timed out");
        drop(sender);
        stream
    };
    let response = read_stream(&channel, &stream, "5000", "5000", "1000").await;
    assert_eq!(header(&response, "dashql-batch-event"), Some("StreamFinished"));
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn forwards_the_rich_error_of_a_failing_stream() {
    let (mock, _setup_unary, mut setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    let server = tokio::spawn(async move { setup_streaming.recv().await.unwrap() });
    let stream = stream_id(&start_stream(&channel, &[]).await);
    let (_, sender) = server.await.unwrap();
    sender.send(message("held back")).await.unwrap();
    let status = tonic::Status::with_details(tonic::Code::Internal, "failed\nmidway", vec![9].into());
    sender.send(Err(status)).await.unwrap();

    let response = read_stream(&channel, &stream, "5000", "5000", "1000000").await;
    assert_eq!(response.status(), 400);
    assert_eq!(header(&response, "dashql-grpc-status"), Some("13"));
    assert_eq!(header(&response, "dashql-grpc-status-details-bin"), Some("CQ=="));
    assert_eq!(error(&response)["message"], "reading from gRPC stream failed");
    assert_eq!(read_stream(&channel, &stream, "10", "10", "10").await.status(), 404);
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn requires_the_limits_of_a_read() {
    let (mock, _setup_unary, _setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    let path = format!("/grpc/channel/{channel}/stream/0");
    assert_eq!(error(&route_proxy_request(request("GET", &path, &[], &[])).await)["message"], "header is missing");
    let headers = [("dashql-read-timeout", "soon"), ("dashql-batch-timeout", "1"), ("dashql-batch-bytes", "1")];
    assert_eq!(error(&route_proxy_request(request("GET", &path, &headers, &[])).await)["message"], "header is not an unsigned integer");
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn deleting_a_stream_cancels_a_query_that_is_silent() {
    let (mock, _setup_unary, mut setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    let server = tokio::spawn(async move { setup_streaming.recv().await.unwrap() });
    let stream = stream_id(&start_stream(&channel, &[]).await);
    let (_, sender) = server.await.unwrap();

    let response = route_proxy_request(request("DELETE", &format!("/grpc/channel/{channel}/stream/{stream}"), &[], &[])).await;
    assert_eq!(response.status(), 200);
    assert_eq!(read_stream(&channel, &stream, "10", "10", "10").await.status(), 404);
    tokio::time::timeout(GUARD, sender.closed()).await.expect("the server was not told to stop");
    shutdown.send(()).unwrap();
}

#[tokio::test]
async fn deleting_a_stream_cancels_a_query_with_a_full_queue() {
    let (mock, _setup_unary, mut setup_streaming) = GrpcServiceMock::new();
    let (address, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let channel = create_channel(address).await;
    let server = tokio::spawn(async move { setup_streaming.recv().await.unwrap() });
    let stream = stream_id(&start_stream(&channel, &[]).await);
    let (_, sender) = server.await.unwrap();

    // More messages than the queue holds, nobody reads them
    for i in 0..15 {
        sender.send(message(&format!("message {i}"))).await.unwrap();
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    route_proxy_request(request("DELETE", &format!("/grpc/channel/{channel}/stream/{stream}"), &[], &[])).await;
    tokio::time::timeout(GUARD, sender.closed()).await.expect("the server was not told to stop");
    shutdown.send(()).unwrap();
}
