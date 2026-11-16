//! The compute host of the runtime: the compute database of the platform, with the SELECTs that create the tables of
//! the tasks tracked in a query history.
//!
//! A task of a computation creates its tables with SELECTs on the compute database. The runtime lists them in the
//! query history of the connection that ran the query of the result, or in a history without a connection that the
//! analysis named, e.g. the one of the shell. The query is opened before the call and closed after it; a reset of the
//! connection stops it like a query of the connection, the call of the run is aborted.

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, KeptTable, RunId};
use dashql_core_runtime::compute::types::TableId;
use dashql_core_runtime::compute::ComputationEffect;
use dashql_core_runtime::connections::registry::QueryOwner;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionState, QueryId, QueryMetadata, QueryType};

use super::connections::Connections;
use crate::host::JsPlatform;

/// The issuer of the queries of the computations in a history
const ISSUER: &str = "SQLFrame";

struct Inner {
    platform: JsPlatform,
    /// The connections with their histories, set once they exist
    connections: RefCell<Weak<Connections>>,
    /// The histories without a connection that computations list their queries in, by computation
    histories: RefCell<HashMap<TableId, String>>,
    /// The tracked queries that run by id, with the run that a stop aborts and whether it was stopped
    running: RefCell<HashMap<QueryId, (RunId, bool)>>,
}

/// The compute host of the runtime, see the module. Clones share the histories.
#[derive(Clone)]
pub(crate) struct ComputeTracker {
    inner: Rc<Inner>,
}

impl ComputeTracker {
    pub fn new(platform: JsPlatform) -> Self {
        Self {
            inner: Rc::new(Inner {
                platform,
                connections: RefCell::new(Weak::new()),
                histories: RefCell::new(HashMap::new()),
                running: RefCell::new(HashMap::new()),
            }),
        }
    }

    /// The connections with their histories, once they exist
    pub fn attach(&self, connections: &Rc<Connections>) {
        *self.inner.connections.borrow_mut() = Rc::downgrade(connections);
    }

    /// List the queries of the computation of a table in a history without a connection. The histories of the
    /// computations that are gone are forgotten.
    pub fn track_in_history(&self, table_id: TableId, history: String) {
        let connections = self.inner.connections.borrow().upgrade();
        let mut histories = self.inner.histories.borrow_mut();
        if let Some(connections) = connections {
            histories.retain(|table_id, _| connections.computations.read(|state| state.computation(*table_id).is_some()));
        }
        histories.insert(table_id, history);
    }

    /// Stop a tracked query: the call of its run is aborted, the query ends cancelled. False for a query that is not
    /// one of the computations.
    pub fn stop(&self, query_id: QueryId) -> bool {
        let run = {
            let mut running = self.inner.running.borrow_mut();
            let Some((run, stopped)) = running.get_mut(&query_id) else { return false };
            *stopped = true;
            *run
        };
        ComputeHost::cancel(&self.inner.platform, run);
        true
    }

    /// The history of the queries of a call, none for an untracked one
    fn owner(&self, context: &ComputeContext) -> Option<QueryOwner> {
        if let Some(connection_id) = &context.connection_id {
            return Some(QueryOwner::Connection(connection_id.clone()));
        }
        self.inner.histories.borrow().get(&context.table_id).cloned().map(QueryOwner::History)
    }

    /// Open a query in a history, none if the history doesn't take it
    fn open(&self, connections: &Rc<Connections>, owner: &QueryOwner, sql: &str, context: &ComputeContext) -> Option<QueryId> {
        connections.registry.borrow().history(owner)?;
        let query_id = connections.registry.borrow_mut().next_query_id();
        let now = connections.now() as i64;
        let mut metadata = QueryMetadata::new(QueryType::InternalSqlframe);
        metadata.title = Some(context.title.to_string());
        metadata.issuer = Some(ISSUER.to_string());
        let state = QueryExecutionState::new(query_id, query_id, sql, metadata, now);
        connections.apply_query(owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true).ok()?;
        for action in [QueryExecutionAction::QuerySending { query_id, now }, QueryExecutionAction::QueryRunning { query_id, now }] {
            let _ = connections.apply_query(owner, action, false);
        }
        self.inner.running.borrow_mut().insert(query_id, (context.run, false));
        Some(query_id)
    }

