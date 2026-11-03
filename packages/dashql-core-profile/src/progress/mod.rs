//! The execution state of a plan, driven by events.
//!
//! Engines report what they observe as input events (`ProfileInputEvent`): statistics of the query, of fragments,
//! pipelines, slots (an operator in a pipeline) or operators, on whatever level the engine has. The model rolls
//! them up (slot -> operator / pipeline -> fragment -> query, see `rollup`) and emits output events
//! (`ProfileUpdate`, packed as `QueryProfileEvents`) for every entity whose effective state changed. Reported values win
//! over rolled up values, and values that nobody reported stay unknown.
//!
//! Counters are cumulative, so applying an event twice changes nothing and a dropped event is repaired by the
//! next one. The input events have a JSON form (serde), a recorded event log replays an execution.

mod rollup;
mod trino;

use super::query_profile::QueryProfile;
use dashql_buffers::profile as fb;
use flatbuffers::FlatBufferBuilder;
use serde::{Deserialize, Serialize};

/// The execution status of an entity
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Not reported
    #[default]
    Unknown,
    /// Waiting to run
    Pending,
    /// Running
    Running,
    /// Finished successfully
    Succeeded,
    /// Failed
    Failed,
    /// Skipped
    Skipped,
}

impl Status {
    /// The FlatBuffers status
    pub fn to_fb(self) -> fb::ProfileExecutionStatus {
        match self {
            Status::Unknown => fb::ProfileExecutionStatus::UNKNOWN,
            Status::Pending => fb::ProfileExecutionStatus::PENDING,
            Status::Running => fb::ProfileExecutionStatus::RUNNING,
            Status::Succeeded => fb::ProfileExecutionStatus::SUCCEEDED,
            Status::Failed => fb::ProfileExecutionStatus::FAILED,
            Status::Skipped => fb::ProfileExecutionStatus::SKIPPED,
        }
    }
}

/// The execution statistics of an entity, `None` is unknown (not 0).
/// The counters are cumulative.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Stats {
    /// The time when the entity started in milliseconds since epoch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// The time when the entity finished in milliseconds since epoch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    /// The tuples consumed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tuples_in: Option<u64>,
    /// The tuples produced
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tuples_out: Option<u64>,
    /// The bytes consumed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_in: Option<u64>,
    /// The bytes produced
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_out: Option<u64>,
    /// The CPU time in microseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_time_us: Option<u64>,
    /// The wall time in microseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_time_us: Option<u64>,
    /// The blocked time in microseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_time_us: Option<u64>,
    /// The memory currently attributed to the entity in bytes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_bytes: Option<u64>,
    /// The bytes spilled to disk
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spilled_bytes: Option<u64>,
    /// The completed work units (splits, drivers, morsels)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_done: Option<u64>,
    /// The known work units
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_total: Option<u64>,
}

/// The `ProfileStatsField` bit of every field, in the order of `Stats::fields`
const FIELD_BITS: [fb::ProfileStatsField; 13] = [
    fb::ProfileStatsField::STARTED_AT,
    fb::ProfileStatsField::FINISHED_AT,
    fb::ProfileStatsField::TUPLES_IN,
    fb::ProfileStatsField::TUPLES_OUT,
    fb::ProfileStatsField::BYTES_IN,
    fb::ProfileStatsField::BYTES_OUT,
    fb::ProfileStatsField::CPU_TIME,
    fb::ProfileStatsField::WALL_TIME,
    fb::ProfileStatsField::BLOCKED_TIME,
    fb::ProfileStatsField::MEMORY_BYTES,
    fb::ProfileStatsField::SPILLED_BYTES,
    fb::ProfileStatsField::WORK_DONE,
    fb::ProfileStatsField::WORK_TOTAL,
];

impl Stats {
    /// The fields
    fn fields(&self) -> [Option<u64>; 13] {
        [
            self.started_at,
            self.finished_at,
            self.tuples_in,
            self.tuples_out,
            self.bytes_in,
            self.bytes_out,
            self.cpu_time_us,
            self.wall_time_us,
            self.blocked_time_us,
            self.memory_bytes,
            self.spilled_bytes,
            self.work_done,
            self.work_total,
        ]
    }

