//! What the descriptor of the Hyper connector says about params: whether a connection reads the attachments of a
//! workbook. The params to share are `connections::sharing`.

use serde_json::Value;

use crate::connections::{ConnectionDetails, ConnectorType};

/// Does a connection read the attachments of a workbook? The embedded Hyper reads them from OPFS.
pub fn reads_attachments(details: &ConnectionDetails) -> bool {
    details.connector_type() == ConnectorType::Hyper
        && details.setup_params.as_ref().and_then(|params| params.get("protocol")).and_then(Value::as_str)
            == Some("WASM")
}
