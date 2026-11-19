//! The storage of DashQL on the runtime: the storage writer, the restore of the stored state, the workbook format with
//! its imports, exports, migrations and the eviction of the query result cache, and the saves of the connections. The
//! runtime (`dashql_core_runtime`) doesn't know this crate: the bindings of a product wire it in, see
//! docs/design/dashql_core.md.

#![cfg_attr(clippy, deny(warnings))]
#![allow(
    clippy::large_enum_variant,
    clippy::result_large_err,
    clippy::type_complexity,
    clippy::field_reassign_with_default,
    clippy::needless_update
)]

pub mod connection_persistence;
pub mod restore;
pub mod storage;
pub mod workbook_format;
