//! Connection params that leave the app: the secrets stripped for sharing, and the comparison of params that ignores
//! what sharing strips.
//!
//! The params are JSON in the shape of the workbook file, e.g. `{"trino": {...}}`.

use serde_json::Value;

use crate::connections::{ConnectorType, JsonObject, CONNECTOR_TYPES};

/// The connector of params as the connector descriptors match them: the first of `hyper`, `salesforce`, `trino` and
/// `dbcom` that the params have
pub fn descriptor_of_params(params: &Value) -> Option<ConnectorType> {
    let object = params.as_object()?;
    CONNECTOR_TYPES.into_iter().find(|connector| object.contains_key(connector.connector().params_key()))
}

/// An object without some keys, the other keys keep their order
pub(crate) fn without(object: &JsonObject, keys: &[&str]) -> JsonObject {
    object.iter().filter(|(key, _)| !keys.contains(&key.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// Strip the secrets from connection params before they are shared in a link or a file. The identity (instance URLs,
/// consumer keys, user names) stays, the login hint only `with_login_hint`. Raw form rows of drafts are dropped.
/// Params of an unknown connector are returned as they are.
pub fn sanitize_connection_params_for_sharing(params: &Value, with_login_hint: bool) -> Value {
    let Some(connector) = descriptor_of_params(params) else {
        return params.clone();
    };
    let key = connector.connector().params_key();
    let inner = params.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
    let sanitized = connector.connector().shared_params(&inner, with_login_hint);
    let mut out = JsonObject::new();
    out.insert(key.to_string(), Value::Object(sanitized));
    Value::Object(out)
}

/// Is a value an empty list or an empty map?
fn is_empty_collection(value: &Value) -> bool {
    match value {
        Value::Array(list) => list.is_empty(),
        Value::Object(object) => object.is_empty(),
        _ => false,
    }
}

/// The value without the empty lists and maps of objects, they count as absent
fn without_empty_collections(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object.iter().filter(|(_, v)| !is_empty_collection(v)).map(|(k, v)| (k.clone(), without_empty_collections(v))).collect(),
        ),
        Value::Array(list) => Value::Array(list.iter().map(without_empty_collections).collect()),
        other => other.clone(),
    }
}

/// Are two params the same, regardless of the order of their keys?
pub fn connection_params_equal(left: &Value, right: &Value) -> bool {
    left == right
}

/// Do two params describe the same connection, ignoring everything that sharing strips? Empty lists and maps count as
/// absent: default params leave them out, params of a form or a workbook file carry them empty.
pub fn connection_params_share_equal(left: &Value, right: &Value) -> bool {
    let key = |params: &Value| {
        let sanitized = sanitize_connection_params_for_sharing(params, false);
        if is_empty_collection(&sanitized) { Value::Null } else { without_empty_collections(&sanitized) }
    };
    key(left) == key(right)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_secrets() {
        let trino = json!({ "trino": { "endpoint": "https://trino", "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": "s" } }, "metadata": { "h": "v" } } });
        assert_eq!(
            sanitize_connection_params_for_sharing(&trino, false),
            json!({ "trino": { "endpoint": "https://trino", "auth": { "authType": "AUTH_BASIC", "basic": { "username": "", "secret": "" } } } })
        );
        let hyper = json!({ "hyper": { "protocol": "V3_HTTP", "metadata": { "a": "b" }, "queryParameters": { "x": "y" }, "draftRows": {} } });
        assert_eq!(
            sanitize_connection_params_for_sharing(&hyper, true),
            json!({ "hyper": { "protocol": "V3_HTTP", "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" } } })
        );
        let salesforce = json!({ "salesforce": { "instanceUrl": "u", "appConsumerSecret": "s", "login": "me" } });
        assert_eq!(sanitize_connection_params_for_sharing(&salesforce, true), json!({ "salesforce": { "instanceUrl": "u", "appConsumerSecret": "", "login": "me" } }));
        assert!(connection_params_share_equal(&trino, &sanitize_connection_params_for_sharing(&trino, true)));
        assert!(connection_params_share_equal(
            &json!({ "hyper": { "protocol": "WASM", "attachedDatabases": [] } }),
            &json!({ "hyper": { "protocol": "WASM" } })
        ));
    }
}
