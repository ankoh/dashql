//! The decisions of the restore of the app: which workbooks are valid, which connections their copies resolve to,
//! which connections a workbook registers, and which writes bring the stored state in line with the restored one.
//!
//! The host drives the restore and does the I/O: it restores the connections of the app manifest
//! (`RestorePlanner::restore_manifest_connection`), then for every workbook of the tree it loads the workbook file
//! (`begin_workbook`), restores the catalogs of the connections the workbook registered, lists the script files
//! (`finish_workbook`) and creates the workbook. At the end it writes `RestorePlanner::pending` through the storage
//! writer, which patches the files (`storage::workbook_file`): connections that workbooks registered go into the
//! manifest, stale copies of workbooks are rewritten, script lists that changed are written, and ephemeral workbooks
//! with scripts are promoted.

use std::collections::HashSet;

use serde_json::{Map, Value};

use dashql_core::error::{Error, Result};

use crate::workbook_format::data::{
    ConnectionEntry, WorkbookConnection, WorkbookData, WorkbookMetadata, WorkbookScript,
};
use crate::workbook_format::files::{sanitize_workbook_files, workbook_connection_ids_of};
use crate::workbook_format::script_connections::{
    resolve_workbook_scripts, workbook_scripts_resolution_changed, ConnectionResolver, ResolvedConnection,
    ResolvedWorkbookScript,
};
use crate::workbook_format::validation::{
    describe_invalid_workbook, is_local_hyper_wasm_params, is_valid_uuid, validate_workbook_json, InvalidWorkbook,
    WorkbookValidationError,
};
use dashql_core_runtime::connections::sharing::connection_params_equal;
use dashql_core_runtime::connections::{ConnectionParams, ConnectorType};
use dashql_core_runtime::workbook::WorkbookDefaultView;

/// A connection that the restore knows
#[derive(Debug, Clone, PartialEq)]
pub struct RestoreConnection {
    /// The id
    pub connection_id: String,
    /// The saved params
    pub params: Value,
    /// Unsaved edits of the params
    pub params_draft: Option<Value>,
    /// The name the user gave the connection
    pub name: Option<String>,
}

impl RestoreConnection {
    /// The connection of an entry of the app manifest
    pub fn of_entry(entry: &ConnectionEntry) -> Self {
        Self {
            connection_id: entry.id.clone(),
            params: entry.params.clone(),
            params_draft: entry.params_draft.clone(),
            name: entry.name.clone(),
        }
    }

    fn resolved(&self) -> ResolvedConnection {
        ResolvedConnection { connection_id: self.connection_id.clone(), params: self.params.clone() }
    }
}

/// The writes that bring the stored state in line with the restored one
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RestorePendingWrites {
    /// Connections that workbooks registered, they are missing in the app manifest
    pub connection_entries: Vec<ConnectionEntry>,
    /// Workbooks whose copies of connections are stale, as (workbook id, connection id)
    pub workbook_copies: Vec<(String, String)>,
    /// Workbooks whose script lists or connections disagree with the restored scripts
    pub workbook_script_lists: Vec<WorkbookScriptListWrite>,
    /// Ephemeral workbooks that hold scripts, the app stopped before their promotion was written
    pub promoted_workbooks: Vec<String>,
}

/// The script list of a restored workbook to write
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookScriptListWrite {
    /// The workbook
    pub workbook_id: String,
    /// The scripts
    pub scripts: Vec<WorkbookScript>,
    /// The copies of the connections
    pub connections: Vec<WorkbookConnection>,
}

/// A workbook whose connections are resolved, its scripts aren't read yet
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookRestore {
    /// The workbook id
    pub workbook_id: String,
    /// The validated workbook file
    pub data: WorkbookData,
    /// The connections the workbook uses
    pub connection_ids: Vec<String>,
    /// The connections whose catalogs the host restores now: those that the workbook registered
    pub catalogs_to_restore: Vec<String>,
}

