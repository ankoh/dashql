use http::header::CONTENT_TYPE;
use http::{Method, Request, Response};

use crate::grpc_proxy_globals::{
    call_grpc_unary, create_grpc_channel, delete_grpc_channel, delete_grpc_server_stream,
    read_grpc_server_stream, start_grpc_server_stream,
};
use crate::grpc_proxy_routes::{parse_grpc_proxy_path, GrpcProxyRoute};
use crate::http_proxy_globals::{delete_http_server_stream, read_http_server_stream, start_http_server_stream};
use crate::http_proxy_routes::{parse_http_proxy_path, HttpProxyRoute};

fn not_found(message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body(message.into_bytes())
        .unwrap()
}

pub async fn route_proxy_request(mut request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::GET && request.uri().path() == "/health" {
        return Response::builder()
            .status(200)
            .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str())
            .body(br#"{"status":"ok"}"#.to_vec())
            .unwrap();
    }

    if let Some(route) = parse_http_proxy_path(request.uri().path()) {
        return match (request.method().clone(), route) {
            (Method::POST, HttpProxyRoute::Streams {}) => start_http_server_stream(std::mem::take(&mut request)).await,
            (Method::GET, HttpProxyRoute::Stream { stream_id }) => {
                read_http_server_stream(stream_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, HttpProxyRoute::Stream { stream_id }) => {
                delete_http_server_stream(stream_id, std::mem::take(&mut request)).await
            }
            _ => not_found(format!("cannot find handler for http proxy route={:?}, method={:?}", request.uri().path(), request.method())),
        };
    }

    if let Some(route) = parse_grpc_proxy_path(request.uri().path()) {
        return match (request.method().clone(), route) {
            (Method::POST, GrpcProxyRoute::Channels) => create_grpc_channel(std::mem::take(&mut request)).await,
            (Method::DELETE, GrpcProxyRoute::Channel { channel_id }) => delete_grpc_channel(channel_id).await,
            (Method::POST, GrpcProxyRoute::ChannelUnary { channel_id }) => {
                call_grpc_unary(channel_id, std::mem::take(&mut request)).await
            }
            (Method::POST, GrpcProxyRoute::ChannelStreams { channel_id }) => {
                start_grpc_server_stream(channel_id, std::mem::take(&mut request)).await
            }
            (Method::GET, GrpcProxyRoute::ChannelStream { channel_id, stream_id }) => {
                read_grpc_server_stream(channel_id, stream_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, GrpcProxyRoute::ChannelStream { channel_id, stream_id }) => {
                delete_grpc_server_stream(channel_id, stream_id, std::mem::take(&mut request)).await
            }
            _ => not_found(format!("cannot find handler for grpc proxy route={:?}, method={:?}", request.uri().path(), request.method())),
        };
    }

    Response::builder()
        .status(400)
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body(b"cannot find route for request path".to_vec())
        .unwrap()
}
