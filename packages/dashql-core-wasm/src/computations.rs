//! The wasm-bindgen API of the computations of result tables (`dashql_core_runtime::compute`).
//!
//! An action is a method call. Ids, versions and names are typed arguments, the nested values of a task or a result
//! (column groups, filter tables, summaries, cross filters) come as JSON. An action returns a `ComputationOutcome` with
//! the effects for the host as JSON. The state is read per computation: a computation changes its revision with every
//! change, the host reads only the computations whose revision moved, a snapshot of their fields as JSON.
//!
//! The Arrow tables of the state are Rust values with ids. The host registers a table of its own as Arrow IPC
//! (`registerArrowTable`) and names it by its id in the JSON of the next action, and reads a table of the state as
//! Arrow IPC (`arrowTableIpc`). The data frames and the lifetimes are ids of the host. The JSON readers take what they
//! find and use defaults for missing fields: a value of the host that lacks a part still schedules, its result is
//! dropped like any stale one.
//!
//! The tasks run in Rust (`dashql_core_runtime::compute::service`) on the compute database of the host
//! (`ComputeHost` in the generated declarations): `analyzeTable` analyzes a result, `runTask` runs a scheduled task.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use dashql_core::error::Error;
use dashql_core_runtime::compute::cross_filters::{CrossFilterPredicate, CrossFilters};
use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, RunId};
use dashql_core_runtime::compute::service::ComputeService;
use dashql_core_runtime::compute::tasks::analysis::BinBounds;
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{
    ArrowTable, ColumnAggregate, ColumnSummaryAnalysis, ColumnAggregationTask, ColumnGroup, ColumnStatsFields, ColumnSummary, ComputationTask,
    ComputationVersion, DataSearchColumn, DataSearchTable, DataSearchTask, FilterOp, FilterTable, FilteredColumnAggregate,
    FilteredColumnAggregationTask, ListColumnGroup, OrderByConstraint, OrderingTable, OrdinalColumnGroup,
    ResultSearchState, RowNumberColumnGroup, ScalarFilter, SkippedColumnGroup, StringColumnGroup, SystemColumnsTask,
    TableAggregation, TableAggregationTask, TableFilteringTask, TableOrderingTask, TaskProgress, TaskProgressUpdate,
    TaskStatus, TrackedTask,
};
use dashql_core_runtime::compute::{
    ComputationAction, ComputationEffect, ComputationOutcome as RuntimeOutcome, ComputationState, SearchKind,
    TableComputation,
};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use js_sys::{Function, Promise, Reflect, Uint8Array};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

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

/// The tables that the JSON of an action names by id: the tables that the host registered for the action and the
/// tables of the state. An unknown id names a table without columns.
struct Tables<'a> {
    registered: &'a BTreeMap<u64, Arc<ResultTable>>,
    state: &'a ComputationState,
}

impl Tables<'_> {
    fn get(&self, id: u64) -> ArrowTable {
        if let Some(table) = self.registered.get(&id) {
            return ArrowTable::new(id, table.clone());
        }
        self.state.arrow_table(id).unwrap_or_else(|| ArrowTable::new(id, Arc::new(ResultTable::empty())))
    }
}

