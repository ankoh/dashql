use crate::proxy_headers::HEADER_NAME_BATCH_BYTES;
use crate::proxy_headers::HEADER_NAME_BATCH_EVENT;
use crate::proxy_headers::HEADER_NAME_BATCH_MESSAGES;
use crate::proxy_headers::HEADER_NAME_BATCH_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_CHANNEL_ID;
use crate::proxy_headers::HEADER_NAME_ENDPOINT;
use crate::proxy_headers::HEADER_NAME_ERROR;
use crate::proxy_headers::HEADER_NAME_PATH;
use crate::proxy_headers::HEADER_NAME_READ_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_STREAM_ID;
use crate::proxy_headers::HEADER_NAME_TLS;
use crate::proxy_headers::HEADER_NAME_TLS_CACERTS;
use crate::proxy_headers::HEADER_NAME_TLS_CLIENT_CERT;
use crate::proxy_headers::HEADER_NAME_TLS_CLIENT_KEY;
use crate::proto::dashql_test::TestUnaryRequest;
use crate::proto::dashql_test::TestUnaryResponse;
use crate::proto::dashql_test::TestServerStreamingRequest;
use crate::proto::dashql_test::TestServerStreamingResponse;
use crate::test::grpc_service_mock::spawn_grpc_test_service_mock;
use crate::test::grpc_service_mock::GrpcServiceMock;
use crate::test::grpc_service_mock::GrpcServiceMockTlsConfig;
use crate::test::grpc_service_mock::spawn_grpc_test_service_mock_with_tls;
use crate::test::grpc_tls_test_certs::GrpcTlsTestCerts;
use crate::ipc_router::route_ipc_request;

use anyhow::Result;
use prost::Message;
use tauri::http::header::CONTENT_TYPE;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::StatusCode;

struct TestChannelTlsHeaders<'a> {
    ca_cert_path: Option<&'a str>,
    client_cert_path: Option<&'a str>,
    client_key_path: Option<&'a str>,
}

fn grpc_host(addr: std::net::SocketAddr, tls: bool) -> String {
    format!("{}://127.0.0.1:{}", if tls { "https" } else { "http" }, addr.port())
}

async fn create_channel(host: &str, tls: Option<TestChannelTlsHeaders<'_>>) -> Response<Vec<u8>> {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("{}/grpc/channels", host))
        .header(HEADER_NAME_ENDPOINT, host)
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str());
    if let Some(tls) = tls {
        request = request.header(HEADER_NAME_TLS, "1");
        if let Some(ca_cert_path) = tls.ca_cert_path {
            request = request.header(HEADER_NAME_TLS_CACERTS, ca_cert_path);
        }
        if let Some(client_cert_path) = tls.client_cert_path {
            request = request.header(HEADER_NAME_TLS_CLIENT_CERT, client_cert_path);
        }
        if let Some(client_key_path) = tls.client_key_path {
            request = request.header(HEADER_NAME_TLS_CLIENT_KEY, client_key_path);
        }
    }
    route_ipc_request(request.body(Vec::new()).unwrap()).await
}

async fn delete_channel(host: &str, channel_id: usize) -> Response<Vec<u8>> {
    let request: Request<Vec<u8>> = Request::builder()
        .method("DELETE")
        .uri(format!("{}/grpc/channel/{}", host, channel_id))
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(Vec::new())
        .unwrap();
    route_ipc_request(request).await
}

fn require_channel_id(response: &Response<Vec<u8>>) -> usize {
    response
        .headers()
        .get(HEADER_NAME_CHANNEL_ID)
        .unwrap()
        .to_str()
        .unwrap()
        .parse()
        .unwrap()
}

fn decode_error_body(response: &Response<Vec<u8>>) -> serde_json::Value {
    serde_json::from_slice(response.body()).unwrap()
}

