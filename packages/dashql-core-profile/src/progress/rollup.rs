//! The rollup of execution state: slot -> operator / pipeline -> fragment -> query.
//!
//! Every entity takes what the engine reported for it and fills the rest from its children:
//! - an operator from its slots: times, memory and work summed, tuples in summed over all slots, tuples out
//!   from the slots that pass tuples on (not the sinks), unless it only has sinks,
//! - a pipeline from its slots: times, memory and work summed, tuples in from the sources, tuples out from the
//!   sinks,
//! - a fragment from its pipelines, tuples out from its root operator. What no pipeline knows comes from the
//!   operators of the fragment (an analyzed Hyper plan reports operators only),
//! - the query from all fragments, tuples out from the fragments without parent.
//!
//! The state of a fragment is its own work, without its child fragments, like the stage statistics of Trino.
//! Every operator belongs to one fragment only and every slot to one fragment, so nothing is counted twice: a
//! pipeline whose slots all lie in its fragment counts as a whole, a pipeline that crosses into other fragments (a
//! Hyper pipeline through a federate) counts with its slots, each in the fragment of its operator, and what is
//! reported for the pipeline itself reaches no fragment. A pipeline without fragment rolls up to its operators only.
//! A status is rolled up over the children that know theirs.

use super::{Entities, EntityState, Stats, Status};
use crate::query_profile::QueryProfile;
use dashql_buffers::profile as fb;

/// Add an optional counter
fn add(sum: &mut Option<u64>, value: Option<u64>) {
    if let Some(value) = value {
        *sum = Some(sum.unwrap_or(0).saturating_add(value));
    }
}

/// The rollup of the children of an entity
#[derive(Default)]
struct Rollup {
    /// The rolled up statistics
    stats: Stats,
    /// The children
    children: usize,
    /// The children that finished
    finished: usize,
    /// The latest finish time
    finished_at: Option<u64>,
    /// The statuses of the children, indexed by `Status as usize`
    statuses: [usize; 6],
}

impl Rollup {
    /// Add a child: times, memory and work are summed, the earliest start wins
    fn add(&mut self, child: &EntityState) {
        let (stats, child_stats) = (&mut self.stats, &child.stats);
        self.children += 1;
        if let Some(count) = self.statuses.get_mut(child.status as usize) {
            *count += 1;
        }
        if let Some(started_at) = child_stats.started_at {
            stats.started_at = Some(stats.started_at.map_or(started_at, |s| s.min(started_at)));
        }
        if let Some(finished_at) = child_stats.finished_at {
            self.finished += 1;
            self.finished_at = Some(self.finished_at.map_or(finished_at, |f| f.max(finished_at)));
        }
        add(&mut stats.cpu_time_us, child_stats.cpu_time_us);
        add(&mut stats.wall_time_us, child_stats.wall_time_us);
        add(&mut stats.blocked_time_us, child_stats.blocked_time_us);
        add(&mut stats.memory_bytes, child_stats.memory_bytes);
        add(&mut stats.spilled_bytes, child_stats.spilled_bytes);
        add(&mut stats.work_done, child_stats.work_done);
        add(&mut stats.work_total, child_stats.work_total);
    }

    /// Add the input of a child
    fn add_input(&mut self, child: &Stats) {
        add(&mut self.stats.tuples_in, child.tuples_in);
        add(&mut self.stats.bytes_in, child.bytes_in);
    }

    /// Add the output of a child
    fn add_output(&mut self, child: &Stats) {
        add(&mut self.stats.tuples_out, child.tuples_out);
        add(&mut self.stats.bytes_out, child.bytes_out);
    }

    /// The rolled up status, over the children that know their status
    fn status(&self) -> Status {
        let count = |status: Status| self.statuses.get(status as usize).copied().unwrap_or(0);
        let known = self.children - count(Status::Unknown);
        if known == 0 {
            Status::Unknown
        } else if count(Status::Failed) > 0 {
            Status::Failed
        } else if count(Status::Skipped) == known {
            Status::Skipped
        } else if count(Status::Succeeded) + count(Status::Skipped) == known {
            Status::Succeeded
        } else if count(Status::Running) > 0 || count(Status::Succeeded) > 0 {
            Status::Running
        } else {
            Status::Pending
        }
    }

    /// The rolled up state. An entity finished when all children finished.
    fn finish(mut self) -> EntityState {
        if self.children > 0 && self.finished == self.children {
            self.stats.finished_at = self.finished_at;
        }
        EntityState { status: self.status(), stats: self.stats }
    }
}

