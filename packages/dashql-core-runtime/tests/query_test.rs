//! Tests of the query executions and the progress of queries, ported from the reducer tests and
//! `tracked_query_execution.test.ts` of the TypeScript runtime and the progress model tests of
//! `query_progress_format.test.ts` and `profile_execution_controller.test.ts` of the app.

use dashql_buffers::profile as fb;
use dashql_core_profile::{EntityState, ProfileUpdate, Stats, Status};
use dashql_core_runtime::query::progress::{
    replay_recording, EngineProgressPayload, HyperExecutionStats, HyperQueryStatus, ProfileExecutionState,
    ProfileRecording, QueryProfileProgress, QueryProgressFollower, QueryProgressModels, NO_INDEX,
};
use dashql_core_runtime::query::{
    QueryError, QueryExecutionAction, QueryExecutionEffect, QueryExecutionHistory, QueryExecutionMetrics,
    QueryExecutionProgress, QueryExecutionState, QueryExecutionStatus, QueryId, QueryMetadata, QueryResultTable,
    QueryType, INTERNAL_QUERY_HISTORY_LIMIT,
};
use serde_json::{json, Value};

/// The time of the actions of a test
const NOW: i64 = 1_000;

fn metadata(query_type: QueryType, result_owner: Option<&str>) -> QueryMetadata {
    QueryMetadata { result_owner: result_owner.map(str::to_string), ..QueryMetadata::new(query_type) }
}

fn start(history: &mut QueryExecutionHistory, query_id: QueryId, meta: QueryMetadata) {
    let state = QueryExecutionState::new(query_id, 0, "select 1", meta, NOW);
    history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
}

/// The one-row result table of a query, the handle of the table is the query id
fn table(query_id: QueryId) -> QueryResultTable {
    QueryResultTable { id: query_id as u32, rows: 1 }
}

/// Start a query with a record of the host under a handle
fn start_with_record(history: &mut QueryExecutionHistory, query_id: QueryId, handle: u32) {
    let mut state = QueryExecutionState::new(query_id, 0, "select 1", metadata(QueryType::UserProvided, None), NOW);
    state.handle = Some(handle);
    history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
}

/// Finish a started query with a one-row table, returns the effects of the success
fn finish(history: &mut QueryExecutionHistory, query_id: QueryId) -> Vec<QueryExecutionEffect> {
    let metrics = QueryExecutionMetrics::default();
    history.apply(QueryExecutionAction::QueryReceivedBatch { query_id, metrics: metrics.clone(), now: NOW }).unwrap();
    history
        .apply(QueryExecutionAction::QueryReceivedAllBatches { query_id, table: table(query_id), metrics, now: NOW })
        .unwrap();
    history.apply(QueryExecutionAction::QuerySucceeded { query_id, now: NOW }).unwrap().effects
}

fn succeed(history: &mut QueryExecutionHistory, query_id: QueryId, meta: QueryMetadata) -> Vec<QueryExecutionEffect> {
    start(history, query_id, meta);
    finish(history, query_id)
}

fn result_of(history: &QueryExecutionHistory, query_id: QueryId) -> Option<QueryResultTable> {
    history.finished(query_id).unwrap().result_table
}

fn release(query_id: QueryId) -> QueryExecutionEffect {
    QueryExecutionEffect::Release { handle: table(query_id).id }
}

fn error(message: &str) -> QueryError {
    QueryError { message: message.into(), details: None }
}

// Finished queries

#[test]
fn finished_queries_keep_the_result_table_of_user_queries() {
    let mut history = QueryExecutionHistory::new();
    let effects = succeed(&mut history, 1, metadata(QueryType::UserProvided, None));
    assert!(effects.is_empty());
    assert_eq!(result_of(&history, 1).map(|t| t.rows), Some(1));
    assert!(history.active(1).is_none());
    assert_eq!(history.finished_ids(), &[1]);
}

#[test]
fn finished_queries_keep_only_the_metrics_of_internal_queries() {
    let mut history = QueryExecutionHistory::new();
    let effects = succeed(&mut history, 1, metadata(QueryType::CatalogQueryInformationSchema, None));
    // The host drops the table, the caller of the internal query has its result
    assert_eq!(effects, vec![release(1)]);
    assert_eq!(result_of(&history, 1), None);
    assert!(history.finished(1).unwrap().metrics.query_succeeded_at.is_some());
}

#[test]
fn finished_queries_keep_the_latest_result_of_an_owner() {
    let mut history = QueryExecutionHistory::new();
    succeed(&mut history, 1, metadata(QueryType::UserProvided, Some("s/1")));
    succeed(&mut history, 2, metadata(QueryType::UserProvided, Some("s/2")));
    let effects = succeed(&mut history, 3, metadata(QueryType::UserProvided, Some("s/1")));
    assert_eq!(effects, vec![release(1)]);
    assert_eq!(result_of(&history, 1), None);
    assert!(result_of(&history, 2).is_some());
    assert!(result_of(&history, 3).is_some());

    // An earlier query of the owner that finishes later does not replace the later result
    start(&mut history, 4, metadata(QueryType::UserProvided, Some("s/1")));
    let effects = succeed(&mut history, 5, metadata(QueryType::UserProvided, Some("s/1")));
    assert_eq!(effects, vec![release(3)]);
    let effects = finish(&mut history, 4);
    assert_eq!(effects, vec![release(4)]);
    assert_eq!(result_of(&history, 3), None);
    assert_eq!(result_of(&history, 4), None);
    assert!(result_of(&history, 5).is_some());
}

