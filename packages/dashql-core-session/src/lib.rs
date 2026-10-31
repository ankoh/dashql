//! The workflows on top of the DashQL core: editor sessions, the compilation of scripts, the planner of
//! statement dependencies across scripts that every run executes, batch processing, the catalog changes
//! of executed statements and the renderer specs of VISUALIZE statements.
//!
//! The language itself (scripts, catalog, analyzer, completion, formatter) is `dashql_core`.

pub mod batch;
pub mod catalog_changes;
pub mod compiler;
pub mod planner;
pub mod script_references;
pub mod script_session;
pub mod visualize;
