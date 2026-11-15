//! The wasm-bindgen API of the computations of result tables (`dashql_runtime::compute`).
//!
//! An action is a method call. Ids, versions and names are typed arguments, the nested values of a task or a result
//! (column groups, filter tables, summaries, cross filters) come as JSON. An action returns a `ComputationOutcome` with
//! the effects for the host as JSON. The state is read per computation: a computation changes its revision with every
//! change, the host reads only the computations whose revision moved, a snapshot of their fields as JSON.
//!
//! The Arrow tables, the summaries, the data frames and the lifetimes stay with the host, the state knows them by
//! their ids. The JSON readers take what they find and use defaults for missing fields: a value of the host that
//! lacks a part still schedules, its result is dropped like any stale one.

use std::collections::BTreeMap;

use dashql_core::error::Error;
use dashql_runtime::compute::cross_filters::{CrossFilterPredicate, CrossFilters};
use dashql_runtime::compute::types::{
    ArrowTable, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ColumnStatsFields, ColumnSummary, ComputationTask,
    ComputationVersion, DataSearchColumn, DataSearchTable, DataSearchTask, FilterOp, FilterTable, FilteredColumnAggregate,
    FilteredColumnAggregationTask, ListColumnGroup, OrderByConstraint, OrderingTable, OrdinalColumnGroup,
    ResultSearchState, RowNumberColumnGroup, ScalarFilter, SkippedColumnGroup, StringColumnGroup, SystemColumnsTask,
    TableAggregation, TableAggregationTask, TableFilteringTask, TableOrderingTask, TaskProgress, TaskProgressUpdate,
    TaskStatus, TrackedTask,
};
use dashql_runtime::compute::{
    ComputationAction, ComputationEffect, ComputationOutcome as RuntimeOutcome, ComputationState, SearchKind,
    TableComputation,
};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use super::js_error;

// Reading the JSON of the host

fn parse(json: &str, what: &str) -> Result<Value, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("invalid {what}: {e}")))
}

fn invalid(message: String) -> JsError {
    js_error(Error::invalid_argument(message))
}

/// A number of the host, ids and counts are integers in JS numbers
fn u64_of(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_f64().filter(|v| v.is_finite() && *v >= 0.0).map(|v| v as u64))
}

fn u64_at(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(u64_of).unwrap_or(0)
}

fn opt_u64_at(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(u64_of)
}

fn u32_at(value: &Value, key: &str) -> u32 {
    u32::try_from(u64_at(value, key)).unwrap_or(u32::MAX)
}

fn i64_at(value: &Value, key: &str) -> Option<i64> {
    let v = value.get(key)?;
    v.as_i64().or_else(|| v.as_f64().filter(|v| v.is_finite()).map(|v| v as i64))
}

