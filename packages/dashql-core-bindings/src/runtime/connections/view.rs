//! The views of a connection and of its saves: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`) with TypeScript
//! declarations in the generated `.d.ts` (`tsify`). See docs/design/dashql_core.md.
//!
//! The channels, the catalog updates and the queries are named by their ids. Times are milliseconds since epoch, a
//! missing value is null. The params of a connector and the access tokens are opaque JSON: the params cross as plain
//! objects, the tokens as their text. The status, the health, the connector and the catalog updates are numeric enums
//! of the module with the names and numbers of the app (`app_enum!`).

use std::collections::BTreeMap;

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core_runtime::connections::{
    self as rt, CatalogUpdateTask, ConnectionChannel, ConnectionDetails, ConnectionParams, ConnectionState, ConnectorDetails, DetailedError, JsonObject,
    RelationName, SetupTimings,
};
use dashql_core_runtime::connections::label::{self, ConnectionLabelParts};
use dashql_core_runtime::connections::registry::ListedConnection;
use dashql_core_runtime::hyper::local_cloud::embedded_cloud_databases;
use dashql_core_runtime::hyper::link as rt_link;
use dashql_core_runtime::query::QueryExecutionHistory;
use dashql_core_storage::storage::WriteOutcome;

use crate::query_history::view::QueryHistoryMetrics;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::runtime::storage::view::StorageWriteOutcome;
use crate::views::{app_enum, JsonValue};

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

/// A token of a connection without its secret: the facts around it that the views show, e.g. the instance or the
/// expiry. The token itself stays in the runtime, `Runtime.revealConnectionSecrets` hands it out on request.
#[derive(Clone, Debug, Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionTokenSummary {
    pub token_type: Option<String>,
    pub scope: Option<String>,
    /// The instance that the token is for, e.g. the org of Salesforce or the tenant of Data Cloud
    pub instance_url: Option<String>,
    /// The tenant or org that the token names, e.g. the audience of the Data Cloud JWT
    pub tenant_id: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
}

/// The summary of opaque token JSON, a token that isn't JSON is summarized as present
fn token_summary(token: &Option<String>) -> Option<ConnectionTokenSummary> {
    let token = token.as_ref()?;
    let value: serde_json::Value = serde_json::from_str(token).unwrap_or_default();
    let text = |pointer: &str| value.pointer(pointer).and_then(serde_json::Value::as_str).map(str::to_string);
    Some(ConnectionTokenSummary {
        token_type: text("/tokenType"),
        scope: text("/scope"),
        instance_url: text("/instanceUrl"),
        tenant_id: text("/jwt/payload/audienceTenantId"),
        issued_at: text("/issuedAt").or_else(|| text("/createdAt")),
        expires_at: text("/expiresAt"),
    })
}

/// The tokens of the channel of a connection as their JSON: the OAuth token of Trino, the core and the Data Cloud token
/// of Salesforce. The channel is their one owner.
fn channel_tokens(details: &ConnectionDetails) -> ConnectionSecrets {
    match details.channel.as_ref() {
        Some(ConnectionChannel::Trino(trino)) => {
            ConnectionSecrets { access_token: trino.access_token().map(|token| token.to_json().to_string()), ..Default::default() }
        }
        Some(ConnectionChannel::Salesforce(salesforce)) => {
            let tokens = salesforce.tokens();
            ConnectionSecrets {
                access_token: None,
                core_access_token: serde_json::to_string(&tokens.core).ok(),
                data_cloud_access_token: serde_json::to_string(&tokens.data_cloud).ok(),
            }
        }
        _ => ConnectionSecrets::default(),
    }
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

/// The OAuth flow of a Trino connection, the steps that didn't happen yet are null. The PKCE verifier, the code and
/// the token stay in the runtime.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionTrinoOAuthState {
    /// Was the PKCE challenge generated?
    pub pkce_generated: bool,
    /// When the code arrived
    pub auth_code_received_at: Option<String>,
    pub access_token: Option<ConnectionTokenSummary>,
}

/// The OAuth flow of a Salesforce connection, the steps that didn't happen yet are null. The PKCE verifier, the code
/// and the tokens stay in the runtime.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSalesforceOAuthState {
    pub oauth_params: Option<ConnectionSalesforceOAuthParams>,
    /// Was the PKCE challenge generated?
    pub pkce_generated: bool,
    /// When the code of the core login arrived
    pub core_auth_code_received_at: Option<String>,
    pub core_access_token: Option<ConnectionTokenSummary>,
    pub data_cloud_access_token: Option<ConnectionTokenSummary>,
}

