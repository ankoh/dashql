//! The views of the scripts of a workbook: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`)
//! with TypeScript declarations in the generated `.d.ts` (`tsify`). See docs/design/dashql_core.md.
//!
//! The workbook lists its scripts with their revisions, a script crosses with its plain fields and its payloads: the
//! editor update, the staged diff, the visualization and the processing statistics, each a packed FlatBuffer with a
//! key. A payload crosses only when its key differs from the one that the host holds.

use dashql_core_runtime::attachments::{DataFile, WorkbookAttachment};
use dashql_core_runtime::workbook::{
    ExternalChanges, TextChange, WorkbookDefaultView as CoreDefaultView, WorkbookOrigin, WorkbookScript,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::editor_update_key;
use crate::runtime::storage::restore_view::RestoredInvalidWorkbook;
use crate::views::{FlatBufferBytes, JsonValue};

/// The view that a workbook opens in
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookDefaultView {
    Feed,
    Dashboard,
    Dataflow,
}

impl From<CoreDefaultView> for WorkbookDefaultView {
    fn from(view: CoreDefaultView) -> Self {
        match view {
            CoreDefaultView::Feed => WorkbookDefaultView::Feed,
            CoreDefaultView::Dashboard => WorkbookDefaultView::Dashboard,
            CoreDefaultView::Dataflow => WorkbookDefaultView::Dataflow,
        }
    }
}

impl From<WorkbookDefaultView> for CoreDefaultView {
    fn from(view: WorkbookDefaultView) -> Self {
        match view {
            WorkbookDefaultView::Feed => CoreDefaultView::Feed,
            WorkbookDefaultView::Dashboard => CoreDefaultView::Dashboard,
            WorkbookDefaultView::Dataflow => CoreDefaultView::Dataflow,
        }
    }
}

/// The published workbook of a cloud that a workbook came from or was published to: the origin of the workbook in
/// DashQL, a preview is a read-only workbook
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookCloudLink {
    pub workbook_id: String,
    pub version_id: String,
    pub preview: bool,
}

impl WorkbookCloudLink {
    /// The link to a cloud of an origin, none for an origin that names no published workbook and version
    pub fn of(origin: &WorkbookOrigin) -> Option<Self> {
        let text = |key: &str| origin.link.get(key).and_then(serde_json::Value::as_str).map(str::to_string);
        Some(WorkbookCloudLink {
            workbook_id: text("workbookId")?,
            version_id: text("versionId")?,
            preview: origin.read_only,
        })
    }

    /// The origin of a workbook that a link to a cloud names, none without its ids
    pub fn origin(link: &serde_json::Value) -> Option<WorkbookOrigin> {
        let ids = link.get("workbookId").and_then(serde_json::Value::as_str).is_some()
            && link.get("versionId").and_then(serde_json::Value::as_str).is_some();
        let read_only = link.get("preview").and_then(serde_json::Value::as_bool).unwrap_or(false);
        ids.then(|| WorkbookOrigin { link: link.clone(), read_only })
    }
}

/// A data file of a workbook as storage lists it
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookDataFile {
    pub name: String,
    pub size_bytes: f64,
    /// The time of the last modification, 0 without one
    #[serde(default)]
    #[tsify(optional)]
    pub mtime_ms: Option<f64>,
}

impl From<WorkbookDataFile> for DataFile {
    fn from(file: WorkbookDataFile) -> Self {
        DataFile {
            name: file.name,
            size_bytes: file.size_bytes.max(0.0) as u64,
            mtime_ms: file.mtime_ms.unwrap_or(0.0).max(0.0) as u64,
        }
    }
}

/// An attachment of a workbook
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookAttachmentView {
    pub file_name: String,
    pub name: String,
    pub size_bytes: u64,
    pub mtime_ms: u64,
    pub columns: Option<Vec<String>>,
}

impl From<&WorkbookAttachment> for WorkbookAttachmentView {
    fn from(a: &WorkbookAttachment) -> Self {
        WorkbookAttachmentView {
            file_name: a.file_name.clone(),
            name: a.name.clone(),
            size_bytes: a.size_bytes,
            mtime_ms: a.mtime_ms,
            columns: a.columns.as_ref().map(|columns| columns.iter().map(|c| c.to_string()).collect()),
        }
    }
}

/// A workbook: its plain fields and its scripts in feed order. It lists the keys of its scripts, not their revisions:
/// a change of a script changes the slice of the script and leaves the workbook alone.
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookView {
    pub workbook_id: String,
    pub name: Option<String>,
    /// The view that the workbook opens in
    pub default_view: WorkbookDefaultView,
    /// The metadata of the workbook file: the origin, whether it is ephemeral, the whole link to a cloud
    pub workbook_metadata: JsonValue,
    pub ephemeral: bool,
    /// The connection of the next appended script when no script determines it
    pub pending_connection_id: Option<String>,
    pub cloud: Option<WorkbookCloudLink>,
    /// Null until storage listed the files of the workbook
    pub attachments: Option<Vec<WorkbookAttachmentView>>,
    /// The keys of the scripts in feed order
    pub script_keys: Vec<u32>,
    /// The file names of the scripts in feed order
    pub script_order: Vec<String>,
    /// The connections of the scripts in feed order
    pub script_connections: Vec<String>,
    /// The connections that the workbook uses: of its scripts in the order they first use them, then the pending one
    pub connection_ids: Vec<String>,
    /// The connection that an appended script runs on, the one that `createScript` without a connection takes
    pub next_script_connection_id: Option<String>,
}

/// A workbook of the list of the workbooks
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookListEntry {
    pub workbook_id: String,
    pub name: Option<String>,
    pub ephemeral: bool,
}

/// The workbooks in the order they were registered and the workbooks that were refused a load
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookListView {
    pub workbooks: Vec<WorkbookListEntry>,
    pub invalid_workbooks: Vec<RestoredInvalidWorkbook>,
    /// The name of a new workbook: the first of "Untitled", "Untitled 2", ... that no other workbook has
    pub next_workbook_name: String,
}

/// The placement of a script on the dataflow canvas, its `@flow` tag
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookFlowPosition {
    pub statement_id: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

/// The dashboard placement of a script, the `@board` tag of its last statement
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookBoardPosition {
    pub statement_id: u32,
    pub row: Option<i32>,
    pub column: Option<i32>,
    pub width: i32,
    pub height: i32,
}

/// What the views read of the analysis of a script: its tables, its positions on the canvas and the board, whether its
/// last statement is a query and whether it runs only on request. Empty without an analysis.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptAnnotations {
    /// The names of the tables that the script defines, sorted
    pub table_defs: Vec<String>,
    pub flow_position: Option<WorkbookFlowPosition>,
    pub board_position: Option<WorkbookBoardPosition>,
    /// The last statement, the one that a chart of the script shows unless a tag names another
    pub last_statement_id: Option<u32>,
    pub last_statement_is_query: bool,
    pub manual: bool,
}

impl WorkbookScriptAnnotations {
    /// The annotations of an editor update
    pub fn of(update: Option<&dashql_buffers::editor::EditorUpdateT>) -> Self {
        let Some(annotations) =
            update.filter(|update| update.analysis_available).and_then(|update| update.script_annotations.as_deref())
        else {
            return Self::default();
        };
        let mut table_defs: Vec<String> =
            annotations.table_definitions.iter().flatten().filter_map(|table| table.name.clone()).collect();
        table_defs.sort();
        let last = annotations.statements.iter().flatten().max_by_key(|statement| statement.statement_id);
        WorkbookScriptAnnotations {
            table_defs,
            flow_position: annotations.flow_position.as_deref().map(|flow| WorkbookFlowPosition {
                statement_id: flow.statement_id,
                x: flow.x,
                y: flow.y,
                width: flow.width,
                height: flow.height,
            }),
            board_position: annotations.board_position.as_deref().map(|board| WorkbookBoardPosition {
                statement_id: board.statement_id,
                row: board.row,
                column: board.column,
                width: board.width,
                height: board.height,
            }),
            last_statement_id: last.map(|statement| statement.statement_id),
            last_statement_is_query: last
                .is_some_and(|statement| statement.statement_type == dashql_buffers::parser::StatementType::SELECT),
            manual: annotations.manual,
        }
    }
}

/// What the runtime derives from the scripts of a workbook with the planner: the checked script references, the
/// dataflow and the inputs. The text spans are in the offset unit of the editors.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookDerivedView {
    pub workbook_id: String,
    /// The keys of the scripts in the order of the derived buffers, the feed order
    pub script_keys: Vec<u32>,
    /// The file names of the scripts in the order of the derived buffers, the references name scripts by index
    pub script_files: Vec<String>,
    /// The file names of the attachments in the order that the references name them by index
    pub attachments: Vec<String>,
    #[tsify(type = "FlatBuffer<buffers_execution.ScriptReferenceCheck>")]
    pub references: FlatBufferBytes,
    #[tsify(type = "FlatBuffer<buffers_execution.SessionDataflow>")]
    pub dataflow: FlatBufferBytes,
    #[tsify(type = "FlatBuffer<buffers_execution.SessionInputs>")]
    pub inputs: FlatBufferBytes,
    /// The hashes of the references, the dataflow and the inputs: a buffer with the hash of the previous view has its
    /// bytes
    pub hashes: [String; 3],
}

