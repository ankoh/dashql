//! The structured progress of a running query: the payloads that an engine reports, applied to a query profile.
//!
//! The progress model of a query owns a query profile (`dashql_core_profile`), which turns the payloads into the
//! structure of the plan (stages, pipelines, the operators once the plan is known) and the updates of its execution
//! state. The execution state folds the updates into the effective state of every entity. The query executor keeps a
//! model per running query and reports the structured progress with every progress update, the query history keeps
//! the latest one.
//!
//! The model records the payloads, the progress of every update shares the recording. Replaying a recording
//! reproduces the progress at any point in time, a follower replays it with another layout of the plan, e.g. the
//! other orientation. A recording reads and writes the JSON of the app (`{"version": 1, "payloads": [...]}`) and reads
//! the recordings of the Trino test harness (`tests/snapshots/profiles/trino/recordings/`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use dashql_buffers::profile as fb;
use dashql_core::error::{Error, Result};
use dashql_core_profile::{EntityState, ProfileInputEvent, ProfileUpdate, QueryProfile, Stats, Status};
use flatbuffers::FlatBufferBuilder;
use serde_json::{json, Value};

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

    /// The payload as JSON: `{"kind": "trino_statement_stats", "stats": ..., "receivedAt": ...}`
    pub fn to_json(&self) -> Value {
        match self {
            Self::TrinoStatementStats { stats, received_at } => {
                json!({ "kind": "trino_statement_stats", "stats": stats, "receivedAt": received_at })
            }
            Self::TrinoQueryInfo { info, received_at } => {
                json!({ "kind": "trino_query_info", "info": info, "receivedAt": received_at })
            }
            Self::TrinoQueryInfoStats { info, received_at } => {
                json!({ "kind": "trino_query_info_stats", "info": info, "receivedAt": received_at })
            }
            Self::HyperQueryStatus { status, received_at } => json!({
                "kind": "hyper_query_status",
                "status": {
                    "completionStatus": status.completion_status,
                    "rowCount": status.row_count,
                    "progress": status.progress,
                    "executionStats": status.execution_stats.as_ref().map(|stats| json!({
                        "wallClockTime": stats.wall_clock_time,
                        "rowsProcessed": stats.rows_processed,
                    })),
                },
                "receivedAt": received_at,
            }),
        }
    }

    /// A payload from its JSON
    pub fn from_json(value: &Value) -> Result<Self> {
        let received_at = value.get("receivedAt").and_then(Value::as_f64).map_or(0, |at| at as Timestamp);
        let field = |key: &str| {
            value.get(key).cloned().ok_or_else(|| Error::invalid_argument(format!("a progress payload without {key}")))
        };
        match value.get("kind").and_then(Value::as_str) {
            Some("trino_statement_stats") => Ok(Self::TrinoStatementStats { stats: field("stats")?, received_at }),
            Some("trino_query_info") => Ok(Self::TrinoQueryInfo { info: field("info")?, received_at }),
            Some("trino_query_info_stats") => Ok(Self::TrinoQueryInfoStats { info: field("info")?, received_at }),
            Some("hyper_query_status") => {
                Ok(Self::HyperQueryStatus { status: HyperQueryStatus::from_json(&field("status")?), received_at })
            }
            _ => Err(Error::invalid_argument("a progress payload of an unknown kind")),
        }
    }
}

/// A number of JSON, also as a string, e.g. a 64-bit integer of a protocol
fn json_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    }
}

