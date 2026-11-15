//! The scripts of a workbook and the actions on them.
//!
//! A workbook owns the script sessions of its scripts. A script is analyzed against the catalog of its connection and
//! publishes its declarations into that catalog, the other scripts of the catalog then resolve against them. An action
//! changes the workbook in place and returns the effects that the host applies afterwards, e.g. the files to write.
//! Dropping a script drops its session, nothing has to be freed by hand.
//!
//! Ported from `reduceWorkbookScripts` of `packages/dashql-runtime/src/workbook/scripts/workbook_scripts.ts`.

use std::cell::RefCell;
use std::rc::Rc;

use dashql_buffers::editor::{EditorEventT, EditorOffsetUnit, EditorUpdateStatus, EditorUpdateT};
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer};
use dashql_core::error::{Error, Result};
use dashql_core_session::script_session::ScriptSession;

use crate::names::{script_display_name, script_file_name, unique_script_base};

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
}

/// A script of a workbook
pub struct WorkbookScript {
    /// The key of the script
    key: ScriptKey,
    /// The file name of the script, `<name>.sql`
    file_name: String,
    /// The editor session of the script
    session: ScriptSession,
    /// The connection the script runs on
    connection: Rc<ScriptConnection>,
    /// The latest analysis, also the one of a failed analysis
    editor_update: Option<EditorUpdateT>,
    /// Must the script be analyzed again, e.g. because another script of its catalog changed?
    analysis_outdated: bool,
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
    pub fn session(&self) -> &ScriptSession {
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

    /// The text of the script
    pub fn text(&self) -> String {
        self.session.text()
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
                update.text_version != self.session.text_version()
                    || update.catalog_revision != self.connection.catalog.borrow().version() as u64
            }
        }
    }

    /// Analyze the script and publish its declarations into the catalog of its connection. A failed analysis is kept
    /// on the script instead of returned: analyzing the same text against the same catalog fails again, and a change
    /// of either marks the script outdated.
    fn analyze(&mut self) {
        let update = self.session.analyze(&self.connection.catalog.borrow());
        let published = update.status == EditorUpdateStatus::OK && update.analysis_available;
        self.editor_update = Some(update);
        self.analysis_outdated = false;
        if published {
            // Publishing fails only without an analysis, which was checked
            let _ = self.session.load_into_catalog(&mut self.connection.catalog.borrow_mut(), CatalogLayer::SESSION);
        }
    }

    /// Replace the text of the script
    fn replace_text(&mut self, text: &str) -> Result<()> {
        let catalog = self.connection.catalog.borrow();
        let update = self.session.replace_text(&catalog, self.session.text_version(), text);
        if update.status != EditorUpdateStatus::OK {
            return Err(Error::invalid_argument("cannot replace the text of the script"));
        }
        Ok(())
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
    /// Write the properties of the workbook file: its name and whether it is ephemeral
    WriteProperties { name: Option<String>, ephemeral: bool },
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
    /// Replace the text of a script and analyze it
    SetScriptText { key: ScriptKey, text: String },
    /// Apply an event of the editor of a script, e.g. a typed character or a moved cursor
    ApplyEditorEvent { key: ScriptKey, event: EditorEventT },
    /// Analyze a script if its analysis is outdated
    AnalyzeOutdatedScript { key: ScriptKey },
    /// The catalog of a connection changed, its scripts must be analyzed again
    CatalogDidUpdate { connection_id: String },
    /// A query of a script started
    RegisterQuery { key: ScriptKey, query_id: u32 },
    /// A query of a script produced the result that the script shows. An older query never replaces a newer result.
    RegisterScriptResult { key: ScriptKey, query_id: u32 },
    /// Rename the workbook, an empty name removes the name
    RenameWorkbook { name: Option<String> },
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
    /// The offset unit of the editors
    offset_unit: EditorOffsetUnit,
    /// The revision of the workbook, it changes with every change
    revision: u64,
}

