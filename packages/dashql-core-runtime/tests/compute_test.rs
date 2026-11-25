//! Tests of the computations of result tables.
//!
//! The state owns what it holds: a test checks whether the state holds a data frame, compares the holds before and
//! after a step where a step takes or lets go of one, and reads the releases from the effects. The Arrow tables are
//! Rust values that go with their last clone, a table of the tests has a column of numbers.

use std::collections::BTreeSet;

use dashql_core_runtime::compute::cross_filters::{CrossFilterPredicate, CrossFilters};
use dashql_core_runtime::compute::types::{
    ArrowTable, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ColumnStatsFields, ColumnSummary, ComputationTask,
    ComputationVersion, DataFrameId, DataSearchTable, DataSearchTask, FilterOp, FilterTable, FilteredColumnAggregate,
    FilteredColumnAggregationTask, OrderByConstraint, OrderingTable, OrdinalColumnGroup, RowFilter,
    RowNumberColumnGroup, ScalarFilter, StringColumnGroup, SystemColumnsTask, TableAggregation, TableAggregationTask,
    TableFilteringTask, TableId, TableOrderingTask, TaskId, TaskProgressUpdate, TaskStatus,
};
use dashql_core_runtime::compute::{
    ComputationAction, ComputationEffect, ComputationOutcome, ComputationState, SearchKind, COMPUTATION_DROPPED,
};

/// The time of the actions
const NOW: i64 = 1_000;
/// A table of the host with a number of rows
fn arrow_table(id: u32, rows: u64) -> ArrowTable {
    ArrowTable::host(id, rows)
}

/// The result table of the tests
fn input_table() -> ArrowTable {
    arrow_table(100, 4)
}

/// The table with the row numbers of the filtered or ordered rows
fn row_table() -> ArrowTable {
    arrow_table(101, 2)
}
/// The statistics of the table
const AGGREGATE_TABLE: u32 = 102;
/// The binned values of the score column
const SCORE_SUMMARY: u32 = 103;

/// The score column, ordinal
fn score() -> OrdinalColumnGroup {
    OrdinalColumnGroup {
        input_field_name: "score".into(),
        input_field_type: "Float64".into(),
        input_field_nullable: true,
        stats_fields: Some(ColumnStatsFields {
            count_field_name: "_1_count".into(),
            distinct_count_field_name: None,
            min_aggregate_field_name: Some("_1_min".into()),
            max_aggregate_field_name: Some("_1_max".into()),
        }),
        bin_field_name: None,
        bin_count: 10,
    }
}

/// The column groups of the result table: the row numbers and the score
fn input_columns() -> Vec<ColumnGroup> {
    vec![
        ColumnGroup::RowNumber(RowNumberColumnGroup { row_number_field_name: "rowNumber".into() }),
        ColumnGroup::Ordinal(score()),
    ]
}

/// A string column with value ids
fn category() -> StringColumnGroup {
    StringColumnGroup {
        input_field_name: "category".into(),
        input_field_type: "Utf8".into(),
        input_field_nullable: true,
        stats_fields: None,
        value_id_field_name: Some("_category_id".into()),
    }
}

/// An ordinal column with bins
fn binned(name: &str, bin_field_name: Option<&str>) -> OrdinalColumnGroup {
    OrdinalColumnGroup {
        input_field_name: name.into(),
        input_field_type: "Float64".into(),
        input_field_nullable: false,
        stats_fields: None,
        bin_field_name: bin_field_name.map(str::to_string),
        bin_count: 10,
    }
}

/// The summary of the score column in a data frame
fn score_summary(data_frame: DataFrameId) -> ColumnAggregate {
    ColumnAggregate::Ordinal(ColumnSummary { table: arrow_table(SCORE_SUMMARY, 4), data_frame, analysis: None })
}

/// The summary of the score column over the selected rows of a filter version
fn filtered_score_summary(data_frame: DataFrameId, filter_version: ComputationVersion) -> FilteredColumnAggregate {
    FilteredColumnAggregate { aggregate: score_summary(data_frame), filter_version, data_search_request_id: None }
}

/// The statistics of the table in a data frame
fn table_aggregation(data_frame: DataFrameId) -> TableAggregation {
    TableAggregation { table: arrow_table(AGGREGATE_TABLE, 1), data_frame, count_star_field_name: "_count_star".into() }
}

/// The filtered rows of a filter version
fn filter_table(data_frame: DataFrameId, version: ComputationVersion) -> FilterTable {
    FilterTable { input_row_number_column_name: "rowNumber".into(), table: row_table(), data_frame, version }
}

/// The score descending
fn score_descending() -> Vec<OrderByConstraint> {
    vec![OrderByConstraint { field: "score".into(), ascending: Some(false), nulls_first: Some(false) }]
}

/// The ordered rows of a version
fn ordering_table(
    data_frame: DataFrameId,
    constraints: Vec<OrderByConstraint>,
    version: ComputationVersion,
) -> OrderingTable {
    OrderingTable {
        input_row_number_column_name: "rowNumber".into(),
        ordering_constraints: constraints,
        table: row_table(),
        data_frame,
        version,
        data_search_request_id: None,
    }
}

/// The rows of a data search
fn search_table(data_frame: DataFrameId, version: ComputationVersion, request_id: u64) -> DataSearchTable {
    DataSearchTable {
        input_row_number_column_name: "rowNumber".into(),
        table: arrow_table(104, 2),
        data_frame,
        version,
        request_id,
    }
}

fn apply(state: &mut ComputationState, action: ComputationAction) -> ComputationOutcome {
    state.apply(action).unwrap()
}

/// The data frames that an outcome releases
fn released(outcome: &ComputationOutcome) -> Vec<DataFrameId> {
    outcome
        .effects
        .iter()
        .filter_map(|effect| match effect {
            ComputationEffect::ReleaseDataFrame { data_frame } => Some(*data_frame),
            _ => None,
        })
        .collect()
}

/// Start the computation of table 1 of the input table on a connection
fn from_query_result(table_id: TableId, lifetime: u32) -> ComputationAction {
    ComputationAction::ComputationFromQueryResult {
        table_id,
        data_table: input_table(),
        fields: vec!["rowNumber".into(), "score".into()],
        column_groups: input_columns(),
        lifetime,
        connection_id: Some("connection".into()),
        client_context: None,
    }
}

