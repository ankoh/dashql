//! The state of DashQL in Rust: the scripts of a workbook and the actions on them, on top of the core.
//!
//! A spike: the TypeScript runtime (`packages/dashql-runtime`) still holds the state the app runs on. This crate ports
//! the workbook scripts to decide whether the state moves to Rust, see `docs/wip/rust_runtime.md`.

pub mod names;
pub mod workbook;
