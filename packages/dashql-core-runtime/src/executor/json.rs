//! The executor in JSON, as it crosses to the host of the module: targets, events, failures and metrics in the shapes
//! of the TypeScript runtime (`QueryExecutionMetrics`). A progress update crosses next to its event, as a value of the
//! module that the host hands to the query history.

use std::rc::Rc;

use serde_json::{json, Value};

use super::{ClientFunctionTarget, FailureKind, QueryEvent, QueryFailure, QueryTarget};
use crate::clfn::{ClientFunctionCallDescription, ClientFunctionSpec};
use crate::connections::{ConnectorType, JsonObject, TrinoSessionDefaults};
use crate::http::Headers;
use crate::hyper::{HyperChannelContext, HyperHttpChannel};
use crate::query::QueryExecutionMetrics;
use crate::salesforce::SalesforceTokens;
use crate::trino::{TrinoAccessToken, TrinoAuthParams, TrinoChannel};

/// The metrics of a stream as JSON
pub fn metrics_json(metrics: &QueryExecutionMetrics) -> Value {
    json!({
        "totalDataBytesReceived": metrics.total_data_bytes_received,
        "totalBatchesReceived": metrics.total_batches_received,
        "totalRowsReceived": metrics.total_rows_received,
        "totalQueryRequestsStarted": metrics.total_query_requests_started,
        "totalQueryRequestsSucceeded": metrics.total_query_requests_succeeded,
        "totalQueryRequestsFailed": metrics.total_query_requests_failed,
        "totalQueryRequestDurationMs": metrics.total_query_request_duration_ms,
        "durationUntilFirstBatchMs": metrics.duration_until_first_batch_ms,
    })
}

/// The metrics of a stream from JSON, missing counters are 0
pub fn metrics_from_json(value: &Value) -> QueryExecutionMetrics {
    let count = |key: &str| value.get(key).and_then(Value::as_f64).map(|v| v.max(0.0) as u64).unwrap_or(0);
    QueryExecutionMetrics {
        total_data_bytes_received: count("totalDataBytesReceived"),
        total_batches_received: count("totalBatchesReceived"),
        total_rows_received: count("totalRowsReceived"),
        total_query_requests_started: count("totalQueryRequestsStarted"),
        total_query_requests_succeeded: count("totalQueryRequestsSucceeded"),
        total_query_requests_failed: count("totalQueryRequestsFailed"),
        total_query_request_duration_ms: value.get("totalQueryRequestDurationMs").and_then(Value::as_f64).unwrap_or(0.0) as i64,
        duration_until_first_batch_ms: value.get("durationUntilFirstBatchMs").and_then(Value::as_f64).map(|v| v as i64),
    }
}

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

/// An event as JSON. A part of a result, a progress update and what the host failed with cross next to it.
pub fn event_json(event: &QueryEvent) -> Value {
    match event {
        QueryEvent::Sending => json!({ "type": "sending" }),
        QueryEvent::Running => json!({ "type": "running" }),
        QueryEvent::Progress(_) => json!({ "type": "progress" }),
        QueryEvent::ResultData(body) => json!({ "type": "resultData", "bytes": body.len() }),
        QueryEvent::ReceivedBatch(metrics) => json!({ "type": "receivedBatch", "metrics": metrics_json(metrics) }),
        QueryEvent::ReceivedAllBatches { rows, metrics } => {
            json!({ "type": "receivedAllBatches", "rows": rows, "metrics": metrics_json(metrics) })
        }
        QueryEvent::ProcessingResults => json!({ "type": "processingResults" }),
        QueryEvent::ProcessedResults => json!({ "type": "processedResults" }),
        QueryEvent::Succeeded => json!({ "type": "succeeded" }),
        QueryEvent::Failed { failure, metrics } => {
            json!({ "type": "failed", "failure": failure_json(failure), "metrics": metrics.as_ref().map(metrics_json) })
        }
        QueryEvent::Cancelled { failure, metrics } => {
            json!({ "type": "cancelled", "failure": failure_json(failure), "metrics": metrics.as_ref().map(metrics_json) })
        }
        QueryEvent::CacheRecorded { key, served_from_cache, cached_at } => {
            json!({ "type": "cacheRecorded", "key": key, "servedFromCache": served_from_cache, "cachedAt": cached_at })
        }
        QueryEvent::TouchRelations => json!({ "type": "touchRelations" }),
        QueryEvent::Timing { label, elapsed_ms } => json!({ "type": "timing", "label": label, "elapsedMs": elapsed_ms }),
        QueryEvent::ResultsReady => json!({ "type": "resultsReady" }),
        QueryEvent::Log { level, message, details, target } => json!({
            "type": "log",
            "level": level.name(),
            "message": message,
            "details": details_json(details),
            "target": target,
        }),
        QueryEvent::TrinoTokenRefreshed(token) => json!({ "type": "trinoTokenRefreshed", "token": token.to_json() }),
    }
}