impl HyperQueryStatus {
    /// The status from the JSON of the Hyper HTTP API, missing fields are unknown
    pub fn from_json(value: &Value) -> Self {
        let stats = value.get("executionStats").filter(|stats| stats.is_object());
        HyperQueryStatus {
            completion_status: value.get("completionStatus").and_then(Value::as_str).unwrap_or_default().to_string(),
            row_count: json_number(value.get("rowCount")),
            progress: json_number(value.get("progress")),
            execution_stats: stats.map(|stats| HyperExecutionStats {
                wall_clock_time: json_number(stats.get("wallClockTime")).unwrap_or(0.0),
                rows_processed: json_number(stats.get("rowsProcessed")).unwrap_or(0.0),
            }),
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

    /// The state as packed `QueryProfileEvents` of the core: one update per entity with state, for the structure of
    /// a version. Folding the events into an empty state gives this state.
    pub fn pack_events(&self, structure_version: u32) -> Vec<u8> {
        let mut events = Vec::new();
        let mut push = |entity: fb::ProfileEntity, index: usize, state: &EntityState| {
            let stats = state.stats.to_fb();
            events.push(fb::ProfileUpdateEvent::new(0, entity, index as u32, state.status.to_fb(), &stats));
        };
        if let Some(query) = &self.query {
            push(fb::ProfileEntity::QUERY, 0, query);
        }
        let lists = [
            (fb::ProfileEntity::FRAGMENT, &self.fragments),
            (fb::ProfileEntity::PIPELINE, &self.pipelines),
            (fb::ProfileEntity::SLOT, &self.slots),
            (fb::ProfileEntity::OPERATOR, &self.operators),
        ];
        for (entity, states) in lists {
            for (index, state) in states.iter().enumerate() {
                if let Some(state) = state {
                    push(entity, index, state);
                }
            }
        }
        let mut builder = FlatBufferBuilder::new();
        let events = builder.create_vector(&events);
        let root = fb::QueryProfileEvents::create(
            &mut builder,
            &fb::QueryProfileEventsArgs { structure_version, events: Some(events) },
        );
        builder.finish(root, None);
        builder.finished_data().to_vec()
    }
}

/// The structured progress of a query: the structure of its profile, its execution state and the recording of the
/// payloads so far
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
    /// The payloads so far, the model of the query adds the later ones
    pub recording: SharedRecording,
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

    /// The recording as JSON: `{"version": 1, "payloads": [{"elapsedMs": ..., "payload": ...}]}`
    pub fn to_json(&self) -> Value {
        let payloads: Vec<Value> = self
            .payloads
            .iter()
            .map(|recorded| json!({ "elapsedMs": recorded.elapsed_ms, "payload": recorded.payload.to_json() }))
            .collect();
        json!({ "version": Self::VERSION, "payloads": payloads })
    }

    /// Read a recording: a recording of the app, or a recording of the Trino test harness
    /// (`tests/snapshots/profiles/trino/recordings/`, written by `//packages/trino-testing:trino_recorder`)
    pub fn from_json(text: &str) -> Result<Self> {
        let document: Value = serde_json::from_str(text)
            .map_err(|e| Error::invalid_argument(format!("the file is no profile recording: {e}")))?;
        if let (Some(1), Some(payloads)) =
            (document.get("version").and_then(Value::as_u64), document.get("payloads").and_then(Value::as_array))
        {
            let payloads = payloads
                .iter()
                .map(|recorded| {
                    let elapsed_ms = recorded.get("elapsedMs").and_then(Value::as_f64).map_or(0, |ms| ms as i64);
                    let payload = EngineProgressPayload::from_json(recorded.get("payload").unwrap_or(&Value::Null))?;
                    Ok(RecordedPayload { elapsed_ms, payload })
                })
                .collect::<Result<Vec<_>>>()?;
            return Ok(Self { payloads });
        }
        if document.get("statementResponses").is_some_and(Value::is_array) {
            return Ok(Self::from_trino_harness(&document));
        }
        Err(Error::invalid_argument("the file is no profile recording"))
    }

    /// Convert a recording of the Trino test harness. Its QueryInfos are the ones the app fetches when the tasks of
    /// stages are done and when the query finished. The last one carries the plans, the app requests them when the
    /// stages appear, so the plans move there, without the operator summaries that arrive with the later QueryInfos.
    fn from_trino_harness(recording: &Value) -> Self {
        let samples = |key: &str| recording.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
        let elapsed = |sample: &Value| sample.get("elapsedMs").and_then(Value::as_f64).map_or(0, |ms| ms as i64);
        let statements = samples("statementResponses");
        let infos = samples("queryInfos");
        let mut payloads = Vec::new();
        for response in &statements {
            let Some(stats) = response.get("body").and_then(|body| body.get("stats")) else { continue };
            let at = elapsed(response);
            payloads.push(RecordedPayload {
                elapsed_ms: at,
                payload: EngineProgressPayload::TrinoStatementStats { stats: stats.clone(), received_at: at },
            });
        }
        for sample in &infos {
            let at = elapsed(sample);
            let info = sample.get("body").cloned().unwrap_or(Value::Null);
            payloads.push(RecordedPayload {
                elapsed_ms: at,
                payload: EngineProgressPayload::TrinoQueryInfoStats { info, received_at: at },
            });
        }
        let has_stages = |response: &&Value| {
            let stage = response.get("body").and_then(|body| body.get("stats")).and_then(|stats| stats.get("rootStage"));
            stage.is_some_and(|stage| !stage.is_null())
        };
        let stages_at = statements.iter().find(has_stages).map(elapsed);
        if let (Some(mut plans), Some(at)) = (infos.last().and_then(|sample| sample.get("body")).cloned(), stages_at) {
            let stages = plans.get_mut("stages").and_then(|stages| stages.get_mut("stages")).and_then(Value::as_array_mut);
            for stage in stages.into_iter().flatten() {
                let Some(stage) = stage.as_object_mut() else { continue };
                let stats = stage.entry("stageStats").or_insert_with(|| json!({}));
                if !stats.is_object() {
                    *stats = json!({});
                }
                if let Some(stats) = stats.as_object_mut() {
                    stats.insert("operatorSummaries".to_string(), json!([]));
                }
            }
            payloads.push(RecordedPayload {
                elapsed_ms: at,
                payload: EngineProgressPayload::TrinoQueryInfo { info: plans, received_at: at },
            });
        }
        // Stable, the payloads of a point in time keep their order
        payloads.sort_by_key(|recorded| recorded.elapsed_ms);
        Self { payloads }
    }
}

/// The recording of a running query that its model extends and the progress of every update shares. Two recordings
/// are equal if they are the same.
#[derive(Clone, Default)]
pub struct SharedRecording(Rc<RefCell<ProfileRecording>>);

impl SharedRecording {
    /// The payloads recorded so far
    pub fn len(&self) -> usize {
        self.0.try_borrow().map_or(0, |recording| recording.payloads.len())
    }

