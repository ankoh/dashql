//! The scripts of a workbook file resolved to the connections of the app.

use std::collections::HashMap;

use serde_json::Value;

use dashql_core::error::Result;

use crate::workbook_format::data::{WorkbookConnection, WorkbookData, WorkbookScript};
use crate::workbook_format::files::{reconcile_workbook_scripts, sanitize_workbook_files, with_workbook_scripts};

/// A connection of the app that a script runs on
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedConnection {
    /// The id of the connection
    pub connection_id: String,
    /// Its params
    pub params: Value,
}

/// Resolves the connections of a workbook to the connections of the app
pub trait ConnectionResolver {
    /// The connection of the app for a connection of the workbook, None if it is unknown. `copy` is the copy that the
    /// workbook file holds, a resolver may register an unknown connection from it.
    fn resolve(&mut self, connection_id: &str, copy: Option<&WorkbookConnection>)
        -> Result<Option<ResolvedConnection>>;
    /// The connection that scripts on unknown connections run on, the embedded database
    fn fallback(&mut self) -> Result<ResolvedConnection>;
    /// A script references a connection that couldn't be resolved
    fn unresolved(&mut self, _connection_id: &str) {}
}

/// A script of a workbook file with the connection it runs on
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedWorkbookScript {
    /// The file name
    pub name: String,
    /// The connection of the app the script runs on
    pub connection: ResolvedConnection,
    /// The connection that the workbook file names for the script if the app doesn't know it
    pub unresolved_connection_id: Option<String>,
}

/// The scripts of a workbook file resolved to connections of the app
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedWorkbookScripts {
    /// The scripts in feed order
    pub scripts: Vec<ResolvedWorkbookScript>,
    /// The connection that the first script of a workbook without scripts runs on, None if the workbook has scripts
    pub pending_connection: Option<ResolvedConnection>,
    /// The workbook file that describes the resolved scripts
    pub workbook: WorkbookData,
}

/// Resolve the scripts of a workbook file to the connections of the app.
///
/// The workbook file lists the scripts in feed order with the ids of their connections, script files without an entry
/// are appended on the connection of the script before them. A script whose connection can't be resolved runs on the
/// fallback connection, the embedded database, and the workbook file keeps its reference. A workbook without scripts
/// resolves the connection it holds.
pub fn resolve_workbook_scripts(
    workbook: &WorkbookData,
    file_names: &[String],
    resolver: &mut dyn ConnectionResolver,
) -> Result<ResolvedWorkbookScripts> {
    let mut resolved: HashMap<String, Option<ResolvedConnection>> = HashMap::new();
    let mut resolve_id = |resolver: &mut dyn ConnectionResolver, connection_id: &str| {
        resolve_once(&mut resolved, workbook, resolver, connection_id)
    };
    let first_connection_id = workbook.connections.first().map(|copy| copy.connection_id.clone());
    let listed = reconcile_workbook_scripts(
        &sanitize_workbook_files(workbook).scripts,
        file_names,
        first_connection_id.as_deref().unwrap_or(""),
    )
    .scripts;
    let mut scripts = Vec::with_capacity(listed.len());
    for entry in listed {
        let script = match resolve_id(resolver, &entry.connection_id)? {
            Some(connection) => ResolvedWorkbookScript { name: entry.name, connection, unresolved_connection_id: None },
            None => ResolvedWorkbookScript {
                name: entry.name,
                connection: resolver.fallback()?,
                unresolved_connection_id: Some(entry.connection_id),
            },
        };
        scripts.push(script);
    }
    let pending_connection = if !scripts.is_empty() {
        None
    } else {
        let known = match &first_connection_id {
            Some(id) => resolve_id(resolver, id)?,
            None => None,
        };
        Some(match known {
            Some(connection) => connection,
            None => resolver.fallback()?,
        })
    };
    let list: Vec<WorkbookScript> = scripts
        .iter()
        .map(|script| {
            WorkbookScript::new(
                script.name.clone(),
                script.unresolved_connection_id.clone().unwrap_or_else(|| script.connection.connection_id.clone()),
            )
        })
        .collect();
    let used: Vec<WorkbookConnection> = pending_connection
        .iter()
        .chain(scripts.iter().map(|script| &script.connection))
        .map(|connection| WorkbookConnection::new(connection.connection_id.clone(), connection.params.clone()))
        .collect();
    let workbook = with_workbook_scripts(workbook, list, &used);
    Ok(ResolvedWorkbookScripts { scripts, pending_connection, workbook })
}

/// Resolve a connection of a workbook once
fn resolve_once(
    resolved: &mut HashMap<String, Option<ResolvedConnection>>,
    workbook: &WorkbookData,
    resolver: &mut dyn ConnectionResolver,
    connection_id: &str,
) -> Result<Option<ResolvedConnection>> {
    if let Some(known) = resolved.get(connection_id) {
        return Ok(known.clone());
    }
    let copy = workbook.connections.iter().find(|copy| copy.connection_id == connection_id);
    let connection = resolver.resolve(connection_id, copy)?;
    if connection.is_none() {
        resolver.unresolved(connection_id);
    }
    resolved.insert(connection_id.to_string(), connection.clone());
    Ok(connection)
}

/// Does a resolved workbook file differ from the stored one in its scripts or connections?
pub fn workbook_scripts_resolution_changed(stored: &WorkbookData, resolved: &WorkbookData) -> bool {
    let ids =
        |workbook: &WorkbookData| workbook.connections.iter().map(|c| c.connection_id.clone()).collect::<Vec<_>>();
    ids(stored) != ids(resolved) || stored.scripts != resolved.scripts
}
