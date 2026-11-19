//! The labels of connections, and what kind of Hyper connection a connection is.

use serde_json::Value;

use super::params::string_field;
use super::{ConnectionParams, ConnectionState, ConnectorType};
use crate::hyper::local_cloud::{embedded_cloud_databases, LOCAL_CLOUD_DATABASE_ALIAS, LOCAL_CLOUD_DATABASE_PATH};

/// The protocol of the setup params of a Hyper connection, the embedded Hyper without one
fn hyper_protocol(connection: &ConnectionState) -> &str {
    connection.details().setup_params.as_ref().and_then(|params| string_field(params, "protocol")).unwrap_or("WASM")
}

/// Is the connection the embedded Hyper of the app? A connection of the embedded Hyper that attaches a database of the
/// clouds folder, the local cloud, is a connection of its own like one to a server.
pub fn is_hyper_wasm_connection(connection: &ConnectionState) -> bool {
    connection.connector_type() == ConnectorType::Hyper
        && hyper_protocol(connection) == "WASM"
        && embedded_cloud_databases(connection.details().setup_params.as_ref()).is_empty()
}

/// Is a connection a local cloud: a connection of the embedded Hyper that attaches the database of the local cloud?
pub fn is_local_cloud(params: &ConnectionParams) -> bool {
    params.connector == ConnectorType::Hyper
        && embedded_cloud_databases(Some(&params.params))
            .iter()
            .any(|database| database.path == LOCAL_CLOUD_DATABASE_PATH && database.alias == LOCAL_CLOUD_DATABASE_ALIAS)
}

/// Can a connection be a cloud? It has to keep the tables of DashQL: a Hyper server whose credentials the user enters,
/// Database.com, or the local cloud that keeps them in a database of the browser to try the cloud. The embedded Hyper
/// itself keeps its database only as long as the window, the credentials of a Hyper link live only in its tab, and
/// Salesforce Data Cloud and Trino don't write.
pub fn is_cloud_capable(params: &ConnectionParams) -> bool {
    match params.connector {
        ConnectorType::Dbcom => true,
        ConnectorType::Hyper => {
            matches!(string_field(&params.params, "protocol"), Some("V3_GRPC" | "V3_HTTP")) || is_local_cloud(params)
        }
        ConnectorType::SalesforceDataCloud | ConnectorType::Trino => false,
    }
}

/// Does a connection offer an operational overview?
pub fn supports_connection_overview(connection: &ConnectionState) -> bool {
    connection.connector_type() == ConnectorType::Hyper
}

/// The label of a connection: its name and the protocol it speaks
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionLabelParts {
    /// The name, e.g. `Hyper`, `Hyper #2` or the name the user gave the connection
    pub name: String,
    /// The name of the connector, e.g. `Hyper`
    pub connector: String,
    /// The protocol, e.g. `Wasm` or `Http`
    pub detail: String,
}

impl ConnectionLabelParts {
    /// The label as plain text, e.g. `Hyper #2 Wasm`
    pub fn text(&self) -> String {
        format!("{} {}", self.name, self.detail)
    }
}

/// The parts of the label of a connection. A connection is called by the name the user gave it, otherwise after its
/// connector, the ordinal tells it apart from other connections of the same connector.
pub fn connection_label_parts(connection: &ConnectionState, ordinal: Option<u32>) -> ConnectionLabelParts {
    let detail = connection.connector_type().connector().label_detail(connection.details().setup_params.as_ref());
    label_parts(connection.connector_type(), connection.name(), detail, ordinal)
}

/// The parts of the label of a connection of a connector, by the name the user gave it, the detail of its connector
/// and its ordinal
pub fn label_parts(connector: ConnectorType, name: Option<&str>, detail: &str, ordinal: Option<u32>) -> ConnectionLabelParts {
    let connector = connector.connector().display_name();
    let name = match (name, ordinal) {
        (Some(name), _) => name.to_string(),
        (None, Some(ordinal)) => format!("{connector} #{ordinal}"),
        (None, None) => connector.to_string(),
    };
    ConnectionLabelParts { name, connector: connector.to_string(), detail: detail.to_string() }
}

/// The label of a connection as plain text, e.g. `Hyper #2 Wasm`
pub fn connection_label(connection: &ConnectionState, ordinal: Option<u32>) -> String {
    connection_label_parts(connection, ordinal).text()
}

/// A label for connection params, e.g. while the connection isn't restored. It names the connector and the location
/// of the database that the params describe.
pub fn connection_params_label(params: &ConnectionParams) -> String {
    let connector = params.connector.connector();
    let name = connector.display_name();
    match connector.label_location(&params.params) {
        Some(location) => format!("{name} / {location}"),
        None => format!("{name} {}", connector.label_detail(Some(&params.params))),
    }
}

/// A label for the JSON of connection params, `Connection` for params of no connector
pub fn connection_params_label_of_value(params: &Value) -> String {
    let Value::Object(fields) = params else {
        return "Connection".to_string();
    };
    ConnectionParams::from_object(fields.clone())
        .map_or_else(|_| "Connection".to_string(), |params| connection_params_label(&params))
}