#[test]
fn finished_queries_keep_the_result_of_an_owner_when_a_later_query_fails() {
    let mut history = QueryExecutionHistory::new();
    succeed(&mut history, 1, metadata(QueryType::UserProvided, Some("s/1")));
    start(&mut history, 2, metadata(QueryType::UserProvided, Some("s/1")));
    let action = QueryExecutionAction::QueryFailed { query_id: 2, error: error("failed"), metrics: None, now: NOW };
    let outcome = history.apply(action).unwrap();
    assert!(outcome.effects.is_empty());
    assert!(result_of(&history, 1).is_some());
    let failed = history.finished(2).unwrap();
    assert_eq!(failed.status, QueryExecutionStatus::Failed);
    assert_eq!(failed.error, Some(error("failed")));
}

#[test]
fn finished_queries_keep_a_bounded_history_of_internal_queries() {
    let mut history = QueryExecutionHistory::new();
    succeed(&mut history, 0, metadata(QueryType::UserProvided, None));
    let last = (INTERNAL_QUERY_HISTORY_LIMIT + 10) as QueryId;
    for query_id in 1..=last {
        succeed(&mut history, query_id, metadata(QueryType::InternalSqlframe, None));
    }
    assert_eq!(history.finished_ids().len(), INTERNAL_QUERY_HISTORY_LIMIT + 1);
    // The user query stays, the oldest internal queries leave
    assert_eq!(history.finished_ids().first(), Some(&0));
    assert!(history.finished(0).is_some());
    assert!(history.query(1).is_none());
    assert!(history.query(10).is_none());
    assert!(history.finished(11).is_some());
    assert!(history.finished(last).is_some());
}

// Query cache bookkeeping

#[test]
fn query_cache_records_the_cache_key_of_active_and_finished_queries() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    let record = |served_from_cache, cached_at| QueryExecutionAction::QueryCacheRecorded {
        query_id: 1,
        cache_key: "key-1".into(),
        served_from_cache,
        cached_at,
    };
    history.apply(record(false, None)).unwrap();
    let active = history.active(1).unwrap();
    assert_eq!((active.cache_key.as_deref(), active.served_from_cache), (Some("key-1"), false));

    finish(&mut history, 1);
    // 2026-01-01 UTC
    let cached_at = 1_767_225_600_000;
    history.apply(record(true, Some(cached_at))).unwrap();
    let finished = history.finished(1).unwrap();
    assert_eq!(
        (finished.cache_key.as_deref(), finished.served_from_cache, finished.cached_at),
        (Some("key-1"), true, Some(cached_at))
    );
    // Recording again without a time keeps the time
    history.apply(record(true, None)).unwrap();
    assert_eq!(history.finished(1).unwrap().cached_at, Some(cached_at));

    let revision = history.finished(1).unwrap().revision;
    let outcome = history.apply(QueryExecutionAction::QueryCacheDeleted { query_id: 1 }).unwrap();
    assert!(outcome.changed);
    let finished = history.finished(1).unwrap();
    assert!(finished.cache_deleted);
    assert!(finished.revision > revision);
}

#[test]
fn query_cache_ignores_the_cache_of_unknown_queries() {
    let mut history = QueryExecutionHistory::new();
    let revision = history.revision();
    let outcome = history.apply(QueryExecutionAction::QueryCacheDeleted { query_id: 9 }).unwrap();
    assert!(!outcome.changed);
    let outcome = history.apply(QueryExecutionAction::QuerySucceeded { query_id: 9, now: NOW }).unwrap();
    assert!(!outcome.changed);
    assert_eq!(history.revision(), revision);
    assert_eq!(history.snapshot_queries_active_finished(), 0);
}

// Active queries

#[test]
fn active_queries_move_through_the_execution_statuses_and_become_queued_only_while_sending() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    let progress = || Box::new(QueryExecutionProgress { is_queued: Some(true), ..Default::default() });
    let steps = [
        (QueryExecutionAction::QuerySending { query_id: 1, now: 1 }, QueryExecutionStatus::Sending),
        (
            QueryExecutionAction::QueryProgressUpdated { query_id: 1, progress: progress(), now: 2 },
            QueryExecutionStatus::Queued,
        ),
        (QueryExecutionAction::QueryRunning { query_id: 1, now: 3 }, QueryExecutionStatus::Running),
        (
            QueryExecutionAction::QueryProgressUpdated { query_id: 1, progress: progress(), now: 4 },
            QueryExecutionStatus::Running,
        ),
        (QueryExecutionAction::QueryProcessingResults { query_id: 1, now: 5 }, QueryExecutionStatus::ProcessingResults),
        (QueryExecutionAction::QueryProcessedResults { query_id: 1, now: 6 }, QueryExecutionStatus::ProcessedResults),
    ];
    for (action, status) in steps {
        let revision = history.revision();
        let outcome = history.apply(action).unwrap();
        assert!(outcome.changed);
        assert!(history.revision() > revision);
        assert_eq!(history.active(1).unwrap().status, status);
    }
    let metrics = &history.active(1).unwrap().metrics;
    assert_eq!(metrics.progress_updates_received, 2);
    assert_eq!(metrics.query_sending_started_at, Some(1));
    assert_eq!(metrics.query_queued_started_at, Some(2));
    assert_eq!(metrics.query_running_started_at, Some(3));
    assert_eq!(metrics.processing_results_started_at, Some(5));
    assert_eq!(metrics.processed_results_at, Some(6));
    assert_eq!(metrics.last_updated_at, Some(6));
}

