//! The state of a connection and the actions on it.
//!
//! A connection owns its catalog, the catalog entry of the relations that the catalog loader publishes and the script
//! with the functions of the connection. Its setup runs in the host: the host reports every step as an action, with
//! the time it happened, and the connector of the connection applies it to the details. An action changes the
//! connection in place and returns the effects that the host applies afterwards, e.g. aborting the running catalog
//! updates of a connection that is reset. The host applies them before anything else runs, a pending publication into
//! the catalog then fails before it publishes into the cleared catalog.
//!
//! The query executions of a connection, its metrics and the query actions are the history of `crate::query`, the
//! binding of the core module holds both and clears the history on `ConnectionEffect::StopQueries`.
//!
//! Ported from `reduceConnectionState` of `packages/dashql/src/platform/connections/connection_state.ts`.

mod catalog_updates;
mod details;
pub mod health_check;
mod hyper;
pub mod import;
pub mod open_setup;
pub mod label;
mod params;
pub mod refresh;
pub mod registry;
mod salesforce;
mod trino;

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core::catalog::{Catalog, CatalogEntryId};
use dashql_core::error::{Error, Result};
use dashql_core::script::Script;

pub use catalog_updates::{
    merge_relation_names, read_relation_name, CatalogUpdateTask, CatalogUpdateTaskStatus, CatalogUpdateVariant,
    CatalogUpdates, RelationName, MAX_TOUCHED_ATTEMPTS,
};
pub use details::{
    CatalogNameDefaults, ChannelId, ConnectionDetails, ConnectorDetails, DetailedError, OAuthPkceChallenge,
    SalesforceDetails, SalesforceOAuthParams, SalesforceOAuthState, SetupTimings, TemporaryToken, Timestamp,
    TrinoDetails, TrinoOAuthState,
};
pub use hyper::HyperAction;
pub use params::{
    trino_session_defaults, ConnectionParams, ConnectorFeatures, ConnectorType, JsonObject, TrinoSessionDefaults,
    CONNECTOR_TYPES, DEFAULT_DATABASE_NAME, HYPER_CLOUD_DEFAULT_DATABASE_NAME, HYPER_DEFAULT_SCHEMA,
    SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA,
};
pub use salesforce::SalesforceAction;
pub use trino::TrinoAction;

pub use crate::workbook::CatalogHandle;
use crate::handles::Handle;
use crate::workbook::{new_catalog, next_revision, ScriptConnection, ScriptConnectionProfile};
use dashql_buffers::formatting::FormattingDialect;

/// How far the setup of a connection got
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionStatus {
    NotStarted,

    // The health check
    HealthCheckStarted,
    HealthCheckFailed,
    HealthCheckCancelled,
    HealthCheckSucceeded,

    // The channel setup
    ChannelSetupStarted,
    ChannelSetupFailed,
    ChannelSetupCancelled,
    ChannelReady,

    // OAuth
    AuthStarted,
    AuthCancelled,
    AuthFailed,
    PkceGenerationStarted,
    PkceGenerated,
    WaitingForOAuthCodeViaWindow,
    WaitingForOAuthCodeViaLink,
    OAuthCodeReceived,
    AccessTokenRequested,
    AccessTokenReceived,

    // The OAuth of Salesforce
    DataCloudTokenRequested,
    DataCloudTokenReceived,
    CoreAccessTokenRequested,
    CoreAccessTokenReceived,
}

/// The health of a connection
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionHealth {
    NotStarted,
    Connecting,
    Cancelled,
    Online,
    Failed,
}

impl ConnectionHealth {
    /// Is a connection connected or connecting? An open connection keeps its protocol and can't be merged.
    pub fn is_open(self) -> bool {
        matches!(self, ConnectionHealth::Connecting | ConnectionHealth::Online)
    }
}

impl fmt::Display for ConnectionHealth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ConnectionHealth::NotStarted => "Not Started",
            ConnectionHealth::Connecting => "Connecting",
            ConnectionHealth::Cancelled => "Cancelled",
            ConnectionHealth::Online => "Online",
            ConnectionHealth::Failed => "Failed",
        })
    }
}

