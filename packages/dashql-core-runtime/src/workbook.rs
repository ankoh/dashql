//! The scripts of a workbook and the actions on them.
//!
//! A workbook owns the script sessions of its scripts. A script is analyzed against the catalog of its connection and
//! publishes its declarations into that catalog, the other scripts of the catalog then resolve against them. An action
//! changes the workbook in place and returns the effects that the host applies afterwards, e.g. the files to write.
//! Dropping a script drops its session, nothing has to be freed by hand.

use std::cell::{Ref, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use dashql_buffers::diff::ScriptDiffT;
use dashql_buffers::editor::{
    EditorAnalysisVersionT, EditorEventOrigin, EditorEventT, EditorOffsetUnit, EditorProcessingStatisticsT,
    EditorUpdateStatus, EditorUpdateT,
};
use dashql_buffers::execution::{CompiledVisualizationT, ExecutionGraphT, ScriptCompilationStatementKind};
use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::analyzer::AnalyzedScript;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer, CatalogVersion, EntryIdSource};
use dashql_core::error::{Error, Result};
use dashql_core::script::Script;
use dashql_core::script_session::ScriptSession;
use dashql_core::table_parameters::{colliding_names, TableParameterAttachment, TableParameters};
use dashql_core::utils::quote_identifier;
use dashql_core::vis_rewrite::VisRenderer;

use crate::attachments::{
    attachment_parameter_name, read_workbook_attachments, renamed_attachment_file_name, DataFile, WorkbookAttachment,
};
use crate::connections::ConnectionParams;
use crate::names::{free_workbook_name, script_display_name, script_file_name, unique_script_base};
use crate::planner::dataflow::{derive_session_dataflow, Dataflow};
use crate::planner::script_references::check_script_references;
use crate::planner::{
    plan_session, ConnectionKind, PlanScope, PlannerAttachment, PlannerConnection, PlannerScript, SessionPlanRequest,
};

/// The key of a script, its entry in the catalog of its connection. A script keeps its key when it moves to another
/// connection. Keys are unique across the catalogs of the runtime because all of them take their entry ids from one
/// source, see [`new_catalog`].
pub type ScriptKey = CatalogEntryId;

/// The source of the entry ids of the catalogs of the runtime
static ENTRY_IDS: std::sync::OnceLock<EntryIdSource> = std::sync::OnceLock::new();

/// A new catalog of the runtime. Every catalog that scripts publish into is created here, so the entry ids of all of
/// them, and with them the keys of the scripts, come from one source.
pub fn new_catalog() -> Catalog {
    Catalog::with_entry_ids(ENTRY_IDS.get_or_init(EntryIdSource::new).clone())
}

/// A catalog that the scripts of a connection share
pub type CatalogHandle = Rc<RefCell<Catalog>>;

/// What the scripts of a connection read of it besides its catalog. It follows the connection: the connection updates
/// it in place, every script on the connection sees the change.
#[derive(Debug, Clone, PartialEq)]
pub struct ScriptConnectionProfile {
    /// The dialect that the queries of the scripts are compiled to
    pub dialect: FormattingDialect,
    /// Is the connection the embedded Hyper, which scans the results of scripts of other connections?
    pub local: bool,
    /// The params of the connection as the workbook file holds a copy of them
    pub params: Option<ConnectionParams>,
    /// The database of relations without a database name
    pub default_database: String,
    /// The schema of relations without a schema name
    pub default_schema: String,
}

/// The connection that a script is analyzed and executed with. A connection of the runtime holds one value that all
/// of its scripts share.
#[derive(Debug)]
pub struct ScriptConnection {
    /// The id of the connection
    pub connection_id: String,
    /// The catalog of the connection, the scripts publish their declarations into it
    pub catalog: CatalogHandle,
    /// What the scripts read of the connection
    profile: RefCell<ScriptConnectionProfile>,
}

impl ScriptConnection {
    pub fn new(connection_id: &str, catalog: CatalogHandle, profile: ScriptConnectionProfile) -> Self {
        Self { connection_id: connection_id.to_string(), catalog, profile: RefCell::new(profile) }
    }
    /// What the scripts read of the connection
    pub fn profile(&self) -> Ref<'_, ScriptConnectionProfile> {
        self.profile.borrow()
    }
    pub fn dialect(&self) -> FormattingDialect {
        self.profile.borrow().dialect
    }
    pub fn local(&self) -> bool {
        self.profile.borrow().local
    }
    pub fn params(&self) -> Option<ConnectionParams> {
        self.profile.borrow().params.clone()
    }
    pub fn has_params(&self) -> bool {
        self.profile.borrow().params.is_some()
    }
    /// Follow a change of the connection, returns whether the profile changed. The workbooks compile the
    /// visualizations of the scripts on the connection again (`WorkbookAction::ConnectionProfileChanged`).
    pub fn update(&self, profile: ScriptConnectionProfile) -> bool {
        if *self.profile.borrow() == profile {
            return false;
        }
        *self.profile.borrow_mut() = profile;
        true
    }
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

/// Where a workbook came from: a link that the host keeps with the workbook, e.g. to the version of a published workbook
/// that it was opened from or published to. The runtime doesn't read the link, it writes it with the properties of the
/// workbook (`WorkbookEffect::WriteProperties`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookOrigin {
    /// The link of the host
    pub link: serde_json::Value,
    /// Is the workbook a read-only look at its origin? Its scripts and names can't be changed, a new origin that isn't
    /// read-only turns it into a workbook of its own.
    pub read_only: bool,
}

/// The view that a workbook opens in, the feed unless the workbook names another one. A shared workbook opens in it
/// too, e.g. in its dashboard. The workbook file and the workbook tables leave out the feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WorkbookDefaultView {
    /// The scripts of the workbook one below the other
    #[default]
    Feed,
    /// The cards of the scripts on a board
    Dashboard,
    /// The scripts and the relations between them on a canvas
    Dataflow,
}

