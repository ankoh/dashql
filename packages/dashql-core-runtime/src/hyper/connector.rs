//! The Hyper connector: the embedded Hyper of the platform (protocol `WASM`) and Hyper servers over HTTP, gRPC or a
//! link, see `connections::connector`.

use serde_json::{json, Value};

use crate::connections::connector::Connector;
use crate::connections::{object, ConnectorFeatures, ConnectorType, JsonObject};

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
}