fn arrow_table_of(value: Option<&Value>, t: &Tables) -> ArrowTable {
    t.get(value.map_or(0, |v| u64_at(v, "id")))
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

fn filter_table_of(value: Option<&Value>, t: &Tables) -> Option<FilterTable> {
    value.map(|v| FilterTable {
        input_row_number_column_name: str_at(v, "inputRowNumberColumnName"),
        table: arrow_table_of(present(v, "table"), t),
        data_frame: u64_at(v, "dataFrame"),
        version: version_at(v, "version"),
    })
}

fn ordering_table_of(value: &Value, t: &Tables) -> OrderingTable {
    OrderingTable {
        input_row_number_column_name: str_at(value, "inputRowNumberColumnName"),
        ordering_constraints: order_by_of(items(value, "orderingConstraints")),
        table: arrow_table_of(present(value, "table"), t),
        data_frame: u64_at(value, "dataFrame"),
        version: version_at(value, "version"),
        data_search_request_id: opt_u64_at(value, "dataSearchRequestId"),
    }
}

fn data_search_table_of(value: Option<&Value>, t: &Tables) -> Option<DataSearchTable> {
    value.map(|v| DataSearchTable {
        input_row_number_column_name: str_at(v, "inputRowNumberColumnName"),
        table: arrow_table_of(present(v, "table"), t),
        data_frame: u64_at(v, "dataFrame"),
        version: version_at(v, "version"),
        request_id: u64_at(v, "requestId"),
    })
}

fn table_aggregation_of(value: Option<&Value>, t: &Tables) -> TableAggregation {
    TableAggregation {
        table: t.get(value.map_or(0, |v| u64_at(v, "table"))),
        data_frame: value.map_or(0, |v| u64_at(v, "dataFrame")),
        count_star_field_name: value.map(|v| str_at(v, "countStarFieldName")).unwrap_or_default(),
    }
}

fn column_aggregate_of(value: Option<&Value>, t: &Tables) -> Result<ColumnAggregate, JsError> {
    let Some(value) = value else {
        return Ok(ColumnAggregate::Skipped);
    };
    let summary = ColumnSummary { table: t.get(u64_at(value, "id")), data_frame: u64_at(value, "dataFrame"), analysis: None };
    Ok(match value.get("kind").and_then(Value::as_str).unwrap_or("skipped") {
        "ordinal" => ColumnAggregate::Ordinal(summary),
        "string" => ColumnAggregate::String(summary),
        "list" => ColumnAggregate::List(summary),
        "skipped" => ColumnAggregate::Skipped,
        other => return Err(invalid(format!("unknown column aggregate: {other}"))),
    })
}

fn filtered_aggregate_of(value: &Value, t: &Tables) -> Result<FilteredColumnAggregate, JsError> {
    Ok(FilteredColumnAggregate {
        aggregate: column_aggregate_of(present(value, "aggregate"), t)?,
        filter_version: version_at(value, "filterVersion"),
        data_search_request_id: opt_u64_at(value, "dataSearchRequestId"),
    })
}

fn column_task_of(value: &Value, t: &Tables) -> Result<ColumnAggregationTask, JsError> {
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
        table_aggregate: table_aggregation_of(present(value, "tableAggregate"), t),
    })
}

