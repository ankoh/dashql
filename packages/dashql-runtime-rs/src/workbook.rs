//! The scripts of a workbook and the actions on them.
//!
//! A workbook owns the script sessions of its scripts. A script is analyzed against the catalog of its connection and
//! publishes its declarations into that catalog, the other scripts of the catalog then resolve against them. An action
//! changes the workbook in place and returns the effects that the host applies afterwards, e.g. the files to write.
//! Dropping a script drops its session, nothing has to be freed by hand.
//!
//! Ported from `reduceWorkbookScripts` of `packages/dashql-runtime/src/workbook/scripts/workbook_scripts.ts`.

use std::cell::{Ref, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use dashql_buffers::diff::ScriptDiffT;
use dashql_buffers::execution::{CompiledVisualizationT, ScriptCompilationStatementKind};
use dashql_buffers::editor::{
    EditorEventOrigin, EditorEventT, EditorOffsetUnit, EditorProcessingStatisticsT, EditorUpdateStatus, EditorUpdateT,
};
use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer};
use dashql_core::error::{Error, Result};
use dashql_core::analyzer::AnalyzedScript;
use dashql_core::script::Script;
use dashql_core::table_parameters::{TableParameterAttachment, TableParameters};
use dashql_core::utils::quote_identifier;
use dashql_core::vis_rewrite::VisRenderer;
use dashql_core_session::planner::{ConnectionKind, PlanScope, PlannerAttachment, PlannerConnection, PlannerScript, SessionPlanRequest};
use dashql_core_session::script_references::check_script_references;
use dashql_core_session::script_session::ScriptSession;

use crate::attachments::{attachment_parameter_name, read_workbook_attachments, DataFile, WorkbookAttachment};
use crate::names::{free_workbook_name, script_display_name, script_file_name, unique_script_base};

/// The key of a script, its entry in the catalog of its connection. A script keeps its key when it moves to another
/// connection.
pub type ScriptKey = CatalogEntryId;

/// A catalog that the scripts of a connection share
pub type CatalogHandle = Rc<RefCell<Catalog>>;

/// The connection that a script is analyzed and executed with
#[derive(Debug)]
pub struct ScriptConnection {
    /// The id of the connection
    pub connection_id: String,
    /// The catalog of the connection, the scripts publish their declarations into it
    pub catalog: CatalogHandle,
    /// The dialect that the queries of the scripts are compiled to
    pub dialect: FormattingDialect,
    /// Is the connection the embedded Hyper, which scans the results of scripts of other connections?
    pub local: bool,
    /// The params of the connection as the workbook file holds a copy of them, opaque JSON
    pub params: Option<String>,
    /// The database of relations without a database name
    pub default_database: String,
    /// The schema of relations without a schema name
    pub default_schema: String,
}

/// What a table parameter reads, by file name: a script or an attachment
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReferenceTarget<'a> {
    Script(&'a str),
    Attachment(&'a str),
}

/// The directory that the embedded Hyper mounts the attachments of the workbooks in, one folder per workbook
const ATTACHMENT_MOUNT_ROOT: &str = "/mnt/external/attachments";

/// How many processing statistics a script keeps
const STATISTICS_HISTORY_LIMIT: usize = 20;

/// The published workbook of a cloud that a workbook came from or was published to
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudLink {
    /// The published workbook
    pub workbook_id: String,
    /// The version of it
    pub version_id: String,
    /// Is the workbook a read-only look at the version? Its scripts can't be changed, importing it turns it into a
    /// workbook of its own.
    pub preview: bool,
}

/// A script as storage holds it
pub struct StoredScript {
    /// The file name
    pub name: String,
    /// The text
    pub sql: String,
    /// The connection
    pub connection: Rc<ScriptConnection>,
    /// The connection that the workbook file names for the script while the app doesn't know it
    pub unresolved_connection_id: Option<String>,
}

impl Drop for WorkbookScript {
    fn drop(&mut self) {
        self.leave_catalog();
    }
}

/// A staged rewrite of a script, shown as a diff to accept or reject. The script already holds the new text.
#[derive(Debug, Clone)]
pub struct PendingDiff {
    /// The text before the rewrite, rejecting the rewrite restores it
    pub prior_text: String,
    /// The statement diff from the prior text to the new text
    pub diff: ScriptDiffT,
}

/// A change of the text of a script, in the offset unit of the editors
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChange {
    /// The start of the replaced range
    pub from: u64,
    /// The end of the replaced range
    pub to: u64,
    /// The inserted text
    pub insert: String,
}

/// The last change of a script that the workbook made, e.g. the value of an input. An editor that shows `from_text`
/// applies the changes instead of replacing its text, it keeps its cursor and history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalChanges {
    /// The text that the changes apply to
    pub from_text: String,
    /// The changes
    pub changes: Vec<TextChange>,
}

/// The length of a text in an offset unit
fn text_length(text: &str, unit: EditorOffsetUnit) -> u64 {
    if unit == EditorOffsetUnit::UTF16_CODE_UNITS {
        text.encode_utf16().count() as u64
    } else {
        text.len() as u64
    }
}

/// The change from one text to another: the range between their common prefix and suffix
pub fn text_change(from: &str, to: &str, unit: EditorOffsetUnit) -> TextChange {
    let prefix: usize = from.chars().zip(to.chars()).take_while(|(a, b)| a == b).map(|(c, _)| c.len_utf8()).sum();
    let max_suffix = from.len().min(to.len()) - prefix;
    let suffix: usize =
        from.chars().rev().zip(to.chars().rev()).take_while(|(a, b)| a == b).map(|(c, _)| c.len_utf8()).sum::<usize>();
    // The suffix doesn't overlap the prefix, both end on character boundaries of both texts
    let mut suffix = suffix.min(max_suffix);
    while !from.is_char_boundary(from.len() - suffix) || !to.is_char_boundary(to.len() - suffix) {
        suffix -= 1;
    }
    let start = text_length(&from[..prefix], unit);
    TextChange {
        from: start,
        to: start + text_length(&from[prefix..from.len() - suffix], unit),
        insert: to[prefix..to.len() - suffix].to_string(),
    }
}

/// The formatting of the queries that a chart compiles to
fn chart_compilation_config() -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect::HYPER;
    config.mode = FormattingMode::INLINE;
    config.max_width = 120;
    config.indentation_width = 2;
    config
}

/// A statement id that the compiler returns for none
const NO_STATEMENT: u32 = u32::MAX;

/// The next revision. Revisions of all workbooks, scripts, connections and queries come from one counter: a script that replaces another
/// under its key, e.g. one that moved to another connection, never shows a revision of the script it replaced.
pub(crate) fn next_revision() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// The visualization of a script: its last statement is a query with a renderer tag (`@vis`)
#[derive(Debug, Clone, PartialEq)]
pub struct ScriptVisualization {
    /// The SQL of the query in the dialect of the connection
    pub sql: String,
    /// The statement with the tags
    pub statement_id: u32,
    /// The renderer and its spec
    pub visualization: CompiledVisualizationT,
}

/// The formatting of the queries that a script compiles to in the dialect of its connection
fn execution_compilation_config(dialect: FormattingDialect) -> FormattingConfigT {
    let mut config = chart_compilation_config();
    config.dialect = dialect;
    config
}

/// The editor session of a script. The workbook shares it with the handles of the host, e.g. an editor that applies
/// its events to the session directly until it reports them to the workbook. Calls into the workbook never overlap, a
/// borrow ends with the call that took it.
pub type SessionHandle = Rc<RefCell<ScriptSession>>;