#[test]
fn active_queries_keep_the_profile_progress_of_an_earlier_update() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    let mut models = QueryProgressModels::default();
    let payload = EngineProgressPayload::TrinoStatementStats { stats: poll("RUNNING", 4), received_at: 1 };
    let profile = models.apply(1, payload).unwrap().clone();
    let progress = QueryExecutionProgress { profile_progress: Some(profile.clone()), ..Default::default() };
    history
        .apply(QueryExecutionAction::QueryProgressUpdated { query_id: 1, progress: Box::new(progress), now: 1 })
        .unwrap();
    // An update without structured progress, e.g. while the core loads
    let progress = QueryExecutionProgress { phase: Some("RUNNING".into()), ..Default::default() };
    history
        .apply(QueryExecutionAction::QueryProgressUpdated { query_id: 1, progress: Box::new(progress), now: 2 })
        .unwrap();
    let latest = history.active(1).unwrap().latest_progress_update.as_ref().unwrap();
    assert_eq!(latest.phase.as_deref(), Some("RUNNING"));
    assert_eq!(latest.profile_progress.as_ref(), Some(&profile));
}

#[test]
fn queries_count_for_the_metrics_of_the_connection_by_their_outcome() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    history.apply(QueryExecutionAction::QueryRunning { query_id: 1, now: NOW + 100 }).unwrap();
    let metrics = QueryExecutionMetrics {
        total_batches_received: 2,
        total_rows_received: 10,
        duration_until_first_batch_ms: Some(30),
        ..Default::default()
    };
    history
        .apply(QueryExecutionAction::QueryReceivedAllBatches { query_id: 1, table: table(1), metrics, now: NOW + 200 })
        .unwrap();
    history.apply(QueryExecutionAction::QuerySucceeded { query_id: 1, now: NOW + 300 }).unwrap();
    // The duration counts from running
    assert_eq!(history.finished(1).unwrap().metrics.query_duration_ms, Some(200));

    start(&mut history, 2, metadata(QueryType::UserProvided, None));
    let cancelled_metrics = QueryExecutionMetrics { total_batches_received: 1, ..Default::default() };
    let action = QueryExecutionAction::QueryCancelled {
        query_id: 2,
        error: error("cancelled"),
        metrics: Some(cancelled_metrics.clone()),
        now: NOW + 50,
    };
    history.apply(action).unwrap();
    // Without running, the duration counts from requested
    let cancelled = history.finished(2).unwrap();
    assert_eq!(cancelled.status, QueryExecutionStatus::Cancelled);
    assert_eq!(cancelled.metrics.query_duration_ms, Some(50));
    assert_eq!(cancelled.metrics.stream_metrics, cancelled_metrics);

    let metrics = history.metrics();
    assert_eq!(metrics.successful_queries.total_queries, 1);
    assert_eq!(metrics.successful_queries.total_batches_received, 2);
    assert_eq!(metrics.successful_queries.total_rows_received, 10);
    assert_eq!(metrics.successful_queries.accumulated_time_until_first_batch, 30);
    assert_eq!(metrics.successful_queries.accumulated_query_duration, 200);
    assert_eq!(metrics.canceled_queries.total_queries, 1);
    assert_eq!(metrics.canceled_queries.accumulated_query_duration, 50);
    assert_eq!(metrics.failed_queries.total_queries, 0);
    assert_eq!(history.snapshot_queries_active_finished(), 4);
}

#[test]
fn a_query_id_starts_only_once() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    let revision = history.revision();
    let again = QueryExecutionState::new(1, 0, "select 2", metadata(QueryType::UserProvided, None), NOW);
    assert!(history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(again.clone()) }).is_err());
    finish(&mut history, 1);
    let revision_finished = history.revision();
    assert!(revision_finished > revision);
    assert!(history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(again) }).is_err());
    assert_eq!(history.revision(), revision_finished);
    assert_eq!(history.active_ids(), &[] as &[QueryId]);
    assert_eq!(history.finished_ids(), &[1]);
}

#[test]
fn a_result_that_arrives_again_releases_the_earlier_one() {
    let mut history = QueryExecutionHistory::new();
    start(&mut history, 1, metadata(QueryType::UserProvided, None));
    let all = |id| QueryExecutionAction::QueryReceivedAllBatches {
        query_id: 1,
        table: QueryResultTable { id, rows: 1 },
        metrics: QueryExecutionMetrics::default(),
        now: NOW,
    };
    assert!(history.apply(all(10)).unwrap().effects.is_empty());
    let effects = history.apply(all(11)).unwrap().effects;
    assert_eq!(effects, vec![QueryExecutionEffect::Release { handle: 10 }]);
}

#[test]
fn a_result_that_no_active_query_takes_is_released() {
    let mut history = QueryExecutionHistory::new();
    succeed(&mut history, 1, metadata(QueryType::UserProvided, None));
    let late = QueryExecutionAction::QueryReceivedAllBatches {
        query_id: 1,
        table: QueryResultTable { id: 20, rows: 1 },
        metrics: QueryExecutionMetrics::default(),
        now: NOW,
    };
    let outcome = history.apply(late).unwrap();
    assert!(!outcome.changed);
    assert_eq!(outcome.effects, vec![QueryExecutionEffect::Release { handle: 20 }]);
    assert_eq!(result_of(&history, 1), Some(table(1)));
}

#[test]
fn a_query_that_leaves_a_limited_history_releases_its_record_and_its_table() {
    let mut history = QueryExecutionHistory::with_limit(1);
    start_with_record(&mut history, 1, 101);
    finish(&mut history, 1);
    let mut state = QueryExecutionState::new(2, 0, "select 2", metadata(QueryType::UserProvided, None), NOW);
    state.handle = Some(102);
    let outcome = history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
    assert_eq!(outcome.effects, vec![release(1), QueryExecutionEffect::Release { handle: 101 }]);
    assert_eq!(history.query(2).and_then(|query| query.handle), Some(102));
}

