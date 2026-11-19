//! The compute host of the runtime: the compute database of the platform, with the SELECTs that create the tables of
//! the tasks tracked in a query history.
//!
//! A task of a computation creates its tables with SELECTs on the compute database. The runtime lists them in the
//! query history of the connection that ran the query of the result, or in a history without a connection that the
//! analysis named, e.g. the one of the shell. The query is opened before the call and closed after it; a reset of the
//! connection or a cancel stops it like a query of the connection: the run of the task is cancelled in Rust, the
//! calls of the run are aborted, and the query and the task end cancelled.

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, KeptTable, RunId};
use dashql_core_runtime::compute::ComputationEffect;
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
    /// The tracked queries that run by id, with the run that a stop cancels
    running: RefCell<HashMap<QueryId, RunId>>,
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
                running: RefCell::new(HashMap::new()),
            }),
        }
    }

    /// The connections with their histories, once they exist
    pub fn attach(&self, connections: &Rc<Connections>) {
        *self.inner.connections.borrow_mut() = Rc::downgrade(connections);
    }

    /// Stop a tracked query: the run of its task is cancelled, which drops the call and aborts it at the platform, the
    /// query ends cancelled. False for a query that is not one of the computations.
    pub fn stop(&self, query_id: QueryId) -> bool {
        let Some(run) = self.inner.running.borrow().get(&query_id).copied() else { return false };
        let connections = self.inner.connections.borrow().upgrade();
        let cancelled = connections.is_some_and(|connections| connections.computations.cancel_run(run));
        // A run that the service doesn't know any more still has its calls aborted
        if !cancelled {
            ComputeHost::cancel(&self.inner.platform, run);
        }
        true
    }

    /// Open a query in the history of a connection, none if the history doesn't take it
    fn open(&self, connections: &Rc<Connections>, connection_id: &str, sql: &str, context: &ComputeContext) -> Option<QueryId> {
        connections.registry.borrow().history(connection_id)?;
        let query_id = connections.registry.borrow_mut().next_query_id();
        let now = connections.now() as i64;
        let mut metadata = QueryMetadata::new(QueryType::InternalSqlframe);
        metadata.title = Some(context.title.to_string());
        metadata.issuer = Some(ISSUER.to_string());
        let state = QueryExecutionState::new(query_id, query_id, sql, metadata, now);
        connections.apply_query(connection_id, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true).ok()?;
        for action in [QueryExecutionAction::QuerySending { query_id, now }, QueryExecutionAction::QueryRunning { query_id, now }] {
            let _ = connections.apply_query(connection_id, action, false);
        }
        self.inner.running.borrow_mut().insert(query_id, context.run);
        Some(query_id)
    }

    /// Close a query of a history with the outcome of its call
    fn close(&self, connections: &Rc<Connections>, connection_id: &str, query_id: QueryId, outcome: &Result<(), HostError>) {
        self.inner.running.borrow_mut().remove(&query_id);
        // A reset of the connection drops its queries from the history, there is nothing to close then
        if connections.registry.borrow().query_history(query_id).is_none() {
            return;
        }
        let now = connections.now() as i64;
        let action = match outcome {
            Ok(()) => QueryExecutionAction::QuerySucceeded { query_id, now },
            Err(failure) => {
                let error = QueryError { message: failure.to_string(), details: None };
                // A cancelled run, e.g. of a stopped query or of a computation that is gone, ends its query cancelled
                if failure.is_cancelled() {
                    QueryExecutionAction::QueryCancelled { query_id, error, metrics: None, now }
                } else {
                    QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now }
                }
            }
        };
        if let Err(error) = connections.apply_query(connection_id, action, true) {
            connections.log(LogLevel::Warn, "Failed to close a query of a computation", &[("error", error.what())]);
        }
    }
}

/// A query of a call that is open in a history. A call that is dropped, e.g. with its cancelled run, ends it cancelled.
struct OpenQuery {
    tracker: ComputeTracker,
    /// Held weakly, a call that never ends keeps nothing of the runtime alive
    connections: Weak<Connections>,
    connection_id: String,
    query_id: QueryId,
    closed: bool,
}

impl OpenQuery {
    fn close(&mut self, outcome: &Result<(), HostError>) {
        if !self.closed {
            self.closed = true;
            if let Some(connections) = self.connections.upgrade() {
                self.tracker.close(&connections, &self.connection_id, self.query_id, outcome);
            }
        }
    }
}

impl Drop for OpenQuery {
    fn drop(&mut self) {
        self.close(&Err(HostError::cancelled()));
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
        // The queries of a computation go to the history of its connection, a computation without one has none
        let mut open = match (connections, context.connection_id.clone()) {
            (Some(connections), Some(connection_id)) => self.open(&connections, &connection_id, sql, context).map(|query_id| OpenQuery {
                tracker: self.clone(),
                connections: Rc::downgrade(&connections),
                connection_id,
                query_id,
                closed: false,
            }),
            _ => None,
        };
        // A query of a connection is attributed to it in the Hyper log, it runs on a pooled compute connection
        let mut context = context.clone();
        if let Some(open) = &open {
            context.client_context = Some(sqlframe_client_context(&open.connection_id));
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
        ComputeHost::changed(&self.inner.platform, effects)
    }
}
