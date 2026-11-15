//! The state of DashQL in Rust, on top of the core: the scripts of a workbook, the connections, the query executions
//! and the computations of query results. An action changes a state in place and returns the effects for the host.
//!
//! The app runs its workbook scripts on `workbook`, its connections with their query histories on `connections` and
//! `query`, its computations on `compute` and its storage writes on `storage`. It restores the stored state with
//! `restore`, decides the writes of connections with `connection_persistence` and the storage format of workbooks with
//! `workbook_format`. The catalog loader and the connectors are ported without I/O and not used yet, see
//! `docs/wip/core_runtime.md`. The services of the runtime are async functions on a `host::Host`, the platform they run
//! on.

pub mod attachments;
pub mod catalog_loader;
pub mod clfn;
pub mod compute;
pub mod connection_persistence;
pub mod connections;
pub mod executor;
pub mod host;
pub mod http;
pub mod hyper;
pub mod names;
pub mod planner;
pub mod query;
pub mod restore;
pub mod salesforce;
pub mod storage;
pub mod trino;
pub mod workbook;
pub mod workbook_format;