// A history of its own with a limit, e.g. the one of the shell

#[test]
fn a_limited_history_drops_the_oldest_finished_queries_first() {
    let mut history = QueryExecutionHistory::with_limit(3);
    succeed(&mut history, 1, metadata(QueryType::UserProvided, None));
    succeed(&mut history, 2, metadata(QueryType::UserProvided, None));
    start(&mut history, 3, metadata(QueryType::UserProvided, None));
    // The oldest finished query leaves with its result table
    let state = QueryExecutionState::new(4, 0, "select 4", metadata(QueryType::UserProvided, None), NOW);
    let outcome = history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
    assert!(outcome.changed);
    assert_eq!(outcome.effects, vec![release(1)]);
    assert_eq!(history.finished_ids(), &[2]);
    assert_eq!(history.active_ids(), &[3, 4]);
    assert!(history.query(1).is_none());
}

#[test]
fn a_limited_history_drops_the_oldest_active_queries_without_finished_ones() {
    let mut history = QueryExecutionHistory::with_limit(2);
    for query_id in 1..=4 {
        start(&mut history, query_id, metadata(QueryType::UserProvided, None));
    }
    assert_eq!(history.active_ids(), &[3, 4]);
    assert_eq!(history.finished_ids(), &[] as &[QueryId]);
    // A late action on a dropped query changes nothing
    let outcome = history.apply(QueryExecutionAction::QuerySucceeded { query_id: 1, now: NOW }).unwrap();
    assert!(!outcome.changed);
    assert!(history.query(1).is_none());
}

#[test]
fn a_history_without_a_limit_keeps_every_user_query() {
    let mut history = QueryExecutionHistory::new();
    for query_id in 1..=150 {
        succeed(&mut history, query_id, metadata(QueryType::UserProvided, None));
    }
    assert_eq!(history.finished_ids().len(), 150);
}

// Tracked query executions: the actions that `executeTrackedQuery` dispatches

fn internal_metadata() -> QueryMetadata {
    QueryMetadata {
        title: Some("Internal query".into()),
        issuer: Some("SQLFrame".into()),
        ..QueryMetadata::new(QueryType::InternalSqlframe)
    }
}

/// The actions of a tracked query that starts right away
fn start_tracked(history: &mut QueryExecutionHistory, query_id: QueryId, text: &str) {
    let state = QueryExecutionState::new(query_id, 7, text, internal_metadata(), NOW);
    history.apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
    history.apply(QueryExecutionAction::QuerySending { query_id, now: NOW }).unwrap();
    history.apply(QueryExecutionAction::QueryRunning { query_id, now: NOW }).unwrap();
}

#[test]
fn tracked_queries_use_the_shared_query_lifecycle_for_successful_executions() {
    let mut history = QueryExecutionHistory::new();
    start_tracked(&mut history, 1, "SELECT 1");
    history.apply(QueryExecutionAction::QuerySucceeded { query_id: 1, now: NOW }).unwrap();
    let query = history.finished(1).unwrap();
    assert_eq!(query.query_text, "SELECT 1");
    assert_eq!(query.query_metadata, internal_metadata());
    assert_eq!(query.status, QueryExecutionStatus::Succeeded);
    assert_eq!(query.metrics.text_length, Some(8));
}

#[test]
fn tracked_queries_record_failures_once() {
    let mut history = QueryExecutionHistory::new();
    start_tracked(&mut history, 1, "SELECT bad");
    let fail = || QueryExecutionAction::QueryFailed { query_id: 1, error: error("boom"), metrics: None, now: NOW };
    assert!(history.apply(fail()).unwrap().changed);
    assert!(!history.apply(fail()).unwrap().changed);
    let cancel = QueryExecutionAction::QueryCancelled { query_id: 1, error: error("late"), metrics: None, now: NOW };
    assert!(!history.apply(cancel).unwrap().changed);
    assert_eq!(history.finished_ids(), &[1]);
    let query = history.finished(1).unwrap();
    assert_eq!(query.status, QueryExecutionStatus::Failed);
    assert_eq!(query.error.as_ref().map(|e| e.message.as_str()), Some("boom"));
    assert_eq!(history.metrics().failed_queries.total_queries, 0);
}

#[test]
fn tracked_queries_do_not_count_internal_executions_as_connector_metrics() {
    let mut history = QueryExecutionHistory::new();
    start_tracked(&mut history, 1, "SELECT 1");
    history.apply(QueryExecutionAction::QuerySucceeded { query_id: 1, now: NOW }).unwrap();
    assert_eq!(history.metrics().successful_queries.total_queries, 0);
    assert_eq!(history.finished_ids().len(), 1);
}

// The progress of queries

/// The work done and the work total of an entity, the work done at most the total
fn work_of(state: Option<EntityState>) -> Option<(u64, u64)> {
    let stats = state?.stats;
    let (done, total) = (stats.work_done?, stats.work_total?);
    (total != 0).then_some((done.min(total), total))
}

fn structure(progress: &QueryProfileProgress) -> fb::QueryProfile<'_> {
    flatbuffers::root::<fb::QueryProfile>(&progress.structure).unwrap()
}

/// The fragments of a progress as engine id and parent engine id
fn fragments_of(progress: &QueryProfileProgress) -> Vec<(String, Option<String>)> {
    let profile = structure(progress);
    let dictionary = profile.string_dictionary().unwrap();
    let fragments = profile.fragments().unwrap();
    let engine_id = |index: usize| dictionary.get(fragments.get(index).engine_id() as usize).to_string();
    (0..fragments.len())
        .map(|i| {
            let parent = fragments.get(i).parent_fragment() as usize;
            (engine_id(i), (parent < fragments.len()).then(|| engine_id(parent)))
        })
        .collect()
}

