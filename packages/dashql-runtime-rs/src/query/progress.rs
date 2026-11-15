//! The structured progress of a running query: the payloads that an engine reports, applied to a query profile.
//!
//! The progress model of a query owns a query profile (`dashql_core_profile`), which turns the payloads into the
//! structure of the plan (stages, pipelines, the operators once the plan is known) and the updates of its execution
//! state. The execution state folds the updates into the effective state of every entity. The model records the
//! payloads, replaying a recording reproduces the progress at any point in time.
//!
//! Ported from `packages/dashql-runtime/src/query/query_progress_model.ts` and `profile_execution_state.ts`.

use std::collections::HashMap;
use std::rc::Rc;

use dashql_buffers::profile as fb;
use dashql_core::error::{Error, Result};
use dashql_core_profile::{EntityState, ProfileInputEvent, ProfileUpdate, QueryProfile, Stats, Status};
use serde_json::Value;

use super::{QueryId, Timestamp};

/// No index of an entity (`u32::MAX`), e.g. an edge without slot
pub const NO_INDEX: u32 = u32::MAX;

/// The work units of a progress fraction, Hyper reports a fraction instead of work units
const HYPER_PROGRESS_UNITS: u64 = 1000;

/// The entities that an execution state holds per kind. A profile has far fewer, an update with a larger index is
/// dropped instead of growing the state.
const MAX_ENTITIES: usize = 1 << 20;

/// The execution statistics of a Hyper query, as the Hyper HTTP API reports them
#[derive(Clone, Debug, PartialEq)]
pub struct HyperExecutionStats {
    /// The wall clock time in milliseconds
    pub wall_clock_time: f64,
    /// The rows processed
    pub rows_processed: f64,
}

/// The status of a Hyper query, the fields of the Hyper HTTP API that describe its progress
#[derive(Clone, Debug, PartialEq)]
pub struct HyperQueryStatus {
    /// The completion status, e.g. `FINISHED`
    pub completion_status: String,
    /// The rows of the result
    pub row_count: Option<f64>,
    /// The progress as a fraction, values above 1 are percentages
    pub progress: Option<f64>,
    /// The execution statistics
    pub execution_stats: Option<HyperExecutionStats>,
}

/// A raw progress payload of an engine, with the time it was received at. The JSON of Trino is parsed already.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineProgressPayload {
    /// The `stats` of a Trino `/v1/statement` response
    TrinoStatementStats { stats: Value, received_at: Timestamp },
    /// The QueryInfo of a Trino query (`/v1/query/{id}`) with the plans of its stages
    TrinoQueryInfo { info: Value, received_at: Timestamp },
    /// A later QueryInfo of a Trino query: the operator summaries of the stages whose tasks are done
    TrinoQueryInfoStats { info: Value, received_at: Timestamp },
    /// The status of a Hyper query: the progress and the processed rows of the whole query
    HyperQueryStatus { status: HyperQueryStatus, received_at: Timestamp },
}

impl EngineProgressPayload {
    /// When the payload was received
    pub fn received_at(&self) -> Timestamp {
        match self {
            Self::TrinoStatementStats { received_at, .. }
            | Self::TrinoQueryInfo { received_at, .. }
            | Self::TrinoQueryInfoStats { received_at, .. }
            | Self::HyperQueryStatus { received_at, .. } => *received_at,
        }
    }

    /// The engine of the payload
    pub fn engine(&self) -> fb::ProfileEngine {
        match self {
            Self::TrinoStatementStats { .. } | Self::TrinoQueryInfo { .. } | Self::TrinoQueryInfoStats { .. } => {
                fb::ProfileEngine::TRINO
            }
            Self::HyperQueryStatus { .. } => fb::ProfileEngine::HYPER,
        }
    }
}

/// A non-negative value rounded to an integer, negative values and NaN are 0
fn round_unsigned(value: f64) -> u64 {
    value.round().max(0.0) as u64
}

