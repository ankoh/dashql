//! The wasm-bindgen API of the scripts of a workbook (`dashql_core_runtime::workbook`).
//!
//! An action is a method call with typed arguments. It returns a `WorkbookOutcome` with the effects for the host as
//! JSON, the host writes the files. The state is read per script: a snapshot of the plain fields as JSON, the editor
//! update, the staged diff and the visualization as packed FlatBuffers, and the session as a `ScriptSession` that
//! shares the session of the workbook. A script changes its revision with every change, the host reads only the
//! scripts whose revision moved.

use std::cell::{Ref, RefCell, RefMut};
use std::rc::Rc;
use std::sync::Arc;

use dashql_buffers::editor::{EditorEvent, EditorOffsetUnit, EditorUpdate};
use dashql_buffers::execution::CompiledVisualization;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::error::Error;
use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::workbook::{
    CloudLink, ScriptConnection, ScriptKey, ScriptList, ScriptVisualization, StoredScript, TextChange, Workbook as RuntimeWorkbook,
    WorkbookAction, WorkbookEffect, WorkbookOutcome as RuntimeOutcome, WorkbookScript,
};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use super::{js_error, Catalog, ScriptSession, SharedCatalog};

mod view;

/// A connection from the arguments of the JS API
#[allow(clippy::too_many_arguments)]
pub(crate) fn connection(
    connection_id: &str,
    catalog: &Catalog,
    dialect: u8,
    local: bool,
    params: Option<String>,
    default_database: &str,
    default_schema: &str,
) -> Rc<ScriptConnection> {
    Rc::new(ScriptConnection {
        connection_id: connection_id.to_string(),
        catalog: catalog.inner.0.clone(),
        dialect: FormattingDialect(dialect),
        local,
        params,
        default_database: default_database.to_string(),
        default_schema: default_schema.to_string(),
    })
}

/// The data files of a listing from the arguments of the JS API
fn data_files(names: Vec<String>, sizes: &[f64], mtimes: &[f64]) -> Result<Vec<DataFile>, JsError> {
    if names.len() != sizes.len() || names.len() != mtimes.len() {
        return Err(js_error(Error::invalid_argument("the data files need a size and a time each")));
    }
    Ok(names
        .into_iter()
        .zip(sizes.iter().zip(mtimes))
        .map(|(name, (size, mtime))| DataFile { name, size_bytes: *size as u64, mtime_ms: *mtime as u64 })
        .collect())
}

fn script_list_json(list: &ScriptList) -> Value {
    json!({
        "scripts": list.scripts.iter().map(|s| json!({ "name": s.name, "connectionId": s.connection_id })).collect::<Vec<_>>(),
        "connections": list.connections.iter().map(|c| json!({ "connectionId": c.connection_id, "params": c.params })).collect::<Vec<_>>(),
    })
}

fn cloud_json(cloud: Option<&CloudLink>) -> Value {
    match cloud {
        Some(cloud) => json!({ "workbookId": cloud.workbook_id, "versionId": cloud.version_id, "preview": cloud.preview }),
        None => Value::Null,
    }
}

fn effect_json(effect: &WorkbookEffect) -> Value {
    match effect {
        WorkbookEffect::WriteScript { file_name, text } => json!({ "type": "writeScript", "fileName": file_name, "text": text }),
        WorkbookEffect::DeleteScript { file_name } => json!({ "type": "deleteScript", "fileName": file_name }),
        WorkbookEffect::RenameScript { from, to } => json!({ "type": "renameScript", "from": from, "to": to }),
        WorkbookEffect::WriteScriptList(list) => json!({ "type": "writeScriptList", "list": script_list_json(list) }),
        WorkbookEffect::WriteProperties { name, ephemeral, cloud } => {
            json!({ "type": "writeProperties", "name": name, "ephemeral": ephemeral, "cloud": cloud_json(cloud.as_ref()) })
        }
        WorkbookEffect::PatchConnection { connection_id, params, replaces } => {
            json!({ "type": "patchConnection", "connectionId": connection_id, "params": params, "replaces": replaces })
        }
    }
}

