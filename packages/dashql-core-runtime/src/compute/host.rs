//! What the computations ask of the compute database of the host, the embedded Hyper of the platform.
//!
//! A data frame is a table of the compute database, the runtime names it (`tasks::data_frame_table_name`) and the host
//! creates, reads and drops it. Every call carries the context of the task that makes it: the computation, the title
//! of the task and the run, which the host aborts on `cancel`.
//!
//! The Arrow tables of the computations stay with the host, result data never enters the module: the host imports a
//! result by its handle and keeps the numbered result under a new handle (`import_table`), and keeps the rows that a
//! task reads under a new handle (`query_table`), the runtime learns their rows and their schema only. A task that parses what it read, e.g. the statistics or the bins of a summary,
//! reads a small table as an Arrow IPC stream (`query`) and hands it over (`register_table`). The state names a table
//! by its handle and releases it with an effect.

use arrow_schema::SchemaRef;

use crate::handles::Handle;
use crate::host::{Host, HostError};

use super::types::TableId;
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

/// What the runtime knows of a table that the host keeps: its rows and its schema, the data stays with the host
#[derive(Clone, Debug, PartialEq)]
pub struct TableShape {
    pub rows: u64,
    pub schema: SchemaRef,
}

/// A table that the host keeps under a handle
#[derive(Clone, Debug, PartialEq)]
pub struct KeptTable {
    pub handle: Handle,
    pub shape: TableShape,
}

/// The compute database of the host
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait ComputeHost: Host {
    /// Create the table of a data frame (`data_frame_table_name`) from a table of the host with its fields named
    /// `fields`, in order, and its rows numbered from 1 in an appended column of 64-bit integers that can't be null, and
    /// keep the numbered table under a new handle: the table that the grid shows. The host numbers the rows, the data
    /// never enters the module.
    async fn import_table(
        &self,
        table_name: &str,
        table: Handle,
        fields: &[String],
        row_number_field: &str,
        context: &ComputeContext,
    ) -> Result<KeptTable, HostError>;
    /// Create the table of a data frame from a SELECT. The host tracks the SELECT as a query of the task, e.g. in the
    /// query history of the connection of the computation.
    async fn create_table(&self, table_name: &str, sql: &str, context: &ComputeContext) -> Result<(), HostError>;
    /// Run a query whose result the runtime parses, e.g. the statistics of a table: the result is an Arrow IPC stream
    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError>;
    /// Run a query and keep its result under a new handle, the runtime learns its rows and its schema
    async fn query_table(&self, sql: &str, context: &ComputeContext) -> Result<KeptTable, HostError>;
    /// Drop the table of a data frame, unless the host still reads it
    async fn drop_table(&self, table_name: &str) -> Result<(), HostError>;
    /// Keep a small table that a task read and parsed, an Arrow IPC stream, under a new handle
    fn register_table(&self, ipc: &[u8]) -> Result<Handle, HostError>;
    /// Release a handle that the runtime got and doesn't keep, e.g. the table of an analysis without columns
    fn release(&self, handle: Handle);
    /// Abort the calls of a run that are still running
    fn cancel(&self, run: RunId);
    /// A task changed the state, with the effects of its actions that the host applies (aborted and released handles,
    /// aborted data searches). The service drops the released data frames itself.
    fn changed(&self, effects: &[ComputationEffect]);
}
