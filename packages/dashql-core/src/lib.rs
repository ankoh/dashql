//! The DashQL core: analysis, catalog, completion, cursors, formatting and packing of SQL scripts.
//!
//! Builds on `dashql_parser` (scanner and parser) and the FlatBuffers bindings `dashql_buffers`.

pub mod analyzer;
pub mod catalog;
pub mod compact_json;
pub mod completion;
mod completion_vis;
pub mod cursor;
pub mod error;
pub mod formatter;
pub mod hash;
pub mod pack;
pub mod script;
pub mod script_diff;
pub mod signature;
pub mod utils;
pub mod vis_highlight;
pub mod vis_rewrite;
mod vis_text;