    /// The fields, mutable
    fn fields_mut(&mut self) -> [&mut Option<u64>; 13] {
        [
            &mut self.started_at,
            &mut self.finished_at,
            &mut self.tuples_in,
            &mut self.tuples_out,
            &mut self.bytes_in,
            &mut self.bytes_out,
            &mut self.cpu_time_us,
            &mut self.wall_time_us,
            &mut self.blocked_time_us,
            &mut self.memory_bytes,
            &mut self.spilled_bytes,
            &mut self.work_done,
            &mut self.work_total,
        ]
    }

    /// The reported fields (`ProfileStatsField` bits)
    pub fn reported(&self) -> u16 {
        self.fields().iter().zip(FIELD_BITS).filter(|(v, _)| v.is_some()).fold(0, |bits, (_, bit)| bits | bit.0)
    }

    /// Does the entity report nothing?
    pub fn is_empty(&self) -> bool {
        self.reported() == 0
    }

    /// Overwrite the fields that another report knows
    pub fn overwrite(&mut self, report: &Stats) {
        for (field, value) in self.fields_mut().into_iter().zip(report.fields()) {
            if value.is_some() {
                *field = value;
            }
        }
    }

    /// Fill the unknown fields from a fallback
    pub fn or(mut self, fallback: &Stats) -> Stats {
        for (field, value) in self.fields_mut().into_iter().zip(fallback.fields()) {
            if field.is_none() {
                *field = value;
            }
        }
        self
    }

    /// Pack as FlatBuffers struct
    pub fn to_fb(&self) -> fb::ProfileStats {
        let v = |field: Option<u64>| field.unwrap_or(0);
        fb::ProfileStats::new(
            self.reported(),
            v(self.started_at),
            v(self.finished_at),
            v(self.tuples_in),
            v(self.tuples_out),
            v(self.bytes_in),
            v(self.bytes_out),
            v(self.cpu_time_us),
            v(self.wall_time_us),
            v(self.blocked_time_us),
            v(self.memory_bytes),
            v(self.spilled_bytes),
            v(self.work_done),
            v(self.work_total),
        )
    }
}

/// An operator of a pipeline that is registered at runtime
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlotSpec {
    /// The operator
    pub operator: u32,
    /// The role of the operator in the pipeline
    pub role: SlotRole,
}

/// The role of an operator in a pipeline
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlotRole {
    /// Produces the tuples of the pipeline
    Source,
    /// Passes the tuples on
    Through,
    /// Consumes the tuples of the pipeline
    Sink,
}

impl SlotRole {
    /// The FlatBuffers role
    pub fn to_fb(self) -> fb::ProfileSlotRole {
        match self {
            SlotRole::Source => fb::ProfileSlotRole::SOURCE,
            SlotRole::Through => fb::ProfileSlotRole::THROUGH,
            SlotRole::Sink => fb::ProfileSlotRole::SINK,
        }
    }
}

