//! The actions of the runtime, one union per target (docs/design/dashql_runtime.md#dispatch). An action changes the
//! state in the call and returns its outcome; a failed action leaves the state as it was. `dispatch` reads the action
//! with the union of its target, an action of another target is malformed there.

use serde::Deserialize;
use tsify::Tsify;

use super::computation::{ComputationOrderBy, ComputationSearchKind};
use super::workbooks::view::{WorkbookDataFile, WorkbookDefaultView};
use crate::runtime::connections::view::{ConnectionTableName, ConnectorType, JsonParams};
use crate::views::JsonValue;

/// The actions of a computation of a result table (`{ computation: tableId }`)
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationAction {
    /// Delete the computation, its runs are cancelled and its tables released
    DeleteComputation,
    /// Order the rows, an empty ordering clears it
    OrderBy { constraints: Vec<ComputationOrderBy> },
    /// Select a range of bins of the histogram of a column group, null clears the selection of the column
    HistogramFilter { column_group: u32, selection: Option<(f64, f64)> },
    /// Select a frequent value of a column group by its id. Without toggle the value replaces the selection, the value
    /// selected alone again clears it. With toggle (a click with Shift, Ctrl or Cmd) the value joins the selection or
    /// leaves it, several values filter with `IN`. Null clears the selection.
    MostFrequentValueFilter {
        column_group: u32,
        value_id: Option<i64>,
        #[serde(default)]
        #[tsify(optional)]
        toggle: Option<bool>,
    },
    /// Clear the selections of all column groups
    ClearCrossFilters,
    /// Search the columns or the data, an empty pattern ends the search
    SetResultSearchPattern { search: ComputationSearchKind, pattern: String },
    /// Summarize a column group over the selected rows if its summary is outdated, e.g. once it shows
    RequestFilteredColumnAggregation { column_group: u32 },
}

/// The actions of the runtime itself (`'app'`): the lists of the connections and the workbooks
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum AppAction {
    /// Create a connection with an empty catalog, the outcome names its id. An active connection is written into the
    /// app manifest right away.
    CreateConnection {
        /// The id, a new one without
        #[serde(default)]
        #[tsify(optional)]
        connection_id: Option<String>,
        #[tsify(type = "ConnectorType")]
        connector_type: ConnectorType,
        /// The params of the connector that the details of the setup start with
        #[serde(default)]
        #[tsify(optional)]
        setup_params: Option<JsonParams>,
        /// Does the connection belong to a committed workbook or was it connected once?
        #[serde(default)]
        #[tsify(optional)]
        active: Option<bool>,
        /// The params, the setup params by default
        #[serde(default)]
        #[tsify(optional)]
        params: Option<JsonParams>,
        #[serde(default)]
        #[tsify(optional)]
        params_draft: Option<JsonParams>,
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
    },
    /// Create a workbook without scripts on a connection and write it, the outcome names its id
    CreateWorkbook {
        /// The id, a new one without
        #[serde(default)]
        #[tsify(optional)]
        workbook_id: Option<String>,
        /// The connection of its first script
        connection_id: String,
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
        /// Is it the ephemeral workbook of the greeter? Its first script promotes it.
        #[serde(default)]
        #[tsify(optional)]
        ephemeral: Option<bool>,
        /// The file name the workbook is created from, e.g. the short name of its connector
        #[serde(default)]
        #[tsify(optional)]
        original_file_name: Option<String>,
    },
    /// Drop a workbook, its scripts leave the catalogs of their connections. Its files stay.
    DeleteWorkbook { workbook_id: String },
}

/// The actions of a workbook and its scripts (`{ workbook: id }`)
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum WorkbookAction {
    /// Create a script at an index of the feed, appended without one. The base names its file, the connection is the
    /// one of its neighbors without one.
    CreateScript {
        #[serde(default)]
        #[tsify(optional)]
        index: Option<u32>,
        #[serde(default)]
        #[tsify(optional)]
        text: Option<String>,
        base: String,
        #[serde(default)]
        #[tsify(optional)]
        connection_id: Option<String>,
    },
    DeleteScript {
        file_name: String,
    },
    /// Rename a script, the name is a display name
    RenameScript {
        file_name: String,
        new_name: String,
    },
    /// Order the scripts by their file names
    ReorderScripts {
        order: Vec<String>,
    },
    /// Replace the text of a script, with a diff the rewrite is staged to accept or reject unless the script is blank
    SetScriptText {
        script_key: u32,
        text: String,
        #[serde(default)]
        #[tsify(optional)]
        with_diff: Option<bool>,
    },
    AcceptPendingDiff {
        script_key: u32,
    },
    RejectPendingDiff {
        script_key: u32,
    },
    /// Set the Vega-Lite spec of the chart of a script
    SetScriptVisSpec {
        script_key: u32,
        spec: String,
    },
    /// Set the value of an input in the scripts that use it
    SetWorkbookInput {
        name: String,
        literal: String,
        script_keys: Vec<u32>,
    },
    /// Analyze a script if its analysis is outdated
    AnalyzeOutdatedScript {
        script_key: u32,
    },
    /// An editor shows a script, the selected one or not: its outdated analysis runs right away when it is selected,
    /// once the changes pause otherwise
    ShowScript {
        script_key: u32,
        selected: bool,
    },
    /// An editor no longer shows a script, with the selection of its `showScript`
    HideScript {
        script_key: u32,
        selected: bool,
    },
    /// Rename the workbook, null removes the name
    RenameWorkbook {
        #[serde(default)]
        #[tsify(optional)]
        name: Option<String>,
    },
    /// Pick the view that the workbook opens in, e.g. its dashboard for the people it is shared with
    SetDefaultView {
        view: WorkbookDefaultView,
    },
    /// Move a script to another connection
    SetScriptConnection {
        file_name: String,
        connection_id: String,
    },
    /// Pick the connection of the next appended script
    SetPendingConnection {
        connection_id: String,
    },
    /// Move the scripts and the pending connection on one connection to another
    ReplaceConnection {
        from: String,
        into: String,
    },
    /// Let go of a connection that only the next script would use
    DetachConnection {
        from: String,
        into: String,
    },
    /// The data files of the workbook as storage lists them
    SetWorkbookAttachments {
        files: Vec<WorkbookDataFile>,
    },

    /// Link the workbook to a published workbook, the whole link is written into the workbook file, null removes it
    SetCloudLink {
        #[serde(default)]
        #[tsify(optional)]
        link: Option<JsonValue>,
    },
}

/// The actions of a connection (`{ connection: id }`)
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ConnectionAction {
    /// Set the draft of the params, params of another connector are ignored
    SetDraft { params: JsonParams },
    /// Drop the draft and the errors of the last setup
    DiscardDraft,
    /// Rename the connection, a blank name removes the name
    Rename { name: String },
    /// Stop the connection and drop it with its catalog. A connection that workbooks use is never deleted.
    DeleteConnection,
    /// Stop the connection and clear its catalog and queries
    ResetConnection,
    /// Statements that the host ran on the connection itself touched relations, e.g. those of the shell. The names have
    /// nulls for the parts that a statement left out.
    RelationsTouched { names: Vec<ConnectionTableName> },
}
