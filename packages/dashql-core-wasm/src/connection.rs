//! The wasm-bindgen API of a connection (`dashql_core_runtime::connections`) and its query history (`dashql_core_runtime::query`).
//!
//! A `Connection` holds the state of a connection and the history of its queries. An action is a method call with
//! typed arguments, params, errors and metrics cross as JSON. It returns a `ConnectionOutcome` with the effects for the
//! host as JSON. A connection that is reset or deleted stops its queries: the binding drops the history and names the
//! active queries in the effect. The state is read as JSON snapshots: the connection, the list of the queries with
//! their revisions and each query. The catalog is shared with a `Catalog` handle, the scripts of workbooks analyze
//! with the same catalog.

use std::collections::BTreeMap;

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core::catalog::{Catalog as CoreCatalog, EntryIdSource};
use dashql_core::error::Error;
use dashql_core_runtime::connections::{
    CatalogUpdateTask, CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionAction, ConnectionDetails,
    ConnectionEffect, ConnectionOutcome as RuntimeOutcome, ConnectionParams, ConnectionState, ConnectionStateOptions,
    ConnectorDetails, ConnectorType, DetailedError, HyperAction, OAuthPkceChallenge, RelationName, SalesforceAction,
    SetupTimings, TemporaryToken, TrinoAction,
};
use dashql_core_runtime::query::{
    QueryError, QueryExecutionAction, QueryExecutionEffect, QueryExecutionHistory, QueryExecutionMetrics,
    QueryExecutionProgress, QueryExecutionState, QueryMetadata, QueryResultTable, QueryType,
};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;

use super::{js_error, Catalog, SharedCatalog, ENTRY_IDS};

fn invalid(message: impl Into<String>) -> JsError {
    js_error(Error::invalid_argument(message))
}

fn parse(text: &str) -> Result<Value, JsError> {
    serde_json::from_str(text).map_err(|e| invalid(format!("invalid JSON: {e}")))
}

fn params(text: &str) -> Result<ConnectionParams, JsError> {
    ConnectionParams::from_json(text).map_err(js_error)
}

/// The params of a connector, a JSON object without the field of the connector
fn connector_params(text: &str) -> Result<Map<String, Value>, JsError> {
    match parse(text)? {
        Value::Object(params) => Ok(params),
        _ => Err(invalid("the params of a connector must be an object")),
    }
}

fn connector(connector: u8) -> Result<ConnectorType, JsError> {
    Ok(match connector {
        0 => ConnectorType::Hyper,
        1 => ConnectorType::SalesforceDataCloud,
        2 => ConnectorType::Trino,
        3 => ConnectorType::Dbcom,
        _ => return Err(invalid(format!("unknown connector {connector}"))),
    })
}

fn connector_index(connector: ConnectorType) -> u8 {
    match connector {
        ConnectorType::Hyper => 0,
        ConnectorType::SalesforceDataCloud => 1,
        ConnectorType::Trino => 2,
        ConnectorType::Dbcom => 3,
    }
}

/// An error from its JSON, `{"message": ..., "data": {...}}`
fn detailed_error(text: &str) -> Result<DetailedError, JsError> {
    let value = parse(text)?;
    let message = value.get("message").and_then(Value::as_str).unwrap_or("").to_string();
    let data: BTreeMap<String, String> = value
        .get("data")
        .and_then(Value::as_object)
        .map(|data| data.iter().map(|(k, v)| (k.clone(), v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string()))).collect())
        .unwrap_or_default();
    Ok(DetailedError { message, data })
}

fn error_json(error: Option<&DetailedError>) -> Value {
    match error {
        Some(error) if error.data.is_empty() => json!({ "message": error.message }),
        Some(error) => json!({ "message": error.message, "data": error.data }),
        None => Value::Null,
    }
}

fn relation_json(relation: &RelationName) -> Value {
    json!({ "databaseName": relation.database_name, "schemaName": relation.schema_name, "tableName": relation.table_name })
}

/// Relation names from their JSON, an array of `{databaseName, schemaName, tableName}`
fn relations(text: &str) -> Result<Vec<RelationName>, JsError> {
    let Value::Array(names) = parse(text)? else {
        return Err(invalid("relation names must be an array"));
    };
    let field = |name: &Value, key: &str| name.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    Ok(names
        .iter()
        .map(|name| RelationName {
            database_name: field(name, "databaseName"),
            schema_name: field(name, "schemaName"),
            table_name: field(name, "tableName"),
        })
        .collect())
}

