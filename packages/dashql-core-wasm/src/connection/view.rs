//! The views of a connection: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`) with TypeScript
//! declarations in the generated `.d.ts` (`tsify`). See docs/wip/runtime_projection.md.
//!
//! The channels, the catalog updates and the queries are named by their ids. Times are milliseconds since epoch, a
//! missing value is null. The params of a connector and the access tokens are opaque JSON: the params cross as plain
//! objects, the tokens as their text. The status, the health, the connector and the catalog updates are numeric enums
//! of the module with the names and numbers of the app (`app_enum!`).

use std::collections::BTreeMap;

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core_runtime::connections::{
    self as rt, CatalogUpdateTask, ConnectionDetails, ConnectionParams, ConnectionState, ConnectorDetails, DetailedError, JsonObject,
    OAuthPkceChallenge, RelationName, SetupTimings, TemporaryToken,
};
use dashql_core_runtime::query::QueryExecutionEffect;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::views::app_enum;

app_enum! {
    "The connectors"
    ConnectorType: rt::ConnectorType {
        HYPER = 0 => Hyper,
        SALESFORCE_DATA_CLOUD = 1 => SalesforceDataCloud,
        TRINO = 2 => Trino,
        DBCOM = 3 => Dbcom,
    }
}

app_enum! {
    "How far the setup of a connection got"
    ConnectionStatus: rt::ConnectionStatus {
        NOT_STARTED = 0 => NotStarted,
        HEALTH_CHECK_STARTED = 1 => HealthCheckStarted,
        HEALTH_CHECK_FAILED = 2 => HealthCheckFailed,
        HEALTH_CHECK_CANCELLED = 3 => HealthCheckCancelled,
        HEALTH_CHECK_SUCCEEDED = 4 => HealthCheckSucceeded,
        CHANNEL_SETUP_STARTED = 5 => ChannelSetupStarted,
        CHANNEL_SETUP_FAILED = 6 => ChannelSetupFailed,
        CHANNEL_SETUP_CANCELLED = 7 => ChannelSetupCancelled,
        CHANNEL_READY = 8 => ChannelReady,
        AUTH_STARTED = 9 => AuthStarted,
        AUTH_CANCELLED = 10 => AuthCancelled,
        AUTH_FAILED = 11 => AuthFailed,
        PKCE_GENERATION_STARTED = 12 => PkceGenerationStarted,
        PKCE_GENERATED = 13 => PkceGenerated,
        WAITING_FOR_OAUTH_CODE_VIA_WINDOW = 14 => WaitingForOAuthCodeViaWindow,
        WAITING_FOR_OAUTH_CODE_VIA_LINK = 15 => WaitingForOAuthCodeViaLink,
        OAUTH_CODE_RECEIVED = 16 => OAuthCodeReceived,
        ACCESS_TOKEN_REQUESTED = 17 => AccessTokenRequested,
        ACCESS_TOKEN_RECEIVED = 18 => AccessTokenReceived,
        DATA_CLOUD_TOKEN_REQUESTED = 19 => DataCloudTokenRequested,
        DATA_CLOUD_TOKEN_RECEIVED = 20 => DataCloudTokenReceived,
        CORE_ACCESS_TOKEN_REQUESTED = 21 => CoreAccessTokenRequested,
        CORE_ACCESS_TOKEN_RECEIVED = 22 => CoreAccessTokenReceived,
    }
}

app_enum! {
    "The health of a connection"
    ConnectionHealth: rt::ConnectionHealth {
        NOT_STARTED = 0 => NotStarted,
        CONNECTING = 1 => Connecting,
        CANCELLED = 2 => Cancelled,
        ONLINE = 3 => Online,
        FAILED = 4 => Failed,
    }
}

app_enum! {
    "What a catalog update does: load the whole catalog or ask about the relations that statements touched"
    CatalogUpdateVariant: rt::CatalogUpdateVariant {
        FULL_CATALOG_REFRESH = 0 => FullCatalogRefresh,
        RELATION_REFRESH = 1 => RelationRefresh,
    }
}

app_enum! {
    "How far a catalog update got"
    CatalogUpdateTaskStatus: rt::CatalogUpdateTaskStatus {
        STARTED = 0 => Started,
        SUCCEEDED = 1 => Succeeded,
        FAILED = 2 => Failed,
        CANCELLED = 3 => Cancelled,
        PARTIALLY_SUCCEEDED = 4 => PartiallySucceeded,
    }
}

/// Opaque JSON params: the params of a connection with one field named after the connector (`{ trino: {...} }`), or
/// the params of a connector without that field
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "Record<string, unknown>")]
pub struct JsonParams(pub JsonObject);

impl JsonParams {
    /// The params of a connection
    pub fn connection_params(self) -> Result<ConnectionParams, dashql_core::error::Error> {
        ConnectionParams::from_object(self.0)
    }
}

