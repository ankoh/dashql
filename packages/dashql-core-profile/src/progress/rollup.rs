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
//! Every operator belongs to one fragment only and every pipeline to one fragment, so nothing is counted twice.
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
        self.statuses[child.status as usize] += 1;
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
        let count = |status: Status| self.statuses[status as usize];
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
pub(super) fn compute_effective(model: &QueryProfile, reported: &Entities) -> Entities {
    let mut out = Entities { slots: reported.slots.clone(), ..Default::default() };

    // Operators from their slots
    out.operators = model
        .operators
        .iter()
        .enumerate()
        .map(|(o, op)| {
            let mut rollup = Rollup::default();
            let passes_on = op.slots.iter().any(|s| model.slots[*s as usize].role != fb::ProfileSlotRole::SINK);
            for &s in &op.slots {
                let slot = &out.slots[s as usize];
                rollup.add(slot);
                rollup.add_input(&slot.stats);
                if !passes_on || model.slots[s as usize].role != fb::ProfileSlotRole::SINK {
                    rollup.add_output(&slot.stats);
                }
            }
            merge(&reported.operators[o], rollup.finish())
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
                let slot = &out.slots[s as usize];
                rollup.add(slot);
                match model.slots[s as usize].role {
                    fb::ProfileSlotRole::SOURCE => rollup.add_input(&slot.stats),
                    fb::ProfileSlotRole::SINK => rollup.add_output(&slot.stats),
                    _ => {}
                }
            }
            merge(&reported.pipelines[p], rollup.finish())
        })
        .collect();

    // Fragments from their pipelines, the operators fill what no pipeline knows
    let mut pipelines_of: Vec<Vec<usize>> = vec![Vec::new(); model.fragments.len()];
    for (p, pipeline) in model.pipelines.iter().enumerate() {
        if let Some(f) = pipeline.fragment {
            pipelines_of[f as usize].push(p);
        }
    }
    out.fragments = Vec::with_capacity(model.fragments.len());
    for (f, fragment) in model.fragments.iter().enumerate() {
        let (mut by_pipelines, mut by_operators) = (Rollup::default(), Rollup::default());
        for &p in &pipelines_of[f] {
            by_pipelines.add(&out.pipelines[p]);
        }
        for &o in &fragment.operators {
            by_operators.add(&out.operators[o as usize]);
        }
        let mut own = merge(&by_pipelines.finish(), by_operators.finish());
        if let Some(root) = fragment.root_operator {
            let root = &out.operators[root as usize].stats;
            (own.stats.tuples_out, own.stats.bytes_out) = (root.tuples_out, root.bytes_out);
        }
        out.fragments.push(merge(&reported.fragments[f], own));
    }

    // The query from all fragments, its output is the output of the top-level fragments
    let mut rollup = Rollup::default();
    for (f, fragment) in model.fragments.iter().enumerate() {
        rollup.add(&out.fragments[f]);
        if fragment.parent_fragment.is_none() {
            rollup.add_output(&out.fragments[f].stats);
        }
    }
    out.query = merge(&reported.query, rollup.finish());
    out
}
