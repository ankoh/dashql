//! The storage format of workbooks and the decisions of their persistence.
//!
//! The functions take the contents of files (text, JSON, file names, Arrow IPC) and return parsed values, validation
//! results, migrated files or the files to write. Reading and writing files, ZIP archives and Parquet stay with the
//! host: an archive is a list of entries the host reads, a workbook table crosses as Arrow IPC that the embedded Hyper
//! writes as Parquet or reads from it. The steps that read and write files themselves run over traits of the host: the
//! migration of a workbook folder (`migration::FolderHost`), the migrations of the storage root
//! (`storage_migration::StorageRootHost`) and the eviction of the query result cache (`eviction::CacheHost`).

pub mod bundle;
pub mod connection_import;
pub mod data;
pub mod eviction;
pub mod export;
pub mod files;
pub mod import;
pub mod json;
pub mod layout;
pub mod migration;
pub mod query_results;
pub mod restore;
pub mod script_connections;
pub mod storage_migration;
pub mod tables;
pub mod tree;
pub mod validation;
