//! The scripts on top of the DashQL core: editor sessions, the compilation of scripts, batch processing, the
//! relations that statements touch and the renderer specs of VISUALIZE statements.
//!
//! The language itself (scripts, catalog, analyzer, completion, formatter) is `dashql_core`. The planner of the
//! statements across the scripts of a workbook is `dashql_core_runtime::planner`.

pub mod batch;
pub mod compiler;
pub mod script_session;
pub mod touched_relations;
pub mod visualize;
