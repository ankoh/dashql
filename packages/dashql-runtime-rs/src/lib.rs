//! The state of DashQL in Rust, on top of the core: the scripts of a workbook, the connections, the query executions
//! and the computations of query results. An action changes a state in place and returns the effects for the host.
//!
//! The app runs its workbook scripts on `workbook`, its connections with their query histories on `connections` and
//! `query`, its computations on `compute`. The catalog loader and the connectors are ported without I/O and not used
//! yet, see `docs/wip/rust_runtime.md`.

pub mod attachments;
pub mod catalog_loader;
pub mod clfn;
pub mod compute;
pub mod connections;
pub mod names;
pub mod query;
pub mod salesforce;
pub mod trino;
pub mod workbook;
pub mod workbook_format;