/// An input event: what the engine reported. Entities are addressed by their index in the profile, entities
/// registered at runtime get the next free index.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ProfileInputEvent {
    /// A fragment appeared at runtime (a Trino stage without a plan yet)
    RegisterFragment {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The fragment id of the engine
        #[serde(default, skip_serializing_if = "Option::is_none")]
        engine_id: Option<String>,
        /// The enclosing fragment, must exist
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_fragment: Option<u32>,
    },
    /// A pipeline appeared at runtime (Trino pipelines are known from the operator summaries only)
    RegisterPipeline {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The pipeline id of the engine
        #[serde(default, skip_serializing_if = "Option::is_none")]
        engine_id: Option<String>,
        /// The fragment that runs the pipeline
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fragment: Option<u32>,
        /// The operators of the pipeline, they get the next slot indexes in this order
        slots: Vec<SlotSpec>,
    },
    /// The query state
    UpdateQuery {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The status, unchanged if missing
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<Status>,
        /// The reported statistics, missing fields are unchanged
        #[serde(default, skip_serializing_if = "Stats::is_empty")]
        stats: Stats,
    },
    /// The state of a fragment
    UpdateFragment {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The fragment
        fragment: u32,
        /// The status, unchanged if missing
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<Status>,
        /// The reported statistics, missing fields are unchanged
        #[serde(default, skip_serializing_if = "Stats::is_empty")]
        stats: Stats,
    },
    /// The state of a pipeline
    UpdatePipeline {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The pipeline
        pipeline: u32,
        /// The status, unchanged if missing
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<Status>,
        /// The reported statistics, missing fields are unchanged
        #[serde(default, skip_serializing_if = "Stats::is_empty")]
        stats: Stats,
    },
    /// The state of a slot (an operator in a pipeline)
    UpdateSlot {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The slot
        slot: u32,
        /// The status, unchanged if missing
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<Status>,
        /// The reported statistics, missing fields are unchanged
        #[serde(default, skip_serializing_if = "Stats::is_empty")]
        stats: Stats,
    },
    /// The state of an operator across its pipelines
    UpdateOperator {
        /// The event time in milliseconds since epoch
        time: u64,
        /// The operator
        operator: u32,
        /// The status, unchanged if missing
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<Status>,
        /// The reported statistics, missing fields are unchanged
        #[serde(default, skip_serializing_if = "Stats::is_empty")]
        stats: Stats,
    },
}

impl ProfileInputEvent {
    /// The event time
    pub fn time(&self) -> u64 {
        match self {
            ProfileInputEvent::RegisterFragment { time, .. }
            | ProfileInputEvent::RegisterPipeline { time, .. }
            | ProfileInputEvent::UpdateQuery { time, .. }
            | ProfileInputEvent::UpdateFragment { time, .. }
            | ProfileInputEvent::UpdatePipeline { time, .. }
            | ProfileInputEvent::UpdateSlot { time, .. }
            | ProfileInputEvent::UpdateOperator { time, .. } => *time,
        }
    }
}

/// The state of an entity
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EntityState {
    /// The status
    pub status: Status,
    /// The statistics
    pub stats: Stats,
}

impl EntityState {
    /// Apply a report
    fn apply(&mut self, status: Option<Status>, stats: &Stats) {
        if let Some(status) = status {
            self.status = status;
        }
        self.stats.overwrite(stats);
    }

    /// Is nothing known?
    fn is_unknown(&self) -> bool {
        self.status == Status::Unknown && self.stats.is_empty()
    }
}

/// An output event: the effective state of an entity changed
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProfileUpdate {
    /// The event time in milliseconds since epoch
    pub time: u64,
    /// The entity kind
    pub entity: fb::ProfileEntity,
    /// The entity index, 0 for the query
    pub index: u32,
    /// The effective state
    pub state: EntityState,
}

/// The states of all entities
#[derive(Clone, Debug, Default)]
pub(crate) struct Entities {
    /// The query
    pub(crate) query: EntityState,
    /// The fragments
    pub(crate) fragments: Vec<EntityState>,
    /// The pipelines
    pub(crate) pipelines: Vec<EntityState>,
    /// The slots
    pub(crate) slots: Vec<EntityState>,
    /// The operators
    pub(crate) operators: Vec<EntityState>,
}

impl Entities {
    /// Resize to the entity counts
    fn resize(&mut self, fragments: usize, pipelines: usize, slots: usize, operators: usize) {
        self.fragments.resize(fragments, EntityState::default());
        self.pipelines.resize(pipelines, EntityState::default());
        self.slots.resize(slots, EntityState::default());
        self.operators.resize(operators, EntityState::default());
    }

    /// The state of an entity
    fn get(&self, entity: fb::ProfileEntity, index: u32) -> Option<&EntityState> {
        let index = index as usize;
        match entity {
            fb::ProfileEntity::QUERY => Some(&self.query),
            fb::ProfileEntity::FRAGMENT => self.fragments.get(index),
            fb::ProfileEntity::PIPELINE => self.pipelines.get(index),
            fb::ProfileEntity::SLOT => self.slots.get(index),
            _ => self.operators.get(index),
        }
    }

