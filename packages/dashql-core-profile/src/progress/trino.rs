//! The Trino adapters: raw Trino API payloads to input events.
//!
//! `trino_statement_events` reads the `stats` of a `/v1/statement` response. Trino sends them with every poll:
//! the query (state, splits, rows, cpu, memory) and the stage tree (`rootStage`). Stages are the fragments of
//! the plan, their ids are the fragment ids. A stage that the model does not know yet is registered.
//!
//! `trino_query_info_events` reads a QueryInfo (`/v1/query/{id}`): the operator summaries of the stages give the
//! pipelines of a stage and the statistics of their slots (a plan node in a pipeline). The pipelines are
//! registered when they appear.
//!
//! Every field is optional, a missing field is not reported (proxies like the Trino Gateway and older servers
//! may leave fields out).

use super::{ProfileInputEvent, SlotRole, SlotSpec, Stats, Status};
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

/// The status of a Trino stage state (`StageState`). A stage is `PENDING` after `RUNNING`: its tasks are done and
/// it waits for the query to finish, its work is done.
fn stage_status(state: &str) -> Option<Status> {
    match state {
        "PLANNED" | "SCHEDULING" => Some(Status::Pending),
        "SCHEDULED" | "RUNNING" => Some(Status::Running),
        "PENDING" | "FINISHED" => Some(Status::Succeeded),
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

/// A Trino duration (`"956.59us"`, `"2.15s"`) in microseconds
fn duration_us(value: Option<&Value>) -> Option<u64> {
    let text = value?.as_str()?.trim();
    let split = text.find(|c: char| c.is_ascii_alphabetic())?;
    let (number, unit) = text.split_at(split);
    let number: f64 = number.trim().parse().ok()?;
    let factor = match unit {
        "ns" => 1e-3,
        "us" => 1.0,
        "ms" => 1e3,
        "s" => 1e6,
        "m" => 60e6,
        "h" => 3600e6,
        "d" => 86400e6,
        _ => return None,
    };
    Some((number * factor).round() as u64)
}

/// A Trino data size (`"271278B"`, `"1.5MB"`) in bytes
fn data_size_bytes(value: Option<&Value>) -> Option<u64> {
    let text = value?.as_str()?.trim();
    let split = text.find(|c: char| c.is_ascii_alphabetic())?;
    let (number, unit) = text.split_at(split);
    let number: f64 = number.trim().parse().ok()?;
    let factor = match unit {
        "B" => 1.0,
        "kB" => 1024.0,
        "MB" => 1024.0 * 1024.0,
        "GB" => 1024.0 * 1024.0 * 1024.0,
        "TB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        "PB" => 1024.0 * 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((number * factor).round() as u64)
}

/// Sum the durations of an operator summary
fn sum_durations(summary: &Value, names: &[&str]) -> Option<u64> {
    names.iter().filter_map(|name| duration_us(summary.get(*name))).reduce(|a, b| a.saturating_add(b))
}

/// The statistics of a slot: the Trino operators of one plan node in one pipeline, ordered by operator id.
/// The input is the input of the first operator, the output the output of the last.
fn slot_stats(operators: &[&Value]) -> Stats {
    let (first, last) = (operators[0], operators[operators.len() - 1]);
    let mut stats = Stats {
        tuples_in: count(first, "inputPositions"),
        tuples_out: count(last, "outputPositions"),
        bytes_in: data_size_bytes(first.get("inputDataSize")),
        bytes_out: data_size_bytes(last.get("outputDataSize")),
        ..Default::default()
    };
    let sum = |values: &mut Option<u64>, value: Option<u64>| {
        if let Some(value) = value {
            *values = Some(values.unwrap_or(0).saturating_add(value));
        }
    };
    for op in operators {
        sum(&mut stats.cpu_time_us, sum_durations(op, &["addInputCpu", "getOutputCpu", "finishCpu"]));
        sum(&mut stats.wall_time_us, sum_durations(op, &["addInputWall", "getOutputWall", "finishWall"]));
        sum(&mut stats.blocked_time_us, duration_us(op.get("blockedWall")));
        sum(&mut stats.memory_bytes, data_size_bytes(op.get("peakUserMemoryReservation")));
        sum(&mut stats.spilled_bytes, data_size_bytes(op.get("spilledDataSize")));
    }
    stats
}

/// The input events of a QueryInfo (`/v1/query/{id}`, pruned or not): the pipelines of the stages and the
/// statistics of their slots from the operator summaries. Trino reports the operator summaries of a stage once its
/// tasks are done (the stage is `PENDING` until the query finishes, then `FINISHED`), and of every stage for
/// EXPLAIN ANALYZE. A pruned QueryInfo keeps the output stage only. Operators that are not in the plan are skipped.
pub(crate) fn trino_query_info_events(model: &QueryProfile, info: &Value, time: u64) -> Vec<ProfileInputEvent> {
    let mut events = Vec::new();
    let fragments: HashMap<&str, u32> = model
        .fragments
        .iter()
        .enumerate()
        .filter_map(|(i, f)| Some((f.engine_id.as_deref()?, i as u32)))
        .collect();
    let operators: HashMap<&str, u32> = model
        .operators
        .iter()
        .enumerate()
        .filter_map(|(i, op)| Some((op.engine_id.as_deref()?, i as u32)))
        .collect();
    let mut pipelines: HashMap<String, u32> = model
        .pipelines
        .iter()
        .enumerate()
        .filter_map(|(i, p)| Some((p.engine_id.clone()?, i as u32)))
        .collect();
    let mut next_pipeline = model.pipelines.len() as u32;
    let mut next_slot = model.slots.len() as u32;
    let mut slot_of: HashMap<(u32, u32), u32> =
        model.slots.iter().enumerate().map(|(i, s)| ((s.pipeline, s.operator), i as u32)).collect();

    let stages = info.get("stages").and_then(|s| s.get("stages")).and_then(Value::as_array).into_iter().flatten();
    for stage in stages {
        let Some(stage_id) = stage.get("stageId").and_then(Value::as_str) else { continue };
        let fragment_id = stage_id.rsplit('.').next().unwrap_or(stage_id);
        let Some(&fragment) = fragments.get(fragment_id) else { continue };
        let status = stage.get("state").and_then(Value::as_str).and_then(stage_status);
        let summaries = stage.get("stageStats").and_then(|s| s.get("operatorSummaries")).and_then(Value::as_array);

        // The operators of every pipeline, ordered by operator id
        let mut by_pipeline: std::collections::BTreeMap<u64, Vec<&Value>> = Default::default();
        for summary in summaries.into_iter().flatten() {
            if let Some(pipeline) = count(summary, "pipelineId") {
                by_pipeline.entry(pipeline).or_default().push(summary);
            }
        }
        for (pipeline_id, mut summaries) in by_pipeline {
            summaries.sort_by_key(|s| count(s, "operatorId").unwrap_or(0));
            // The slots: the operators of a plan node, in the order of their first operator
            let mut slots: Vec<(u32, Vec<&Value>)> = Vec::new();
            for summary in &summaries {
                let Some(&op) = summary.get("planNodeId").and_then(Value::as_str).and_then(|id| operators.get(id))
                else {
                    continue;
                };
                match slots.iter_mut().find(|(o, _)| *o == op) {
                    Some((_, ops)) => ops.push(summary),
                    None => slots.push((op, vec![summary])),
                }
            }
            if slots.is_empty() {
                continue;
            }
            let engine_id = format!("{fragment_id}.{pipeline_id}");
            let pipeline = match pipelines.get(&engine_id) {
                Some(pipeline) => *pipeline,
                None => {
                    let last = slots.len() - 1;
                    let specs = slots
                        .iter()
                        .enumerate()
                        .map(|(i, (operator, _))| SlotSpec {
                            operator: *operator,
                            role: if i == 0 {
                                SlotRole::Source
                            } else if i == last {
                                SlotRole::Sink
                            } else {
                                SlotRole::Through
                            },
                        })
                        .collect();
                    events.push(ProfileInputEvent::RegisterPipeline {
                        time,
                        engine_id: Some(engine_id.clone()),
                        fragment: Some(fragment),
                        slots: specs,
                    });
                    let pipeline = next_pipeline;
                    next_pipeline += 1;
                    for (operator, _) in &slots {
                        slot_of.insert((pipeline, *operator), next_slot);
                        next_slot += 1;
                    }
                    pipelines.insert(engine_id, pipeline);
                    pipeline
                }
            };
            for (operator, ops) in &slots {
                let Some(&slot) = slot_of.get(&(pipeline, *operator)) else { continue };
                events.push(ProfileInputEvent::UpdateSlot { time, slot, status, stats: slot_stats(ops) });
            }
        }
    }
    events
}

impl QueryProfile {
    /// Apply a Trino QueryInfo (JSON, pruned or not), received at a time in milliseconds: the pipelines and the
    /// slot statistics of the stages of the plan
    pub fn apply_trino_query_info(
        &mut self,
        info: &[u8],
        time: u64,
    ) -> Result<Vec<super::ProfileUpdate>, serde_json::Error> {
        let info: Value = serde_json::from_slice(info)?;
        let events = trino_query_info_events(self, &info, time);
        Ok(self.apply_events(&events))
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn durations_of_every_unit() {
        let us = |text: &str| duration_us(Some(&json!(text)));
        assert_eq!(us("1500ns"), Some(2));
        assert_eq!(us("956.59us"), Some(957));
        assert_eq!(us("2.15ms"), Some(2150));
        assert_eq!(us(" 2.15s "), Some(2_150_000));
        assert_eq!(us("1.5m"), Some(90_000_000));
        assert_eq!(us("2h"), Some(7_200_000_000));
        assert_eq!(us("1d"), Some(86_400_000_000));
        // Unknown units, missing numbers and non-strings are no durations
        assert_eq!(us("3w"), None);
        assert_eq!(us("s"), None);
        assert_eq!(us("12"), None);
        assert_eq!(duration_us(Some(&json!(12))), None);
        assert_eq!(duration_us(None), None);
    }

    #[test]
    fn data_sizes_of_every_unit() {
        let bytes = |text: &str| data_size_bytes(Some(&json!(text)));
        assert_eq!(bytes("271278B"), Some(271_278));
        assert_eq!(bytes("2kB"), Some(2048));
        assert_eq!(bytes("1.5MB"), Some(1_572_864));
        assert_eq!(bytes("2GB"), Some(2 << 30));
        assert_eq!(bytes("1TB"), Some(1 << 40));
        assert_eq!(bytes("1PB"), Some(1 << 50));
        // Data sizes are binary and case sensitive
        assert_eq!(bytes("1KB"), None);
        assert_eq!(bytes("1EB"), None);
    }

    #[test]
    fn stage_and_query_states() {
        assert_eq!(stage_status("PLANNED"), Some(Status::Pending));
        assert_eq!(stage_status("SCHEDULED"), Some(Status::Running));
        // A pending stage after running has done its work
        assert_eq!(stage_status("PENDING"), Some(Status::Succeeded));
        assert_eq!(stage_status("ABORTED"), Some(Status::Failed));
        assert_eq!(stage_status("CANCELED"), Some(Status::Skipped));
        assert_eq!(stage_status("SOMETHING_NEW"), None);
        assert_eq!(query_status("FAILED"), Some(Status::Failed));
    }
}
