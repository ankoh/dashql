//! The wasm-bindgen API of the scripts of a workbook (`dashql_core_runtime::workbook`).
//!
//! An action is a method call with typed arguments. It returns a `WorkbookOutcome` view with the effects for the
//! host, the host writes the files. The state is read as views (`view.rs`): the workbook with its scripts and their
//! revisions, and a script with its payloads, which cross as packed FlatBuffers when the host doesn't hold their keys.
//! The session of a script is a `ScriptSession` that shares the session of the workbook. A script changes its revision
//! with every change, the host reads only the scripts whose revision moved.

use std::cell::{Ref, RefCell, RefMut};
use std::rc::Rc;
use std::sync::Arc;

use dashql_buffers::editor::{EditorEvent, EditorOffsetUnit, EditorUpdate};
use dashql_buffers::execution::CompiledVisualization;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::error::Error;
use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::workbook::{
    ScriptConnection, ScriptKey, ScriptVisualization, StoredScript, Workbook as RuntimeWorkbook, WorkbookAction,
    WorkbookOutcome as RuntimeOutcome, WorkbookScript,
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use super::{js_error, Catalog, ScriptSession, SharedCatalog};

mod view;

use view::{WorkbookCloudLink, WorkbookDataFile, WorkbookOutcome, WorkbookScriptKeys, WorkbookScriptView, WorkbookView};

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

/// A view as a JS object
fn js<T: Tsify + serde::Serialize>(view: &T) -> Result<Ts<T>, JsError> {
    Ok(Ts::from_rust(view)?)
}

/// The data files that the host handed over
fn data_files(files: Vec<Ts<WorkbookDataFile>>) -> Result<Vec<DataFile>, JsError> {
    files.iter().map(|file| Ok(file.to_rust()?.into())).collect()
}

/// The link to a cloud that the host handed over
fn cloud_link(link: Option<Ts<WorkbookCloudLink>>) -> Result<Option<dashql_core_runtime::workbook::CloudLink>, JsError> {
    Ok(link.map(|link| link.to_rust()).transpose()?.map(Into::into))
}

/// The key of an editor update: its versions, its status and whether it holds an analysis
fn editor_update_key(update: &dashql_buffers::editor::EditorUpdateT) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        update.text_version, update.state_revision, update.catalog_revision, update.status.0, update.analysis_available
    )
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

    fn apply(&mut self, action: WorkbookAction) -> Result<Ts<WorkbookOutcome>, JsError> {
        let outcome = self.get_mut()?.apply(action).map_err(js_error)?;
        js(&WorkbookOutcome::from(outcome))
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

    /// Set the link to a cloud that storage holds
    #[wasm_bindgen(js_name = setStoredCloudLink)]
    pub fn set_stored_cloud_link(&mut self, link: Option<Ts<WorkbookCloudLink>>) -> Result<(), JsError> {
        let link = cloud_link(link)?;
        self.get_mut()?.set_stored_cloud_link(link);
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
    pub fn set_stored_attachments(&mut self, files: Vec<Ts<WorkbookDataFile>>) -> Result<(), JsError> {
        let files = data_files(files)?;
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
    pub fn promote(&mut self, taken_names: Vec<String>) -> Result<Ts<WorkbookOutcome>, JsError> {
        let effect = self.get_mut()?.promote(taken_names.iter().map(String::as_str));
        let outcome = RuntimeOutcome { changed: effect.is_some(), effects: effect.into_iter().collect(), editor_update: None };
        js(&WorkbookOutcome::from(outcome))
    }

    // Actions

    /// Create a script at an index of the feed, appended without one, on the connection of its neighbors
    #[wasm_bindgen(js_name = createScript)]
    pub fn create_script(&mut self, index: Option<u32>, text: Option<String>, base: String) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
        let connection = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::CreateScript { index: index.map(|i| i as usize), text, base, connection: Some(connection) })
    }

    #[wasm_bindgen(js_name = deleteScript)]
    pub fn delete_script(&mut self, file_name: String) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::DeleteScript { file_name })
    }

    #[wasm_bindgen(js_name = renameScript)]
    pub fn rename_script(&mut self, file_name: String, new_name: String) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::RenameScript { file_name, new_name })
    }

    #[wasm_bindgen(js_name = reorderScripts)]
    pub fn reorder_scripts(&mut self, order: Vec<String>) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::ReorderScripts { order })
    }

    #[wasm_bindgen(js_name = setScriptText)]
    pub fn set_script_text(&mut self, key: u32, text: String, with_diff: bool) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::SetScriptText { key, text, with_diff })
    }

    #[wasm_bindgen(js_name = acceptPendingDiff)]
    pub fn accept_pending_diff(&mut self, key: u32) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::AcceptPendingDiff { key })
    }

    #[wasm_bindgen(js_name = rejectPendingDiff)]
    pub fn reject_pending_diff(&mut self, key: u32) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::RejectPendingDiff { key })
    }

    #[wasm_bindgen(js_name = setScriptVisSpec)]
    pub fn set_script_vis_spec(&mut self, key: u32, spec: String) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::SetScriptVisSpec { key, spec })
    }

    #[wasm_bindgen(js_name = setWorkbookInput)]
    pub fn set_workbook_input(&mut self, name: String, literal: String, keys: Vec<u32>) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::SetWorkbookInput { name, literal, keys })
    }

    /// Apply a packed `EditorEvent` of the editor of a script, the outcome holds the packed `EditorUpdate`
    #[wasm_bindgen(js_name = applyEditorEvent)]
    pub fn apply_editor_event(&mut self, key: u32, event: &[u8]) -> Result<Ts<WorkbookOutcome>, JsError> {
        let event = flatbuffers::root::<EditorEvent>(event).map_err(|_| js_error(Error::invalid_argument("invalid editor event")))?.unpack();
        self.apply(WorkbookAction::ApplyEditorEvent { key, event })
    }

    /// Report a packed `EditorUpdate` of an event that an editor applied to the shared session of a script itself
    #[wasm_bindgen(js_name = reportEditorUpdate)]
    pub fn report_editor_update(&mut self, key: u32, update: &[u8], accepts_diff: bool) -> Result<Ts<WorkbookOutcome>, JsError> {
        let update = flatbuffers::root::<EditorUpdate>(update).map_err(|_| js_error(Error::invalid_argument("invalid editor update")))?.unpack();
        self.apply(WorkbookAction::ReportEditorUpdate { key, update, accepts_diff })
    }

    #[wasm_bindgen(js_name = analyzeOutdatedScript)]
    pub fn analyze_outdated_script(&mut self, key: u32) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::AnalyzeOutdatedScript { key })
    }

    #[wasm_bindgen(js_name = catalogDidUpdate)]
    pub fn catalog_did_update(&mut self, connection_id: String) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    pub fn register_query(&mut self, key: u32, query_id: u32) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::RegisterQuery { key, query_id })
    }

    #[wasm_bindgen(js_name = registerScriptResult)]
    pub fn register_script_result(&mut self, key: u32, query_id: u32) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::RegisterScriptResult { key, query_id })
    }

    #[wasm_bindgen(js_name = renameWorkbook)]
    pub fn rename_workbook(&mut self, name: Option<String>) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
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
    ) -> Result<Ts<WorkbookOutcome>, JsError> {
        let into = connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        self.apply(WorkbookAction::DetachConnection { from, into })
    }

    #[wasm_bindgen(js_name = setWorkbookAttachments)]
    pub fn set_workbook_attachments(&mut self, files: Vec<Ts<WorkbookDataFile>>) -> Result<Ts<WorkbookOutcome>, JsError> {
        let files = data_files(files)?;
        self.apply(WorkbookAction::SetWorkbookAttachments { files })
    }

    #[wasm_bindgen(js_name = setAttachmentColumns)]
    pub fn set_attachment_columns(&mut self, file_name: String, stamp: String, columns: Vec<String>) -> Result<Ts<WorkbookOutcome>, JsError> {
        let columns = columns.into_iter().map(Arc::<str>::from).collect();
        self.apply(WorkbookAction::SetAttachmentColumns { file_name, stamp, columns })
    }

    #[wasm_bindgen(js_name = renameAttachment)]
    pub fn rename_attachment(&mut self, file_name: String, new_file_name: String) -> Result<Ts<WorkbookOutcome>, JsError> {
        self.apply(WorkbookAction::RenameAttachment { file_name, new_file_name })
    }

    /// Link the workbook to a published workbook, none removes the link
    #[wasm_bindgen(js_name = setCloudLink)]
    pub fn set_cloud_link(&mut self, link: Option<Ts<WorkbookCloudLink>>) -> Result<Ts<WorkbookOutcome>, JsError> {
        let link = cloud_link(link)?;
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

    /// The view of the workbook: the name, whether it is ephemeral, the pending connection, the cloud link, the
    /// attachments, the script list of the workbook file and the scripts in feed order with their revisions
    pub fn view(&self) -> Result<Ts<WorkbookView>, JsError> {
        let workbook = self.get()?;
        js(&WorkbookView {
            revision: workbook.revision(),
            name: workbook.name().map(str::to_string),
            ephemeral: workbook.ephemeral(),
            pending_connection_id: workbook.pending_connection().map(|c| c.connection_id.clone()),
            cloud: workbook.cloud().map(WorkbookCloudLink::from),
            attachments: workbook.attachments().map(|attachments| attachments.iter().map(Into::into).collect()),
            script_list: workbook.script_list().into(),
            scripts: workbook.scripts().iter().map(|script| (script.key(), script.revision())).collect(),
        })
    }

    /// The view of a script, with the payloads whose keys aren't the `known` ones
    #[wasm_bindgen(js_name = scriptView)]
    pub fn script_view(&self, key: u32, known: Ts<WorkbookScriptKeys>) -> Result<Ts<WorkbookScriptView>, JsError> {
        let known = known.to_rust()?;
        let view = self.with_script(key, |script| WorkbookScriptView::new(script, &known))?;
        js(&view)
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
}
