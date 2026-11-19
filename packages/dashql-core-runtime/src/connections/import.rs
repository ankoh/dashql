//! The connections of a workbook file: the details of a connection as the file stores them, and the restored
//! connection.

use dashql_core::error::{Error, Result};
use serde_json::Value;

use super::{ConnectionDetails, ConnectionParams, ConnectorType, JsonObject};

/// The connectors in the order that the field of a stored connection is matched against them
const IMPORT_ORDER: [ConnectorType; 4] =
    [ConnectorType::SalesforceDataCloud, ConnectorType::Dbcom, ConnectorType::Hyper, ConnectorType::Trino];

/// Read the details of a connection as a workbook file stores them: an object with one field named after the
/// connector. The field holds the flat params of the connector, or details that carry them as `setupParams`. Only the
/// setup params are read, a restored connection starts its setup anew.
pub fn decode_connection(connection: &Value, workbook_id: &str) -> Result<(ConnectorType, ConnectionDetails)> {
    let unsupported =
        || Error::invalid_argument(format!("unsupported connection details of the workbook {workbook_id}"));
    let fields = connection.as_object().ok_or_else(unsupported)?;
    let (connector, value) = IMPORT_ORDER
        .iter()
        .find_map(|connector| fields.get(connector.connector().params_key()).map(|value| (*connector, value)))
        .ok_or_else(unsupported)?;
    // Details carry their params, storage persists the flat params
    let params: JsonObject = match value.get("setupParams") {
        Some(Value::Object(params)) => params.clone(),
        _ => value.as_object().cloned().unwrap_or_default(),
    };
    Ok((connector, ConnectionDetails::new(&ConnectionParams::new(connector, params))))
}
