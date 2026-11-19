//! The connectors of the runtime. What a connector decides on its own is a method of `Connector`, implemented once per
//! connector in the module of the connector (`hyper::connector`, `trino::connector`, `salesforce::connector`), and
//! `ConnectorType::connector` finds the implementation. Generic code asks the connector instead of matching on the
//! connector type.
//!
//! The methods need no host. What talks to a backend is sans-IO: the update of a catalog asks the catalog loader for
//! queries, a fresh channel and HTTP requests (`catalog_update`). The setups and the queries stay in the modules of the
//! connectors behind their own host traits, see docs/design/dashql_core.md.

use serde_json::Value;

use super::details::{CatalogNameDefaults, ConnectionDetails, Timestamp};
use super::params::{ConnectorFeatures, ConnectorType, JsonObject};
use super::RelationName;
use crate::catalog_loader::{CatalogEntries, ConnectorCatalogUpdate};

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

    /// The params as a link or a file shares them: without the secrets, the login hint only `with_login_hint`, and
    /// without the rows of a draft. The identity of the database (endpoints, instance URLs, consumer keys) stays.
    fn shared_params(&self, params: &JsonObject, with_login_hint: bool) -> JsonObject;

    /// The login hint of the params, e.g. the user that logs in, none if there is none
    fn login_hint(&self, _params: &JsonObject) -> Option<String> {
        None
    }

    /// The protocol that the label of a connection shows, by the params of its setup, e.g. `Http`
    fn label_detail(&self, _setup_params: Option<&JsonObject>) -> &'static str {
        "Http"
    }

    /// Where the database of params is as a label shows it after the name of the connector, e.g. an endpoint. None
    /// for a database that the protocol names, e.g. the embedded Hyper: the label shows the protocol then.
    fn label_location(&self, params: &JsonObject) -> Option<String>;

    /// The database and schema of the relations that unqualified statements create or drop, by the params of the
    /// setup. They match the names that the catalog loader gives the relations of the connection.
    fn catalog_name_defaults(&self, setup_params: Option<&JsonObject>) -> CatalogNameDefaults;

    /// Start an update of the catalog of a connection: all of it, or the relations of executed statements
    fn catalog_update(
        &self,
        details: &ConnectionDetails,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Box<dyn ConnectorCatalogUpdate>;

    /// The params that identify the results of queries, the key of the query result cache depends on them
    fn cache_signature(&self, params: &JsonObject) -> Value;

    /// Add what the results of a connection depend on beyond its params, e.g. the account of a login, to the signature
    /// of its params. None while that is unknown: the results get no reusable key then.
    fn sign_login(&self, _signature: &mut Value, _setup_params: &JsonObject, _details: &ConnectionDetails) -> Option<()> {
        Some(())
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