/// Merge the report of an entity with the rollup of its children, reported values win
fn merge(reported: &EntityState, rollup: EntityState) -> EntityState {
    EntityState {
        status: if reported.status != Status::Unknown { reported.status } else { rollup.status },
        stats: reported.stats.or(&rollup.stats),
    }
}

/// Compute the effective state of all entities
///
/// The entities of `reported` and the slots, pipelines and fragments of the model are registered together, an index
/// outside of them reads as an unknown state and an absent role.
pub(super) fn compute_effective(model: &QueryProfile, reported: &Entities) -> Entities {
    let mut out = Entities { slots: reported.slots.clone(), ..Default::default() };
    let state = |states: &[EntityState], i: usize| states.get(i).copied().unwrap_or_default();
    let role = |s: u32| model.slots.get(s as usize).map(|slot| slot.role);

    // Operators from their slots
    out.operators = model
        .operators
        .iter()
        .enumerate()
        .map(|(o, op)| {
            let mut rollup = Rollup::default();
            let passes_on = op.slots.iter().any(|s| role(*s) != Some(fb::ProfileSlotRole::SINK));
            for &s in &op.slots {
                let slot = state(&out.slots, s as usize);
                rollup.add(&slot);
                rollup.add_input(&slot.stats);
                if !passes_on || role(s) != Some(fb::ProfileSlotRole::SINK) {
                    rollup.add_output(&slot.stats);
                }
            }
            merge(&state(&reported.operators, o), rollup.finish())
        })
        .collect();

    // Pipelines from their slots
    out.pipelines = model
        .pipelines
        .iter()
        .enumerate()
        .map(|(p, pipeline)| {
            let mut rollup = Rollup::default();
            for &s in &pipeline.slots {
                let slot = state(&out.slots, s as usize);
                rollup.add(&slot);
                match role(s) {
                    Some(fb::ProfileSlotRole::SOURCE) => rollup.add_input(&slot.stats),
                    Some(fb::ProfileSlotRole::SINK) => rollup.add_output(&slot.stats),
                    _ => {}
                }
            }
            merge(&state(&reported.pipelines, p), rollup.finish())
        })
        .collect();

    // Fragments from their pipelines, the operators fill what no pipeline knows.
    // A pipeline that crosses fragments adds its slots to the fragments of their operators instead.
    let mut pipelines_of: Vec<Vec<usize>> = vec![Vec::new(); model.fragments.len()];
    let mut slots_of: Vec<Vec<usize>> = vec![Vec::new(); model.fragments.len()];
    for (p, pipeline) in model.pipelines.iter().enumerate() {
        let Some(fragment) = pipeline.fragment else {
            continue;
        };
        let slot_fragment = |s: u32| {
            model
                .slots
                .get(s as usize)
                .and_then(|slot| model.operators.get(slot.operator as usize)?.fragment)
                .unwrap_or(fragment)
        };
        if pipeline.slots.iter().all(|&s| slot_fragment(s) == fragment) {
            if let Some(pipelines) = pipelines_of.get_mut(fragment as usize) {
                pipelines.push(p);
            }
        } else {
            for &s in &pipeline.slots {
                if let Some(slots) = slots_of.get_mut(slot_fragment(s) as usize) {
                    slots.push(s as usize);
                }
            }
        }
    }
    out.fragments = Vec::with_capacity(model.fragments.len());
    for (f, fragment) in model.fragments.iter().enumerate() {
        let (mut by_pipelines, mut by_operators) = (Rollup::default(), Rollup::default());
        for &p in pipelines_of.get(f).map(Vec::as_slice).unwrap_or_default() {
            by_pipelines.add(&state(&out.pipelines, p));
        }
        for &s in slots_of.get(f).map(Vec::as_slice).unwrap_or_default() {
            by_pipelines.add(&state(&out.slots, s));
        }
        for &o in &fragment.operators {
            by_operators.add(&state(&out.operators, o as usize));
        }
        let mut own = merge(&by_pipelines.finish(), by_operators.finish());
        if let Some(root) = fragment.root_operator {
            let root = state(&out.operators, root as usize).stats;
            (own.stats.tuples_out, own.stats.bytes_out) = (root.tuples_out, root.bytes_out);
        }
        out.fragments.push(merge(&state(&reported.fragments, f), own));
    }

    // The query from all fragments, its output is the output of the top-level fragments
    let mut rollup = Rollup::default();
    for (fragment, own) in model.fragments.iter().zip(&out.fragments) {
        rollup.add(own);
        if fragment.parent_fragment.is_none() {
            rollup.add_output(&own.stats);
        }
    }
    out.query = merge(&reported.query, rollup.finish());
    out
}