/// The params of a connection with one field named after the connector
fn params_object(params: &ConnectionParams) -> JsonParams {
    JsonParams(params.to_object())
}

/// An error with a message and optional details
#[derive(Clone, Debug, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionError {
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[tsify(optional)]
    pub data: BTreeMap<String, String>,
}

impl From<&DetailedError> for ConnectionError {
    fn from(error: &DetailedError) -> Self {
        ConnectionError { message: error.message.clone(), data: error.data.clone() }
    }
}

impl From<ConnectionError> for DetailedError {
    fn from(error: ConnectionError) -> Self {
        DetailedError { message: error.message, data: error.data }
    }
}

fn error(error: &Option<DetailedError>) -> Option<ConnectionError> {
    error.as_ref().map(ConnectionError::from)
}

/// A relation that a statement touched or that a catalog update answers, empty names for none
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionRelationName {
    pub database_name: String,
    pub schema_name: String,
    pub table_name: String,
}

impl From<&RelationName> for ConnectionRelationName {
    fn from(name: &RelationName) -> Self {
        ConnectionRelationName {
            database_name: name.database_name.clone(),
            schema_name: name.schema_name.clone(),
            table_name: name.table_name.clone(),
        }
    }
}

impl From<ConnectionRelationName> for RelationName {
    fn from(name: ConnectionRelationName) -> Self {
        RelationName { database_name: name.database_name, schema_name: name.schema_name, table_name: name.table_name }
    }
}

fn relations(names: &[RelationName]) -> Vec<ConnectionRelationName> {
    names.iter().map(ConnectionRelationName::from).collect()
}

/// A table name of the analyzer, null for a name that a statement left out
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionTableName {
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub table_name: Option<String>,
}

impl From<ConnectionTableName> for QualifiedTableNameT {
    fn from(name: ConnectionTableName) -> Self {
        let mut table = QualifiedTableNameT::default();
        table.database_name = name.database_name;
        table.schema_name = name.schema_name;
        table.table_name = name.table_name;
        table
    }
}

/// The PKCE challenge of an OAuth flow
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionOAuthPkce {
    pub value: String,
    pub verifier: String,
}

fn pkce(pkce: &Option<OAuthPkceChallenge>) -> Option<ConnectionOAuthPkce> {
    pkce.as_ref().map(|p| ConnectionOAuthPkce { value: p.value.clone(), verifier: p.verifier.clone() })
}

/// A short-lived token, e.g. the code of an OAuth flow
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionTemporaryToken {
    pub token: String,
    pub created_at: String,
}

fn temporary_token(token: &Option<TemporaryToken>) -> Option<ConnectionTemporaryToken> {
    token.as_ref().map(|t| ConnectionTemporaryToken { token: t.token.clone(), created_at: t.created_at.clone() })
}

/// The parameters of the OAuth flow of a Salesforce connection
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSalesforceOAuthParams {
    pub instance_url: String,
    pub app_consumer_key: String,
    pub requested_at: f64,
    pub expires_at: f64,
}

/// The OAuth flow of a Trino connection, the steps that didn't happen yet are null. The access token is opaque JSON.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionTrinoOAuthState {
    pub oauth_pkce: Option<ConnectionOAuthPkce>,
    pub auth_code: Option<ConnectionTemporaryToken>,
    pub access_token: Option<String>,
}

/// The OAuth flow of a Salesforce connection, the steps that didn't happen yet are null. The access tokens are opaque
/// JSON.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSalesforceOAuthState {
    pub oauth_params: Option<ConnectionSalesforceOAuthParams>,
    pub oauth_pkce: Option<ConnectionOAuthPkce>,
    pub core_auth_code: Option<ConnectionTemporaryToken>,
    pub core_access_token: Option<String>,
    pub data_cloud_access_token: Option<String>,
}

/// The details that only one connector keeps, Database.com has the ones of Salesforce
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub enum ConnectionConnectorDetails {
    Hyper,
    Trino { schema_resolution_error: Option<ConnectionError>, oauth_state: Option<ConnectionTrinoOAuthState> },
    Salesforce { setup_error: Option<ConnectionError>, oauth_state: Option<ConnectionSalesforceOAuthState> },
}