    /// Close a query of a history with the outcome of its call
    fn close(&self, connections: &Rc<Connections>, owner: &QueryOwner, query_id: QueryId, outcome: &Result<(), HostError>) {
        let stopped = self.inner.running.borrow_mut().remove(&query_id).map(|(_, stopped)| stopped).unwrap_or(false);
        // A reset of the connection drops its queries from the history, there is nothing to close then
        if connections.registry.borrow().query_history(query_id).is_none() {
            return;
        }
        let now = connections.now() as i64;
        let action = match outcome {
            Ok(()) => QueryExecutionAction::QuerySucceeded { query_id, now },
            Err(error) => {
                let error = QueryError { message: error.to_string(), details: None };
                // A stopped query and a cancelled run, e.g. of a computation that is gone, are cancelled
                if stopped || error.message.contains("cancelled") {
                    QueryExecutionAction::QueryCancelled { query_id, error, metrics: None, now }
                } else {
                    QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now }
                }
            }
        };
        if let Err(error) = connections.apply_query(owner, action, true) {
            connections.log(LogLevel::Warn, "Failed to close a query of a computation", &[("error", error.what())]);
        }
    }
}

/// A query of a call that is open in a history. A call that is dropped, e.g. with its cancelled run, ends it cancelled.
struct OpenQuery {
    tracker: ComputeTracker,
    /// Held weakly, a call that never ends keeps nothing of the runtime alive
    connections: Weak<Connections>,
    owner: QueryOwner,
    query_id: QueryId,
    closed: bool,
}

impl OpenQuery {
    fn close(&mut self, outcome: &Result<(), HostError>) {
        if !self.closed {
            self.closed = true;
            if let Some(connections) = self.connections.upgrade() {
                self.tracker.close(&connections, &self.owner, self.query_id, outcome);
            }
        }
    }
}

impl Drop for OpenQuery {
    fn drop(&mut self) {
        self.close(&Err(HostError::new("The task was cancelled")));
    }
}

/// The client context that attributes the queries of a computation to its connection in the Hyper log
fn sqlframe_client_context(connection_id: &str) -> String {
    serde_json::json!({ "dashql": { "connectionId": connection_id, "queryType": "sqlframe" } }).to_string()
}

impl Host for ComputeTracker {
    fn now(&self) -> f64 {
        self.inner.platform.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.inner.platform.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.inner.platform.spawn(task)
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.inner.platform.log(level, message, details)
    }
}

impl ComputeHost for ComputeTracker {
    async fn import_table(&self, data_frame: u64, table_name: &str, table: Handle, row_number_field: &str, context: &ComputeContext) -> Result<(), HostError> {
        self.inner.platform.import_table(data_frame, table_name, table, row_number_field, context).await
    }

    async fn create_table(&self, data_frame: u64, table_name: &str, sql: &str, context: &ComputeContext) -> Result<(), HostError> {
        let connections = self.inner.connections.borrow().upgrade();
        let mut open = match (connections, self.owner(context)) {
            (Some(connections), Some(owner)) => self.open(&connections, &owner, sql, context).map(|query_id| OpenQuery {
                tracker: self.clone(),
                connections: Rc::downgrade(&connections),
                owner,
                query_id,
                closed: false,
            }),
            _ => None,
        };
        // A query of a connection is attributed to it in the Hyper log, it runs on a pooled compute connection
        let mut context = context.clone();
        if let Some(OpenQuery { owner: QueryOwner::Connection(connection_id), .. }) = &open {
            context.client_context = Some(sqlframe_client_context(connection_id));
        }
        let outcome = self.inner.platform.create_table(data_frame, table_name, sql, &context).await;
        if let Some(open) = open.as_mut() {
            open.close(&outcome);
        }
        outcome
    }

    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError> {
        self.inner.platform.query(sql, context).await
    }

    async fn query_table(&self, sql: &str, context: &ComputeContext) -> Result<KeptTable, HostError> {
        self.inner.platform.query_table(sql, context).await
    }

    async fn drop_table(&self, data_frame: u64, table_name: &str) -> Result<(), HostError> {
        self.inner.platform.drop_table(data_frame, table_name).await
    }

    fn register_table(&self, ipc: &[u8]) -> Result<Handle, HostError> {
        self.inner.platform.register_table(ipc)
    }

    fn release(&self, handle: Handle) {
        ComputeHost::release(&self.inner.platform, handle)
    }

    fn cancel(&self, run: RunId) {
        ComputeHost::cancel(&self.inner.platform, run)
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        self.inner.platform.changed(effects)
    }
}