/// A state with table 1 of the input table, copied into a data frame
fn state_with_table(data_frame: DataFrameId) -> ComputationState {
    let mut state = ComputationState::new();
    apply(&mut state, from_query_result(1, 1));
    apply(&mut state, ComputationAction::CreatedDataFrame { table_id: 1, data_frame });
    state
}

/// The version of table 1
fn version(state: &ComputationState) -> ComputationVersion {
    state.computation(1).unwrap().version
}

fn schedule(state: &mut ComputationState, task: ComputationTask) -> TaskId {
    apply(state, ComputationAction::ScheduleTask { task, now: NOW }).task_id.unwrap()
}

fn update(state: &mut ComputationState, task_id: TaskId, status: TaskStatus) -> ComputationOutcome {
    let progress = TaskProgressUpdate { status: Some(status), completed_at: Some(NOW + 1), ..Default::default() };
    apply(state, ComputationAction::UpdateSchedulerTask { task_id, progress, now: NOW + 1 })
}

/// Port of `releaseAllRegisteredDataFramesFromLatestState`: dropping the tasks and the computations releases every
/// data frame that the state holds, each once
fn release_all(mut state: ComputationState) {
    let held = state.data_frames();
    assert!(!held.is_empty());
    let mut releases = Vec::new();
    let tasks: Vec<TaskId> = state.scheduler_tasks().map(|(id, _)| id).collect();
    for task_id in tasks {
        releases.extend(released(&apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id })));
    }
    let tables: Vec<TableId> = state.computations().map(|(id, _)| id).collect();
    for table_id in tables {
        releases.extend(released(&apply(&mut state, ComputationAction::DeleteComputation { table_id })));
    }
    assert_eq!(releases.len(), held.len());
    assert_eq!(releases.into_iter().collect::<BTreeSet<_>>(), held);
    assert!(state.data_frames().is_empty());
    assert!(state.arrow_tables().is_empty());
}

#[test]
fn configure_a_computation_state() {
    let state = ComputationState::new();
    assert_eq!(state.computations().count(), 0);
    assert!(state.data_frames().is_empty());
}

#[test]
fn computation_from_query_result() {
    let mut state = ComputationState::new();
    let outcome = apply(&mut state, from_query_result(1, 7));
    assert!(outcome.changed);
    assert!(outcome.effects.is_empty());
    assert_eq!(state.computations().count(), 1);
    let computation = state.computation(1).unwrap();
    // The computation queries are tracked on the connection that ran the query of the table
    assert_eq!(computation.connection_id.as_deref(), Some("connection"));
    assert_eq!(computation.data_table, input_table());
    assert_eq!(computation.field_index("rowNumber"), Some(0));
    assert_eq!(computation.field_index("score"), Some(1));
    assert_eq!(computation.field_index("other"), None);
    assert_eq!(computation.column_groups, input_columns());
    assert_eq!(computation.lifetime, 7);
    assert_eq!(computation.data_frame, None);
}

#[test]
fn keeps_column_matches_visible_while_a_replacement_search_is_pending() {
    let mut state = state_with_table(1);
    let set = |pattern: &str| ComputationAction::SetResultSearchPattern {
        table_id: 1,
        kind: SearchKind::Columns,
        pattern: pattern.into(),
    };
    apply(&mut state, set("score"));
    let outcome = apply(
        &mut state,
        ComputationAction::ColumnSearchSucceeded {
            table_id: 1,
            data_frame: 1,
            request_id: 1,
            matching_column_groups: vec![1],
        },
    );
    assert!(outcome.changed);
    apply(&mut state, set("sc"));

    let search = &state.computation(1).unwrap().column_search;
    assert!(search.pending);
    assert_eq!(search.requested_pattern, "sc");
    assert_eq!(search.applied_pattern, "score");
    assert_eq!(search.matching_column_groups, Some(vec![1]));

    // The same pending pattern changes nothing
    assert!(!apply(&mut state, set("sc")).changed);
}

#[test]
fn accepts_the_latest_materialized_data_search_without_changing_the_filter_version() {
    let mut state = state_with_table(1);
    apply(
        &mut state,
        ComputationAction::SetResultSearchPattern { table_id: 1, kind: SearchKind::Data, pattern: "10".into() },
    );
    let before = version(&state);

    let matching_rows = 2;
    let outcome = apply(
        &mut state,
        ComputationAction::DataSearchSucceeded {
            table_id: 1,
            data_frame: 1,
            request_id: 1,
            search: search_table(2, before, 1),
            matching_rows,
            now: NOW,
        },
    );
    assert!(outcome.changed);
    assert!(outcome.effects.is_empty());

    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, before);
    assert_eq!(computation.data_search.matching_rows, Some(matching_rows));
    assert!(!computation.data_search.pending);
    assert_eq!(computation.data_search.applied_pattern, "10");
    assert_eq!(computation.data_search_table.as_ref().map(|search| search.data_frame), Some(2));
    assert!(state.holds_data_frame(2));
}

#[test]
fn drops_the_data_search_of_the_latest_request_when_it_fails() {
    let mut state = state_with_table(1);
    let set = |pattern: &str| ComputationAction::SetResultSearchPattern {
        table_id: 1,
        kind: SearchKind::Data,
        pattern: pattern.into(),
    };
    apply(&mut state, set("10"));
    let search = search_table(2, version(&state), 1);
    apply(
        &mut state,
        ComputationAction::DataSearchSucceeded {
            table_id: 1,
            data_frame: 1,
            request_id: 1,
            search,
            matching_rows: 1,
            now: NOW,
        },
    );
    apply(&mut state, set("42"));
    assert_eq!(state.computation(1).unwrap().data_search_table.as_ref().map(|search| search.data_frame), Some(2));
    let latest = state.computation(1).unwrap().data_search.request_id;

    // Failures of older requests and of other data frames are ignored
    let failed = |data_frame: DataFrameId, request_id: u64, error: &str| ComputationAction::DataSearchFailed {
        table_id: 1,
        data_frame,
        request_id,
        error: error.into(),
    };
    let revision = state.revision();
    assert_eq!(apply(&mut state, failed(1, 1, "stale")), ComputationOutcome::default());
    assert_eq!(apply(&mut state, failed(2, latest, "other")), ComputationOutcome::default());
    assert_eq!(state.revision(), revision);

    let outcome = apply(&mut state, failed(1, latest, "boom"));
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.data_search.error.as_deref(), Some("boom"));
    assert!(!computation.data_search.pending);
    assert_eq!(computation.data_search.matching_rows, None);
    assert_eq!(computation.data_search.applied_pattern, "");
    assert_eq!(computation.data_search_table, None);
    assert_eq!(released(&outcome), vec![2]);
    assert!(!state.data_frames().contains(&2));
}

