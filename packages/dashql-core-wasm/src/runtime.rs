//! The runtime of DashQL as one class of the module (docs/wip/runtime_api.md).
//!
//! `Runtime` owns the state of DashQL and its services on one platform object (`JsPlatform`). The host reads the state
//! as views by revision: the runtime tells the platform that it changed, the store of the host takes the changed slices
//! (`takeChanges`) and reads their views once per kind (`views`). Writes are one `dispatch` with a generated union of
//! actions; the work that takes time and returns a result is a method each (`analyzeTable`).
//!
//! The runtime owns the computations of result tables; the other domains join it step by step: a domain adds its
//! state to `Runtime`, its slices to `ViewKind`, its targets and actions to the unions.
//!
//! Every method takes `&self` and the state sits behind the `RefCell`s of the services, which no call holds across a
//! call into the platform. Arguments of the wrong type fail with a JS error, nothing panics.

pub(crate) mod computation;

use std::cell::RefCell;
use std::collections::BTreeMap;

use dashql_core::error::Error;
use dashql_core_runtime::compute::service::{AnalysisHandles, ComputeService};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions as RuntimeAnalyzeOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{OrderByConstraint, TableId};
use dashql_core_runtime::compute::ComputationOutcome;
use js_sys::{Array, Promise};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use crate::host::{lifetime_token, HandleEffect, JsPlatform, JsRuntimePlatform};
use crate::views::{from_js, to_js, value_to_js};
use computation::{AnalyzeTableOptions, ComputationOrderBy, ComputationSearchKind, ComputationView};

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_VIEWS: &str = r#"
/** The slices of the runtime by kind: the id of a slice, its view, and the keys of the payloads of its view that the host holds */
export interface RuntimeViews {
    computation: { id: number; view: ComputationView; known: undefined };
}
/** A kind of slices of the runtime */
export type ViewKind = keyof RuntimeViews;
/** The id of a slice of a kind */
export type ViewId<K extends ViewKind> = RuntimeViews[K]['id'];
/** The view of a slice of a kind */
export type ViewOf<K extends ViewKind> = RuntimeViews[K]['view'];
/** The keys of the payloads that the host holds, they don't cross again */
export type KnownKeys<K extends ViewKind> = RuntimeViews[K]['known'];
export interface Runtime {
    /** The views of the slices of a kind, null for a slice that is gone. One crossing per kind and flush. */
    views<K extends ViewKind>(kind: K, ids: ViewId<K>[], known?: KnownKeys<K>): (ViewOf<K> | null)[];
}
"#;

/// The slice that an action changes
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    /// The computation of a result table by its id
    Computation(u64),
}

/// The actions of the runtime. An action changes the state in the call and returns its outcome; a failed action leaves
/// the state as it was.
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum RuntimeAction {
    /// Delete the computation, its runs are cancelled and its tables released
    DeleteComputation,
    /// Order the rows, an empty ordering clears it
    OrderBy { constraints: Vec<ComputationOrderBy> },
    /// Select a range of bins of the histogram of a column group, null clears the selection of the column
    HistogramFilter { column_group: u32, selection: Option<(f64, f64)> },
    /// Select a frequent value of a column group by its id, the selected value again or null clears the selection
    MostFrequentValueFilter { column_group: u32, value_id: Option<i64> },
    /// Clear the selections of all column groups
    ClearCrossFilters,
    /// Search the columns or the data, an empty pattern ends the search
    SetResultSearchPattern { search: ComputationSearchKind, pattern: String },
    /// Summarize a column group over the selected rows if its summary is outdated, e.g. once it shows
    RequestFilteredColumnAggregation { column_group: u32 },
}

/// What a dispatch did
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct DispatchOutcome {
    /// Was the action applied? A failed action leaves the state as it was.
    pub ok: bool,
    /// Did the action change the state?
    pub changed: bool,
    /// The error of a failed action
    pub error: Option<String>,
}

/// A slice that changed since the host took the changes, its revision is null if it went
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct SliceChange {
    #[tsify(type = "ViewKind")]
    pub kind: String,
    pub id: u64,
    pub revision: Option<u64>,
}

/// The changes since the host took them last: the changed slices and the effects on handles, in order
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ChangeSet {
    pub changes: Vec<SliceChange>,
    pub effects: Vec<HandleEffect>,
}

/// The kind of the computation slices
const COMPUTATION: &str = "computation";

/// The runtime of DashQL, see the module
#[wasm_bindgen]
pub struct Runtime {
    platform: JsPlatform,
    computations: ComputeService<JsPlatform>,
    /// The revisions of the computations that the host took
    taken: RefCell<BTreeMap<TableId, u64>>,
}

impl Runtime {
    /// Take the effects of an outcome and tell the host
    fn settle(&self, outcome: dashql_core::error::Result<ComputationOutcome>) -> DispatchOutcome {
        match outcome {
            Ok(outcome) => {
                self.platform.push_effects(&outcome.effects);
                if outcome.changed || !outcome.effects.is_empty() {
                    self.platform.signal(true);
                }
                DispatchOutcome { ok: true, changed: outcome.changed, error: None }
            }
            Err(error) => DispatchOutcome { ok: false, changed: false, error: Some(error.message) },
        }
    }

    fn computation_ids(ids: &JsValue) -> Result<Vec<TableId>, JsError> {
        if !Array::is_array(ids) {
            return Err(JsError::new("the ids of the views are no array"));
        }
        Array::from(ids)
            .iter()
            .map(|id| match id.as_f64() {
                Some(id) if id >= 0.0 && id.fract() == 0.0 && id <= 9_007_199_254_740_991.0 => Ok(id as TableId),
                _ => Err(JsError::new("the id of a computation is no integer")),
            })
            .collect()
    }
}

