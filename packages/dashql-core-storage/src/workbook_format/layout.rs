//! The layout of the storage: the names of the files and folders of the OPFS root, of a workbook folder and of a
//! native workbook folder, see `docs/design/storage_layout.md`. The file systems stay with the host.

use std::collections::{BTreeSet, HashMap};

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
/// The monitoring database of a connection, not part of workbook bundles
pub const STORAGE_CONNECTION_MONITORING_FILE: &str = "monitoring.hyper";
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
/// The entries of the `.gitignore` of a workbook folder: the results of the scripts, the former query result cache and
/// Hyper databases
pub const GITIGNORE_ENTRIES: [&str; 3] = ["results/", "cache/", "*.hyper"];
/// The folder of the clouds in the OPFS root, a local cloud attaches a database of it
pub const HYPER_CLOUDS_DIRECTORY: &str = "clouds";

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

/// The Hyper path of the monitoring database of a connection, `hyper_root` is the mount of the OPFS root, e.g.
/// `/mnt/fs`
pub fn connection_monitoring_database_path(hyper_root: &str, connection_id: &str) -> String {
    format!("{hyper_root}/{}", connection_file_path(connection_id, STORAGE_CONNECTION_MONITORING_FILE))
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

/// An entry of a listing of a folder
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderEntry {
    /// The name
    pub name: String,
    /// Is it a folder?
    pub is_directory: bool,
}

/// The script files of a listing of the `scripts` folder of a native workbook, in natural order. A nested folder and
/// the draft script of older versions are errors.
pub fn native_script_files(entries: &[FolderEntry]) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in entries {
        if entry.is_directory {
            return Err(Error::invalid_argument(format!(
                "Invalid V2 workbook layout: nested scripts directory {}",
                entry.name
            )));
        }
        let lower = entry.name.to_lowercase();
        if lower == DRAFT_SCRIPT_FILE {
            return Err(Error::invalid_argument("Invalid V2 workbook layout: dashql-draft.sql is not supported"));
        }
        if lower.ends_with(".sql") {
            names.push(entry.name.clone());
        }
    }
    dashql_core_runtime::natural::sort_naturally(&mut names, |name| name.as_str());
    Ok(names)
}

/// The attachments of a listing of the `attachments` folder of a native workbook, in natural order. Other files are no
/// attachments, a nested folder is an error.
pub fn native_attachment_files(entries: &[FolderEntry]) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in entries {
        if entry.is_directory {
            return Err(Error::invalid_argument(format!(
                "Invalid workbook layout: nested data directory {}",
                entry.name
            )));
        }
        if is_attachment_file_name(&entry.name) {
            validate_data_file_name(&entry.name)?;
            names.push(entry.name.clone());
        }
    }
    dashql_core_runtime::natural::sort_naturally(&mut names, |name| name.as_str());
    Ok(names)
}

/// The size and the modification time of a file
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    /// The size in bytes
    pub size: u64,
    /// The time of the last modification in milliseconds since the epoch
    pub mtime_ms: u64,
}

/// The stamps of the scripts of a native workbook folder as the app last wrote or acknowledged them. A script that
/// changed on disk since then changed outside the app, a write must not replace it.
#[derive(Debug, Clone, Default)]
pub struct ScriptStamps {
    /// The stamps by script, None for a deleted script
    stamps: HashMap<String, Option<FileStamp>>,
    /// Were the scripts acknowledged? From then on a script without a stamp is known to be absent.
    acknowledged: bool,
}

impl ScriptStamps {
    /// Acknowledge the scripts as they are on disk
    pub fn acknowledge(&mut self, scripts: &[(String, FileStamp)]) {
        self.stamps = scripts.iter().map(|(name, stamp)| (name.clone(), Some(*stamp))).collect();
        self.acknowledged = true;
    }

    /// Were the scripts acknowledged?
    pub fn acknowledged(&self) -> bool {
        self.acknowledged
    }

    /// The app wrote a script, its stamp is the one of the write
    pub fn wrote(&mut self, name: &str, stamp: FileStamp) {
        self.stamps.insert(name.to_string(), Some(stamp));
    }