fn task_of(value: &Value, t: &Tables) -> Result<ComputationTask, JsError> {
    let table_id = u64_at(value, "tableId");
    let table_version = version_at(value, "tableVersion");
    let input_data_frame = u64_at(value, "inputDataFrame");
    Ok(match value.get("kind").and_then(Value::as_str).unwrap_or_default() {
        "tableFiltering" => ComputationTask::TableFiltering(TableFilteringTask {
            table_id,
            table_version,
            input_data_table: arrow_table_of(present(value, "inputDataTable"), t),
            input_data_frame,
            row_number_column_name: str_at(value, "rowNumberColumnName"),
            filters: scalar_filters_of(items(value, "filters"))?,
        }),
        "tableOrdering" => ComputationTask::TableOrdering(TableOrderingTask {
            table_id,
            table_version,
            input_data_table: arrow_table_of(present(value, "inputDataTable"), t),
            input_data_frame,
            filter_table: filter_table_of(present(value, "filterTable"), t),
            data_search_table: data_search_table_of(present(value, "dataSearchTable"), t),
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
            input_table: arrow_table_of(present(value, "inputTable"), t),
            input_data_frame,
            row_number_field_name: str_at(value, "rowNumberFieldName"),
            table_aggregate: table_aggregation_of(present(value, "tableAggregate"), t),
        }),
        "columnAggregation" => ComputationTask::ColumnAggregation(column_task_of(value, t)?),
        "filteredColumnAggregation" => ComputationTask::FilteredColumnAggregation(FilteredColumnAggregationTask {
            column: column_task_of(value, t)?,
            filter_table: filter_table_of(present(value, "filterTable"), t),
            data_search_table: data_search_table_of(present(value, "dataSearchTable"), t),
            selection_row_count: u64_at(value, "selectionRowCount"),
            unfiltered_aggregate: column_aggregate_of(present(value, "unfilteredAggregate"), t)?,
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
        "id": summary.map(|s| s.table.id),
        "dataFrame": summary.map(|s| s.data_frame),
        "analysis": summary.and_then(|s| s.analysis.as_deref()).map(analysis_json),
    })
}

/// The numbers of the analysis of a summary, the host formats the values of the tables
fn analysis_json(analysis: &ColumnSummaryAnalysis) -> Value {
    match analysis {
        ColumnSummaryAnalysis::Ordinal(analysis) => json!({
            "kind": "ordinal",
            "totalCount": analysis.total_count,
            "countNotNull": analysis.count_not_null,
            "countNull": analysis.count_null,
            "binCount": analysis.bin_count,
            "binValueCounts": analysis.bin_value_counts,
            "binPercentages": analysis.bin_percentages,
            "binLowerBounds": analysis.bin_lower_bounds,
            "binBounds": match analysis.bin_bounds {
                BinBounds::Numbers => "numbers",
                BinBounds::EpochMillis => "epochMillis",
            },
        }),
        ColumnSummaryAnalysis::String(analysis) => json!({
            "kind": "string",
            "totalCount": analysis.total_count,
            "countNotNull": analysis.count_not_null,
            "countNull": analysis.count_null,
            "countDistinct": analysis.count_distinct,
            "isUnique": analysis.is_unique,
            "frequentValueIds": analysis.frequent_value_ids,
            "frequentValueCounts": analysis.frequent_value_counts,
            "frequentValuePercentages": analysis.frequent_value_percentages,
        }),
    }
}

fn stats_fields_json(fields: &Option<ColumnStatsFields>) -> Value {
    match fields {
        Some(fields) => json!({
            "countFieldName": fields.count_field_name,
            "distinctCountFieldName": fields.distinct_count_field_name,
            "minAggregateFieldName": fields.min_aggregate_field_name,
            "maxAggregateFieldName": fields.max_aggregate_field_name,
        }),
        None => Value::Null,
    }
}

/// A column group as the host reads it, the host knows the Arrow type of a field by its name
fn column_group_json(group: &ColumnGroup) -> Value {
    match group {
        ColumnGroup::RowNumber(group) => json!({ "type": "ROWNUMBER", "rowNumberFieldName": group.row_number_field_name }),
        ColumnGroup::Skipped(group) => json!({
            "type": "SKIPPED",
            "inputFieldName": group.input_field_name,
            "inputFieldNullable": group.input_field_nullable,
        }),
        ColumnGroup::Ordinal(group) => json!({
            "type": "ORDINAL",
            "inputFieldName": group.input_field_name,
            "inputFieldNullable": group.input_field_nullable,
            "statsFields": stats_fields_json(&group.stats_fields),
            "binFieldName": group.bin_field_name,
            "binCount": group.bin_count,
        }),
        ColumnGroup::String(group) => json!({
            "type": "STRING",
            "inputFieldName": group.input_field_name,
            "inputFieldNullable": group.input_field_nullable,
            "statsFields": stats_fields_json(&group.stats_fields),
            "valueIdFieldName": group.value_id_field_name,
        }),
        ColumnGroup::List(group) => json!({
            "type": "LIST",
            "inputFieldName": group.input_field_name,
            "inputFieldNullable": group.input_field_nullable,
            "statsFields": stats_fields_json(&group.stats_fields),
            "valueIdFieldName": group.value_id_field_name,
        }),
    }
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

/// The fields of a computation that the host projects. The tables are named by their ids, the host reads a table
/// that it doesn't know yet as Arrow IPC.
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
        "clientContext": computation.client_context,
        "dataTable": { "id": computation.data_table.id, "rows": computation.data_table.rows() },
        "dataTableFields": computation.data_table_fields,
        "dataFrame": computation.data_frame,
        "columnGroups": computation.column_groups.iter().map(column_group_json).collect::<Vec<_>>(),
        "dataTableOrdering": order_by_json(&computation.data_table_ordering),
        "filterTable": computation.filter_table.as_ref().map(|t| json!({
            "table": t.table.id,
            "dataFrame": t.data_frame,
            "inputRowNumberColumnName": t.input_row_number_column_name,
            "version": version_json(t.version),
        })),
        "orderingTable": computation.ordering_table.as_ref().map(|t| json!({
            "table": t.table.id,
            "dataFrame": t.data_frame,
            "inputRowNumberColumnName": t.input_row_number_column_name,
            "orderingConstraints": order_by_json(&t.ordering_constraints),
            "version": version_json(t.version),
            "dataSearchRequestId": t.data_search_request_id,
        })),
        "dataSearchTable": computation.data_search_table.as_ref().map(|t| json!({
            "table": t.table.id,
            "dataFrame": t.data_frame,
            "inputRowNumberColumnName": t.input_row_number_column_name,
            "version": version_json(t.version),
            "requestId": t.request_id,
        })),
        "columnSearch": search_json(&computation.column_search),
        "dataSearch": search_json(&computation.data_search),
        "rowNumberColumnGroup": computation.row_number_column_group,
        "rowNumberColumnName": computation.row_number_column_name,
        "tableAggregation": computation.table_aggregation.as_ref().map(|t| json!({
            "table": t.table.id,
            "dataFrame": t.data_frame,
            "countStarFieldName": t.count_star_field_name,
        })),
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

#[wasm_bindgen(typescript_custom_section)]
const COMPUTE_HOST: &str = r#"
/** The compute database of the computations, the embedded Hyper of the platform. The context of a call is JSON with the computation (`tableId`), the title of its task, the connection and the client context of the computation, and the run that `cancel` aborts. Tables cross as Arrow IPC streams. */
export interface ComputeHost {
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void;
    /** Create the table of a data frame from an Arrow IPC stream */
    importTable(dataFrame: number, tableName: string, ipc: Uint8Array, context: string): Promise<void>;
    /** Create the table of a data frame from a SELECT, the host tracks the SELECT as a query of the task */
    createTable(dataFrame: number, tableName: string, sql: string, context: string): Promise<void>;
    /** Run a query, resolves to its result as an Arrow IPC stream */
    query(sql: string, context: string): Promise<Uint8Array>;
    /** Drop the table of a data frame, unless the host still reads it */
    dropTable(dataFrame: number, tableName: string): Promise<void>;
    /** Abort the calls of a run */
    cancel(run: number): void;
    /** A task changed the state, the effects of its actions as a JSON array */
    changed(effects: string): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "ComputeHost")]
    #[derive(Clone)]
    pub type JsComputeHostObject;

    #[wasm_bindgen(method, catch)]
    fn log(this: &JsComputeHostObject, level: &str, message: &str, details: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = importTable)]
    fn import_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str, ipc: &Uint8Array, context: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = createTable)]
    fn create_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str, sql: &str, context: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn query(this: &JsComputeHostObject, sql: &str, context: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = dropTable)]
    fn drop_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn cancel(this: &JsComputeHostObject, run: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn changed(this: &JsComputeHostObject, effects: &str) -> Result<(), JsValue>;
}