impl From<&ConnectorDetails> for ConnectionConnectorDetails {
    fn from(details: &ConnectorDetails) -> Self {
        match details {
            ConnectorDetails::Hyper => Self::Hyper,
            ConnectorDetails::Trino(trino) => Self::Trino {
                schema_resolution_error: error(&trino.schema_resolution_error),
                oauth_state: trino.oauth_state.as_ref().map(|state| ConnectionTrinoOAuthState {
                    oauth_pkce: pkce(&state.oauth_pkce),
                    auth_code: temporary_token(&state.auth_code),
                    access_token: state.access_token.clone(),
                }),
            },
            ConnectorDetails::SalesforceDataCloud(salesforce) | ConnectorDetails::Dbcom(salesforce) => Self::Salesforce {
                setup_error: error(&salesforce.setup_error),
                oauth_state: salesforce.oauth_state.as_ref().map(|state| ConnectionSalesforceOAuthState {
                    oauth_params: state.oauth_params.as_ref().map(|p| ConnectionSalesforceOAuthParams {
                        instance_url: p.instance_url.clone(),
                        app_consumer_key: p.app_consumer_key.clone(),
                        requested_at: p.requested_at,
                        expires_at: p.expires_at,
                    }),
                    oauth_pkce: pkce(&state.oauth_pkce),
                    core_auth_code: temporary_token(&state.core_auth_code),
                    core_access_token: state.core_access_token.clone(),
                    data_cloud_access_token: state.data_cloud_access_token.clone(),
                }),
            },
        }
    }
}

/// When the steps of the setup happened, by the name of the step, only the steps that happened
fn setup_timings(t: &SetupTimings) -> BTreeMap<&'static str, f64> {
    let steps = [
        ("channelSetupStartedAt", t.channel_setup_started_at),
        ("channelSetupCancelledAt", t.channel_setup_cancelled_at),
        ("channelSetupFailedAt", t.channel_setup_failed_at),
        ("channelReadyAt", t.channel_ready_at),
        ("healthCheckStartedAt", t.health_check_started_at),
        ("healthCheckCancelledAt", t.health_check_cancelled_at),
        ("healthCheckFailedAt", t.health_check_failed_at),
        ("healthCheckSucceededAt", t.health_check_succeeded_at),
        ("authStartedAt", t.auth_started_at),
        ("authCancelledAt", t.auth_cancelled_at),
        ("authFailedAt", t.auth_failed_at),
        ("openedNativeAuthLinkAt", t.opened_native_auth_link_at),
        ("openedWebAuthWindowAt", t.opened_web_auth_window_at),
        ("closedWebAuthWindowAt", t.closed_web_auth_window_at),
        ("coreAccessTokenRequestedAt", t.core_access_token_requested_at),
        ("coreAccessTokenReceivedAt", t.core_access_token_received_at),
        ("dataCloudAccessTokenRequestedAt", t.data_cloud_access_token_requested_at),
        ("dataCloudAccessTokenReceivedAt", t.data_cloud_access_token_received_at),
        ("oauthStartedAt", t.oauth_started_at),
        ("oauthCancelledAt", t.oauth_cancelled_at),
        ("oauthFailedAt", t.oauth_failed_at),
        ("oauthBrowserOpenedAt", t.oauth_browser_opened_at),
        ("accessTokenRequestedAt", t.access_token_requested_at),
        ("accessTokenReceivedAt", t.access_token_received_at),
        ("pkceGenStartedAt", t.pkce_gen_started_at),
        ("pkceGenFinishedAt", t.pkce_gen_finished_at),
        ("oauthCodeReceivedAt", t.oauth_code_received_at),
    ];
    steps.into_iter().filter_map(|(step, at)| at.map(|at| (step, at))).collect()
}

/// The details of the setup of a connection
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionDetailsView {
    /// When the steps of the setup happened, by the name of the step, e.g. `channelReadyAt`
    #[tsify(type = "Record<string, number>")]
    pub setup_timings: BTreeMap<&'static str, f64>,
    /// The params of the connector that the setup uses, without the field of the connector
    #[tsify(type = "Record<string, unknown> | null")]
    pub setup_params: Option<JsonObject>,
    pub channel_error: Option<ConnectionError>,
    pub health_check_error: Option<ConnectionError>,
    /// The channel, once it is ready
    pub channel: Option<u32>,
    pub connector: ConnectionConnectorDetails,
}

impl From<&ConnectionDetails> for ConnectionDetailsView {
    fn from(details: &ConnectionDetails) -> Self {
        ConnectionDetailsView {
            setup_timings: setup_timings(&details.setup_timings),
            setup_params: details.setup_params.clone(),
            channel_error: error(&details.channel_error),
            health_check_error: error(&details.health_check_error),
            channel: details.channel,
            connector: (&details.connector).into(),
        }
    }
}

/// A catalog update
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionCatalogUpdateTask {
    pub task_id: u32,
    #[tsify(type = "CatalogUpdateVariant")]
    pub variant: CatalogUpdateVariant,
    #[tsify(type = "CatalogUpdateTaskStatus")]
    pub status: CatalogUpdateTaskStatus,
    pub queries: Vec<u32>,
    pub error: Option<ConnectionError>,
    pub started_at: Option<f64>,
    pub finished_at: Option<f64>,
    pub touched_relations: Vec<ConnectionRelationName>,
}