impl WorkbookDefaultView {
    /// The name in the workbook file and the workbook tables
    pub fn as_str(self) -> &'static str {
        match self {
            WorkbookDefaultView::Feed => "feed",
            WorkbookDefaultView::Dashboard => "dashboard",
            WorkbookDefaultView::Dataflow => "dataflow",
        }
    }

    /// The view of a name, None for any other name
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "feed" => Some(WorkbookDefaultView::Feed),
            "dashboard" => Some(WorkbookDefaultView::Dashboard),
            "dataflow" => Some(WorkbookDefaultView::Dataflow),
            _ => None,
        }
    }

    /// The name as a file stores it, None for the feed
    pub fn stored(self) -> Option<&'static str> {
        (self != WorkbookDefaultView::Feed).then(|| self.as_str())
    }
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
    /// Names the diff, a staged rewrite gets a new revision
    pub revision: u64,
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
    let (Some(head), Some(removed), Some(inserted)) =
        (from.get(..prefix), from.get(prefix..from.len() - suffix), to.get(prefix..to.len() - suffix))
    else {
        // The prefix and the suffix end on character boundaries of both texts, a change of the whole text is the
        // fallback
        return TextChange { from: 0, to: text_length(from, unit), insert: to.to_string() };
    };
    let start = text_length(head, unit);
    TextChange { from: start, to: start + text_length(removed, unit), insert: inserted.to_string() }
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
pub fn next_revision() -> u64 {
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

/// The editor session of a script. The workbook shares it with the runs of the workbook, which check that a script
/// keeps its session, and with the read-only handles of the host, which read the session but never change it. Calls
/// into the workbook never overlap, a borrow ends with the call that took it.
pub type SessionHandle = Rc<RefCell<ScriptSession>>;

/// The stored result of a script: the file of its last result in the results of the workbook
/// (docs/design/workbook_results.md)
#[derive(Clone, Debug, PartialEq)]
pub struct ScriptStoredResult {
    /// The file name
    pub name: String,
    /// The key in the name of the file
    pub key: String,
    /// When the file was written, in milliseconds since the epoch
    pub written_at: f64,
    /// Is the key the key of the script as it is now? A result of another key is outdated.
    pub current: bool,
}

/// A script of a workbook
pub struct WorkbookScript {
    /// The key of the script
    key: ScriptKey,
    /// The file name of the script, `<name>.sql`
    file_name: String,
    /// The editor session of the script
    session: SessionHandle,
    /// Names the session, a script that moved to another connection has a new one. Generations grow.
    session_generation: u64,
    /// The connection the script runs on
    connection: Rc<ScriptConnection>,
    /// The latest analysis, also the one of a failed analysis
    editor_update: Option<EditorUpdateT>,
    /// Names the editor update, every update that the script takes gets a new one (`next_revision`)
    editor_update_serial: u64,
    /// The serial of the update that brought the analysis of the script. The updates after it that left the analysis
    /// out hold the same analysis, an editor that holds one of them holds this analysis.
    analysis_serial: u64,
    /// The version of the catalog right after the script published its analysis, if the analysis was current before:
    /// the own declarations of a script don't outdate its analysis
    published_version: Option<CatalogVersion>,
    /// Must the script be analyzed again, e.g. because another script of its catalog changed?
    analysis_outdated: bool,
    /// A staged rewrite to accept or reject
    pending_diff: Option<PendingDiff>,
    /// The last change of the text that the workbook made
    external_changes: Option<ExternalChanges>,
    /// The visualization of the script, compiled with its analysis or captured by its last run
    visualization: Option<ScriptVisualization>,
    /// Names the visualization, it moves when the visualization changes
    visualization_revision: u64,
    /// The processing statistics of the latest analyses with the revisions that name them, the oldest first
    statistics: std::collections::VecDeque<(u64, EditorProcessingStatisticsT)>,
    /// The latest query of the script
    latest_query_id: Option<u32>,
    /// The query whose result the script shows, independent of later queries that failed
    latest_result_query_id: Option<u32>,
    /// The stored file that holds the result that the script shows: the file that it was read from or written to. A run
    /// that reuses this file shows the result as it is instead of reading the file again.
    latest_result_file: Option<String>,
    /// The stored result of the script as the host last looked it up, none without one
    stored_result: Option<ScriptStoredResult>,
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
    /// Names the session of the script, a script that moved to another connection has a new one
    pub fn session_generation(&self) -> u64 {
        self.session_generation
    }
    pub fn connection(&self) -> &Rc<ScriptConnection> {
        &self.connection
    }
    pub fn editor_update(&self) -> Option<&EditorUpdateT> {
        self.editor_update.as_ref()
    }
    /// Names the editor update of the script, unique across the scripts of the runtime
    pub fn editor_update_serial(&self) -> u64 {
        self.editor_update_serial
    }
    /// The serial of the update that brought the analysis, it moves with every new analysis and stays while the
    /// updates leave the analysis out, e.g. when the cursor moves. It names the analysis across sessions.
    pub fn analysis_serial(&self) -> u64 {
        self.analysis_serial
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
    /// Names the visualization, an equal revision is the same visualization
    pub fn visualization_revision(&self) -> u64 {
        self.visualization_revision
    }
    pub fn statistics(&self) -> impl Iterator<Item = &EditorProcessingStatisticsT> {
        self.statistics.iter().map(|(_, statistics)| statistics)
    }
    /// The processing statistics with the revisions that name them, the oldest first
    pub fn statistics_with_revisions(&self) -> impl Iterator<Item = (u64, &EditorProcessingStatisticsT)> {
        self.statistics.iter().map(|(revision, statistics)| (*revision, statistics))
    }

    /// Replace the visualization, returns whether it changed
    fn set_visualization(&mut self, visualization: Option<ScriptVisualization>) -> bool {
        if self.visualization == visualization {
            return false;
        }
        self.visualization = visualization;
        self.visualization_revision = next_revision();
        true
    }

    /// Record the processing statistics of an update that analyzed the script
    fn record_statistics(&mut self, update: &EditorUpdateT) {
        if !update.analysis_updated {
            return;
        }
        if let Some(statistics) = &update.processing_statistics {
            self.statistics.push_back((next_revision(), (**statistics).clone()));
            while self.statistics.len() > STATISTICS_HISTORY_LIMIT {
                self.statistics.pop_front();
            }
        }
    }

    /// Hold an editor update, it gets a new serial. An update that leaves the analysis out keeps the analysis serial.
    fn hold_update(&mut self, update: EditorUpdateT) {
        self.editor_update_serial = next_revision();
        if !update.analysis_omitted {
            self.analysis_serial = self.editor_update_serial;
        }
        self.editor_update = Some(update);
    }

    /// Take the analysis of an update as the analysis of the script
    fn take_analysis(&mut self, update: EditorUpdateT) {
        self.record_statistics(&update);
        self.hold_update(update);
        self.analysis_outdated = false;
        self.compile_visualization();
    }
    pub fn latest_query_id(&self) -> Option<u32> {
        self.latest_query_id
    }
    pub fn latest_result_query_id(&self) -> Option<u32> {
        self.latest_result_query_id
    }
    pub fn latest_result_file(&self) -> Option<&str> {
        self.latest_result_file.as_deref()
    }
    pub fn stored_result(&self) -> Option<&ScriptStoredResult> {
        self.stored_result.as_ref()
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

    /// Is the analysis outdated? The one predicate of the runtime: runs, the views, the analyses of the scripts that
    /// the editors show and the stored results ask it. The flag marks the changes that the workbook knows about, the
    /// session catches the ones it missed: the text changed since the analysis, or the analysis is no longer current
    /// with the catalog, as the planner checks it. The publish of the script itself leaves its analysis current. A
    /// failed analysis is outdated once the text or the catalog changed, analyzing the same text against the same
    /// catalog fails again. A busy session or catalog is outdated, its state can't be checked.
    pub fn is_analysis_outdated(&self) -> bool {
        if self.analysis_outdated {
            return true;
        }
        let Some(update) = &self.editor_update else {
            return true;
        };
        let (Ok(session), Ok(catalog)) = (self.session.try_borrow(), self.connection.catalog.try_borrow()) else {
            return true;
        };
        if update.text_version != session.text_version() {
            return true;
        }
        if update.status == EditorUpdateStatus::OK && update.analysis_available {
            !self.current_by_own_publish(&session, &catalog) && !session.is_analysis_current(&catalog)
        } else {
            update.catalog_revision != catalog.version() as u64
        }
    }

    /// Is the analysis current with the catalog because the catalog moved past its snapshot only by the publish of the
    /// script itself? A script resolves its own declarations from its analysis, never from the catalog.
    fn current_by_own_publish(&self, session: &ScriptSession, catalog: &Catalog) -> bool {
        self.published_version == Some(catalog.version())
            && session.script().current_analysis().is_some()
            && session.script().table_parameters_current()
    }

    /// Publish the analysis of the script into the catalog of its connection, returns whether the catalog changed.
    /// An analysis that was current before its own publish stays current with the catalog after it.
    fn publish(&mut self) -> bool {
        let (Ok(mut session), Ok(mut catalog)) =
            (self.session.try_borrow_mut(), self.connection.catalog.try_borrow_mut())
        else {
            return false;
        };
        let version = catalog.version();
        let current = session.is_analysis_current(&catalog);
        // Publishing fails only without an analysis
        let _ = session.load_into_catalog(&mut catalog, CatalogLayer::SESSION);
        self.published_version = current.then(|| catalog.version());
        catalog.version() != version
    }

    /// Analyze the script and publish its declarations into the catalog of its connection. A failed analysis is kept
    /// on the script instead of returned: analyzing the same text against the same catalog fails again, and a change
    /// of either marks the script outdated. Returns whether the script analyzed, a busy session or catalog doesn't.
    fn analyze(&mut self) -> bool {
        let update = {
            let (Ok(mut session), Ok(catalog)) = (self.session.try_borrow_mut(), self.connection.catalog.try_borrow())
            else {
                return false;
            };
            session.analyze(&catalog)
        };
        let published = update.status == EditorUpdateStatus::OK && update.analysis_available;
        self.take_analysis(update);
        self.published_version = None;
        if published {
            self.publish();
        }
        true
    }

    /// Compile the visualization of the script for its analysis, none without an analysis
    fn compile_visualization(&mut self) {
        let available = self.editor_update.as_ref().is_some_and(|update| update.analysis_available);
        let visualization = if available {
            let config = execution_compilation_config(self.connection.dialect());
            let compiled = self.session.borrow_mut().compile_query(&self.connection.catalog.borrow(), &config);
            let valid = compiled.errors.as_ref().is_none_or(Vec::is_empty)
                && compiled.kind == ScriptCompilationStatementKind::VISUALIZE;
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
        self.set_visualization(visualization);
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
}

/// A session of a text in a catalog of its own, it never reaches the catalogs of the workbook. An action computes the
/// texts that it writes on it before it changes a script, a failure leaves the scripts as they are.
struct Scratch {
    catalog: Catalog,
    session: ScriptSession,
}

impl Scratch {
    fn new(text: &str, offset_unit: EditorOffsetUnit) -> Result<Self> {
        let catalog = Catalog::new();
        let mut session = ScriptSession::new(&catalog, offset_unit)?;
        let update = session.replace_text(&catalog, session.text_version(), text);
        if update.status != EditorUpdateStatus::OK {
            return Err(Error::invalid_argument("cannot replace the text of the script"));
        }
        Ok(Self { catalog, session })
    }

    /// The statement that a chart of the text visualizes, the last statement. None without statements. Errors of the
    /// compilation, e.g. of other statements, don't matter, a rewrite of a tag refuses a script it can't parse.
    fn chart_statement_id(&mut self) -> Option<usize> {
        let compiled = self.session.compile_query(&self.catalog, &chart_compilation_config());
        (compiled.terminal_statement_id != NO_STATEMENT).then_some(compiled.terminal_statement_id as usize)
    }

    /// The diff of a staged rewrite from the text to a new text
    fn diff_to(&mut self, text: &str) -> Result<ScriptDiffT> {
        let update = self.session.analyze(&self.catalog);
        if update.status != EditorUpdateStatus::OK || !update.analysis_available {
            return Err(Error::invalid_argument("cannot analyze the script for a diff"));
        }
        let mut target = Script::new(&self.catalog);
        target.replace_text(text);
        target.parse();
        self.session.diff(&target)
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
    /// The params of the connection
    pub params: ConnectionParams,
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
    /// Rename the file of an attachment, its contents are unchanged
    RenameDataFile { from: String, to: String },
    /// Delete the file of an attachment
    DeleteDataFile { file_name: String },
    /// Write the script list of the workbook file
    WriteScriptList(ScriptList),
    /// Write the properties of the workbook file: its name, the view it opens in, whether it is ephemeral and its origin
    WriteProperties {
        name: Option<String>,
        default_view: WorkbookDefaultView,
        ephemeral: bool,
        origin: Option<WorkbookOrigin>,
    },
    /// Replace connections in the workbook file with another one
    PatchConnection { connection_id: String, params: Option<ConnectionParams>, replaces: Vec<String> },
}

/// Names an editor update of a script: the session it came from and its serial (`WorkbookScript::editor_update_serial`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorUpdateId {
    pub session_generation: u64,
    pub serial: u64,
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
    /// drops the diff, a rewrite of a blank script is not staged.
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
    /// Apply an event of the editor of a script, e.g. a typed character or a moved cursor. The event names the text
    /// version that the editor shows, an event of an editor that missed a change of the text is stale. An edit of the
    /// user accepts a staged rewrite. `known` names the update that the editor holds, the update leaves out the
    /// analysis if the editor holds the one of the script.
    ApplyEditorEvent { key: ScriptKey, event: EditorEventT, known: Option<EditorUpdateId> },
    /// Analyze a script if its analysis is outdated
    AnalyzeOutdatedScript { key: ScriptKey },
    /// The catalog of a connection changed, its scripts must be analyzed again
    CatalogDidUpdate { connection_id: String },
    /// The profile of a connection changed, e.g. its dialect or its default schema: the visualizations of its scripts
    /// compile again and the workbook derives again
    ConnectionProfileChanged { connection_id: String },
    /// The visualization that a run of a script captured with its query, it replaces the compiled one
    SetExecutionVisualization { key: ScriptKey, visualization: Option<ScriptVisualization> },
    /// A query of a script started
    RegisterQuery { key: ScriptKey, query_id: u32 },
    /// A query of a script produced the result that the script shows, with the stored file that holds it: the file that
    /// it was read from or that its result is written to, none for a result without one. An older query never replaces
    /// a newer result.
    RegisterScriptResult { key: ScriptKey, query_id: u32, file: Option<String> },
    /// The stored result of a script as the host looked it up, none for a script without one
    SetStoredResult { key: ScriptKey, stored: Option<ScriptStoredResult> },
    /// Rename the workbook, an empty name removes the name
    RenameWorkbook { name: Option<String> },
    /// Pick the view that the workbook opens in
    SetDefaultView { view: WorkbookDefaultView },
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
    /// Rename an attachment like a script: the name is a display name, `.parquet` is added unless it has it, and the
    /// name takes no name of a script or another attachment, `sales` becomes `sales-2` then. The scripts that read it
    /// read the new name, the file is renamed (`WorkbookEffect::RenameDataFile`). A name that is no plain file name
    /// changes nothing.
    RenameAttachment { file_name: String, name: String },
    /// Detach an attachment: the workbook no longer lists it and its file is deleted
    /// (`WorkbookEffect::DeleteDataFile`). The scripts that read it keep their text, their references find nothing then.
    DetachAttachment { file_name: String },
    /// Set where the workbook came from, none removes the origin. An origin that isn't read-only makes a read-only
    /// workbook a workbook of its own.
    SetOrigin { origin: Option<WorkbookOrigin> },
}

impl WorkbookAction {
    /// Does a read-only workbook refuse the action? These change the scripts or the names of the workbook: every action
    /// that writes a script. Running scripts, moving the cursor and the connections of the workbook stay, they don't
    /// change what the workbook says.
    fn changes_content(&self) -> bool {
        match self {
            WorkbookAction::CreateScript { .. }
            | WorkbookAction::DeleteScript { .. }
            | WorkbookAction::RenameScript { .. }
            | WorkbookAction::ReorderScripts { .. }
            | WorkbookAction::SetScriptText { .. }
            | WorkbookAction::SetScriptVisSpec { .. }
            | WorkbookAction::AcceptPendingDiff { .. }
            | WorkbookAction::RejectPendingDiff { .. }
            | WorkbookAction::RenameWorkbook { .. }
            | WorkbookAction::SetDefaultView { .. }
            | WorkbookAction::RenameAttachment { .. }
            | WorkbookAction::DetachAttachment { .. }
            | WorkbookAction::SetWorkbookInput { .. }
            | WorkbookAction::SetScriptConnection { .. } => true,
            WorkbookAction::ApplyEditorEvent { event, .. } => {
                event.changes.as_ref().is_some_and(|changes| !changes.is_empty())
            }
            _ => false,
        }
    }

    /// Do the table parameters follow the action? They read the results of the scripts and the attachments, actions
    /// that leave both as they are don't derive them again. An editor event derives them only if it changed the text
    /// or the analysis of its script, see `take_editor_update`.
    fn derives_table_parameters(&self) -> bool {
        !matches!(
            self,
            WorkbookAction::ApplyEditorEvent { .. }
                | WorkbookAction::AcceptPendingDiff { .. }
                | WorkbookAction::CatalogDidUpdate { .. }
                | WorkbookAction::ConnectionProfileChanged { .. }
                | WorkbookAction::SetExecutionVisualization { .. }
                | WorkbookAction::RegisterQuery { .. }
                | WorkbookAction::RegisterScriptResult { .. }
                | WorkbookAction::SetStoredResult { .. }
                | WorkbookAction::RenameWorkbook { .. }
                | WorkbookAction::SetDefaultView { .. }
                | WorkbookAction::SetPendingConnection { .. }
                | WorkbookAction::DetachConnection { .. }
                | WorkbookAction::SetOrigin { .. }
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
    /// The update of an editor event as it goes back to the editor: an analysis that the editor holds is left out.
    /// None if the update is the one that the script holds now (`WorkbookScript::editor_update`).
    pub editor_update: Option<EditorUpdateT>,
    /// The key of the script that the action created
    pub created: Option<ScriptKey>,
}

/// What a plan of a run covers
#[derive(Default)]
pub struct RunPlanRequest<'a> {
    /// The target scripts by their indexes in feed order, every script without
    pub targets: Option<&'a [u32]>,
    /// The scripts whose materialized results the host provides
    pub materialized: &'a [u32],
    /// The directory that the host mounts materialized results in
    pub mount_prefix: &'a str,
    /// The files of the materialized results of scripts below the mount prefix, by script index
    pub materialization_files: &'a [(u32, String)],
    /// Plan every script and leave out what can't be planned instead of failing (`PlanScope::Tolerant`), for a run of
    /// the whole workbook
    pub tolerant: bool,
}

/// The scripts of a workbook
pub struct Workbook {
    /// The id of the workbook
    id: String,
    /// The name of the workbook, independent of its connections
    name: Option<String>,
    /// The view that the workbook opens in
    default_view: WorkbookDefaultView,
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
    /// Where the workbook came from
    origin: Option<WorkbookOrigin>,
    /// The offset unit of the editors
    offset_unit: EditorOffsetUnit,
    /// Did an editor event of the running action change what the table parameters read?
    table_parameters_outdated: bool,
    /// The connections whose catalogs the scripts changed, see `take_published`
    published: Vec<String>,
    /// The revision of the workbook, it changes with every change
    revision: u64,
}

impl Workbook {
    /// An empty workbook. A workbook without scripts has a pending connection, its first script runs on it.
    pub fn new(
        id: &str,
        name: Option<String>,
        pending_connection: Option<Rc<ScriptConnection>>,
        offset_unit: EditorOffsetUnit,
    ) -> Self {
        Self {
            id: id.to_string(),
            name,
            default_view: WorkbookDefaultView::Feed,
            ephemeral: false,
            pending_connection,
            scripts: Vec::new(),
            attachments: None,
            table_parameters: None,
            origin: None,
            offset_unit,
            table_parameters_outdated: false,
            published: Vec::new(),
            revision: next_revision(),
        }
    }

    /// Where the workbook came from
    pub fn origin(&self) -> Option<&WorkbookOrigin> {
        self.origin.as_ref()
    }

    /// Is the workbook a read-only look at its origin?
    pub fn is_read_only(&self) -> bool {
        self.origin.as_ref().is_some_and(|origin| origin.read_only)
    }

    /// Set the pending connection that storage holds when a workbook is restored, the connection of a workbook without
    /// scripts
    pub fn set_stored_pending_connection(&mut self, connection: Option<Rc<ScriptConnection>>) {
        self.pending_connection = connection;
        self.revision = next_revision();
    }

    /// Set the view that storage holds when a workbook is restored
    pub fn set_stored_default_view(&mut self, view: WorkbookDefaultView) {
        self.default_view = view;
        self.revision = next_revision();
    }

    /// Set the origin that storage holds when a workbook is restored
    pub fn set_stored_origin(&mut self, origin: Option<WorkbookOrigin>) {
        self.origin = origin;
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
                    && script.persisted_connection_id()
                        == stored.unresolved_connection_id.as_deref().unwrap_or(&stored.connection.connection_id)
                    && script.text() == stored.sql
            })
    }

    /// Replace the scripts with the ones that storage holds, e.g. after the files changed outside of the app. Writes
    /// nothing back. Scripts that stay at their file name on their connection keep their session and their queries, a
    /// script that moved to another connection keeps its key. Every new session is created before anything changes, a
    /// failure leaves the workbook as it is. Returns whether anything changed.
    pub fn replace_from_storage(&mut self, stored: Vec<StoredScript>) -> Result<bool> {
        if self.is_read_only() {
            return Err(Error::invalid_argument("a read-only workbook can't be changed"));
        }
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
            let existing = self.scripts.iter().enumerate().find(|(_, script)| script.file_name == entry.name);
            let script = match existing {
                Some((_, script)) if script.connection.connection_id == entry.connection.connection_id => None,
                Some((position, _)) => Some(self.moved_script(position, entry.connection.clone())?),
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
        let mut previous: Vec<Option<WorkbookScript>> =
            std::mem::take(&mut self.scripts).into_iter().map(Some).collect();
        let mut changed = false;
        // A failure from here on is reported once the workbook is whole again
        let mut failure = None;
        for (entry, created) in unique.into_iter().zip(created) {
            let existing = previous
                .iter_mut()
                .find(|script| script.as_ref().is_some_and(|script| script.file_name == entry.name))
                .and_then(Option::take);
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

    /// The file names of the attachments whose table parameter has the name of a script, also in another ASCII case: a
    /// table parameter of the name is ambiguous then (`colliding_names`). In the order of the attachments.
    pub fn attachments_named_like_scripts(&self) -> Vec<String> {
        let attachments = self.attachments.as_deref().unwrap_or_default();
        let scripts = self.scripts.len();
        let names = self
            .scripts
            .iter()
            .map(|script| script_display_name(&script.file_name))
            .chain(attachments.iter().map(|attachment| attachment.name.as_str()));
        let mut colliding: Vec<usize> = colliding_names(names)
            .into_iter()
            .filter(|group| group.iter().any(|&i| i < scripts))
            .flatten()
            .filter_map(|i| i.checked_sub(scripts))
            .collect();
        colliding.sort_unstable();
        colliding
            .into_iter()
            .filter_map(|i| attachments.get(i))
            .map(|attachment| attachment.file_name.clone())
            .collect()
    }

    /// The names of the table parameters of the attachments, which no script may take
    fn attachment_names(&self) -> Vec<&str> {
        self.attachments.iter().flatten().map(|attachment| attachment.name.as_str()).collect()
    }

    /// Run a function with a plan request of the scripts and attachments of the workbook
    fn with_plan_request<R>(&self, f: impl FnOnce(&SessionPlanRequest) -> R) -> R {
        self.with_run_plan_request(&RunPlanRequest::default(), f)
    }

    /// Run a function with a plan request of the scripts and attachments of the workbook for a run: its scope, the
    /// scripts whose materialized results the host provides, the mount prefix and the files of the materialized results
    fn with_run_plan_request<R>(&self, run: &RunPlanRequest, f: impl FnOnce(&SessionPlanRequest) -> R) -> R {
        self.with_run_planner(run, |request, _| f(request))
    }

    /// Run a function with a plan request of the scripts and attachments of the workbook and the sessions of its
    /// scripts in feed order, e.g. to derive the views of the planner in the offset unit of each session
    pub fn with_planner<R>(&self, f: impl FnOnce(&SessionPlanRequest, &[Ref<ScriptSession>]) -> R) -> R {
        self.with_run_planner(&RunPlanRequest::default(), f)
    }

    /// Run a function with a plan request for a run and the sessions of the scripts
    fn with_run_planner<R>(
        &self,
        run: &RunPlanRequest,
        f: impl FnOnce(&SessionPlanRequest, &[Ref<ScriptSession>]) -> R,
    ) -> R {
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
        let profiles: Vec<Ref<ScriptConnectionProfile>> =
            connections.iter().map(|connection| connection.profile()).collect();
        let planner_connections: Vec<PlannerConnection> = connections
            .iter()
            .zip(&catalogs)
            .zip(&profiles)
            .map(|((connection, catalog), profile)| PlannerConnection {
                id: &connection.connection_id,
                kind: if profile.local { ConnectionKind::Local } else { ConnectionKind::Remote },
                catalog,
                dialect: profile.dialect,
                default_database: &profile.default_database,
                default_schema: &profile.default_schema,
            })
            .collect();
        let sessions: Vec<Ref<ScriptSession>> = self.scripts.iter().map(|script| script.session.borrow()).collect();
        let planner_scripts: Vec<PlannerScript> = self
            .scripts
            .iter()
            .zip(&sessions)
            .zip(&script_connections)
            .enumerate()
            .map(|(index, ((script, session), connection))| PlannerScript {
                script: session.script(),
                name: script_display_name(&script.file_name),
                connection: *connection,
                current_by_own_publish: catalogs
                    .get(*connection as usize)
                    .is_some_and(|catalog| script.current_by_own_publish(session, catalog)),
                materialization_file: run
                    .materialization_files
                    .iter()
                    .find(|(script, _)| *script as usize == index)
                    .map(|(_, file)| file.as_str()),
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
        let request = SessionPlanRequest {
            connections: &planner_connections,
            scripts: &planner_scripts,
            scope: match (run.targets, run.tolerant) {
                (Some(targets), _) => PlanScope::Targets(targets),
                (None, true) => PlanScope::Tolerant,
                (None, false) => PlanScope::Session,
            },
            materialized: run.materialized,
            mount_prefix: run.mount_prefix,
            attachments: &planner_attachments,
            attachment_prefix: &attachment_prefix,
        };
        f(&request, &sessions)
    }

    /// Plan the scripts of the workbook for a run, with their analyses as they are
    pub fn plan_run(&self, run: &RunPlanRequest) -> ExecutionGraphT {
        self.with_run_plan_request(run, plan_session)
    }

    /// The dataflow of the scripts of the workbook, with their analyses as they are
    pub fn dataflow(&self) -> Dataflow {
        self.with_plan_request(derive_session_dataflow)
    }

    /// Analyze the scripts for a run: the scripts whose analysis is outdated analyze until none is, their declarations
    /// published into the catalogs of their connections. Scripts with current analyses stay as they are. Fails with
    /// the message of a script that doesn't analyze. Returns whether a script analyzed.
    pub fn analyze_for_run(&mut self) -> std::result::Result<bool, String> {
        let analyzed = self.analyze_outdated_scripts();
        for script in &self.scripts {
            let update = script.editor_update.as_ref();
            if !update.is_some_and(|update| update.status == EditorUpdateStatus::OK && update.analysis_available) {
                let message =
                    update.and_then(|update| update.status_message.clone()).filter(|message| !message.is_empty());
                return Err(message.unwrap_or_else(|| format!("Failed to analyze {}", script.file_name)));
            }
        }
        Ok(analyzed)
    }

    /// Analyze the scripts whose analysis is outdated, e.g. by a catalog update that landed since the preparation of
    /// a run. An analysis that publishes other declarations can outdate other scripts, they analyze in the next pass.
    /// Returns whether a script analyzed.
    pub fn analyze_outdated_scripts(&mut self) -> bool {
        let mut changed = false;
        for _pass in 0..=self.scripts.len() {
            let mut analyzed = false;
            for index in 0..self.scripts.len() {
                if self.scripts.get(index).is_some_and(WorkbookScript::is_analysis_outdated) {
                    analyzed |= self.analyze_at(index);
                }
            }
            if !analyzed {
                break;
            }
            changed = true;
        }
        if changed {
            self.revision = next_revision();
        }
        changed
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
                .map(|attachment| TableParameterAttachment {
                    name: &attachment.name,
                    columns: attachment.columns.as_deref(),
                })
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
    fn rewrite_renamed_references(
        &mut self,
        target: ReferenceTarget,
        name: &str,
        keep: Option<ScriptKey>,
    ) -> Result<Vec<ScriptKey>> {
        // A script that analyzes here changes for the views also when the rewrite fails below
        for index in 0..self.scripts.len() {
            let lags = self.scripts.get(index).is_some_and(|script| {
                let text_version = script.session.try_borrow().map(|session| session.text_version()).ok();
                script.editor_update.as_ref().map(|update| update.text_version) != text_version
            });
            if lags {
                self.analyze_at(index);
            }
        }
        let target_index = match target {
            ReferenceTarget::Script(file) => self.scripts.iter().position(|script| script.file_name == file),
            ReferenceTarget::Attachment(file) => {
                self.attachments.iter().flatten().position(|attachment| attachment.file_name == file)
            }
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
        // The new texts of all scripts first, a reference outside of its text fails the action before a script changed
        let mut rewrites: Vec<(usize, String, ExternalChanges)> = Vec::new();
        for (index, (script, spans)) in self.scripts.iter().zip(spans).enumerate() {
            if spans.is_empty() || Some(script.key) == keep {
                continue;
            }
            let from_text = script.text();
            let mut text = from_text.clone();
            let mut changes = Vec::with_capacity(spans.len());
            for (begin, end) in spans.iter().rev() {
                if *begin > *end || *end > text.len() || !text.is_char_boundary(*begin) || !text.is_char_boundary(*end)
                {
                    return Err(Error::invalid_argument("a reference outside of the text of its script"));
                }
                text.replace_range(*begin..*end, &reference);
            }
            for (begin, end) in &spans {
                let (Some(head), Some(span)) = (from_text.get(..*begin), from_text.get(*begin..*end)) else {
                    return Err(Error::invalid_argument("a reference outside of the text of its script"));
                };
                let from = text_length(head, unit);
                changes.push(TextChange { from, to: from + text_length(span, unit), insert: reference.clone() });
            }
            rewrites.push((index, text, ExternalChanges { from_text, changes }));
        }
        self.commit_texts(
            rewrites.iter().map(|(index, text, external)| (*index, text.as_str(), external.from_text.as_str())),
        )?;
        let mut rewritten = Vec::with_capacity(rewrites.len());
        for (index, _, external) in rewrites {
            let Some(script) = self.scripts.get_mut(index) else { continue };
            script.analyze();
            script.pending_diff = None;
            script.external_changes = Some(external);
            script.revision = next_revision();
            rewritten.push(script.key);
        }
        Ok(rewritten)
    }

    /// Replace the texts of scripts by their indexes, with the texts they hold now. A text that can't be replaced
    /// fails, the scripts replaced before it get their texts back: all scripts change or none.
    fn commit_texts<'t>(&mut self, texts: impl Iterator<Item = (usize, &'t str, &'t str)> + Clone) -> Result<()> {
        for (done, (index, text, _)) in texts.clone().enumerate() {
            let replaced = match self.scripts.get_mut(index) {
                Some(script) => script.replace_text(text),
                None => Err(Error::invalid_argument("a rewrite of an unknown script")),
            };
            if let Err(error) = replaced {
                for (index, _, previous) in texts.take(done) {
                    if let Some(script) = self.scripts.get_mut(index) {
                        let _ = script.replace_text(previous);
                    }
                }
                return Err(error);
            }
        }
        Ok(())
    }

    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    /// The view that the workbook opens in
    pub fn default_view(&self) -> WorkbookDefaultView {
        self.default_view
    }
    pub fn ephemeral(&self) -> bool {
        self.ephemeral
    }
    pub fn set_ephemeral(&mut self, ephemeral: bool) {
        self.ephemeral = ephemeral;
    }
    /// The ids of the connections that the workbook uses: of its scripts in feed order, then its pending connection. A
    /// connection that a workbook uses is never deleted.
    pub fn connection_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        let pending = self.pending_connection().map(|pending| &pending.connection_id);
        for id in self.scripts().iter().map(|script| &script.connection().connection_id).chain(pending) {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }
        ids
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
                self.scripts.get(neighbor).map(|script| script.connection.clone())
            }
            _ => {
                self.pending_connection.clone().or_else(|| self.scripts.last().map(|script| script.connection.clone()))
            }
        }
    }

    /// The script list of the workbook file. A workbook without scripts holds the pending connection, which comes
    /// first among the copies.
    pub fn script_list(&self) -> ScriptList {
        let scripts = self
            .scripts
            .iter()
            .map(|script| ScriptListEntry {
                name: script.file_name.clone(),
                connection_id: script.persisted_connection_id().to_string(),
            })
            .collect();
        let mut connections: Vec<ConnectionCopy> = Vec::new();
        let pending = self.pending_connection.iter().filter(|_| self.scripts.is_empty());
        for connection in pending.chain(self.scripts.iter().map(|script| &script.connection)) {
            if let Some(params) = connection.params() {
                if !connections.iter().any(|copy| copy.connection_id == connection.connection_id) {
                    connections.push(ConnectionCopy { connection_id: connection.connection_id.clone(), params });
                }
            }
        }
        ScriptList { scripts, connections }
    }

    /// Apply an action. A failed action leaves the workbook unchanged.
    pub fn apply(&mut self, action: WorkbookAction) -> Result<WorkbookOutcome> {
        let mut outcome = WorkbookOutcome::default();
        if self.is_read_only() && action.changes_content() {
            return Err(Error::invalid_argument("a read-only workbook can't be changed"));
        }
        let derives_table_parameters = action.derives_table_parameters();
        self.table_parameters_outdated = false;
        match action {
            WorkbookAction::SetOrigin { origin } => {
                if origin != self.origin {
                    self.origin = origin;
                    outcome.changed = true;
                    outcome.effects.push(self.properties_write());
                }
            }
            WorkbookAction::CreateScript { index, text, base, connection } => {
                self.create(index, text, &base, connection, &mut outcome)?
            }
            WorkbookAction::DeleteScript { file_name } => self.delete(&file_name, &mut outcome),
            WorkbookAction::RenameScript { file_name, new_name } => self.rename(&file_name, &new_name, &mut outcome)?,
            WorkbookAction::ReorderScripts { order } => self.reorder(&order, &mut outcome),
            WorkbookAction::SetScriptText { key, text, with_diff } => {
                self.set_text(key, &text, with_diff, &mut outcome)?
            }
            WorkbookAction::AcceptPendingDiff { key } => {
                if let Some(script) = self.script_mut(key).filter(|script| script.pending_diff.is_some()) {
                    // The script holds the new text already
                    script.pending_diff = None;
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::RejectPendingDiff { key } => {
                let prior = self
                    .script(key)
                    .and_then(|script| script.pending_diff.as_ref())
                    .map(|diff| diff.prior_text.clone());
                if let Some(prior) = prior {
                    self.set_text(key, &prior, false, &mut outcome)?;
                }
            }
            WorkbookAction::SetScriptVisSpec { key, spec } => self.set_vis_spec(key, &spec, &mut outcome)?,
            WorkbookAction::SetWorkbookInput { name, literal, keys } => {
                self.set_input(&name, &literal, &keys, &mut outcome)?
            }
            WorkbookAction::ApplyEditorEvent { key, event, known } => {
                self.apply_editor_event(key, event, known, &mut outcome)?
            }
            WorkbookAction::ConnectionProfileChanged { connection_id } => {
                self.connection_profile_changed(&connection_id, &mut outcome)
            }
            WorkbookAction::AnalyzeOutdatedScript { key } => self.analyze_outdated(key, &mut outcome),
            WorkbookAction::CatalogDidUpdate { connection_id } => {
                for script in self.scripts.iter_mut().filter(|script| script.connection.connection_id == connection_id)
                {
                    if !script.analysis_outdated {
                        script.analysis_outdated = true;
                        script.revision = next_revision();
                        outcome.changed = true;
                    }
                }
            }
            WorkbookAction::SetExecutionVisualization { key, visualization } => {
                if let Some(script) = self.script_mut(key).filter(|script| script.visualization != visualization) {
                    script.set_visualization(visualization);
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
            WorkbookAction::RegisterScriptResult { key, query_id, file } => {
                if let Some(script) = self.script_mut(key) {
                    // Query ids grow, an older overlapping query must not replace a newer result
                    if script.latest_result_query_id.is_none_or(|latest| latest < query_id) {
                        script.latest_result_query_id = Some(query_id);
                        script.latest_result_file = file;
                        script.revision = next_revision();
                        outcome.changed = true;
                    }
                }
            }
            WorkbookAction::SetStoredResult { key, stored } => {
                if let Some(script) = self.script_mut(key).filter(|script| script.stored_result != stored) {
                    script.stored_result = stored;
                    script.revision = next_revision();
                    outcome.changed = true;
                }
            }
            WorkbookAction::SetScriptConnection { file_name, connection } => {
                self.set_script_connection(&file_name, connection, &mut outcome)?
            }
            WorkbookAction::SetPendingConnection { connection } => {
                self.set_pending_connection(connection, &mut outcome)
            }
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
                let attachment =
                    self.attachments.iter_mut().flatten().find(|a| a.file_name == file_name && a.stamp() == stamp);
                if let Some(attachment) = attachment.filter(|attachment| attachment.columns.as_ref() != Some(&columns))
                {
                    attachment.columns = Some(columns);
                    outcome.changed = true;
                }
            }
            WorkbookAction::RenameAttachment { file_name, name } => {
                self.rename_attachment(&file_name, &name, &mut outcome)?
            }
            WorkbookAction::DetachAttachment { file_name } => {
                if let Some(attachments) = self.attachments.as_mut() {
                    let before = attachments.len();
                    attachments.retain(|attachment| attachment.file_name != file_name);
                    if attachments.len() != before {
                        outcome.changed = true;
                        outcome.effects.push(WorkbookEffect::DeleteDataFile { file_name });
                    }
                }
            }
            WorkbookAction::RenameWorkbook { name } => {
                let name = name.map(|name| name.trim().to_string()).filter(|name| !name.is_empty());
                if name != self.name {
                    self.name = name;
                    outcome.changed = true;
                    outcome.effects.push(self.properties_write());
                }
            }
            WorkbookAction::SetDefaultView { view } => {
                if view != self.default_view {
                    self.default_view = view;
                    outcome.changed = true;
                    outcome.effects.push(self.properties_write());
                }
            }
        }
        if outcome.changed {
            // The table parameters read the results of the scripts and the attachments
            if derives_table_parameters || self.table_parameters_outdated {
                self.publish_table_parameters();
            }
            self.revision = next_revision();
        }
        self.table_parameters_outdated = false;
        Ok(outcome)
    }

    fn rename_attachment(&mut self, file_name: &str, requested: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(attachments) =
            self.attachments.as_deref().filter(|attachments| attachments.iter().any(|a| a.file_name == file_name))
        else {
            return Ok(());
        };
        // The name takes no name of a script or another attachment
        let script_names: Vec<&str> =
            self.scripts.iter().map(|script| script_display_name(&script.file_name)).collect();
        let Some(new_file_name) = renamed_attachment_file_name(file_name, requested, script_names, attachments) else {
            return Ok(());
        };
        let Some(name) = attachment_parameter_name(&new_file_name).map(str::to_string) else {
            return Ok(());
        };
        if new_file_name == file_name {
            return Ok(());
        }
        // The scripts that read the attachment read the new name, a failed rewrite renames nothing
        let rewritten = self.rewrite_renamed_references(ReferenceTarget::Attachment(file_name), &name, None)?;
        self.after_rewrite(&rewritten, outcome);
        if let Some(attachment) =
            self.attachments.iter_mut().flatten().find(|attachment| attachment.file_name == file_name)
        {
            attachment.file_name = new_file_name.clone();
            attachment.name = name;
        }
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::RenameDataFile { from: file_name.to_string(), to: new_file_name });
        Ok(())
    }

    /// Mark the readers of rewritten scripts outdated and write the rewritten scripts
    fn after_rewrite(&mut self, rewritten: &[ScriptKey], outcome: &mut WorkbookOutcome) {
        for key in rewritten {
            if let Some(script) = self.script(*key) {
                let connection = script.connection.clone();
                outcome.effects.push(Self::write_script(script));
                self.mark_others_outdated(*key, &connection);
            }
        }
        outcome.changed |= !rewritten.is_empty();
    }

    fn script_mut(&mut self, key: ScriptKey) -> Option<&mut WorkbookScript> {
        self.scripts.iter_mut().find(|script| script.key == key)
    }

    fn properties_write(&self) -> WorkbookEffect {
        WorkbookEffect::WriteProperties {
            name: self.name.clone(),
            default_view: self.default_view,
            ephemeral: self.ephemeral,
            origin: self.origin.clone(),
        }
    }

    /// Create the session of a script on a connection. A script that moves to another connection keeps its key.
    fn create_script(
        &self,
        file_name: &str,
        connection: Rc<ScriptConnection>,
        key: Option<ScriptKey>,
    ) -> Result<WorkbookScript> {
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
            session_generation: next_revision(),
            connection,
            editor_update: None,
            editor_update_serial: next_revision(),
            analysis_serial: 0,
            published_version: None,
            analysis_outdated: true,
            pending_diff: None,
            external_changes: None,
            visualization: None,
            visualization_revision: next_revision(),
            statistics: Default::default(),
            latest_query_id: None,
            latest_result_query_id: None,
            latest_result_file: None,
            stored_result: None,
            unresolved_connection_id: None,
            revision: next_revision(),
        })
    }

    /// Mark the other scripts in the catalog of a script outdated, they may resolve against its declarations. Scripts
    /// in other catalogs can't reference it. The catalog is shared with the other workbooks on the connection, the
    /// host marks their scripts outdated with the connections that `take_published` returns.
    fn mark_others_outdated(&mut self, changed: ScriptKey, connection: &ScriptConnection) {
        for script in self.scripts.iter_mut() {
            if script.key != changed
                && !script.analysis_outdated
                && Rc::ptr_eq(&script.connection.catalog, &connection.catalog)
            {
                script.analysis_outdated = true;
                script.revision = next_revision();
            }
        }
        if !self.published.contains(&connection.connection_id) {
            self.published.push(connection.connection_id.clone());
        }
    }

    /// The connections whose catalogs the scripts of the workbook changed since the last call. The scripts of the
    /// other workbooks on them resolve against the change, the host marks them outdated.
    pub fn take_published(&mut self) -> Vec<String> {
        std::mem::take(&mut self.published)
    }

    /// Analyze the script at an index, its revision moves. A publish that changed the catalog outdates the other
    /// scripts on it. Returns whether the script analyzed.
    fn analyze_at(&mut self, index: usize) -> bool {
        let Some(script) = self.scripts.get_mut(index) else { return false };
        let connection = script.connection.clone();
        let version = connection.catalog.try_borrow().map(|catalog| catalog.version()).ok();
        let started = crate::perf_marks::begin();
        let analyzed = script.analyze();
        crate::perf_marks::end("core:analyze", || script.file_name.clone(), started);
        if !analyzed {
            return false;
        }
        script.revision = next_revision();
        let key = script.key;
        if connection.catalog.try_borrow().map(|catalog| catalog.version()).ok() != version {
            self.mark_others_outdated(key, &connection);
        }
        true
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
        let file_name = script_file_name(
            base,
            self.scripts.iter().map(|script| script.file_name.as_str()),
            self.attachment_names(),
        );
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
            self.mark_others_outdated(key, &connection);
        }
        // The pending connection is taken by the script that runs on it
        if self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == connection.connection_id) {
            self.pending_connection = None;
        }
        outcome.changed = true;
        outcome.created = Some(key);
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
        self.mark_others_outdated(deleted.key, &deleted.connection);
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
        let Some(script) = self.scripts.iter().find(|script| script.file_name == file_name) else {
            return Ok(());
        };
        if new_file_name == file_name {
            // The same name writes the unchanged text
            outcome.effects.push(Self::write_script(script));
            return Ok(());
        }
        // The scripts that read the script read the new name. A script that reads itself is a cycle, it keeps the name.
        let key = script.key;
        let rewritten = self.rewrite_renamed_references(ReferenceTarget::Script(file_name), &base, Some(key))?;
        // The rewrite keeps the scripts, the script is found again by its key
        let Some(script) = self.scripts.iter_mut().find(|script| script.key == key) else {
            return Ok(());
        };
        script.file_name = new_file_name.clone();
        script.revision = next_revision();
        // The other scripts read the script by its name
        script.analyze();
        let connection = script.connection.clone();
        self.mark_others_outdated(key, &connection);
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
        let mut scripts: Vec<Option<WorkbookScript>> =
            std::mem::take(&mut self.scripts).into_iter().map(Some).collect();
        self.scripts = ordered.into_iter().filter_map(|index| scripts.get_mut(index).and_then(Option::take)).collect();
        outcome.changed = true;
        // The order lives in the workbook file, the script files stay untouched
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
    }

    fn set_text(&mut self, key: ScriptKey, text: &str, with_diff: bool, outcome: &mut WorkbookOutcome) -> Result<()> {
        let unit = self.offset_unit;
        let Some(script) = self.script_mut(key) else {
            return Ok(());
        };
        let current = script.text();
        // A rewrite of a script with a staged rewrite restages it against the text before the staged one
        let prior = match (&script.pending_diff, with_diff) {
            (Some(pending), true) => pending.prior_text.clone(),
            _ => current.clone(),
        };
        // The diff is computed on a session of the prior text of its own, the script changes only with the new text. A
        // failed diff never blocks the rewrite, the rewrite is just not staged then, nor is a rewrite of a blank script:
        // there is nothing to keep.
        let pending_diff = (with_diff && text != prior && !prior.trim().is_empty())
            .then(|| Scratch::new(&prior, unit).and_then(|mut scratch| scratch.diff_to(text)).ok())
            .flatten()
            .map(|diff| PendingDiff { prior_text: prior, diff, revision: next_revision() });
        script.replace_text(text)?;
        script.analyze();
        script.pending_diff = pending_diff;
        // A mounted editor applies the change and keeps its cursor and its history
        script.external_changes =
            Some(ExternalChanges { changes: vec![text_change(&current, text, unit)], from_text: current });
        script.revision = next_revision();
        let (connection, effect) = (script.connection.clone(), Self::write_script(script));
        // The text was published into the catalog, the other scripts resolve against it again
        self.mark_others_outdated(key, &connection);
        outcome.changed = true;
        outcome.effects.push(effect);
        Ok(())
    }

    fn set_vis_spec(&mut self, key: ScriptKey, spec: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script(key) else {
            return Ok(());
        };
        let current = script.text();
        let prior = script.pending_diff.as_ref().map_or_else(|| current.clone(), |pending| pending.prior_text.clone());
        // The diff is computed against the text before the first edit, the tag is rewritten in that text on a session
        // of its own. The script changes only with the rewritten text.
        let mut scratch = Scratch::new(&prior, self.offset_unit)?;
        let rewritten = scratch
            .chart_statement_id()
            .and_then(|statement| {
                let renderer = VisRenderer::from_parts("vegalite", spec).ok()?;
                scratch.session.rewrite_vis_renderer(statement, Some(&renderer), true).ok()
            })
            .filter(|text| *text != current);
        match rewritten {
            // A spec that restores the chart before the first edit drops the diff
            Some(text) => self.set_text(key, &text, true, outcome),
            // The script stays as it is
            None => Ok(()),
        }
    }

    fn set_input(
        &mut self,
        name: &str,
        literal: &str,
        keys: &[ScriptKey],
        outcome: &mut WorkbookOutcome,
    ) -> Result<()> {
        let unit = self.offset_unit;
        // The new texts of all scripts first, then the scripts: all of them change or none
        let mut rewrites: Vec<(usize, String, String)> = Vec::new();
        for key in keys {
            let Some((index, script)) = self.scripts.iter().enumerate().find(|(_, script)| script.key == *key) else {
                continue;
            };
            if rewrites.iter().any(|(other, ..)| *other == index) {
                continue;
            }
            let from_text = script.text();
            // A script that doesn't parse keeps its tags
            let Ok(text) = script.session.borrow_mut().rewrite_param_tag(name, Some(literal), true) else {
                continue;
            };
            if text != from_text {
                rewrites.push((index, text, from_text));
            }
        }
        self.commit_texts(rewrites.iter().map(|(index, text, from_text)| (*index, text.as_str(), from_text.as_str())))?;
        let mut rewritten: Vec<(ScriptKey, Rc<ScriptConnection>)> = Vec::new();
        for (index, text, from_text) in rewrites {
            let Some(script) = self.scripts.get_mut(index) else {
                continue;
            };
            script.analyze();
            script.pending_diff = None;
            // A mounted editor applies the change and keeps its cursor
            script.external_changes =
                Some(ExternalChanges { changes: vec![text_change(&from_text, &text, unit)], from_text });
            script.revision = next_revision();
            outcome.effects.push(Self::write_script(script));
            rewritten.push((script.key, script.connection.clone()));
        }
        for (key, connection) in &rewritten {
            self.mark_others_outdated(*key, connection);
        }
        outcome.changed |= !rewritten.is_empty();
        Ok(())
    }

    fn apply_editor_event(
        &mut self,
        key: ScriptKey,
        mut event: EditorEventT,
        known: Option<EditorUpdateId>,
        outcome: &mut WorkbookOutcome,
    ) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Err(Error::invalid_argument("an editor event of an unknown script"));
        };
        // The editor fills an analysis that the update leaves out with the one of the update that it holds, the script
        // with the one that it holds: the update leaves out only an analysis that both hold. The editor holds the
        // analysis of the script if it holds an update of the session that came with the analysis or after it.
        let editor_holds = known.is_some_and(|known| {
            known.session_generation == script.session_generation && known.serial >= script.analysis_serial
        });
        let held = script.editor_update.as_ref().filter(|held| held.analysis_available && editor_holds);
        event.known_analysis = held.map(|held| {
            let mut version = EditorAnalysisVersionT::default();
            version.text_version = held.text_version;
            version.catalog_revision = held.catalog_revision;
            Box::new(version)
        });
        let update = {
            let (Ok(mut session), Ok(catalog)) =
                (script.session.try_borrow_mut(), script.connection.catalog.try_borrow())
            else {
                return Err(Error::invalid_argument("the session of the script is busy"));
            };
            session.apply(&catalog, &event)
        };
        if update.status != EditorUpdateStatus::OK && !update.text_changed {
            // The editor reports the failure, the script is unchanged
            outcome.editor_update = Some(update);
            return Ok(());
        }
        // A text that changed is the text of the script, also if its analysis failed: it is written and the script
        // holds the failed analysis
        // A genuine edit of the user accepts a staged rewrite
        let accepts_diff = event.origin == EditorEventOrigin::USER;
        self.take_editor_update(key, update, accepts_diff, outcome)
    }

    /// Take the update of an editor event. The text is published into the catalog and written, a changed text with
    /// `accepts_diff` accepts a staged rewrite.
    fn take_editor_update(
        &mut self,
        key: ScriptKey,
        mut update: EditorUpdateT,
        accepts_diff: bool,
        outcome: &mut WorkbookOutcome,
    ) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Err(Error::invalid_argument("an editor update of an unknown script"));
        };
        let previous = script.editor_update.as_ref();
        // The update that the script holds may lag behind its session, e.g. after a reload from disk
        let text_changed =
            update.text_changed || previous.map(|previous| previous.text_version) != Some(update.text_version);
        let state_changed = previous.map(|previous| previous.state_revision) != Some(update.state_revision);
        let analysis_refreshed = update.analysis_updated;
        // Publishing declarations equal to the published ones keeps the catalog revision
        let mut catalog_changed = false;
        if (text_changed || analysis_refreshed) && update.analysis_available {
            catalog_changed = script.publish();
        } else if text_changed {
            script.published_version = None;
        }
        let accepts_diff = text_changed && accepts_diff && script.pending_diff.is_some();
        if !text_changed && !state_changed && !script.analysis_outdated && !accepts_diff {
            outcome.editor_update = Some(update);
            return Ok(());
        }
        // The editor gets the update as it is. The script holds it with the arrays of an analysis that the update left
        // out, they move over from the update that it replaces.
        let returned = update.analysis_omitted.then(|| update.clone());
        if update.analysis_omitted {
            if let Some(previous) = script.editor_update.as_mut() {
                update.diagnostics = previous.diagnostics.take();
                update.syntax_spans = previous.syntax_spans.take();
                update.vegalite_specs = previous.vegalite_specs.take();
                update.comment_tags = previous.comment_tags.take();
                update.semantic_spans = previous.semantic_spans.take();
                update.script_annotations = previous.script_annotations.take();
                update.processing_statistics = previous.processing_statistics.take();
            }
        }
        script.record_statistics(&update);
        script.hold_update(update);
        script.analysis_outdated = false;
        if text_changed || analysis_refreshed {
            script.compile_visualization();
        }
        if accepts_diff {
            script.pending_diff = None;
        }
        script.revision = next_revision();
        let connection = script.connection.clone();
        // Only a changed text is written, moving the cursor doesn't rewrite the file
        let write = text_changed.then(|| Self::write_script(script));
        if catalog_changed {
            self.mark_others_outdated(key, &connection);
        }
        // Moving the cursor leaves the results of the scripts as they are
        self.table_parameters_outdated |= text_changed || analysis_refreshed;
        outcome.changed = true;
        outcome.effects.extend(write);
        outcome.editor_update = returned;
        Ok(())
    }

    /// The script at a position moved to another connection under its key, in a new session with its text. It keeps
    /// what doesn't belong to the session: its staged rewrite, its unresolved connection, its visualization, its
    /// statistics, its queries, its stored result, and its editor update until it analyzes in the new session. The
    /// script at the position stays as it is, the caller replaces it.
    fn moved_script(&self, position: usize, connection: Rc<ScriptConnection>) -> Result<WorkbookScript> {
        let Some(previous) = self.scripts.get(position) else {
            return Err(Error::invalid_argument("a move of an unknown script"));
        };
        let mut moved = self.create_script(&previous.file_name, connection, Some(previous.key))?;
        moved.replace_text(&previous.text())?;
        if let Some(update) = previous.editor_update.clone() {
            moved.hold_update(update);
        }
        moved.pending_diff = previous.pending_diff.clone();
        moved.unresolved_connection_id = previous.unresolved_connection_id.clone();
        moved.visualization = previous.visualization.clone();
        moved.visualization_revision = previous.visualization_revision;
        moved.statistics = previous.statistics.clone();
        moved.latest_query_id = previous.latest_query_id;
        moved.latest_result_query_id = previous.latest_result_query_id;
        moved.latest_result_file = previous.latest_result_file.clone();
        moved.stored_result = previous.stored_result.clone();
        Ok(moved)
    }

    /// Replace the script at a position with a moved one, the previous script leaves its catalog
    fn replace_moved(&mut self, position: usize, moved: WorkbookScript) -> Result<WorkbookScript> {
        let Some(slot) = self.scripts.get_mut(position) else {
            moved.leave_catalog();
            return Err(Error::invalid_argument("a move of an unknown script"));
        };
        let previous = std::mem::replace(slot, moved);
        previous.leave_catalog();
        Ok(previous)
    }

    fn set_script_connection(
        &mut self,
        file_name: &str,
        connection: Rc<ScriptConnection>,
        outcome: &mut WorkbookOutcome,
    ) -> Result<()> {
        let Some((position, script)) =
            self.scripts.iter_mut().enumerate().find(|(_, script)| script.file_name == file_name)
        else {
            return Ok(());
        };
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
        // The picked connection replaces a reference to an unresolved one
        moved.unresolved_connection_id = None;
        moved.analyze();
        let key = moved.key;
        let connection = moved.connection.clone();
        let previous = self.replace_moved(position, moved)?;
        // The scripts of both catalogs may have referenced the moved script
        self.mark_others_outdated(key, &previous.connection);
        self.mark_others_outdated(key, &connection);
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
        Ok(())
    }

    fn set_pending_connection(&mut self, connection: Rc<ScriptConnection>, outcome: &mut WorkbookOutcome) {
        let same =
            self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == connection.connection_id);
        if same || !connection.has_params() {
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
            if self.scripts.get(position).is_none_or(|script| script.connection.connection_id != from) {
                continue;
            }
            // A script that can't move stays on the replaced connection, it isn't removed
            if let Ok(script) = self.moved_script(position, into.clone()) {
                if self.replace_moved(position, script).is_ok() {
                    moved += 1;
                }
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
            params: into.params(),
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
        // The analysis ran against a newer catalog and may publish different declarations, e.g. a view over a table
        // of another script. The scripts that resolve against them are outdated then, too.
        let Some(index) = self.scripts.iter().position(|script| script.key == key) else { return };
        outcome.changed |= self.analyze_at(index);
    }

    /// Compile the visualizations of the scripts on a connection again, e.g. in the dialect of a new profile
    fn connection_profile_changed(&mut self, connection_id: &str, outcome: &mut WorkbookOutcome) {
        for script in self.scripts.iter_mut().filter(|script| script.connection.connection_id == connection_id) {
            // A visualization that a run captured stays until the script analyzes again
            let compiled = script.editor_update.as_ref().is_some_and(|update| update.analysis_available)
                && !script.is_analysis_outdated();
            if compiled {
                let revision = script.visualization_revision;
                script.compile_visualization();
                if script.visualization_revision != revision {
                    script.revision = next_revision();
                }
            }
        }
        // The planner reads the profile, what the workbook derives follows
        outcome.changed = self.scripts.iter().any(|script| script.connection.connection_id == connection_id)
            || self.pending_connection.as_ref().is_some_and(|pending| pending.connection_id == connection_id);
    }
}
