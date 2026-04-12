use http::Method;
use tauri::http::header::ACCESS_CONTROL_EXPOSE_HEADERS;
use tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN;
use tauri::http::header::CONTENT_TYPE;
use tauri::http::header::HeaderName;
use tauri::http::Request;
use tauri::http::Response;
use tauri::http::HeaderValue;
use tracing::Instrument;

use crate::proxy_headers::{HEADER_NAME_TRACE_ID, HEADER_NAME_SPAN_ID, HEADER_NAME_PARENT_SPAN_ID};
use crate::trace_context::{TraceContext, enter_trace_context};

use crate::duckdb_proxy_globals::create_connection;
use crate::duckdb_proxy_globals::create_database;
use crate::duckdb_proxy_globals::create_prepared_statement;
use crate::duckdb_proxy_globals::create_arrow_ipc_upload;
use crate::duckdb_proxy_globals::cancel_pending_query;
use crate::duckdb_proxy_globals::delete_connection;
use crate::duckdb_proxy_globals::delete_database;
use crate::duckdb_proxy_globals::delete_prepared_statement;
use crate::duckdb_proxy_globals::delete_query_stream;
use crate::duckdb_proxy_globals::fetch_pending_query_results;
use crate::duckdb_proxy_globals::get_database_version;
use crate::duckdb_proxy_globals::open_database;
use crate::duckdb_proxy_globals::poll_pending_query;
use crate::duckdb_proxy_globals::push_arrow_ipc_upload_chunk;
use crate::duckdb_proxy_globals::read_query_stream;
use crate::duckdb_proxy_globals::reset_database;
use crate::duckdb_proxy_globals::run_prepared_statement;
use crate::duckdb_proxy_globals::send_prepared_statement;
use crate::duckdb_proxy_globals::start_pending_query;
use crate::duckdb_proxy_globals::start_query_stream;
use crate::duckdb_proxy_routes::DuckDBProxyRoute;
use crate::duckdb_proxy_routes::parse_duckdb_proxy_path;
use crate::grpc_proxy_globals::call_grpc_unary;
use crate::grpc_proxy_globals::create_grpc_channel;
use crate::grpc_proxy_globals::delete_grpc_channel;
use crate::grpc_proxy_globals::delete_grpc_server_stream;
use crate::grpc_proxy_globals::read_grpc_server_stream;
use crate::grpc_proxy_globals::start_grpc_server_stream;
use crate::grpc_proxy_routes::GrpcProxyRoute;
use crate::grpc_proxy_routes::parse_grpc_proxy_path;
use crate::http_proxy_globals::delete_http_server_stream;
use crate::http_proxy_globals::read_http_server_stream;
use crate::http_proxy_globals::start_http_server_stream;
use crate::http_proxy_routes::HttpProxyRoute;
use crate::http_proxy_routes::parse_http_proxy_path;