/// The tokens of a connection as their JSON, null for a token that the connection doesn't hold. Only
/// `Runtime.revealConnectionSecrets` hands them out, the views summarize them.
#[derive(Clone, Debug, Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSecrets {
    /// The OAuth token of a Trino connection
    pub access_token: Option<String>,
    /// The core token of a Salesforce connection
    pub core_access_token: Option<String>,
    /// The Data Cloud token of a Salesforce connection
    pub data_cloud_access_token: Option<String>,
}

impl ConnectionSecrets {
    /// The tokens of a connection, the ones that its channel holds
    pub fn of(details: &ConnectionDetails) -> Self {
        channel_tokens(details)
    }
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

impl From<&ConnectionDetails> for ConnectionConnectorDetails {
    fn from(connection: &ConnectionDetails) -> Self {
        let tokens = channel_tokens(connection);
        match &connection.connector {
            ConnectorDetails::Hyper => Self::Hyper,
            ConnectorDetails::Trino(trino) => Self::Trino {
                schema_resolution_error: error(&trino.schema_resolution_error),
                oauth_state: trino.oauth_state.as_ref().map(|state| ConnectionTrinoOAuthState {
                    pkce_generated: state.pkce_generated,
                    auth_code_received_at: state.auth_code_received_at.clone(),
                    access_token: token_summary(&tokens.access_token),
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
                    pkce_generated: state.pkce_generated,
                    core_auth_code_received_at: state.core_auth_code_received_at.clone(),
                    core_access_token: token_summary(&tokens.core_access_token),
                    data_cloud_access_token: token_summary(&tokens.data_cloud_access_token),
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
    /// The handle of a channel of the host, once it is ready: the embedded Hyper or Hyper over gRPC. The channels that
    /// the runtime speaks itself have none.
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
            channel: details.channel.as_ref().and_then(ConnectionChannel::host_handle),
            connector: details.into(),
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
    /// The handle of the record of the update at the host: its cancellation and its error
    pub handle: Option<u32>,
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
            handle: task.handle,
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
    /// Might the catalog miss what executed statements did, since asking the connection failed too often?
    pub out_of_date: bool,
    /// Is the current full refresh running?
    pub refresh_running: bool,
}

/// The database and schema of the relations that unqualified statements of a connection create or drop
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionNameDefaults {
    pub database_name: String,
    pub schema_name: String,
}

/// The state of saving a connection: whether it saves and the outcome of the last save
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSaveView {
    /// Is the connection being saved?
    pub saving: bool,
    /// The outcome of the last save, null before one
    pub outcome: Option<ConnectionSaveOutcome>,
}

/// The label of a connection: its name and the protocol it speaks
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionLabel {
    /// The name, e.g. `Hyper`, `Hyper #2` or the name the user gave the connection
    pub name: String,
    /// The name of the connector, e.g. `Hyper`
    pub connector: String,
    /// The protocol, e.g. `Wasm` or `Http`
    pub detail: String,
    /// The label as plain text, e.g. `Hyper #2 Wasm`
    pub text: String,
}

impl From<ConnectionLabelParts> for ConnectionLabel {
    fn from(parts: ConnectionLabelParts) -> Self {
        let text = parts.text();
        ConnectionLabel { name: parts.name, connector: parts.connector, detail: parts.detail, text }
    }
}

/// A database of the clouds folder that a connection of the embedded Hyper attaches
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionCloudDatabase {
    /// The path relative to the OPFS folder of the app, e.g. `clouds/local.hyper`
    pub path: String,
    /// The alias of the database in the session
    pub alias: String,
}

/// A connection, the slice `connection` of the runtime. The field names are the ones the app reads. The queries are
/// listed by id, each one is a slice `query` of its own: the connection changes when a query starts or finishes, not
/// with the progress of a query.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null, hashmap_as_object)]
pub struct ConnectionView {
    pub connection_id: String,
    /// Does the connection belong to a committed workbook or was it online once?
    pub active: bool,
    #[tsify(type = "ConnectionStatus")]
    pub connection_status: ConnectionStatus,
    #[tsify(type = "ConnectionHealth")]
    pub connection_health: ConnectionHealth,
    #[tsify(type = "ConnectorType")]
    pub connector_type: ConnectorType,
    /// The name the user gave the connection, the label falls back to the connector without it
    pub name: Option<String>,
    /// The label of the connection without the ordinal of the list, see `ConnectionListEntry.label`
    pub label: ConnectionLabel,
    /// Is the connection the embedded Hyper of the app? A connection of the embedded Hyper that attaches a database of
    /// the clouds folder, a local cloud, is a connection of its own like one to a server.
    pub embedded: bool,
    /// Is the connection a local cloud, a connection of the embedded Hyper that attaches the database of the local
    /// cloud?
    pub local_cloud: bool,
    /// Can the connection be a cloud, does it keep the tables of DashQL?
    pub cloud_capable: bool,
    /// Does the connection offer an operational overview?
    pub supports_overview: bool,
    /// Does the connection speak to the Hyper of a link? Its token stays in the storage of the tab.
    pub hyper_link: bool,
    /// The databases of the clouds folder that the params attach to the embedded Hyper, dropped with the connection
    pub cloud_databases: Vec<ConnectionCloudDatabase>,
    /// Does the connection cache query results? Null for the default of the connector.
    pub cache_query_results: Option<bool>,
    /// Does the connection cache query results, the choice of the user or the default of the connector?
    pub caches_query_results: bool,
    /// Is the connection connected or connecting? An open connection keeps its protocol and can't be merged.
    pub open: bool,
    /// The health as the app prints it, e.g. `Not Started`
    pub health_label: String,
    /// Can the queries of the connection read the data files that are attached to a workbook? The embedded Hyper reads
    /// them.
    pub reads_attachments: bool,
    pub details: ConnectionDetailsView,
    /// The params of the last successful setup, the initial ones until then
    pub params: JsonParams,
    /// The local settings of the form
    pub params_draft: Option<JsonParams>,
    /// The params of the running setup, never saved
    pub setup_attempt_params: Option<JsonParams>,
    /// The draft when the running setup started
    pub setup_attempt_draft: Option<JsonParams>,
    pub catalog_updates: ConnectionCatalogUpdates,
    /// The catalog entry of the relations of the connection
    pub catalog_relation_entry_id: u32,
    /// The database and schema of the relations that unqualified statements create or drop
    pub catalog_name_defaults: ConnectionNameDefaults,
    /// The script with the functions of the connection, null once it is deleted
    pub function_script_entry_id: Option<u32>,
    /// The metrics of the finished queries
    pub metrics: QueryHistoryMetrics,
    /// The active queries in the order they started
    pub queries_active_ordered: Vec<u64>,
    /// The active queries that run on the connection, not the queries of the computations that it only tracks
    pub queries_running: u32,
    /// The finished queries in the order they finished
    pub queries_finished_ordered: Vec<u64>,
    /// Changes whenever a query starts or finishes
    pub snapshot_queries_active_finished: u64,
    /// The workbooks that use the connection
    pub workbooks: Vec<String>,
    /// Saving the connection
    pub save: ConnectionSaveView,
    /// Can the user refresh the catalog: is the connection online without a running full refresh?
    pub can_refresh: bool,
    /// Does a setup of the connection run?
    pub setup_running: bool,
    /// Counts the announcements of a new catalog: the scripts that use the connection are analyzed again with it
    pub catalog_version: u64,
    /// The identity of the catalog of the connection: a connection that is created again under the same id has another
    /// catalog, a handle of the catalog (`Runtime.catalog`) goes with its identity
    pub catalog_id: u64,
}

impl ConnectionView {
    /// The view of a connection with its queries, the workbooks that use it and its save
    pub fn of(state: &ConnectionState, queries: &QueryExecutionHistory, workbooks: &[String], save: ConnectionSaveView) -> Self {
        let updates = state.catalog_updates();
        let metrics = queries.metrics();
        ConnectionView {
            connection_id: state.connection_id().to_string(),
            active: state.active(),
            connection_status: state.status().into(),
            connection_health: state.health().into(),
            connector_type: state.connector_type().into(),
            name: state.name().map(str::to_string),
            label: label::connection_label_parts(state, None).into(),
            embedded: label::is_hyper_wasm_connection(state),
            local_cloud: label::is_local_cloud(state.params()),
            cloud_capable: label::is_cloud_capable(state.params()),
            supports_overview: label::supports_connection_overview(state),
            hyper_link: rt_link::is_hyper_link_params(state.params()),
            cloud_databases: match state.params().connector {
                rt::ConnectorType::Hyper => embedded_cloud_databases(Some(&state.params().params))
                    .into_iter()
                    .map(|database| ConnectionCloudDatabase { path: database.path, alias: database.alias })
                    .collect(),
                _ => Vec::new(),
            },
            cache_query_results: state.cache_query_results(),
            caches_query_results: state.caches_query_results(),
            open: state.health().is_open(),
            health_label: state.health().to_string(),
            reads_attachments: dashql_core_runtime::hyper::descriptor::reads_attachments(state.details()),
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
                out_of_date: updates.is_out_of_date(),
                refresh_running: updates.is_refresh_running(),
            },
            catalog_relation_entry_id: state.relation_entry_id(),
            catalog_name_defaults: {
                let defaults = state.details().catalog_name_defaults();
                ConnectionNameDefaults { database_name: defaults.database_name, schema_name: defaults.schema_name }
            },
            function_script_entry_id: state.function_script().map(|script| script.catalog_entry_id()),
            metrics: QueryHistoryMetrics {
                successful_queries: (&metrics.successful_queries).into(),
                canceled_queries: (&metrics.canceled_queries).into(),
                failed_queries: (&metrics.failed_queries).into(),
            },
            queries_active_ordered: queries.active_ids().to_vec(),
            queries_running: queries
                .active_ids()
                .iter()
                .filter_map(|id| queries.query(*id))
                .filter(|query| query.query_metadata.query_type != dashql_core_runtime::query::QueryType::InternalSqlframe)
                .count() as u32,
            queries_finished_ordered: queries.finished_ids().to_vec(),
            snapshot_queries_active_finished: queries.snapshot_queries_active_finished(),
            workbooks: workbooks.to_vec(),
            save,
            can_refresh: state.can_refresh_catalog(),
            setup_running: false,
            catalog_version: 0,
            catalog_id: 0,
        }
    }
}

/// A connection of the list of connections
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionListEntry {
    pub connection_id: String,
    #[tsify(type = "ConnectorType")]
    pub connector_type: ConnectorType,
    pub active: bool,
    /// Is the connection listed next to the workbooks? Connections that workbooks use are, as are active ones.
    pub listed: bool,
    /// The number of the connection among the listed connections of its connector from 1, null if it is the only one
    pub ordinal: Option<u32>,
    /// The label of the connection with its ordinal, e.g. `Hyper #2 Wasm`
    pub label: ConnectionLabel,
}


/// The connections of the runtime, the slice `connectionList`
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionListView {
    /// The connections in the order they were registered
    pub connections: Vec<ConnectionListEntry>,
    /// The ids of the connections by connector, in the order they were registered
    pub connections_by_type: Vec<Vec<String>>,
}

impl ConnectionListView {
    /// The list as DashQL shows it: a connection is listed next to the workbooks when workbooks use it or it is
    /// active, the listed connections of a connector are numbered when there are several
    pub fn of(listed: &[ListedConnection]) -> Self {
        let mut connections: Vec<ConnectionListEntry> = listed
            .iter()
            .map(|connection| ConnectionListEntry {
                connection_id: connection.connection_id.clone(),
                connector_type: connection.connector_type.into(),
                active: connection.active,
                listed: connection.used || connection.active,
                ordinal: None,
                label: label::label_parts(connection.connector_type, connection.name.as_deref(), connection.label_detail, None).into(),
            })
            .collect();
        for connector in rt::CONNECTOR_TYPES {
            let of_connector = |entry: &ConnectionListEntry, listed: &ListedConnection| entry.listed && listed.connector_type == connector;
            if connections.iter().zip(listed).filter(|(entry, listed)| of_connector(entry, listed)).count() < 2 {
                continue;
            }
            let mut next = 0;
            for (entry, listed) in connections.iter_mut().zip(listed) {
                if of_connector(entry, listed) {
                    next += 1;
                    entry.ordinal = Some(next);
                    entry.label =
                        label::label_parts(listed.connector_type, listed.name.as_deref(), listed.label_detail, Some(next)).into();
                }
            }
        }
        let connections_by_type = rt::CONNECTOR_TYPES
            .iter()
            .map(|connector| listed.iter().filter(|c| c.connector_type == *connector).map(|c| c.connection_id.clone()).collect())
            .collect();
        ConnectionListView { connections, connections_by_type }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listed(id: &str, connector_type: rt::ConnectorType, active: bool, used: bool) -> ListedConnection {
        ListedConnection { connection_id: id.to_string(), connector_type, active, used, name: None, label_detail: "Http" }
    }

    #[test]
    fn lists_what_workbooks_use_or_is_active_and_numbers_the_listed_connections_of_a_connector() {
        let view = ConnectionListView::of(&[
            listed("a", rt::ConnectorType::Trino, true, false),
            listed("b", rt::ConnectorType::Hyper, false, false),
            listed("c", rt::ConnectorType::Trino, false, false),
        ]);
        let shown: Vec<(bool, Option<u32>)> = view.connections.iter().map(|c| (c.listed, c.ordinal)).collect();
        assert_eq!(shown, [(true, None), (false, None), (false, None)]);
        // Once a workbook uses c, both Trino connections are listed and numbered
        let view = ConnectionListView::of(&[
            listed("a", rt::ConnectorType::Trino, true, false),
            listed("b", rt::ConnectorType::Hyper, false, false),
            listed("c", rt::ConnectorType::Trino, false, true),
        ]);
        let ordinals: Vec<Option<u32>> = view.connections.iter().map(|c| c.ordinal).collect();
        assert_eq!(ordinals, [Some(1), None, Some(2)]);
        let labels: Vec<&str> = view.connections.iter().map(|c| c.label.text.as_str()).collect();
        assert_eq!(labels, ["Trino #1 Http", "Hyper Http", "Trino #2 Http"]);
    }
}

/// The outcome of writing the copy of a connection into a workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionCopyOutcome {
    pub workbook_id: String,
    pub result: StorageWriteOutcome,
}

pub(crate) fn copies(copies: Vec<(String, WriteOutcome)>) -> Vec<ConnectionCopyOutcome> {
    let copy = |(workbook_id, outcome): (String, WriteOutcome)| ConnectionCopyOutcome { workbook_id, result: outcome.into() };
    copies.into_iter().map(copy).collect()
}

/// The outcome of saving a connection
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ConnectionSaveOutcome {
    /// The saved params
    #[tsify(type = "JsonParams")]
    pub params: JsonValue,
    /// The outcome of writing the app manifest
    pub manifest: StorageWriteOutcome,
    /// The outcomes of writing the copies of the workbooks, none if the manifest wasn't written
    pub workbooks: Vec<ConnectionCopyOutcome>,
}

/// The connection that a Hyper link binds to (`hyper::link::HyperLinkBinding`)
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum HyperLinkBindingView {
    /// A connection speaks to the endpoint of the link already
    #[serde(rename = "existing")]
    Existing {
        #[serde(rename = "connectionId")]
        connection_id: String,
    },
    /// The user may reuse the connection of an earlier link, which then moves to the endpoint of the link with the
    /// params. Declining creates a connection with `create`.
    #[serde(rename = "askToReuse")]
    AskToReuse {
        #[serde(rename = "connectionId")]
        connection_id: String,
        #[tsify(type = "JsonParams")]
        params: JsonValue,
        #[tsify(type = "JsonParams")]
        create: JsonValue,
    },
    /// Create an active connection with the params
    #[serde(rename = "create")]
    Create {
        #[tsify(type = "JsonParams")]
        params: JsonValue,
    },
}

/// A Hyper link that the app follows: its target, the question to ask before the app uses it and the connection it
/// binds to
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct HyperLinkView {
    /// The origin of the HTTP API of the Hyper
    pub endpoint: String,
    /// The bearer token of the Hyper
    pub token: String,
    /// The question to confirm before the app uses the link, none for a link to this machine or to the endpoint of a
    /// connection
    pub confirmation: Option<String>,
    pub binding: HyperLinkBindingView,
}

impl HyperLinkView {
    /// The view of a link and its binding
    pub fn of(target: rt_link::HyperLinkTarget, binding: rt_link::HyperLinkBinding) -> Self {
        let params = |params: dashql_core_runtime::connections::ConnectionParams| JsonValue(serde_json::Value::Object(params.to_object()));
        let confirmation = match binding {
            rt_link::HyperLinkBinding::Existing { .. } => None,
            _ => rt_link::hyper_link_confirmation(&target),
        };
        let binding = match binding {
            rt_link::HyperLinkBinding::Existing { connection_id } => HyperLinkBindingView::Existing { connection_id },
            rt_link::HyperLinkBinding::AskToReuse { connection_id, params: reused, create } => {
                HyperLinkBindingView::AskToReuse { connection_id, params: params(reused), create: params(create) }
            }
            rt_link::HyperLinkBinding::Create { params: created } => HyperLinkBindingView::Create { params: params(created) },
        };
        HyperLinkView { endpoint: target.endpoint, token: target.token, confirmation, binding }
    }
}