/// A time in milliseconds for the query profile, which has no times before the epoch
fn profile_time(time: Timestamp) -> u64 {
    time.max(0) as u64
}

/// The input events of the status of a Hyper query: the query only, Hyper reports no stages or pipelines yet
pub fn hyper_query_events(status: &HyperQueryStatus, time: Timestamp) -> Vec<ProfileInputEvent> {
    let mut stats = Stats::default();
    if let Some(execution) = &status.execution_stats {
        stats.tuples_in = Some(round_unsigned(execution.rows_processed));
        stats.wall_time_us = Some(round_unsigned(execution.wall_clock_time * 1000.0));
    }
    if let Some(rows) = status.row_count {
        stats.tuples_out = Some(round_unsigned(rows));
    }
    if let Some(progress) = status.progress {
        // A fraction, values above 1 are percentages
        let fraction = if progress > 1.0 { progress / 100.0 } else { progress };
        let fraction = fraction.clamp(0.0, 1.0);
        stats.work_done = Some(round_unsigned(fraction * HYPER_PROGRESS_UNITS as f64));
        stats.work_total = Some(HYPER_PROGRESS_UNITS);
    }
    let finished = status.completion_status == "FINISHED";
    vec![ProfileInputEvent::UpdateQuery {
        time: profile_time(time),
        status: Some(if finished { Status::Succeeded } else { Status::Running }),
        stats,
    }]
}

/// The execution state of a plan: the effective state of every entity, folded from the updates of a query profile.
/// An entity without state is unknown.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProfileExecutionState {
    /// The query
    pub query: Option<EntityState>,
    /// The fragments, e.g. the stages of Trino
    pub fragments: Vec<Option<EntityState>>,
    /// The pipelines
    pub pipelines: Vec<Option<EntityState>>,
    /// The slots, an operator in a pipeline
    pub slots: Vec<Option<EntityState>>,
    /// The operators
    pub operators: Vec<Option<EntityState>>,
}

impl ProfileExecutionState {
    /// Fold updates into the state
    pub fn apply_updates(&mut self, updates: &[ProfileUpdate]) {
        fn set(states: &mut Vec<Option<EntityState>>, index: u32, state: EntityState) {
            let index = index as usize;
            if index >= MAX_ENTITIES {
                return;
            }
            if states.len() <= index {
                states.resize(index + 1, None);
            }
            if let Some(slot) = states.get_mut(index) {
                *slot = Some(state);
            }
        }
        for update in updates {
            match update.entity {
                fb::ProfileEntity::QUERY => self.query = Some(update.state),
                fb::ProfileEntity::FRAGMENT => set(&mut self.fragments, update.index, update.state),
                fb::ProfileEntity::PIPELINE => set(&mut self.pipelines, update.index, update.state),
                fb::ProfileEntity::SLOT => set(&mut self.slots, update.index, update.state),
                fb::ProfileEntity::OPERATOR => set(&mut self.operators, update.index, update.state),
                _ => {}
            }
        }
    }

    /// The state folded from updates
    pub fn from_updates(updates: &[ProfileUpdate]) -> Self {
        let mut state = Self::default();
        state.apply_updates(updates);
        state
    }

    /// The rows that flowed over an edge: the output of the slot of the child that carries the edge, or the output
    /// of the child operator if the slot reports none. None if unknown.
    pub fn edge_rows(&self, slot: u32, child_operator: u32) -> Option<u64> {
        let reported = |states: &[Option<EntityState>], index: u32| {
            states.get(index as usize).copied().flatten().and_then(|state| state.stats.tuples_out)
        };
        let from_slot = if slot != NO_INDEX { reported(&self.slots, slot) } else { None };
        from_slot.or_else(|| reported(&self.operators, child_operator))
    }
}

