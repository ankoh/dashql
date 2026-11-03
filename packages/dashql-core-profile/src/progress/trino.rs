//! The Trino adapters: raw Trino API payloads to input events.
//!
//! `trino_statement_events` reads the `stats` of a `/v1/statement` response. Trino sends them with every poll:
//! the query (state, splits, rows, cpu, memory) and the stage tree (`rootStage`). Stages are the fragments of
//! the plan, their ids are the fragment ids. A stage that the model does not know yet is registered.
//!
//! Every field is optional, a missing field is not reported (proxies like the Trino Gateway and older servers
//! may leave fields out).

use super::{ProfileInputEvent, Stats, Status};
use crate::query_profile::QueryProfile;
use serde_json::Value;
use std::collections::HashMap;

/// The status of a Trino query state (`QueryState`)
fn query_status(state: &str) -> Option<Status> {
    match state {
        "QUEUED" | "WAITING_FOR_RESOURCES" | "DISPATCHING" | "PLANNING" | "STARTING" => Some(Status::Pending),
        "RUNNING" | "FINISHING" => Some(Status::Running),
        "FINISHED" => Some(Status::Succeeded),
        "FAILED" => Some(Status::Failed),
        _ => None,
    }
}

/// The status of a Trino stage state (`StageState`)
fn stage_status(state: &str) -> Option<Status> {
    match state {
        "PLANNED" | "SCHEDULING" | "PENDING" => Some(Status::Pending),
        "SCHEDULED" | "RUNNING" => Some(Status::Running),
        "FINISHED" => Some(Status::Succeeded),
        "FAILED" | "ABORTED" => Some(Status::Failed),
        "CANCELED" => Some(Status::Skipped),
        _ => None,
    }
}

/// A counter of a JSON object
fn count(object: &Value, name: &str) -> Option<u64> {
    object.get(name).and_then(Value::as_u64)
}

/// Milliseconds as microseconds
fn micros(object: &Value, name: &str) -> Option<u64> {
    count(object, name).map(|ms| ms.saturating_mul(1000))
}

/// The statistics that the query and its stages share
fn common_stats(object: &Value) -> Stats {
    Stats {
        tuples_in: count(object, "processedRows"),
        bytes_in: count(object, "processedBytes"),
        cpu_time_us: micros(object, "cpuTimeMillis"),
        wall_time_us: micros(object, "wallTimeMillis"),
        work_done: count(object, "completedSplits"),
        work_total: count(object, "totalSplits"),
        ..Default::default()
    }
}

/// The input events of the `stats` of a `/v1/statement` response
pub(crate) fn trino_statement_events(model: &QueryProfile, stats: &Value, time: u64) -> Vec<ProfileInputEvent> {
    let mut events = Vec::new();
    let status = stats.get("state").and_then(Value::as_str).and_then(query_status);
    let query = Stats {
        memory_bytes: count(stats, "peakMemoryBytes"),
        spilled_bytes: count(stats, "spilledBytes"),
        ..common_stats(stats)
    };
    events.push(ProfileInputEvent::UpdateQuery { time, status, stats: query });

    // The known fragments by engine id
    let mut fragments: HashMap<String, u32> = model
        .fragments
        .iter()
        .enumerate()
        .filter_map(|(i, f)| Some((f.engine_id.clone()?, i as u32)))
        .collect();
    let mut next_fragment = model.fragments.len() as u32;

    // Walk the stage tree, parents first
    let mut pending: Vec<(&Value, Option<u32>)> = stats.get("rootStage").map(|s| vec![(s, None)]).unwrap_or_default();
    while let Some((stage, parent)) = pending.pop() {
        let Some(stage_id) = stage.get("stageId").and_then(Value::as_str) else {
            continue;
        };
        let fragment = match fragments.get(stage_id) {
            Some(fragment) => *fragment,
            None => {
                let fragment = next_fragment;
                next_fragment += 1;
                fragments.insert(stage_id.to_string(), fragment);
                events.push(ProfileInputEvent::RegisterFragment {
                    time,
                    engine_id: Some(stage_id.to_string()),
                    parent_fragment: parent,
                });
                fragment
            }
        };
        let status = stage.get("state").and_then(Value::as_str).and_then(stage_status);
        events.push(ProfileInputEvent::UpdateFragment { time, fragment, status, stats: common_stats(stage) });
        let children = stage.get("subStages").and_then(Value::as_array).into_iter().flatten();
        pending.extend(children.rev().map(|child| (child, Some(fragment))));
    }
    events
}

impl QueryProfile {
    /// Apply the `stats` of a Trino `/v1/statement` response (JSON), received at a time in milliseconds
    pub fn apply_trino_statement_stats(
        &mut self,
        stats: &[u8],
        time: u64,
    ) -> Result<Vec<super::ProfileUpdate>, serde_json::Error> {
        let stats: Value = serde_json::from_slice(stats)?;
        let events = trino_statement_events(self, &stats, time);
        Ok(self.apply_events(&events))
    }
}
