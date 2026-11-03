//! The query profile of Hyper and Trino queries: parses engine plans into operators, edges, fragments,
//! pipelines and slots (an operator in a pipeline), lays them out as a tree for the profile renderer of the app, and
//! tracks the execution state of a running or analyzed query as events.
//!
//! - `query_profile`: the structure and its FlatBuffers encoding (`QueryProfile::pack`)
//! - `hyper_plan_parser`, `trino_plan_parser`: `QueryProfile::parse_hyper_plan`, `parse_trino_plan` (serde_json)
//! - `profile_layout`: the tree layout (Walker with the improvements of Buchheim, Juenger and Leipert)
//! - `progress`: input events, the rollup slot -> operator / pipeline -> fragment -> query, and the output events
//!   (`QueryProfile::apply_events`, `snapshot_events`, `reset_execution`)

mod hyper_plan_parser;
mod profile_layout;
mod progress;
mod query_profile;
mod trino_plan_parser;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_progress;
#[cfg(test)]
mod tests_trino;
#[cfg(test)]
mod tests_tpch;

pub use progress::{EntityState, ProfileInputEvent, ProfileUpdate, SlotRole, SlotSpec, Stats, Status};
pub use query_profile::QueryProfile;