    /// Visit every entity with its kind and index
    fn each(&self) -> impl Iterator<Item = (fb::ProfileEntity, u32, &EntityState)> {
        fn all(
            entity: fb::ProfileEntity,
            states: &[EntityState],
        ) -> impl Iterator<Item = (fb::ProfileEntity, u32, &EntityState)> {
            states.iter().enumerate().map(move |(i, s)| (entity, i as u32, s))
        }
        std::iter::once((fb::ProfileEntity::QUERY, 0, &self.query))
            .chain(all(fb::ProfileEntity::FRAGMENT, &self.fragments))
            .chain(all(fb::ProfileEntity::PIPELINE, &self.pipelines))
            .chain(all(fb::ProfileEntity::SLOT, &self.slots))
            .chain(all(fb::ProfileEntity::OPERATOR, &self.operators))
    }
}

/// The execution state of a plan
#[derive(Clone, Debug, Default)]
pub(crate) struct ExecutionState {
    /// What the engine reported
    pub(crate) reported: Entities,
    /// The effective states after rollups
    pub(crate) effective: Entities,
    /// The time when the effective state of an entity last changed, in the order of `Entities::each`
    pub(crate) changed_at: Vec<u64>,
}

impl ExecutionState {
    /// Resize to the entity counts
    pub(crate) fn resize(&mut self, fragments: usize, pipelines: usize, slots: usize, operators: usize) {
        self.reported.resize(fragments, pipelines, slots, operators);
        self.effective.resize(fragments, pipelines, slots, operators);
        self.changed_at.resize(1 + fragments + pipelines + slots + operators, 0);
    }
}

impl QueryProfile {
    /// Apply input events and return the updates of the effective state
    pub fn apply_events(&mut self, events: &[ProfileInputEvent]) -> Vec<ProfileUpdate> {
        let mut time = 0;
        for event in events {
            time = time.max(event.time());
            self.apply_event(event);
        }
        self.recompute(time)
    }

    /// Replay an event log: consecutive events with the same time form one batch (one poll of the engine).
    /// Returns the updates of all batches in order.
    pub fn replay(&mut self, events: &[ProfileInputEvent]) -> Vec<ProfileUpdate> {
        events.chunk_by(|a, b| a.time() == b.time()).flat_map(|batch| self.apply_events(batch)).collect()
    }

    /// Apply one input event, events that reference unknown entities are ignored
    fn apply_event(&mut self, event: &ProfileInputEvent) {
        let reported = &mut self.execution.reported;
        let update = |states: &mut Vec<EntityState>, index: u32, status: &Option<Status>, stats: &Stats| {
            if let Some(state) = states.get_mut(index as usize) {
                state.apply(*status, stats);
            }
        };
        match event {
            ProfileInputEvent::RegisterFragment { engine_id, parent_fragment, .. } => {
                if parent_fragment.is_some_and(|p| p as usize >= self.fragments.len()) {
                    return;
                }
                self.fragments.push(super::query_profile::Fragment {
                    engine_id: engine_id.clone(),
                    parent_fragment: *parent_fragment,
                    ..Default::default()
                });
                self.structure_changed();
            }
            ProfileInputEvent::RegisterPipeline { engine_id, fragment, slots, .. } => {
                if fragment.is_some_and(|f| f as usize >= self.fragments.len())
                    || slots.iter().any(|s| s.operator as usize >= self.operators.len())
                {
                    return;
                }
                let slots: Vec<_> = slots.iter().map(|s| (s.operator, s.role.to_fb())).collect();
                self.add_pipeline(engine_id.clone(), *fragment, &slots, Vec::new());
                self.structure_changed();
            }
            ProfileInputEvent::UpdateQuery { status, stats, .. } => reported.query.apply(*status, stats),
            ProfileInputEvent::UpdateFragment { fragment, status, stats, .. } => {
                update(&mut reported.fragments, *fragment, status, stats)
            }
            ProfileInputEvent::UpdatePipeline { pipeline, status, stats, .. } => {
                update(&mut reported.pipelines, *pipeline, status, stats)
            }
            ProfileInputEvent::UpdateSlot { slot, status, stats, .. } => {
                update(&mut reported.slots, *slot, status, stats)
            }
            ProfileInputEvent::UpdateOperator { operator, status, stats, .. } => {
                update(&mut reported.operators, *operator, status, stats)
            }
        }
    }

