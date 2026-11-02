//! The layout of the dataflow canvas of the app.
//!
//! - `layout`: the boxes of the scripts and inputs with their statement rows, placed and routed by the layered
//!   layout of ELK, from scratch or from where the boxes were
//! - `routing`: orthogonal routes of edges around boxes at any position, for the edges of a dragged box
//! - `ortho_router`: the orthogonal router of `routing`, vendored from ortho-router

pub mod layout;
pub mod ortho_router;
pub mod routing;