/// The message of a value that JS failed with, an error of another realm too
fn message_of(value: &JsValue) -> String {
    if let Some(message) = value.is_object().then(|| Reflect::get(value, &JsValue::from_str("message")).ok()).flatten().and_then(|m| m.as_string()) {
        return message;
    }
    value.as_string().unwrap_or_else(|| "the compute host failed".to_string())
}

fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// Await a host call that returns a promise
async fn host_call(result: Result<JsValue, JsValue>) -> Result<JsValue, HostError> {
    let value = result.map_err(host_error)?;
    JsFuture::from(Promise::resolve(&value)).await.map_err(host_error)
}

fn context_json(context: &ComputeContext) -> String {
    json!({
        "tableId": context.table_id,
        "title": context.title,
        "connectionId": context.connection_id,
        "clientContext": context.client_context,
        "run": context.run,
    })
    .to_string()
}

/// The compute host over the JS object, which the host sets after creating the computations
#[derive(Default)]
pub struct JsComputeHost {
    host: RefCell<Option<JsComputeHostObject>>,
}

impl JsComputeHost {
    fn object(&self) -> Result<JsComputeHostObject, HostError> {
        self.host.borrow().clone().ok_or_else(|| HostError::new("the computations have no compute host"))
    }
}

impl Host for JsComputeHost {
    fn now(&self) -> f64 {
        js_sys::Date::now()
    }