#[tokio::test]
async fn test_grpc_channel_setup() -> anyhow::Result<()> {
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let host = grpc_host(addr, false);

    let response = create_channel(&host, None).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_CHANNEL_ID));
    let channel_id = require_channel_id(&response);

    let response = delete_channel(&host, channel_id).await;
    assert_eq!(response.status(), 200);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_grpc_tls_channel_setup() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: None,
        }),
    ).await;
    let host = grpc_host(addr, true);

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.ca_cert_path),
            client_cert_path: None,
            client_key_path: None,
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::OK);
    let channel_id = require_channel_id(&response);

    let response = delete_channel(&host, channel_id).await;
    assert_eq!(response.status(), StatusCode::OK);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_unary_grpc_call() -> Result<()> {
    let (mock, mut setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let host = grpc_host(addr, false);

    let unary_call = tokio::spawn(async move {
        let (param, result_sender) = setup_unary.recv().await.unwrap();
        result_sender.send(Ok(TestUnaryResponse {
            data: "response data".to_string()
        })).await.unwrap();
        param
    });

    let response = create_channel(&host, None).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_CHANNEL_ID));
    let channel_id = require_channel_id(&response);

    let request_param = TestUnaryRequest {
        data: "request data".to_string()
    };
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("{}/grpc/channel/{}/unary", host, channel_id))
        .header(HEADER_NAME_PATH, "/dashql.test.TestService/TestUnary")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(request_param.encode_to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);

    // Check received parameter
    let received_param = unary_call.await?;
    let received_response = TestUnaryResponse::decode(response.body().as_slice()).unwrap();
    assert_eq!(received_param.data, "request data");
    assert_eq!(received_response.data, "response data");

    let response = delete_channel(&host, channel_id).await;
    assert_eq!(response.status(), 200);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_mtls_unary_grpc_call() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: Some(certs.ca_cert_path.clone()),
        }),
    ).await;
    let host = grpc_host(addr, true);

    let unary_call = tokio::spawn(async move {
        let (param, result_sender) = setup_unary.recv().await.unwrap();
        result_sender.send(Ok(TestUnaryResponse {
            data: "response data".to_string()
        })).await.unwrap();
        param
    });

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.ca_cert_path),
            client_cert_path: Some(&certs.client_cert_path),
            client_key_path: Some(&certs.client_key_path),
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::OK);
    let channel_id = require_channel_id(&response);

    let request_param = TestUnaryRequest {
        data: "request data".to_string()
    };
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("{}/grpc/channel/{}/unary", host, channel_id))
        .header(HEADER_NAME_PATH, "/dashql.test.TestService/TestUnary")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(request_param.encode_to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), StatusCode::OK);

    let received_param = unary_call.await?;
    let received_response = TestUnaryResponse::decode(response.body().as_slice()).unwrap();
    assert_eq!(received_param.data, "request data");
    assert_eq!(received_response.data, "response data");

    let response = delete_channel(&host, channel_id).await;
    assert_eq!(response.status(), StatusCode::OK);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_mtls_channel_requires_client_key_header() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: Some(certs.ca_cert_path.clone()),
        }),
    ).await;
    let host = grpc_host(addr, true);

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.ca_cert_path),
            client_cert_path: Some(&certs.client_cert_path),
            client_key_path: None,
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers().get(HEADER_NAME_ERROR).unwrap(), "true");
    assert_eq!(decode_error_body(&response)["details"]["header"], HEADER_NAME_TLS_CLIENT_KEY);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_mtls_channel_requires_client_cert_header() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: Some(certs.ca_cert_path.clone()),
        }),
    ).await;
    let host = grpc_host(addr, true);

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.ca_cert_path),
            client_cert_path: None,
            client_key_path: Some(&certs.client_key_path),
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers().get(HEADER_NAME_ERROR).unwrap(), "true");
    assert_eq!(decode_error_body(&response)["details"]["header"], HEADER_NAME_TLS_CLIENT_CERT);

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_grpc_tls_channel_fails_with_wrong_ca() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: None,
        }),
    ).await;
    let host = grpc_host(addr, true);

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.wrong_ca_cert_path),
            client_cert_path: None,
            client_key_path: None,
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers().get(HEADER_NAME_ERROR).unwrap(), "true");

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_mtls_channel_fails_with_wrong_client_identity() -> Result<()> {
    let certs = GrpcTlsTestCerts::generate()?;
    let (mock, mut _setup_unary, mut _setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock_with_tls(
        mock,
        Some(GrpcServiceMockTlsConfig {
            server_cert_path: certs.server_cert_path.clone(),
            server_key_path: certs.server_key_path.clone(),
            client_ca_cert_path: Some(certs.ca_cert_path.clone()),
        }),
    ).await;
    let host = grpc_host(addr, true);

    let response = create_channel(
        &host,
        Some(TestChannelTlsHeaders {
            ca_cert_path: Some(&certs.ca_cert_path),
            client_cert_path: Some(&certs.wrong_client_cert_path),
            client_key_path: Some(&certs.wrong_client_key_path),
        }),
    ).await;
    assert_eq!(response.status(), StatusCode::OK);
    let channel_id = require_channel_id(&response);

    let request_param = TestUnaryRequest {
        data: "request data".to_string()
    };
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("{}/grpc/channel/{}/unary", host, channel_id))
        .header(HEADER_NAME_PATH, "/dashql.test.TestService/TestUnary")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(request_param.encode_to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers().get(HEADER_NAME_ERROR).unwrap(), "true");

    shutdown.send(()).unwrap();
    Ok(())
}