/// A script of a workbook
pub struct WorkbookScript {
    /// The key of the script
    key: ScriptKey,
    /// The file name of the script, `<name>.sql`
    file_name: String,
    /// The editor session of the script
    session: SessionHandle,
    /// The connection the script runs on
    connection: Rc<ScriptConnection>,
    /// The latest analysis, also the one of a failed analysis
    editor_update: Option<EditorUpdateT>,
    /// Must the script be analyzed again, e.g. because another script of its catalog changed?
    analysis_outdated: bool,
    /// A staged rewrite to accept or reject
    pending_diff: Option<PendingDiff>,
    /// The last change of the text that the workbook made
    external_changes: Option<ExternalChanges>,
    /// The visualization of the script, compiled with its analysis or captured by its last run
    visualization: Option<ScriptVisualization>,
    /// The processing statistics of the latest analyses, the oldest first
    statistics: std::collections::VecDeque<EditorProcessingStatisticsT>,
    /// The latest query of the script
    latest_query_id: Option<u32>,
    /// The query whose result the script shows, independent of later queries that failed
    latest_result_query_id: Option<u32>,
    /// The connection that the workbook file names for the script while the app doesn't know it
    unresolved_connection_id: Option<String>,
    /// The revision of the script, it changes with every change of the script
    revision: u64,
}

impl WorkbookScript {
    pub fn key(&self) -> ScriptKey {
        self.key
    }
    pub fn file_name(&self) -> &str {
        &self.file_name
    }
    pub fn session(&self) -> &SessionHandle {
        &self.session
    }
    pub fn connection(&self) -> &Rc<ScriptConnection> {
        &self.connection
    }
    pub fn editor_update(&self) -> Option<&EditorUpdateT> {
        self.editor_update.as_ref()
    }
    pub fn analysis_outdated(&self) -> bool {
        self.analysis_outdated
    }
    pub fn pending_diff(&self) -> Option<&PendingDiff> {
        self.pending_diff.as_ref()
    }
    pub fn external_changes(&self) -> Option<&ExternalChanges> {
        self.external_changes.as_ref()
    }
    pub fn visualization(&self) -> Option<&ScriptVisualization> {
        self.visualization.as_ref()
    }
    pub fn statistics(&self) -> impl Iterator<Item = &EditorProcessingStatisticsT> {
        self.statistics.iter()
    }

    /// Record the processing statistics of an update that analyzed the script
    fn record_statistics(&mut self, update: &EditorUpdateT) {
        if !update.analysis_updated {
            return;
        }
        if let Some(statistics) = &update.processing_statistics {
            self.statistics.push_back((**statistics).clone());
            while self.statistics.len() > STATISTICS_HISTORY_LIMIT {
                self.statistics.pop_front();
            }
        }
    }

    /// Take the analysis of an update as the analysis of the script
    fn take_analysis(&mut self, update: EditorUpdateT) {
        self.record_statistics(&update);
        self.editor_update = Some(update);
        self.analysis_outdated = false;
        self.compile_visualization();
    }
    pub fn latest_query_id(&self) -> Option<u32> {
        self.latest_query_id
    }
    pub fn latest_result_query_id(&self) -> Option<u32> {
        self.latest_result_query_id
    }
    pub fn unresolved_connection_id(&self) -> Option<&str> {
        self.unresolved_connection_id.as_deref()
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Remove the declarations of the script from the catalog of its connection. Idempotent, a dropped script leaves
    /// its catalog as well. A borrowed catalog or session is left as it is instead of panicking.
    fn leave_catalog(&self) {
        if let (Ok(session), Ok(mut catalog)) = (self.session.try_borrow(), self.connection.catalog.try_borrow_mut()) {
            session.drop_from_catalog(&mut catalog);
        }
    }

    /// The text of the script
    pub fn text(&self) -> String {
        self.session.borrow().text()
    }

    /// The connection that the workbook file names for the script
    pub fn persisted_connection_id(&self) -> &str {
        self.unresolved_connection_id.as_deref().unwrap_or(&self.connection.connection_id)
    }

    /// Is the analysis outdated? The flag marks the changes that the workbook knows about, the versions also catch the
    /// ones it missed: the text or the catalog changed since the analysis.
    pub fn is_analysis_outdated(&self) -> bool {
        if self.analysis_outdated {
            return true;
        }
        match &self.editor_update {
            None => false,
            Some(update) => {
                update.text_version != self.session.borrow().text_version()
                    || update.catalog_revision != self.connection.catalog.borrow().version() as u64
            }
        }
    }

    /// Analyze the script and publish its declarations into the catalog of its connection. A failed analysis is kept
    /// on the script instead of returned: analyzing the same text against the same catalog fails again, and a change
    /// of either marks the script outdated.
    fn analyze(&mut self) {
        let update = self.session.borrow_mut().analyze(&self.connection.catalog.borrow());
        let published = update.status == EditorUpdateStatus::OK && update.analysis_available;
        self.take_analysis(update);
        if published {
            // Publishing fails only without an analysis, which was checked
            let _ = self.session.borrow_mut().load_into_catalog(&mut self.connection.catalog.borrow_mut(), CatalogLayer::SESSION);
        }
    }

    /// Compile the visualization of the script for its analysis, none without an analysis
    fn compile_visualization(&mut self) {
        let available = self.editor_update.as_ref().is_some_and(|update| update.analysis_available);
        self.visualization = if available {
            let config = execution_compilation_config(self.connection.dialect);
            let compiled = self.session.borrow_mut().compile_query(&self.connection.catalog.borrow(), &config, true, true);
            let valid = compiled.errors.as_ref().is_none_or(Vec::is_empty) && compiled.kind == ScriptCompilationStatementKind::VISUALIZE;
            match (valid, compiled.sql, compiled.visualization) {
                (true, Some(sql), Some(visualization)) if !sql.is_empty() => Some(ScriptVisualization {
                    sql,
                    statement_id: compiled.terminal_statement_id,
                    visualization: *visualization,
                }),
                _ => None,
            }
        } else {
            None
        };
    }

    /// Replace the text of the script
    fn replace_text(&mut self, text: &str) -> Result<()> {
        let catalog = self.connection.catalog.borrow();
        let mut session = self.session.borrow_mut();
        let text_version = session.text_version();
        let update = session.replace_text(&catalog, text_version, text);
        if update.status != EditorUpdateStatus::OK {
            return Err(Error::invalid_argument("cannot replace the text of the script"));
        }
        Ok(())
    }

    /// The statement that a chart of the script visualizes, the last statement. None without statements. Errors of
    /// the compilation, e.g. of other statements, don't matter, a rewrite of a tag refuses a script it can't parse.
    fn chart_statement_id(&mut self) -> Option<usize> {
        let compiled = self.session.borrow_mut().compile_query(&self.connection.catalog.borrow(), &chart_compilation_config(), true, true);
        (compiled.terminal_statement_id != NO_STATEMENT).then_some(compiled.terminal_statement_id as usize)
    }

    /// The diff of a staged rewrite from the text of the script to a new text. The new text is parsed in a catalog
    /// of its own, it never reaches the catalog of the workbook.
    fn diff_to(&mut self, text: &str) -> Result<ScriptDiffT> {
        let update = self.session.borrow_mut().analyze(&self.connection.catalog.borrow());
        if update.status != EditorUpdateStatus::OK || !update.analysis_available {
            return Err(Error::invalid_argument("cannot analyze the script for a diff"));
        }
        let catalog = Catalog::new();
        let mut target = Script::new(&catalog);
        target.replace_text(text);
        target.parse();
        self.session.borrow_mut().diff(&target)
    }
}

/// A script as the workbook file lists it: its name and the connection it names
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptListEntry {
    /// The file name of the script
    pub name: String,
    /// The connection that the file names for the script
    pub connection_id: String,
}

/// A copy of a connection that the workbook file holds
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionCopy {
    /// The id of the connection
    pub connection_id: String,
    /// The params of the connection, opaque JSON
    pub params: String,
}

/// The script list of the workbook file: the scripts in feed order and the copies of their connections
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptList {
    /// The scripts in feed order
    pub scripts: Vec<ScriptListEntry>,
    /// The copies of the connections, the pending connection of a workbook without scripts first
    pub connections: Vec<ConnectionCopy>,
}

/// What the host does after an action, in this order. The host decides how to batch the writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbookEffect {
    /// Write the text of a script
    WriteScript { file_name: String, text: String },
    /// Delete the file of a script
    DeleteScript { file_name: String },
    /// Rename the file of a script, its text is unchanged
    RenameScript { from: String, to: String },
    /// Write the script list of the workbook file
    WriteScriptList(ScriptList),
    /// Write the properties of the workbook file: its name, whether it is ephemeral and its link to a cloud
    WriteProperties { name: Option<String>, ephemeral: bool, cloud: Option<CloudLink> },
    /// Replace connections in the workbook file with another one
    PatchConnection { connection_id: String, params: Option<String>, replaces: Vec<String> },
}