    fn sleep(&self, ms: f64) -> impl std::future::Future<Output = ()> + 'static {
        let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
            let global = js_sys::global();
            let set_timeout = Reflect::get(&global, &JsValue::from_str("setTimeout")).ok().and_then(|f| f.dyn_into::<Function>().ok());
            let scheduled = set_timeout.is_some_and(|set_timeout| set_timeout.call2(&global, &resolve, &JsValue::from_f64(ms)).is_ok());
            if !scheduled {
                let _ = resolve.call0(&JsValue::UNDEFINED);
            }
        });
        async move {
            let _ = JsFuture::from(promise).await;
        }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details: Map<String, Value> = details.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect();
        if let Some(host) = self.host.borrow().as_ref() {
            let _ = host.log(level.name(), message, &Value::Object(details).to_string());
        }
    }
}

impl ComputeHost for JsComputeHost {
    async fn import_table(&self, data_frame: u64, table_name: &str, ipc: Vec<u8>, context: &ComputeContext) -> Result<(), HostError> {
        let host = self.object()?;
        let bytes = Uint8Array::from(ipc.as_slice());
        host_call(host.import_table(data_frame as f64, table_name, &bytes, &context_json(context))).await?;
        Ok(())
    }

    async fn create_table(&self, data_frame: u64, table_name: &str, sql: &str, context: &ComputeContext) -> Result<(), HostError> {
        let host = self.object()?;
        host_call(host.create_table(data_frame as f64, table_name, sql, &context_json(context))).await?;
        Ok(())
    }

    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError> {
        let host = self.object()?;
        let value = host_call(host.query(sql, &context_json(context))).await?;
        // The bytes may come from another realm, e.g. a frame that shares the module, they are copied by value
        if !value.is_object() {
            return Err(HostError::new("the compute host returned no Arrow IPC stream"));
        }
        Ok(Uint8Array::new(&value).to_vec())
    }

    async fn drop_table(&self, data_frame: u64, table_name: &str) -> Result<(), HostError> {
        let host = self.object()?;
        host_call(host.drop_table(data_frame as f64, table_name)).await?;
        Ok(())
    }

    fn cancel(&self, run: RunId) {
        if let Some(host) = self.host.borrow().as_ref() {
            let _ = host.cancel(run as f64);
        }
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        let host = self.host.borrow().clone();
        if let Some(host) = host {
            let effects = Value::Array(effects.iter().map(effect_json).collect()).to_string();
            let _ = host.changed(&effects);
        }
    }
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}

/// The computations of the result tables and the tasks of the scheduler
#[wasm_bindgen]
pub struct Computations {
    service: ComputeService<JsComputeHost>,
    /// The tables that the host registered for its next action
    registered: RefCell<BTreeMap<u64, Arc<ResultTable>>>,
}

impl Computations {
    /// Read the JSON of an action with the tables it names
    fn read<T>(&self, read: impl FnOnce(&Tables) -> Result<T, JsError>) -> Result<T, JsError> {
        let registered = self.registered.borrow();
        self.service.read(|state| read(&Tables { registered: &registered, state }))
    }

    /// Apply an action, the registered tables that it didn't take go
    fn apply(&self, action: ComputationAction) -> Result<ComputationOutcome, JsError> {
        let outcome = self.service.apply(action).map(ComputationOutcome::from).map_err(js_error);
        self.registered.borrow_mut().clear();
        outcome
    }

    fn table(&self, table: f64) -> Result<ArrowTable, JsError> {
        self.read(|tables| Ok(tables.get(id(table))))
    }

    fn column_groups(column_groups: &str) -> Result<Vec<ColumnGroup>, JsError> {
        let groups = parse(column_groups, "column groups")?;
        column_groups_of(groups.as_array().map_or(&[], Vec::as_slice))
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
        Computations { service: ComputeService::new(JsComputeHost::default()), registered: RefCell::new(BTreeMap::new()) }
    }