/// A change of the text of a script in the offset unit of the editors
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookTextChange {
    pub from: u64,
    pub to: u64,
    pub insert: String,
}

impl From<&TextChange> for WorkbookTextChange {
    fn from(change: &TextChange) -> Self {
        WorkbookTextChange { from: change.from, to: change.to, insert: change.insert.clone() }
    }
}

/// The last change of the text of a script that the workbook made
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookExternalChanges {
    pub from_text: String,
    pub changes: Vec<WorkbookTextChange>,
}

impl From<&ExternalChanges> for WorkbookExternalChanges {
    fn from(external: &ExternalChanges) -> Self {
        WorkbookExternalChanges {
            from_text: external.from_text.clone(),
            changes: external.changes.iter().map(WorkbookTextChange::from).collect(),
        }
    }
}

/// A staged rewrite of a script, the diff is null when the host holds the diff of the key
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookPendingDiff {
    pub key: u64,
    /// The text before the rewrite
    pub prior_text: String,
    #[tsify(type = "FlatBuffer<buffers_diff.ScriptDiff> | null")]
    pub diff: Option<FlatBufferBytes>,
}

/// The visualization of a script, the compiled visualization is null when the host holds the one of the key
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptVisualization {
    pub key: u64,
    /// The SQL of the query
    pub sql: String,
    /// The statement with the tags
    pub statement_id: u32,
    #[tsify(type = "FlatBuffer<buffers_execution.CompiledVisualization> | null")]
    pub visualization: Option<FlatBufferBytes>,
}