impl From<&CatalogUpdateTask> for ConnectionCatalogUpdateTask {
    fn from(task: &CatalogUpdateTask) -> Self {
        ConnectionCatalogUpdateTask {
            task_id: task.task_id,
            variant: task.variant.into(),
            status: task.status.into(),
            queries: task.queries.clone(),
            error: error(&task.error),
            started_at: task.started_at,
            finished_at: task.finished_at,
            touched_relations: relations(&task.touched_relations),
        }
    }
}

/// The catalog updates of a connection
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionCatalogUpdates {
    /// The running updates in the order of their ids
    pub tasks_running: Vec<ConnectionCatalogUpdateTask>,
    /// The finished updates in the order of their ids
    pub tasks_finished: Vec<ConnectionCatalogUpdateTask>,
    /// Does the catalog describe the connection?
    pub described: bool,
    /// The running or most recently started full refresh
    pub current_full_refresh: Option<u32>,
    /// The relations that executed statements touched and that no update has answered yet
    pub touched_relations: Vec<ConnectionRelationName>,
    /// The updates in a row that failed to answer them
    pub touched_failures: u32,
}

/// The plain fields of a connection. The queries are read on their own.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionView {
    /// Changes with every change of the connection, not of its queries
    pub revision: u64,
    pub active: bool,
    #[tsify(type = "ConnectionStatus")]
    pub status: ConnectionStatus,
    #[tsify(type = "ConnectionHealth")]
    pub health: ConnectionHealth,
    #[tsify(type = "ConnectorType")]
    pub connector_type: ConnectorType,
    pub name: Option<String>,
    pub cache_query_results: Option<bool>,
    pub details: ConnectionDetailsView,
    pub params: JsonParams,
    pub params_draft: Option<JsonParams>,
    pub setup_attempt_params: Option<JsonParams>,
    pub setup_attempt_draft: Option<JsonParams>,
    pub catalog_updates: ConnectionCatalogUpdates,
    pub relation_entry_id: u32,
    /// The script with the functions of the connection, null once it is deleted
    pub function_script_entry_id: Option<u32>,
}

impl From<&ConnectionState> for ConnectionView {
    fn from(state: &ConnectionState) -> Self {
        let updates = state.catalog_updates();
        ConnectionView {
            revision: state.revision(),
            active: state.active(),
            status: state.status().into(),
            health: state.health().into(),
            connector_type: state.connector_type().into(),
            name: state.name().map(str::to_string),
            cache_query_results: state.cache_query_results(),
            details: state.details().into(),
            params: params_object(state.params()),
            params_draft: state.params_draft().map(params_object),
            setup_attempt_params: state.setup_attempt_params().map(params_object),
            setup_attempt_draft: state.setup_attempt_draft().map(params_object),
            catalog_updates: ConnectionCatalogUpdates {
                tasks_running: updates.tasks_running.values().map(Into::into).collect(),
                tasks_finished: updates.tasks_finished.values().map(Into::into).collect(),
                described: updates.described,
                current_full_refresh: updates.current_full_refresh,
                touched_relations: relations(&updates.touched_relations),
                touched_failures: updates.touched_failures,
            },
            relation_entry_id: state.relation_entry_id(),
            function_script_entry_id: state.function_script().map(|script| script.catalog_entry_id()),
        }
    }
}

/// What the host does after an action, in this order
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ConnectionEffect {
    /// Cancel the setup of the connection that is running, e.g. an OAuth flow
    CancelSetup,
    /// Let the pending publications of catalog batches into the catalog fail
    InvalidateCatalogBatch,
    /// Abort running catalog updates
    AbortCatalogUpdates { task_ids: Vec<u32> },
    /// Stop the queries that were active at the backend, the connection dropped its queries and metrics
    StopQueries { query_ids: Vec<u64> },
    /// Close a channel
    CloseChannel { channel: u32 },
    /// Let go of a channel that the connection no longer uses, without closing it
    ReleaseChannel { channel: u32 },
    /// Nothing shows the result table of a query anymore
    ReleaseResultTable { query_id: u64, table_id: u64 },
}

impl From<&QueryExecutionEffect> for ConnectionEffect {
    fn from(effect: &QueryExecutionEffect) -> Self {
        match effect {
            QueryExecutionEffect::ReleaseResultTable { query_id, table } => {
                ConnectionEffect::ReleaseResultTable { query_id: *query_id, table_id: table.id }
            }
        }
    }
}

/// What an action did: whether it changed the connection or its queries, and the effects for the host
#[derive(Clone, Debug, Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionOutcome {
    /// Did the action change the connection or its queries?
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<ConnectionEffect>,
}