fn f64_at(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn bool_at(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn opt_bool_at(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn str_at(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn opt_str_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The values of an array, none for anything else
fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

/// A value that is neither absent nor null
fn present<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|v| !v.is_null())
}

fn version_of(value: Option<&Value>) -> ComputationVersion {
    value.map_or_else(ComputationVersion::default, |v| ComputationVersion::new(u64_at(v, "data"), u64_at(v, "filter")))
}

fn version_at(value: &Value, key: &str) -> ComputationVersion {
    version_of(present(value, key))
}

fn arrow_table_of(value: Option<&Value>) -> ArrowTable {
    value.map_or(ArrowTable { id: 0, rows: 0 }, |v| ArrowTable { id: u64_at(v, "id"), rows: u64_at(v, "rows") })
}

fn stats_fields_of(value: Option<&Value>) -> Option<ColumnStatsFields> {
    value.map(|v| ColumnStatsFields {
        count_field_name: str_at(v, "countFieldName"),
        distinct_count_field_name: opt_str_at(v, "distinctCountFieldName"),
        min_aggregate_field_name: opt_str_at(v, "minAggregateFieldName"),
        max_aggregate_field_name: opt_str_at(v, "maxAggregateFieldName"),
    })
}

fn column_group_of(value: &Value) -> Result<ColumnGroup, JsError> {
    let field_name = str_at(value, "inputFieldName");
    let field_type = str_at(value, "inputFieldType");
    let nullable = bool_at(value, "inputFieldNullable");
    let stats_fields = stats_fields_of(present(value, "statsFields"));
    Ok(match value.get("type").and_then(Value::as_str).unwrap_or_default() {
        "ROWNUMBER" => ColumnGroup::RowNumber(RowNumberColumnGroup { row_number_field_name: str_at(value, "rowNumberFieldName") }),
        "SKIPPED" => ColumnGroup::Skipped(SkippedColumnGroup {
            input_field_name: field_name,
            input_field_type: field_type,
            input_field_nullable: nullable,
        }),
        "ORDINAL" => ColumnGroup::Ordinal(OrdinalColumnGroup {
            input_field_name: field_name,
            input_field_type: field_type,
            input_field_nullable: nullable,
            stats_fields,
            bin_field_name: opt_str_at(value, "binFieldName"),
            bin_count: u32_at(value, "binCount"),
        }),
        "STRING" => ColumnGroup::String(StringColumnGroup {
            input_field_name: field_name,
            input_field_type: field_type,
            input_field_nullable: nullable,
            stats_fields,
            value_id_field_name: opt_str_at(value, "valueIdFieldName"),
        }),
        "LIST" => ColumnGroup::List(ListColumnGroup {
            input_field_name: field_name,
            input_field_type: field_type,
            input_field_nullable: nullable,
            stats_fields,
            value_id_field_name: opt_str_at(value, "valueIdFieldName"),
        }),
        other => return Err(invalid(format!("unknown column group: {other}"))),
    })
}

fn column_groups_of(values: &[Value]) -> Result<Vec<ColumnGroup>, JsError> {
    values.iter().map(column_group_of).collect()
}

fn filter_op_of(op: &str) -> Result<FilterOp, JsError> {
    Ok(match op {
        "=" => FilterOp::Equal,
        "<" => FilterOp::Less,
        "<=" => FilterOp::LessEqual,
        ">" => FilterOp::Greater,
        ">=" => FilterOp::GreaterEqual,
        other => return Err(invalid(format!("unknown filter operator: {other}"))),
    })
}

fn scalar_filters_of(values: &[Value]) -> Result<Vec<ScalarFilter>, JsError> {
    values
        .iter()
        .map(|v| {
            Ok(ScalarFilter {
                field_name: str_at(v, "fieldName"),
                op: filter_op_of(v.get("op").and_then(Value::as_str).unwrap_or("="))?,
                value: f64_at(v, "value"),
            })
        })
        .collect()
}

fn order_by_of(values: &[Value]) -> Vec<OrderByConstraint> {
    values
        .iter()
        .map(|v| OrderByConstraint {
            field: str_at(v, "field"),
            ascending: opt_bool_at(v, "ascending"),
            nulls_first: opt_bool_at(v, "nullsFirst"),
        })
        .collect()
}

fn filter_table_of(value: Option<&Value>) -> Option<FilterTable> {
    value.map(|v| FilterTable {
        input_row_number_column_name: str_at(v, "inputRowNumberColumnName"),
        table: arrow_table_of(present(v, "table")),
        data_frame: u64_at(v, "dataFrame"),
        version: version_at(v, "version"),
    })
}

fn ordering_table_of(value: &Value) -> OrderingTable {
    OrderingTable {
        input_row_number_column_name: str_at(value, "inputRowNumberColumnName"),
        ordering_constraints: order_by_of(items(value, "orderingConstraints")),
        table: arrow_table_of(present(value, "table")),
        data_frame: u64_at(value, "dataFrame"),
        version: version_at(value, "version"),
        data_search_request_id: opt_u64_at(value, "dataSearchRequestId"),
    }
}

fn data_search_table_of(value: Option<&Value>) -> Option<DataSearchTable> {
    value.map(|v| DataSearchTable {
        input_row_number_column_name: str_at(v, "inputRowNumberColumnName"),
        table: arrow_table_of(present(v, "table")),
        data_frame: u64_at(v, "dataFrame"),
        version: version_at(v, "version"),
        request_id: u64_at(v, "requestId"),
    })
}

fn table_aggregation_of(value: Option<&Value>) -> TableAggregation {
    value.map_or(TableAggregation { table: 0, data_frame: 0, count_star_field_name: String::new() }, |v| TableAggregation {
        table: u64_at(v, "table"),
        data_frame: u64_at(v, "dataFrame"),
        count_star_field_name: str_at(v, "countStarFieldName"),
    })
}

fn column_aggregate_of(value: Option<&Value>) -> Result<ColumnAggregate, JsError> {
    let Some(value) = value else {
        return Ok(ColumnAggregate::Skipped);
    };
    let summary = ColumnSummary { id: u64_at(value, "id"), data_frame: u64_at(value, "dataFrame") };
    Ok(match value.get("kind").and_then(Value::as_str).unwrap_or("skipped") {
        "ordinal" => ColumnAggregate::Ordinal(summary),
        "string" => ColumnAggregate::String(summary),
        "list" => ColumnAggregate::List(summary),
        "skipped" => ColumnAggregate::Skipped,
        other => return Err(invalid(format!("unknown column aggregate: {other}"))),
    })
}

fn filtered_aggregate_of(value: &Value) -> Result<FilteredColumnAggregate, JsError> {
    Ok(FilteredColumnAggregate {
        aggregate: column_aggregate_of(present(value, "aggregate"))?,
        filter_version: version_at(value, "filterVersion"),
        data_search_request_id: opt_u64_at(value, "dataSearchRequestId"),
    })
}

fn column_task_of(value: &Value) -> Result<ColumnAggregationTask, JsError> {
    Ok(ColumnAggregationTask {
        table_id: u64_at(value, "tableId"),
        table_version: version_at(value, "tableVersion"),
        column_id: u32_at(value, "columnId"),
        column_entry: match present(value, "columnEntry") {
            Some(entry) => column_group_of(entry)?,
            None => ColumnGroup::Skipped(SkippedColumnGroup {
                input_field_name: String::new(),
                input_field_type: String::new(),
                input_field_nullable: false,
            }),
        },
        input_data_frame: u64_at(value, "inputDataFrame"),
        table_aggregate: table_aggregation_of(present(value, "tableAggregate")),
    })
}

fn task_of(value: &Value) -> Result<ComputationTask, JsError> {
    let table_id = u64_at(value, "tableId");
    let table_version = version_at(value, "tableVersion");
    let input_data_frame = u64_at(value, "inputDataFrame");
    Ok(match value.get("kind").and_then(Value::as_str).unwrap_or_default() {
        "tableFiltering" => ComputationTask::TableFiltering(TableFilteringTask {
            table_id,
            table_version,
            input_data_table: arrow_table_of(present(value, "inputDataTable")),
            input_data_frame,
            row_number_column_name: str_at(value, "rowNumberColumnName"),
            filters: scalar_filters_of(items(value, "filters"))?,
        }),
        "tableOrdering" => ComputationTask::TableOrdering(TableOrderingTask {
            table_id,
            table_version,
            input_data_table: arrow_table_of(present(value, "inputDataTable")),
            input_data_frame,
            filter_table: filter_table_of(present(value, "filterTable")),
            data_search_table: data_search_table_of(present(value, "dataSearchTable")),
            row_number_column_name: str_at(value, "rowNumberColumnName"),
            ordering_constraints: order_by_of(items(value, "orderingConstraints")),
        }),
        "tableAggregation" => ComputationTask::TableAggregation(TableAggregationTask {
            table_id,
            table_version,
            column_entries: column_groups_of(items(value, "columnEntries"))?,
            input_data_frame,
        }),
        "systemColumns" => ComputationTask::SystemColumns(SystemColumnsTask {
            table_id,
            table_version,
            column_entries: column_groups_of(items(value, "columnEntries"))?,
            input_table: arrow_table_of(present(value, "inputTable")),
            input_data_frame,
            row_number_field_name: str_at(value, "rowNumberFieldName"),
            table_aggregate: table_aggregation_of(present(value, "tableAggregate")),
        }),
        "columnAggregation" => ComputationTask::ColumnAggregation(column_task_of(value)?),
        "filteredColumnAggregation" => ComputationTask::FilteredColumnAggregation(FilteredColumnAggregationTask {
            column: column_task_of(value)?,
            filter_table: filter_table_of(present(value, "filterTable")),
            data_search_table: data_search_table_of(present(value, "dataSearchTable")),
            selection_row_count: u64_at(value, "selectionRowCount"),
            unfiltered_aggregate: column_aggregate_of(present(value, "unfilteredAggregate"))?,
        }),
        "dataSearch" => ComputationTask::DataSearch(DataSearchTask {
            table_id,
            table_version,
            input_data_frame,
            row_number_column_name: str_at(value, "rowNumberColumnName"),
            columns: items(value, "columns")
                .iter()
                .map(|c| DataSearchColumn {
                    column_idx: u32_at(c, "columnIdx"),
                    column_group_idx: u32_at(c, "columnGroupIdx"),
                    field_name: str_at(c, "fieldName"),
                })
                .collect(),
            pattern: str_at(value, "pattern"),
            request_id: u64_at(value, "requestId"),
        }),
        other => return Err(invalid(format!("unknown computation task: {other}"))),
    })
}

fn task_status_of(status: u64) -> Option<TaskStatus> {
    match status {
        1 => Some(TaskStatus::Running),
        2 => Some(TaskStatus::Succeeded),
        3 => Some(TaskStatus::Failed),
        _ => None,
    }
}

fn progress_update_of(value: &Value) -> TaskProgressUpdate {
    TaskProgressUpdate {
        status: opt_u64_at(value, "status").and_then(task_status_of),
        started_at: i64_at(value, "startedAt"),
        completed_at: i64_at(value, "completedAt"),
        failed_at: i64_at(value, "failedAt"),
        failed_with_error: opt_str_at(value, "failedWithError"),
    }
}

fn cross_filters_of(value: &Value) -> Result<CrossFilters, JsError> {
    let mut filters = CrossFilters::new();
    for selection in items(value, "columnFilters") {
        let column = u32_at(selection, "column");
        let scalar_filters = scalar_filters_of(items(selection, "filters"))?;
        let predicate = match selection.get("kind").and_then(Value::as_str).unwrap_or_default() {
            "histogram" => {
                let range = items(selection, "selection");
                let bound = |i: usize| range.get(i).and_then(Value::as_f64).unwrap_or(0.0);
                CrossFilterPredicate::Histogram { selection: (bound(0), bound(1)), filters: scalar_filters }
            }
            "mostFrequent" => CrossFilterPredicate::MostFrequent {
                value_id: i64_at(selection, "valueId").unwrap_or(0),
                filters: scalar_filters,
            },
            other => return Err(invalid(format!("unknown cross filter: {other}"))),
        };
        filters.column_filters.insert(column, predicate);
    }
    Ok(filters)
}

// Writing the JSON of the host

fn version_json(version: ComputationVersion) -> Value {
    json!({ "data": version.data, "filter": version.filter })
}

fn effect_json(effect: &ComputationEffect) -> Value {
    match effect {
        ComputationEffect::AbortComputation { table_id, lifetime } => {
            json!({ "type": "abortComputation", "tableId": table_id, "lifetime": lifetime })
        }
        ComputationEffect::AbortDataSearch { table_id, request_id } => {
            json!({ "type": "abortDataSearch", "tableId": table_id, "requestId": request_id })
        }
        ComputationEffect::ReleaseDataFrame { data_frame } => json!({ "type": "releaseDataFrame", "dataFrame": data_frame }),
        ComputationEffect::ReleaseArrowTable { table } => json!({ "type": "releaseArrowTable", "table": table }),
    }
}

fn aggregate_json(aggregate: &ColumnAggregate) -> Value {
    let (kind, summary) = match aggregate {
        ColumnAggregate::Ordinal(summary) => ("ordinal", Some(summary)),
        ColumnAggregate::String(summary) => ("string", Some(summary)),
        ColumnAggregate::List(summary) => ("list", Some(summary)),
        ColumnAggregate::Skipped => ("skipped", None),
    };
    json!({
        "kind": kind,
        "id": summary.map(|s| s.id),
        "dataFrame": summary.map(|s| s.data_frame),
    })
}

fn progress_json(progress: &TaskProgress) -> Value {
    json!({
        "status": progress.status as u8,
        "startedAt": progress.started_at,
        "completedAt": progress.completed_at,
        "failedAt": progress.failed_at,
        "failedWithError": progress.failed_with_error,
    })
}

fn tracked_json<T>(tracked: Option<&TrackedTask<T>>, version: impl Fn(&T) -> ComputationVersion) -> Value {
    match tracked {
        Some(tracked) => json!({
            "taskId": tracked.task_id,
            "version": version_json(version(&tracked.task)),
            "progress": progress_json(&tracked.progress),
        }),
        None => Value::Null,
    }
}

fn search_json(search: &ResultSearchState) -> Value {
    json!({
        "requestedPattern": search.requested_pattern,
        "appliedPattern": search.applied_pattern,
        "requestId": search.request_id,
        "appliedRequestId": search.applied_request_id,
        "matchingColumnGroups": search.matching_column_groups,
        // The host keeps the matching rows that it handed over, they don't cross again
        "hasMatchingRows": search.matching_rows.is_some(),
        "pending": search.pending,
        "error": search.error,
    })
}

fn order_by_json(constraints: &[OrderByConstraint]) -> Value {
    Value::Array(
        constraints
            .iter()
            .map(|c| json!({ "field": c.field, "ascending": c.ascending, "nullsFirst": c.nulls_first }))
            .collect(),
    )
}

/// The fields of a computation that the host projects. The ids name the objects of the host: the Arrow table, the
/// data frame, the filter, ordering and search tables by the id of their table, the statistics and the summaries.
fn computation_json(computation: &TableComputation) -> Value {
    let tasks = &computation.tasks;
    let mut ordering = tracked_json(tasks.ordering.as_ref(), |task| task.table_version);
    if let (Some(tracked), Value::Object(fields)) = (&tasks.ordering, &mut ordering) {
        fields.insert("orderingConstraints".into(), order_by_json(&tracked.task.ordering_constraints));
    }
    json!({
        "tableId": computation.table_id,
        "connectionId": computation.connection_id,
        "lifetime": computation.lifetime,
        "revision": computation.revision(),
        "version": version_json(computation.version),
        "dataTable": { "id": computation.data_table.id, "rows": computation.data_table.rows },
        "dataFrame": computation.data_frame,
        "dataTableOrdering": order_by_json(&computation.data_table_ordering),
        "filterTable": computation.filter_table.as_ref().map(|t| t.table.id),
        "orderingTable": computation.ordering_table.as_ref().map(|t| t.table.id),
        "dataSearchTable": computation.data_search_table.as_ref().map(|t| t.table.id),
        "columnSearch": search_json(&computation.column_search),
        "dataSearch": search_json(&computation.data_search),
        "rowNumberColumnGroup": computation.row_number_column_group,
        "rowNumberColumnName": computation.row_number_column_name,
        "tableAggregation": computation.table_aggregation.as_ref().map(|t| t.table),
        "columnAggregates": computation.column_aggregates.iter().map(|a| a.as_ref().map(aggregate_json)).collect::<Vec<_>>(),
        "filteredColumnAggregates": computation.filtered_column_aggregates.iter().map(|a| a.as_ref().map(|a| json!({
            "aggregate": aggregate_json(&a.aggregate),
            "filterVersion": version_json(a.filter_version),
            "dataSearchRequestId": a.data_search_request_id,
        }))).collect::<Vec<_>>(),
        "filteredColumnAggregatesOutdated": computation.filtered_column_aggregates_outdated,
        "tasks": {
            "tableAggregation": tracked_json(tasks.table_aggregation.as_ref(), |task| task.table_version),
            "systemColumns": tracked_json(tasks.system_columns.as_ref(), |task| task.table_version),
            "filtering": tracked_json(tasks.filtering.as_ref(), |task| task.table_version),
            "ordering": ordering,
            "dataSearch": tracked_json(tasks.data_search.as_ref(), |task| task.table_version),
            "columnAggregation": tasks.column_aggregation.iter()
                .map(|tracked| tracked_json(tracked.as_ref(), |task| task.table_version)).collect::<Vec<_>>(),
            "filteredColumnAggregation": tasks.filtered_column_aggregation.iter()
                .map(|tracked| tracked_json(tracked.as_ref(), |task| task.column.table_version)).collect::<Vec<_>>(),
        },
    })
}

/// The version that a task of the scheduler is computed for
fn task_version(task: &ComputationTask) -> ComputationVersion {
    match task {
        ComputationTask::TableFiltering(task) => task.table_version,
        ComputationTask::TableOrdering(task) => task.table_version,
        ComputationTask::TableAggregation(task) => task.table_version,
        ComputationTask::SystemColumns(task) => task.table_version,
        ComputationTask::ColumnAggregation(task) => task.table_version,
        ComputationTask::FilteredColumnAggregation(task) => task.column.table_version,
        ComputationTask::DataSearch(task) => task.table_version,
    }
}

/// What an action did: whether it changed the state, the effects for the host as JSON and the id of a scheduled task
#[wasm_bindgen]
pub struct ComputationOutcome {
    changed: bool,
    effects: String,
    task_id: Option<f64>,
}

#[wasm_bindgen]
impl ComputationOutcome {
    /// Did the action change the state?
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    /// The effects as a JSON array, in order
    #[wasm_bindgen(getter)]
    pub fn effects(&self) -> String {
        self.effects.clone()
    }

    /// The id of a scheduled task
    #[wasm_bindgen(getter, js_name = taskId)]
    pub fn task_id(&self) -> Option<f64> {
        self.task_id
    }
}

impl From<RuntimeOutcome> for ComputationOutcome {
    fn from(outcome: RuntimeOutcome) -> Self {
        let effects = Value::Array(outcome.effects.iter().map(effect_json).collect()).to_string();
        ComputationOutcome { changed: outcome.changed, effects, task_id: outcome.task_id.map(|id| id as f64) }
    }
}

fn id(value: f64) -> u64 {
    if value.is_finite() && value >= 0.0 {
        value as u64
    } else {
        0
    }
}

fn time(value: f64) -> i64 {
    if value.is_finite() {
        value as i64
    } else {
        0
    }
}

fn search_kind(data: bool) -> SearchKind {
    if data {
        SearchKind::Data
    } else {
        SearchKind::Columns
    }
}

/// The computations of the result tables and the tasks of the scheduler
#[wasm_bindgen]
pub struct Computations {
    inner: ComputationState,
}

impl Computations {
    fn apply(&mut self, action: ComputationAction) -> Result<ComputationOutcome, JsError> {
        self.inner.apply(action).map(ComputationOutcome::from).map_err(js_error)
    }
}

impl Default for Computations {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Computations {
    /// A state without computations
    #[wasm_bindgen(constructor)]
    pub fn new() -> Computations {
        Computations { inner: ComputationState::new() }
    }

    // Actions

    /// Schedule a task, its JSON names its kind. The outcome holds the id of the task unless it was dropped.
    #[wasm_bindgen(js_name = scheduleTask)]
    pub fn schedule_task(&mut self, task: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let task = task_of(&parse(task, "computation task")?)?;
        self.apply(ComputationAction::ScheduleTask { task, now: time(now) })
    }

    /// The scheduler reports progress of a task, the JSON holds what changed
    #[wasm_bindgen(js_name = updateSchedulerTask)]
    pub fn update_scheduler_task(&mut self, task_id: f64, progress: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let progress = progress_update_of(&parse(progress, "task progress")?);
        self.apply(ComputationAction::UpdateSchedulerTask { task_id: id(task_id), progress, now: time(now) })
    }

    #[wasm_bindgen(js_name = unregisterSchedulerTask)]
    pub fn unregister_scheduler_task(&mut self, task_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::UnregisterSchedulerTask { task_id: id(task_id) })
    }

    /// Start the computation of a result table, the column groups as a JSON array
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = computationFromQueryResult)]
    pub fn computation_from_query_result(
        &mut self,
        table_id: f64,
        data_table: f64,
        rows: f64,
        fields: Vec<String>,
        column_groups: &str,
        lifetime: f64,
        connection_id: Option<String>,
        client_context: Option<String>,
    ) -> Result<ComputationOutcome, JsError> {
        let groups = parse(column_groups, "column groups")?;
        let column_groups = column_groups_of(groups.as_array().map_or(&[], Vec::as_slice))?;
        self.apply(ComputationAction::ComputationFromQueryResult {
            table_id: id(table_id),
            data_table: ArrowTable { id: id(data_table), rows: id(rows) },
            fields,
            column_groups,
            lifetime: id(lifetime),
            connection_id,
            client_context,
        })
    }

    #[wasm_bindgen(js_name = deleteComputation)]
    pub fn delete_computation(&mut self, table_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::DeleteComputation { table_id: id(table_id) })
    }

    #[wasm_bindgen(js_name = createdDataFrame)]
    pub fn created_data_frame(&mut self, table_id: f64, data_frame: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::CreatedDataFrame { table_id: id(table_id), data_frame: id(data_frame) })
    }

    #[wasm_bindgen(js_name = tableOrderingSucceeded)]
    pub fn table_ordering_succeeded(&mut self, table_id: f64, ordering: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let ordering = ordering_table_of(&parse(ordering, "ordering table")?);
        self.apply(ComputationAction::TableOrderingSucceeded { table_id: id(table_id), ordering, now: time(now) })
    }

    #[wasm_bindgen(js_name = clearTableOrdering)]
    pub fn clear_table_ordering(&mut self, table_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::ClearTableOrdering { table_id: id(table_id) })
    }

    /// A filter was computed for a version, none if no filter is active
    #[wasm_bindgen(js_name = tableFilteringSucceeded)]
    pub fn table_filtering_succeeded(
        &mut self,
        table_id: f64,
        data_version: f64,
        filter_version: f64,
        filter: Option<String>,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let filter = match filter {
            Some(filter) => filter_table_of(Some(&parse(&filter, "filter table")?)),
            None => None,
        };
        self.apply(ComputationAction::TableFilteringSucceeded {
            table_id: id(table_id),
            version: ComputationVersion::new(id(data_version), id(filter_version)),
            filter,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = tableAggregationSucceeded)]
    pub fn table_aggregation_succeeded(&mut self, table_id: f64, aggregation: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let aggregation = table_aggregation_of(Some(&parse(aggregation, "table aggregation")?));
        self.apply(ComputationAction::TableAggregationSucceeded { table_id: id(table_id), aggregation, now: time(now) })
    }

    /// The system columns were computed, the column groups as a JSON array
    #[wasm_bindgen(js_name = systemColumnsSucceeded)]
    pub fn system_columns_succeeded(
        &mut self,
        table_id: f64,
        data_table: f64,
        rows: f64,
        data_frame: f64,
        column_groups: &str,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let groups = parse(column_groups, "column groups")?;
        let column_groups = column_groups_of(groups.as_array().map_or(&[], Vec::as_slice))?;
        self.apply(ComputationAction::SystemColumnsSucceeded {
            table_id: id(table_id),
            data_table: ArrowTable { id: id(data_table), rows: id(rows) },
            data_frame: id(data_frame),
            column_groups,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = columnAggregationSucceeded)]
    pub fn column_aggregation_succeeded(&mut self, table_id: f64, column_id: u32, aggregate: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let aggregate = column_aggregate_of(Some(&parse(aggregate, "column aggregate")?))?;
        self.apply(ComputationAction::ColumnAggregationSucceeded { table_id: id(table_id), column_id, aggregate, now: time(now) })
    }

    /// The summary of a column over the selected rows was computed for a version, none if there is no selection
    #[wasm_bindgen(js_name = filteredColumnAggregationSucceeded)]
    pub fn filtered_column_aggregation_succeeded(
        &mut self,
        table_id: f64,
        column_id: u32,
        data_version: f64,
        filter_version: f64,
        aggregate: Option<String>,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let aggregate = match aggregate {
            Some(aggregate) => Some(filtered_aggregate_of(&parse(&aggregate, "filtered column aggregate")?)?),
            None => None,
        };
        self.apply(ComputationAction::FilteredColumnAggregationSucceeded {
            table_id: id(table_id),
            column_id,
            version: ComputationVersion::new(id(data_version), id(filter_version)),
            aggregate,
            now: time(now),
        })
    }

    /// Set the cross filters, the selections of the columns as JSON
    #[wasm_bindgen(js_name = setCrossFilters)]
    pub fn set_cross_filters(&mut self, table_id: f64, filters: &str) -> Result<ComputationOutcome, JsError> {
        let filters = cross_filters_of(&parse(filters, "cross filters")?)?;
        self.apply(ComputationAction::SetCrossFilters { table_id: id(table_id), filters })
    }

    /// Request a search of the data or of the columns, an empty pattern ends the search
    #[wasm_bindgen(js_name = setResultSearchPattern)]
    pub fn set_result_search_pattern(&mut self, table_id: f64, data: bool, pattern: String) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::SetResultSearchPattern { table_id: id(table_id), kind: search_kind(data), pattern })
    }

    #[wasm_bindgen(js_name = columnSearchSucceeded)]
    pub fn column_search_succeeded(
        &mut self,
        table_id: f64,
        data_frame: f64,
        request_id: f64,
        matching_column_groups: Vec<u32>,
    ) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::ColumnSearchSucceeded {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            matching_column_groups,
        })
    }

    /// A search of the data matched rows: the table of the matches as JSON, and the matching columns of the rows,
    /// the columns of the row `rows[i]` are `columns[offsets[i]..offsets[i + 1]]`
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = dataSearchSucceeded)]
    pub fn data_search_succeeded(
        &mut self,
        table_id: f64,
        data_frame: f64,
        request_id: f64,
        search: &str,
        rows: &[f64],
        offsets: &[u32],
        columns: &[u32],
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let Some(search) = data_search_table_of(Some(&parse(search, "data search table")?)) else {
            return Err(invalid("missing data search table".into()));
        };
        if offsets.len() != rows.len().saturating_add(1) && !(rows.is_empty() && offsets.is_empty()) {
            return Err(invalid("the matching rows need an offset each and an end".into()));
        }
        let mut matching_rows = BTreeMap::new();
        for (i, row) in rows.iter().enumerate() {
            let (Some(begin), Some(end)) = (offsets.get(i), offsets.get(i.saturating_add(1))) else {
                break;
            };
            let row_columns = columns.get(*begin as usize..*end as usize).unwrap_or_default();
            matching_rows.insert(id(*row), row_columns.to_vec());
        }
        self.apply(ComputationAction::DataSearchSucceeded {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            search,
            matching_rows,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = dataSearchFailed)]
    pub fn data_search_failed(&mut self, table_id: f64, data_frame: f64, request_id: f64, error: String) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::DataSearchFailed {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            error,
        })
    }

    #[wasm_bindgen(js_name = resultSearchFailed)]
    pub fn result_search_failed(
        &mut self,
        table_id: f64,
        data_frame: f64,
        data: bool,
        request_id: f64,
        error: String,
    ) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::ResultSearchFailed {
            table_id: id(table_id),
            data_frame: id(data_frame),
            kind: search_kind(data),
            request_id: id(request_id),
            error,
        })
    }

    // Reading the state

    /// The revision of the state, it changes with every change
    pub fn revision(&self) -> f64 {
        self.inner.revision() as f64
    }

    /// The id of the next scheduled task
    #[wasm_bindgen(js_name = nextTaskId)]
    pub fn next_task_id(&self) -> f64 {
        self.inner.next_task_id() as f64
    }

    /// The tables with a computation
    #[wasm_bindgen(js_name = tableIds)]
    pub fn table_ids(&self) -> Vec<f64> {
        self.inner.computations().map(|(id, _)| id as f64).collect()
    }

    /// The revision of the computation of a table, none without one
    #[wasm_bindgen(js_name = computationRevision)]
    pub fn computation_revision(&self, table_id: f64) -> Option<f64> {
        self.inner.computation(id(table_id)).map(|computation| computation.revision() as f64)
    }

    /// The fields of the computation of a table as JSON
    #[wasm_bindgen(js_name = computationSnapshot)]
    pub fn computation_snapshot(&self, table_id: f64) -> Result<String, JsError> {
        let computation = self.inner.computation(id(table_id)).ok_or_else(|| invalid(format!("no computation of the table {table_id}")))?;
        Ok(computation_json(computation).to_string())
    }

    /// The tasks of the scheduler
    #[wasm_bindgen(js_name = schedulerTaskIds)]
    pub fn scheduler_task_ids(&self) -> Vec<f64> {
        self.inner.scheduler_tasks().map(|(id, _)| id as f64).collect()
    }

    /// The table and the version of a task of the scheduler as JSON, a scheduled filtering is computed for the next
    /// filter version
    #[wasm_bindgen(js_name = schedulerTaskSnapshot)]
    pub fn scheduler_task_snapshot(&self, task_id: f64) -> Option<String> {
        self.inner
            .scheduler_task(id(task_id))
            .map(|task| json!({ "tableId": task.table_id(), "version": version_json(task_version(task)) }).to_string())
    }

    /// The tasks that the state knows: the tasks of the scheduler and the ones that the computations track
    #[wasm_bindgen(js_name = taskIds)]
    pub fn task_ids(&self) -> Vec<f64> {
        self.inner.task_ids().into_iter().map(|id| id as f64).collect()
    }

    /// Does the state hold a data frame?
    #[wasm_bindgen(js_name = holdsDataFrame)]
    pub fn holds_data_frame(&self, data_frame: f64) -> bool {
        self.inner.holds_data_frame(id(data_frame))
    }

    /// Does the state hold an Arrow table?
    #[wasm_bindgen(js_name = holdsArrowTable)]
    pub fn holds_arrow_table(&self, table: f64) -> bool {
        self.inner.holds_arrow_table(id(table))
    }
}