fn object<'a>(value: &'a Value, key: &str) -> Option<&'a JsonObject> {
    value.get(key).and_then(Value::as_object)
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The connector of its index in the JSON of the host
fn connector(index: u64) -> Result<ConnectorType, String> {
    Ok(match index {
        0 => ConnectorType::Hyper,
        1 => ConnectorType::SalesforceDataCloud,
        2 => ConnectorType::Trino,
        3 => ConnectorType::Dbcom,
        _ => return Err(format!("unknown connector {index}")),
    })
}

/// The target of a query from JSON:
///
/// - `{"type": "host"}`
/// - `{"type": "trino", "endpoint", "auth", "accessToken", "catalog", "schema"}`, the auth as the Trino params have it
/// - `{"type": "hyperHttp", "params", "clientContext", "auth", "parallelChunks"}`, the params of a Hyper connection and
///   the auth headers as an object
/// - `{"type": "clientFunction", "connector", "spec", "description", "tokens"}`, the spec as JSON text, the tokens as
///   `{"core", "dataCloud"}` objects
pub fn target_from_json(value: &Value, specs: &mut SpecCache) -> Result<QueryTarget, String> {
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
        Some("clientFunction") => {
            let connector = connector(value.get("connector").and_then(Value::as_u64).unwrap_or(u64::MAX))?;
            let spec = match value.get("spec").and_then(Value::as_str) {
                Some(text) => Some(specs.get(text)?),
                None => None,
            };
            let description = ClientFunctionCallDescription::from_value(value.get("description").cloned().unwrap_or(Value::Null))
                .map_err(|e| e.message)?;
            let tokens = value.get("tokens").and_then(|tokens| {
                let core = tokens.get("core")?;
                let data_cloud = tokens.get("dataCloud")?;
                SalesforceTokens::from_json(&core.to_string(), &data_cloud.to_string())
            });
            Ok(QueryTarget::ClientFunction(ClientFunctionTarget { connector, spec, description, tokens }))
        }
        other => Err(format!("unknown query target {other:?}")),
    }
}

/// The specs of client functions that requests named, by their text. A connector keeps its spec, so the text repeats.
#[derive(Default)]
pub struct SpecCache {
    last: Option<(String, Rc<ClientFunctionSpec>)>,
}

impl SpecCache {
    fn get(&mut self, text: &str) -> Result<Rc<ClientFunctionSpec>, String> {
        if let Some((cached, spec)) = &self.last {
            if cached == text {
                return Ok(spec.clone());
            }
        }
        let spec = Rc::new(ClientFunctionSpec::from_json(text).map_err(|e| e.message)?);
        self.last = Some((text.to_string(), spec.clone()));
        Ok(spec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::QueryExecutionProgress;

    #[test]
    fn reads_the_targets_of_queries() {
        let mut specs = SpecCache::default();
        let trino = json!({
            "type": "trino",
            "endpoint": "https://trino.example.com",
            "auth": { "authType": "AUTH_BASIC", "basic": { "username": "u", "secret": "s" } },
            "catalog": "tpch",
            "schema": null,
        });
        let QueryTarget::Trino(channel) = target_from_json(&trino, &mut specs).unwrap() else { panic!("a Trino target") };
        assert_eq!(channel.endpoint, "https://trino.example.com");
        assert_eq!(channel.defaults.catalog.as_deref(), Some("tpch"));
        assert_eq!(channel.auth.username, "u");
        let hyper = json!({
            "type": "hyperHttp",
            "params": { "endpoint": "https://hyper.example", "queryParameters": { "lc_time": "en_US" } },
            "auth": { "Authorization": "Bearer t" },
        });
        let QueryTarget::HyperHttp { channel, auth } = target_from_json(&hyper, &mut specs).unwrap() else { panic!("a Hyper target") };
        assert_eq!(auth.get("authorization"), Some("Bearer t"));
        assert_eq!(channel.execute_query("select 1", &auth).url, "https://hyper.example/api/v3/query");
        assert!(target_from_json(&json!({ "type": "hyperHttp", "params": {} }), &mut specs).is_err());
        assert!(target_from_json(&json!({ "type": "unknown" }), &mut specs).is_err());
        assert!(matches!(target_from_json(&json!({ "type": "host" }), &mut specs), Ok(QueryTarget::Host)));
    }

    #[test]
    fn writes_events() {
        let progress = QueryExecutionProgress { is_queued: Some(true), phase: Some("QUEUED".into()), ..Default::default() };
        assert_eq!(event_json(&QueryEvent::Progress(Box::new(progress))), json!({ "type": "progress" }));
        let failure = QueryFailure::new(FailureKind::CacheMiss, "miss");
        assert_eq!(event_json(&QueryEvent::Failed { failure, metrics: None })["failure"]["kind"], json!("cacheMiss"));
        let metrics = metrics_from_json(&json!({ "totalRowsReceived": 3, "durationUntilFirstBatchMs": 1.5 }));
        assert_eq!((metrics.total_rows_received, metrics.duration_until_first_batch_ms), (3, Some(1)));
    }
}
