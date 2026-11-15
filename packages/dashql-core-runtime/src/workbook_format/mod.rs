//! The storage format of workbooks and the decisions of their persistence, without I/O.
//!
//! The functions take the contents of files (text, JSON, file names, Arrow IPC) and return parsed values, validation
//! results, migrated files or the files to write. Reading and writing files, ZIP archives and Parquet stay with the
//! host: an archive is a list of entries the host reads, a workbook table crosses as Arrow IPC that the embedded Hyper
//! writes as Parquet or reads from it.
//!
//! Ported from `packages/dashql-runtime/src/storage/` (`workbook_files.ts`, `workbook_tree.ts`,
//! `workbook_validation.ts`, `workbook_bundle.ts`, `workbook_tables.ts`, `query_result_cache_eviction.ts`, the
//! workbook migrations and the pure parts of the backends) and `src/workbook/persistence/` (import, export, the
//! connections of imports, the query results of archives) and the decisions of the restore.

pub mod bundle;
pub mod catalog;
pub mod connection_import;
pub mod data;
pub mod eviction;
pub mod export;
pub mod files;
pub mod import;
pub mod json;
pub mod layout;
pub mod migration;
pub mod natural;
pub mod query_results;
pub mod restore;
pub mod script_connections;
pub mod sharing;
pub mod tables;
pub mod tree;
pub mod validation;