#[test]
fn records_the_error_of_a_failed_column_search() {
    let mut state = state_with_table(1);
    apply(
        &mut state,
        ComputationAction::SetResultSearchPattern { table_id: 1, kind: SearchKind::Columns, pattern: "sc".into() },
    );
    let request_id = state.computation(1).unwrap().column_search.request_id;
    let failed = |request_id: u64, error: &str| ComputationAction::ResultSearchFailed {
        table_id: 1,
        data_frame: 1,
        kind: SearchKind::Columns,
        request_id,
        error: error.into(),
    };

    assert!(!apply(&mut state, failed(request_id + 1, "stale")).changed);
    assert!(apply(&mut state, failed(request_id, "bad pattern")).changed);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.column_search.error.as_deref(), Some("bad pattern"));
    assert!(!computation.column_search.pending);
    assert_eq!(computation.column_search.matching_column_groups, None);
    assert_eq!(computation.data_search.error, None);
}

#[test]
fn keeps_the_state_for_equal_cross_filters() {
    let mut state = state_with_table(1);
    let set = |filters: CrossFilters, table_id: TableId| ComputationAction::SetCrossFilters { table_id, filters };
    assert!(!apply(&mut state, set(CrossFilters::new(), 1)).changed);
    assert!(!apply(&mut state, set(CrossFilters::new(), 7)).changed);

    let mut filters = CrossFilters::new();
    filters.set_most_frequent_values(1, &category(), &[3]);
    assert!(apply(&mut state, set(filters.clone(), 1)).changed);
    assert_eq!(state.computation(1).unwrap().cross_filters, filters);
}

#[test]
fn tracks_the_latest_data_search_task_and_ignores_progress_of_older_requests() {
    let mut state = state_with_table(1);
    let search_task = |request_id: u64| {
        ComputationTask::DataSearch(DataSearchTask {
            table_id: 1,
            table_version: ComputationVersion::new(0, 0),
            input_data_frame: 1,
            row_number_column_name: "rowNumber".into(),
            columns: Vec::new(),
            pattern: "a".into(),
            request_id,
        })
    };
    let first = schedule(&mut state, search_task(1));
    let outcome = apply(&mut state, ComputationAction::ScheduleTask { task: search_task(2), now: NOW });
    let second = outcome.task_id.unwrap();
    // The second search aborts the first
    assert_eq!(outcome.effects, vec![ComputationEffect::AbortDataSearch { table_id: 1, request_id: 1 }]);
    let tracked = |state: &ComputationState| state.computation(1).unwrap().tasks.data_search.clone().unwrap();
    assert_eq!(tracked(&state).task.request_id, 2);

    assert_eq!(tracked(&state).task_id, second);
    assert_eq!(state.task_ids(), BTreeSet::from([first, second]));

    update(&mut state, first, TaskStatus::Succeeded);
    assert_eq!(tracked(&state).progress.status, TaskStatus::Running);
    assert_eq!(tracked(&state).task_id, second);
    update(&mut state, second, TaskStatus::Succeeded);
    assert_eq!(tracked(&state).progress.status, TaskStatus::Succeeded);
    assert_eq!(tracked(&state).progress.completed_at, Some(NOW + 1));
}

#[test]
fn delete_computation() {
    let mut state = ComputationState::new();
    apply(&mut state, from_query_result(1, 7));
    let outcome = apply(&mut state, ComputationAction::DeleteComputation { table_id: 1 });
    assert_eq!(state.computations().count(), 0);
    assert_eq!(
        outcome.effects,
        vec![
            ComputationEffect::Abort { handle: 7, reason: COMPUTATION_DROPPED },
            ComputationEffect::Release { handle: 7 },
            ComputationEffect::Release { handle: input_table().id },
        ]
    );
    // Deleting an unknown computation changes nothing
    assert_eq!(apply(&mut state, ComputationAction::DeleteComputation { table_id: 1 }), ComputationOutcome::default());
}

#[test]
fn releases_the_previous_computation_when_replacing_the_same_table_id() {
    let mut state = ComputationState::new();
    apply(&mut state, from_query_result(1, 1));
    apply(&mut state, ComputationAction::CreatedDataFrame { table_id: 1, data_frame: 9 });
    let revision = state.computation(1).unwrap().revision();

    let outcome = apply(&mut state, from_query_result(1, 2));
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.data_frame, None);
    assert_ne!(computation.revision(), revision);
    assert!(!state.data_frames().contains(&9));
    assert_eq!(
        outcome.effects,
        vec![
            ComputationEffect::Abort { handle: 1, reason: COMPUTATION_DROPPED },
            ComputationEffect::Release { handle: 1 },
            ComputationEffect::ReleaseDataFrame { data_frame: 9 },
        ]
    );
}

#[test]
fn filtering_task() {
    let mut state = state_with_table(1);
    let before = version(&state);
    let unscheduled = state.data_frame_holds(1);
    let task_id = schedule(
        &mut state,
        ComputationTask::TableFiltering(TableFilteringTask {
            table_id: 1,
            table_version: ComputationVersion::new(0, 20),
            input_data_table: input_table(),
            input_data_frame: 1,
            row_number_column_name: "rowNumber".into(),
            filters: vec![ScalarFilter { field_name: "score".into(), op: FilterOp::Less, value: 20.0 }.into()],
        }),
    );
    assert_eq!(state.scheduler_tasks().count(), 1);
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::TableFiltering(_))));
    // Scheduling a filtering moves the filter version, the task computes the filter for it
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, before.with_filter_increment());
    let Some(ComputationTask::TableFiltering(task)) = state.scheduler_task(task_id) else { unreachable!() };
    assert_eq!(task.table_version, before.with_filter_increment());
    let tracked = computation.tasks.filtering.as_ref().unwrap();
    assert_eq!(tracked.progress.status, TaskStatus::Running);
    assert_eq!(tracked.progress.started_at, NOW);
    assert_eq!(state.data_frames().len(), 1);
    // The filtering task and the scheduler task hold the data frame too
    let scheduled = state.data_frame_holds(1);
    assert!(scheduled > unscheduled);
    assert!(state.holds_data_frame(1));
    assert!(!state.holds_data_frame(2));
    assert!(state.holds_arrow_table(input_table().id));
    assert!(!state.holds_arrow_table(row_table().id));
    assert_eq!(tracked.task_id, task_id);

    update(&mut state, task_id, TaskStatus::Succeeded);
    assert_eq!(state.computation(1).unwrap().tasks.filtering.as_ref().unwrap().progress.status, TaskStatus::Succeeded);

    let outcome = apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert!(outcome.changed);
    assert!(outcome.effects.is_empty());
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 1);
    // The scheduler task let go of the data frame, the computation and its task hold it
    assert!(state.data_frame_holds(1) < scheduled);
    assert!(state.holds_data_frame(1));
    assert!(state.computation(1).unwrap().tasks.filtering.is_some());
    release_all(state);
}

