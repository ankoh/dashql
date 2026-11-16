//! How the connections of an imported workbook map to the connections of the app.

use std::collections::HashMap;

use serde_json::Value;

use crate::workbook_format::data::{ConnectionEntry, WorkbookConnection, WorkbookData, WorkbookScript};
use crate::workbook_format::files::dedupe_connections;
use crate::workbook_format::sharing::connection_params_share_equal;
use crate::workbook_format::validation::is_local_hyper_wasm_params;

/// A connection that a workbook brings along
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedConnectionRef {
    /// The id of the connection in the workbook
    pub connection_id: String,
    /// The params, shared workbooks carry them without secrets
    pub params: Value,
    /// The name the connection had in the exporting app
    pub name: Option<String>,
}

/// How an imported connection relates to the connections of the app
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionImportDecision {
    /// The connection is unknown, it is registered as a new connection
    Register,
    /// The connection is known and describes the same database, the workbook uses it
    Link { connection_id: String },
    /// Connections of the app may describe the same database, the user decides
    Ask { candidates: Vec<ConnectionEntry> },
}

/// The decision for a connection of an imported workbook
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionImportPlanItem {
    /// The connection of the workbook
    pub reference: ImportedConnectionRef,
    /// The decision
    pub decision: ConnectionImportDecision,
}

/// What the user chose for a connection that may consolidate with an existing one
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionImportChoice {
    /// Use an existing connection
    Link { connection_id: String },
    /// Keep the connection of the workbook as a connection of its own
    Separate,
}

/// Decide how the connections of an imported workbook map to the connections of the app.
///
/// A connection with the id of a known connection and the same params (ignoring secrets) uses the known connection.
/// Every other connection that describes the same database, or shares the id but not the params, is a candidate that
/// the user decides on. The embedded database is no choice: the app holds a single connection to it.
pub fn plan_connection_import(workbook: &WorkbookData, entries: &[ConnectionEntry]) -> Vec<ConnectionImportPlanItem> {
    let embedded = entries.iter().find(|entry| is_local_hyper_wasm_params(&entry.params));
    workbook
        .connections
        .iter()
        .map(|connection| {
            let reference = ImportedConnectionRef {
                connection_id: connection.connection_id.clone(),
                params: connection.params.clone(),
                name: connection.name.clone(),
            };
            let decision = if is_local_hyper_wasm_params(&reference.params) {
                match embedded {
                    Some(entry) => ConnectionImportDecision::Link { connection_id: entry.id.clone() },
                    None => ConnectionImportDecision::Register,
                }
            } else {
                let same_id = entries.iter().find(|entry| entry.id == reference.connection_id);
                match same_id {
                    Some(entry) if connection_params_share_equal(&entry.params, &reference.params) => {
                        ConnectionImportDecision::Link { connection_id: entry.id.clone() }
                    }
                    _ => {
                        let mut candidates: Vec<ConnectionEntry> = same_id.into_iter().cloned().collect();
                        candidates.extend(
                            entries
                                .iter()
                                .filter(|entry| Some(entry.id.as_str()) != same_id.map(|e| e.id.as_str()))
                                .filter(|entry| connection_params_share_equal(&entry.params, &reference.params))
                                .cloned(),
                        );
                        if candidates.is_empty() { ConnectionImportDecision::Register } else { ConnectionImportDecision::Ask { candidates } }
                    }
                }
            };
            ConnectionImportPlanItem { reference, decision }
        })
        .collect()
}

/// The plan items that need a decision of the user
pub fn connection_import_questions(plan: &[ConnectionImportPlanItem]) -> Vec<&ConnectionImportPlanItem> {
    plan.iter().filter(|item| matches!(item.decision, ConnectionImportDecision::Ask { .. })).collect()
}

/// An imported workbook with resolved connection references
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionImport {
    /// The workbook with the rewritten references
    pub workbook: WorkbookData,
    /// The ids that the connections of the imported workbook got (imported id, id), in the order of the connections
    pub connection_ids: Vec<(String, String)>,
}

/// Rewrite the connection references of an imported workbook.
///
/// Linked references take the id and the full params of the connection of the app, which keeps its name. Separate
/// connections keep their id unless the app uses it for another connection, and keep their name to be registered with
/// it. Unanswered questions keep the connection separate.
pub fn apply_connection_import_plan(
    workbook: &WorkbookData,
    plan: &[ConnectionImportPlanItem],
    choices: &HashMap<String, ConnectionImportChoice>,
    entries: &[ConnectionEntry],
    new_uuid: &mut dyn FnMut() -> String,
) -> ConnectionImport {
    let mut fresh_ids: HashMap<String, String> = HashMap::new();
    let mut resolve = |connection_id: &str| -> (String, Option<ConnectionEntry>) {
        let item = plan.iter().find(|item| item.reference.connection_id == connection_id);
        let link = match item.map(|item| &item.decision) {
            Some(ConnectionImportDecision::Link { connection_id }) => Some(connection_id.clone()),
            Some(ConnectionImportDecision::Ask { .. }) => match choices.get(connection_id) {
                Some(ConnectionImportChoice::Link { connection_id }) => Some(connection_id.clone()),
                _ => None,
            },
            _ => None,
        };
        if let Some(entry) = link.and_then(|link| entries.iter().find(|entry| entry.id == link)) {
            return (entry.id.clone(), Some(entry.clone()));
        }
        // A separate connection must not take over the id of an existing one
        if !entries.iter().any(|entry| entry.id == connection_id) {
            return (connection_id.to_string(), None);
        }
        let fresh = fresh_ids.entry(connection_id.to_string()).or_insert_with(&mut *new_uuid).clone();
        (fresh, None)
    };
    let connections = workbook
        .connections
        .iter()
        .map(|connection| match resolve(&connection.connection_id) {
            (connection_id, Some(entry)) => WorkbookConnection::new(connection_id, entry.params),
            (connection_id, None) => WorkbookConnection { name: connection.name.clone(), ..WorkbookConnection::new(connection_id, connection.params.clone()) },
        })
        .collect();
    let scripts = workbook.scripts.iter().map(|script| WorkbookScript::new(script.name.clone(), resolve(&script.connection_id).0)).collect();
    let connection_ids = workbook.connections.iter().map(|connection| (connection.connection_id.clone(), resolve(&connection.connection_id).0)).collect();
    ConnectionImport { workbook: WorkbookData { connections: dedupe_connections(connections), scripts, ..workbook.clone() }, connection_ids }
}

/// Did resolving the connections change the references of the workbook?
pub fn connection_refs_changed(before: &WorkbookData, after: &WorkbookData) -> bool {
    let refs = |workbook: &WorkbookData| {
        (
            workbook.connections.iter().map(|c| (c.connection_id.clone(), c.params.clone())).collect::<Vec<_>>(),
            workbook.scripts.iter().map(|s| s.connection_id.clone()).collect::<Vec<_>>(),
        )
    };
    refs(before) != refs(after)
}
