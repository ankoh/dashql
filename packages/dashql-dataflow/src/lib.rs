//! The layout of the dataflow canvas of the app.
//!
//! - `layout`: the boxes of the scripts and inputs with their statement rows, placed and routed by the layered
//!   layout of ELK, from scratch or from where the boxes were
//! - `routing`: orthogonal routes of edges around boxes at any position, for the edges of a dragged box

pub mod layout;
pub mod routing;
