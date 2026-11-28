//! The layout of the storage: the names of the files and folders of the OPFS root, of a workbook folder and of a
//! native workbook folder, see `docs/design/storage_layout.md`. The file systems stay with the host.

use std::collections::BTreeSet;

use dashql_core::error::{Error, Result};

use dashql_core_runtime::attachments::attachment_parameter_name;

/// The workbook file of a workbook folder
pub const STORAGE_WORKBOOK_FILE: &str = "dashql-workbook.json";
/// The folder of the scripts of a workbook
pub const STORAGE_SCRIPTS_FOLDER: &str = "scripts";
/// The folder of the attachments of a workbook
pub const STORAGE_ATTACHMENTS_FOLDER: &str = "attachments";
/// The folder that holds the files of the connections, `connections/<id>/`
pub const STORAGE_CONNECTIONS_FOLDER: &str = "connections";
/// The relations of the catalog of a connection
pub const STORAGE_CATALOG_RELATIONS: &str = "dashql-catalog-relations.sql";
/// The functions of the catalog of a connection
pub const STORAGE_CATALOG_FUNCTIONS: &str = "dashql-catalog-functions.sql";
/// What the relations of a connection don't say, see `catalog_updates.md`
pub const STORAGE_CATALOG_STATE: &str = "dashql-catalog-state.json";
/// Older versions kept the changes of executed statements here, the file is cleared when it is found
pub const STORAGE_CATALOG_CHANGES: &str = "dashql-catalog-changes.sql";
/// The folder of the workbook tree
pub const STORAGE_WORKBOOK_TREE_FOLDER: &str = "workbooktree";
/// The file of a folder of the workbook tree
pub const STORAGE_FOLDER_FILE: &str = "dashql-folder.json";
/// The draft script of the editor, never a script of a workbook
pub const DRAFT_SCRIPT_FILE: &str = "dashql-draft.sql";
/// The maximum number of scripts and the maximum number of attachments of a workbook
pub const MAX_WORKBOOK_FILES: usize = 2048;
/// The extension of attachments
pub const ATTACHMENT_EXTENSION: &str = dashql_core_runtime::attachments::ATTACHMENT_EXTENSION;
/// The workbook file up to format version 10
pub const LEGACY_SESSION_FILE: &str = "dashql-session.json";
/// The entries of the `.gitignore` of a native workbook folder: the former query result cache and Hyper databases. The
/// results of the scripts stay in the origin private file system.
pub const GITIGNORE_ENTRIES: [&str; 2] = ["cache/", "*.hyper"];

/// Where the files of a workbook live
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StorageType {
    /// The Origin Private File System, `workbooks/<id>/`
    Opfs,
    /// A folder of the file system that one workbook owns
    Native,
}

impl StorageType {
    /// The name in the files, `opfs` or `native`
    pub fn as_str(self) -> &'static str {
        match self {
            StorageType::Opfs => "opfs",
            StorageType::Native => "native",
        }
    }

    /// The storage type of its name
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "opfs" => Some(StorageType::Opfs),
            "native" => Some(StorageType::Native),
            _ => None,
        }
    }
}

/// Is a file name the name of an attachment, a Parquet file? Listings leave other files out.
pub fn is_attachment_file_name(name: &str) -> bool {
    attachment_parameter_name(name).is_some()
}

/// Check the name of an attachment: a plain file name of a Parquet file
pub fn validate_data_file_name(name: &str) -> Result<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err(Error::invalid_argument(format!("Invalid data file basename: {name}")));
    }
    if !is_attachment_file_name(name) {
        return Err(Error::invalid_argument(format!("Only Parquet files can be attached: {name}")));
    }
    Ok(())
}

/// The path of a file of a connection, e.g. `connections/<id>/dashql-catalog-relations.sql`. Workbook bundles carry
/// the catalogs of their connections at the same paths.
pub fn connection_file_path(connection_id: &str, file_name: &str) -> String {
    format!("{STORAGE_CONNECTIONS_FOLDER}/{connection_id}/{file_name}")
}

/// The `.gitignore` of a workbook folder with the entries of the app, None if it has them. Missing entries are
/// appended, a `.gitignore` of the user keeps its lines.
pub fn gitignore_with_entries(existing: Option<&str>) -> Option<String> {
    let existing = existing.unwrap_or("");
    let lines: BTreeSet<&str> = existing.split('\n').map(|line| line.trim_end_matches('\r').trim()).collect();
    let missing: Vec<&str> = GITIGNORE_ENTRIES.iter().copied().filter(|entry| !lines.contains(entry)).collect();
    if missing.is_empty() {
        return None;
    }
    let separator = if !existing.is_empty() && !existing.ends_with('\n') { "\n" } else { "" };
    Some(format!("{existing}{separator}{}\n", missing.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_data_file_names() {
        assert!(validate_data_file_name("a.parquet").is_ok());
        assert!(validate_data_file_name("../escape").unwrap_err().message.contains("basename"));
        assert!(validate_data_file_name("a.csv").unwrap_err().message.contains("Only Parquet files can be attached"));
        assert!(validate_data_file_name(".parquet").is_err());
    }

    #[test]
    fn appends_the_gitignore_entries() {
        assert_eq!(gitignore_with_entries(None).as_deref(), Some("cache/\n*.hyper\n"));
        assert_eq!(gitignore_with_entries(Some("notes.txt\ncache/")).as_deref(), Some("notes.txt\ncache/\n*.hyper\n"));
        assert_eq!(gitignore_with_entries(Some("cache/\r\nresults/\n*.hyper\n")), None);
        assert_eq!(gitignore_with_entries(Some("cache/\r\n*.hyper")), None);
    }
}
