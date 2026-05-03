use std::net::SocketAddr;
use std::pin::Pin;

use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::Stream;
use tonic::Status;

use crate::proto::hyper::hyper_service_server::{HyperService, HyperServiceServer};
use crate::proto::hyper::{QueryParam, QueryResult};

pub type QueryResponseSender = mpsc::Sender<Result<QueryResult, Status>>;
pub type SetupSender = mpsc::Sender<(QueryParam, QueryResponseSender)>;
pub type SetupReceiver = mpsc::Receiver<(QueryParam, QueryResponseSender)>;

pub struct HyperServiceMock {
    setup: SetupSender,
}

impl HyperServiceMock {
    pub fn new() -> (Self, SetupReceiver) {
        let (tx, rx) = mpsc::channel(4);
        (Self { setup: tx }, rx)
    }
}

type QueryResultStream = Pin<Box<dyn Stream<Item = Result<QueryResult, Status>> + Send>>;

#[tonic::async_trait]
impl HyperService for HyperServiceMock {
    type ExecuteQueryStream = QueryResultStream;

    async fn execute_query(
        &self,
        request: tonic::Request<QueryParam>,
    ) -> Result<tonic::Response<Self::ExecuteQueryStream>, Status> {
        let (result_tx, result_rx) = mpsc::channel(16);
        let params = request.into_inner();
        self.setup
            .clone()
            .send((params, result_tx))
            .await
            .map_err(|e| Status::internal(format!("setup send failed: {}", e)))?;
        let stream = ReceiverStream::new(result_rx);
        Ok(tonic::Response::new(Box::pin(stream) as QueryResultStream))
    }
}

pub async fn spawn(mock: HyperServiceMock) -> (SocketAddr, oneshot::Sender<()>) {
    let service = HyperServiceServer::new(mock);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
        tonic::transport::Server::builder()
            .add_service(service)
            .serve_with_incoming_shutdown(incoming, async { drop(shutdown_rx.await) })
            .await
            .unwrap();
    });
    (addr, shutdown_tx)
}