#[tokio::test]
async fn test_streaming_grpc_call() -> Result<()> {
    let (mock, mut _setup_unary, mut setup_server_streaming) = GrpcServiceMock::new();
    let (addr, shutdown) = spawn_grpc_test_service_mock(mock).await;
    let host = grpc_host(addr, false);

    let _streaming_call = tokio::spawn(async move {
        let (param, result_sender) = setup_server_streaming.recv().await.unwrap();
        result_sender.send(Ok(TestServerStreamingResponse {
            data: "response data".to_string()
        })).await.unwrap();
        param
    });

    let response = create_channel(&host, None).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_CHANNEL_ID));
    let channel_id = require_channel_id(&response);

    let request_param = TestServerStreamingRequest {
        data: "request data".to_string()
    };
    let request: Request<Vec<u8>> = Request::builder()
        .method("POST")
        .uri(format!("{}/grpc/channel/{}/streams", host, channel_id))
        .header(HEADER_NAME_PATH, "/dashql.test.TestService/TestServerStreaming")
        .header(CONTENT_TYPE, mime::APPLICATION_OCTET_STREAM.essence_str())
        .body(request_param.encode_to_vec())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_STREAM_ID));
    let stream_id = response.headers().get(HEADER_NAME_STREAM_ID).unwrap().to_str().unwrap();
    let stream_id: usize = stream_id.parse().unwrap();

    // Read query results
    let request: Request<Vec<u8>> = Request::builder()
        .method("GET")
        .uri(format!("{}/grpc/channel/{}/stream/{}", host, channel_id, stream_id))
        .header(HEADER_NAME_READ_TIMEOUT, "1000")
        .header(HEADER_NAME_BATCH_TIMEOUT, "1000")
        .header(HEADER_NAME_BATCH_BYTES, "10000000")
        .body(Vec::new())
        .unwrap();
    let response = route_ipc_request(request).await;
    assert_eq!(response.status(), 200);
    assert!(response.headers().contains_key(HEADER_NAME_CHANNEL_ID));
    assert!(response.headers().contains_key(HEADER_NAME_STREAM_ID));
    assert!(response.headers().contains_key(HEADER_NAME_BATCH_EVENT));
    assert!(response.headers().contains_key(HEADER_NAME_BATCH_MESSAGES));
    let batch_event = response.headers().get(HEADER_NAME_BATCH_EVENT).unwrap().to_str().unwrap();
    let batch_messages = response.headers().get(HEADER_NAME_BATCH_MESSAGES).unwrap().to_str().unwrap();
    assert_eq!(batch_messages, "1");
    assert_eq!(batch_event, "StreamFinished");
    let response_bytes = response.body();
    assert!(response_bytes.len() > 4);
    let response_message = TestServerStreamingResponse::decode(&response_bytes[4..]).unwrap();
    assert_eq!(response_message.data, "response data");

    let response = delete_channel(&host, channel_id).await;
    assert_eq!(response.status(), 200);

    shutdown.send(()).unwrap();
    Ok(())
}
