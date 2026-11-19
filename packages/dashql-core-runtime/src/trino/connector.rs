//! The Trino connector, see `connections::connector`.

use serde_json::json;

use crate::connections::connector::Connector;
use crate::connections::{object, ConnectorFeatures, ConnectorType, JsonObject};

/// The Trino connector
pub struct TrinoConnector;

/// The Trino connector of the runtime
pub static TRINO: TrinoConnector = TrinoConnector;

impl Connector for TrinoConnector {
    fn connector_type(&self) -> ConnectorType {
        ConnectorType::Trino
    }

    fn params_key(&self) -> &'static str {
        "trino"
    }

    fn display_name(&self) -> &'static str {
        "Trino"
    }

    fn features(&self) -> ConnectorFeatures {
        ConnectorFeatures { query_result_caching: true, read_only: true }
    }

    fn default_params(&self) -> JsonObject {
        object(json!({ "endpoint": "", "catalogs": [], "auth": { "authType": "AUTH_BASIC" } }))
    }

    fn has_draft_rows(&self) -> bool {
        true
    }

    fn health_probe(&self) -> &'static str {
        "select 1"
    }
}