/// An ordering task of the score descending
fn ordering_task(constraints: Vec<OrderByConstraint>) -> ComputationTask {
    ComputationTask::TableOrdering(TableOrderingTask {
        table_id: 1,
        table_version: ComputationVersion::new(0, 20),
        input_data_table: input_table(),
        input_data_frame: 1,
        filter_table: None,
        data_search_table: None,
        row_number_column_name: "rowNumber".into(),
        ordering_constraints: constraints,
    })
}

#[test]
fn ordering_task_is_scheduled() {
    let mut state = state_with_table(1);
    let task_id = schedule(&mut state, ordering_task(score_descending()));
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::TableOrdering(_))));
    let tracked = state.computation(1).unwrap().tasks.ordering.clone().unwrap();
    assert_eq!(tracked.progress.status, TaskStatus::Running);
    // The computation tracks the ordering for its version
    assert_eq!(tracked.task.table_version, version(&state));
    assert_eq!(state.data_frames().len(), 1);
    assert!(state.holds_data_frame(1));

    update(&mut state, task_id, TaskStatus::Succeeded);
    assert_eq!(state.computation(1).unwrap().tasks.ordering.as_ref().unwrap().progress.status, TaskStatus::Succeeded);

    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 1);
    assert!(state.computation(1).unwrap().tasks.ordering.is_some());
    release_all(state);
}

#[test]
fn ordering_progress_of_another_ordering_is_ignored() {
    let mut state = state_with_table(1);
    let first = schedule(&mut state, ordering_task(score_descending()));
    schedule(&mut state, ordering_task(Vec::new()));
    // The progress of the first ordering doesn't replace the second one
    let outcome = update(&mut state, first, TaskStatus::Succeeded);
    assert!(!outcome.changed);
    let tracked = state.computation(1).unwrap().tasks.ordering.clone().unwrap();
    assert_eq!(tracked.task.ordering_constraints, Vec::new());
    assert_eq!(tracked.progress.status, TaskStatus::Running);
}

#[test]
fn table_aggregation_task() {
    let mut state = state_with_table(1);
    let task_id = schedule(
        &mut state,
        ComputationTask::TableAggregation(TableAggregationTask {
            table_id: 1,
            table_version: ComputationVersion::new(0, 20),
            column_entries: input_columns(),
            input_data_frame: 1,
        }),
    );
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::TableAggregation(_))));
    assert_eq!(
        state.computation(1).unwrap().tasks.table_aggregation.as_ref().unwrap().progress.status,
        TaskStatus::Running
    );
    assert_eq!(state.data_frames().len(), 1);

    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 1);
    assert!(state.computation(1).unwrap().tasks.table_aggregation.is_some());

    // The statistics replace the earlier ones
    apply(
        &mut state,
        ComputationAction::TableAggregationSucceeded { table_id: 1, aggregation: table_aggregation(2), now: NOW },
    );
    let outcome = apply(
        &mut state,
        ComputationAction::TableAggregationSucceeded { table_id: 1, aggregation: table_aggregation(3), now: NOW },
    );
    assert_eq!(released(&outcome), vec![2]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.table_aggregation.as_ref().map(|aggregation| aggregation.data_frame), Some(3));
    assert_eq!(computation.tasks.table_aggregation.as_ref().unwrap().progress.status, TaskStatus::Succeeded);
    release_all(state);
}

#[test]
fn system_column_computation_task() {
    let mut state = state_with_table(1);
    let task_id = schedule(
        &mut state,
        ComputationTask::SystemColumns(SystemColumnsTask {
            table_id: 1,
            table_version: ComputationVersion::new(0, 20),
            column_entries: input_columns(),
            input_table: input_table(),
            input_data_frame: 1,
            row_number_field_name: "_rownum".into(),
            table_aggregate: table_aggregation(2),
        }),
    );
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::SystemColumns(_))));
    assert_eq!(
        state.computation(1).unwrap().tasks.system_columns.as_ref().unwrap().progress.status,
        TaskStatus::Running
    );
    assert_eq!(state.data_frames().len(), 2);
    assert!(state.holds_data_frame(1));
    assert!(state.holds_data_frame(2));

    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 2);
    assert!(state.computation(1).unwrap().tasks.system_columns.is_some());
    release_all(state);
}

#[test]
fn system_columns_replace_the_table_and_the_data_frame() {
    let mut state = state_with_table(1);
    let before = version(&state);
    let numbered = arrow_table(110, 4);
    let mut columns = input_columns();
    columns.push(ColumnGroup::RowNumber(RowNumberColumnGroup { row_number_field_name: "_rownum".into() }));
    let outcome = apply(
        &mut state,
        ComputationAction::SystemColumnsSucceeded {
            table_id: 1,
            data_table: numbered.clone(),
            data_frame: 2,
            column_groups: columns.clone(),
            now: NOW,
        },
    );
    // The table that the system columns replace goes back to the host
    assert_eq!(
        outcome.effects,
        vec![
            ComputationEffect::ReleaseDataFrame { data_frame: 1 },
            ComputationEffect::Release { handle: input_table().id }
        ]
    );
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, before.with_data_increment());
    assert_eq!(computation.data_table, numbered);
    assert_eq!(computation.data_frame, Some(2));
    assert_eq!(computation.column_groups, columns);
    // The last row number column counts
    assert_eq!(computation.row_number_column_group, Some(2));
    assert_eq!(computation.row_number_column_name.as_deref(), Some("_rownum"));
}

/// The aggregation task of the score column
fn score_aggregation(input_data_frame: DataFrameId, aggregate_data_frame: DataFrameId) -> ColumnAggregationTask {
    ColumnAggregationTask {
        table_id: 1,
        table_version: ComputationVersion::new(0, 20),
        column_id: 1,
        column_entry: ColumnGroup::Ordinal(score()),
        input_data_frame,
        table_aggregate: table_aggregation(aggregate_data_frame),
    }
}