impl Workbook {
    /// An empty workbook. A workbook without scripts has a pending connection, its first script runs on it.
    pub fn new(id: &str, name: Option<String>, pending_connection: Option<Rc<ScriptConnection>>, offset_unit: EditorOffsetUnit) -> Self {
        Self { id: id.to_string(), name, ephemeral: false, pending_connection, scripts: Vec::new(), offset_unit, revision: 0 }
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
        self.revision += 1;
        Ok(key)
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
        match action {
            WorkbookAction::CreateScript { index, text, base, connection } => {
                self.create(index, text, &base, connection, &mut outcome)?
            }
            WorkbookAction::DeleteScript { file_name } => self.delete(&file_name, &mut outcome),
            WorkbookAction::RenameScript { file_name, new_name } => self.rename(&file_name, &new_name, &mut outcome),
            WorkbookAction::ReorderScripts { order } => self.reorder(&order, &mut outcome),
            WorkbookAction::SetScriptText { key, text } => self.set_text(key, &text, &mut outcome)?,
            WorkbookAction::ApplyEditorEvent { key, event } => self.apply_editor_event(key, &event, &mut outcome)?,
            WorkbookAction::AnalyzeOutdatedScript { key } => self.analyze_outdated(key, &mut outcome),
            WorkbookAction::CatalogDidUpdate { connection_id } => {
                for script in self.scripts.iter_mut().filter(|script| script.connection.connection_id == connection_id) {
                    if !script.analysis_outdated {
                        script.analysis_outdated = true;
                        script.revision += 1;
                        outcome.changed = true;
                    }
                }
            }
            WorkbookAction::RegisterQuery { key, query_id } => {
                if let Some(script) = self.script_mut(key) {
                    script.latest_query_id = Some(query_id);
                    script.revision += 1;
                    outcome.changed = true;
                }
            }
            WorkbookAction::RegisterScriptResult { key, query_id } => {
                if let Some(script) = self.script_mut(key) {
                    // Query ids grow, an older overlapping query must not replace a newer result
                    if script.latest_result_query_id.is_none_or(|latest| latest < query_id) {
                        script.latest_result_query_id = Some(query_id);
                        script.revision += 1;
                        outcome.changed = true;
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
        }
        if outcome.changed {
            self.revision += 1;
        }
        Ok(outcome)
    }

    fn script_mut(&mut self, key: ScriptKey) -> Option<&mut WorkbookScript> {
        self.scripts.iter_mut().find(|script| script.key == key)
    }

    fn properties_write(&self) -> WorkbookEffect {
        WorkbookEffect::WriteProperties { name: self.name.clone(), ephemeral: self.ephemeral }
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
            session,
            connection,
            editor_update: None,
            analysis_outdated: true,
            latest_query_id: None,
            latest_result_query_id: None,
            unresolved_connection_id: None,
            revision: 0,
        })
    }

    /// Mark the other scripts in the catalog of a script outdated, they may resolve against its declarations. Scripts
    /// in other catalogs can't reference it.
    fn mark_others_outdated(&mut self, changed: ScriptKey, catalog: &CatalogHandle) {
        for script in self.scripts.iter_mut() {
            if script.key != changed && !script.analysis_outdated && Rc::ptr_eq(&script.connection.catalog, catalog) {
                script.analysis_outdated = true;
                script.revision += 1;
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
        let file_name = script_file_name(base, self.scripts.iter().map(|script| script.file_name.as_str()), []);
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
        let deleted = self.scripts.remove(position);
        deleted.session.drop_from_catalog(&mut deleted.connection.catalog.borrow_mut());
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

    fn rename(&mut self, file_name: &str, new_name: &str, outcome: &mut WorkbookOutcome) {
        let Some(position) = self.scripts.iter().position(|script| script.file_name == file_name) else {
            return;
        };
        // The name is a display name: a ".sql" is dropped, an empty name or one that is no plain file name is ignored
        let requested = script_display_name(new_name.trim());
        if requested.is_empty() || requested.contains(['/', '\\', '\0']) {
            return;
        }
        let base = unique_script_base(requested, self.scripts.iter().map(|script| script.file_name.as_str()), file_name, []);
        let new_file_name = format!("{base}.sql");
        if new_file_name == file_name {
            // The same name writes the unchanged text
            outcome.effects.push(Self::write_script(&self.scripts[position]));
            return;
        }
        let script = &mut self.scripts[position];
        script.file_name = new_file_name.clone();
        script.revision += 1;
        // The other scripts read the script by its name
        script.analyze();
        let (key, catalog) = (script.key, script.connection.catalog.clone());
        self.mark_others_outdated(key, &catalog);
        outcome.changed = true;
        outcome.effects.push(WorkbookEffect::RenameScript { from: file_name.to_string(), to: new_file_name });
        outcome.effects.push(WorkbookEffect::WriteScriptList(self.script_list()));
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

    fn set_text(&mut self, key: ScriptKey, text: &str, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Ok(());
        };
        script.replace_text(text)?;
        script.analyze();
        script.revision += 1;
        let (catalog, effect) = (script.connection.catalog.clone(), Self::write_script(script));
        // The text was published into the catalog, the other scripts resolve against it again
        self.mark_others_outdated(key, &catalog);
        outcome.changed = true;
        outcome.effects.push(effect);
        Ok(())
    }

    fn apply_editor_event(&mut self, key: ScriptKey, event: &EditorEventT, outcome: &mut WorkbookOutcome) -> Result<()> {
        let Some(script) = self.script_mut(key) else {
            return Err(Error::invalid_argument("an editor event of an unknown script"));
        };
        let update = script.session.apply(&script.connection.catalog.borrow(), event);
        if update.status != EditorUpdateStatus::OK {
            // The editor reports the failure, the script is unchanged
            outcome.editor_update = Some(update);
            return Ok(());
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
            let _ = script.session.load_into_catalog(&mut catalog, CatalogLayer::SESSION);
            catalog_changed = catalog.version() != version;
        }
        if !text_changed && !state_changed && !script.analysis_outdated {
            outcome.editor_update = Some(update);
            return Ok(());
        }
        script.editor_update = Some(update.clone());
        script.analysis_outdated = false;
        script.revision += 1;
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
        script.revision += 1;
        // The analysis ran against a newer catalog and may publish different declarations, e.g. a view over a table
        // of another script. The scripts that resolve against them are outdated then, too.
        if catalog.borrow().version() != version {
            self.mark_others_outdated(key, &catalog);
        }
        outcome.changed = true;
    }
}
