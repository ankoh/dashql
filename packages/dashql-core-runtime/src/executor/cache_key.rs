//! The key of a query result in the query result cache.
//!
//! A result is cached as a function of the params of its connection that identify its results (the signature of the
//! connector) and the versioned semantic signature of its script that the core emits. The analysis of a result runs
//! after the cache was read and is no part of the key. The key is the lowercase hex of the SHA-256 digest of
//! `result_key_input`; the platform computes the digest.

use serde_json::{Map, Value};

use crate::connections::{ConnectionChannel, ConnectionParams, ConnectionState, ConnectorType, JsonObject};
use crate::hyper::link::{hyper_link_token_fingerprint, is_hyper_link_params};

/// The params of a connection that identify the results of its queries, the params of the connector without the field
/// around them
pub fn params_cache_signature(connector: ConnectorType, params: &JsonObject) -> Value {
    match connector {
        ConnectorType::Hyper => crate::hyper::descriptor::cache_signature(params),
        ConnectorType::Trino => crate::trino::descriptor::cache_signature(params),
        ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => crate::salesforce::cache_signature(connector, params),
    }
}

/// What the cached results of a connection depend on, none if its results get no reusable key: before the connection
/// has the params of a setup, and while the login or the instance behind it is unknown. The results of a login are
/// keyed by its account: a Trino login with OAuth by the account of its token, a Salesforce login by the account of
/// its user info, never by a hint that the user typed. The results of the Hyper of a link are keyed by the fingerprint
/// of the token of the link, another Hyper on the same port never serves them.
pub fn connection_cache_signature(connection: &ConnectionState) -> Option<Value> {
    let connector = connection.connector_type();
    let details = connection.details();
    let params = details.setup_params.as_ref()?;
    let mut signature = params_cache_signature(connector, params);
    match connector {
        ConnectorType::Hyper => {
            if is_hyper_link_params(&ConnectionParams::new(connector, params.clone())) {
                let ConnectionChannel::HyperHttp { auth, .. } = details.channel.as_ref()? else { return None };
                let token = auth.get("authorization")?;
                signature.as_object_mut()?.insert("link".to_string(), Value::String(hyper_link_token_fingerprint(token)));
            }
        }
        ConnectorType::Trino => {
            let oauth = params.get("auth").and_then(|auth| auth.get("authType")).and_then(Value::as_str) == Some("AUTH_OAUTH");
            if oauth {
                let token = details.channel.as_ref().and_then(ConnectionChannel::trino).and_then(|trino| trino.access_token());
                let principal = token.and_then(|token| token.principal)?;
                let auth = signature.get_mut("auth").and_then(Value::as_object_mut)?;
                auth.insert("principal".to_string(), Value::String(principal));
            }
        }
        ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => {
            let principal = details.salesforce().and_then(|salesforce| salesforce.principal.clone())?;
            signature.as_object_mut()?.insert("login".to_string(), Value::String(principal));
        }
    }
    Some(signature)
}

/// A value with the keys of every object sorted, so that its JSON text doesn't depend on the order the fields were set
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort();
            let mut out = Map::new();
            for key in keys {
                if let Some(value) = object.get(key) {
                    out.insert(key.clone(), sorted(value));
                }
            }
            Value::Object(out)
        }
        Value::Array(values) => Value::Array(values.iter().map(sorted).collect()),
        value => value.clone(),
    }
}

/// The length of a text in UTF-16 code units, the length of a string of JavaScript
fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The text whose SHA-256 digest keys a result: the namespace of the keys, then the JSON text of the connection
/// signature with its keys sorted and the script signature, each after its length. The lengths count UTF-16 code
/// units, so that the keys of the files that the TypeScript runtime wrote stay valid.
pub fn result_key_input(connection_signature: &Value, script_signature: &str) -> String {
    let connection = sorted(connection_signature).to_string();
    format!(
        "dashql-query-cache-v3\n{}:{}{}:{}",
        utf16_len(&connection),
        connection,
        utf16_len(script_signature),
        script_signature
    )
}

/// The key of a result from the SHA-256 digest of its input, in lowercase hex
pub fn result_key_of_digest(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_the_input_of_the_typescript_runtime() {
        // The texts of `computeQueryResultCacheKey` of the TypeScript runtime for the same values. The login of a
        // Salesforce connection and the user of a Trino connection joined the signatures later.
        let trino = json!({
            "endpoint": "https://trino",
            "case": "trino",
            "defaults": { "schema": "sales", "catalog": "hive" },
            "auth": { "authType": "AUTH_BASIC" },
        });
        assert_eq!(
            result_key_input(&trino, "v1:é😀"),
            "dashql-query-cache-v3\n123:{\"auth\":{\"authType\":\"AUTH_BASIC\"},\"case\":\"trino\",\"defaults\":{\"catalog\":\"hive\",\"schema\":\"sales\"},\"endpoint\":\"https://trino\"}6:v1:é😀"
        );
        let params = json!({ "instanceUrl": "https://org", "appConsumerKey": "k", "login": "u" });
        let signature = params_cache_signature(ConnectorType::SalesforceDataCloud, params.as_object().unwrap());
        assert_eq!(
            result_key_input(&signature, "x"),
            "dashql-query-cache-v3\n82:{\"appConsumerKey\":\"k\",\"case\":\"salesforce\",\"instanceUrl\":\"https://org\",\"login\":\"u\"}1:x"
        );
        assert_eq!(result_key_of_digest(&[0x0a, 0xff, 0x00]), "0aff00");
    }

    #[test]
    fn leaves_out_missing_salesforce_fields() {
        let params = json!({ "appConsumerKey": "k" });
        let signature = params_cache_signature(ConnectorType::Dbcom, params.as_object().unwrap());
        assert_eq!(signature, json!({ "case": "dbcom", "appConsumerKey": "k", "databaseName": "default" }));
        // Another login of the same org keys its results apart
        let login = |login: &str| json!({ "appConsumerKey": "k", "login": login });
        let signature = |params: Value| params_cache_signature(ConnectorType::Dbcom, params.as_object().unwrap());
        assert_ne!(result_key_input(&signature(login("a")), "x"), result_key_input(&signature(login("b")), "x"));
    }
}
