//! The keys of writes.
//!
//! Writes with the same key coalesce, the latest task wins. Keys are logical paths, not the paths of the files:
//! - Workbook keys start with the workbook id, e.g. `<workbookId>/scripts/01_query.sql`. Pausing, the pending writes
//!   and cancelling select the keys of a workbook by this prefix.
//! - Keys of the app storage start with `@`, e.g. `@manifest/connections/<id>` for a connection entry of the app
//!   manifest and `@connections/<id>/<file>` for the files of a connection. A workbook id never starts with `@`.
//!
//! This module is the one source of the formats: the writer, the runtime of the module and the platform build keys
//! with its functions, a task names its own key (`WriteTask::key`).

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

/// The key of the creation of a workbook, apart from its properties so that a rename in the same turn doesn't replace it
pub fn workbook_creation_key(workbook_id: &str) -> String {
    format!("{}:create", workbook_file_key(workbook_id))
}

/// The key of the copy of a connection in a workbook file
pub fn workbook_connection_copy_key(workbook_id: &str, connection_id: &str) -> String {
    format!("{}:connection/{connection_id}", workbook_file_key(workbook_id))
}

/// The key of the script list of a workbook file
pub fn workbook_script_list_key(workbook_id: &str) -> String {
    format!("{}:scripts", workbook_file_key(workbook_id))
}

/// The key of the attachment list of a workbook file
pub fn workbook_attachment_list_key(workbook_id: &str) -> String {
    format!("{}:attachments", workbook_file_key(workbook_id))
}

/// The key of an attachment of a workbook, `<workbookId>/attachments/<file>`
pub fn attachment_key(workbook_id: &str, file_name: &str) -> String {
    format!("{workbook_id}/{}/{file_name}", super::ATTACHMENTS_FOLDER)
}

/// The key of the rename of an attachment, by the name it had, apart from its file so that a rename and a save of the
/// same name keep both
pub fn attachment_rename_key(workbook_id: &str, from: &str) -> String {
    format!("{}:rename", attachment_key(workbook_id, from))
}

/// The file of an attachment that the tasks of a workbook keep their order on: two names of the same file share it
pub fn attachment_file(workbook_id: &str, file_name: &str) -> String {
    attachment_key(workbook_id, &crate::workbook_format::files::file_name_key(file_name))
}

/// The folder of the scripts of a workbook, `<workbookId>/scripts`
fn workbook_scripts_key(workbook_id: &str) -> String {
    format!("{workbook_id}/{}", super::SCRIPTS_FOLDER)
}

/// The key of the text of a script, `<workbookId>/scripts/<file>`
pub fn script_key(workbook_id: &str, file_name: &str) -> String {
    format!("{}/{file_name}", workbook_scripts_key(workbook_id))
}

/// The key of the deletion of a script, apart from its text so that a deletion and a write of the same name keep
/// their order
pub fn script_deletion_key(workbook_id: &str, file_name: &str) -> String {
    format!("{}:delete", script_key(workbook_id, file_name))
}

/// The key of the rename of a script, by the name it had
pub fn script_rename_key(workbook_id: &str, from: &str) -> String {
    format!("{}:rename", script_key(workbook_id, from))
}

/// Does a write replace what a reload from disk replaces: the script list or a script of the workbook?
pub fn is_reloaded_key(key: &str, workbook_id: &str) -> bool {
    let scripts = workbook_scripts_key(workbook_id);
    key == workbook_script_list_key(workbook_id) || key.strip_prefix(&scripts).is_some_and(|rest| rest.starts_with('/'))
}

/// The file of a script that the tasks of a workbook keep their order on: two names of the same file share it
pub fn script_file(workbook_id: &str, file_name: &str) -> String {
    script_key(workbook_id, &crate::workbook_format::files::file_name_key(file_name))
}

/// A key without the prefix of its workbook for display, e.g. `scripts/a.sql:delete`, other keys as they are
pub fn key_within_workbook<'a>(key: &'a str, workbook_id: &str) -> &'a str {
    match key.strip_prefix(workbook_id) {
        Some(rest) if rest.is_empty() => rest,
        Some(rest) => rest.strip_prefix('/').unwrap_or(key),
        None => key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_keys_of_a_workbook() {
        let id = "w";
        assert_eq!(workbook_file_key(id), "w/dashql-workbook.json");
        assert_eq!(workbook_script_list_key(id), "w/dashql-workbook.json:scripts");
        assert_eq!(workbook_attachment_list_key(id), "w/dashql-workbook.json:attachments");
        assert_eq!(workbook_connection_copy_key(id, "c"), "w/dashql-workbook.json:connection/c");
        assert_eq!(script_deletion_key(id, "a.sql"), "w/scripts/a.sql:delete");
        assert_eq!(script_rename_key(id, "a.sql"), "w/scripts/a.sql:rename");
        assert_eq!(attachment_key(id, "a.parquet"), "w/attachments/a.parquet");
        assert_eq!(connection_entry_key("c"), "@manifest/connections/c");
        assert_eq!(connection_file_key("c", "f.sql"), "@connections/c/f.sql");
        assert!(is_reloaded_key(&script_key(id, "a.sql"), id) && !is_reloaded_key(&workbook_creation_key(id), id));
        assert_eq!(script_file(id, "Query.SQL"), "w/scripts/query.sql");
        assert!(
            is_reloaded_key(&workbook_script_list_key(id), id)
                && is_reloaded_key(&script_deletion_key(id, "a.sql"), id)
        );
        assert!(!is_reloaded_key(&workbook_file_key(id), id) && !is_reloaded_key("w/scriptsx", id));
        assert_eq!(key_within_workbook(&script_key(id, "a.sql"), id), "scripts/a.sql");
        assert_eq!(key_within_workbook("@manifest/connections/c", id), "@manifest/connections/c");
        assert!(belongs_to_workbook(&script_key(id, "a.sql"), id) && !belongs_to_workbook("wx/scripts", id));
    }
}