/// The structured progress of a query: the structure of its profile and its execution state
#[derive(Clone, Debug, PartialEq)]
pub struct QueryProfileProgress {
    /// The packed `QueryProfile` (FlatBuffers)
    pub structure: Rc<Vec<u8>>,
    /// The version of the structure, a new version is a new structure
    pub structure_version: u32,
    /// The execution state
    pub execution: Rc<ProfileExecutionState>,
    /// The revision of the progress, it changes when the structure or the execution state changes
    pub revision: u64,
}

/// A payload of a recording
#[derive(Clone, Debug, PartialEq)]
pub struct RecordedPayload {
    /// The milliseconds since the first payload
    pub elapsed_ms: i64,
    /// The payload
    pub payload: EngineProgressPayload,
}

/// A recording of the progress of a query: the payloads of the engine and when they arrived. Replaying the payloads
/// reproduces the progress at any point in time.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProfileRecording {
    /// The payloads in the order they arrived
    pub payloads: Vec<RecordedPayload>,
}

impl ProfileRecording {
    /// The version of the format of recordings
    pub const VERSION: u32 = 1;
}

/// A JSON payload as bytes for the query profile
fn json_bytes(value: &Value) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|e| Error::invalid_argument(format!("a progress payload is no JSON: {e}")))
}

/// The progress model of one query: a query profile that the payloads of the engine are applied to
pub struct QueryProgressModel {
    /// The query profile
    profile: QueryProfile,
    /// The engine of the query, payloads of other engines change nothing
    engine: fb::ProfileEngine,
    /// The progress so far
    progress: QueryProfileProgress,
    /// The latest statement stats (as JSON) and their time, applied again on top of a plan that arrives later
    latest_stats: Option<(Vec<u8>, u64)>,
    /// The payloads so far
    recording: ProfileRecording,
}

impl QueryProgressModel {
    /// A model for a query of an engine, with a layout of the plan or the default one
    pub fn new(engine: fb::ProfileEngine, layout: Option<&fb::ProfileLayoutConfig>) -> Self {
        let mut profile = QueryProfile::new();
        if let Some(layout) = layout {
            profile.configure(layout);
        }
        profile.start_query(engine);
        let progress = QueryProfileProgress {
            structure: Rc::new(profile.pack_buffer()),
            structure_version: profile.structure_version(),
            execution: Rc::new(ProfileExecutionState::default()),
            revision: 0,
        };
        Self { profile, engine, progress, latest_stats: None, recording: ProfileRecording::default() }
    }

    /// The engine of the query
    pub fn engine(&self) -> fb::ProfileEngine {
        self.engine
    }

    /// The progress so far
    pub fn progress(&self) -> &QueryProfileProgress {
        &self.progress
    }

    /// The payloads so far
    pub fn recording(&self) -> &ProfileRecording {
        &self.recording
    }

