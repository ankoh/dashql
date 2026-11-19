//! The Hyper connector: the embedded Hyper of the platform (protocol `WASM`) and Hyper servers over HTTP, gRPC or a
//! link, see `connections::connector`.

use serde_json::{json, Value};

use crate::catalog_loader::hyper::HyperCatalogUpdate;
use crate::catalog_loader::{CatalogEntries, ConnectorCatalogUpdate};
use crate::connections::connector::Connector;
use crate::connections::sharing::without;
use crate::connections::{
    Timestamp, RelationName, object, CatalogNameDefaults, ConnectionChannel, ConnectionDetails, ConnectionParams, ConnectorFeatures, ConnectorType, JsonObject,
    DEFAULT_DATABASE_NAME, HYPER_DEFAULT_SCHEMA,
};
use crate::hyper::link::{hyper_link_token_fingerprint, is_hyper_link_params};

/// The protocol of the embedded Hyper
pub const EMBEDDED_PROTOCOL: &str = "WASM";

/// The Hyper connector
pub struct HyperConnector;

/// The Hyper connector of the runtime
pub static HYPER: HyperConnector = HyperConnector;

/// Do params name a Hyper server rather than the embedded Hyper? Params without a protocol are the embedded Hyper.
fn is_server(params: Option<&JsonObject>) -> bool {
    params.and_then(|params| params.get("protocol")).and_then(Value::as_str).is_some_and(|protocol| protocol != EMBEDDED_PROTOCOL)
}

impl Connector for HyperConnector {
    fn connector_type(&self) -> ConnectorType {
        ConnectorType::Hyper
    }

    fn params_key(&self) -> &'static str {
        "hyper"
    }

    fn display_name(&self) -> &'static str {
        "Hyper"
    }

    fn features(&self) -> ConnectorFeatures {
        ConnectorFeatures { query_result_caching: false, read_only: false }
    }

    fn default_params(&self) -> JsonObject {
        object(json!({
            "protocol": EMBEDDED_PROTOCOL,
            "endpoint": "",
            "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" },
        }))
    }

    fn has_draft_rows(&self) -> bool {
        true
    }

    /// A Hyper server runs four queries at once, the embedded Hyper one
    fn max_concurrent_queries(&self, setup_params: Option<&JsonObject>) -> usize {
        if is_server(setup_params) {
            4
        } else {
            1
        }
    }

    /// The embedded Hyper starts with a new database, its catalog is neither written nor restored
    fn catalog_is_durable(&self, params: &JsonObject) -> bool {
        params.get("protocol").and_then(Value::as_str) != Some(EMBEDDED_PROTOCOL)
    }

    /// Arbitrary headers and query parameters may carry credentials under any name, they go with the paths of TLS
    fn shared_params(&self, params: &JsonObject, _with_login_hint: bool) -> JsonObject {
        let mut hyper = without(params, &["draftRows", "metadata", "queryParameters"]);
        hyper.insert("tls".into(), json!({ "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" }));
        hyper
    }

    fn label_detail(&self, setup_params: Option<&JsonObject>) -> &'static str {
        match setup_params.and_then(|params| params.get("protocol")).and_then(Value::as_str).unwrap_or(EMBEDDED_PROTOCOL) {
            "V3_GRPC" => "gRPC",
            "V3_HTTP" => "Http",
            "V3_HTTP_LINK" => "Link",
            _ => "Wasm",
        }
    }

    /// The endpoint of a server, none for the embedded Hyper
    fn label_location(&self, params: &JsonObject) -> Option<String> {
        is_server(Some(params)).then(|| params.get("endpoint").and_then(Value::as_str).unwrap_or("").to_string())
    }

    /// Unqualified names resolve against the first attached database
    fn catalog_name_defaults(&self, setup_params: Option<&JsonObject>) -> CatalogNameDefaults {
        let attached = setup_params.and_then(|params| params.get("attachedDatabases"));
        let first = attached.and_then(Value::as_array).and_then(|attached| attached.first());
        let database_name = match first {
            Some(first) => first.get("alias").and_then(Value::as_str).unwrap_or(""),
            None => DEFAULT_DATABASE_NAME,
        };
        CatalogNameDefaults { database_name: database_name.to_string(), schema_name: HYPER_DEFAULT_SCHEMA.to_string() }
    }

    fn catalog_update(
        &self,
        details: &ConnectionDetails,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Box<dyn ConnectorCatalogUpdate> {
        let setup_params = details.setup_params.clone().unwrap_or_default();
        Box::new(HyperCatalogUpdate::of_hyper(&setup_params, entries, relations, now))
    }

    fn cache_signature(&self, params: &JsonObject) -> Value {
        crate::hyper::descriptor::cache_signature(params)
    }

    /// The results of the Hyper of a link are keyed by the fingerprint of the token of the link, another Hyper on the
    /// same port never serves them
    fn sign_login(&self, signature: &mut Value, setup_params: &JsonObject, details: &ConnectionDetails) -> Option<()> {
        if is_hyper_link_params(&ConnectionParams::new(ConnectorType::Hyper, setup_params.clone())) {
            let ConnectionChannel::HyperHttp { auth, .. } = details.channel.as_ref()? else { return None };
            let token = auth.get("authorization")?;
            signature.as_object_mut()?.insert("link".to_string(), Value::String(hyper_link_token_fingerprint(token)));
        }
        Some(())
    }
}