fn operator_count(progress: &QueryProfileProgress) -> usize {
    structure(progress).operators().map_or(0, |operators| operators.len())
}

fn pipeline_count(progress: &QueryProfileProgress) -> usize {
    structure(progress).pipelines().map_or(0, |pipelines| pipelines.len())
}

/// The statement stats of a Trino poll with a stage tree 0 -> 1 -> 2
fn poll(state: &str, done: u64) -> Value {
    json!({
        "state": state,
        "completedSplits": done,
        "totalSplits": 20,
        "processedRows": 1000 * done,
        "rootStage": {
            "stageId": "0", "state": "RUNNING", "totalSplits": 2, "completedSplits": 0,
            "subStages": [{
                "stageId": "1", "state": "RUNNING", "totalSplits": 8, "completedSplits": done / 2,
                "subStages": [{ "stageId": "2", "state": "FINISHED", "totalSplits": 10, "completedSplits": 10, "cpuTimeMillis": 42 }],
            }],
        },
    })
}

fn stats(stats: Value, received_at: i64) -> EngineProgressPayload {
    EngineProgressPayload::TrinoStatementStats { stats, received_at }
}

/// A stage of a Trino QueryInfo with its plan
fn stage(id: &str, plan: Value) -> Value {
    json!({ "stageId": format!("q.{id}"), "plan": { "jsonRepresentation": plan.to_string() } })
}

#[test]
fn progress_models_follow_the_trino_polls_of_a_query_and_list_its_stages() {
    let mut models = QueryProgressModels::default();
    let first = models.apply(1, stats(poll("RUNNING", 4), 2)).unwrap().clone();
    assert_eq!(structure(&first).fragments().unwrap().len(), 3);
    assert_eq!(work_of(first.execution.query), Some((4, 20)));

    let second = models.apply(1, stats(poll("RUNNING", 8), 3)).unwrap().clone();
    assert!(second.revision > first.revision);
    assert_eq!(work_of(second.execution.query), Some((8, 20)));
    // A repeated poll changes nothing
    assert_eq!(models.apply(1, stats(poll("RUNNING", 8), 4)).unwrap().revision, second.revision);

    // The stages are the fragments, nested like the stage tree
    let fragments = fragments_of(&second);
    let expected = [("0", None), ("1", Some("0")), ("2", Some("1"))];
    assert_eq!(
        fragments,
        expected.map(|(id, parent)| (id.to_string(), parent.map(str::to_string))).to_vec()
    );
    let stages = &second.execution.fragments;
    assert_eq!(work_of(stages[1]), Some((4, 8)));
    assert_eq!(stages[2].unwrap().status, Status::Succeeded);
    assert_eq!(stages[2].unwrap().stats.cpu_time_us, Some(42_000));

    // Fields of unexpected types are not reported
    assert_eq!(models.apply(1, stats(json!({ "state": 7 }), 5)).unwrap().revision, second.revision);
    models.release(1);
    assert!(models.model(1).is_none());
}

#[test]
fn progress_models_replace_the_stages_with_the_plan_of_the_query_info_and_keep_their_state() {
    let mut models = QueryProgressModels::default();
    models.apply(2, stats(poll("RUNNING", 4), 1)).unwrap();
    let remote = |id: &str, source: &str| {
        json!({ "id": id, "name": "RemoteSource", "descriptor": { "sourceFragmentIds": format!("[{source}]") }, "children": [] })
    };
    let info = json!({ "queryId": "q", "stages": { "stages": [
        stage("0", json!({ "id": "1", "name": "Output", "children": [remote("2", "1")] })),
        stage("1", json!({ "id": "3", "name": "Aggregate", "children": [{ "id": "6", "name": "InnerJoin", "children": [
            { "id": "7", "name": "ScanFilter", "descriptor": { "table": "tpch:sf1:orders" }, "children": [] },
            { "id": "8", "name": "LocalExchange", "children": [remote("4", "2")] },
        ] }] })),
        stage("2", json!({ "id": "5", "name": "TableScan", "descriptor": { "table": "tpch:sf1:lineitem" }, "children": [] })),
    ] } });
    let progress = models.apply(2, EngineProgressPayload::TrinoQueryInfo { info, received_at: 2 }).unwrap().clone();
    assert_eq!(operator_count(&progress), 8);
    // The stages are the fragments of the plan, with the state of the latest poll
    assert_eq!(fragments_of(&progress), vec![("0".into(), None), ("1".into(), Some("0".into())), ("2".into(), Some("1".into()))]);
    assert_eq!(work_of(progress.execution.fragments[1]), Some((2, 8)));
    assert_eq!(work_of(progress.execution.query), Some((4, 20)));

    // A broken plan leaves the stages without plan
    let info = json!({ "stages": { "stages": [{ "stageId": "q.0", "plan": { "jsonRepresentation": "{" } }] } });
    let broken = models.apply(2, EngineProgressPayload::TrinoQueryInfo { info, received_at: 3 }).unwrap().clone();
    assert_eq!(operator_count(&broken), 0);
    assert_eq!(fragments_of(&broken).len(), 3);
    assert!(broken.structure_version != progress.structure_version);
}