#[test]
fn column_aggregation_task() {
    let mut state = state_with_table(1);
    let task_id = schedule(&mut state, ComputationTask::ColumnAggregation(score_aggregation(1, 2)));
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::ColumnAggregation(_))));
    let tracked = state.computation(1).unwrap().tasks.column_aggregation[1].clone().unwrap();
    assert_eq!(tracked.progress.status, TaskStatus::Running);
    assert_eq!(state.data_frames().len(), 2);
    assert!(state.holds_data_frame(1));
    assert!(state.holds_data_frame(2));

    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 2);
    assert!(state.computation(1).unwrap().tasks.column_aggregation[1].is_some());
    release_all(state);
}

#[test]
fn a_task_of_an_unknown_column_fails() {
    let mut state = state_with_table(1);
    let revision = state.revision();
    let next_task_id = state.next_task_id();
    let mut task = score_aggregation(1, 2);
    task.column_id = 2;
    assert!(state
        .apply(ComputationAction::ScheduleTask { task: ComputationTask::ColumnAggregation(task), now: NOW })
        .is_err());
    assert_eq!(state.revision(), revision);
    assert_eq!(state.next_task_id(), next_task_id);
    assert_eq!(state.scheduler_tasks().count(), 0);
}

#[test]
fn a_task_of_an_unknown_computation_is_dropped() {
    let mut state = state_with_table(1);
    let mut task = score_aggregation(1, 2);
    task.table_id = 7;
    let outcome =
        apply(&mut state, ComputationAction::ScheduleTask { task: ComputationTask::ColumnAggregation(task), now: NOW });
    // The table of the task goes back to the host
    let released = ComputationOutcome {
        effects: vec![ComputationEffect::Release { handle: AGGREGATE_TABLE }],
        ..Default::default()
    };
    assert_eq!(outcome, released);
    assert_eq!(state.scheduler_tasks().count(), 0);
}

#[test]
fn stores_succeeded_column_aggregates_and_releases_the_previous_one() {
    let succeeded = |table_id: TableId, column_id: u32, aggregate: ColumnAggregate| {
        ComputationAction::ColumnAggregationSucceeded { table_id, column_id, aggregate, now: NOW }
    };
    let mut state = state_with_table(1);
    schedule(&mut state, ComputationTask::ColumnAggregation(score_aggregation(1, 2)));

    apply(&mut state, succeeded(1, 1, score_summary(10)));
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.column_aggregate(1), Some(&score_summary(10)));
    assert_eq!(computation.tasks.column_aggregation[1].as_ref().unwrap().progress.status, TaskStatus::Succeeded);
    assert!(state.holds_data_frame(10));

    let outcome = apply(&mut state, succeeded(1, 1, score_summary(11)));
    assert_eq!(state.computation(1).unwrap().column_aggregate(1), Some(&score_summary(11)));
    assert_eq!(released(&outcome), vec![10]);

    // Aggregates of unknown tables and of columns without a task are released right away
    let revision = state.revision();
    let outcome = apply(&mut state, succeeded(7, 1, score_summary(12)));
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![12]);
    let outcome = apply(&mut state, succeeded(1, 0, score_summary(12)));
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![12]);
    let outcome = apply(&mut state, succeeded(1, 9, score_summary(12)));
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![12]);
    assert_eq!(state.revision(), revision);
    release_all(state);
}

/// The filtered aggregation task of the score column for a version
fn filtered_score_aggregation(version: ComputationVersion, filter_frame: DataFrameId) -> ComputationTask {
    let mut column = score_aggregation(1, 2);
    column.table_version = version;
    ComputationTask::FilteredColumnAggregation(FilteredColumnAggregationTask {
        column,
        filter_table: Some(filter_table(filter_frame, version)),
        data_search_table: None,
        selection_row_count: row_table().rows(),
        unfiltered_aggregate: score_summary(3),
    })
}

#[test]
fn filtered_column_aggregation_task() {
    let mut state = state_with_table(1);
    let task_id = schedule(&mut state, filtered_score_aggregation(ComputationVersion::new(0, 10), 4));
    assert!(matches!(state.scheduler_task(task_id), Some(ComputationTask::FilteredColumnAggregation(_))));
    let tracked = state.computation(1).unwrap().tasks.filtered_column_aggregation[1].clone().unwrap();
    assert_eq!(tracked.progress.status, TaskStatus::Running);
    assert_eq!(state.data_frames().len(), 4);
    assert!(state.holds_data_frame(1));
    assert!(state.holds_data_frame(2));
    assert!(state.holds_data_frame(3));
    assert!(state.holds_data_frame(4));

    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert_eq!(state.scheduler_tasks().count(), 0);
    assert_eq!(state.data_frames().len(), 4);
    assert!(state.computation(1).unwrap().tasks.filtered_column_aggregation[1].is_some());

    // A new task of the column replaces the earlier one and releases what only that one held
    let outcome = apply(
        &mut state,
        ComputationAction::ScheduleTask {
            task: filtered_score_aggregation(ComputationVersion::new(0, 11), 5),
            now: NOW,
        },
    );
    assert_eq!(released(&outcome), vec![4]);
    release_all(state);
}

/// Table 1 with the summary of the score column and the next filtering scheduled. Returns the filter version.
fn state_with_score_summary(summary_frame: DataFrameId) -> (ComputationState, ComputationVersion) {
    let mut state = state_with_table(1);
    let aggregation = schedule(&mut state, ComputationTask::ColumnAggregation(score_aggregation(1, 2)));
    apply(
        &mut state,
        ComputationAction::ColumnAggregationSucceeded {
            table_id: 1,
            column_id: 1,
            aggregate: score_summary(summary_frame),
            now: NOW,
        },
    );
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: aggregation });
    let filtering = schedule(
        &mut state,
        ComputationTask::TableFiltering(TableFilteringTask {
            table_id: 1,
            table_version: ComputationVersion::default(),
            input_data_table: input_table(),
            input_data_frame: 1,
            row_number_column_name: "rowNumber".into(),
            filters: Vec::new(),
        }),
    );
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: filtering });
    let version = version(&state);
    (state, version)
}