    /// Set the compute host, the tasks run on its compute database
    #[wasm_bindgen(js_name = setHost)]
    pub fn set_host(&self, host: JsComputeHostObject) {
        *self.service.host().host.borrow_mut() = Some(host);
    }

    /// A new id of a data frame, an Arrow table or a lifetime of the host
    #[wasm_bindgen(js_name = allocateId)]
    pub fn allocate_id(&self) -> f64 {
        self.service.allocate_id() as f64
    }

    /// Register a table of the host as Arrow IPC, the next action names it by the returned id
    #[wasm_bindgen(js_name = registerArrowTable)]
    pub fn register_arrow_table(&self, ipc: &[u8]) -> Result<f64, JsError> {
        let table = ResultTable::from_ipc_stream(ipc).map_err(js_error)?;
        let id = self.service.allocate_id();
        self.registered.borrow_mut().insert(id, Arc::new(table));
        Ok(id as f64)
    }

    /// A table of the state as Arrow IPC
    #[wasm_bindgen(js_name = arrowTableIpc)]
    pub fn arrow_table_ipc(&self, table: f64) -> Result<Vec<u8>, JsError> {
        let table = id(table);
        let found = self.service.read(|state| state.arrow_table(table));
        let found = found.ok_or_else(|| invalid(format!("the state holds no table {table}")))?;
        found.table.to_ipc_stream().map_err(js_error)
    }