/// The processing statistics of an analysis, null when the host holds the ones of the key
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptStatistics {
    pub key: u64,
    #[tsify(type = "FlatBuffer<buffers_editor.EditorProcessingStatistics> | null")]
    pub statistics: Option<FlatBufferBytes>,
}

/// The keys of the payloads of a script that the host holds, the view leaves their bytes out
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptKeys {
    pub editor_update: Option<String>,
    pub pending_diff: Option<u64>,
    pub visualization: Option<u64>,
    /// The newest processing statistics, the host holds the older ones as well
    pub statistics: Option<u64>,
}

/// The stored result of a script: the file of its last result in the results of the workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookScriptStoredResult {
    /// The file name
    pub name: String,
    /// The key in the name of the file
    pub key: String,
    /// When the file was written, in milliseconds since the epoch
    pub written_at: f64,
    /// Is the key the key of the script as it is now? A result of another key is outdated, a run computes it anew.
    pub current: bool,
}

/// A script with its payloads
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct WorkbookScriptView {
    pub key: u32,
    /// The workbook of the script
    pub workbook_id: String,
    pub revision: u64,
    /// Names the session of the script, a script that moved to another connection has a new one. An editor event names
    /// it (`Runtime.applyEditorEvent`).
    pub session_generation: u64,
    pub file_name: String,
    pub connection_id: String,
    pub unresolved_connection_id: Option<String>,
    pub analysis_outdated: bool,
    pub latest_query_id: Option<u32>,
    pub latest_result_query_id: Option<u32>,
    /// The stored result of the script in the results of the workbook, null without one
    pub stored_result: Option<WorkbookScriptStoredResult>,
    pub external_changes: Option<WorkbookExternalChanges>,
    /// What the views read of the analysis
    pub annotations: WorkbookScriptAnnotations,
    /// Names the editor update: the generation of the session and a serial that is unique across the scripts of the
    /// runtime. An update with the same key is the same update. `Runtime.applyEditorEvent` returns the key of its update,
    /// an event names the key of the update that the editor holds.
    pub editor_update_key: Option<String>,
    #[tsify(type = "FlatBuffer<buffers_editor.EditorUpdate> | null")]
    pub editor_update: Option<FlatBufferBytes>,
    pub pending_diff: Option<WorkbookPendingDiff>,
    pub visualization: Option<WorkbookScriptVisualization>,
    /// The processing statistics of the latest analyses, the oldest first
    pub statistics: Vec<WorkbookScriptStatistics>,
}

