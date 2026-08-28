use http::header::CONTENT_TYPE;
use http::{Method, Request, Response};

use crate::docker_proxy_globals::{
    create_container as docker_create_container, delete_container as docker_delete_container,
    delete_log_stream as docker_delete_log_stream, list_containers as docker_list_containers,
    list_registry_tags as docker_list_registry_tags, read_log_stream as docker_read_log_stream,
    start_container as docker_start_container, start_log_stream as docker_start_log_stream,
    start_pull_stream as docker_start_pull_stream, stop_container as docker_stop_container,
};
use crate::docker_proxy_routes::{parse_docker_proxy_path, DockerProxyRoute};
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

    if let Some(route) = parse_docker_proxy_path(request.uri().path()) {
        return match (request.method().clone(), route) {
            (Method::GET, DockerProxyRoute::Containers) => docker_list_containers(std::mem::take(&mut request)).await,
            (Method::POST, DockerProxyRoute::Containers) => docker_create_container(std::mem::take(&mut request)).await,
            (Method::DELETE, DockerProxyRoute::Container { id }) => docker_delete_container(id, std::mem::take(&mut request)).await,
            (Method::POST, DockerProxyRoute::ContainerStart { id }) => docker_start_container(id, std::mem::take(&mut request)).await,
            (Method::POST, DockerProxyRoute::ContainerStop { id }) => docker_stop_container(id, std::mem::take(&mut request)).await,
            (Method::POST, DockerProxyRoute::ImagesPull) => docker_start_pull_stream(std::mem::take(&mut request)).await,
            (Method::POST, DockerProxyRoute::LogStreams) => docker_start_log_stream(std::mem::take(&mut request)).await,
            (Method::GET, DockerProxyRoute::LogStream { stream_id }) => {
                docker_read_log_stream(stream_id, std::mem::take(&mut request)).await
            }
            (Method::DELETE, DockerProxyRoute::LogStream { stream_id }) => {
                docker_delete_log_stream(stream_id, std::mem::take(&mut request)).await
            }
            (Method::GET, DockerProxyRoute::RegistryTags) => docker_list_registry_tags(std::mem::take(&mut request)).await,
            _ => not_found(format!("cannot find handler for docker proxy route={:?}, method={:?}", request.uri().path(), request.method())),
        };
    }

    Response::builder()
        .status(400)
        .header(CONTENT_TYPE, mime::TEXT_PLAIN.essence_str())
        .body(b"cannot find route for request path".to_vec())
        .unwrap()
}
