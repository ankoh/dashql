//! The links that point the app at a Hyper, e.g. the hyperd of `hyperd run --ui`.
//!
//! A link names the endpoint of the HTTP API and a bearer token. The connection keeps the endpoint, the token stays in
//! the storage of the tab and only the channel adds it. Reading and writing that storage, asking the user and
//! allocating connections stay with the host.
//!
//! Ported from `packages/dashql-runtime/src/connections/hyper/hyper_link.ts` and
//! `packages/dashql-runtime/src/platform/events/hyper_link_target.ts`.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::http::Url;
use crate::connections::{ConnectionParams, ConnectionState, ConnectorType, JsonObject};

/// The session storage key of the tokens of the Hyper links of a tab
pub const HYPER_LINKS_STORAGE_KEY: &str = "dashql.hyper_links";

/// The hosts of this machine
const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/// The Hyper that a link points the app at
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperLinkTarget {
    /// The origin of the HTTP API of the Hyper
    pub endpoint: String,
    /// The bearer token of the Hyper
    pub token: String,
}

/// Parse the target of a link, none unless it names an endpoint and a token. An endpoint on this machine may speak
/// http, any other endpoint must speak https.
pub fn parse_hyper_link_target(endpoint: Option<&str>, token: Option<&str>) -> Option<HyperLinkTarget> {
    let token = token.filter(|token| !token.is_empty())?;
    let url = Url::parse_with_authority(endpoint?).ok()?;
    let loopback = LOOPBACK_HOSTS.contains(&url.host());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return None;
    }
    Some(HyperLinkTarget { endpoint: url.origin(), token: token.to_string() })
}

/// Does a link point at a Hyper on this machine?
pub fn is_loopback_hyper_link(target: &HyperLinkTarget) -> bool {
    Url::parse_with_authority(&target.endpoint).is_ok_and(|url| LOOPBACK_HOSTS.contains(&url.host()))
}

/// The question to confirm a link before the app uses it, none for a link to this machine. A link to another machine
/// would receive the queries of the new workbooks, the user confirms its host first.
pub fn hyper_link_confirmation(target: &HyperLinkTarget) -> Option<String> {
    if is_loopback_hyper_link(target) {
        return None;
    }
    Some(format!(
        "Run new workbooks on the Hyper at {}? Only continue if you trust the link that opened DashQL.",
        target.endpoint
    ))
}

/// The params of the channel to the Hyper of a link: its HTTP API with the token of the link
pub fn hyper_link_channel_params(params: &JsonObject, token: &str) -> JsonObject {
    let mut channel = params.clone();
    channel.insert("protocol".to_string(), json!("V3_HTTP"));
    let mut metadata = JsonObject::new();
    metadata.insert("x-hyperdb-workload".to_string(), json!("dashql"));
    if let Some(Value::Object(own)) = params.get("metadata") {
        for (name, value) in own {
            metadata.insert(name.clone(), value.clone());
        }
    }
    metadata.insert("authorization".to_string(), json!(format!("Bearer {token}")));
    channel.insert("metadata".to_string(), Value::Object(metadata));
    channel
}

/// Does a connection speak to the Hyper of a link?
pub fn is_hyper_link_params(params: &ConnectionParams) -> bool {
    params.connector == ConnectorType::Hyper
        && params.params.get("protocol").and_then(Value::as_str) == Some("V3_HTTP_LINK")
}

/// The params of a new connection to the Hyper of a link, its token is never stored
pub fn create_hyper_link_connection_params(endpoint: &str) -> ConnectionParams {
    let params = json!({
        "protocol": "V3_HTTP_LINK",
        "endpoint": endpoint,
        "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" },
    });
    ConnectionParams::new(ConnectorType::Hyper, params.as_object().cloned().unwrap_or_default())
}

/// The Hyper links of a tab
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HyperLinkTabState {
    /// The tokens of the connections to the Hyper of a link by connection id, never stored durably
    pub tokens: BTreeMap<String, String>,
    /// The connection of the latest link, new workbooks start on it
    pub current: Option<String>,
}

impl HyperLinkTabState {
    /// Read the links of a tab from the storage of the tab, none or broken JSON are no links
    pub fn read(stored: Option<&str>) -> Self {
        let Some(Value::Object(parsed)) = stored.and_then(|text| serde_json::from_str::<Value>(text).ok()) else {
            return Self::default();
        };
        let tokens = parsed
            .get("tokens")
            .and_then(Value::as_object)
            .map(|tokens| {
                tokens
                    .iter()
                    .filter_map(|(id, token)| token.as_str().map(|token| (id.clone(), token.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        let current = parsed.get("current").and_then(Value::as_str).map(str::to_string);
        Self { tokens, current }
    }

    /// The links with the token of the connection that a link was bound to, new workbooks start on the connection
    pub fn with_token(&self, connection_id: &str, token: &str) -> Self {
        let mut tokens = self.tokens.clone();
        tokens.insert(connection_id.to_string(), token.to_string());
        Self { tokens, current: Some(connection_id.to_string()) }
    }

    /// The links as the JSON of the storage of the tab
    pub fn to_json(&self) -> String {
        json!({ "tokens": self.tokens, "current": self.current }).to_string()
    }
}

/// The connection that a link is bound to
#[derive(Debug, Clone, PartialEq)]
pub enum HyperLinkBinding {
    /// A connection speaks to the endpoint of the link already
    Existing { connection_id: String },
    /// The user may reuse the connection of an earlier link, e.g. of an earlier run of hyperd on another port. It
    /// then moves to the endpoint of the link with the params. Declining creates a connection with `create`.
    AskToReuse { connection_id: String, params: ConnectionParams, create: ConnectionParams },
    /// Create an active connection with the params
    Create { params: ConnectionParams },
}

impl HyperLinkBinding {
    /// The binding once the user answered whether to reuse the connection of an earlier link
    pub fn answer(self, reuse: bool) -> HyperLinkBinding {
        match self {
            HyperLinkBinding::AskToReuse { create, .. } if !reuse => HyperLinkBinding::Create { params: create },
            binding => binding,
        }
    }
}

/// Bind a link to a connection. A connection to the endpoint of the link is reused. Otherwise the user may reuse the
/// connection of the recent or latest link. Declining creates a new connection, so the app can speak to several
/// Hyper of links at once.
pub fn bind_hyper_link<'a>(
    target: &HyperLinkTarget,
    connections: impl IntoIterator<Item = &'a ConnectionState>,
    recent_connection_id: Option<&str>,
) -> HyperLinkBinding {
    let linked: Vec<&ConnectionState> = connections.into_iter().filter(|c| is_hyper_link_params(c.params())).collect();
    let endpoint_of = |connection: &ConnectionState| {
        connection.params().params.get("endpoint").and_then(Value::as_str).map(str::to_string)
    };
    if let Some(same) = linked.iter().copied().find(|c| endpoint_of(c).as_deref() == Some(target.endpoint.as_str())) {
        return HyperLinkBinding::Existing { connection_id: same.connection_id().to_string() };
    }
    let create = create_hyper_link_connection_params(&target.endpoint);
    let recent = linked.iter().find(|c| Some(c.connection_id()) == recent_connection_id).or_else(|| linked.last());
    match recent {
        Some(recent) => {
            let mut params = recent.params().params.clone();
            params.insert("endpoint".to_string(), json!(target.endpoint));
            HyperLinkBinding::AskToReuse {
                connection_id: recent.connection_id().to_string(),
                params: ConnectionParams::new(ConnectorType::Hyper, params),
                create,
            }
        }
        None => HyperLinkBinding::Create { params: create },
    }
}
