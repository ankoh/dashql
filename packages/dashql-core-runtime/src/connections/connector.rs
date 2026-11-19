//! The connectors of the runtime. What a connector decides on its own is a method of `Connector`, implemented once per
//! connector in the module of the connector (`hyper::connector`, `trino::connector`, `salesforce::connector`), and
//! `ConnectorType::connector` finds the implementation. Generic code asks the connector instead of matching on the
//! connector type.
//!
//! The methods here are the decisions that need no host: names, params, features, probes and limits. The steps that
//! talk to a backend (setups, queries, catalog updates) stay in the modules of the connectors behind their own host
//! traits, see docs/design/dashql_core.md.

use super::params::{ConnectorFeatures, ConnectorType, JsonObject};

/// A connector of the runtime
pub trait Connector: Sync {
    /// The type of the connector
    fn connector_type(&self) -> ConnectorType;

    /// The field of the connection params that holds the params of the connector
    fn params_key(&self) -> &'static str;

    /// The long display name, e.g. `Salesforce Data Cloud`
    fn display_name(&self) -> &'static str;

    /// What the connector supports
    fn features(&self) -> ConnectorFeatures;

    /// The params of a new connection
    fn default_params(&self) -> JsonObject;

    /// Do the params of a form of the connector keep its raw rows (`draftRows`)? They belong to the local draft only,
    /// the params that a connection saves leave them out.
    fn has_draft_rows(&self) -> bool {
        false
    }

    /// The query of the health check of a connection
    fn health_probe(&self) -> &'static str {
        "select 1 as healthy"
    }

    /// The queries that a connection runs at the same time, by the params of its setup. A catalog update waits for
    /// room for another one, a run runs this many statements at once.
    fn max_concurrent_queries(&self, _setup_params: Option<&JsonObject>) -> usize {
        1
    }

    /// Does the catalog of a connection outlive the app? Then it is written and restored with the connection.
    fn catalog_is_durable(&self, _params: &JsonObject) -> bool {
        true
    }
}

impl ConnectorType {
    /// The implementation of the connector
    pub fn connector(self) -> &'static dyn Connector {
        match self {
            ConnectorType::Hyper => &crate::hyper::connector::HYPER,
            ConnectorType::Trino => &crate::trino::connector::TRINO,
            ConnectorType::SalesforceDataCloud => &crate::salesforce::connector::SALESFORCE_DATA_CLOUD,
            ConnectorType::Dbcom => &crate::salesforce::connector::DBCOM,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::CONNECTOR_TYPES;

    #[test]
    fn every_connector_answers_for_its_type_with_a_key_and_a_name_of_its_own() {
        let connectors: Vec<&dyn Connector> = CONNECTOR_TYPES.iter().map(|connector| connector.connector()).collect();
        for (connector_type, connector) in CONNECTOR_TYPES.iter().zip(&connectors) {
            assert_eq!(connector.connector_type(), *connector_type);
        }
        let mut keys: Vec<&str> = connectors.iter().map(|connector| connector.params_key()).collect();
        let mut names: Vec<&str> = connectors.iter().map(|connector| connector.display_name()).collect();
        keys.sort_unstable();
        keys.dedup();
        names.sort_unstable();
        names.dedup();
        assert_eq!((keys.len(), names.len()), (CONNECTOR_TYPES.len(), CONNECTOR_TYPES.len()));
    }
}