#[test]
fn marks_filtered_column_summaries_outdated_without_scheduling_all_columns_on_filter_success() {
    let (mut state, filter_version) = state_with_score_summary(3);
    let outcome = apply(
        &mut state,
        ComputationAction::TableFilteringSucceeded {
            table_id: 1,
            version: filter_version,
            filter: Some(filter_table(4, filter_version)),
            now: NOW,
        },
    );
    assert!(outcome.changed);
    assert_eq!(state.scheduler_tasks().count(), 0);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.filter_table.as_ref().map(|filter| filter.version), Some(filter_version));
    // The version moved when the filtering was scheduled
    assert_eq!(computation.version, filter_version);
    assert!(!computation.filtered_column_aggregate_outdated(0));
    assert!(computation.filtered_column_aggregate_outdated(1));
    assert!(computation.tasks.filtered_column_aggregation[1].is_none());
    assert_eq!(computation.tasks.filtering.as_ref().unwrap().progress.status, TaskStatus::Succeeded);

    // Clearing the filter drops the outdated marks
    let outcome = apply(
        &mut state,
        ComputationAction::TableFilteringSucceeded { table_id: 1, version: filter_version, filter: None, now: NOW },
    );
    assert_eq!(released(&outcome), vec![4]);
    assert!(!state.computation(1).unwrap().filtered_column_aggregate_outdated(1));
}

#[test]
fn ignores_stale_filter_table_success_for_an_older_table_epoch() {
    let (mut state, filter_version) = state_with_score_summary(3);
    let stale = ComputationVersion::new(filter_version.data, filter_version.filter - 1);
    let outcome = apply(
        &mut state,
        ComputationAction::TableFilteringSucceeded {
            table_id: 1,
            version: stale,
            filter: Some(filter_table(4, stale)),
            now: NOW,
        },
    );
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![4]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, filter_version);
    assert_eq!(computation.filter_table, None);
    assert!(!state.data_frames().contains(&4));
}

#[test]
fn accepts_filter_table_success_for_the_current_table_epoch() {
    let mut state = state_with_table(1);
    let ordering = schedule(&mut state, ordering_task(score_descending()));
    let current = version(&state);
    apply(
        &mut state,
        ComputationAction::TableOrderingSucceeded {
            table_id: 1,
            ordering: ordering_table(5, score_descending(), current),
            now: NOW,
        },
    );
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: ordering });
    assert!(state.computation(1).unwrap().ordering_table.is_some());

    let filtering = schedule(
        &mut state,
        ComputationTask::TableFiltering(TableFilteringTask {
            table_id: 1,
            table_version: ComputationVersion::default(),
            input_data_table: input_table(),
            input_data_frame: 1,
            row_number_column_name: "rowNumber".into(),
            filters: Vec::new(),
        }),
    );
    let filter_version = version(&state);
    let outcome = apply(
        &mut state,
        ComputationAction::TableFilteringSucceeded {
            table_id: 1,
            version: filter_version,
            filter: Some(filter_table(4, filter_version)),
            now: NOW,
        },
    );
    // The ordering goes because the filter changed
    assert_eq!(released(&outcome), vec![5]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, filter_version);
    assert_eq!(computation.filter_table.as_ref().map(|filter| filter.version), Some(filter_version));
    assert_eq!(computation.ordering_table, None);
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: filtering });
    release_all(state);
}

#[test]
fn stores_the_ordering_table_without_replacing_the_immutable_base_table() {
    let mut state = state_with_table(1);
    schedule(&mut state, ordering_task(score_descending()));
    let current = version(&state);
    let outcome = apply(
        &mut state,
        ComputationAction::TableOrderingSucceeded {
            table_id: 1,
            ordering: ordering_table(5, score_descending(), current),
            now: NOW,
        },
    );
    assert!(outcome.changed);
    assert!(outcome.effects.is_empty());
    let computation = state.computation(1).unwrap();
    // An ordering doesn't change the version
    assert_eq!(computation.version, current);
    assert_eq!(computation.data_frame, Some(1));
    assert_eq!(computation.data_table, input_table());
    assert_eq!(computation.ordering_table.as_ref().map(|ordering| ordering.data_frame), Some(5));
    assert_eq!(computation.data_table_ordering, score_descending());
    assert_eq!(computation.tasks.ordering.as_ref().unwrap().progress.status, TaskStatus::Succeeded);
    release_all(state);
}

#[test]
fn clears_the_active_table_ordering() {
    let mut state = state_with_table(1);
    let ordering = schedule(&mut state, ordering_task(score_descending()));
    let current = version(&state);
    apply(
        &mut state,
        ComputationAction::TableOrderingSucceeded {
            table_id: 1,
            ordering: ordering_table(5, score_descending(), current),
            now: NOW,
        },
    );

    let outcome = apply(&mut state, ComputationAction::ClearTableOrdering { table_id: 1 });
    assert_eq!(released(&outcome), vec![5]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.data_table_ordering, Vec::new());
    assert_eq!(computation.ordering_table, None);
    assert_eq!(computation.tasks.ordering.as_ref().unwrap().task.ordering_constraints, Vec::new());
    assert!(!state.data_frames().contains(&5));
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: ordering });
    release_all(state);
}

#[test]
fn ignores_an_ordering_result_after_ordering_is_cleared() {
    let mut state = state_with_table(1);
    schedule(&mut state, ordering_task(score_descending()));
    apply(&mut state, ComputationAction::ClearTableOrdering { table_id: 1 });

    let current = version(&state);
    let outcome = apply(
        &mut state,
        ComputationAction::TableOrderingSucceeded {
            table_id: 1,
            ordering: ordering_table(5, score_descending(), current),
            now: NOW,
        },
    );
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![5]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.data_table_ordering, Vec::new());
    assert_eq!(computation.ordering_table, None);
    assert!(!state.data_frames().contains(&5));
    release_all(state);
}

#[test]
fn ignores_stale_ordering_table_success_for_an_older_table_epoch() {
    let mut state = state_with_table(1);
    schedule(&mut state, ordering_task(score_descending()));
    let current = version(&state);
    let stale = ComputationVersion::new(current.data, current.filter + 1);
    let outcome = apply(
        &mut state,
        ComputationAction::TableOrderingSucceeded {
            table_id: 1,
            ordering: ordering_table(5, score_descending(), stale),
            now: NOW,
        },
    );
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![5]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.version, current);
    assert_eq!(computation.ordering_table, None);
    assert_eq!(computation.data_frame, Some(1));
    release_all(state);
}

