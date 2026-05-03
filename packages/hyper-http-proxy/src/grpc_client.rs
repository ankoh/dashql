use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::Duration;

use http::{HeaderMap, Uri};
use tonic::metadata::{AsciiMetadataKey, AsciiMetadataValue, MetadataMap};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};

use crate::cors::is_hop_by_hop;
use crate::errors::HttpError;
use crate::proto::hyper::hyper_service_client::HyperServiceClient;
use crate::proto::hyper::QueryParam;

pub const DEFAULT_WORKLOAD: &str = "query-service-http-v3-proxy";

/// Endpoint override selected per-request.
pub const HEADER_GRPC_ENDPOINT: &str = "x-grpc-endpoint";

/// Lazily-built cache of tonic channels keyed by `scheme://authority`.
pub struct ChannelCache {
    channels: Mutex<HashMap<String, Channel>>,
}

impl ChannelCache {
    pub fn new() -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_or_build(&self, uri: &Uri) -> Result<Channel, HttpError> {
        let key = cache_key(uri);
        if let Some(existing) = self.channels.lock().unwrap().get(&key).cloned() {
            return Ok(existing);
        }

        let mut endpoint = Endpoint::from_shared(key.clone())
            .map_err(|e| HttpError::bad_request(format!("invalid grpc endpoint: {}", e)))?
            .keep_alive_while_idle(true)
            .http2_keep_alive_interval(Duration::from_secs(30));

        if uri.scheme_str() == Some("https") {
            let tls = ClientTlsConfig::new().with_enabled_roots();
            endpoint = endpoint
                .tls_config(tls)
                .map_err(|e| HttpError::internal(format!("tls config: {}", e)))?;
        }

        let channel = endpoint
            .connect()
            .await
            .map_err(|e| HttpError::internal(format!("connect {}: {}", key, e)))?;

        self.channels
            .lock()
            .unwrap()
            .insert(key, channel.clone());
        Ok(channel)
    }
}

impl Default for ChannelCache {
    fn default() -> Self {
        Self::new()
    }
}

fn cache_key(uri: &Uri) -> String {
    let scheme = uri.scheme_str().unwrap_or("https");
    let authority = uri
        .authority()
        .map(|a| a.as_str().to_string())
        .unwrap_or_default();
    format!("{}://{}", scheme, authority)
}

/// Copy inbound HTTP headers into outbound gRPC metadata, dropping headers
/// that would interfere with the downstream call (hop-by-hop, host, origin,
/// proxy-internal routing headers). If no workload header is present a sane
/// default is injected so requests land on the proxy-dedicated routing lane.
pub fn prepare_metadata(src: &HeaderMap, dst: &mut MetadataMap) {
    let mut saw_workload = false;
    for (name, value) in src.iter() {
        if is_hop_by_hop(name) {
            continue;
        }
        let key = name.as_str();
        if matches!(
            key,
            "host" | "origin" | "referer" | "accept" | HEADER_GRPC_ENDPOINT
        ) {
            continue;
        }
        if key == "x-hyperdb-workload" {
            saw_workload = true;
        }
        if let (Ok(v), Ok(k)) = (
            value.to_str(),
            AsciiMetadataKey::from_str(key),
        ) {
            if let Ok(mv) = AsciiMetadataValue::from_str(v) {
                dst.insert(k, mv);
            }
        }
    }
    if !saw_workload {
        if let Ok(v) = AsciiMetadataValue::from_str(DEFAULT_WORKLOAD) {
            dst.insert(
                AsciiMetadataKey::from_str("x-hyperdb-workload").unwrap(),
                v,
            );
        }
    }
}

/// Thin wrapper that opens the server-streaming `ExecuteQuery` RPC.
pub async fn execute_query(
    channel: Channel,
    metadata: MetadataMap,
    param: QueryParam,
) -> Result<tonic::codec::Streaming<crate::proto::hyper::QueryResult>, tonic::Status> {
    let mut client = HyperServiceClient::new(channel);
    let mut request = tonic::Request::new(param);
    *request.metadata_mut() = metadata;
    let response = client.execute_query(request).await?;
    Ok(response.into_inner())
}
