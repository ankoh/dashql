use std::io::Write;
use std::str::FromStr;

use base64::Engine;
use byteorder::LittleEndian;
use byteorder::WriteBytesExt;
use http::HeaderMap;
use http::HeaderName;
use http::HeaderValue;
use http::Request;
use http::Response;
use tonic::metadata::KeyAndValueRef;
use tonic::metadata::MetadataMap;
use lazy_static::lazy_static;
use tracing::instrument;

use crate::grpc_proxy::GrpcProxy;
use crate::proxy_headers::HEADER_NAME_BATCH_BYTES;
use crate::proxy_headers::HEADER_NAME_BATCH_EVENT;
use crate::proxy_headers::HEADER_NAME_BATCH_MESSAGES;
use crate::proxy_headers::HEADER_NAME_CHANNEL_ID;
use crate::proxy_headers::HEADER_NAME_STREAM_ID;
use crate::proxy_headers::HEADER_PREFIX;

lazy_static! {
    static ref GRPC_PROXY: GrpcProxy = GrpcProxy::default();
}

#[instrument(skip(req))]
pub async fn create_grpc_channel(mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match GRPC_PROXY.create_channel(req.headers_mut()).await {
        Ok(channel_id) => {
            Response::builder()
                .status(200)
                .header("X-Custom-Foo", "bar")
                .header(HEADER_NAME_CHANNEL_ID, channel_id)
                .body(Vec::new())
                .unwrap()
        },
        Err(e) => Response::from(&e)
    }
}

pub async fn delete_grpc_channel(channel_id: usize) -> Response<Vec<u8>> {
    match GRPC_PROXY.destroy_channel(channel_id).await {
        Ok(()) => {
            let response = Response::builder()
                .status(200)
                .body(Vec::new())
                .unwrap();
            response
        },
        Err(e) => Response::from(&e)

    }
}

/// Copy the metadata or the trailers of a call into response headers.
/// The `dashql-` headers belong to the proxy, a server must not be able to replace them.
fn copy_metadata(metadata: &MetadataMap, headers: &mut HeaderMap) {
    for entry in metadata.iter() {
        match entry {
            KeyAndValueRef::Ascii(key, value) => {
                if key.as_str().starts_with(HEADER_PREFIX) {
                    continue;
                }
                let key = HeaderName::from_str(key.as_str());
                let value = HeaderValue::from_str(value.to_str().unwrap_or_default());
                if let (Ok(key), Ok(value)) = (key, value) {
                    headers.insert(key, value);
                }
            }
            // Binary metadata (e.g. `grpc-status-details-bin`) cannot be
            // put into an HTTP header verbatim. Forward it base64-encoded
            // under the same `-bin` key so the frontend can decode it.
            KeyAndValueRef::Binary(key, value) => {
                if key.as_str().starts_with(HEADER_PREFIX) {
                    continue;
                }
                let encoded = base64::engine::general_purpose::STANDARD
                    .encode(value.to_bytes().unwrap_or_default());
                let key = HeaderName::from_str(key.as_str());
                let value = HeaderValue::from_str(&encoded);
                if let (Ok(key), Ok(value)) = (key, value) {
                    headers.insert(key, value);
                }
            }
        }
    }
}

#[instrument(skip(req), fields(body_size))]
pub async fn call_grpc_unary(channel_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    tracing::Span::current().record("body_size", body.len());
    match GRPC_PROXY.call_unary(channel_id, req.headers_mut(), body).await {
        Ok((body, metadata)) => {
            let mut response = Response::builder()
                .status(200)
                .header(HEADER_NAME_CHANNEL_ID, channel_id)
                .body(body)
                .unwrap();
            copy_metadata(&metadata, response.headers_mut());
            response
        },
        Err(e) => Response::from(&e)
    }
}

#[instrument(skip(req))]
pub async fn start_grpc_server_stream(channel_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let body = std::mem::take(req.body_mut());
    match GRPC_PROXY.start_server_stream(channel_id, req.headers_mut(), body).await {
        Ok((stream_id, metadata)) => {
            let mut response = Response::builder()
                .status(200)
                .header(HEADER_NAME_CHANNEL_ID, channel_id)
                .header(HEADER_NAME_STREAM_ID, stream_id)
                .body(Vec::new())
                .unwrap();
            copy_metadata(&metadata, response.headers_mut());
            response
        },
        Err(e) => Response::from(&e)
    }
}

pub async fn read_grpc_server_stream(channel_id: usize, stream_id: usize, mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match GRPC_PROXY.read_server_stream(channel_id, stream_id, req.headers_mut()).await {
        Ok(batches) => {
            let mut buffer: Vec<u8> = Vec::with_capacity(batches.total_message_bytes + 4 * batches.messages.len());
            for message in batches.messages.iter() {
                buffer.write_u32::<LittleEndian>(message.len() as u32).unwrap();
                buffer.write(&message).unwrap();
            }
            let mut response = Response::builder()
                .status(200)
                .header(HEADER_NAME_CHANNEL_ID, channel_id)
                .header(HEADER_NAME_STREAM_ID, stream_id)
                .header(HEADER_NAME_BATCH_EVENT, batches.event.to_str())
                .header(HEADER_NAME_BATCH_MESSAGES, batches.messages.len())
                .header(HEADER_NAME_BATCH_BYTES, batches.total_message_bytes);
            if let Some(trailers) = batches.trailers {
                log::debug!("{:?}", trailers);
                copy_metadata(&trailers, response.headers_mut().unwrap());
            }
            response
                .body(buffer)
                .unwrap()
        },
        Err(e) => Response::from(&e)
    }
}

pub async fn delete_grpc_server_stream(channel_id: usize, stream_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match GRPC_PROXY.destroy_server_stream(channel_id, stream_id).await {
        Ok(()) => {
            Response::builder()
                .status(200)
                .header(HEADER_NAME_CHANNEL_ID, channel_id)
                .body(Vec::new())
                .unwrap()
        }
        Err(e) => Response::from(&e)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use tonic::metadata::{AsciiMetadataValue, BinaryMetadataValue};

    fn metadata() -> MetadataMap {
        let mut metadata = MetadataMap::new();
        metadata.insert("x-trace", AsciiMetadataValue::from_static("abc"));
        metadata.insert("dashql-batch-event", AsciiMetadataValue::from_static("StreamFinished"));
        metadata.insert_bin("grpc-status-details-bin", BinaryMetadataValue::from_bytes(&[0, 1, 255]));
        metadata.insert_bin("dashql-error-bin", BinaryMetadataValue::from_bytes(b"spoofed"));
        metadata
    }

    #[test]
    fn metadata_is_forwarded_and_binary_values_stay_base64() {
        let mut headers = HeaderMap::new();
        copy_metadata(&metadata(), &mut headers);
        assert_eq!(headers.get("x-trace").unwrap(), "abc");
        assert_eq!(headers.get("grpc-status-details-bin").unwrap(), "AAH/");
    }

    #[test]
    fn a_server_cannot_replace_headers_of_the_proxy() {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_NAME_BATCH_EVENT, HeaderValue::from_static("FlushAfterBytes"));
        copy_metadata(&metadata(), &mut headers);
        assert_eq!(headers.get(HEADER_NAME_BATCH_EVENT).unwrap(), "FlushAfterBytes");
        assert!(headers.get("dashql-error-bin").is_none());
    }
}
