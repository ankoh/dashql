//! The labels of connections, and what kind of Hyper connection a connection is.

use super::params::string_field;
use super::{ConnectionParams, ConnectionState, ConnectorType};
use crate::hyper::local_cloud::embedded_cloud_databases;

impl ConnectorType {
    /// The long display name of the connector, e.g. `Salesforce Data Cloud`
    pub fn display_name(self) -> &'static str {
        match self {
            ConnectorType::Hyper => "Hyper",
            ConnectorType::SalesforceDataCloud => "Salesforce Data Cloud",
            ConnectorType::Trino => "Trino",
            ConnectorType::Dbcom => "Database.com",
        }
    }
}

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

/// The protocol of a Hyper connection as the label shows it
fn protocol_label(protocol: &str) -> &'static str {
    match protocol {
        "V3_GRPC" => "gRPC",
        "V3_HTTP" => "Http",
        "V3_HTTP_LINK" => "Link",
        _ => "Wasm",
    }
}

/// The parts of the label of a connection. A connection is called by the name the user gave it, otherwise after its
/// connector, the ordinal tells it apart from other connections of the same connector.
pub fn connection_label_parts(connection: &ConnectionState, ordinal: Option<u32>) -> ConnectionLabelParts {
    let detail = match connection.connector_type() {
        ConnectorType::Hyper => protocol_label(hyper_protocol(connection)),
        _ => "Http",
    };
    let connector = connection.connector_type().display_name();
    let name = match (connection.name(), ordinal) {
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
    let name = params.connector.display_name();
    let field = |key: &str| string_field(&params.params, key).unwrap_or("");
    match params.connector {
        ConnectorType::Hyper => match string_field(&params.params, "protocol").unwrap_or("WASM") {
            "WASM" => format!("{name} Wasm"),
            _ => format!("{name} / {}", field("endpoint")),
        },
        ConnectorType::Trino => format!("{name} / {}", field("endpoint")),
        ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => format!("{name} / {}", field("instanceUrl")),
    }
}

/// A label for the JSON of connection params, `Connection` for params of no connector
pub fn connection_params_label_of_json(params: &str) -> String {
    ConnectionParams::from_json(params)
        .map_or_else(|_| "Connection".to_string(), |params| connection_params_label(&params))
}