#[wasm_bindgen]
impl Runtime {
    /// A runtime on a platform
    pub fn create(platform: JsRuntimePlatform) -> Runtime {
        let platform = JsPlatform::new(platform);
        Runtime { computations: ComputeService::new(platform.clone()), platform, taken: RefCell::new(BTreeMap::new()) }
    }

    /// The slices that changed and the effects on handles since the last call
    #[wasm_bindgen(js_name = takeChanges)]
    pub fn take_changes(&self) -> Result<Ts<ChangeSet>, JsError> {
        let effects = self.platform.take_effects();
        let mut changes = Vec::new();
        let current: BTreeMap<TableId, u64> =
            self.computations.read(|state| state.computations().map(|(id, computation)| (id, computation.revision())).collect());
        {
            let mut taken = self.taken.borrow_mut();
            for (id, revision) in &current {
                if taken.get(id) != Some(revision) {
                    changes.push(SliceChange { kind: COMPUTATION.into(), id: *id, revision: Some(*revision) });
                }
            }
            for id in taken.keys() {
                if !current.contains_key(id) {
                    changes.push(SliceChange { kind: COMPUTATION.into(), id: *id, revision: None });
                }
            }
            *taken = current;
        }
        to_js(&ChangeSet { changes, effects })
    }

    /// The views of slices, see the declaration of `views` in `RuntimeViews`
    #[wasm_bindgen(skip_typescript)]
    pub fn views(&self, kind: &str, ids: JsValue, _known: JsValue) -> Result<JsValue, JsError> {
        match kind {
            COMPUTATION => {
                let ids = Self::computation_ids(&ids)?;
                let views: Vec<Option<ComputationView>> =
                    self.computations.read(|state| ids.iter().map(|id| state.computation(*id).map(ComputationView::from)).collect());
                value_to_js(&views).map_err(|e| JsError::new(&e.to_string()))
            }
            _ => Err(JsError::new(&format!("the runtime has no views of the kind {kind}"))),
        }
    }

    /// Apply an action to a slice
    pub fn dispatch(&self, target: Ts<Target>, action: Ts<RuntimeAction>) -> Result<Ts<DispatchOutcome>, JsError> {
        let target = from_js(&target)?;
        let action = from_js(&action)?;
        let Target::Computation(table_id) = target;
        let service = &self.computations;
        let outcome = match action {
            RuntimeAction::DeleteComputation => self.settle(service.delete_computation(table_id)),
            RuntimeAction::OrderBy { constraints } => {
                self.settle(service.order_by(table_id, constraints.into_iter().map(OrderByConstraint::from).collect()))
            }
            RuntimeAction::HistogramFilter { column_group, selection } => self.settle(service.histogram_filter(table_id, column_group, selection)),
            RuntimeAction::MostFrequentValueFilter { column_group, value_id } => {
                self.settle(service.most_frequent_value_filter(table_id, column_group, value_id))
            }
            RuntimeAction::ClearCrossFilters => self.settle(service.clear_cross_filters(table_id)),
            RuntimeAction::SetResultSearchPattern { search, pattern } => self.settle(service.set_search_pattern(table_id, search.into(), pattern)),
            RuntimeAction::RequestFilteredColumnAggregation { column_group } => {
                let requested = service.request_filtered_column_aggregation(table_id, column_group).map(|_| ComputationOutcome::default());
                self.settle(requested)
            }
        };
        to_js(&outcome)
    }

    /// Analyze a result as the computation of a table: its import into the compute database, the statistics, the
    /// system columns, the summaries of the columns and the ordering of the options. The result is a table of the
    /// handle table, the computation takes its handle; an analysis that starts no computation releases it. Resolves
    /// once the analysis is done, rejects with the error of a failed task.
    #[wasm_bindgen(js_name = analyzeTable, unchecked_return_type = "Promise<void>")]
    pub fn analyze_table(&self, table_id: f64, table: f64, options: Ts<AnalyzeTableOptions>) -> Result<Promise, JsError> {
        let options = from_js(&options)?;
        let id = |value: f64, what: &str| {
            if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= u32::MAX as f64 {
                Ok(value)
            } else {
                Err(JsError::new(&format!("the {what} is no integer")))
            }
        };
        let table_id = id(table_id, "table id")? as TableId;
        let table = id(table, "table handle")? as u32;
        let ipc = self.platform.read_table(table).map_err(|e| JsError::new(&e.to_string()))?;
        let result = ResultTable::from_ipc_stream(&ipc).map_err(|e| JsError::new(&e.message))?;
        let lifetime = self.platform.register(&lifetime_token()).map_err(|e| JsError::new(&e.to_string()))?;
        let handles = AnalysisHandles { table, lifetime };
        let analyze_options = RuntimeAnalyzeOptions { column_aggregates: options.column_aggregates.unwrap_or(true) };
        let analysis =
            self.computations.analyze_table(table_id, result, handles, options.connection_id, options.client_context, analyze_options);
        let ordering: Vec<OrderByConstraint> = options.ordering.unwrap_or_default().into_iter().map(OrderByConstraint::from).collect();
        let order = (!ordering.is_empty()).then(|| self.computations.order_by_and_wait(table_id, ordering));
        Ok(future_to_promise(async move {
            analysis.await.map_err(task_error)?;
            if let Some(order) = order {
                order.await.map_err(task_error)?;
            }
            Ok(JsValue::UNDEFINED)
        }))
    }

    /// Stop the runtime: the computations go, their runs are cancelled, their tables released with the next changes
    pub fn destroy(&self) {
        let ids: Vec<TableId> = self.computations.read(|state| state.computations().map(|(id, _)| id).collect());
        for id in ids {
            let deleted = self.computations.delete_computation(id);
            self.settle(deleted);
        }
    }
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}
