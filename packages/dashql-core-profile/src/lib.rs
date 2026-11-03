//! The query profile (Hyper today, Trino next): parses engine plans into operators, edges, fragments,
//! pipelines and slots (an operator in a pipeline), lays them out as a tree for the plan renderer of the app, and
//! tracks the execution state of a running or analyzed query as events.
//!
//! - `query_profile`: the structure and its FlatBuffers encoding (`QueryProfile::pack`)
//! - `hyper_plan_parser`: `QueryProfile::parse_hyper_plan` (plans are read with serde_json)
//! - `profile_layout`: the tree layout (Walker with the improvements of Buchheim, Juenger and Leipert)
//! - `progress`: input events, the rollup slot -> operator / pipeline -> fragment -> query, and the output events
//!   (`QueryProfile::apply_events`, `snapshot_events`, `reset_execution`)

mod hyper_plan_parser;
mod profile_layout;
mod query_profile;
mod progress;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_progress;
#[cfg(test)]
mod tests_tpch;

pub use query_profile::QueryProfile;
pub use progress::{EntityState, ProfileInputEvent, ProfileUpdate, SlotRole, SlotSpec, Stats, Status};
