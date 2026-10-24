//! The view model of Hyper query plans: parses the JSON plans of Hyper into operators, edges, fragments and
//! pipelines and lays them out as a tree, for the plan renderer of the app.
//!
//! - `hyper_plan_parser`: `PlanViewModel::parse_hyper_plan` (plans are read with serde_json) and the derived edges,
//!   fragments and pipelines
//! - `plan_view_model`: the view model and its FlatBuffers encoding (`PlanViewModel::pack`)
//! - `plan_layout`: the tree layout (Walker with the improvements of Buchheim, Juenger and Leipert)

mod hyper_plan_parser;
mod plan_layout;
mod plan_view_model;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_tpch;

pub use plan_view_model::PlanViewModel;