fn text_changes_json(changes: &[TextChange]) -> Value {
    Value::Array(changes.iter().map(|c| json!({ "from": c.from, "to": c.to, "insert": c.insert })).collect())
}

/// The key of an editor update: its versions, its status and whether it holds an analysis
fn editor_update_key(update: &dashql_buffers::editor::EditorUpdateT) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        update.text_version, update.state_revision, update.catalog_revision, update.status.0, update.analysis_available
    )
}

/// The plain fields of a script
fn script_json(script: &WorkbookScript) -> Value {
    let visualization = script.visualization();
    json!({
        "key": script.key(),
        // Identifies the session: a script that moved to another connection has a new one
        "sessionId": Rc::as_ptr(script.session()) as usize,
        "fileName": script.file_name(),
        "revision": script.revision(),
        "connectionId": script.connection().connection_id,
        "unresolvedConnectionId": script.unresolved_connection_id(),
        "analysisOutdated": script.analysis_outdated(),
        // Names the editor update, an update with the same key is the same analysis
        "editorUpdateKey": script.editor_update().map(editor_update_key),
        "latestQueryId": script.latest_query_id(),
        "latestResultQueryId": script.latest_result_query_id(),
        "pendingDiffPriorText": script.pending_diff().map(|diff| diff.prior_text.as_str()),
        "externalChanges": script.external_changes().map(|external| json!({
            "fromText": external.from_text,
            "changes": text_changes_json(&external.changes),
        })),
        "visualizationSql": visualization.map(|v| v.sql.as_str()),
        "visualizationStatementId": visualization.map(|v| v.statement_id),
    })
}

/// What an action did: whether it changed the workbook, the effects for the host as JSON, and the update of an
/// editor event as packed `EditorUpdate`
#[wasm_bindgen]
pub struct WorkbookOutcome {
    changed: bool,
    effects: String,
    editor_update: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl WorkbookOutcome {
    /// Did the action change the workbook?
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    /// The effects as a JSON array, in order
    #[wasm_bindgen(getter)]
    pub fn effects(&self) -> String {
        self.effects.clone()
    }

    /// The packed `EditorUpdate` of an editor event
    #[wasm_bindgen(js_name = editorUpdate)]
    pub fn editor_update(&self) -> Option<Vec<u8>> {
        self.editor_update.clone()
    }
}

impl From<RuntimeOutcome> for WorkbookOutcome {
    fn from(outcome: RuntimeOutcome) -> Self {
        let effects = Value::Array(outcome.effects.iter().map(effect_json).collect()).to_string();
        let editor_update = outcome.editor_update.map(|update| finish!(update));
        WorkbookOutcome { changed: outcome.changed, effects, editor_update }
    }
}

/// The scripts of a workbook
#[wasm_bindgen]
pub struct Workbook {
    /// The workbook, shared with its runs (`workbook_run.rs`)
    pub(crate) inner: Rc<RefCell<RuntimeWorkbook>>,
    /// The scripts of storage that `replaceFromStorage` and `matchesStoredScripts` take
    stored: Vec<StoredScript>,
}

impl Workbook {
    /// A workbook that a service of the runtime created, e.g. the restore
    pub(crate) fn from_runtime(inner: RuntimeWorkbook) -> Workbook {
        Workbook { inner: Rc::new(RefCell::new(inner)), stored: Vec::new() }
    }

    /// The workbook. A run borrows it only between its awaits, a borrow that fails is an error instead of a panic.
    pub(crate) fn get(&self) -> Result<Ref<'_, RuntimeWorkbook>, JsError> {
        self.inner.try_borrow().map_err(|_| js_error(Error::invalid_argument("the workbook is busy")))
    }

