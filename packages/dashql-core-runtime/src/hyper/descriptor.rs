//! What the descriptor of the Hyper connector says about params that `connections` doesn't port yet: the signature
//! of the query result cache and whether a connection reads the attachments of a workbook. The params to share are
//! `workbook_format::sharing`.

use serde_json::{json, Map, Value};

use crate::connections::{ConnectionDetails, ConnectorType, JsonObject};

/// The params that identify the results of a query in the query result cache. The metadata stays out, its headers may
/// carry credentials that change with every token. The query parameters are session settings that may change the
/// results. The JSON text of the value is the one of the TypeScript.
pub fn cache_signature(params: &JsonObject) -> Value {
    let mut signature = Map::new();
    signature.insert("case".to_string(), json!("hyper"));
    if let Some(protocol) = params.get("protocol") {
        signature.insert("protocol".to_string(), protocol.clone());
    }
    let mut channel_args = Map::new();
    for key in ["endpoint", "tls"] {
        if let Some(value) = params.get(key) {
            channel_args.insert(key.to_string(), value.clone());
        }
    }
    signature.insert("channelArgs".to_string(), Value::Object(channel_args));

    let mut databases: Vec<(String, Value)> = params
        .get("attachedDatabases")
        .and_then(Value::as_array)
        .map(|databases| {
            databases
                .iter()
                .map(|database| {
                    let mut entry = Map::new();
                    for key in ["path", "alias"] {
                        if let Some(value) = database.get(key) {
                            entry.insert(key.to_string(), value.clone());
                        }
                    }
                    let path = database.get("path").and_then(Value::as_str).unwrap_or_default().to_string();
                    (path, Value::Object(entry))
                })
                .collect()
        })
        .unwrap_or_default();
    databases.sort_by(|(a, _), (b, _)| a.cmp(b));
    signature
        .insert("attachedDatabases".to_string(), Value::Array(databases.into_iter().map(|(_, entry)| entry).collect()));

    let mut parameters: Vec<(&String, &Value)> = params
        .get("queryParameters")
        .and_then(Value::as_object)
        .map(|parameters| parameters.iter().collect())
        .unwrap_or_default();
    parameters.sort_by(|(a, _), (b, _)| a.cmp(b));
    signature.insert(
        "queryParameters".to_string(),
        Value::Array(parameters.into_iter().map(|(key, value)| json!([key, value])).collect()),
    );
    Value::Object(signature)
}

/// Does a connection read the attachments of a workbook? The embedded Hyper reads them from OPFS.
pub fn reads_attachments(details: &ConnectionDetails) -> bool {
    details.connector_type() == ConnectorType::Hyper
        && details.setup_params.as_ref().and_then(|params| params.get("protocol")).and_then(Value::as_str)
            == Some("WASM")
}