/// An action on the scripts of a workbook
pub enum WorkbookAction {
    /// Create a script at an index of the feed, appended without one. The text seeds the script, the base names its
    /// file (made unique), the connection is the one of the neighbors without one.
    CreateScript { index: Option<usize>, text: Option<String>, base: String, connection: Option<Rc<ScriptConnection>> },
    /// Delete the script with a file name
    DeleteScript { file_name: String },
    /// Rename the script with a file name. The name is a display name, a `.sql` is dropped and the name is made unique.
    RenameScript { file_name: String, new_name: String },
    /// Order the scripts by their file names, scripts that the order leaves out follow in their order
    ReorderScripts { order: Vec<String> },
    /// Replace the text of a script and analyze it. With a diff, the rewrite is staged to accept or reject, together
    /// with a rewrite that is staged already: rejecting restores the text before both. A rewrite back to that text
    /// drops the diff.
    SetScriptText { key: ScriptKey, text: String, with_diff: bool },
    /// Keep the new text of a staged rewrite
    AcceptPendingDiff { key: ScriptKey },
    /// Restore the text before a staged rewrite
    RejectPendingDiff { key: ScriptKey },
    /// Set the Vega-Lite spec of the chart of a script, its `@vis vegalite` tag. Every edit restages the diff against
    /// the text before the first edit, the script shows the whole edit of the chart as one diff.
    SetScriptVisSpec { key: ScriptKey, spec: String },
    /// Set the value of an input in the scripts that use it, their `@param :name = <literal>` tags
    SetWorkbookInput { name: String, literal: String, keys: Vec<ScriptKey> },
    /// Apply an event of the editor of a script, e.g. a typed character or a moved cursor
    ApplyEditorEvent { key: ScriptKey, event: EditorEventT },
    /// The update of an event that an editor applied to the shared session of a script itself. `accepts_diff` drops a
    /// staged rewrite when the text changed, the editor accepted it with an edit of the user.
    ReportEditorUpdate { key: ScriptKey, update: EditorUpdateT, accepts_diff: bool },
    /// Analyze a script if its analysis is outdated
    AnalyzeOutdatedScript { key: ScriptKey },
    /// The catalog of a connection changed, its scripts must be analyzed again
    CatalogDidUpdate { connection_id: String },
    /// The visualization that a run of a script captured with its query, it replaces the compiled one
    SetExecutionVisualization { key: ScriptKey, visualization: Option<ScriptVisualization> },
    /// A query of a script started
    RegisterQuery { key: ScriptKey, query_id: u32 },
    /// A query of a script produced the result that the script shows. An older query never replaces a newer result.
    RegisterScriptResult { key: ScriptKey, query_id: u32 },
    /// Rename the workbook, an empty name removes the name
    RenameWorkbook { name: Option<String> },
    /// Move a script to another connection. It keeps its key, its text and its queries, and picking the connection it
    /// runs on replaces a reference to an unresolved connection.
    SetScriptConnection { file_name: String, connection: Rc<ScriptConnection> },
    /// Pick the connection of the next appended script, the scripts keep theirs. A connection without params can't be
    /// copied into the workbook file.
    SetPendingConnection { connection: Rc<ScriptConnection> },
    /// Move the scripts and the pending connection on one connection to another, e.g. when two connections merge
    ReplaceConnection { from: String, into: Rc<ScriptConnection> },
    /// Let go of a connection that only the next script would use. A workbook without scripts holds the other one.
    DetachConnection { from: String, into: Rc<ScriptConnection> },
    /// The data files of the workbook as storage lists them
    SetWorkbookAttachments { files: Vec<DataFile> },
    /// The columns of an attachment, read from the file with the stamp
    SetAttachmentColumns { file_name: String, stamp: String, columns: Vec<Arc<str>> },
    /// An attachment whose file was renamed, the scripts that read it read the new name
    RenameAttachment { file_name: String, new_file_name: String },
    /// The published workbook that the workbook is linked to, none removes the link. A link without `preview`
    /// imports a cloud preview.
    SetCloudLink { link: Option<CloudLink> },
    /// The analyses that the planner of a run made. An analysis of a text or a catalog that changed since is dropped,
    /// a moved cursor is projected again. The planner published the declarations already.
    ApplyPlannerAnalysis { updates: Vec<(ScriptKey, EditorUpdateT)> },
}

impl WorkbookAction {
    /// Does a cloud preview refuse the action? These change the scripts or the names of the workbook. Running scripts,
    /// inputs and the connections of the scripts stay, they don't change what the workbook says.
    fn changes_published_content(&self) -> bool {
        matches!(
            self,
            WorkbookAction::CreateScript { .. }
                | WorkbookAction::DeleteScript { .. }
                | WorkbookAction::RenameScript { .. }
                | WorkbookAction::ReorderScripts { .. }
                | WorkbookAction::SetScriptText { .. }
                | WorkbookAction::SetScriptVisSpec { .. }
                | WorkbookAction::AcceptPendingDiff { .. }
                | WorkbookAction::RenameWorkbook { .. }
                | WorkbookAction::RenameAttachment { .. }
                | WorkbookAction::SetWorkbookInput { .. }
                | WorkbookAction::SetScriptConnection { .. }
        )
    }
}

/// What an action did
#[derive(Debug, Default)]
pub struct WorkbookOutcome {
    /// Did the action change the workbook?
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<WorkbookEffect>,
    /// The update of an editor event, the editor projects it
    pub editor_update: Option<EditorUpdateT>,
}

/// The scripts of a workbook
pub struct Workbook {
    /// The id of the workbook
    id: String,
    /// The name of the workbook, independent of its connections
    name: Option<String>,
    /// Is the workbook the ephemeral workbook of the greeter?
    ephemeral: bool,
    /// The connection of the next appended script when no script determines it
    pending_connection: Option<Rc<ScriptConnection>>,
    /// The scripts in feed order
    scripts: Vec<WorkbookScript>,
    /// The attachments, none until storage listed the files of the workbook
    attachments: Option<Vec<WorkbookAttachment>>,
    /// The table parameters that the scripts read, derived from the scripts and the attachments
    table_parameters: Option<Arc<TableParameters>>,
    /// The published workbook of a cloud that the workbook came from or was published to
    cloud: Option<CloudLink>,
    /// The offset unit of the editors
    offset_unit: EditorOffsetUnit,
    /// The revision of the workbook, it changes with every change
    revision: u64,
}

impl Workbook {
    /// An empty workbook. A workbook without scripts has a pending connection, its first script runs on it.
    pub fn new(id: &str, name: Option<String>, pending_connection: Option<Rc<ScriptConnection>>, offset_unit: EditorOffsetUnit) -> Self {
        Self {
            id: id.to_string(),
            name,
            ephemeral: false,
            pending_connection,
            scripts: Vec::new(),
            attachments: None,
            table_parameters: None,
            cloud: None,
            offset_unit,
            revision: next_revision(),
        }
    }

    /// The published workbook of a cloud that the workbook came from or was published to
    pub fn cloud(&self) -> Option<&CloudLink> {
        self.cloud.as_ref()
    }

    /// Is the workbook a read-only look at a version of a published workbook?
    pub fn is_cloud_preview(&self) -> bool {
        self.cloud.as_ref().is_some_and(|cloud| cloud.preview)
    }

    /// Set the pending connection that storage holds when a workbook is restored, the connection of a workbook without
    /// scripts
    pub fn set_stored_pending_connection(&mut self, connection: Option<Rc<ScriptConnection>>) {
        self.pending_connection = connection;
        self.revision = next_revision();
    }