/// A restored workbook, what the host creates the workbook with
#[derive(Debug, Clone, PartialEq)]
pub struct RestoredWorkbookPlan {
    /// The workbook id
    pub workbook_id: String,
    /// The trimmed name, None without one
    pub name: Option<String>,
    /// The view that the workbook opens in
    pub default_view: WorkbookDefaultView,
    /// The metadata, without the ephemeral marker of a promoted workbook
    pub metadata: WorkbookMetadata,
    /// The scripts in feed order with their connections
    pub scripts: Vec<ResolvedWorkbookScript>,
    /// The connection of the first script of a workbook without scripts
    pub pending_connection: Option<ResolvedConnection>,
    /// Was the workbook promoted from the ephemeral workbook?
    pub promoted: bool,
    /// The scripts that the workbook file lists while the folder holds no script file at all, e.g. while a checkout
    /// or a sync of the folder is under way. The list stays as it is on disk, the files may come back.
    pub missing_scripts: Vec<String>,
}

/// The decisions of a restore
pub struct RestorePlanner {
    /// The connections in the order they were registered
    connections: Vec<RestoreConnection>,
    /// The connections that workbooks registered
    new_connections: Vec<String>,
    /// The connections whose catalog is restored or live
    catalogs_restored: HashSet<String>,
    /// The writes after the restore
    pending: RestorePendingWrites,
    /// The time of the restore, the creation time of registered connections
    now: String,
    /// Fresh UUIDs, for a new connection to the embedded database
    new_uuid: Box<dyn FnMut() -> Option<String>>,
}

/// Can the app create a connection of the params? They must be an object with the params of a known connector.
fn check_params(params: &Value) -> Result<()> {
    ConnectionParams::from_json(&params.to_string()).map(|_| ())
}

impl RestorePlanner {
    /// A restore at a time (ISO 8601) with a source of UUIDs
    pub fn new(now: impl Into<String>, new_uuid: Box<dyn FnMut() -> Option<String>>) -> Self {
        Self {
            connections: Vec::new(),
            new_connections: Vec::new(),
            catalogs_restored: HashSet::new(),
            pending: RestorePendingWrites::default(),
            now: now.into(),
            new_uuid,
        }
    }

    /// Restore a connection of the app manifest, before the workbooks. Fails for params the app can't use, the
    /// workbooks that reference the connection register it again from their copies. The host restores its catalog.
    pub fn restore_manifest_connection(&mut self, entry: &ConnectionEntry) -> Result<()> {
        check_params(&entry.params)?;
        self.connections.push(RestoreConnection::of_entry(entry));
        self.catalogs_restored.insert(entry.id.clone());
        Ok(())
    }

    /// A live connection that a workbook restored at runtime resolves against, e.g. after an import
    pub fn add_live_connection(&mut self, connection: RestoreConnection) {
        self.catalogs_restored.insert(connection.connection_id.clone());
        self.connections.push(connection);
    }

    /// The known connections in the order they were registered
    pub fn connections(&self) -> &[RestoreConnection] {
        &self.connections
    }

    /// A known connection
    pub fn connection(&self, connection_id: &str) -> Option<&RestoreConnection> {
        self.connections.iter().find(|connection| connection.connection_id == connection_id)
    }

    /// The connections that workbooks registered, in order
    pub fn new_connections(&self) -> impl Iterator<Item = &RestoreConnection> {
        self.new_connections.iter().filter_map(|id| self.connection(id))
    }

    /// The writes after the restore
    pub fn pending(&self) -> &RestorePendingWrites {
        &self.pending
    }

    /// The connection to the embedded database, if one is known
    fn find_embedded(&self) -> Option<&RestoreConnection> {
        self.connections.iter().find(|connection| is_local_hyper_wasm_params(&connection.params))
    }

    fn add_copy_write(&mut self, workbook_id: &str, connection_id: &str) {
        let write = (workbook_id.to_string(), connection_id.to_string());
        if !self.pending.workbook_copies.contains(&write) {
            self.pending.workbook_copies.push(write);
        }
    }

