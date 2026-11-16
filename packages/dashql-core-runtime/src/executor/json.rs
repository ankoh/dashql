//! The executor in JSON, as it crosses to the host of the module: the targets that the host describes and the
//! failures that it gets back.

use serde_json::{json, Value};

use super::{FailureKind, QueryFailure, QueryTarget};
use crate::connections::{JsonObject, TrinoSessionDefaults};
use crate::http::Headers;
use crate::hyper::{HyperChannelContext, HyperHttpChannel};
use crate::trino::{TrinoAccessToken, TrinoAuthParams, TrinoChannel};

fn details_json(details: &[(String, String)]) -> Value {
    Value::Object(details.iter().map(|(key, value)| (key.clone(), Value::String(value.clone()))).collect())
}

/// A failure as JSON, without what the host failed with
pub fn failure_json(failure: &QueryFailure) -> Value {
    json!({
        "kind": match failure.kind {
            FailureKind::Error => "error",
            FailureKind::Cancelled => "cancelled",
            FailureKind::CacheMiss => "cacheMiss",
            FailureKind::Processing => "processing",
        },
        "message": failure.message,
        "details": details_json(&failure.details),
        "target": failure.target,
        "hostValue": failure.value.is_some(),
    })
}

fn object<'a>(value: &'a Value, key: &str) -> Option<&'a JsonObject> {
    value.get(key).and_then(Value::as_object)
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The target of a query from JSON:
///
/// - `{"type": "host"}`
/// - `{"type": "trino", "endpoint", "auth", "accessToken", "catalog", "schema"}`, the auth as the Trino params have it
/// - `{"type": "hyperHttp", "params", "clientContext", "auth", "parallelChunks"}`, the params of a Hyper connection and
///   the auth headers as an object
///
/// A call of a client function is no target of the host, the runtime describes it itself.
pub fn target_from_json(value: &Value) -> Result<QueryTarget, String> {
    match value.get("type").and_then(Value::as_str) {
        Some("host") => Ok(QueryTarget::Host),
        Some("trino") => {
            // The defaults of the channel, a schema only with a catalog
            let catalog = string(value, "catalog").filter(|catalog| !catalog.is_empty());
            let schema = string(value, "schema").filter(|schema| !schema.is_empty() && catalog.is_some());
            let defaults = TrinoSessionDefaults { catalog, schema };
            let endpoint = string(value, "endpoint").unwrap_or_default();
            let mut channel = TrinoChannel::new(endpoint, TrinoAuthParams::from_json(value.get("auth")), defaults);
            channel.access_token = value.get("accessToken").and_then(TrinoAccessToken::from_json);
            Ok(QueryTarget::Trino(channel))
        }
        Some("hyperHttp") => {
            let params = object(value, "params").cloned().unwrap_or_default();
            let client_context = value.get("clientContext").filter(|context| !context.is_null()).cloned();
            let context = HyperChannelContext::from_params(&params, client_context);
            let parallel = value.get("parallelChunks").and_then(Value::as_u64).map(|n| n as usize);
            let channel = HyperHttpChannel::connect(&params, context, parallel).map_err(|e| e.message())?;
            let auth = object(value, "auth")
                .map(|auth| Headers::from_pairs(auth.iter().filter_map(|(name, value)| Some((name.as_str(), value.as_str()?)))))
                .unwrap_or_default();
            Ok(QueryTarget::HyperHttp { channel, auth })
        }
        other => Err(format!("unknown query target {other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_targets_of_queries() {
        let trino = json!({
            "type": "trino",
            "endpoint": "https://trino.example.com",
            "auth": { "authType": "AUTH_BASIC", "basic": { "username": "u", "secret": "s" } },
            "catalog": "tpch",
            "schema": null,
        });
        let QueryTarget::Trino(channel) = target_from_json(&trino).unwrap() else { panic!("a Trino target") };
        assert_eq!(channel.endpoint, "https://trino.example.com");
        assert_eq!(channel.defaults.catalog.as_deref(), Some("tpch"));
        assert_eq!(channel.auth.username, "u");
        let hyper = json!({
            "type": "hyperHttp",
            "params": { "endpoint": "https://hyper.example", "queryParameters": { "lc_time": "en_US" } },
            "auth": { "Authorization": "Bearer t" },
        });
        let QueryTarget::HyperHttp { channel, auth } = target_from_json(&hyper).unwrap() else { panic!("a Hyper target") };
        assert_eq!(auth.get("authorization"), Some("Bearer t"));
        assert_eq!(channel.execute_query("select 1", &auth).url, "https://hyper.example/api/v3/query");
        assert!(target_from_json(&json!({ "type": "hyperHttp", "params": {} })).is_err());
        assert!(target_from_json(&json!({ "type": "unknown" })).is_err());
        assert!(matches!(target_from_json(&json!({ "type": "host" })), Ok(QueryTarget::Host)));
    }
}