impl WorkbookScriptView {
    /// The view of a script with the payloads whose keys the host doesn't hold
    pub fn new(workbook_id: &str, script: &WorkbookScript, known: &WorkbookScriptKeys) -> Self {
        let update = script.editor_update();
        let editor_update_key = editor_update_key(script);
        let editor_update = match (update, &editor_update_key) {
            (Some(update), Some(key)) if Some(key) != known.editor_update.as_ref() => {
                Some(FlatBufferBytes(finish!(update)))
            }
            _ => None,
        };
        let pending_diff = script.pending_diff().map(|pending| WorkbookPendingDiff {
            key: pending.revision,
            prior_text: pending.prior_text.clone(),
            diff: (known.pending_diff != Some(pending.revision)).then(|| FlatBufferBytes(finish!(pending.diff))),
        });
        let visualization_key = script.visualization_revision();
        let visualization = script.visualization().map(|v| WorkbookScriptVisualization {
            key: visualization_key,
            sql: v.sql.clone(),
            statement_id: v.statement_id,
            visualization: (known.visualization != Some(visualization_key))
                .then(|| FlatBufferBytes(finish!(v.visualization))),
        });
        let statistics = script
            .statistics_with_revisions()
            .map(|(key, statistics)| WorkbookScriptStatistics {
                key,
                statistics: known
                    .statistics
                    .is_none_or(|newest| key > newest)
                    .then(|| FlatBufferBytes(finish!(statistics))),
            })
            .collect();
        WorkbookScriptView {
            key: script.key(),
            workbook_id: workbook_id.to_string(),
            revision: script.revision(),
            session_generation: script.session_generation(),
            file_name: script.file_name().to_string(),
            connection_id: script.connection().connection_id.clone(),
            unresolved_connection_id: script.unresolved_connection_id().map(str::to_string),
            analysis_outdated: script.is_analysis_outdated(),
            latest_query_id: script.latest_query_id(),
            latest_result_query_id: script.latest_result_query_id(),
            stored_result: script.stored_result().map(|stored| WorkbookScriptStoredResult {
                name: stored.name.clone(),
                key: stored.key.clone(),
                written_at: stored.written_at,
                current: stored.current,
            }),
            external_changes: script.external_changes().map(WorkbookExternalChanges::from),
            annotations: WorkbookScriptAnnotations::of(update),
            editor_update_key,
            editor_update,
            pending_diff,
            visualization,
            statistics,
        }
    }
}

/// A script as storage holds it, on a connection of the runtime
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StoredScriptView {
    pub name: String,
    pub sql: String,
    pub connection_id: String,
    /// The connection that the workbook file names for the script while the app doesn't know it
    #[serde(default)]
    #[tsify(optional)]
    pub unresolved_connection_id: Option<String>,
}

/// The update of an editor event for the editor, with its key (`WorkbookScriptView.editorUpdateKey`)
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct EditorEventOutcome {
    #[tsify(type = "FlatBuffer<buffers_editor.EditorUpdate>")]
    pub update: FlatBufferBytes,
    /// Names the update, the next event of the editor names it as the update that the editor holds
    pub key: String,
}