    /// Set the link to a cloud that storage holds when a workbook is restored
    pub fn set_stored_cloud_link(&mut self, link: Option<CloudLink>) {
        self.cloud = link;
        self.revision = next_revision();
    }

    /// Promote an ephemeral workbook with scripts to a full workbook: it drops the marker and takes a name that no
    /// other workbook has. Every path that adds a script ends here, the host calls it after an action.
    pub fn promote<'a>(&mut self, taken_names: impl IntoIterator<Item = &'a str>) -> Option<WorkbookEffect> {
        if !self.ephemeral || self.scripts.is_empty() {
            return None;
        }
        self.ephemeral = false;
        self.name = Some(free_workbook_name(taken_names));
        self.revision = next_revision();
        Some(self.properties_write())
    }

    /// Does storage hold the scripts of the workbook as they are: the same files in the same order, on the same
    /// connections, with the same texts?
    pub fn matches_stored_scripts(&self, stored: &[StoredScript]) -> bool {
        self.scripts.len() == stored.len()
            && self.scripts.iter().zip(stored).all(|(script, stored)| {
                script.file_name == stored.name
                    && script.connection.connection_id == stored.connection.connection_id
                    && script.persisted_connection_id() == stored.unresolved_connection_id.as_deref().unwrap_or(&stored.connection.connection_id)
                    && script.text() == stored.sql
            })
    }

    /// Replace the scripts with the ones that storage holds, e.g. after the files changed outside of the app. Writes
    /// nothing back. Scripts that stay at their file name on their connection keep their session and their queries, a
    /// script that moved to another connection keeps its key. Every new session is created before anything changes, a
    /// failure leaves the workbook as it is. Returns whether anything changed.
    pub fn replace_from_storage(&mut self, stored: Vec<StoredScript>) -> Result<bool> {
        // The first script of a name wins
        let mut unique: Vec<StoredScript> = Vec::with_capacity(stored.len());
        for script in stored {
            if !unique.iter().any(|other| other.name == script.name) {
                unique.push(script);
            }
        }
        // Create the sessions of added and moved scripts, nothing is dropped yet
        let mut created: Vec<Option<WorkbookScript>> = Vec::with_capacity(unique.len());
        for entry in &unique {
            let existing = self.scripts.iter().position(|script| script.file_name == entry.name);
            let script = match existing {
                Some(position) if self.scripts[position].connection.connection_id == entry.connection.connection_id => None,
                Some(position) => Some(self.moved_script(position, entry.connection.clone())?),
                None => Some(self.create_script(&entry.name, entry.connection.clone(), None)?),
            };
            let script = match script {
                Some(mut script) => {
                    script.replace_text(&entry.sql)?;
                    Some(script)
                }
                None => None,
            };
            created.push(script);
        }
        // Keep the scripts that stay, drop the replaced and removed ones from their catalogs
        let mut previous: Vec<Option<WorkbookScript>> = std::mem::take(&mut self.scripts).into_iter().map(Some).collect();
        let mut changed = false;
        // A failure from here on is reported once the workbook is whole again
        let mut failure = None;
        for (entry, created) in unique.into_iter().zip(created) {
            let existing = previous.iter().position(|script| script.as_ref().is_some_and(|script| script.file_name == entry.name));
            let existing = existing.and_then(|position| previous[position].take());
            let mut script = match (created, existing) {
                (Some(created), existing) => {
                    // A replaced script leaves its catalog when it drops
                    drop(existing);
                    changed = true;
                    created
                }
                (None, Some(mut existing)) => {
                    if existing.text() != entry.sql {
                        if let Err(error) = existing.replace_text(&entry.sql) {
                            failure.get_or_insert(error);
                        }
                        existing.pending_diff = None;
                        existing.analysis_outdated = true;
                        existing.revision = next_revision();
                        changed = true;
                    }
                    existing
                }
                (None, None) => continue,
            };
            if script.unresolved_connection_id != entry.unresolved_connection_id {
                script.unresolved_connection_id = entry.unresolved_connection_id;
                script.revision = next_revision();
                changed = true;
            }
            self.scripts.push(script);
        }
        // Files that storage no longer holds leave their catalogs when they drop
        if previous.iter().any(Option::is_some) {
            changed = true;
        }
        drop(previous);
        if changed {
            // Any added, removed or changed script can change what the others read, they analyze again on use
            for script in self.scripts.iter_mut() {
                script.analysis_outdated = true;
                script.revision = next_revision();
            }
            self.publish_table_parameters();
            self.revision = next_revision();
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(changed),
        }
    }

    /// The attachments, none until storage listed the files of the workbook
    pub fn attachments(&self) -> Option<&[WorkbookAttachment]> {
        self.attachments.as_deref()
    }

    /// The names of the table parameters of the attachments, which no script may take
    fn attachment_names(&self) -> Vec<&str> {
        self.attachments.iter().flatten().map(|attachment| attachment.name.as_str()).collect()
    }

    /// Run a function with a plan request of the scripts and attachments of the workbook
    fn with_plan_request<R>(&self, f: impl FnOnce(&SessionPlanRequest) -> R) -> R {
        let mut connections: Vec<&ScriptConnection> = Vec::new();
        let mut script_connections: Vec<u32> = Vec::with_capacity(self.scripts.len());
        for script in &self.scripts {
            let index = match connections.iter().position(|c| c.connection_id == script.connection.connection_id) {
                Some(index) => index,
                None => {
                    connections.push(&script.connection);
                    connections.len() - 1
                }
            };
            script_connections.push(index as u32);
        }
        let catalogs: Vec<Ref<Catalog>> = connections.iter().map(|connection| connection.catalog.borrow()).collect();
        let planner_connections: Vec<PlannerConnection> = connections
            .iter()
            .zip(&catalogs)
            .map(|(connection, catalog)| PlannerConnection {
                id: &connection.connection_id,
                kind: if connection.local { ConnectionKind::Local } else { ConnectionKind::Remote },
                catalog,
                dialect: connection.dialect,
                default_database: &connection.default_database,
                default_schema: &connection.default_schema,
            })
            .collect();
        let sessions: Vec<Ref<ScriptSession>> = self.scripts.iter().map(|script| script.session.borrow()).collect();
        let planner_scripts: Vec<PlannerScript> = self
            .scripts
            .iter()
            .zip(&sessions)
            .zip(&script_connections)
            .map(|((script, session), connection)| PlannerScript {
                script: session.script(),
                name: script_display_name(&script.file_name),
                connection: *connection,
                materialization_file: None,
            })
            .collect();
        let attachments = self.attachments.as_deref().unwrap_or_default();
        let stamps: Vec<String> = attachments.iter().map(WorkbookAttachment::stamp).collect();
        let planner_attachments: Vec<PlannerAttachment> = attachments
            .iter()
            .zip(&stamps)
            .map(|(attachment, stamp)| PlannerAttachment { name: &attachment.name, file: &attachment.file_name, stamp })
            .collect();
        let attachment_prefix = format!("{ATTACHMENT_MOUNT_ROOT}/{}", self.id);
        f(&SessionPlanRequest {
            connections: &planner_connections,
            scripts: &planner_scripts,
            scope: PlanScope::Session,
            materialized: &[],
            mount_prefix: "",
            attachments: &planner_attachments,
            attachment_prefix: &attachment_prefix,
        })
    }

    /// Publish the table parameters after the scripts or the attachments changed. The scripts whose analysis is
    /// outdated by them, e.g. those that read a script whose columns changed, are marked outdated.
    fn publish_table_parameters(&mut self) {
        let previous = self.table_parameters.clone();
        let derived = {
            let sessions: Vec<Ref<ScriptSession>> = self.scripts.iter().map(|script| script.session.borrow()).collect();
            let scripts: Vec<(&str, Option<&AnalyzedScript>)> = self
                .scripts
                .iter()
                .zip(&sessions)
                .map(|(script, session)| {
                    let analyzed = session.script().current_analysis().map(|(_, _, analyzed)| analyzed.as_ref());
                    (script_display_name(&script.file_name), analyzed)
                })
                .collect();
            let attachments: Vec<TableParameterAttachment> = self
                .attachments
                .iter()
                .flatten()
                .map(|attachment| TableParameterAttachment { name: &attachment.name, columns: attachment.columns.as_deref() })
                .collect();
            TableParameters::derive(&scripts, &attachments, previous.as_deref())
        };
        let results = match previous {
            Some(previous) if previous.same_as(&derived) => previous,
            _ => Arc::new(derived),
        };
        self.table_parameters = Some(results.clone());
        for script in self.scripts.iter_mut() {
            let mut session = script.session.borrow_mut();
            if session.script().table_parameters.as_ref().is_some_and(|attached| Arc::ptr_eq(attached, &results)) {
                continue;
            }
            session.set_table_parameters(Some(results.clone()));
            // An analysis without these table parameters reads outdated results
            let current = session.script().table_parameters_current();
            drop(session);
            if !current && !script.analysis_outdated {
                script.analysis_outdated = true;
                script.revision = next_revision();
            }
        }
    }

    /// Give the table parameters of the workbook to a session that is no script of it, e.g. the draft of the composer.
    /// Returns whether the analysis of the session is outdated by them.
    pub fn attach_table_parameters(&self, session: &mut ScriptSession) -> bool {
        let Some(results) = &self.table_parameters else {
            return false;
        };
        if session.script().table_parameters.as_ref().is_some_and(|attached| Arc::ptr_eq(attached, results)) {
            return false;
        }
        session.set_table_parameters(Some(results.clone()));
        !session.script().table_parameters_current()
    }

    /// Rewrite the table parameters that read a renamed script or attachment to read `name`. The references are those
    /// of a plan with the names before the rename, scripts are analyzed first if their analysis lags behind their
    /// text. The script `keep` keeps its text. Returns the keys of the rewritten scripts.
    fn rewrite_renamed_references(&mut self, target: ReferenceTarget, name: &str, keep: Option<ScriptKey>) -> Result<Vec<ScriptKey>> {
        for script in self.scripts.iter_mut() {
            if script.editor_update.as_ref().map(|update| update.text_version) != Some(script.session.borrow_mut().text_version()) {
                script.analyze();
            }
        }
        let target_index = match target {
            ReferenceTarget::Script(file) => self.scripts.iter().position(|script| script.file_name == file),
            ReferenceTarget::Attachment(file) => self.attachments.iter().flatten().position(|attachment| attachment.file_name == file),
        };
        let Some(target_index) = target_index.map(|index| index as u32) else {
            return Ok(Vec::new());
        };
        // The spans of the parameters that read the target, in UTF-8 bytes of the text of each script
        let spans: Vec<Vec<(usize, usize)>> = self.with_plan_request(|request| {
            check_script_references(request)
                .into_iter()
                .map(|checked| {
                    checked
                        .references
                        .iter()
                        .filter(|reference| !reference.parameter.is_empty())
                        .filter(|reference| match target {
                            ReferenceTarget::Script(_) => reference.script == Some(target_index),
                            ReferenceTarget::Attachment(_) => reference.attachment == Some(target_index),
                        })
                        .map(|reference| {
                            let offset = reference.text_span.offset as usize;
                            (offset, offset + reference.text_span.length as usize)
                        })
                        .collect()
                })
                .collect()
        });
        let reference = format!(":{}", quote_identifier(name));
        let unit = self.offset_unit;
        let mut rewritten = Vec::new();
        for (script, spans) in self.scripts.iter_mut().zip(spans) {
            if spans.is_empty() || Some(script.key) == keep {
                continue;
            }
            let from_text = script.text();
            let mut text = from_text.clone();
            let mut changes = Vec::with_capacity(spans.len());
            for (begin, end) in spans.iter().rev() {
                if *end > text.len() || !text.is_char_boundary(*begin) || !text.is_char_boundary(*end) {
                    return Err(Error::invalid_argument("a reference outside of the text of its script"));
                }
                text.replace_range(*begin..*end, &reference);
            }
            for (begin, end) in &spans {
                let from = text_length(&from_text[..*begin], unit);
                changes.push(TextChange { from, to: from + text_length(&from_text[*begin..*end], unit), insert: reference.clone() });
            }
            script.replace_text(&text)?;
            script.analyze();
            script.pending_diff = None;
            script.external_changes = Some(ExternalChanges { from_text, changes });
            script.revision = next_revision();
            rewritten.push(script.key);
        }
        Ok(rewritten)
    }

    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub fn ephemeral(&self) -> bool {
        self.ephemeral
    }
    pub fn set_ephemeral(&mut self, ephemeral: bool) {
        self.ephemeral = ephemeral;
    }
    pub fn pending_connection(&self) -> Option<&Rc<ScriptConnection>> {
        self.pending_connection.as_ref()
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The scripts in feed order
    pub fn scripts(&self) -> &[WorkbookScript] {
        &self.scripts
    }

    /// The script with a key
    pub fn script(&self, key: ScriptKey) -> Option<&WorkbookScript> {
        self.scripts.iter().find(|script| script.key == key)
    }

    /// The script with a file name
    pub fn script_by_file(&self, file_name: &str) -> Option<&WorkbookScript> {
        self.scripts.iter().find(|script| script.file_name == file_name)
    }

    /// Add a script that storage holds, e.g. when a workbook is restored. The script is analyzed lazily.
    pub fn add_stored_script(
        &mut self,
        file_name: &str,
        text: &str,
        connection: Rc<ScriptConnection>,
        unresolved_connection_id: Option<String>,
    ) -> Result<ScriptKey> {
        let mut script = self.create_script(file_name, connection, None)?;
        script.replace_text(text)?;
        script.unresolved_connection_id = unresolved_connection_id;
        let key = script.key;
        self.scripts.push(script);
        self.publish_table_parameters();
        self.revision = next_revision();
        Ok(key)
    }

    /// Set the attachments that storage lists when a workbook is restored
    pub fn set_stored_attachments(&mut self, files: &[DataFile]) {
        self.attachments = Some(read_workbook_attachments(files, &[]));
        self.publish_table_parameters();
        self.revision = next_revision();
    }

    /// The connection that a new script runs on: a script inserted at an index takes the connection of the script
    /// before it, the first script that of the script after it. An appended script takes the pending connection,
    /// otherwise the connection of the last script.
    pub fn new_script_connection(&self, index: Option<usize>) -> Option<Rc<ScriptConnection>> {
        match index {
            Some(index) if !self.scripts.is_empty() => {
                let neighbor = index.min(self.scripts.len()).saturating_sub(1);
                Some(self.scripts[neighbor].connection.clone())
            }
            _ => self.pending_connection.clone().or_else(|| self.scripts.last().map(|script| script.connection.clone())),
        }
    }

    /// The script list of the workbook file. A workbook without scripts holds the pending connection, which comes
    /// first among the copies.
    pub fn script_list(&self) -> ScriptList {
        let scripts = self
            .scripts
            .iter()
            .map(|script| ScriptListEntry { name: script.file_name.clone(), connection_id: script.persisted_connection_id().to_string() })
            .collect();
        let mut connections: Vec<ConnectionCopy> = Vec::new();
        let pending = self.pending_connection.iter().filter(|_| self.scripts.is_empty());
        for connection in pending.chain(self.scripts.iter().map(|script| &script.connection)) {
            if let Some(params) = &connection.params {
                if !connections.iter().any(|copy| copy.connection_id == connection.connection_id) {
                    connections.push(ConnectionCopy { connection_id: connection.connection_id.clone(), params: params.clone() });
                }
            }
        }
        ScriptList { scripts, connections }
    }

    /// Apply an action. A failed action leaves the workbook unchanged.
    pub fn apply(&mut self, action: WorkbookAction) -> Result<WorkbookOutcome> {
        let mut outcome = WorkbookOutcome::default();
        if self.is_cloud_preview() && action.changes_published_content() {
            return Err(Error::invalid_argument("a cloud preview can't be changed"));
        }
        match action {
            WorkbookAction::SetCloudLink { link } => {
                if link != self.cloud {
                    self.cloud = link;
                    outcome.changed = true;
                    outcome.effects.push(self.properties_write());
                }
            }
            WorkbookAction::ApplyPlannerAnalysis { updates } => {
                for (key, update) in updates {
                    let Some(script) = self.script_mut(key) else {
                        continue;
                    };
                    let current = update.status == EditorUpdateStatus::OK
                        && update.analysis_available
                        && update.text_version == script.session.borrow_mut().text_version()
                        && update.catalog_revision == script.connection.catalog.borrow().version() as u64;
                    if !current {
                        continue;
                    }
                    // A moved cursor can supersede the snapshot of the planner without changing the text or the catalog
                    let update = if update.state_revision == script.session.borrow_mut().state_revision() {
                        update
                    } else {
                        script.session.borrow_mut().analyze(&script.connection.catalog.borrow())
                    };
                    script.take_analysis(update);
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::CreateScript { index, text, base, connection } => {
                self.create(index, text, &base, connection, &mut outcome)?
            }
            WorkbookAction::DeleteScript { file_name } => self.delete(&file_name, &mut outcome),
            WorkbookAction::RenameScript { file_name, new_name } => self.rename(&file_name, &new_name, &mut outcome)?,
            WorkbookAction::ReorderScripts { order } => self.reorder(&order, &mut outcome),
            WorkbookAction::SetScriptText { key, text, with_diff } => self.set_text(key, &text, with_diff, &mut outcome)?,
            WorkbookAction::AcceptPendingDiff { key } => {
                if let Some(script) = self.script_mut(key).filter(|script| script.pending_diff.is_some()) {
                    // The script holds the new text already
                    script.pending_diff = None;
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::RejectPendingDiff { key } => {
                let prior = self.script(key).and_then(|script| script.pending_diff.as_ref()).map(|diff| diff.prior_text.clone());
                if let Some(prior) = prior {
                    self.set_text(key, &prior, false, &mut outcome)?;
                }
            }
            WorkbookAction::SetScriptVisSpec { key, spec } => self.set_vis_spec(key, &spec, &mut outcome)?,
            WorkbookAction::SetWorkbookInput { name, literal, keys } => self.set_input(&name, &literal, &keys, &mut outcome)?,
            WorkbookAction::ApplyEditorEvent { key, event } => self.apply_editor_event(key, &event, &mut outcome)?,
            WorkbookAction::ReportEditorUpdate { key, update, accepts_diff } => {
                if update.status == EditorUpdateStatus::OK {
                    self.take_editor_update(key, update, accepts_diff, &mut outcome)?;
                }
            }
            WorkbookAction::AnalyzeOutdatedScript { key } => self.analyze_outdated(key, &mut outcome),
            WorkbookAction::CatalogDidUpdate { connection_id } => {
                for script in self.scripts.iter_mut().filter(|script| script.connection.connection_id == connection_id) {
                    if !script.analysis_outdated {
                        script.analysis_outdated = true;
                        script.revision = next_revision();
                        outcome.changed = true;
                    }
                }
            }
            WorkbookAction::SetExecutionVisualization { key, visualization } => {
                if let Some(script) = self.script_mut(key).filter(|script| script.visualization != visualization) {
                    script.visualization = visualization;
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::RegisterQuery { key, query_id } => {
                if let Some(script) = self.script_mut(key) {
                    script.latest_query_id = Some(query_id);
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::RegisterScriptResult { key, query_id } => {
                if let Some(script) = self.script_mut(key) {
                    // Query ids grow, an older overlapping query must not replace a newer result
                    if script.latest_result_query_id.is_none_or(|latest| latest < query_id) {
                        script.latest_result_query_id = Some(query_id);
                        script.revision = next_revision();
                        outcome.changed = true;
                    }
                }
            }
            WorkbookAction::SetScriptConnection { file_name, connection } => {
                self.set_script_connection(&file_name, connection, &mut outcome)?
            }
            WorkbookAction::SetPendingConnection { connection } => self.set_pending_connection(connection, &mut outcome),
            WorkbookAction::ReplaceConnection { from, into } => self.replace_connection(&from, into, &mut outcome),
            WorkbookAction::DetachConnection { from, into } => {
                let detaches = self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == from)
                    && !self.scripts.iter().any(|script| script.connection.connection_id == from);
                if detaches {
                    self.pending_connection = None;
                    outcome.changed = true;
                    if self.scripts.is_empty() {
                        self.set_pending_connection(into, &mut outcome);
                    }
                }
            }
            WorkbookAction::SetWorkbookAttachments { files } => {
                let attachments = read_workbook_attachments(&files, self.attachments.as_deref().unwrap_or_default());
                if self.attachments.as_ref() != Some(&attachments) {
                    self.attachments = Some(attachments);
                    outcome.changed = true;
                }
            }
            WorkbookAction::SetAttachmentColumns { file_name, stamp, columns } => {
                let attachment = self.attachments.iter_mut().flatten().find(|a| a.file_name == file_name && a.stamp() == stamp);
                if let Some(attachment) = attachment.filter(|attachment| attachment.columns.as_ref() != Some(&columns)) {
                    attachment.columns = Some(columns);
                    outcome.changed = true;
                }
            }
            WorkbookAction::RenameAttachment { file_name, new_file_name } => {
                self.rename_attachment(&file_name, &new_file_name, &mut outcome)?
            }
            WorkbookAction::RenameWorkbook { name } => {
                let name = name.map(|name| name.trim().to_string()).filter(|name| !name.is_empty());
                if name != self.name {
                    self.name = name;
                    outcome.changed = true;
                    outcome.effects.push(self.properties_write());
                }
            }
        }
        if outcome.changed {
            // The table parameters read the results of the scripts and the attachments, which follow every change
            self.publish_table_parameters();
            self.revision = next_revision();
        }
        Ok(outcome)
    }

    fn rename_attachment(&mut self, file_name: &str, new_file_name: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        // The file was renamed already, the scripts that read the attachment read the new name
        let Some(name) = attachment_parameter_name(new_file_name).map(str::to_string) else {
            return Ok(());
        };
        let exists = self.attachments.iter().flatten().any(|attachment| attachment.file_name == file_name);
        if !exists || file_name == new_file_name {
            return Ok(());
        }
        let rewritten = self.rewrite_renamed_references(ReferenceTarget::Attachment(file_name), &name, None)?;
        self.after_rewrite(&rewritten, outcome);
        if let Some(attachment) = self.attachments.iter_mut().flatten().find(|attachment| attachment.file_name == file_name) {
            attachment.file_name = new_file_name.to_string();
            attachment.name = name;
        }
        outcome.changed = true;
        Ok(())
    }

    /// Mark the readers of rewritten scripts outdated and write the rewritten scripts
    fn after_rewrite(&mut self, rewritten: &[ScriptKey], outcome: &mut WorkbookOutcome) {
        for key in rewritten {
            if let Some(script) = self.script(*key) {
                let catalog = script.connection.catalog.clone();
                outcome.effects.push(Self::write_script(script));
                self.mark_others_outdated(*key, &catalog);
            }
        }
        outcome.changed |= !rewritten.is_empty();
    }

    fn script_mut(&mut self, key: ScriptKey) -> Option<&mut WorkbookScript> {
        self.scripts.iter_mut().find(|script| script.key == key)
    }

    fn properties_write(&self) -> WorkbookEffect {
        WorkbookEffect::WriteProperties { name: self.name.clone(), ephemeral: self.ephemeral, cloud: self.cloud.clone() }
    }

    /// Create the session of a script on a connection. A script that moves to another connection keeps its key.
    fn create_script(&self, file_name: &str, connection: Rc<ScriptConnection>, key: Option<ScriptKey>) -> Result<WorkbookScript> {
        let session = {
            let catalog = connection.catalog.borrow();
            match key {
                None => ScriptSession::new(&catalog, self.offset_unit)?,
                Some(key) => ScriptSession::with_entry_id(&catalog, self.offset_unit, key)?,
            }
        };
        Ok(WorkbookScript {
            key: session.catalog_entry_id(),
            file_name: file_name.to_string(),
            session: Rc::new(RefCell::new(session)),
            connection,
            editor_update: None,
            analysis_outdated: true,
            pending_diff: None,
            external_changes: None,
            visualization: None,
            statistics: Default::default(),
            latest_query_id: None,
            latest_result_query_id: None,
            unresolved_connection_id: None,
            revision: next_revision(),
        })
    }

    /// Mark the other scripts in the catalog of a script outdated, they may resolve against its declarations. Scripts
    /// in other catalogs can't reference it.
    fn mark_others_outdated(&mut self, changed: ScriptKey, catalog: &CatalogHandle) {
        for script in self.scripts.iter_mut() {
            if script.key != changed && !script.analysis_outdated && Rc::ptr_eq(&script.connection.catalog, catalog) {
                script.analysis_outdated = true;
                script.revision = next_revision();
            }
        }
    }

    fn write_script(script: &WorkbookScript) -> WorkbookEffect {
        WorkbookEffect::WriteScript { file_name: script.file_name.clone(), text: script.text() }
    }

    fn create(
        &mut self,
        index: Option<usize>,
        text: Option<String>,
        base: &str,
        connection: Option<Rc<ScriptConnection>>,
        outcome: &mut WorkbookOutcome,
    ) -> Result<()> {
        let Some(connection) = connection.or_else(|| self.new_script_connection(index)) else {
            return Err(Error::invalid_argument("a new script needs a connection"));
        };
        // A script takes no name of an attachment, the table parameter would be ambiguous
        let file_name = script_file_name(base, self.scripts.iter().map(|script| script.file_name.as_str()), self.attachment_names());
        let mut script = self.create_script(&file_name, connection.clone(), None)?;
        let text = text.filter(|text| !text.is_empty());
        if let Some(text) = &text {
            // Analyzed right away, so that the script runs without waiting for an editor
            script.replace_text(text)?;
            script.analyze();
        }
        let key = script.key;
        let at = index.map_or(self.scripts.len(), |index| index.min(self.scripts.len()));
        self.scripts.insert(at, script);
        if text.is_some() {
            self.mark_others_outdated(key, &connection.catalog);
        }
        // The pending connection is taken by the script that runs on it
        if self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == connection.connection_id) {
            self.pending_connection = None;
        }
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::WriteScript { file_name, text: text.unwrap_or_default() });
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
        Ok(())
    }

    fn delete(&mut self, file_name: &str, outcome: &mut WorkbookOutcome) {
        let Some(position) = self.scripts.iter().position(|script| script.file_name == file_name) else {
            return;
        };
        // The script leaves its catalog when it drops, at the end of the action
        let deleted = self.scripts.remove(position);
        deleted.leave_catalog();
        // A workbook without scripts keeps the connection of its last script for the next one
        if self.scripts.is_empty() && self.pending_connection.is_none() {
            self.pending_connection = Some(deleted.connection.clone());
        }
        // The remaining scripts of the catalog may have referenced its declarations
        self.mark_others_outdated(deleted.key, &deleted.connection.catalog);
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::DeleteScript { file_name: deleted.file_name.clone() });
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
    }

    fn rename(&mut self, file_name: &str, new_name: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        if !self.scripts.iter().any(|script| script.file_name == file_name) {
            return Ok(());
        }
        // The name is a display name: a ".sql" is dropped, an empty name or one that is no plain file name is ignored
        let requested = script_display_name(new_name.trim());
        if requested.is_empty() || requested.contains(['/', '\\', '\0']) {
            return Ok(());
        }
        let files = self.scripts.iter().map(|script| script.file_name.as_str());
        let base = unique_script_base(requested, files, file_name, self.attachment_names());
        let new_file_name = format!("{base}.sql");
        let Some(position) = self.scripts.iter().position(|script| script.file_name == file_name) else {
            return Ok(());
        };
        if new_file_name == file_name {
            // The same name writes the unchanged text
            outcome.effects.push(Self::write_script(&self.scripts[position]));
            return Ok(());
        }
        // The scripts that read the script read the new name. A script that reads itself is a cycle, it keeps the name.
        let key = self.scripts[position].key;
        let rewritten = self.rewrite_renamed_references(ReferenceTarget::Script(file_name), &base, Some(key))?;
        let script = &mut self.scripts[position];
        script.file_name = new_file_name.clone();
        script.revision = next_revision();
        // The other scripts read the script by its name
        script.analyze();
        let catalog = script.connection.catalog.clone();
        self.mark_others_outdated(key, &catalog);
        self.after_rewrite(&rewritten, outcome);
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::RenameScript { from: file_name.to_string(), to: new_file_name });
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
        Ok(())
    }

    fn reorder(&mut self, order: &[String], outcome: &mut WorkbookOutcome) {
        // The requested files that exist, without duplicates, then the files that the order leaves out
        let mut ordered: Vec<usize> = Vec::with_capacity(self.scripts.len());
        for file_name in order {
            if let Some(index) = self.scripts.iter().position(|script| &script.file_name == file_name) {
                if !ordered.contains(&index) {
                    ordered.push(index);
                }
            }
        }
        for index in 0..self.scripts.len() {
            if !ordered.contains(&index) {
                ordered.push(index);
            }
        }
        // The same order changes nothing
        if ordered.iter().enumerate().all(|(i, index)| i == *index) {
            return;
        }
        let mut scripts: Vec<Option<WorkbookScript>> = std::mem::take(&mut self.scripts).into_iter().map(Some).collect();
        self.scripts = ordered.into_iter().filter_map(|index| scripts[index].take()).collect();
        outcome.changed = true;
        // The order lives in the workbook file, the script files stay untouched
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
    }

    fn set_text(&mut self, key: ScriptKey, text: &str, with_diff: bool, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Ok(());
        };
        let current = script.text();
        // A rewrite of a script with a staged rewrite restages it against the text before the staged one
        let prior = match (&script.pending_diff, with_diff) {
            (Some(pending), true) => pending.prior_text.clone(),
            _ => current.clone(),
        };
        let mut pending_diff = None;
        if with_diff && text != prior {
            if prior != current {
                script.replace_text(&prior)?;
            }
            // A failed diff never blocks the rewrite, the rewrite is just not staged then
            pending_diff = script.diff_to(text).ok().map(|diff| PendingDiff { prior_text: prior, diff });
        }
        script.replace_text(text)?;
        script.analyze();
        script.pending_diff = pending_diff;
        script.external_changes = None;
        script.revision = next_revision();
        let (catalog, effect) = (script.connection.catalog.clone(), Self::write_script(script));
        // The text was published into the catalog, the other scripts resolve against it again
        self.mark_others_outdated(key, &catalog);
        outcome.changed = true;
        outcome.effects.push(effect);
        Ok(())
    }

    fn set_vis_spec(&mut self, key: ScriptKey, spec: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Ok(());
        };
        let current = script.text();
        let prior = script.pending_diff.as_ref().map_or_else(|| current.clone(), |pending| pending.prior_text.clone());
        // The diff is computed against the text before the first edit, the tag is rewritten in that text
        if prior != current {
            script.replace_text(&prior)?;
        }
        let rewritten = script
            .chart_statement_id()
            .and_then(|statement| {
                let renderer = VisRenderer::from_parts("vegalite", spec).ok()?;
                script.session.borrow_mut().rewrite_vis_renderer(statement, Some(&renderer), true).ok()
            })
            .filter(|text| *text != current);
        match rewritten {
            // A spec that restores the chart before the first edit drops the diff
            Some(text) => self.set_text(key, &text, true, outcome),
            None => {
                // The script stays as it is
                if script.text() != current {
                    script.replace_text(&current)?;
                }
                Ok(())
            }
        }
    }

    fn set_input(&mut self, name: &str, literal: &str, keys: &[ScriptKey], outcome: &mut WorkbookOutcome) -> Result<()> {
        let unit = self.offset_unit;
        let mut rewritten: Vec<(ScriptKey, CatalogHandle)> = Vec::new();
        for key in keys {
            let Some(script) = self.script_mut(*key) else {
                continue;
            };
            let from_text = script.text();
            // A script that doesn't parse keeps its tags
            let Ok(text) = script.session.borrow_mut().rewrite_param_tag(name, Some(literal), true) else {
                continue;
            };
            if text == from_text {
                continue;
            }
            script.replace_text(&text)?;
            script.analyze();
            script.pending_diff = None;
            // A mounted editor applies the change and keeps its cursor
            script.external_changes = Some(ExternalChanges { changes: vec![text_change(&from_text, &text, unit)], from_text });
            script.revision = next_revision();
            outcome.effects.push(Self::write_script(script));
            rewritten.push((*key, script.connection.catalog.clone()));
        }
        for (key, catalog) in &rewritten {
            self.mark_others_outdated(*key, catalog);
        }
        outcome.changed |= !rewritten.is_empty();
        Ok(())
    }

    fn apply_editor_event(&mut self, key: ScriptKey, event: &EditorEventT, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Err(Error::invalid_argument("an editor event of an unknown script"));
        };
        let update = script.session.borrow_mut().apply(&script.connection.catalog.borrow(), event);
        if update.status != EditorUpdateStatus::OK {
            // The editor reports the failure, the script is unchanged
            outcome.editor_update = Some(update);
            return Ok(());
        }
        // A genuine edit of the user accepts a staged rewrite
        let accepts_diff = event.origin == EditorEventOrigin::USER;
        self.take_editor_update(key, update, accepts_diff, outcome)
    }

    /// Take the update of an editor event, applied by the workbook or by an editor to the shared session. The text is
    /// published into the catalog and written, a changed text with `accepts_diff` accepts a staged rewrite.
    fn take_editor_update(&mut self, key: ScriptKey, mut update: EditorUpdateT, accepts_diff: bool, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Err(Error::invalid_argument("an editor update of an unknown script"));
        };
        // An update that leaves an unchanged analysis out takes the arrays of the previous one
        if update.analysis_omitted {
            if let Some(previous) = &script.editor_update {
                update.diagnostics = previous.diagnostics.clone();
                update.syntax_spans = previous.syntax_spans.clone();
                update.vegalite_specs = previous.vegalite_specs.clone();
                update.comment_tags = previous.comment_tags.clone();
                update.semantic_spans = previous.semantic_spans.clone();
                update.script_annotations = previous.script_annotations.clone();
                update.processing_statistics = previous.processing_statistics.clone();
            }
        }
        let previous = script.editor_update.as_ref();
        let text_changed = previous.map(|previous| previous.text_version) != Some(update.text_version);
        let state_changed = previous.map(|previous| previous.state_revision) != Some(update.state_revision);
        let analysis_refreshed = update.analysis_updated;
        // Publishing declarations equal to the published ones keeps the catalog revision
        let mut catalog_changed = false;
        if (text_changed || analysis_refreshed) && update.analysis_available {
            let mut catalog = script.connection.catalog.borrow_mut();
            let version = catalog.version();
            let _ = script.session.borrow_mut().load_into_catalog(&mut catalog, CatalogLayer::SESSION);
            catalog_changed = catalog.version() != version;
        }
        let accepts_diff = text_changed && accepts_diff && script.pending_diff.is_some();
        if !text_changed && !state_changed && !script.analysis_outdated && !accepts_diff {
            outcome.editor_update = Some(update);
            return Ok(());
        }
        script.record_statistics(&update);
        script.editor_update = Some(update.clone());
        script.analysis_outdated = false;
        if text_changed || analysis_refreshed {
            script.compile_visualization();
        }
        if accepts_diff {
            script.pending_diff = None;
        }
        script.revision = next_revision();
        let catalog = script.connection.catalog.clone();
        // Only a changed text is written, moving the cursor doesn't rewrite the file
        let write = text_changed.then(|| Self::write_script(script));
        if catalog_changed {
            self.mark_others_outdated(key, &catalog);
        }
        outcome.changed = true;
        outcome.effects.extend(write);
        outcome.editor_update = Some(update);
        Ok(())
    }

    /// The script at a position moved to another connection under its key, with its text and its queries. The
    /// script at the position stays as it is, the caller replaces it.
    fn moved_script(&self, position: usize, connection: Rc<ScriptConnection>) -> Result<WorkbookScript> {
        let previous = &self.scripts[position];
        let mut moved = self.create_script(&previous.file_name, connection, Some(previous.key))?;
        moved.replace_text(&previous.text())?;
        moved.latest_query_id = previous.latest_query_id;
        moved.latest_result_query_id = previous.latest_result_query_id;
        Ok(moved)
    }

    /// Replace the script at a position with a moved one, the previous script leaves its catalog
    fn replace_moved(&mut self, position: usize, moved: WorkbookScript) -> WorkbookScript {
        let previous = std::mem::replace(&mut self.scripts[position], moved);
        previous.leave_catalog();
        previous
    }

    fn set_script_connection(&mut self, file_name: &str, connection: Rc<ScriptConnection>, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(position) = self.scripts.iter().position(|script| script.file_name == file_name) else {
            return Ok(());
        };
        let script = &mut self.scripts[position];
        if script.connection.connection_id == connection.connection_id {
            // Picking the connection the script runs on replaces the unresolved reference
            if script.unresolved_connection_id.take().is_some() {
                script.revision = next_revision();
                outcome.changed = true;
                outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
            }
            return Ok(());
        }
        // A script session belongs to one catalog, the script moves into a new session. The new session is created
        // first, a failure leaves the script untouched.
        let mut moved = self.moved_script(position, connection)?;
        moved.analyze();
        let key = moved.key;
        let catalog = moved.connection.catalog.clone();
        let previous = self.replace_moved(position, moved);
        // The scripts of both catalogs may have referenced the moved script
        self.mark_others_outdated(key, &previous.connection.catalog);
        self.mark_others_outdated(key, &catalog);
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
        Ok(())
    }

    fn set_pending_connection(&mut self, connection: Rc<ScriptConnection>, outcome: &mut WorkbookOutcome) {
        let same = self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == connection.connection_id);
        if same || connection.params.is_none() {
            return;
        }
        self.pending_connection = Some(connection);
        outcome.changed = true;
        // A workbook without scripts holds the connection in its workbook file
        if self.scripts.is_empty() {
            outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
        }
    }

    fn replace_connection(&mut self, from: &str, into: Rc<ScriptConnection>, outcome: &mut WorkbookOutcome) {
        let mut moved = 0;
        for position in 0..self.scripts.len() {
            if self.scripts[position].connection.connection_id != from {
                continue;
            }
            // A script that can't move stays on the replaced connection, it isn't removed
            if let Ok(script) = self.moved_script(position, into.clone()) {
                self.replace_moved(position, script);
                moved += 1;
            }
        }
        let moves_pending = self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == from);
        if moved == 0 && !moves_pending {
            return;
        }
        if moves_pending {
            self.pending_connection = Some(into.clone());
        }
        // The moved scripts analyze lazily, the scripts of the target catalog may reference them
        for script in self.scripts.iter_mut().filter(|script| Rc::ptr_eq(&script.connection.catalog, &into.catalog)) {
            if !script.analysis_outdated {
                script.analysis_outdated = true;
                script.revision = next_revision();
            }
        }
        outcome.changed = true;
        // The references of the workbook file follow, the script list replaces one that still names the replaced
        // connection
        outcome.effects.push(WorkbookEffect::PatchConnection {
            connection_id: into.connection_id.clone(),
            params: into.params.clone(),
            replaces: vec![from.to_string()],
        });
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
    }

    fn analyze_outdated(&mut self, key: ScriptKey, outcome: &mut WorkbookOutcome) {
        let Some(script) = self.script_mut(key) else {
            return;
        };
        if !script.is_analysis_outdated() {
            return;
        }
        let catalog = script.connection.catalog.clone();
        let version = catalog.borrow().version();
        script.analyze();
        script.revision = next_revision();
        // The analysis ran against a newer catalog and may publish different declarations, e.g. a view over a table
        // of another script. The scripts that resolve against them are outdated then, too.
        if catalog.borrow().version() != version {
            self.mark_others_outdated(key, &catalog);
        }
        outcome.changed = true;
    }
}