/// The table names of the analyzer from their JSON, an array of `{databaseName, schemaName, tableName}` with nulls
fn table_names(text: &str) -> Result<Vec<QualifiedTableNameT>, JsError> {
    let Value::Array(names) = parse(text)? else {
        return Err(invalid("table names must be an array"));
    };
    let field = |name: &Value, key: &str| name.get(key).and_then(Value::as_str).map(str::to_string);
    Ok(names
        .iter()
        .map(|name| {
            let mut table = QualifiedTableNameT::default();
            table.database_name = field(name, "databaseName");
            table.schema_name = field(name, "schemaName");
            table.table_name = field(name, "tableName");
            table
        })
        .collect())
}

fn timings_json(timings: &SetupTimings) -> Value {
    let mut out = Map::new();
    let mut set = |key: &str, value: Option<f64>| {
        if let Some(value) = value {
            out.insert(key.to_string(), json!(value));
        }
    };
    set("channelSetupStartedAt", timings.channel_setup_started_at);
    set("channelSetupCancelledAt", timings.channel_setup_cancelled_at);
    set("channelSetupFailedAt", timings.channel_setup_failed_at);
    set("channelReadyAt", timings.channel_ready_at);
    set("healthCheckStartedAt", timings.health_check_started_at);
    set("healthCheckCancelledAt", timings.health_check_cancelled_at);
    set("healthCheckFailedAt", timings.health_check_failed_at);
    set("healthCheckSucceededAt", timings.health_check_succeeded_at);
    set("authStartedAt", timings.auth_started_at);
    set("authCancelledAt", timings.auth_cancelled_at);
    set("authFailedAt", timings.auth_failed_at);
    set("openedNativeAuthLinkAt", timings.opened_native_auth_link_at);
    set("openedWebAuthWindowAt", timings.opened_web_auth_window_at);
    set("closedWebAuthWindowAt", timings.closed_web_auth_window_at);
    set("coreAccessTokenRequestedAt", timings.core_access_token_requested_at);
    set("coreAccessTokenReceivedAt", timings.core_access_token_received_at);
    set("dataCloudAccessTokenRequestedAt", timings.data_cloud_access_token_requested_at);
    set("dataCloudAccessTokenReceivedAt", timings.data_cloud_access_token_received_at);
    set("oauthStartedAt", timings.oauth_started_at);
    set("oauthCancelledAt", timings.oauth_cancelled_at);
    set("oauthFailedAt", timings.oauth_failed_at);
    set("oauthBrowserOpenedAt", timings.oauth_browser_opened_at);
    set("accessTokenRequestedAt", timings.access_token_requested_at);
    set("accessTokenReceivedAt", timings.access_token_received_at);
    set("pkceGenStartedAt", timings.pkce_gen_started_at);
    set("pkceGenFinishedAt", timings.pkce_gen_finished_at);
    set("oauthCodeReceivedAt", timings.oauth_code_received_at);
    Value::Object(out)
}

fn pkce_json(pkce: Option<&OAuthPkceChallenge>) -> Value {
    pkce.map(|pkce| json!({ "value": pkce.value, "verifier": pkce.verifier })).unwrap_or(Value::Null)
}

fn token_json(token: Option<&TemporaryToken>) -> Value {
    token.map(|token| json!({ "token": token.token, "createdAt": token.created_at })).unwrap_or(Value::Null)
}

fn details_json(details: &ConnectionDetails) -> Value {
    let mut out = json!({
        "setupTimings": timings_json(&details.setup_timings),
        "setupParams": details.setup_params,
        "channelError": error_json(details.channel_error.as_ref()),
        "healthCheckError": error_json(details.health_check_error.as_ref()),
        "channel": details.channel,
    });
    match &details.connector {
        ConnectorDetails::Hyper => {}
        ConnectorDetails::Trino(trino) => {
            out["schemaResolutionError"] = error_json(trino.schema_resolution_error.as_ref());
            out["oauthState"] = trino
                .oauth_state
                .as_ref()
                .map(|state| {
                    json!({
                        "oauthPkce": pkce_json(state.oauth_pkce.as_ref()),
                        "authCode": token_json(state.auth_code.as_ref()),
                        "accessToken": state.access_token,
                    })
                })
                .unwrap_or(Value::Null);
        }
        ConnectorDetails::SalesforceDataCloud(salesforce) | ConnectorDetails::Dbcom(salesforce) => {
            out["setupError"] = error_json(salesforce.setup_error.as_ref());
            out["oauthState"] = salesforce
                .oauth_state
                .as_ref()
                .map(|state| {
                    json!({
                        "oauthParams": state.oauth_params.as_ref().map(|params| json!({
                            "instanceUrl": params.instance_url,
                            "appConsumerKey": params.app_consumer_key,
                            "requestedAt": params.requested_at,
                            "expiresAt": params.expires_at,
                        })),
                        "oauthPkce": pkce_json(state.oauth_pkce.as_ref()),
                        "coreAuthCode": token_json(state.core_auth_code.as_ref()),
                        "coreAccessToken": state.core_access_token,
                        "dataCloudAccessToken": state.data_cloud_access_token,
                    })
                })
                .unwrap_or(Value::Null);
        }
    }
    out
}