    /// Resolve the reference of a workbook to a connection. The app manifest wins over the copy in the workbook, an
    /// unknown connection is registered from the copy. The app holds a single connection to the embedded database, an
    /// unknown one resolves to it.
    fn resolve_workbook_connection(
        &mut self,
        workbook_id: &str,
        copy: &WorkbookConnection,
    ) -> Result<RestoreConnection> {
        let connection_id = &copy.connection_id;
        let known = self
            .connection(connection_id)
            .or_else(|| if is_local_hyper_wasm_params(&copy.params) { self.find_embedded() } else { None })
            .cloned();
        if let Some(known) = known {
            if known.connection_id == *connection_id
                && (copy.params_draft.is_some()
                    || copy.name.is_some()
                    || !connection_params_equal(&copy.params, &known.params))
            {
                self.add_copy_write(workbook_id, connection_id);
            }
            return Ok(known);
        }
        check_params(&copy.params)?;
        let connection = RestoreConnection {
            connection_id: connection_id.clone(),
            params: copy.params.clone(),
            params_draft: copy.params_draft.clone(),
            name: copy.name.clone(),
        };
        self.connections.push(connection.clone());
        self.new_connections.push(connection_id.clone());
        self.pending.connection_entries.push(ConnectionEntry {
            params_draft: copy.params_draft.clone(),
            name: copy.name.clone(),
            created_at: Some(self.now.clone()),
            ..ConnectionEntry::new(connection_id.clone(), copy.params.clone())
        });
        if copy.params_draft.is_some() || copy.name.is_some() {
            // Drafts and the names of imported connections move into the app manifest
            self.add_copy_write(workbook_id, connection_id);
        }
        Ok(connection)
    }

    /// The connection to the embedded database, registered from a copy of the workbook or anew when the app has none
    fn resolve_embedded_connection(
        &mut self,
        workbook_id: &str,
        copies: &[WorkbookConnection],
    ) -> Result<RestoreConnection> {
        if let Some(embedded) = self.find_embedded() {
            return Ok(embedded.clone());
        }
        let copy = match copies.iter().find(|copy| is_local_hyper_wasm_params(&copy.params)) {
            Some(copy) => copy.clone(),
            None => {
                let mut params = Map::new();
                let hyper = ConnectorType::Hyper.connector();
                params.insert(hyper.params_key().into(), Value::Object(hyper.default_params()));
                // A connection without an id would be no connection, the restore of the workbook fails instead
                let id = (self.new_uuid)()
                    .ok_or_else(|| Error::invalid_argument("no fresh id for the embedded database"))?;
                WorkbookConnection::new(id, Value::Object(params))
            }
        };
        self.resolve_workbook_connection(workbook_id, &copy)
    }

    /// Load a workbook of the workbook tree: check its id and its file (None if it couldn't be read) and resolve the
    /// connections it uses. A workbook that fails is invalid, the workbench shows it and the user can delete it.
    pub fn begin_workbook(
        &mut self,
        entry_path: &str,
        text: Option<&str>,
    ) -> std::result::Result<WorkbookRestore, InvalidWorkbook> {
        let json = text.and_then(|text| serde_json::from_str::<Value>(text).ok());
        self.begin_workbook_json(entry_path, json.as_ref())
    }

    /// Load a workbook of the workbook tree from its file as JSON, see `begin_workbook`
    pub fn begin_workbook_json(
        &mut self,
        entry_path: &str,
        json: Option<&Value>,
    ) -> std::result::Result<WorkbookRestore, InvalidWorkbook> {
        let workbook_id = entry_path;
        if !is_valid_uuid(workbook_id) {
            return Err(describe_invalid_workbook(entry_path, WorkbookValidationError::InvalidWorkbookId, None));
        }
        let Some(json) = json else {
            return Err(describe_invalid_workbook(entry_path, WorkbookValidationError::WorkbookUnreadable, None));
        };
        let data = WorkbookData::from_json(json);
        if let Err(error) = validate_workbook_json(json) {
            return Err(describe_invalid_workbook(entry_path, error, Some(&data)));
        }
        // The connections of the workbook are the connections of its scripts, copies that no script uses are not
        // registered
        let first = data.connections.first().map(|copy| copy.connection_id.as_str());
        let used = workbook_connection_ids_of(&sanitize_workbook_files(&data).scripts, first);
        let used_copies: Vec<WorkbookConnection> =
            data.connections.iter().filter(|copy| used.contains(&copy.connection_id)).cloned().collect();
        let resolved: Result<Vec<RestoreConnection>> = if used_copies.is_empty() {
            self.resolve_embedded_connection(workbook_id, &data.connections).map(|connection| vec![connection])
        } else {
            used_copies.iter().map(|copy| self.resolve_workbook_connection(workbook_id, copy)).collect()
        };
        let connections = resolved
            .map_err(|_| describe_invalid_workbook(entry_path, WorkbookValidationError::WorkbookNotRestored, None))?;
        let mut catalogs_to_restore = Vec::new();
        for connection in &connections {
            if self.catalogs_restored.insert(connection.connection_id.clone()) {
                catalogs_to_restore.push(connection.connection_id.clone());
            }
        }
        Ok(WorkbookRestore {
            workbook_id: workbook_id.to_string(),
            data,
            connection_ids: connections.into_iter().map(|connection| connection.connection_id).collect(),
            catalogs_to_restore,
        })
    }