    /// Is the recording empty?
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The recording so far
    pub fn snapshot(&self) -> ProfileRecording {
        self.0.try_borrow().map(|recording| recording.clone()).unwrap_or_default()
    }

    /// The payloads from an index on
    pub fn payloads_from(&self, start: usize) -> Vec<RecordedPayload> {
        self.0.try_borrow().map(|recording| recording.payloads.get(start..).unwrap_or_default().to_vec()).unwrap_or_default()
    }

    /// When the first payload was received
    fn first_received_at(&self) -> Option<Timestamp> {
        self.0.try_borrow().ok()?.payloads.first().map(|first| first.payload.received_at())
    }

    /// Record a payload
    fn push(&self, payload: RecordedPayload) {
        if let Ok(mut recording) = self.0.try_borrow_mut() {
            recording.payloads.push(payload);
        }
    }

    /// Is it the same recording?
    pub fn same(&self, other: &SharedRecording) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl PartialEq for SharedRecording {
    fn eq(&self, other: &Self) -> bool {
        self.same(other)
    }
}

impl std::fmt::Debug for SharedRecording {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SharedRecording").field("payloads", &self.len()).finish()
    }
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
            recording: SharedRecording::default(),
        };
        Self { profile, engine, progress, latest_stats: None }
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
    pub fn recording(&self) -> &SharedRecording {
        &self.progress.recording
    }

    /// Apply a payload of the engine. A payload of another engine changes nothing, a payload that changes neither the
    /// structure nor the execution state keeps the revision. A malformed payload fails and changes nothing.
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
        let first = self.progress.recording.first_received_at().unwrap_or(received_at);
        self.progress.recording.push(RecordedPayload { elapsed_ms: received_at.saturating_sub(first).max(0), payload });

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
/// then. A malformed payload is skipped, like by the model of the query.
pub fn replay_recording(
    recording: &ProfileRecording,
    until_ms: i64,
    layout: Option<&fb::ProfileLayoutConfig>,
) -> Option<QueryProfileProgress> {
    let mut payloads = recording.payloads.iter().filter(|p| p.elapsed_ms <= until_ms).peekable();
    let first = payloads.peek()?;
    let mut model = QueryProgressModel::new(first.payload.engine(), layout);
    for recorded in payloads {
        let _ = model.apply(recorded.payload.clone());
    }
    Some(model.progress)
}

/// A progress model that follows the recording of the progress of a query with a layout of its own, e.g. the other
/// orientation of the plan. The model of the query keeps its layout, the follower applies the recorded payloads again,
/// the ones that are recorded later as they come.
pub struct QueryProgressFollower {
    /// The layout of the plan
    layout: Option<fb::ProfileLayoutConfig>,
    /// The model, created with the first payload
    model: Option<QueryProgressModel>,
    /// The recording that the follower follows
    source: Option<SharedRecording>,
    /// The payloads of the recording that the model applied
    applied: usize,
}

impl QueryProgressFollower {
    /// A follower with a layout of the plan or the default one
    pub fn new(layout: Option<fb::ProfileLayoutConfig>) -> Self {
        Self { layout, model: None, source: None, applied: 0 }
    }

    /// Follow the recording of the progress of a query, none before its first payload. The recording of another
    /// query starts over. A malformed payload is skipped, like by the model of the query.
    pub fn follow(&mut self, recording: &SharedRecording) -> Option<&QueryProfileProgress> {
        let length = recording.len();
        if !self.source.as_ref().is_some_and(|source| source.same(recording)) || length < self.applied {
            self.model = None;
            self.applied = 0;
            self.source = Some(recording.clone());
        }
        for recorded in recording.payloads_from(self.applied) {
            let layout = self.layout.as_ref();
            let model = self.model.get_or_insert_with(|| QueryProgressModel::new(recorded.payload.engine(), layout));
            let _ = model.apply(recorded.payload);
        }
        self.applied = length;
        self.model.as_ref().map(QueryProgressModel::progress)
    }
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