#[test]
fn discards_stale_filtered_aggregation_results_without_replacing_the_active_task() {
    let (mut state, filter_version) = state_with_score_summary(3);
    apply(
        &mut state,
        ComputationAction::TableFilteringSucceeded {
            table_id: 1,
            version: filter_version,
            filter: Some(filter_table(4, filter_version)),
            now: NOW,
        },
    );
    assert!(state.computation(1).unwrap().filtered_column_aggregate_outdated(1));
    schedule(&mut state, filtered_score_aggregation(filter_version, 4));

    let stale = ComputationVersion::new(filter_version.data, filter_version.filter - 1);
    let outcome = apply(
        &mut state,
        ComputationAction::FilteredColumnAggregationSucceeded {
            table_id: 1,
            column_id: 1,
            version: stale,
            aggregate: Some(filtered_score_summary(6, stale)),
            now: NOW,
        },
    );
    assert!(!outcome.changed);
    assert_eq!(released(&outcome), vec![6]);
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.filtered_column_aggregate(1), None);
    assert!(computation.filtered_column_aggregate_outdated(1));
    assert_eq!(computation.tasks.filtered_column_aggregation[1].as_ref().unwrap().progress.status, TaskStatus::Running);

    let outcome = apply(
        &mut state,
        ComputationAction::FilteredColumnAggregationSucceeded {
            table_id: 1,
            column_id: 1,
            version: filter_version,
            aggregate: Some(filtered_score_summary(6, filter_version)),
            now: NOW,
        },
    );
    assert!(outcome.changed);
    let computation = state.computation(1).unwrap();
    assert_eq!(
        computation.filtered_column_aggregate(1).map(|aggregate| aggregate.filter_version),
        Some(filter_version)
    );
    assert!(!computation.filtered_column_aggregate_outdated(1));
    assert_eq!(
        computation.tasks.filtered_column_aggregation[1].as_ref().unwrap().progress.status,
        TaskStatus::Succeeded
    );
    assert!(state.holds_data_frame(6));
    release_all(state);
}

#[test]
fn ending_the_data_search_drops_its_rows_and_aborts_it() {
    let mut state = state_with_table(1);
    let set = |pattern: &str| ComputationAction::SetResultSearchPattern {
        table_id: 1,
        kind: SearchKind::Data,
        pattern: pattern.into(),
    };
    apply(&mut state, set("10"));
    let current = version(&state);
    let task = schedule(
        &mut state,
        ComputationTask::DataSearch(DataSearchTask {
            table_id: 1,
            table_version: current,
            input_data_frame: 1,
            row_number_column_name: "rowNumber".into(),
            columns: Vec::new(),
            pattern: "10".into(),
            request_id: 1,
        }),
    );
    apply(
        &mut state,
        ComputationAction::DataSearchSucceeded {
            table_id: 1,
            data_frame: 1,
            request_id: 1,
            search: search_table(2, current, 1),
            matching_rows: 1,
            now: NOW,
        },
    );
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id: task });

    let outcome = apply(&mut state, set(""));
    assert_eq!(
        outcome.effects,
        vec![
            ComputationEffect::AbortDataSearch { table_id: 1, request_id: 1 },
            ComputationEffect::ReleaseDataFrame { data_frame: 2 },
            ComputationEffect::Release { handle: search_table(2, current, 1).table.id },
        ]
    );
    let computation = state.computation(1).unwrap();
    assert_eq!(computation.data_search_table, None);
    assert_eq!(computation.tasks.data_search, None);
    // The cleared pattern is applied right away
    assert_eq!(computation.data_search.applied_request_id, computation.data_search.request_id);
    assert!(!computation.data_search.pending);
    assert_eq!(computation.data_search.requested_pattern, "");
    release_all(state);
}

#[test]
fn revisions_change_with_every_change() {
    let mut state = state_with_table(1);
    let state_revision = state.revision();
    let revision = state.computation(1).unwrap().revision();
    apply(
        &mut state,
        ComputationAction::SetResultSearchPattern { table_id: 1, kind: SearchKind::Columns, pattern: "a".into() },
    );
    assert!(state.revision() > state_revision);
    assert!(state.computation(1).unwrap().revision() > revision);

    // Unregistering a task changes the state, not the computation
    let task_id = schedule(&mut state, ordering_task(Vec::new()));
    let revision = state.computation(1).unwrap().revision();
    let state_revision = state.revision();
    apply(&mut state, ComputationAction::UnregisterSchedulerTask { task_id });
    assert!(state.revision() > state_revision);
    assert_eq!(state.computation(1).unwrap().revision(), revision);
}

// ------------------------------------------------------------
// Cross filters

#[test]
fn cross_filters_equal() {
    let ordinal = binned("x", Some("_bin"));
    assert!(CrossFilters::new().selects_same(&CrossFilters::new()));

    // Key counts differ
    let mut a = CrossFilters::new();
    let b = CrossFilters::new();
    a.add_histogram_filter(1, &ordinal, Some((0.0, 1.0)));
    assert!(!a.selects_same(&b));
    assert!(!b.selects_same(&a));

    // Filter types differ for the same column
    let mut b = CrossFilters::new();
    b.column_filters.insert(1, CrossFilterPredicate::MostFrequent { value_ids: vec![1], filters: Vec::new() });
    assert!(!a.selects_same(&b));

    // Histogram selections
    let mut a = CrossFilters::new();
    let mut b = CrossFilters::new();
    a.add_histogram_filter(1, &ordinal, Some((0.0, 5.0)));
    b.add_histogram_filter(1, &ordinal, Some((2.0, 5.0)));
    assert!(!a.selects_same(&b));
    a.add_histogram_filter(1, &ordinal, Some((2.0, 5.0)));
    assert!(a.selects_same(&b));

    // Most frequent values compare by their value ids, not by the order of the selection
    let mut a = CrossFilters::new();
    let mut b = CrossFilters::new();
    a.set_most_frequent_values(1, &category(), &[2]);
    b.set_most_frequent_values(1, &category(), &[2]);
    assert!(a.selects_same(&b));
    b.set_most_frequent_values(1, &category(), &[3]);
    assert!(!a.selects_same(&b));
    a.set_most_frequent_values(1, &category(), &[5, 2]);
    b.set_most_frequent_values(1, &category(), &[2, 5, 2]);
    assert!(a.selects_same(&b));
    b.set_most_frequent_values(1, &category(), &[2]);
    assert!(!a.selects_same(&b));
}