    /// The app deleted a script
    pub fn deleted(&mut self, name: &str) {
        self.stamps.insert(name.to_string(), None);
    }

    /// The app renamed a script, the file keeps its stamp
    pub fn renamed(&mut self, from: &str, to: &str) {
        let stamp = self.stamps.get(from).copied().flatten();
        self.stamps.insert(to.to_string(), stamp);
        self.stamps.insert(from.to_string(), None);
    }

    /// May the app write over a script whose stamp on disk is `on_disk`? Fails with the error of an external change.
    pub fn check_unchanged(&self, workbook_id: &str, name: &str, on_disk: Option<FileStamp>) -> Result<()> {
        if self.acknowledged && on_disk != self.stamps.get(name).copied().flatten() {
            return Err(Error::invalid_argument(format!(
                "script {name} of workbook {workbook_id} changed outside the app"
            )));
        }
        Ok(())
    }

    /// The scripts whose stamps on disk differ from what the app wrote or acknowledged, sorted by name. Every script
    /// differs before the scripts were acknowledged.
    pub fn external_changes(&self, on_disk: &[(String, FileStamp)]) -> Vec<String> {
        let disk: HashMap<&str, FileStamp> = on_disk.iter().map(|(name, stamp)| (name.as_str(), *stamp)).collect();
        let mut names: BTreeSet<&str> = disk.keys().copied().collect();
        for (name, stamp) in &self.stamps {
            if stamp.is_some() {
                names.insert(name.as_str());
            }
        }
        names
            .into_iter()
            .filter(|name| !self.acknowledged || disk.get(name).copied() != self.stamps.get(*name).copied().flatten())
            .map(str::to_string)
            .collect()
    }
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
        assert_eq!(gitignore_with_entries(None).as_deref(), Some("results/\ncache/\n*.hyper\n"));
        assert_eq!(
            gitignore_with_entries(Some("notes.txt\ncache/")).as_deref(),
            Some("notes.txt\ncache/\nresults/\n*.hyper\n")
        );
        assert_eq!(gitignore_with_entries(Some("cache/\r\nresults/\n*.hyper\n")), None);
    }

    #[test]
    fn lists_the_scripts_of_a_native_folder() {
        let entry = |name: &str, is_directory| FolderEntry { name: name.into(), is_directory };
        assert_eq!(
            native_script_files(&[entry("10_last.sql", false), entry("2_first.sql", false), entry("x.txt", false)])
                .unwrap(),
            ["2_first.sql", "10_last.sql"]
        );
        assert!(native_script_files(&[entry("page", true)]).unwrap_err().message.contains("nested scripts directory"));
        assert!(native_script_files(&[entry("dashql-draft.sql", false)])
            .unwrap_err()
            .message
            .contains("dashql-draft.sql is not supported"));
        assert_eq!(
            native_attachment_files(&[entry("10.parquet", false), entry("2.parquet", false), entry("n.csv", false)])
                .unwrap(),
            ["2.parquet", "10.parquet"]
        );
    }

    #[test]
    fn finds_external_script_changes() {
        let stamp = |size| FileStamp { size, mtime_ms: 1 };
        let mut stamps = ScriptStamps::default();
        assert_eq!(stamps.external_changes(&[("a.sql".into(), stamp(1))]), ["a.sql"]);
        stamps.acknowledge(&[("a.sql".into(), stamp(1)), ("b.sql".into(), stamp(1))]);
        assert!(stamps.check_unchanged("w", "a.sql", Some(stamp(1))).is_ok());
        assert!(stamps.check_unchanged("w", "a.sql", Some(stamp(2))).is_err());
        assert!(stamps.check_unchanged("w", "new.sql", None).is_ok());
        stamps.wrote("c.sql", stamp(3));
        stamps.renamed("b.sql", "d.sql");
        assert_eq!(
            stamps.external_changes(&[
                ("a.sql".into(), stamp(2)),
                ("c.sql".into(), stamp(3)),
                ("d.sql".into(), stamp(1))
            ]),
            ["a.sql"]
        );
    }
}
