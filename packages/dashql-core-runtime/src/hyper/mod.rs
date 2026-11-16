//! The Hyper connector: the V3 HTTP API of Hyper, sans-IO, and the logic around the channels of the host.
//!
//! The module does no I/O. The client builds HTTP requests and reads the responses that the host received
//! (`client`), the result of a query is a state machine that asks for chunks and status polls and passes the chunks
//! on unread, they are parts of one Arrow IPC stream (`result_reader`). The errors of the server become the rich error
//! model of Hyper (`error`, `error_info`), which the gRPC proxy of the desktop app forwards as well. The gRPC channel of
//! the desktop app and the embedded Hyper stay channels of the host (`channel`), the module keeps the logic around them:
//! the session options and the query queue of the embedded Hyper (`embedded`), the local cloud (`local_cloud`), the links
//! to a Hyper (`link`) and what the descriptor of the connector says about params (`descriptor`).
//!
//! Ported from `packages/dashql/src/platform/connections/hyper/` and the web channel of the app,
//! `packages/dashql-app/src/connections/hyper/platform/web_hyperdb_http_client.ts`.

pub mod channel;
pub mod client;
pub mod descriptor;
pub mod embedded;
pub mod error;
pub mod error_info;
pub mod link;
pub mod local_cloud;
pub mod result_reader;
pub mod status;

pub use channel::{HyperChannelContext, HyperHttpChannel, HyperProtocol};
pub use client::{
    read_cancel_response, read_query_response, read_rows_response, read_status_header, read_status_response,
    AttachedDatabase, ExecuteQueryRequest, GetQueryChunkParams, GetQueryRowsParams, GetQueryStatusParams,
    HyperHttpClient, HyperRequestHeaders, QueryResponse, ResultRange, ARROW_STREAM_CONTENT_TYPE, HEADER_HYPERDB_STATUS,
};
pub use error::{
    check_response, read_error_response, HyperError, HyperHttpError, HyperQueryError, QueryErrorDetails,
    QueryErrorPosition, QueryErrorResponse,
};
pub use error_info::{
    decode_grpc_error_headers, decode_grpc_status_details, from_http_error_response, HyperErrorInfo, HyperErrorSource,
    HyperTextPosition, HEADER_GRPC_MESSAGE, HEADER_GRPC_STATUS, HEADER_GRPC_STATUS_DETAILS,
};
pub use crate::http::{Headers, HttpMethod, HttpRequest, HttpResponse};
pub use result_reader::{
    HyperResultReader, ReaderPoll, ReaderRequest, RequestId, ResultEvent, CHUNK_POLL_DELAY_MS, DEFAULT_PARALLEL_CHUNKS,
};
pub use status::{CompletionStatus, ExecutionStats, QueryStatus};
