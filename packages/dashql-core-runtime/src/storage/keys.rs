//! The keys of writes.
//!
//! Writes with the same key coalesce, the latest task wins. Keys are logical paths, not the paths of the files:
//! - Workbook keys start with the workbook id, e.g. `<workbookId>/scripts/01_query.sql`. Pausing, the pending writes
//!   and cancelling select the keys of a workbook by this prefix.
//! - Keys of the app storage start with `@`, e.g. `@manifest/connections/<id>` for a connection entry of the app
//!   manifest and `@connections/<id>/<file>` for the files of a connection. A workbook id never starts with `@`.

/// Does a key belong to a workbook? The key is the workbook id or a path below it.
pub fn belongs_to_workbook(key: &str, workbook_id: &str) -> bool {
    match key.strip_prefix(workbook_id) {
        Some(rest) => rest.is_empty() || rest.starts_with('/'),
        None => false,
    }
}

/// The chain key of a write key, the tasks of a chain run one after another.
///
/// Workbook keys chain per workbook (`<workbookId>/…`), so a mutation and the rewrite of the workbook file don't
/// overlap. Keys of the app storage chain per entity (`@manifest`, `@connections/<id>`).
pub fn chain_key(key: &str) -> String {
    let mut parts = key.split('/');
    let first = parts.next().unwrap_or_default();
    if key.starts_with("@connections/") {
        if let Some(second) = parts.next() {
            return format!("{first}/{second}");
        }
    }
    first.to_string()
}

/// The prefix of the keys of the files of a connection
pub fn connection_file_prefix(connection_id: &str) -> String {
    format!("@{}/{connection_id}/", super::CONNECTIONS_FOLDER)
}

/// The key of the entry of a connection in the app manifest, `@manifest/connections/<id>`
pub fn connection_entry_key(connection_id: &str) -> String {
    format!("@manifest/{}/{connection_id}", super::CONNECTIONS_FOLDER)
}

/// The key of a file of a connection, `@connections/<id>/<file>`
pub fn connection_file_key(connection_id: &str, file_name: &str) -> String {
    format!("{}{file_name}", connection_file_prefix(connection_id))
}

/// The key of the workbook file of a workbook, e.g. its properties
pub fn workbook_file_key(workbook_id: &str) -> String {
    format!("{workbook_id}/{}", super::WORKBOOK_FILE)
}

/// The key of the copy of a connection in a workbook file
pub fn workbook_connection_copy_key(workbook_id: &str, connection_id: &str) -> String {
    format!("{}:connection/{connection_id}", workbook_file_key(workbook_id))
}

/// The key of the script list of a workbook file
pub fn workbook_script_list_key(workbook_id: &str) -> String {
    format!("{}:scripts", workbook_file_key(workbook_id))
}