#[test]
fn cross_filter_transforms() {
    assert_eq!(CrossFilters::new().filter_transforms(), Vec::new());

    // A histogram without bins filters nothing
    let mut filters = CrossFilters::new();
    filters.add_histogram_filter(1, &binned("score", None), Some((1.0, 3.0)));
    assert_eq!(filters.filter_transforms(), Vec::new());

    // A histogram with bins filters the range of bins, most frequent values their ids, in the order of the columns
    let mut filters = CrossFilters::new();
    filters.set_most_frequent_values(2, &category(), &[7, 3]);
    filters.add_histogram_filter(1, &binned("score", Some("_score_bin")), Some((2.0, 7.0)));
    let filter = |field_name: &str, op: FilterOp, value: f64| {
        RowFilter::Scalar(ScalarFilter { field_name: field_name.into(), op, value })
    };
    assert_eq!(
        filters.filter_transforms(),
        vec![
            filter("_score_bin", FilterOp::GreaterEqual, 2.0),
            filter("_score_bin", FilterOp::LessEqual, 7.0),
            RowFilter::In { field_name: "_category_id".into(), values: vec![3, 7] },
        ]
    );

    let mut filters = CrossFilters::new();
    filters.add_histogram_filter(1, &binned("a", Some("_a_bin")), Some((0.0, 4.0)));
    filters.add_histogram_filter(2, &binned("b", Some("_b_bin")), Some((1.0, 9.0)));
    assert_eq!(filters.filter_transforms().len(), 4);
}

#[test]
fn cross_filters_contain_histogram_filters() {
    let ordinal = binned("x", Some("_bin"));
    let mut filters = CrossFilters::new();
    assert!(filters.contains_histogram_filter(1, None));
    assert!(!filters.contains_histogram_filter(1, Some((0.0, 5.0))));
    filters.add_histogram_filter(1, &ordinal, Some((2.0, 8.0)));
    assert!(!filters.contains_histogram_filter(1, None));
    assert!(filters.contains_histogram_filter(1, Some((2.0, 8.0))));
    assert!(!filters.contains_histogram_filter(1, Some((3.0, 8.0))));
    assert!(!filters.contains_histogram_filter(1, Some((2.0, 9.0))));

    let mut filters = CrossFilters::new();
    filters.column_filters.insert(1, CrossFilterPredicate::MostFrequent { value_ids: vec![1], filters: Vec::new() });
    assert!(!filters.contains_histogram_filter(1, Some((0.0, 5.0))));
}

#[test]
fn cross_filters_add_histogram_filters() {
    let mut filters = CrossFilters::new();
    filters.add_histogram_filter(1, &binned("x", None), None);
    assert!(filters.column_filters.is_empty());

    // Without bins the selection has no filters
    filters.add_histogram_filter(1, &binned("score", None), Some((1.0, 4.0)));
    assert_eq!(
        filters.column_filters.get(&1),
        Some(&CrossFilterPredicate::Histogram { selection: (1.0, 4.0), filters: Vec::new() })
    );

    // A selection overwrites the one of the column, none removes it
    let ordinal = binned("score", Some("_score_bin"));
    filters.add_histogram_filter(1, &ordinal, Some((3.0, 9.0)));
    let Some(CrossFilterPredicate::Histogram { selection, filters: scalar_filters }) = filters.column_filters.get(&1)
    else {
        panic!("expected a histogram filter");
    };
    assert_eq!(*selection, (3.0, 9.0));
    assert_eq!(scalar_filters.len(), 2);
    let scalar = |filter: &RowFilter| match filter {
        RowFilter::Scalar(filter) => (filter.op, filter.value),
        RowFilter::In { .. } => panic!("expected a comparison"),
    };
    assert_eq!(scalar(&scalar_filters[0]), (FilterOp::GreaterEqual, 3.0));
    assert_eq!(scalar(&scalar_filters[1]), (FilterOp::LessEqual, 9.0));
    filters.add_histogram_filter(1, &ordinal, None);
    assert!(filters.column_filters.is_empty());
}

#[test]
fn cross_filters_most_frequent_values() {
    let mut filters = CrossFilters::new();
    assert_eq!(filters.most_frequent_values(1), &[] as &[i64]);
    let select = |filters: &mut CrossFilters, value_id: Option<i64>| {
        filters.select_most_frequent_value(1, &category(), value_id);
        filters.most_frequent_values(1).to_vec()
    };

    // A click selects a value, one value filters with =
    assert_eq!(select(&mut filters, Some(3)), vec![3]);
    assert_eq!(
        filters.column_filters.get(&1),
        Some(&CrossFilterPredicate::MostFrequent {
            value_ids: vec![3],
            filters: vec![RowFilter::In { field_name: "_category_id".into(), values: vec![3] }],
        })
    );
    // A click on the value selected alone clears the selection
    assert_eq!(select(&mut filters, Some(3)), Vec::<i64>::new());
    assert!(filters.column_filters.is_empty());

    // Clicks add values and keep them ascending, several values filter with IN
    assert_eq!(select(&mut filters, Some(5)), vec![5]);
    assert_eq!(select(&mut filters, Some(1)), vec![1, 5]);
    assert_eq!(select(&mut filters, Some(3)), vec![1, 3, 5]);
    assert_eq!(
        filters.filter_transforms(),
        vec![RowFilter::In { field_name: "_category_id".into(), values: vec![1, 3, 5] }]
    );
    // A click on a selected value removes it, on the last one clears the selection
    assert_eq!(select(&mut filters, Some(3)), vec![1, 5]);
    assert_eq!(select(&mut filters, Some(1)), vec![5]);
    assert_eq!(select(&mut filters, Some(5)), Vec::<i64>::new());
    assert!(filters.column_filters.is_empty());

    // None clears the selection
    assert_eq!(select(&mut filters, Some(4)), vec![4]);
    assert_eq!(select(&mut filters, Some(6)), vec![4, 6]);
    assert_eq!(select(&mut filters, None), Vec::<i64>::new());
    assert!(filters.column_filters.is_empty());

    // The selection of a column leaves the other columns
    filters.set_most_frequent_values(2, &category(), &[9]);
    assert_eq!(select(&mut filters, Some(1)), vec![1]);
    assert_eq!(filters.most_frequent_values(2), &[9]);

    // A column without value ids can't select a value
    let mut filters = CrossFilters::new();
    let without_ids = StringColumnGroup { value_id_field_name: None, ..category() };
    filters.select_most_frequent_value(1, &without_ids, Some(2));
    filters.set_most_frequent_values(1, &without_ids, &[2, 3]);
    assert!(filters.column_filters.is_empty());
}
