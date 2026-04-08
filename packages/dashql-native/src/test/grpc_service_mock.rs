use crate::proto::dashql_test::{
    test_service_server::{TestService, TestServiceServer}, TestServerStreamingRequest, TestServerStreamingResponse, TestUnaryRequest, TestUnaryResponse
};
use std::{net::SocketAddr, pin::Pin};
use tokio::sync::oneshot;
use tokio_stream::{wrappers::ReceiverStream, Stream};
use tonic::Status;
use tonic::transport::Certificate;
use tonic::transport::Identity;
use tonic::transport::ServerTlsConfig;

pub type UnaryResponseSender = tokio::sync::mpsc::Sender<Result<TestUnaryResponse, tonic::Status>>;
pub type ServerStreamingResponseSender = tokio::sync::mpsc::Sender<Result<TestServerStreamingResponse, tonic::Status>>;

pub struct GrpcServiceMock {
    pub setup_unary: tokio::sync::mpsc::Sender<(TestUnaryRequest, UnaryResponseSender)>,
    pub setup_server_streaming: tokio::sync::mpsc::Sender<(TestServerStreamingRequest, ServerStreamingResponseSender)>,
}

pub struct GrpcServiceMockTlsConfig {
    pub server_cert_path: String,
    pub server_key_path: String,
    pub client_ca_cert_path: Option<String>,
}

impl GrpcServiceMock {
    pub fn new() -> (
        Self,
        tokio::sync::mpsc::Receiver<(TestUnaryRequest, UnaryResponseSender)>,
        tokio::sync::mpsc::Receiver<(TestServerStreamingRequest, ServerStreamingResponseSender)>
    ) {
        let (send_unary_setup, recv_unary_setup) = tokio::sync::mpsc::channel(1);
        let (send_server_streaming_setup, recv_server_streaming_setup) = tokio::sync::mpsc::channel(1);
        (Self { setup_unary: send_unary_setup, setup_server_streaming: send_server_streaming_setup }, recv_unary_setup, recv_server_streaming_setup)
    }
}

type ServerStreamingResponseStream = Pin<Box<dyn Stream<Item = Result<TestServerStreamingResponse, Status>> + Send>>;

#[tonic::async_trait]
impl TestService for GrpcServiceMock {
    type TestServerStreamingStream = ServerStreamingResponseStream;

    async fn test_unary(
        &self,
        request: tonic::Request<TestUnaryRequest>
    ) -> Result<tonic::Response<TestUnaryResponse>, tonic::Status> {
        // Setup a channel for sending the result
        let (result_sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let test_setup = self.setup_unary.clone();

        // Pass the result_sender back to the test, together with the request params
        let params = request.into_inner();
        test_setup.send((params, result_sender)).await.unwrap();

        // Await the response
        let response = receiver.recv().await.unwrap()?;
        Ok(tonic::Response::new(response))
    }

    async fn test_server_streaming(
        &self,
        request: tonic::Request<TestServerStreamingRequest>,
    ) -> Result<tonic::Response<Self::TestServerStreamingStream>, tonic::Status> {
        // Setup a channel for sending results
        let (result_sender, receive) = tokio::sync::mpsc::channel(10);
        let test_setup = self.setup_server_streaming.clone();

        // Pass the result_sender back to the test, together with the request params
        let params = request.into_inner();
        test_setup.send((params, result_sender)).await.unwrap();

        // Wire up a receiver stream to the gRPC output
        let out = ReceiverStream::new(receive);
        Ok(tonic::Response::new(
            Box::pin(out) as Self::TestServerStreamingStream
        ))
    }
}

pub async fn spawn_grpc_test_service_mock(mock: GrpcServiceMock) -> (SocketAddr, oneshot::Sender<()>) {
    spawn_grpc_test_service_mock_with_tls(mock, None).await
}

pub async fn spawn_grpc_test_service_mock_with_tls(
    mock: GrpcServiceMock,
    tls: Option<GrpcServiceMockTlsConfig>,
) -> (SocketAddr, oneshot::Sender<()>) {
    let service = TestServiceServer::new(mock);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let mut builder = tonic::transport::Server::builder();
    if let Some(tls) = tls {
        let server_cert = tokio::fs::read(&tls.server_cert_path).await.unwrap();
        let server_key = tokio::fs::read(&tls.server_key_path).await.unwrap();
        let identity = Identity::from_pem(server_cert, server_key);
        let mut tls_config = ServerTlsConfig::new().identity(identity);
        if let Some(client_ca_cert_path) = tls.client_ca_cert_path {
            let client_ca = tokio::fs::read(&client_ca_cert_path).await.unwrap();
            tls_config = tls_config.client_ca_root(Certificate::from_pem(client_ca));
        }
        builder = builder.tls_config(tls_config).unwrap();
    }

    tokio::spawn(async move {
        builder
            .add_service(service)
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                async { drop(shutdown_rx.await) },
            )
            .await
            .unwrap();
    });
    (addr, shutdown_tx)
}

