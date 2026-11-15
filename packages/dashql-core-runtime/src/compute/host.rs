//! What the computations ask of the compute database of the host, the embedded Hyper of the platform.
//!
//! A data frame is a table of the compute database, the runtime names it (`tasks::data_frame_table_name`) and the host
//! creates, reads and drops it. Tables cross as Arrow IPC streams. Every call carries the context of the task that
//! makes it: the computation, the title of the task and the run, which the host aborts on `cancel`.
//!
//! The Arrow tables of the computations stay with the host: a task reads the rows that it needs from a table and hands
//! the table over (`register_table`), the state names it by its handle and releases it with an effect.

use crate::handles::Handle;
use crate::host::{Host, HostError};

use super::types::{DataFrameId, TableId};
use super::ComputationEffect;

/// The id of a run of a task, or of the import of a result
pub type RunId = u64;

/// The context of a call of the compute database
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComputeContext {
    /// The computation of the call
    pub table_id: TableId,
    /// The title of the task in the query history
    pub title: &'static str,
    /// The connection that ran the query of the table, the host tracks the queries of a task in its query history
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    pub client_context: Option<String>,
    /// The run, `ComputeHost::cancel` aborts its calls
    pub run: RunId,
}

/// The compute database of the host
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait ComputeHost: Host {
    /// Create the table of a data frame from an Arrow IPC stream
    async fn import_table(
        &self,
        data_frame: DataFrameId,
        table_name: &str,
        ipc: Vec<u8>,
        context: &ComputeContext,
    ) -> Result<(), HostError>;
    /// Create the table of a data frame from a SELECT. The host tracks the SELECT as a query of the task, e.g. in the
    /// query history of the connection of the computation.
    async fn create_table(
        &self,
        data_frame: DataFrameId,
        table_name: &str,
        sql: &str,
        context: &ComputeContext,
    ) -> Result<(), HostError>;
    /// Run a query, the result is an Arrow IPC stream
    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError>;
    /// Drop the table of a data frame, unless the host still reads it
    async fn drop_table(&self, data_frame: DataFrameId, table_name: &str) -> Result<(), HostError>;
    /// Keep a table that a task read, an Arrow IPC stream, under a new handle
    fn register_table(&self, ipc: &[u8]) -> Result<Handle, HostError>;
    /// Release a handle that the runtime got and doesn't keep, e.g. the table of an analysis without columns
    fn release(&self, handle: Handle);
    /// Abort the calls of a run that are still running
    fn cancel(&self, run: RunId);
    /// A task changed the state, with the effects of its actions that the host applies (aborted and released handles,
    /// aborted data searches). The service drops the released data frames itself.
    fn changed(&self, effects: &[ComputationEffect]);
}