    /// The structure changed at runtime
    fn structure_changed(&mut self) {
        self.structure_version = self.structure_version.wrapping_add(1);
        self.execution.resize(self.fragments.len(), self.pipelines.len(), self.slots.len(), self.operators.len());
    }

    /// Recompute the effective state and return the entities that changed
    fn recompute(&mut self, time: u64) -> Vec<ProfileUpdate> {
        let effective = rollup::compute_effective(self, &self.execution.reported);
        let previous = std::mem::replace(&mut self.execution.effective, effective);
        let mut updates = Vec::new();
        let changed_at = &mut self.execution.changed_at;
        for (i, (entity, index, state)) in self.execution.effective.each().enumerate() {
            // An entity registered in this batch starts unknown
            let before = previous.get(entity, index).copied().unwrap_or_default();
            if before == *state {
                continue;
            }
            changed_at[i] = time;
            updates.push(ProfileUpdate { time, entity, index, state: *state });
        }
        updates
    }

    /// The current effective state as updates: one update for every entity that has a state.
    /// A renderer that mounts late applies them like any other updates.
    pub fn snapshot_events(&self) -> Vec<ProfileUpdate> {
        self.execution
            .effective
            .each()
            .zip(&self.execution.changed_at)
            .filter(|((_, _, state), _)| !state.is_unknown())
            .map(|((entity, index, state), time)| ProfileUpdate { time: *time, entity, index, state: *state })
            .collect()
    }

    /// Reset the execution state: drop all reported state and the structure that was registered at runtime.
    /// Replaying the events of an execution up to a point in time after a reset seeks backwards.
    pub fn reset_execution(&mut self) {
        let (fragments, pipelines, slots) = self.loaded_counts;
        let registered = self.fragments.len() > fragments || self.pipelines.len() > pipelines;
        self.fragments.truncate(fragments);
        self.pipelines.truncate(pipelines);
        self.slots.truncate(slots);
        for op in &mut self.operators {
            op.slots.retain(|s| (*s as usize) < slots);
        }
        for edge in &mut self.operator_edges {
            edge.slot = edge.slot.filter(|s| (*s as usize) < slots);
        }
        if registered {
            self.structure_version = self.structure_version.wrapping_add(1);
        }
        self.execution = ExecutionState::default();
        self.execution.resize(self.fragments.len(), self.pipelines.len(), self.slots.len(), self.operators.len());
    }

    /// Apply input events in their JSON form (an array of events)
    pub fn apply_events_json(&mut self, events: &[u8]) -> Result<Vec<ProfileUpdate>, serde_json::Error> {
        let events: Vec<ProfileInputEvent> = serde_json::from_slice(events)?;
        Ok(self.apply_events(&events))
    }

    /// Pack updates as `QueryProfileEvents`
    pub fn pack_events(&self, updates: &[ProfileUpdate]) -> Vec<u8> {
        let mut builder = FlatBufferBuilder::new();
        let events: Vec<fb::ProfileUpdateEvent> = updates
            .iter()
            .map(|u| {
                let stats = u.state.stats.to_fb();
                fb::ProfileUpdateEvent::new(u.time, u.entity, u.index, u.state.status.to_fb(), &stats)
            })
            .collect();
        let events = builder.create_vector(&events);
        let root = fb::QueryProfileEvents::create(
            &mut builder,
            &fb::QueryProfileEventsArgs { structure_version: self.structure_version, events: Some(events) },
        );
        builder.finish(root, None);
        builder.finished_data().to_vec()
    }
}