    /// Apply a payload of the engine. A payload of another engine changes nothing, a payload that changes neither the
    /// structure nor the execution state keeps the revision.
    pub fn apply(&mut self, payload: EngineProgressPayload) -> Result<&QueryProfileProgress> {
        if payload.engine() != self.engine {
            return Ok(&self.progress);
        }
        let received_at = payload.received_at();
        let time = profile_time(received_at);
        // The JSON is serialized before the profile changes, the profile parses it again and can't fail then
        let json = match &payload {
            EngineProgressPayload::TrinoStatementStats { stats: value, .. }
            | EngineProgressPayload::TrinoQueryInfo { info: value, .. }
            | EngineProgressPayload::TrinoQueryInfoStats { info: value, .. } => json_bytes(value)?,
            EngineProgressPayload::HyperQueryStatus { .. } => Vec::new(),
        };
        let json_error = |e: serde_json::Error| Error::invalid_argument(format!("a progress payload is no JSON: {e}"));
        let execution = match &payload {
            EngineProgressPayload::TrinoStatementStats { .. } => {
                let updates = self.profile.apply_trino_statement_stats(&json, time).map_err(json_error)?;
                self.latest_stats = Some((json, time));
                let mut execution = (*self.progress.execution).clone();
                execution.apply_updates(&updates);
                execution
            }
            EngineProgressPayload::TrinoQueryInfo { .. } => {
                // The plan replaces the stages that the stats registered. Without a plan the stages stay a list.
                if self.profile.parse_trino_plan(&json).is_ok() {
                    self.profile.compute_layout();
                } else {
                    self.profile.start_query(self.engine);
                }
                // The stats are cumulative, applying the latest ones again restores the state on the stages of the plan
                if let Some((stats, at)) = &self.latest_stats {
                    self.profile.apply_trino_statement_stats(stats, *at).map_err(json_error)?;
                }
                // The operator summaries of the stages that finished already
                self.profile.apply_trino_query_info(&json, time).map_err(json_error)?;
                ProfileExecutionState::from_updates(&self.profile.snapshot_events())
            }
            EngineProgressPayload::TrinoQueryInfoStats { .. } => {
                let updates = self.profile.apply_trino_query_info(&json, time).map_err(json_error)?;
                let mut execution = (*self.progress.execution).clone();
                execution.apply_updates(&updates);
                execution
            }
            EngineProgressPayload::HyperQueryStatus { status, .. } => {
                let updates = self.profile.apply_events(&hyper_query_events(status, received_at));
                let mut execution = (*self.progress.execution).clone();
                execution.apply_updates(&updates);
                execution
            }
        };
        let first = self.recording.payloads.first().map_or(received_at, |first| first.payload.received_at());
        self.recording.payloads.push(RecordedPayload { elapsed_ms: received_at.saturating_sub(first).max(0), payload });

        let structure_changed = self.profile.structure_version() != self.progress.structure_version;
        let execution_changed = execution != *self.progress.execution;
        if structure_changed {
            self.progress.structure = Rc::new(self.profile.pack_buffer());
            self.progress.structure_version = self.profile.structure_version();
        }
        if execution_changed {
            self.progress.execution = Rc::new(execution);
        }
        if structure_changed || execution_changed {
            self.progress.revision += 1;
        }
        Ok(&self.progress)
    }
}

/// Replay a recording up to a point in time (milliseconds since the first payload), none if nothing happened until
/// then
pub fn replay_recording(
    recording: &ProfileRecording,
    until_ms: i64,
    layout: Option<&fb::ProfileLayoutConfig>,
) -> Result<Option<QueryProfileProgress>> {
    let mut payloads = recording.payloads.iter().filter(|p| p.elapsed_ms <= until_ms).peekable();
    let Some(first) = payloads.peek() else {
        return Ok(None);
    };
    let mut model = QueryProgressModel::new(first.payload.engine(), layout);
    for recorded in payloads {
        model.apply(recorded.payload.clone())?;
    }
    Ok(Some(model.progress))
}

/// The progress models of running queries, created with the first payload of a query
#[derive(Default)]
pub struct QueryProgressModels {
    /// The models by query
    models: HashMap<QueryId, QueryProgressModel>,
    /// The layout of the plans
    layout: Option<fb::ProfileLayoutConfig>,
}

impl QueryProgressModels {
    /// The models with a layout of the plans or the default one
    pub fn new(layout: Option<fb::ProfileLayoutConfig>) -> Self {
        Self { models: HashMap::new(), layout }
    }

    /// Apply a payload to the model of a query, the first payload of a query creates its model for its engine
    pub fn apply(&mut self, query_id: QueryId, payload: EngineProgressPayload) -> Result<&QueryProfileProgress> {
        let layout = self.layout.as_ref();
        let model =
            self.models.entry(query_id).or_insert_with(|| QueryProgressModel::new(payload.engine(), layout));
        model.apply(payload)
    }

    /// The model of a query
    pub fn model(&self, query_id: QueryId) -> Option<&QueryProgressModel> {
        self.models.get(&query_id)
    }

    /// Release the model of a query
    pub fn release(&mut self, query_id: QueryId) {
        self.models.remove(&query_id);
    }
}
