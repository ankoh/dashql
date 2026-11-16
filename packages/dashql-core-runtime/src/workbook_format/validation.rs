//! The validation of a workbook file before it is restored.

use std::collections::HashSet;

use serde_json::Value;

use crate::connections::ConnectorType;
use crate::workbook_format::data::{WorkbookData, WORKBOOK_FORMAT_VERSION};
use crate::workbook_format::json::is_truthy;
use crate::workbook_format::layout::HYPER_CLOUDS_DIRECTORY;

/// Is a string a UUID of any version, in the canonical 8-4-4-4-12 hex shape? Case doesn't matter.
pub fn is_valid_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// Why a stored workbook was rejected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WorkbookValidationError {
    /// The workbook does not declare the current format version
    UnsupportedFormatVersion,
    /// The workbook has no `workbookId`, or it is empty
    MissingWorkbookId,
    /// The `workbookId` is not a UUID
    InvalidWorkbookId,
    /// The connection list is missing, empty or malformed
    InvalidConnections,
    /// A connection has no UUID `connectionId`, or the id is listed twice
    InvalidConnectionId,
    /// A connection has no `params`
    MissingConnectionParams,
    /// The params of a connection match no connector
    UnknownConnector,
    /// The workbook is registered but its files can't be read
    WorkbookUnreadable,
    /// The metadata is valid, but restoring the workbook failed
    WorkbookNotRestored,
}

impl WorkbookValidationError {
    /// Every error
    pub const ALL: [WorkbookValidationError; 9] = [
        Self::UnsupportedFormatVersion,
        Self::MissingWorkbookId,
        Self::InvalidWorkbookId,
        Self::InvalidConnections,
        Self::InvalidConnectionId,
        Self::MissingConnectionParams,
        Self::UnknownConnector,
        Self::WorkbookUnreadable,
        Self::WorkbookNotRestored,
    ];

    /// The code of the error, as the app names it
    pub fn code(self) -> &'static str {
        match self {
            Self::UnsupportedFormatVersion => "unsupported_format_version",
            Self::MissingWorkbookId => "missing_workbook_id",
            Self::InvalidWorkbookId => "invalid_workbook_id",
            Self::InvalidConnections => "invalid_connections",
            Self::InvalidConnectionId => "invalid_connection_id",
            Self::MissingConnectionParams => "missing_connection_params",
            Self::UnknownConnector => "unknown_connector",
            Self::WorkbookUnreadable => "workbook_unreadable",
            Self::WorkbookNotRestored => "workbook_not_restored",
        }
    }

    /// A short explanation, shown in the workbook workbench
    pub fn describe(self) -> &'static str {
        match self {
            Self::UnsupportedFormatVersion => "Unsupported workbook format version",
            Self::MissingWorkbookId => "Missing workbook id",
            Self::InvalidWorkbookId => "Invalid workbook id",
            Self::InvalidConnections => "Workbook must list at least one connection",
            Self::InvalidConnectionId => "Invalid connection id",
            Self::MissingConnectionParams => "Missing connection parameters",
            Self::UnknownConnector => "Unknown connector",
            Self::WorkbookUnreadable => "Workbook files missing",
            Self::WorkbookNotRestored => "Workbook could not be loaded",
        }
    }
}

/// The connector of connection params, by the first key of `hyper`, `salesforce`, `dbcom` and `trino` that they have.
/// None for anything but an object with one of the keys.
pub fn connector_of_params(params: &Value) -> Option<ConnectorType> {
    let object = params.as_object()?;
    [ConnectorType::Hyper, ConnectorType::SalesforceDataCloud, ConnectorType::Dbcom, ConnectorType::Trino]
        .into_iter()
        .find(|connector| object.contains_key(connector.params_key()))
}

