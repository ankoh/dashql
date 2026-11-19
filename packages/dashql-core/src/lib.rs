//! The DashQL core: analysis, catalog, completion, cursors, formatting and packing of SQL scripts, and the scripts on
//! top of them: editor sessions, the compilation of scripts, batch processing, the relations that statements touch and
//! the renderer specs of VISUALIZE statements.
//!
//! The planner of the statements across the scripts of a workbook is `dashql_core_runtime::planner`.
//!
//! Builds on `dashql_parser` (scanner and parser) and the FlatBuffers bindings `dashql_buffers`.

pub mod analyzer;
pub mod annotation;
pub mod batch;
pub mod catalog;
pub mod compact_json;
pub mod compiler;
pub mod completion;
mod completion_clfn;
mod completion_vis;
pub mod cursor;
pub mod error;
pub mod formatter;
pub mod hash;
pub mod param_rewrite;
pub mod pack;
pub mod result_projection;
pub mod script;
pub mod script_diff;
pub mod script_session;
pub mod table_parameters;
pub mod signature;
pub mod sql_literal;
pub mod touched_relations;
pub mod utils;
pub mod vis_highlight;
pub mod vis_rewrite;
mod vis_text;
pub mod visualize;