#[test]
fn progress_models_apply_the_operator_summaries_of_a_later_query_info_to_the_plan() {
    let mut models = QueryProgressModels::default();
    let info = json!({ "queryId": "q", "stages": { "stages": [
        stage("0", json!({ "id": "1", "name": "Output", "children": [{ "id": "2", "name": "TableScan", "children": [] }] })),
    ] } });
    let loaded = models.apply(3, EngineProgressPayload::TrinoQueryInfo { info, received_at: 1 }).unwrap().clone();
    assert_eq!(pipeline_count(&loaded), 0);
    let summary = |operator_id: u32, plan_node_id: &str, rows: u64| {
        json!({ "pipelineId": 0, "operatorId": operator_id, "planNodeId": plan_node_id, "inputPositions": rows, "outputPositions": rows })
    };
    let sample = json!({ "stages": { "stages": [{ "stageId": "q.0", "state": "PENDING", "stageStats": {
        "operatorSummaries": [summary(0, "2", 25), summary(1, "1", 25)],
    } }] } });
    let progress =
        models.apply(3, EngineProgressPayload::TrinoQueryInfoStats { info: sample, received_at: 2 }).unwrap().clone();
    // The pipeline appears in the structure, the edge from the scan carries its rows
    assert_eq!(pipeline_count(&progress), 1);
    let edge = structure(&progress).operator_edges().unwrap().get(0);
    assert_eq!(progress.execution.edge_rows(edge.slot(), edge.child()), Some(25));
}

#[test]
fn progress_models_ignore_payloads_of_another_engine() {
    let mut models = QueryProgressModels::default();
    let first = models.apply(1, stats(poll("RUNNING", 4), 1)).unwrap().clone();
    let status = HyperQueryStatus { completion_status: "FINISHED".into(), row_count: None, progress: None, execution_stats: None };
    let other = models.apply(1, EngineProgressPayload::HyperQueryStatus { status, received_at: 2 }).unwrap();
    assert_eq!(*other, first);
    assert_eq!(models.model(1).unwrap().recording().len(), 1);
}

#[test]
fn profile_recordings_record_the_payloads_of_a_query_and_replay_them_to_any_point_in_time() {
    let mut models = QueryProgressModels::default();
    models.apply(5, stats(poll("RUNNING", 2), 1000)).unwrap();
    models.apply(5, stats(poll("RUNNING", 8), 4000)).unwrap();
    let progress = models.model(5).unwrap().progress().clone();
    let recording = progress.recording.snapshot();
    let elapsed: Vec<i64> = recording.payloads.iter().map(|p| p.elapsed_ms).collect();
    assert_eq!(elapsed, vec![0, 3000]);
    // The recording outlives the model, the progress keeps it
    models.release(5);
    assert_eq!(progress.recording.len(), 2);

    // The recording serializes as JSON
    let recording = ProfileRecording::from_json(&recording.to_json().to_string()).unwrap();
    assert_eq!(recording, progress.recording.snapshot());
    assert_eq!(replay_recording(&recording, -1, None), None);
    let early = replay_recording(&recording, 0, None).unwrap();
    assert_eq!(work_of(early.execution.query), Some((2, 20)));
    let late = replay_recording(&recording, 3000, None).unwrap();
    assert_eq!(work_of(late.execution.query), Some((8, 20)));
}

#[test]
fn profile_recordings_share_the_payloads_with_the_progress_of_every_update() {
    let mut models = QueryProgressModels::default();
    let first = models.apply(6, stats(poll("RUNNING", 2), 1000)).unwrap().clone();
    let second = models.apply(6, stats(poll("RUNNING", 4), 2000)).unwrap().clone();
    // An earlier update sees the later payloads
    assert_eq!(first.recording.len(), 2);
    assert_eq!(first.recording, second.recording);
    // The recording of another query is another one
    let other = models.apply(7, stats(poll("RUNNING", 2), 1000)).unwrap().clone();
    assert_ne!(other.recording, first.recording);
}