    /// Resolve the scripts of a workbook with the names of its script files, None if they couldn't be listed
    pub fn finish_workbook(
        &mut self,
        restore: WorkbookRestore,
        script_files: Option<&[String]>,
    ) -> std::result::Result<RestoredWorkbookPlan, InvalidWorkbook> {
        let invalid = |data: &WorkbookData| {
            describe_invalid_workbook(&restore.workbook_id, WorkbookValidationError::WorkbookNotRestored, Some(data))
        };
        let Some(script_files) = script_files else {
            return Err(invalid(&restore.data));
        };
        let workbook_id = restore.workbook_id.clone();
        let mut resolver =
            PlannerResolver { planner: self, workbook_id: &workbook_id, copies: &restore.data.connections };
        let resolved =
            resolve_workbook_scripts(&restore.data, script_files, &mut resolver).map_err(|_| invalid(&restore.data))?;
        let mut metadata = restore.data.metadata.clone();
        let promoted = metadata.is_ephemeral() && !resolved.scripts.is_empty();
        if promoted {
            metadata.ephemeral = None;
            self.pending.promoted_workbooks.push(workbook_id.clone());
        }
        // A folder without any script file whose workbook file lists scripts lost its files only for a while, more
        // likely than the user deleted every script outside the app. The list is kept for the files to come back.
        let missing_scripts: Vec<String> = if script_files.is_empty() {
            sanitize_workbook_files(&restore.data).scripts.into_iter().map(|script| script.name).collect()
        } else {
            Vec::new()
        };
        if missing_scripts.is_empty() && workbook_scripts_resolution_changed(&restore.data, &resolved.workbook) {
            self.pending.workbook_script_lists.push(WorkbookScriptListWrite {
                workbook_id: workbook_id.clone(),
                scripts: resolved.workbook.scripts.clone(),
                connections: resolved.workbook.connections.clone(),
            });
        }
        Ok(RestoredWorkbookPlan {
            workbook_id,
            name: restore.data.display_name().map(str::to_string),
            default_view: restore.data.default_view,
            metadata,
            scripts: resolved.scripts,
            pending_connection: resolved.pending_connection,
            promoted,
            missing_scripts,
        })
    }
}

/// Resolves the connections of the scripts of a workbook with a planner
struct PlannerResolver<'a> {
    planner: &'a mut RestorePlanner,
    workbook_id: &'a str,
    copies: &'a [WorkbookConnection],
}

impl ConnectionResolver for PlannerResolver<'_> {
    fn resolve(
        &mut self,
        connection_id: &str,
        copy: Option<&WorkbookConnection>,
    ) -> Result<Option<ResolvedConnection>> {
        match copy {
            Some(copy) => self
                .planner
                .resolve_workbook_connection(self.workbook_id, copy)
                .map(|connection| Some(connection.resolved())),
            None => Ok(self.planner.connection(connection_id).map(RestoreConnection::resolved)),
        }
    }

    fn fallback(&mut self) -> Result<ResolvedConnection> {
        self.planner.resolve_embedded_connection(self.workbook_id, self.copies).map(|connection| connection.resolved())
    }
}

/// The error of a workbook that a restore at runtime (an import) didn't restore
pub fn not_restored_error(workbook_id: &str) -> Error {
    Error::invalid_argument(format!("imported workbook {workbook_id} did not restore its scripts"))
}
