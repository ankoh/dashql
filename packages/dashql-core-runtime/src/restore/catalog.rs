//! The restore of the catalog of a connection from the files of the connection.
//!
//! The host reads the files (`load_catalog_files`), `apply_catalog_files` publishes them into the catalog of the
//! connection and names the files to write after the restore.

use dashql_core::catalog::CatalogLayer;
use dashql_core_script::touched_relations::touched_relations;

use super::RestoreHost;
use crate::catalog_loader::batch::{publish_catalog_batch_sync, CatalogBatch, CatalogBatchEntry, CatalogGenerations};
use crate::catalog_loader::catalog_is_durable;
use crate::catalog_loader::tables::{pack_catalog_table_update, CatalogStateFile};
use crate::connections::{merge_relation_names, read_relation_name, ConnectionState, ConnectorType};
use crate::host::HostError;

/// The relations of the catalog of a connection, written and read as SQL
pub const CATALOG_RELATIONS_FILE: &str = "dashql-catalog-relations.sql";
/// The functions of the catalog of a connection
pub const CATALOG_FUNCTIONS_FILE: &str = "dashql-catalog-functions.sql";
/// The relations nothing has answered about yet and those that are gone
pub const CATALOG_STATE_FILE: &str = "dashql-catalog-state.json";
/// The changes of executed statements that older versions of the app kept, the restore clears the file
pub const CATALOG_CHANGES_FILE: &str = "dashql-catalog-changes.sql";

/// The files of the catalog of a connection, None for a file that doesn't exist
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogFiles {
    pub relations: Option<String>,
    pub functions: Option<String>,
    pub changes: Option<String>,
    pub state: Option<String>,
}

/// The outcome of restoring the catalog of a connection
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogRestore {
    /// False if the restore failed, the connection refreshes its catalog on connect
    pub succeeded: bool,
    /// The files to write as (file name, text), in order: those whose relations or changes were dropped are cleared
    pub files: Vec<(String, String)>,
    /// Why the restore failed
    pub error: Option<String>,
}

/// Read the files of the catalog of a connection
pub async fn load_catalog_files<H: RestoreHost>(host: &H, connection_id: &str) -> Result<CatalogFiles, HostError> {
    Ok(CatalogFiles {
        relations: host.load_connection_file(connection_id, CATALOG_RELATIONS_FILE).await?,
        functions: host.load_connection_file(connection_id, CATALOG_FUNCTIONS_FILE).await?,
        changes: host.load_connection_file(connection_id, CATALOG_CHANGES_FILE).await?,
        state: host.load_connection_file(connection_id, CATALOG_STATE_FILE).await?,
    })
}

/// Is a text there and not empty, like a string that JavaScript takes as true?
fn present(text: &Option<String>) -> Option<&str> {
    text.as_deref().filter(|text| !text.is_empty())
}

/// Is a text there and not blank?
fn not_blank(text: &Option<String>) -> Option<&str> {
    text.as_deref().filter(|text| !text.trim().is_empty())
}

/// Restore the catalog of a connection from the files of the connection.
///
/// The relations of a connection whose database doesn't outlive the app describe a database that is gone, they are
/// dropped and their file is cleared. Such a catalog is described by a refresh on connect. A restored catalog is kept
/// until an explicit refresh. The relations that the connection didn't answer about yet are asked about again once it
/// is online, and those it reported as gone stay gone. The relations of the changes file of older versions count as not
/// answered, the file is cleared.
pub fn apply_catalog_files(state: &mut ConnectionState, files: &CatalogFiles) -> CatalogRestore {
    let durable = catalog_is_durable(state.params());
    let mut out = CatalogRestore { succeeded: false, files: Vec::new(), error: None };
    // Clear the dropped relations that older versions of the app wrote
    if !durable && present(&files.relations).is_some() {
        out.files.push((CATALOG_RELATIONS_FILE.to_string(), String::new()));
    }

    let relations = if durable { not_blank(&files.relations) } else { None };
    let functions = not_blank(&files.functions);
    let mut entries = Vec::new();
    if let Some(relations) = relations {
        // The batch reads the file once, the catalog keeps the descriptor and not the text
        entries.push(CatalogBatchEntry { entry_id: state.relation_entry_id(), text: relations.to_string(), require_functions: false });
    }
    let function_entry = state.function_script().map(|script| script.catalog_entry_id());
    if let (Some(functions), Some(entry_id)) = (functions, function_entry) {
        entries.push(CatalogBatchEntry { entry_id, text: functions.to_string(), require_functions: false });
    }
    if !entries.is_empty() {
        let published = {
            let mut catalog = state.catalog().borrow_mut();
            publish_catalog_batch_sync(&mut catalog, &mut CatalogGenerations::default(), &CatalogBatch::new(entries))
        };
        if let Err(error) = published {
            out.error = Some(error.message().to_string());
            return out;
        }
        if let (Some(functions), Some(_)) = (functions, function_entry) {
            if let Err(error) = state.replace_function_script_text(functions) {
                out.error = Some(error.message);
                return out;
            }
        }
        // Only restored relations make a catalog that is kept
        if relations.is_some() {
            state.restore_catalog_updates(Some(true), None);
        }
    }

    let stored = CatalogStateFile::parse(files.state.as_deref());
    if durable && !stored.gone.is_empty() {
        let update = pack_catalog_table_update(&[], &stored.gone, &[]);
        let replaced = state.catalog().borrow_mut().replace_tables(state.relation_entry_id(), CatalogLayer::CONNECTION, &update);
        if let Err(error) = replaced {
            out.error = Some(error.message);
            return out;
        }
    }
    // Nothing that runs on Salesforce changes its relations, and it has no lookup for them
    if durable && state.connector_type() != ConnectorType::SalesforceDataCloud {
        let changed: Vec<_> = match not_blank(&files.changes) {
            Some(changes) => touched_relations(changes)
                .relations
                .unwrap_or_default()
                .iter()
                .map(|name| read_relation_name(name, ""))
                .collect(),
            None => Vec::new(),
        };
        state.restore_catalog_updates(None, Some(merge_relation_names(&stored.pending, &changed)));
    }
    // The relations of the old file move to the new one before the old one is cleared
    if present(&files.changes).is_some() {
        let pending = state.catalog_updates().touched_relations.clone();
        let next = CatalogStateFile { pending, gone: stored.gone };
        out.files.push((CATALOG_STATE_FILE.to_string(), next.to_json()));
        out.files.push((CATALOG_CHANGES_FILE.to_string(), String::new()));
    }
    out.succeeded = true;
    out
}
