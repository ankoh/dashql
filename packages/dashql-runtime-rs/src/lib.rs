//! The state of DashQL in Rust, on top of the core: the scripts of a workbook, the connections, the query executions
//! and the computations of query results. An action changes a state in place and returns the effects for the host.
//!
//! The app runs its workbook scripts on `workbook` and its computations on `compute`, the connections and the query
//! executions are ported and not used yet, see `docs/wip/rust_runtime.md`.

pub mod attachments;
pub mod compute;
pub mod connections;
pub mod names;
pub mod query;
pub mod workbook;