    pub(crate) fn get_mut(&self) -> Result<RefMut<'_, RuntimeWorkbook>, JsError> {
        self.inner.try_borrow_mut().map_err(|_| js_error(Error::invalid_argument("the workbook is busy")))
    }

    fn apply(&mut self, action: WorkbookAction) -> Result<WorkbookOutcome, JsError> {
        self.get_mut()?.apply(action).map(WorkbookOutcome::from).map_err(js_error)
    }

    /// Read a script
    fn with_script<R>(&self, key: ScriptKey, read: impl FnOnce(&WorkbookScript) -> R) -> Result<R, JsError> {
        let workbook = self.get()?;
        let script = workbook.script(key).ok_or_else(|| js_error(Error::invalid_argument("unknown script")))?;
        Ok(read(script))
    }
}

#[wasm_bindgen]
impl Workbook {
    /// An empty workbook, the editors count offsets in `offset_unit`
    #[wasm_bindgen(constructor)]
    pub fn new(id: &str, name: Option<String>, offset_unit: u8) -> Workbook {
        Workbook::from_runtime(RuntimeWorkbook::new(id, name, None, EditorOffsetUnit(offset_unit)))
    }

    // Restoring a workbook from storage

    /// Set the pending connection that storage holds
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setStoredPendingConnection)]
    pub fn set_stored_pending_connection(
        &mut self,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<(), JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.get_mut()?.set_stored_pending_connection(Some(connection));
        Ok(())
    }

    /// Mark the workbook as the ephemeral workbook of the greeter
    #[wasm_bindgen(js_name = setEphemeral)]
    pub fn set_ephemeral(&mut self, ephemeral: bool) -> Result<(), JsError> {
        self.get_mut()?.set_ephemeral(ephemeral);
        Ok(())
    }

    /// Set the link to a cloud that storage holds, none without a workbook id
    #[wasm_bindgen(js_name = setStoredCloudLink)]
    pub fn set_stored_cloud_link(&mut self, workbook_id: Option<String>, version_id: String, preview: bool) -> Result<(), JsError> {
        self.get_mut()?.set_stored_cloud_link(workbook_id.map(|workbook_id| CloudLink { workbook_id, version_id, preview }));
        Ok(())
    }

    /// Add a script that storage holds, returns its key
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = addStoredScript)]
    pub fn add_stored_script(
        &mut self,
        file_name: &str,
        text: &str,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
        unresolved_connection_id: Option<String>,
    ) -> Result<u32, JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.get_mut()?.add_stored_script(file_name, text, connection, unresolved_connection_id).map_err(js_error)
    }

    /// Set the attachments that storage lists
    #[wasm_bindgen(js_name = setStoredAttachments)]
    pub fn set_stored_attachments(&mut self, names: Vec<String>, sizes: &[f64], mtimes: &[f64]) -> Result<(), JsError> {
        let files = data_files(names, sizes, mtimes)?;
        self.get_mut()?.set_stored_attachments(&files);
        Ok(())
    }

    /// Add a script that storage holds to the scripts that `replaceFromStorage` and `matchesStoredScripts` take
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = stageStoredScript)]
    pub fn stage_stored_script(
        &mut self,
        name: &str,
        sql: &str,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
        unresolved_connection_id: Option<String>,
    ) {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.stored.push(StoredScript { name: name.to_string(), sql: sql.to_string(), connection, unresolved_connection_id });
    }

    /// Does storage hold the scripts as they are? Takes the staged scripts.
    #[wasm_bindgen(js_name = matchesStoredScripts)]
    pub fn matches_stored_scripts(&mut self) -> Result<bool, JsError> {
        let stored = std::mem::take(&mut self.stored);
        Ok(self.get()?.matches_stored_scripts(&stored))
    }

    /// Replace the scripts with the staged scripts of storage, returns whether anything changed
    #[wasm_bindgen(js_name = replaceFromStorage)]
    pub fn replace_from_storage(&mut self) -> Result<bool, JsError> {
        let stored = std::mem::take(&mut self.stored);
        self.get_mut()?.replace_from_storage(stored).map_err(js_error)
    }

    /// Promote an ephemeral workbook with scripts to a full workbook with a name that no other workbook has
    pub fn promote(&mut self, taken_names: Vec<String>) -> Result<WorkbookOutcome, JsError> {
        let effect = self.get_mut()?.promote(taken_names.iter().map(String::as_str));
        let outcome = RuntimeOutcome { changed: effect.is_some(), effects: effect.into_iter().collect(), editor_update: None };
        Ok(outcome.into())
    }

    // Actions

    /// Create a script at an index of the feed, appended without one, on the connection of its neighbors
    #[wasm_bindgen(js_name = createScript)]
    pub fn create_script(&mut self, index: Option<u32>, text: Option<String>, base: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::CreateScript { index: index.map(|i| i as usize), text, base, connection: None })
    }

    /// Create a script on a connection
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = createScriptOn)]
    pub fn create_script_on(
        &mut self,
        index: Option<u32>,
        text: Option<String>,
        base: String,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<WorkbookOutcome, JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::CreateScript { index: index.map(|i| i as usize), text, base, connection: Some(connection) })
    }

    #[wasm_bindgen(js_name = deleteScript)]
    pub fn delete_script(&mut self, file_name: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::DeleteScript { file_name })
    }

    #[wasm_bindgen(js_name = renameScript)]
    pub fn rename_script(&mut self, file_name: String, new_name: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RenameScript { file_name, new_name })
    }

    #[wasm_bindgen(js_name = reorderScripts)]
    pub fn reorder_scripts(&mut self, order: Vec<String>) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::ReorderScripts { order })
    }

    #[wasm_bindgen(js_name = setScriptText)]
    pub fn set_script_text(&mut self, key: u32, text: String, with_diff: bool) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::SetScriptText { key, text, with_diff })
    }

    #[wasm_bindgen(js_name = acceptPendingDiff)]
    pub fn accept_pending_diff(&mut self, key: u32) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::AcceptPendingDiff { key })
    }

    #[wasm_bindgen(js_name = rejectPendingDiff)]
    pub fn reject_pending_diff(&mut self, key: u32) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RejectPendingDiff { key })
    }

    #[wasm_bindgen(js_name = setScriptVisSpec)]
    pub fn set_script_vis_spec(&mut self, key: u32, spec: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::SetScriptVisSpec { key, spec })
    }

    #[wasm_bindgen(js_name = setWorkbookInput)]
    pub fn set_workbook_input(&mut self, name: String, literal: String, keys: Vec<u32>) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::SetWorkbookInput { name, literal, keys })
    }

    /// Apply a packed `EditorEvent` of the editor of a script, the outcome holds the packed `EditorUpdate`
    #[wasm_bindgen(js_name = applyEditorEvent)]
    pub fn apply_editor_event(&mut self, key: u32, event: &[u8]) -> Result<WorkbookOutcome, JsError> {
        let event = flatbuffers::root::<EditorEvent>(event).map_err(|_| js_error(Error::invalid_argument("invalid editor event")))?.unpack();
        self.apply(WorkbookAction::ApplyEditorEvent { key, event })
    }

    /// Report a packed `EditorUpdate` of an event that an editor applied to the shared session of a script itself
    #[wasm_bindgen(js_name = reportEditorUpdate)]
    pub fn report_editor_update(&mut self, key: u32, update: &[u8], accepts_diff: bool) -> Result<WorkbookOutcome, JsError> {
        let update = flatbuffers::root::<EditorUpdate>(update).map_err(|_| js_error(Error::invalid_argument("invalid editor update")))?.unpack();
        self.apply(WorkbookAction::ReportEditorUpdate { key, update, accepts_diff })
    }

    #[wasm_bindgen(js_name = analyzeOutdatedScript)]
    pub fn analyze_outdated_script(&mut self, key: u32) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::AnalyzeOutdatedScript { key })
    }

    #[wasm_bindgen(js_name = catalogDidUpdate)]
    pub fn catalog_did_update(&mut self, connection_id: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::CatalogDidUpdate { connection_id })
    }

    /// The visualization that a run captured, a packed `CompiledVisualization`, none removes it
    #[wasm_bindgen(js_name = setExecutionVisualization)]
    pub fn set_execution_visualization(
        &mut self,
        key: u32,
        sql: Option<String>,
        statement_id: u32,
        visualization: Option<Vec<u8>>,
    ) -> Result<WorkbookOutcome, JsError> {
        let visualization = match (sql, visualization) {
            (Some(sql), Some(packed)) => {
                let visualization = flatbuffers::root::<CompiledVisualization>(&packed)
                    .map_err(|_| js_error(Error::invalid_argument("invalid visualization")))?
                    .unpack();
                Some(ScriptVisualization { sql, statement_id, visualization })
            }
            _ => None,
        };
        self.apply(WorkbookAction::SetExecutionVisualization { key, visualization })
    }

    #[wasm_bindgen(js_name = registerQuery)]
    pub fn register_query(&mut self, key: u32, query_id: u32) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RegisterQuery { key, query_id })
    }

    #[wasm_bindgen(js_name = registerScriptResult)]
    pub fn register_script_result(&mut self, key: u32, query_id: u32) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RegisterScriptResult { key, query_id })
    }

    #[wasm_bindgen(js_name = renameWorkbook)]
    pub fn rename_workbook(&mut self, name: Option<String>) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RenameWorkbook { name })
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setScriptConnection)]
    pub fn set_script_connection(
        &mut self,
        file_name: String,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<WorkbookOutcome, JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::SetScriptConnection { file_name, connection })
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setPendingConnection)]
    pub fn set_pending_connection(
        &mut self,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<WorkbookOutcome, JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::SetPendingConnection { connection })
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = replaceConnection)]
    pub fn replace_connection(
        &mut self,
        from: String,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<WorkbookOutcome, JsError> {
        let into = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::ReplaceConnection { from, into })
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = detachConnection)]
    pub fn detach_connection(
        &mut self,
        from: String,
        connection_id: &str,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<WorkbookOutcome, JsError> {
        let into = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::DetachConnection { from, into })
    }

    #[wasm_bindgen(js_name = setWorkbookAttachments)]
    pub fn set_workbook_attachments(&mut self, names: Vec<String>, sizes: &[f64], mtimes: &[f64]) -> Result<WorkbookOutcome, JsError> {
        let files = data_files(names, sizes, mtimes)?;
        self.apply(WorkbookAction::SetWorkbookAttachments { files })
    }

    #[wasm_bindgen(js_name = setAttachmentColumns)]
    pub fn set_attachment_columns(&mut self, file_name: String, stamp: String, columns: Vec<String>) -> Result<WorkbookOutcome, JsError> {
        let columns = columns.into_iter().map(Arc::<str>::from).collect();
        self.apply(WorkbookAction::SetAttachmentColumns { file_name, stamp, columns })
    }

    #[wasm_bindgen(js_name = renameAttachment)]
    pub fn rename_attachment(&mut self, file_name: String, new_file_name: String) -> Result<WorkbookOutcome, JsError> {
        self.apply(WorkbookAction::RenameAttachment { file_name, new_file_name })
    }

    /// Link the workbook to a published workbook, none without a workbook id
    #[wasm_bindgen(js_name = setCloudLink)]
    pub fn set_cloud_link(&mut self, workbook_id: Option<String>, version_id: String, preview: bool) -> Result<WorkbookOutcome, JsError> {
        let link = workbook_id.map(|workbook_id| CloudLink { workbook_id, version_id, preview });
        self.apply(WorkbookAction::SetCloudLink { link })
    }

    /// Give the table parameters of the workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    #[wasm_bindgen(js_name = attachTableParameters)]
    pub fn attach_table_parameters(&self, session: &ScriptSession) -> Result<bool, JsError> {
        let mut session = session.inner.try_borrow_mut().map_err(|_| js_error(Error::invalid_argument("the session is busy")))?;
        Ok(self.get()?.attach_table_parameters(&mut session))
    }

    // Reading the state

    /// The revision of the workbook, it changes with every change
    pub fn revision(&self) -> Result<f64, JsError> {
        Ok(self.get()?.revision() as f64)
    }

    /// The plain fields of the workbook as JSON: the name, whether it is ephemeral, the pending connection, the cloud
    /// link, the attachments and the script list of the workbook file
    pub fn properties(&self) -> Result<String, JsError> {
        let workbook = self.get()?;
        let attachments = workbook.attachments().map(|attachments| {
            attachments
                .iter()
                .map(|a| json!({
                    "fileName": a.file_name,
                    "name": a.name,
                    "sizeBytes": a.size_bytes,
                    "mtimeMs": a.mtime_ms,
                    "columns": a.columns.as_ref().map(|columns| columns.iter().map(|c| c.as_ref()).collect::<Vec<&str>>()),
                }))
                .collect::<Vec<_>>()
        });
        Ok(json!({
            "name": workbook.name(),
            "ephemeral": workbook.ephemeral(),
            "pendingConnectionId": workbook.pending_connection().map(|c| c.connection_id.as_str()),
            "cloud": cloud_json(workbook.cloud()),
            "attachments": attachments,
            "scriptList": script_list_json(&workbook.script_list()),
        })
        .to_string())
    }

    /// The keys of the scripts in feed order
    #[wasm_bindgen(js_name = scriptKeys)]
    pub fn script_keys(&self) -> Result<Vec<u32>, JsError> {
        Ok(self.get()?.scripts().iter().map(WorkbookScript::key).collect())
    }

    /// The revision of a script
    #[wasm_bindgen(js_name = scriptRevision)]
    pub fn script_revision(&self, key: u32) -> Result<f64, JsError> {
        self.with_script(key, |script| script.revision() as f64)
    }

    /// The plain fields of a script as JSON
    #[wasm_bindgen(js_name = scriptSnapshot)]
    pub fn script_snapshot(&self, key: u32) -> Result<String, JsError> {
        self.with_script(key, |script| script_json(script).to_string())
    }

    /// Is the analysis of a script outdated, also by a change that the workbook missed?
    #[wasm_bindgen(js_name = isAnalysisOutdated)]
    pub fn is_analysis_outdated(&self, key: u32) -> Result<bool, JsError> {
        self.with_script(key, WorkbookScript::is_analysis_outdated)
    }

    /// The session of a script, shared with the workbook
    #[wasm_bindgen(js_name = scriptSession)]
    pub fn script_session(&self, key: u32) -> Result<ScriptSession, JsError> {
        self.with_script(key, |script| ScriptSession { catalog: SharedCatalog(script.connection().catalog.clone()), inner: script.session().clone() })
    }

    /// The latest analysis of a script, a packed `EditorUpdate`
    #[wasm_bindgen(js_name = scriptEditorUpdate)]
    pub fn script_editor_update(&self, key: u32) -> Result<Option<Vec<u8>>, JsError> {
        self.with_script(key, |script| script.editor_update().map(|update| finish!(update)))
    }

    /// The diff of the staged rewrite of a script, a packed `ScriptDiff`
    #[wasm_bindgen(js_name = scriptPendingDiff)]
    pub fn script_pending_diff(&self, key: u32) -> Result<Option<Vec<u8>>, JsError> {
        self.with_script(key, |script| script.pending_diff().map(|pending| finish!(pending.diff)))
    }

    /// The visualization of a script, a packed `CompiledVisualization`
    #[wasm_bindgen(js_name = scriptVisualization)]
    pub fn script_visualization(&self, key: u32) -> Result<Option<Vec<u8>>, JsError> {
        self.with_script(key, |script| script.visualization().map(|visualization| finish!(visualization.visualization)))
    }

    /// The processing statistics of the latest analyses of a script, the oldest first, each a packed
    /// `EditorProcessingStatistics`
    #[wasm_bindgen(js_name = scriptStatistics)]
    pub fn script_statistics(&self, key: u32, index: u32) -> Result<Option<Vec<u8>>, JsError> {
        self.with_script(key, |script| script.statistics().nth(index as usize).map(|statistics| finish!(statistics)))
    }
}