fn params_json(params: Option<&ConnectionParams>) -> Value {
    params.map(|params| json!({ params.connector.params_key(): params.params })).unwrap_or(Value::Null)
}

fn task_json(task: &CatalogUpdateTask) -> Value {
    json!({
        "taskId": task.task_id,
        "variant": match task.variant {
            CatalogUpdateVariant::FullCatalogRefresh => 0,
            CatalogUpdateVariant::RelationRefresh => 1,
        },
        "status": match task.status {
            CatalogUpdateTaskStatus::Started => 0,
            CatalogUpdateTaskStatus::Succeeded => 1,
            CatalogUpdateTaskStatus::Failed => 2,
            CatalogUpdateTaskStatus::Cancelled => 3,
            CatalogUpdateTaskStatus::PartiallySucceeded => 4,
        },
        "queries": task.queries,
        "error": error_json(task.error.as_ref()),
        "startedAt": task.started_at,
        "finishedAt": task.finished_at,
        "touchedRelations": task.touched_relations.iter().map(relation_json).collect::<Vec<_>>(),
    })
}

fn stream_metrics(value: &Value) -> QueryExecutionMetrics {
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

fn stream_metrics_json(metrics: &QueryExecutionMetrics) -> Value {
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

fn query_type(query_type: u8) -> Result<QueryType, JsError> {
    Ok(match query_type {
        0 => QueryType::UserProvided,
        1 => QueryType::CatalogQueryInformationSchema,
        2 => QueryType::CatalogQueryPgAttribute,
        3 => QueryType::CatalogQueryPgProc,
        4 => QueryType::CatalogQueryHyperCloud,
        5 => QueryType::HealthCheck,
        6 => QueryType::InternalSqlframe,
        7 => QueryType::CloudStore,
        _ => return Err(invalid(format!("unknown query type {query_type}"))),
    })
}

/// The metadata of a query from its JSON, the fields of `QueryMetadata` of the runtime. A planned statement stays with
/// the host.
fn query_metadata(text: &str) -> Result<QueryMetadata, JsError> {
    let value = parse(text)?;
    let string = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    let kind = query_type(value.get("queryType").and_then(Value::as_u64).unwrap_or(0) as u8)?;
    let mut metadata = QueryMetadata::new(kind);
    metadata.title = string("title");
    metadata.description = string("description");
    metadata.issuer = string("issuer");
    metadata.user_provided = value.get("userProvided").and_then(Value::as_bool).unwrap_or(metadata.user_provided);
    metadata.workbook_id = string("workbookId");
    metadata.result_owner = string("resultOwner");
    Ok(metadata)
}

fn query_json(query: &QueryExecutionState) -> Value {
    let metrics = &query.metrics;
    json!({
        "queryId": query.query_id,
        "status": query.status as u8,
        "metrics": {
            "queryRequestedAt": metrics.query_requested_at,
            "querySendingStartedAt": metrics.query_sending_started_at,
            "queryQueuedStartedAt": metrics.query_queued_started_at,
            "queryRunningStartedAt": metrics.query_running_started_at,
            "receivedFirstBatchAt": metrics.received_first_batch_at,
            "receivedLastBatchAt": metrics.received_last_batch_at,
            "receivedAllBatchesAt": metrics.received_all_batches_at,
            "processingResultsStartedAt": metrics.processing_results_started_at,
            "processedResultsAt": metrics.processed_results_at,
            "querySucceededAt": metrics.query_succeeded_at,
            "queryFailedAt": metrics.query_failed_at,
            "queryCancelledAt": metrics.query_cancelled_at,
            "lastUpdatedAt": metrics.last_updated_at,
            "progressUpdatesReceived": metrics.progress_updates_received,
            "queryDurationMs": metrics.query_duration_ms,
            "textLength": metrics.text_length,
            "streamMetrics": stream_metrics_json(&metrics.stream_metrics),
        },
        "error": query.error.as_ref().map(|error| json!({ "message": error.message, "details": error.details })),
        "resultTable": query.result_table.map(|table| json!({ "id": table.id, "rows": table.rows })),
        "cacheKey": query.cache_key,
        "servedFromCache": query.served_from_cache,
        "cacheDeleted": query.cache_deleted,
        "cachedAt": query.cached_at,
        "revision": query.revision,
    })
}

/// What an action did: whether it changed the connection or its queries and the effects for the host as JSON
#[wasm_bindgen]
pub struct ConnectionOutcome {
    changed: bool,
    effects: String,
}

#[wasm_bindgen]
impl ConnectionOutcome {
    /// Did the action change the connection or its queries?
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    /// The effects as a JSON array, in order
    #[wasm_bindgen(getter)]
    pub fn effects(&self) -> String {
        self.effects.clone()
    }
}

fn query_effect_json(effect: &QueryExecutionEffect) -> Value {
    match effect {
        QueryExecutionEffect::ReleaseResultTable { query_id, table } => {
            json!({ "type": "releaseResultTable", "queryId": query_id, "tableId": table.id })
        }
    }
}

/// A connection with the history of its queries
#[wasm_bindgen]
pub struct Connection {
    state: ConnectionState,
    queries: QueryExecutionHistory,
}

impl Connection {
    /// Apply an action to the connection. A connection that stops its queries drops the history.
    fn apply(&mut self, action: ConnectionAction, now: f64) -> Result<ConnectionOutcome, JsError> {
        let RuntimeOutcome { changed, effects } = self.state.apply(action, now).map_err(js_error)?;
        let mut out = Vec::with_capacity(effects.len());
        for effect in &effects {
            out.push(match effect {
                ConnectionEffect::CancelSetup => json!({ "type": "cancelSetup" }),
                ConnectionEffect::InvalidateCatalogBatch => json!({ "type": "invalidateCatalogBatch" }),
                ConnectionEffect::AbortCatalogUpdates { task_ids } => json!({ "type": "abortCatalogUpdates", "taskIds": task_ids }),
                ConnectionEffect::CloseChannel { channel } => json!({ "type": "closeChannel", "channel": channel }),
                ConnectionEffect::ReleaseChannel { channel } => json!({ "type": "releaseChannel", "channel": channel }),
                ConnectionEffect::StopQueries => {
                    let (active, cleared) = self.queries.clear();
                    out.push(json!({ "type": "stopQueries", "queryIds": active }));
                    out.extend(cleared.effects.iter().map(query_effect_json));
                    continue;
                }
            });
        }
        Ok(ConnectionOutcome { changed, effects: Value::Array(out).to_string() })
    }

    /// Apply an action to the queries
    fn apply_query(&mut self, action: QueryExecutionAction) -> Result<ConnectionOutcome, JsError> {
        let outcome = self.queries.apply(action).map_err(js_error)?;
        let effects = Value::Array(outcome.effects.iter().map(query_effect_json).collect()).to_string();
        Ok(ConnectionOutcome { changed: outcome.changed, effects })
    }

    fn finish_task(&mut self, task_id: u32, status: u8, error: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = || -> Result<DetailedError, JsError> { error.as_deref().map(detailed_error).unwrap_or_else(|| Ok(DetailedError::default())) };
        let action = match status {
            1 => ConnectionAction::CatalogUpdateSucceeded { task_id },
            2 => ConnectionAction::CatalogUpdateFailed { task_id, error: error()? },
            3 => ConnectionAction::CatalogUpdateCancelled { task_id, error: error()? },
            4 => ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, error: error()? },
            _ => return Err(invalid(format!("no final status of a catalog update: {status}"))),
        };
        self.apply(action, now)
    }
}

#[wasm_bindgen]
impl Connection {
    /// A connection of a connector with an empty catalog. The setup params of the details are the params of the
    /// connector without its field, none if the details have none. The params default to the setup params.
    #[wasm_bindgen(constructor)]
    pub fn new(
        connection_id: &str,
        connector_type: u8,
        setup_params: Option<String>,
        active: bool,
        params: Option<String>,
        params_draft: Option<String>,
        now: f64,
    ) -> Result<Connection, JsError> {
        let connector = connector(connector_type)?;
        let mut details = ConnectionDetails::default_for(connector);
        details.setup_params = setup_params.as_deref().map(connector_params).transpose()?;
        let options = ConnectionStateOptions {
            active,
            params: params.as_deref().map(self::params).transpose()?,
            params_draft: params_draft.as_deref().map(self::params).transpose()?,
        };
        let catalog = CoreCatalog::with_entry_ids(ENTRY_IDS.with(EntryIdSource::clone));
        let state = ConnectionState::with_catalog(connection_id, details, options, now, catalog);
        Ok(Connection { state, queries: QueryExecutionHistory::new() })
    }

    // The connection

    #[wasm_bindgen(js_name = setDraft)]
    pub fn set_draft(&mut self, draft: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let draft = params(draft)?;
        self.apply(ConnectionAction::SetDraft(draft), now)
    }

    #[wasm_bindgen(js_name = discardDraft)]
    pub fn discard_draft(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::DiscardDraft, now)
    }

    #[wasm_bindgen(js_name = commitParams)]
    pub fn commit_params(&mut self, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = self::params(params)?;
        self.apply(ConnectionAction::CommitParams(params), now)
    }

    pub fn rename(&mut self, name: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Rename(name), now)
    }

    #[wasm_bindgen(js_name = setQueryResultCaching)]
    pub fn set_query_result_caching(&mut self, caching: bool, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::SetQueryResultCaching(caching), now)
    }

    /// Stop the connection and drop its catalog and queries
    pub fn delete(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Delete, now)
    }

    /// Stop the connection and clear its catalog and queries
    pub fn reset(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Reset, now)
    }

    #[wasm_bindgen(js_name = switchConnectorType)]
    pub fn switch_connector_type(&mut self, connector_type: u8, now: f64) -> Result<ConnectionOutcome, JsError> {
        let connector = connector(connector_type)?;
        self.apply(ConnectionAction::SwitchConnectorType(connector), now)
    }

    // The health check

    #[wasm_bindgen(js_name = healthCheckStarted)]
    pub fn health_check_started(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::HealthCheckStarted, now)
    }

    #[wasm_bindgen(js_name = healthCheckCancelled)]
    pub fn health_check_cancelled(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::HealthCheckCancelled, now)
    }

    #[wasm_bindgen(js_name = healthCheckFailed)]
    pub fn health_check_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::HealthCheckFailed(error), now)
    }

    #[wasm_bindgen(js_name = healthCheckSucceeded)]
    pub fn health_check_succeeded(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::HealthCheckSucceeded, now)
    }

    // The catalog updates

    /// Executed statements touched relations, a JSON array of `{databaseName, schemaName, tableName}` with nulls
    #[wasm_bindgen(js_name = relationsTouched)]
    pub fn relations_touched(&mut self, names: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let names = table_names(names)?;
        self.apply(ConnectionAction::RelationsTouched(names), now)
    }

    /// A catalog update started, `variant` 0 is a full refresh and 1 a lookup of relations
    #[wasm_bindgen(js_name = updateCatalog)]
    pub fn update_catalog(
        &mut self,
        task_id: u32,
        variant: u8,
        started_at: Option<f64>,
        touched_relations: Option<String>,
        now: f64,
    ) -> Result<ConnectionOutcome, JsError> {
        let variant = match variant {
            0 => CatalogUpdateVariant::FullCatalogRefresh,
            1 => CatalogUpdateVariant::RelationRefresh,
            _ => return Err(invalid(format!("unknown catalog update {variant}"))),
        };
        let mut task = CatalogUpdateTask::new(task_id, variant, now);
        task.started_at = started_at;
        task.touched_relations = touched_relations.as_deref().map(relations).transpose()?.unwrap_or_default();
        self.apply(ConnectionAction::UpdateCatalog(task), now)
    }

    #[wasm_bindgen(js_name = catalogUpdateRegisterQuery)]
    pub fn catalog_update_register_query(&mut self, task_id: u32, query_id: u32, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::CatalogUpdateRegisterQuery { task_id, query_id }, now)
    }

    /// A catalog update finished with a status: 1 succeeded, 2 failed, 3 cancelled, 4 partially succeeded
    #[wasm_bindgen(js_name = catalogUpdateFinished)]
    pub fn catalog_update_finished(&mut self, task_id: u32, status: u8, error: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.finish_task(task_id, status, error, now)
    }

    /// Restore the state of the catalog updates from the files of the catalog
    #[wasm_bindgen(js_name = restoreCatalogUpdates)]
    pub fn restore_catalog_updates(&mut self, described: Option<bool>, touched_relations: Option<String>) -> Result<(), JsError> {
        let touched = touched_relations.as_deref().map(relations).transpose()?;
        self.state.restore_catalog_updates(described, touched);
        Ok(())
    }

    // The setup of Hyper

    #[wasm_bindgen(js_name = hyperChannelSetupStarted)]
    pub fn hyper_channel_setup_started(&mut self, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = hyperChannelSetupCancelled)]
    pub fn hyper_channel_setup_cancelled(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = hyperChannelSetupFailed)]
    pub fn hyper_channel_setup_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = hyperChannelReady)]
    pub fn hyper_channel_ready(&mut self, channel: u32, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelReady { channel, params }), now)
    }

    // The setup of Trino

    #[wasm_bindgen(js_name = trinoOAuthStarted)]
    pub fn trino_oauth_started(&mut self, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthStarted { params }), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthCancelled)]
    pub fn trino_oauth_cancelled(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthFailed)]
    pub fn trino_oauth_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthFailed(error)), now)
    }

    #[wasm_bindgen(js_name = trinoGeneratingPkceChallenge)]
    pub fn trino_generating_pkce_challenge(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::GeneratingPkceChallenge), now)
    }

    #[wasm_bindgen(js_name = trinoGeneratedPkceChallenge)]
    pub fn trino_generated_pkce_challenge(&mut self, value: String, verifier: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::GeneratedPkceChallenge(OAuthPkceChallenge { value, verifier })), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthBrowserOpened)]
    pub fn trino_oauth_browser_opened(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthBrowserOpened), now)
    }

    #[wasm_bindgen(js_name = trinoReceivedOAuthCode)]
    pub fn trino_received_oauth_code(&mut self, token: String, created_at: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ReceivedOAuthCode(TemporaryToken { token, created_at })), now)
    }

    #[wasm_bindgen(js_name = trinoRequestingAccessToken)]
    pub fn trino_requesting_access_token(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::RequestingAccessToken), now)
    }

    /// The access token arrived, opaque JSON
    #[wasm_bindgen(js_name = trinoReceivedAccessToken)]
    pub fn trino_received_access_token(&mut self, token: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ReceivedAccessToken(token)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupStarted)]
    pub fn trino_channel_setup_started(&mut self, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupCancelled)]
    pub fn trino_channel_setup_cancelled(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupFailed)]
    pub fn trino_channel_setup_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelReady)]
    pub fn trino_channel_ready(&mut self, channel: u32, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelReady(channel)), now)
    }

    // The setup of Salesforce and Database.com

    #[wasm_bindgen(js_name = salesforceSetupStarted)]
    pub fn salesforce_setup_started(&mut self, params: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = salesforceSetupCancelled)]
    pub fn salesforce_setup_cancelled(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceSetupFailed)]
    pub fn salesforce_setup_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceGeneratingPkceChallenge)]
    pub fn salesforce_generating_pkce_challenge(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::GeneratingPkceChallenge), now)
    }

    #[wasm_bindgen(js_name = salesforceGeneratedPkceChallenge)]
    pub fn salesforce_generated_pkce_challenge(&mut self, value: String, verifier: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        let pkce = OAuthPkceChallenge { value, verifier };
        self.apply(ConnectionAction::Salesforce(SalesforceAction::GeneratedPkceChallenge(pkce)), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthNativeLinkOpened)]
    pub fn salesforce_oauth_native_link_opened(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthNativeLinkOpened), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthWebWindowOpened)]
    pub fn salesforce_oauth_web_window_opened(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthWebWindowOpened), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthWebWindowClosed)]
    pub fn salesforce_oauth_web_window_closed(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthWebWindowClosed), now)
    }

    #[wasm_bindgen(js_name = salesforceReceivedCoreAuthCode)]
    pub fn salesforce_received_core_auth_code(&mut self, token: String, created_at: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        let code = TemporaryToken { token, created_at };
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthCode(code)), now)
    }

    #[wasm_bindgen(js_name = salesforceRequestingCoreAuthToken)]
    pub fn salesforce_requesting_core_auth_token(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::RequestingCoreAuthToken), now)
    }

    /// The core access token arrived, opaque JSON
    #[wasm_bindgen(js_name = salesforceReceivedCoreAuthToken)]
    pub fn salesforce_received_core_auth_token(&mut self, token: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthToken(token)), now)
    }

    #[wasm_bindgen(js_name = salesforceReceivedCoreUserInfo)]
    pub fn salesforce_received_core_user_info(
        &mut self,
        preferred_username: Option<String>,
        email: Option<String>,
        now: f64,
    ) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreUserInfo { preferred_username, email }), now)
    }

    #[wasm_bindgen(js_name = salesforceRequestingDataCloudAccessToken)]
    pub fn salesforce_requesting_data_cloud_access_token(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::RequestingDataCloudAccessToken), now)
    }

    /// The Data Cloud access token arrived, opaque JSON
    #[wasm_bindgen(js_name = salesforceReceivedDataCloudAccessToken)]
    pub fn salesforce_received_data_cloud_access_token(&mut self, token: String, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedDataCloudAccessToken(token)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupStarted)]
    pub fn salesforce_channel_setup_started(&mut self, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupStarted), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupCancelled)]
    pub fn salesforce_channel_setup_cancelled(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupFailed)]
    pub fn salesforce_channel_setup_failed(&mut self, error: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let error = detailed_error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelReady)]
    pub fn salesforce_channel_ready(&mut self, channel: u32, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelReady(channel)), now)
    }

    // The queries

    /// Start tracking a requested query, the metadata is JSON
    #[wasm_bindgen(js_name = executeQuery)]
    pub fn execute_query(&mut self, query_id: f64, trace_id: f64, text: String, metadata: &str, requested_at: f64) -> Result<ConnectionOutcome, JsError> {
        let metadata = query_metadata(metadata)?;
        let state = QueryExecutionState::new(query_id as u64, trace_id as u64, text, metadata, requested_at as i64);
        self.apply_query(QueryExecutionAction::ExecuteQuery { state: Box::new(state) })
    }

    #[wasm_bindgen(js_name = querySending)]
    pub fn query_sending(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QuerySending { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryRunning)]
    pub fn query_running(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QueryRunning { query_id: query_id as u64, now: now as i64 })
    }

    /// The backend reported progress, the plain fields of the progress as JSON. The structured progress stays with
    /// the host.
    #[wasm_bindgen(js_name = queryProgressUpdated)]
    pub fn query_progress_updated(&mut self, query_id: f64, progress: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let value = parse(progress)?;
        let number = |key: &str| value.get(key).and_then(Value::as_f64);
        let progress = QueryExecutionProgress {
            is_queued: value.get("isQueued").and_then(Value::as_bool),
            progress_percent: number("progressPercent"),
            result_rows: number("resultRows").map(|v| v.max(0.0) as u64),
            rows_processed: number("rowsProcessed").map(|v| v.max(0.0) as u64),
            execution_time_ms: number("executionTimeMs").map(|v| v as i64),
            metrics: value.get("metrics").map(stream_metrics).unwrap_or_default(),
            phase: value.get("phase").and_then(Value::as_str).map(str::to_string),
            engine_progress: None,
            profile_progress: None,
        };
        self.apply_query(QueryExecutionAction::QueryProgressUpdated { query_id: query_id as u64, progress: Box::new(progress), now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryReceivedBatch)]
    pub fn query_received_batch(&mut self, query_id: f64, metrics: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let metrics = stream_metrics(&parse(metrics)?);
        self.apply_query(QueryExecutionAction::QueryReceivedBatch { query_id: query_id as u64, metrics, now: now as i64 })
    }

    /// All batches arrived, the host keeps the table under its id
    #[wasm_bindgen(js_name = queryReceivedAllBatches)]
    pub fn query_received_all_batches(&mut self, query_id: f64, table_id: f64, rows: f64, metrics: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        let metrics = stream_metrics(&parse(metrics)?);
        let table = QueryResultTable { id: table_id as u64, rows: rows.max(0.0) as u64 };
        self.apply_query(QueryExecutionAction::QueryReceivedAllBatches { query_id: query_id as u64, table, metrics, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryProcessingResults)]
    pub fn query_processing_results(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QueryProcessingResults { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryProcessedResults)]
    pub fn query_processed_results(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QueryProcessedResults { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = querySucceeded)]
    pub fn query_succeeded(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QuerySucceeded { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryFailed)]
    pub fn query_failed(&mut self, query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        let metrics = metrics.as_deref().map(parse).transpose()?.map(|value| stream_metrics(&value));
        let error = QueryError { message, details };
        self.apply_query(QueryExecutionAction::QueryFailed { query_id: query_id as u64, error, metrics, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryCancelled)]
    pub fn query_cancelled(&mut self, query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        let metrics = metrics.as_deref().map(parse).transpose()?.map(|value| stream_metrics(&value));
        let error = QueryError { message, details };
        self.apply_query(QueryExecutionAction::QueryCancelled { query_id: query_id as u64, error, metrics, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryCacheRecorded)]
    pub fn query_cache_recorded(&mut self, query_id: f64, cache_key: String, served_from_cache: bool, cached_at: Option<f64>) -> Result<ConnectionOutcome, JsError> {
        let cached_at = cached_at.map(|at| at as i64);
        self.apply_query(QueryExecutionAction::QueryCacheRecorded { query_id: query_id as u64, cache_key, served_from_cache, cached_at })
    }

    #[wasm_bindgen(js_name = queryCacheDeleted)]
    pub fn query_cache_deleted(&mut self, query_id: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply_query(QueryExecutionAction::QueryCacheDeleted { query_id: query_id as u64 })
    }

    // Reading the state

    /// The revision of the connection, it changes with every change of the connection, not of its queries
    pub fn revision(&self) -> f64 {
        self.state.revision() as f64
    }

    /// The revision of the queries, it changes with every change of a query
    #[wasm_bindgen(js_name = queriesRevision)]
    pub fn queries_revision(&self) -> f64 {
        self.queries.revision() as f64
    }

    /// The catalog, shared with the connection
    pub fn catalog(&self) -> Catalog {
        Catalog { inner: SharedCatalog(self.state.catalog().clone()) }
    }

    /// The text of the script with the functions of the connection, none once it is deleted
    #[wasm_bindgen(js_name = functionScriptText)]
    pub fn function_script_text(&self) -> Option<String> {
        self.state.function_script().map(|script| script.to_text())
    }

    /// Replace the text of the script with the functions of the connection
    #[wasm_bindgen(js_name = replaceFunctionScriptText)]
    pub fn replace_function_script_text(&mut self, text: &str) -> Result<(), JsError> {
        self.state.replace_function_script_text(text).map_err(js_error)
    }

    /// The plain fields of the connection as JSON
    pub fn snapshot(&self) -> String {
        let state = &self.state;
        let updates = state.catalog_updates();
        json!({
            "revision": state.revision(),
            "active": state.active(),
            "status": state.status() as u8,
            "health": state.health() as u8,
            "connectorType": connector_index(state.connector_type()),
            "name": state.name(),
            "cacheQueryResults": state.cache_query_results(),
            "details": details_json(state.details()),
            "params": params_json(Some(state.params())),
            "paramsDraft": params_json(state.params_draft()),
            "setupAttemptParams": params_json(state.setup_attempt_params()),
            "setupAttemptDraft": params_json(state.setup_attempt_draft()),
            "catalogUpdates": {
                "tasksRunning": updates.tasks_running.values().map(task_json).collect::<Vec<_>>(),
                "tasksFinished": updates.tasks_finished.values().map(task_json).collect::<Vec<_>>(),
                "described": updates.described,
                "currentFullRefresh": updates.current_full_refresh,
                "touchedRelations": updates.touched_relations.iter().map(relation_json).collect::<Vec<_>>(),
                "touchedFailures": updates.touched_failures,
            },
            "relationEntryId": state.relation_entry_id(),
            "functionScriptEntryId": state.function_script().map(|script| script.catalog_entry_id()),
        })
        .to_string()
    }

    /// The queries as JSON: the active and the finished ones in order with their revisions, the counter of started and
    /// finished queries and the metrics of the connection
    pub fn queries(&self) -> String {
        let history = &self.queries;
        let list = |ids: &[u64]| -> Vec<Value> {
            ids.iter().map(|id| json!([id, history.query(*id).map(|query| query.revision).unwrap_or(0)])).collect()
        };
        let metrics = history.metrics();
        let outcome = |m: &dashql_core_runtime::query::ConnectionQueryMetrics| {
            json!({
                "totalQueries": m.total_queries,
                "totalBatchesReceived": m.total_batches_received,
                "totalRowsReceived": m.total_rows_received,
                "accumulatedTimeUntilFirstBatch": m.accumulated_time_until_first_batch,
                "accumulatedQueryDuration": m.accumulated_query_duration,
            })
        };
        json!({
            "revision": history.revision(),
            "active": list(history.active_ids()),
            "finished": list(history.finished_ids()),
            "snapshot": history.snapshot_queries_active_finished(),
            "metrics": {
                "successfulQueries": outcome(&metrics.successful_queries),
                "canceledQueries": outcome(&metrics.canceled_queries),
                "failedQueries": outcome(&metrics.failed_queries),
            },
        })
        .to_string()
    }

    /// The plain fields of a query as JSON, none for an unknown query
    pub fn query(&self, query_id: f64) -> Option<String> {
        self.queries.query(query_id as u64).map(|query| query_json(query).to_string())
    }
}
