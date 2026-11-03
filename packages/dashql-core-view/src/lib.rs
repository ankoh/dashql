//! The view model of query plans (Hyper today, Trino next): parses engine plans into operators, edges, fragments,
//! pipelines and slots (an operator in a pipeline), lays them out as a tree for the plan renderer of the app, and
//! tracks the execution state of a running or analyzed query as events.
//!
//! - `plan_view_model`: the structure and its FlatBuffers encoding (`PlanViewModel::pack`)
//! - `hyper_plan_parser`: `PlanViewModel::parse_hyper_plan` (plans are read with serde_json)
//! - `plan_layout`: the tree layout (Walker with the improvements of Buchheim, Juenger and Leipert)
//! - `progress`: input events, the rollup slot -> operator / pipeline -> fragment -> query, and the output events
//!   (`PlanViewModel::apply_events`, `snapshot_events`, `reset_execution`)

mod hyper_plan_parser;
mod plan_layout;
mod plan_view_model;
mod progress;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_progress;
#[cfg(test)]
mod tests_tpch;

pub use plan_view_model::PlanViewModel;
pub use progress::{EntityState, PlanInputEvent, PlanUpdate, SlotRole, SlotSpec, Stats, Status};