/// What the host does after an action, in this order. The channels, the catalog updates and the queries are handles
/// of the host (`crate::handles`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionEffect {
    /// Cancel the setup of the connection that is running, e.g. an OAuth flow
    CancelSetup,
    /// Let the pending publications of catalog batches into the catalog of the connection fail
    InvalidateCatalogBatch,
    /// Drop the queries of the connection and the metrics: the holder of the history clears it, which aborts the
    /// active queries with the reason and releases the handles of all queries
    StopQueries { reason: &'static str },
    /// Abort a handle, e.g. a running catalog update
    Abort { handle: Handle, reason: &'static str },
    /// Cancel a running catalog update of the catalog loader, it ends as cancelled with the reason
    CancelCatalogUpdate { task_id: u32, reason: &'static str },
    /// Close a handle, a channel, and release it
    Close { handle: Handle },
    /// Release a handle, e.g. a channel that the connection no longer uses, without closing it
    Release { handle: Handle },
}

/// An action on a connection
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionAction {
    /// Set the draft of the params, the local settings of the form. Params of another connector are ignored.
    SetDraft(ConnectionParams),
    /// Drop the draft and the errors of the last setup. A connecting connection keeps them.
    DiscardDraft,
    /// The params were saved, they become the params of the connection. The draft is dropped unless it changed while
    /// saving.
    CommitParams(ConnectionParams),
    /// Rename the connection, a blank name removes the name
    Rename(String),
    /// Choose whether the connection caches query results. The connection keeps the choice, also when it matches the
    /// default of the connector.
    SetQueryResultCaching(bool),
    /// Stop the connection and drop its catalog. The registry refuses to delete connections that workbooks use.
    Delete,
    /// Stop the connection and clear its catalog
    Reset,
    /// Switch a connection that was never configured to another connector
    SwitchConnectorType(ConnectorType),

    /// The health check started
    HealthCheckStarted,
    /// The health check was cancelled
    HealthCheckCancelled,
    /// The health check failed
    HealthCheckFailed(DetailedError),
    /// The health check succeeded, the connection is online
    HealthCheckSucceeded,

    /// Executed statements touched relations, the catalog loader asks the connection about them
    RelationsTouched(Vec<QualifiedTableNameT>),
    /// A catalog update started
    UpdateCatalog(CatalogUpdateTask),
    /// A catalog update started a query
    CatalogUpdateRegisterQuery { task_id: u32, query_id: u32 },
    /// A catalog update was cancelled
    CatalogUpdateCancelled { task_id: u32, error: DetailedError },
    /// A catalog update failed
    CatalogUpdateFailed { task_id: u32, error: DetailedError },
    /// A catalog update succeeded
    CatalogUpdateSucceeded { task_id: u32 },
    /// A catalog update succeeded for some databases and failed for others
    CatalogUpdatePartiallySucceeded { task_id: u32, error: DetailedError },

    /// A step of the setup of a Hyper connection
    Hyper(HyperAction),
    /// A step of the setup of a Trino connection
    Trino(TrinoAction),
    /// A step of the setup of a Salesforce or Database.com connection
    Salesforce(SalesforceAction),

    /// A step of a setup attempt (`begin_setup`): a health check or an action of the connector. A step of an attempt
    /// that a later setup, a reset or a delete replaced changes nothing, the channel of a ready step is released.
    SetupStep { epoch: u64, step: Box<ConnectionAction> },
}

impl ConnectionAction {
    /// The channel that a ready step hands to the connection, none for other actions
    pub fn ready_channel(&self) -> Option<ChannelId> {
        match self {
            ConnectionAction::Hyper(HyperAction::ChannelReady { channel, .. })
            | ConnectionAction::Trino(TrinoAction::ChannelReady { channel, .. })
            | ConnectionAction::Salesforce(SalesforceAction::ChannelReady(channel)) => Some(*channel),
            ConnectionAction::SetupStep { step, .. } => step.ready_channel(),
            _ => None,
        }
    }
}

/// What an action did
#[derive(Debug, Default)]
pub struct ConnectionOutcome {
    /// Did the action change the connection?
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<ConnectionEffect>,
}

/// The optional properties of a new connection
#[derive(Debug, Clone, Default)]
pub struct ConnectionStateOptions {
    /// Does the connection belong to a committed workbook or was it connected once?
    pub active: bool,
    /// The params, those of the details by default
    pub params: Option<ConnectionParams>,
    /// The draft of the params
    pub params_draft: Option<ConnectionParams>,
}

/// The state of a connection
pub struct ConnectionState {
    /// The id of the connection
    connection_id: String,
    /// Does the connection belong to a committed workbook or was it online once? Only an active connection saves its
    /// catalog.
    active: bool,
    /// How far the setup got
    status: ConnectionStatus,
    /// The health
    health: ConnectionHealth,
    /// The name the user gave the connection, the label falls back to the connector without it
    name: Option<String>,
    /// Does the connection cache query results? None for the default of the connector.
    cache_query_results: Option<bool>,
    /// The details of the setup, they name the connector
    details: ConnectionDetails,
    /// The params of the last successful setup, the initial ones until then
    params: ConnectionParams,
    /// The local settings of the form, independent of the channel and the OAuth state
    params_draft: Option<ConnectionParams>,
    /// The params of the running setup, never saved
    setup_attempt_params: Option<ConnectionParams>,
    /// The draft when the running setup started, with the raw form rows
    setup_attempt_draft: Option<ConnectionParams>,
    /// The catalog
    catalog: CatalogHandle,
    /// What the scripts on the connection read of it, shared with all of them and updated in place
    script_connection: Rc<ScriptConnection>,
    /// The catalog updates
    catalog_updates: CatalogUpdates,
    /// The catalog entry of the relations of the connection
    relation_entry_id: CatalogEntryId,
    /// The script with the functions of the connection, none once the connection is deleted
    function_script: Option<Script>,
    /// The revision of the connection, it changes with every change
    revision: u64,
    /// The setup attempt whose steps the connection takes, a new setup, a reset and a delete start the next one
    setup_epoch: u64,
}

/// The header of the script with the functions of a connection
fn function_script_header(source: &str, updated_at: Timestamp) -> String {
    format!(
        "-- DashQL Connection Functions.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: {source}
-- Last Refresh: {}

",
        iso_timestamp(updated_at)
    )
}

/// A timestamp in ISO 8601 with milliseconds, e.g. `2026-01-01T00:00:00.000Z`
fn iso_timestamp(ms: Timestamp) -> String {
    let ms = if ms.is_finite() { ms.floor() as i64 } else { 0 };
    let days = ms.div_euclid(86_400_000);
    let time = ms.rem_euclid(86_400_000);
    // The civil date of the days since the epoch, Howard Hinnant's algorithm
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1_000 % 60,
        time % 1_000
    )
}

impl ConnectionState {
    /// A connection with an empty catalog of the runtime (`workbook::new_catalog`)
    pub fn new(connection_id: &str, details: ConnectionDetails, options: ConnectionStateOptions, now: Timestamp) -> Self {
        Self::with_catalog(connection_id, details, options, now, new_catalog())
    }

    /// A connection with an empty catalog of the caller, e.g. one that a restore filled. Scripts publish into it, the
    /// caller creates it with `workbook::new_catalog`.
    pub fn with_catalog(
        connection_id: &str,
        details: ConnectionDetails,
        options: ConnectionStateOptions,
        now: Timestamp,
        catalog: Catalog,
    ) -> Self {
        let relation_entry_id = catalog.allocate_entry_id();
        let mut function_script = Script::new(&catalog);
        function_script.replace_text(&function_script_header("-", now));
        // Details without setup params fall back to the params of a new connection of the connector
        let params = options
            .params
            .or_else(|| details.connection_params())
            .unwrap_or_else(|| ConnectionParams::default_for(details.connector_type()));
        let catalog = Rc::new(RefCell::new(catalog));
        let profile = Self::profile_of(details.connector_type(), &details, &params);
        let script_connection = Rc::new(ScriptConnection::new(connection_id, catalog.clone(), profile));
        let mut state = Self {
            connection_id: connection_id.to_string(),
            active: options.active,
            status: ConnectionStatus::NotStarted,
            health: ConnectionHealth::NotStarted,
            name: None,
            cache_query_results: None,
            details,
            params,
            params_draft: options.params_draft,
            setup_attempt_params: None,
            setup_attempt_draft: None,
            catalog,
            script_connection,
            catalog_updates: CatalogUpdates::default(),
            relation_entry_id,
            function_script: Some(function_script),
            revision: 0,
            setup_epoch: 0,
        };
        state.refresh_script_connection();
        state
    }

    /// What the scripts read of a connection
    fn profile_of(connector: ConnectorType, details: &ConnectionDetails, params: &ConnectionParams) -> ScriptConnectionProfile {
        let defaults = details.catalog_name_defaults();
        ScriptConnectionProfile {
            dialect: if connector == ConnectorType::Trino { FormattingDialect::TRINO } else { FormattingDialect::HYPER },
            local: false,
            params: Some(params.to_json()),
            default_database: defaults.database_name,
            default_schema: defaults.schema_name,
        }
    }

    /// Bring the profile that the scripts share up to date with the connection
    fn refresh_script_connection(&mut self) {
        let mut profile = Self::profile_of(self.connector_type(), &self.details, &self.params);
        profile.local = label::is_hyper_wasm_connection(self);
        self.script_connection.update(profile);
    }

    /// The connection of the scripts on the connection, with its catalog. Every script on the connection shares it,
    /// a change of the connection reaches all of them.
    pub fn script_connection(&self) -> &Rc<ScriptConnection> {
        &self.script_connection
    }

    /// A connection with params
    pub fn from_params(connection_id: &str, params: ConnectionParams, now: Timestamp) -> Self {
        let details = ConnectionDetails::new(&params);
        Self::new(connection_id, details, ConnectionStateOptions { params: Some(params), ..Default::default() }, now)
    }

    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
    pub fn active(&self) -> bool {
        self.active
    }
    pub fn status(&self) -> ConnectionStatus {
        self.status
    }
    pub fn health(&self) -> ConnectionHealth {
        self.health
    }
    pub fn connector_type(&self) -> ConnectorType {
        self.details.connector_type()
    }
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub fn cache_query_results(&self) -> Option<bool> {
        self.cache_query_results
    }
    pub fn details(&self) -> &ConnectionDetails {
        &self.details
    }
    pub fn params(&self) -> &ConnectionParams {
        &self.params
    }
    pub fn params_draft(&self) -> Option<&ConnectionParams> {
        self.params_draft.as_ref()
    }
    pub fn setup_attempt_params(&self) -> Option<&ConnectionParams> {
        self.setup_attempt_params.as_ref()
    }
    pub fn setup_attempt_draft(&self) -> Option<&ConnectionParams> {
        self.setup_attempt_draft.as_ref()
    }
    pub fn catalog(&self) -> &CatalogHandle {
        &self.catalog
    }
    pub fn catalog_updates(&self) -> &CatalogUpdates {
        &self.catalog_updates
    }
    /// Can the user refresh the catalog? An online connection without a running full refresh.
    pub fn can_refresh_catalog(&self) -> bool {
        self.health == ConnectionHealth::Online && !self.catalog_updates.is_refresh_running()
    }
    pub fn relation_entry_id(&self) -> CatalogEntryId {
        self.relation_entry_id
    }
    pub fn function_script(&self) -> Option<&Script> {
        self.function_script.as_ref()
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn setup_epoch(&self) -> u64 {
        self.setup_epoch
    }

    /// Begin a setup attempt: the steps of earlier attempts change nothing from now on. Returns the epoch that the
    /// steps of the attempt carry (`ConnectionAction::SetupStep`).
    pub fn begin_setup(&mut self) -> u64 {
        self.setup_epoch += 1;
        self.setup_epoch
    }

    /// Does the connection cache query results? The connector decides unless the user chose.
    pub fn caches_query_results(&self) -> bool {
        self.cache_query_results.unwrap_or(self.connector_type().features().query_result_caching)
    }

    /// Apply an action that happened at a time. A failed action leaves the connection unchanged.
    pub fn apply(&mut self, action: ConnectionAction, now: Timestamp) -> Result<ConnectionOutcome> {
        let mut outcome = ConnectionOutcome::default();
        match action {
            ConnectionAction::SetDraft(draft) => {
                if draft.connector == self.connector_type() && self.params_draft.as_ref() != Some(&draft) {
                    self.params_draft = Some(draft);
                    outcome.changed = true;
                }
            }
            ConnectionAction::CommitParams(params) => {
                let params = params.without_draft_rows();
                let draft_saved = self.params_draft.as_ref().is_none_or(|draft| draft.without_draft_rows() == params);
                // Committing the params again changes nothing, unless it settles the draft
                let settles_draft = self.params_draft.is_some() && draft_saved;
                if self.params != params || settles_draft {
                    self.params = params;
                    if draft_saved {
                        self.params_draft = None;
                    }
                    outcome.changed = true;
                }
            }
            ConnectionAction::Rename(name) => {
                let name = Some(name.trim().to_string()).filter(|name| !name.is_empty());
                if name != self.name {
                    self.name = name;
                    outcome.changed = true;
                }
            }
            ConnectionAction::SetQueryResultCaching(caching) => {
                if self.cache_query_results != Some(caching) {
                    self.cache_query_results = Some(caching);
                    outcome.changed = true;
                }
            }
            ConnectionAction::DiscardDraft => {
                if self.health != ConnectionHealth::Connecting {
                    let dropped = self.params_draft.take().is_some();
                    outcome.changed = self.details.clear_errors() || dropped;
                }
            }
            ConnectionAction::SwitchConnectorType(connector) => {
                // Only a connection that was never configured switches
                let configured =
                    self.status != ConnectionStatus::NotStarted || self.active || self.params_draft.is_some();
                if !configured && connector != self.connector_type() {
                    if let Some(handle) = self.details.channel {
                        outcome.effects.push(ConnectionEffect::Release { handle });
                    }
                    self.details = ConnectionDetails::default_for(connector);
                    self.params = ConnectionParams::default_for(connector);
                    self.params_draft = None;
                    self.setup_attempt_params = None;
                    self.setup_attempt_draft = None;
                    outcome.changed = true;
                }
            }
            ConnectionAction::Reset => {
                let catalog = self.catalog.clone();
                let mut catalog = catalog.try_borrow_mut().map_err(|_| Error::invalid_argument("the catalog is in use"))?;
                // Pending publishers are stopped before the catalog is cleared
                self.stop("Connection was reset", &mut outcome.effects);
                catalog.clear();
                outcome.changed = true;
            }
            ConnectionAction::Delete => {
                let catalog = self.catalog.clone();
                let mut catalog = catalog.try_borrow_mut().map_err(|_| Error::invalid_argument("the catalog is in use"))?;
                self.stop("Connection was deleted", &mut outcome.effects);
                // The descriptors may have been dropped already, that is no error
                let _ = catalog.drop_descriptor(self.relation_entry_id);
                if let Some(script) = self.function_script.take() {
                    let _ = catalog.drop_descriptor(script.catalog_entry_id());
                }
                // Other holders of the catalog see it empty, it drops with the last of them
                catalog.clear();
                outcome.changed = true;
            }
            ConnectionAction::RelationsTouched(names) => {
                // A name without a database needs one, without a default the statement can't have touched anything
                let defaults = self.details.catalog_name_defaults();
                let relations: Vec<RelationName> = names
                    .iter()
                    .map(|name| read_relation_name(name, &defaults.database_name))
                    .filter(|relation| !relation.database_name.is_empty())
                    .collect();
                outcome.changed = self.catalog_updates.touch(&relations);
            }
            ConnectionAction::UpdateCatalog(task) => {
                // An update that replaces one of the same id lets go of its handle
                if let Some(handle) = self.catalog_updates.start(task) {
                    outcome.effects.push(ConnectionEffect::Release { handle });
                }
                outcome.changed = true;
            }
            ConnectionAction::CatalogUpdateRegisterQuery { task_id, query_id } => {
                outcome.changed = self.catalog_updates.register_query(task_id, query_id);
            }
            ConnectionAction::CatalogUpdateCancelled { task_id, error } => {
                outcome.changed = self.catalog_updates.finish(task_id, CatalogUpdateTaskStatus::Cancelled, Some(error), now);
            }
            ConnectionAction::CatalogUpdateFailed { task_id, error } => {
                outcome.changed = self.catalog_updates.finish(task_id, CatalogUpdateTaskStatus::Failed, Some(error), now);
            }
            ConnectionAction::CatalogUpdateSucceeded { task_id } => {
                outcome.changed = self.catalog_updates.finish(task_id, CatalogUpdateTaskStatus::Succeeded, None, now);
            }
            ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, error } => {
                outcome.changed =
                    self.catalog_updates.finish(task_id, CatalogUpdateTaskStatus::PartiallySucceeded, Some(error), now);
            }
            ConnectionAction::SetupStep { epoch, step } => {
                if epoch == self.setup_epoch && !matches!(*step, ConnectionAction::SetupStep { .. }) {
                    return self.apply(*step, now);
                }
                // A step of an attempt that was replaced, e.g. the failure of a setup that a newer one cancelled
                if let Some(handle) = step.ready_channel() {
                    outcome.effects.push(ConnectionEffect::Release { handle });
                }
                return Ok(outcome);
            }
            ConnectionAction::Trino(TrinoAction::AccessTokenRefreshed { channel, token }) => {
                // Only the channel that the connection uses updates its token
                if let Some(trino) = self.details.trino_mut().filter(|trino| trino.channel.as_ref().is_some_and(|c| c.same(&channel))) {
                    trino.oauth_state.get_or_insert_with(Default::default).access_token = Some(token);
                    outcome.changed = true;
                }
            }
            action @ (ConnectionAction::HealthCheckStarted
            | ConnectionAction::HealthCheckCancelled
            | ConnectionAction::HealthCheckFailed(_)
            | ConnectionAction::HealthCheckSucceeded
            | ConnectionAction::Hyper(_)
            | ConnectionAction::Trino(_)
            | ConnectionAction::Salesforce(_)) => self.apply_setup(action, now, &mut outcome)?,
        }
        if outcome.changed {
            self.revision = next_revision();
            self.refresh_script_connection();
        }
        Ok(outcome)
    }

    /// Restore the state of the catalog updates that the files of a restored catalog hold: whether the catalog
    /// describes the connection and the relations that no update answered yet
    pub fn restore_catalog_updates(&mut self, described: Option<bool>, touched_relations: Option<Vec<RelationName>>) {
        if let Some(described) = described {
            self.catalog_updates.described = described;
        }
        if let Some(touched_relations) = touched_relations {
            self.catalog_updates.touched_relations = touched_relations;
        }
        self.revision = next_revision();
    }

    /// Replace the text of the script with the functions of the connection, the catalog loader publishes its
    /// descriptor. A deleted connection has no script.
    pub fn replace_function_script_text(&mut self, text: &str) -> Result<()> {
        let script = self.function_script.as_mut().ok_or_else(|| Error::invalid_argument("the connection was deleted"))?;
        script.replace_text(text);
        Ok(())
    }

    /// Apply a step of the setup: a health check or an action of the connector. A setup that brings the connection
    /// online makes its params the params of the connection.
    fn apply_setup(&mut self, action: ConnectionAction, now: Timestamp, outcome: &mut ConnectionOutcome) -> Result<()> {
        let connector = self.connector_type();
        let foreign = match &action {
            ConnectionAction::Hyper(_) => connector != ConnectorType::Hyper,
            ConnectionAction::Trino(_) => connector != ConnectorType::Trino,
            ConnectionAction::Salesforce(_) => !connector.is_salesforce(),
            _ => false,
        };
        if foreign {
            return Err(Error::invalid_argument(format!(
                "a setup action of another connector on a {} connection",
                connector.params_key()
            )));
        }

        // The input of a setup is captured before the connector replaces the setup params
        let (attempt_params, attempt_draft) = match &action {
            ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params }) => {
                (Some(ConnectionParams::new(ConnectorType::Hyper, params.clone())), self.params_draft.clone())
            }
            ConnectionAction::Trino(TrinoAction::OAuthStarted { params } | TrinoAction::ChannelSetupStarted { params }) => {
                // The channel setup after an OAuth flow continues the attempt of the flow
                let draft = if self.setup_attempt_params.is_none() {
                    self.params_draft.clone()
                } else {
                    self.setup_attempt_draft.clone()
                };
                (Some(ConnectionParams::new(ConnectorType::Trino, params.clone())), draft)
            }
            ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params }) => {
                (Some(ConnectionParams::new(connector, params.clone())), self.params_draft.clone())
            }
            _ => (self.setup_attempt_params.take(), self.setup_attempt_draft.take()),
        };

        let previous_health = self.health;
        match action {
            ConnectionAction::HealthCheckStarted => {
                self.status = ConnectionStatus::HealthCheckStarted;
                self.health = ConnectionHealth::Connecting;
                self.details.setup_timings.health_check_started_at = Some(now);
            }
            ConnectionAction::HealthCheckFailed(error) => {
                self.status = ConnectionStatus::HealthCheckFailed;
                self.health = ConnectionHealth::Failed;
                self.details.setup_timings.health_check_failed_at = Some(now);
                self.details.health_check_error = Some(error);
            }
            ConnectionAction::HealthCheckCancelled => {
                self.status = ConnectionStatus::HealthCheckCancelled;
                self.health = ConnectionHealth::Cancelled;
                self.details.setup_timings.health_check_cancelled_at = Some(now);
            }
            ConnectionAction::HealthCheckSucceeded => {
                self.status = ConnectionStatus::HealthCheckSucceeded;
                self.health = ConnectionHealth::Online;
                self.details.setup_timings.health_check_succeeded_at = Some(now);
            }
            ConnectionAction::Hyper(action) => hyper::reduce(self, action, now, &mut outcome.effects),
            ConnectionAction::Trino(action) => trino::reduce(self, action, now, &mut outcome.effects),
            ConnectionAction::Salesforce(action) => salesforce::reduce(self, action, now, &mut outcome.effects),
            _ => {}
        }
        self.setup_attempt_params = attempt_params;
        self.setup_attempt_draft = attempt_draft;

        if self.health == ConnectionHealth::Online && previous_health != ConnectionHealth::Online {
            if let Some(attempt) = self.setup_attempt_params.take() {
                // The params of the setup become the params of the connection
                let attempt_draft = self.setup_attempt_draft.take();
                let params = attempt.without_draft_rows();
                // The draft goes if it didn't change during the setup and the setup used it
                let draft_settled = self.params_draft == attempt_draft
                    && attempt_draft.as_ref().is_none_or(|draft| draft.without_draft_rows() == params);
                if draft_settled {
                    self.params_draft = None;
                }
                self.params = params;
                // A Salesforce login keeps the account that the user info resolved
                if connector.is_salesforce() && attempt.connector == connector {
                    let mut salesforce = attempt.params;
                    // A login of `null` counts as none
                    let login_of = |params: Option<&JsonObject>| {
                        params.and_then(|params| params.get("login")).filter(|login| !login.is_null()).cloned()
                    };
                    let login = login_of(self.details.setup_params.as_ref()).or_else(|| login_of(Some(&salesforce)));
                    match login {
                        Some(login) => salesforce.insert("login".to_string(), login),
                        None => salesforce.remove("login"),
                    };
                    self.params = ConnectionParams::new(connector, salesforce);
                }
            }
        } else if matches!(self.health, ConnectionHealth::Failed | ConnectionHealth::Cancelled) {
            self.setup_attempt_params = None;
            self.setup_attempt_draft = None;
        }

        // Embedded connectors are online as soon as their channel is ready, without a health check. A connection
        // becomes active the first time it is online.
        if self.health == ConnectionHealth::Online {
            self.active = true;
        }
        outcome.changed = true;
        Ok(())
    }

    /// Stop a connection that is reset or deleted: cancel the setup, the catalog updates and the queries, close the
    /// channel. The catalog updates release their handles.
    fn stop(&mut self, reason: &'static str, effects: &mut Vec<ConnectionEffect>) {
        // The steps of the setup that runs change nothing anymore
        self.setup_epoch += 1;
        effects.push(ConnectionEffect::CancelSetup);
        effects.push(ConnectionEffect::InvalidateCatalogBatch);
        let updates = std::mem::take(&mut self.catalog_updates);
        for task_id in updates.tasks_running.keys() {
            effects.push(ConnectionEffect::CancelCatalogUpdate { task_id: *task_id, reason });
        }
        for handle in updates.tasks_running.values().filter_map(|task| task.handle) {
            effects.push(ConnectionEffect::Abort { handle, reason });
        }
        let tasks = updates.tasks_running.values().chain(updates.tasks_finished.values());
        for handle in tasks.filter_map(|task| task.handle) {
            effects.push(ConnectionEffect::Release { handle });
        }
        // The queries run on the channel of the stopped connection, the host stops them at the backend
        effects.push(ConnectionEffect::StopQueries { reason });
        self.status = ConnectionStatus::NotStarted;
        self.health = ConnectionHealth::NotStarted;
        self.setup_attempt_params = None;
        self.setup_attempt_draft = None;
        self.details.reset(effects);
    }
}