/// Validate the JSON of a workbook file before it is restored: the current format version, a workbook id that is a
/// UUID and at least one connection with a unique UUID and params of a known connector. A draft must be of the
/// connector of the params.
pub fn validate_workbook_json(data: &Value) -> Result<(), WorkbookValidationError> {
    let object = data.as_object();
    let field = |key: &str| object.and_then(|object| object.get(key));
    if field("formatVersion").and_then(Value::as_f64) != Some(WORKBOOK_FORMAT_VERSION as f64) {
        return Err(WorkbookValidationError::UnsupportedFormatVersion);
    }
    let workbook_id = field("workbookId");
    if !workbook_id.is_some_and(is_truthy) {
        return Err(WorkbookValidationError::MissingWorkbookId);
    }
    if !workbook_id.and_then(Value::as_str).is_some_and(is_valid_uuid) {
        return Err(WorkbookValidationError::InvalidWorkbookId);
    }
    let Some(connections) = field("connections").and_then(Value::as_array).filter(|list| !list.is_empty()) else {
        return Err(WorkbookValidationError::InvalidConnections);
    };
    let mut ids = HashSet::new();
    for connection in connections {
        let connection_id = connection.as_object().and_then(|c| c.get("connectionId")).and_then(Value::as_str);
        let Some(connection_id) = connection_id.filter(|id| is_valid_uuid(id) && !ids.contains(*id)) else {
            return Err(WorkbookValidationError::InvalidConnectionId);
        };
        ids.insert(connection_id);
        let params = connection.get("params").filter(|params| is_truthy(params));
        let Some(params) = params else {
            return Err(WorkbookValidationError::MissingConnectionParams);
        };
        let Some(connector) = connector_of_params(params) else {
            return Err(WorkbookValidationError::UnknownConnector);
        };
        if let Some(draft) = connection.get("paramsDraft").filter(|draft| !draft.is_null()) {
            if connector_of_params(draft) != Some(connector) {
                return Err(WorkbookValidationError::UnknownConnector);
            }
        }
    }
    Ok(())
}

/// Validate a workbook file, see `validate_workbook_json`
pub fn validate_workbook_data(data: &WorkbookData) -> Result<(), WorkbookValidationError> {
    validate_workbook_json(&data.to_json())
}

/// The databases of the clouds folder that params of the embedded Hyper attach, as (path, alias). A connection that
/// attaches one is a local cloud, a connection of its own.
pub fn embedded_cloud_databases(hyper: &Value) -> Vec<(String, String)> {
    let protocol = hyper.get("protocol").and_then(Value::as_str).unwrap_or("WASM");
    if hyper.get("protocol").is_some_and(|p| !p.is_null() && !p.is_string()) || protocol != "WASM" {
        return Vec::new();
    }
    let prefix = format!("{HYPER_CLOUDS_DIRECTORY}/");
    hyper
        .get("attachedDatabases")
        .and_then(Value::as_array)
        .map(|databases| {
            databases
                .iter()
                .filter_map(|database| {
                    let path = database.get("path")?.as_str()?;
                    let alias = database.get("alias")?.as_str()?;
                    (path.starts_with(&prefix) && !alias.is_empty()).then(|| (path.to_string(), alias.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Are the params those of the embedded Hyper of the app? A local cloud attaches a database of the clouds folder and
/// is a connection of its own.
pub fn is_local_hyper_wasm_params(params: &Value) -> bool {
    let Some(hyper) = params.as_object().and_then(|object| object.get("hyper")) else {
        return false;
    };
    let protocol = hyper.get("protocol").filter(|p| !p.is_null());
    protocol.is_none_or(|p| p.as_str() == Some("WASM")) && embedded_cloud_databases(hyper).is_empty()
}

/// A workbook that failed its validation and was refused a load. It holds what the workbench needs to show and delete
/// it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidWorkbook {
    /// The workbook id of the entry of the workbook tree, the key to delete the workbook with
    pub workbook_id: String,
    /// A title: the name, the display path or the id
    pub title: String,
    /// The connector of the first connection, if one could be inferred
    pub connector_type: Option<ConnectorType>,
    /// Why the workbook was rejected
    pub error: WorkbookValidationError,
}

/// Describe an invalid workbook of an entry of the workbook tree, with the workbook file if it could be read
pub fn describe_invalid_workbook(entry_path: &str, error: WorkbookValidationError, data: Option<&WorkbookData>) -> InvalidWorkbook {
    let title = data
        .and_then(|data| data.name.as_deref().filter(|name| !name.is_empty()).or(data.workbook_path.as_deref().filter(|p| !p.is_empty())))
        .unwrap_or(entry_path)
        .to_string();
    let connector_type = data.and_then(|data| data.connections.first()).and_then(|connection| connector_of_params(&connection.params));
    InvalidWorkbook { workbook_id: entry_path.to_string(), title, connector_type, error }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_uuids() {
        assert!(is_valid_uuid("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"));
        assert!(is_valid_uuid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"));
        assert!(!is_valid_uuid("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-extra"));
        assert!(!is_valid_uuid("not-a-uuid"));
        assert!(!is_valid_uuid(""));
    }
}