pub async fn route_ipc_request(mut request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    log::debug!("received ipc request with path={}", request.uri().path());

    // Handle DuckDB requests
    if let Some(route) = parse_duckdb_proxy_path(request.uri().path()) {
        log::debug!("matching duckdb proxy route={:?}, method={:?}", route, request.method());
        let response = match (request.method().clone(), route) {
            (Method::POST, DuckDBProxyRoute::Databases) => create_database(std::mem::take(&mut request)).await,
            (Method::DELETE, DuckDBProxyRoute::Database { database_id }) => delete_database(database_id, std::mem::take(&mut request)).await,
            (Method::POST, DuckDBProxyRoute::DatabaseOpen { database_id }) => open_database(database_id, std::mem::take(&mut request)).await,
            (Method::POST, DuckDBProxyRoute::DatabaseReset { database_id }) => reset_database(database_id, std::mem::take(&mut request)).await,
            (Method::GET, DuckDBProxyRoute::DatabaseVersion { database_id }) => get_database_version(database_id, std::mem::take(&mut request)).await,
            (Method::POST, DuckDBProxyRoute::DatabaseConnections { database_id }) => create_connection(database_id, std::mem::take(&mut request)).await,
            (Method::DELETE, DuckDBProxyRoute::DatabaseConnection { database_id, connection_id }) => {
                delete_connection(database_id, connection_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionQuery { database_id, connection_id }) => {
                start_query_stream(database_id, connection_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionPending { database_id, connection_id }) => {
                start_pending_query(database_id, connection_id, std::mem::take(&mut request)).await
            }
            (Method::GET, DuckDBProxyRoute::DatabaseConnectionPendingRead { database_id, connection_id, stream_id }) => {
                poll_pending_query(database_id, connection_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::GET, DuckDBProxyRoute::DatabaseConnectionPendingResults { database_id, connection_id, stream_id }) => {
                fetch_pending_query_results(database_id, connection_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, DuckDBProxyRoute::DatabaseConnectionPendingRead { database_id, connection_id, stream_id }) => {
                cancel_pending_query(database_id, connection_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionPreparedStatements { database_id, connection_id }) => {
                create_prepared_statement(database_id, connection_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, DuckDBProxyRoute::DatabaseConnectionPreparedStatement { database_id, connection_id, statement_id }) => {
                delete_prepared_statement(database_id, connection_id, statement_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionPreparedStatementRun { database_id, connection_id, statement_id }) => {
                run_prepared_statement(database_id, connection_id, statement_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionPreparedStatementSend { database_id, connection_id, statement_id }) => {
                send_prepared_statement(database_id, connection_id, statement_id, std::mem::take(&mut request)).await
            }
            (Method::GET, DuckDBProxyRoute::DatabaseConnectionStream { database_id, connection_id, stream_id }) => {
                read_query_stream(database_id, connection_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, DuckDBProxyRoute::DatabaseConnectionStream { database_id, connection_id, stream_id }) => {
                delete_query_stream(database_id, connection_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionUploads { database_id, connection_id }) => {
                create_arrow_ipc_upload(database_id, connection_id, std::mem::take(&mut request)).await
            }
            (Method::PATCH, DuckDBProxyRoute::DatabaseConnectionUpload { database_id, connection_id, upload_id }) => {
                push_arrow_ipc_upload_chunk(database_id, connection_id, upload_id, false, std::mem::take(&mut request)).await
            }
            (Method::POST, DuckDBProxyRoute::DatabaseConnectionUploadFinish { database_id, connection_id, upload_id }) => {
                push_arrow_ipc_upload_chunk(database_id, connection_id, upload_id, true, std::mem::take(&mut request)).await
            }
            (_, _) => {
                let body = format!("cannot find handler for duckdb proxy route={:?}, method={:?}", request.uri().path(), request.method());
                return Response::builder()
                    .status(404)
                    .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
                    .body(body.as_bytes().to_vec())
                    .unwrap();
            }
        };
        return response;
    }

    // Handle HTTP requests
    if let Some(route) = parse_http_proxy_path(request.uri().path()) {
        log::debug!("matching http proxy route={:?}, method={:?}", route, request.method());
        let response = match (request.method().clone(), route) {
            (Method::POST, HttpProxyRoute::Streams { }) => start_http_server_stream(std::mem::take(&mut request)).await,
            (Method::GET, HttpProxyRoute::Stream { stream_id }) => read_http_server_stream(stream_id, std::mem::take(&mut request)).await,
            (Method::DELETE, HttpProxyRoute::Stream { stream_id }) => delete_http_server_stream(stream_id, std::mem::take(&mut request)).await,
            (_, _) => {
                let body = format!("cannot find handler for grpc proxy route={:?}, method={:?}", request.uri().path(), request.method());
                return Response::builder()
                    .status(404)
                    .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
                    .body(body.as_bytes().to_vec())
                    .unwrap();
            }
        };
        return response;
    }

    // Handle gRPC requests
    if let Some(route) = parse_grpc_proxy_path(request.uri().path()) {
        log::debug!("matching grpc proxy route={:?}, method={:?}", route, request.method());
        let response = match (request.method().clone(), route) {
            (Method::POST, GrpcProxyRoute::Channels) => create_grpc_channel(std::mem::take(&mut request)).await,
            (Method::DELETE, GrpcProxyRoute::Channel { channel_id }) => delete_grpc_channel(channel_id).await,
            (Method::POST, GrpcProxyRoute::ChannelUnary { channel_id }) => call_grpc_unary(channel_id, std::mem::take(&mut request)).await,
            (Method::POST, GrpcProxyRoute::ChannelStreams { channel_id }) => start_grpc_server_stream(channel_id, std::mem::take(&mut request)).await,
            (Method::GET, GrpcProxyRoute::ChannelStream { channel_id, stream_id }) => read_grpc_server_stream(channel_id, stream_id, std::mem::take(&mut request)).await,
            (Method::DELETE, GrpcProxyRoute::ChannelStream { channel_id, stream_id }) => delete_grpc_server_stream(channel_id, stream_id, std::mem::take(&mut request)).await,
            (_, _) => {
                let body = format!("cannot find handler for http proxy route={:?}, method={:?}", request.uri().path(), request.method());
                return Response::builder()
                    .status(404)
                    .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
                    .body(body.as_bytes().to_vec())
                    .unwrap();
            }
        };
        log::debug!("grpc proxy responded with: status={:?}, body_bytes={:?}", response.status(), response.body().len());
        return response;
    }

    Response::builder()
        .status(400)
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body("cannot find route for request path".as_bytes().to_vec())
        .unwrap()
}

#[allow(dead_code)]
pub async fn process_ipc_request(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // Extract trace context from headers
    let trace_ctx = extract_trace_context(&request);

    // Run request handler within trace context (if present)
    // All log::* and tracing::* calls within will inherit trace_id/span_id
    let mut response = if let Some(ctx) = trace_ctx {
        let span = ctx.create_span("ipc_request");
        enter_trace_context(ctx, || route_ipc_request(request))
            .instrument(span)
            .await
    } else {
        route_ipc_request(request).await
    };

    // Add CORS headers
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(mime::APPLICATION_OCTET_STREAM.essence_str()));
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("*"));
    headers.insert(HeaderName::from_static("cross-origin-resource-policy"), HeaderValue::from_static("cross-origin"));
    response
}

fn extract_trace_context(request: &Request<Vec<u8>>) -> Option<TraceContext> {
    let headers = request.headers();
    let trace_id = headers.get(HEADER_NAME_TRACE_ID)?.to_str().ok()?.to_string();
    let span_id = headers.get(HEADER_NAME_SPAN_ID)?.to_str().ok()?.to_string();
    let parent_span_id = headers.get(HEADER_NAME_PARENT_SPAN_ID)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    Some(TraceContext::from_headers(trace_id, span_id, parent_span_id))
}