    /// The tables that the state holds
    #[wasm_bindgen(js_name = arrowTableIds)]
    pub fn arrow_table_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.arrow_tables().into_iter().map(|id| id as f64).collect())
    }

    // Services

    /// Analyze a result as the computation of a table: the result as Arrow IPC, the connection that ran its query and
    /// the client context of the queries of a computation without one. Resolves once the summaries of the columns are
    /// computed, rejects with the error of a failed task.
    #[wasm_bindgen(js_name = analyzeTable)]
    pub fn analyze_table(
        &self,
        table_id: f64,
        ipc: &[u8],
        connection_id: Option<String>,
        client_context: Option<String>,
        column_aggregates: bool,
    ) -> Result<Promise, JsError> {
        let table = ResultTable::from_ipc_stream(ipc).map_err(js_error)?;
        let options = AnalyzeTableOptions { column_aggregates };
        let analysis = self.service.analyze_table(id(table_id), table, connection_id, client_context, options);
        Ok(future_to_promise(async move { analysis.await.map(|_| JsValue::UNDEFINED).map_err(task_error) }))
    }

    /// Run a scheduled task on the compute host. Resolves once its result is applied, rejects with its error.
    #[wasm_bindgen(js_name = runTask)]
    pub fn run_task(&self, task_id: f64) -> Promise {
        let run = self.service.run_task(id(task_id));
        future_to_promise(async move { run.await.map(|_| JsValue::UNDEFINED).map_err(task_error) })
    }

    /// Cancel the run of a task, it fails
    #[wasm_bindgen(js_name = cancelTask)]
    pub fn cancel_task(&self, task_id: f64) {
        self.service.cancel_task(id(task_id));
    }

    // Actions

    /// Schedule a task, its JSON names its kind. The outcome holds the id of the task unless it was dropped.
    #[wasm_bindgen(js_name = scheduleTask)]
    pub fn schedule_task(&self, task: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let task = parse(task, "computation task")?;
        let task = self.read(|tables| task_of(&task, tables))?;
        self.apply(ComputationAction::ScheduleTask { task, now: time(now) })
    }

    /// The scheduler reports progress of a task, the JSON holds what changed
    #[wasm_bindgen(js_name = updateSchedulerTask)]
    pub fn update_scheduler_task(&self, task_id: f64, progress: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let progress = progress_update_of(&parse(progress, "task progress")?);
        self.apply(ComputationAction::UpdateSchedulerTask { task_id: id(task_id), progress, now: time(now) })
    }

    #[wasm_bindgen(js_name = unregisterSchedulerTask)]
    pub fn unregister_scheduler_task(&self, task_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::UnregisterSchedulerTask { task_id: id(task_id) })
    }

    /// Start the computation of a result table, a table that the host registered, the column groups as a JSON array
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = computationFromQueryResult)]
    pub fn computation_from_query_result(
        &self,
        table_id: f64,
        data_table: f64,
        fields: Vec<String>,
        column_groups: &str,
        lifetime: f64,
        connection_id: Option<String>,
        client_context: Option<String>,
    ) -> Result<ComputationOutcome, JsError> {
        let column_groups = Self::column_groups(column_groups)?;
        self.apply(ComputationAction::ComputationFromQueryResult {
            table_id: id(table_id),
            data_table: self.table(data_table)?,
            fields,
            column_groups,
            lifetime: id(lifetime),
            connection_id,
            client_context,
        })
    }

    #[wasm_bindgen(js_name = deleteComputation)]
    pub fn delete_computation(&self, table_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::DeleteComputation { table_id: id(table_id) })
    }

    #[wasm_bindgen(js_name = createdDataFrame)]
    pub fn created_data_frame(&self, table_id: f64, data_frame: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::CreatedDataFrame { table_id: id(table_id), data_frame: id(data_frame) })
    }

    #[wasm_bindgen(js_name = tableOrderingSucceeded)]
    pub fn table_ordering_succeeded(&self, table_id: f64, ordering: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let ordering = parse(ordering, "ordering table")?;
        let ordering = self.read(|tables| Ok(ordering_table_of(&ordering, tables)))?;
        self.apply(ComputationAction::TableOrderingSucceeded { table_id: id(table_id), ordering, now: time(now) })
    }

    #[wasm_bindgen(js_name = clearTableOrdering)]
    pub fn clear_table_ordering(&self, table_id: f64) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::ClearTableOrdering { table_id: id(table_id) })
    }

    /// A filter was computed for a version, none if no filter is active
    #[wasm_bindgen(js_name = tableFilteringSucceeded)]
    pub fn table_filtering_succeeded(
        &self,
        table_id: f64,
        data_version: f64,
        filter_version: f64,
        filter: Option<String>,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let filter = match filter {
            Some(filter) => {
                let filter = parse(&filter, "filter table")?;
                self.read(|tables| Ok(filter_table_of(Some(&filter), tables)))?
            }
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
    pub fn table_aggregation_succeeded(&self, table_id: f64, aggregation: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let aggregation = parse(aggregation, "table aggregation")?;
        let aggregation = self.read(|tables| Ok(table_aggregation_of(Some(&aggregation), tables)))?;
        self.apply(ComputationAction::TableAggregationSucceeded { table_id: id(table_id), aggregation, now: time(now) })
    }

    /// The system columns were computed: a table that the host registered, the column groups as a JSON array
    #[wasm_bindgen(js_name = systemColumnsSucceeded)]
    pub fn system_columns_succeeded(
        &self,
        table_id: f64,
        data_table: f64,
        data_frame: f64,
        column_groups: &str,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let column_groups = Self::column_groups(column_groups)?;
        self.apply(ComputationAction::SystemColumnsSucceeded {
            table_id: id(table_id),
            data_table: self.table(data_table)?,
            data_frame: id(data_frame),
            column_groups,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = columnAggregationSucceeded)]
    pub fn column_aggregation_succeeded(&self, table_id: f64, column_id: u32, aggregate: &str, now: f64) -> Result<ComputationOutcome, JsError> {
        let aggregate = parse(aggregate, "column aggregate")?;
        let aggregate = self.read(|tables| column_aggregate_of(Some(&aggregate), tables))?;
        self.apply(ComputationAction::ColumnAggregationSucceeded { table_id: id(table_id), column_id, aggregate, now: time(now) })
    }

    /// The summary of a column over the selected rows was computed for a version, none if there is no selection
    #[wasm_bindgen(js_name = filteredColumnAggregationSucceeded)]
    pub fn filtered_column_aggregation_succeeded(
        &self,
        table_id: f64,
        column_id: u32,
        data_version: f64,
        filter_version: f64,
        aggregate: Option<String>,
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let aggregate = match aggregate {
            Some(aggregate) => {
                let aggregate = parse(&aggregate, "filtered column aggregate")?;
                Some(self.read(|tables| filtered_aggregate_of(&aggregate, tables))?)
            }
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
    pub fn set_cross_filters(&self, table_id: f64, filters: &str) -> Result<ComputationOutcome, JsError> {
        let filters = cross_filters_of(&parse(filters, "cross filters")?)?;
        self.apply(ComputationAction::SetCrossFilters { table_id: id(table_id), filters })
    }

    /// Request a search of the data or of the columns, an empty pattern ends the search
    #[wasm_bindgen(js_name = setResultSearchPattern)]
    pub fn set_result_search_pattern(&self, table_id: f64, data: bool, pattern: String) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::SetResultSearchPattern { table_id: id(table_id), kind: search_kind(data), pattern })
    }

    #[wasm_bindgen(js_name = columnSearchSucceeded)]
    pub fn column_search_succeeded(
        &self,
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
        &self,
        table_id: f64,
        data_frame: f64,
        request_id: f64,
        search: &str,
        rows: &[f64],
        offsets: &[u32],
        columns: &[u32],
        now: f64,
    ) -> Result<ComputationOutcome, JsError> {
        let search = parse(search, "data search table")?;
        let Some(search) = self.read(|tables| Ok(data_search_table_of(Some(&search), tables)))? else {
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
    pub fn data_search_failed(&self, table_id: f64, data_frame: f64, request_id: f64, error: String) -> Result<ComputationOutcome, JsError> {
        self.apply(ComputationAction::DataSearchFailed {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            error,
        })
    }

    #[wasm_bindgen(js_name = resultSearchFailed)]
    pub fn result_search_failed(
        &self,
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
        self.service.read(|state| state.revision() as f64)
    }

    /// The id of the next scheduled task
    #[wasm_bindgen(js_name = nextTaskId)]
    pub fn next_task_id(&self) -> f64 {
        self.service.read(|state| state.next_task_id() as f64)
    }

    /// The tables with a computation
    #[wasm_bindgen(js_name = tableIds)]
    pub fn table_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.computations().map(|(id, _)| id as f64).collect())
    }

    /// The revision of the computation of a table, none without one
    #[wasm_bindgen(js_name = computationRevision)]
    pub fn computation_revision(&self, table_id: f64) -> Option<f64> {
        self.service.read(|state| state.computation(id(table_id)).map(|computation| computation.revision() as f64))
    }

    /// The fields of the computation of a table as JSON
    #[wasm_bindgen(js_name = computationSnapshot)]
    pub fn computation_snapshot(&self, table_id: f64) -> Result<String, JsError> {
        self.service.read(|state| {
            let computation =
                state.computation(id(table_id)).ok_or_else(|| invalid(format!("no computation of the table {table_id}")))?;
            Ok(computation_json(computation).to_string())
        })
    }

    /// The tasks of the scheduler
    #[wasm_bindgen(js_name = schedulerTaskIds)]
    pub fn scheduler_task_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.scheduler_tasks().map(|(id, _)| id as f64).collect())
    }

    /// The table and the version of a task of the scheduler as JSON, a scheduled filtering is computed for the next
    /// filter version
    #[wasm_bindgen(js_name = schedulerTaskSnapshot)]
    pub fn scheduler_task_snapshot(&self, task_id: f64) -> Option<String> {
        self.service.read(|state| {
            state
                .scheduler_task(id(task_id))
                .map(|task| json!({ "tableId": task.table_id(), "version": version_json(task_version(task)) }).to_string())
        })
    }

    /// The tasks that the state knows: the tasks of the scheduler and the ones that the computations track
    #[wasm_bindgen(js_name = taskIds)]
    pub fn task_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.task_ids().into_iter().map(|id| id as f64).collect())
    }

    /// Does the state hold a data frame?
    #[wasm_bindgen(js_name = holdsDataFrame)]
    pub fn holds_data_frame(&self, data_frame: f64) -> bool {
        self.service.read(|state| state.holds_data_frame(id(data_frame)))
    }

    /// Does the state hold an Arrow table?
    #[wasm_bindgen(js_name = holdsArrowTable)]
    pub fn holds_arrow_table(&self, table: f64) -> bool {
        self.service.read(|state| state.holds_arrow_table(id(table)))
    }
}