#[test]
fn profile_recordings_read_the_recordings_of_the_trino_test_harness() {
    let plan = json!({ "id": "1", "name": "Output", "children": [{ "id": "2", "name": "TableScan", "children": [] }] });
    let summary = |operator_id: u32, plan_node_id: &str| {
        json!({ "pipelineId": 0, "operatorId": operator_id, "planNodeId": plan_node_id, "inputPositions": 9, "outputPositions": 9 })
    };
    let final_info = json!({ "queryId": "q", "stages": { "stages": [{
        "stageId": "q.0", "state": "FINISHED",
        "plan": { "jsonRepresentation": plan.to_string() },
        "stageStats": { "operatorSummaries": [summary(0, "2"), summary(1, "1")] },
    }] } });
    let harness = json!({
        "statementResponses": [
            { "elapsedMs": 1, "body": { "stats": { "state": "QUEUED" } } },
            { "elapsedMs": 200, "body": { "stats": { "state": "RUNNING", "rootStage": { "stageId": "0", "state": "RUNNING" } } } },
            { "elapsedMs": 900, "body": { "stats": { "state": "FINISHED", "rootStage": { "stageId": "0", "state": "FINISHED" } } } },
        ],
        "queryInfos": [{ "elapsedMs": 800, "body": final_info }],
    });
    let recording = ProfileRecording::from_json(&harness.to_string()).unwrap();
    // The plans arrive when the stages appear, the operator summaries at the end
    let kinds: Vec<(i64, &str)> = recording
        .payloads
        .iter()
        .map(|p| {
            let kind = match p.payload {
                EngineProgressPayload::TrinoStatementStats { .. } => "trino_statement_stats",
                EngineProgressPayload::TrinoQueryInfo { .. } => "trino_query_info",
                EngineProgressPayload::TrinoQueryInfoStats { .. } => "trino_query_info_stats",
                EngineProgressPayload::HyperQueryStatus { .. } => "hyper_query_status",
            };
            (p.elapsed_ms, kind)
        })
        .collect();
    assert_eq!(
        kinds,
        [
            (1, "trino_statement_stats"),
            (200, "trino_statement_stats"),
            (200, "trino_query_info"),
            (800, "trino_query_info_stats"),
            (900, "trino_statement_stats"),
        ]
    );
    let early = replay_recording(&recording, 500, None).unwrap();
    assert_eq!(operator_count(&early), 2);
    assert_eq!(pipeline_count(&early), 0);
    let end = replay_recording(&recording, 900, None).unwrap();
    assert_eq!(pipeline_count(&end), 1);
    assert!(ProfileRecording::from_json(r#"{"a": 1}"#).is_err());
    assert!(ProfileRecording::from_json("{").is_err());
}

/// The layout of the progress of the app with an orientation
fn layout(orientation: fb::ProfileLayoutOrientation) -> fb::ProfileLayoutConfig {
    fb::ProfileLayoutConfig::new(56.0, 32.0, 32.0, 12.0, 12.0, 34.0, 8.0, 20, 8.5, 0.0, 40.0, orientation, 20.0)
}

fn orientation(progress: &QueryProfileProgress) -> fb::ProfileLayoutOrientation {
    structure(progress).layout_config().unwrap().input().orientation()
}

#[test]
fn progress_followers_follow_the_recording_of_a_query_with_the_other_orientation() {
    let (left_to_right, top_down) = (fb::ProfileLayoutOrientation::LEFT_TO_RIGHT, fb::ProfileLayoutOrientation::TOP_DOWN);
    let mut models = QueryProgressModels::new(Some(layout(left_to_right)));
    let info = json!({ "queryId": "q", "stages": { "stages": [
        stage("0", json!({ "id": "1", "name": "Output", "children": [{ "id": "2", "name": "InnerJoin", "children": [
            { "id": "3", "name": "TableScan", "children": [] },
            { "id": "4", "name": "TableScan", "children": [] },
        ] }] })),
    ] } });
    models.apply(4, stats(poll("RUNNING", 4), 1)).unwrap();
    let loaded = models.apply(4, EngineProgressPayload::TrinoQueryInfo { info, received_at: 2 }).unwrap().clone();
    assert_eq!(orientation(&loaded), left_to_right);

    let mut follower = QueryProgressFollower::new(Some(layout(top_down)));
    let rotated = follower.follow(&loaded.recording).unwrap().clone();
    assert_eq!(orientation(&rotated), top_down);
    assert_eq!(operator_count(&rotated), 4);
    assert_eq!(work_of(rotated.execution.query), Some((4, 20)));

    // A later payload of the query reaches the rotated plan as well
    let later = models.apply(4, stats(poll("RUNNING", 8), 3)).unwrap().clone();
    let followed = follower.follow(&later.recording).unwrap().clone();
    assert_eq!(orientation(&followed), top_down);
    assert_eq!(work_of(followed.execution.query), Some((8, 20)));
    assert!(followed.revision > rotated.revision);
    // Following again without a new payload changes nothing
    assert_eq!(follower.follow(&later.recording).unwrap().revision, followed.revision);

    // The recording of another query starts over
    let other = models.apply(5, stats(poll("RUNNING", 2), 1)).unwrap().clone();
    let switched = follower.follow(&other.recording).unwrap();
    assert_eq!(operator_count(switched), 0);
    assert_eq!(work_of(switched.execution.query), Some((2, 20)));
    // Nothing recorded, nothing followed
    let mut empty = QueryProgressFollower::new(None);
    assert!(empty.follow(&Default::default()).is_none());
}

#[test]
fn progress_models_fail_on_malformed_payloads_and_change_nothing() {
    let mut models = QueryProgressModels::default();
    let first = models.apply(1, stats(poll("RUNNING", 4), 1)).unwrap().clone();
    let info = json!({ "stages": { "stages": [{ "stageId": "q.0", "stageStats": { "operatorSummaries": 7 } }] } });
    let _ = models.apply(1, EngineProgressPayload::TrinoQueryInfoStats { info, received_at: 2 });
    let after = models.model(1).unwrap().progress();
    assert_eq!(after.execution, first.execution);
    assert_eq!(after.structure, first.structure);
}

#[test]
fn profile_execution_states_pack_as_the_events_of_the_core() {
    let mut models = QueryProgressModels::default();
    let progress = models.apply(1, stats(poll("RUNNING", 4), 1)).unwrap().clone();
    let bytes = progress.execution.pack_events(progress.structure_version);
    let events = flatbuffers::root::<fb::QueryProfileEvents>(&bytes).unwrap();
    assert_eq!(events.structure_version(), progress.structure_version);
    // One event per entity with state: the query and the three stages
    let events = events.events().unwrap();
    assert_eq!(events.len(), 4);
    let query = events.iter().find(|event| event.entity() == fb::ProfileEntity::QUERY).unwrap();
    assert_eq!(query.status(), fb::ProfileExecutionStatus::RUNNING);
    assert_eq!(query.stats().work_done(), 4);
    let stage = events.iter().find(|event| event.entity() == fb::ProfileEntity::FRAGMENT && event.index() == 2).unwrap();
    assert_eq!(stage.status(), fb::ProfileExecutionStatus::SUCCEEDED);
    // The empty state has no events
    let empty = ProfileExecutionState::default().pack_events(0);
    assert_eq!(flatbuffers::root::<fb::QueryProfileEvents>(&empty).unwrap().events().map_or(0, |e| e.len()), 0);
}

#[test]
fn engine_progress_payloads_read_their_json() {
    let status = HyperQueryStatus {
        completion_status: "RUNNING_OR_UNSPECIFIED".into(),
        row_count: Some(7.0),
        progress: Some(0.5),
        execution_stats: Some(HyperExecutionStats { wall_clock_time: 1.5, rows_processed: 12.0 }),
    };
    let payloads = [
        stats(poll("RUNNING", 4), 3),
        EngineProgressPayload::TrinoQueryInfo { info: json!({ "queryId": "q" }), received_at: 4 },
        EngineProgressPayload::TrinoQueryInfoStats { info: json!({ "queryId": "q" }), received_at: 5 },
        EngineProgressPayload::HyperQueryStatus { status, received_at: 6 },
    ];
    for payload in payloads {
        assert_eq!(EngineProgressPayload::from_json(&payload.to_json()).unwrap(), payload);
    }
    // The 64-bit numbers of a protocol may be strings
    let status = HyperQueryStatus::from_json(&json!({ "completionStatus": "FINISHED", "rowCount": "12" }));
    assert_eq!((status.row_count, status.progress, status.execution_stats), (Some(12.0), None, None));
    assert!(EngineProgressPayload::from_json(&json!({ "kind": "unknown" })).is_err());
    assert!(EngineProgressPayload::from_json(&json!({ "kind": "trino_query_info" })).is_err());
}

#[test]
fn hyper_query_progress_reports_the_progress_of_the_whole_query() {
    let mut models = QueryProgressModels::default();
    let status = |completion_status: &str, progress: Option<f64>| EngineProgressPayload::HyperQueryStatus {
        status: HyperQueryStatus {
            completion_status: completion_status.into(),
            row_count: Some(7.0),
            progress,
            execution_stats: Some(HyperExecutionStats { wall_clock_time: 1500.0, rows_processed: 12000.0 }),
        },
        received_at: 1,
    };
    let running = models.apply(4, status("RUNNING_OR_UNSPECIFIED", Some(0.42))).unwrap().clone();
    let query = running.execution.query.unwrap();
    assert_eq!(query.status, Status::Running);
    assert_eq!(work_of(Some(query)), Some((420, 1000)));
    assert_eq!((query.stats.tuples_in, query.stats.tuples_out, query.stats.wall_time_us), (Some(12000), Some(7), Some(1_500_000)));
    // Percentages count like fractions
    let percent = models.apply(4, status("RUNNING_OR_UNSPECIFIED", Some(60.0))).unwrap();
    assert_eq!(work_of(percent.execution.query), Some((600, 1000)));
    let finished = models.apply(4, status("FINISHED", None)).unwrap().clone();
    assert_eq!(finished.execution.query.unwrap().status, Status::Succeeded);
    assert_eq!(structure(&finished).fragments().map_or(0, |f| f.len()), 0);
    models.release(4);
}

// The execution state of a plan

fn update(entity: fb::ProfileEntity, index: u32, status: Status, tuples_out: Option<u64>) -> ProfileUpdate {
    ProfileUpdate { time: 0, entity, index, state: EntityState { status, stats: Stats { tuples_out, ..Default::default() } } }
}

fn operator_update(index: u32, status: Status, tuples_out: Option<u64>) -> ProfileUpdate {
    update(fb::ProfileEntity::OPERATOR, index, status, tuples_out)
}

#[test]
fn profile_execution_state_folds_updates() {
    let mut state = ProfileExecutionState::default();
    state.apply_updates(&[operator_update(0, Status::Running, Some(5)), operator_update(1, Status::Running, None)]);
    assert_eq!(state.operators[0].unwrap().status, Status::Running);
    let mut next = state.clone();
    next.apply_updates(&[operator_update(0, Status::Succeeded, Some(7))]);
    assert_ne!(next, state);
    assert_eq!(next.operators[0].unwrap().stats.tuples_out, Some(7));
    let mut same = state.clone();
    same.apply_updates(&[]);
    assert_eq!(same, state);
    // An index that no profile has is dropped
    same.apply_updates(&[operator_update(u32::MAX - 1, Status::Running, None)]);
    assert_eq!(same, state);
}

#[test]
fn profile_execution_state_takes_the_rows_of_an_edge_from_the_slot_of_the_child_else_from_the_child_operator() {
    let state = ProfileExecutionState::from_updates(&[
        update(fb::ProfileEntity::SLOT, 0, Status::Running, Some(3)),
        operator_update(0, Status::Running, Some(9)),
        operator_update(1, Status::Running, None),
    ]);
    assert_eq!(state.edge_rows(0, 0), Some(3));
    assert_eq!(state.edge_rows(NO_INDEX, 0), Some(9));
    assert_eq!(state.edge_rows(1, 0), Some(9));
    // Not reported is unknown, not 0
    assert_eq!(state.edge_rows(NO_INDEX, 1), None);
}

// Clearing the history of a stopped connection

#[test]
fn clearing_aborts_the_active_queries_and_releases_their_handles() {
    let mut history = QueryExecutionHistory::new();
    start_with_record(&mut history, 1, 101);
    finish(&mut history, 1);
    start_with_record(&mut history, 2, 102);
    let snapshot = history.snapshot_queries_active_finished();
    let revision = history.revision();
    let outcome = history.clear("Connection was reset");
    assert_eq!(
        outcome.effects,
        vec![
            QueryExecutionEffect::Abort { handle: 102, reason: "Connection was reset" },
            QueryExecutionEffect::Release { handle: 102 },
            release(1),
            QueryExecutionEffect::Release { handle: 101 },
        ]
    );
    assert!(history.query(1).is_none() && history.query(2).is_none());
    assert!(history.active_ids().is_empty() && history.finished_ids().is_empty());
    assert_eq!(history.metrics().successful_queries.total_queries, 0);
    assert!(history.snapshot_queries_active_finished() > snapshot);
    assert!(history.revision() > revision);
}
