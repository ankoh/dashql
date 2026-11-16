//! The workbook tree: the folders of the sidebar in `workbooktree/`, every directory a folder with a
//! `dashql-folder.json` that lists its workbooks.
//!
//! The host lists the directories and reads the folder files, `read_workbook_tree` builds the tree of them.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde_json::{json, Value};

use dashql_core::error::{Error, Result};

use crate::workbook_format::json::{to_pretty_text, JsonObject};
use crate::workbook_format::layout::{StorageType, STORAGE_FOLDER_FILE, STORAGE_WORKBOOK_TREE_FOLDER};
use crate::workbook_format::natural::natural_compare;

/// A workbook of the workbook tree
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookEntry {
    /// The workbook id
    pub path: String,
    /// Where the files of the workbook live, OPFS if absent
    pub storage_type: Option<StorageType>,
    /// The folder of a native workbook
    pub native_path: Option<String>,
    /// Fields the schema doesn't know
    pub extra: JsonObject,
}

impl WorkbookEntry {
    /// An OPFS workbook
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into(), storage_type: None, native_path: None, extra: JsonObject::new() }
    }

    /// Read an entry, None without a non-empty string `path`
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let path = object.get("path")?.as_str().filter(|path| !path.is_empty())?;
        let mut entry = Self::new(path);
        for (key, value) in object {
            match key.as_str() {
                "path" => {}
                "storageType" => entry.storage_type = value.as_str().and_then(StorageType::parse),
                "nativePath" => entry.native_path = value.as_str().map(str::to_string),
                _ => {
                    entry.extra.insert(key.clone(), value.clone());
                }
            }
        }
        Some(entry)
    }

    /// The entry as JSON
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        object.insert("path".into(), json!(self.path));
        if let Some(storage_type) = self.storage_type {
            object.insert("storageType".into(), json!(storage_type.as_str()));
        }
        if let Some(path) = &self.native_path {
            object.insert("nativePath".into(), json!(path));
        }
        for (key, value) in &self.extra {
            if !object.contains_key(key) {
                object.insert(key.clone(), value.clone());
            }
        }
        Value::Object(object)
    }
}

/// A folder of the workbook tree. The subfolders come before the workbooks, in the natural order of their names, the
/// workbooks keep the order of their folder file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkbookTreeFolder {
    /// The folder name, empty for the root
    pub name: String,
    /// The folder names from the root, empty for the root
    pub path: Vec<String>,
    /// The subfolders, in the natural order of their names
    pub folders: Vec<WorkbookTreeFolder>,
    /// The workbooks of the folder, in the order of the sidebar
    pub workbooks: Vec<WorkbookEntry>,
}

/// A directory of `workbooktree/` as the host lists it
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TreeDirectory {
    /// The directory name, empty for `workbooktree/` itself
    pub name: String,
    /// The text of its `dashql-folder.json`, None if it has none
    pub folder_file: Option<String>,
    /// Its subdirectories
    pub directories: Vec<TreeDirectory>,
}

/// Natural order of folder names (e.g. "q2" < "q10")
pub fn compare_folder_names(left: &str, right: &str) -> Ordering {
    natural_compare(left, right)
}

/// Is a folder path the path of a folder or of one of its subfolders?
pub fn is_folder_path_within(path: &[String], ancestor: &[String]) -> bool {
    path.len() >= ancestor.len() && ancestor.iter().zip(path.iter()).all(|(a, p)| a == p)
}

/// The key of a folder path, e.g. for maps of folders
pub fn folder_path_key(path: &[String]) -> String {
    serde_json::to_string(path).unwrap_or_default()
}

/// Why a name can't name a new folder next to its siblings, None if it can. Names are compared without case.
pub fn folder_name_error(name: &str, siblings: &[String]) -> Option<String> {
    if name.is_empty() {
        return Some("The folder needs a name".into());
    }
    if name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Some(format!("\"{name}\" is not a valid folder name"));
    }
    let lower = name.to_lowercase();
    if siblings.iter().any(|sibling| sibling.to_lowercase() == lower) {
        return Some(format!("There is already a folder \"{name}\""));
    }
    None
}

/// A free name for a new folder next to its siblings: "New folder", "New folder 2", ...
pub fn free_folder_name(siblings: &[String]) -> String {
    let taken: HashSet<String> = siblings.iter().map(|name| name.to_lowercase()).collect();
    if !taken.contains("new folder") {
        return "New folder".into();
    }
    let mut n = 2;
    while taken.contains(&format!("new folder {n}")) {
        n += 1;
    }
    format!("New folder {n}")
}

/// The text of a folder file with the workbooks of a folder
pub fn folder_file_text(workbooks: &[WorkbookEntry]) -> String {
    to_pretty_text(&json!({ "workbooks": workbooks.iter().map(WorkbookEntry::to_json).collect::<Vec<_>>() }))
}

/// Parse a folder file, entries without a workbook id are skipped
pub fn parse_folder_file(text: &str, path: &[String]) -> Result<Vec<WorkbookEntry>> {
    let file_path = || {
        let mut parts = vec![STORAGE_WORKBOOK_TREE_FOLDER.to_string()];
        parts.extend(path.iter().cloned());
        parts.push(STORAGE_FOLDER_FILE.to_string());
        parts.join("/")
    };
    let data: Value = serde_json::from_str(text).map_err(|e| Error::invalid_argument(format!("Invalid {}: {e}", file_path())))?;
    let Some(workbooks) = data.get("workbooks").and_then(Value::as_array) else {
        return Err(Error::invalid_argument(format!("Invalid {}: workbooks must be an array", file_path())));
    };
    Ok(workbooks.iter().filter_map(WorkbookEntry::from_json).collect())
}

/// Read the workbook tree of the directories of `workbooktree/`, the empty tree without it. A directory without a
/// folder file is a folder without workbooks, workbooks that the tree registers twice count where they come first.
pub fn read_workbook_tree(root: Option<&TreeDirectory>) -> Result<WorkbookTreeFolder> {
    let Some(root) = root else {
        return Ok(WorkbookTreeFolder::default());
    };
    let mut tree = read_directory(root, Vec::new())?;
    tree.drop_duplicate_workbooks();
    Ok(tree)
}

fn read_directory(dir: &TreeDirectory, path: Vec<String>) -> Result<WorkbookTreeFolder> {
    let mut folders = Vec::with_capacity(dir.directories.len());
    for child in &dir.directories {
        let mut child_path = path.clone();
        child_path.push(child.name.clone());
        folders.push(read_directory(child, child_path)?);
    }
    folders.sort_by(|a, b| compare_folder_names(&a.name, &b.name));
    let workbooks = match &dir.folder_file {
        Some(text) => parse_folder_file(text, &path)?,
        None => Vec::new(),
    };
    Ok(WorkbookTreeFolder { name: path.last().cloned().unwrap_or_default(), path, folders, workbooks })
}

impl WorkbookTreeFolder {
    /// The workbooks of the tree in the order of the sidebar: the subfolders of a folder before its workbooks
    pub fn flatten(&self) -> Vec<&WorkbookEntry> {
        let mut entries = Vec::new();
        fn visit<'a>(folder: &'a WorkbookTreeFolder, entries: &mut Vec<&'a WorkbookEntry>) {
            for child in &folder.folders {
                visit(child, entries);
            }
            entries.extend(folder.workbooks.iter());
        }
        visit(self, &mut entries);
        entries
    }

    /// The folder at a path, None if there is none
    pub fn folder_at(&self, path: &[String]) -> Option<&WorkbookTreeFolder> {
        let mut current = self;
        for name in path {
            current = current.folders.iter().find(|folder| folder.name == *name)?;
        }
        Some(current)
    }

    fn folder_at_mut(&mut self, path: &[String]) -> Option<&mut WorkbookTreeFolder> {
        let mut current = self;
        for name in path {
            current = current.folders.iter_mut().find(|folder| folder.name == *name)?;
        }
        Some(current)
    }

    /// The path of the folder that holds a workbook, None if the tree doesn't register it
    pub fn find_workbook_folder(&self, workbook_id: &str) -> Option<Vec<String>> {
        if self.workbooks.iter().any(|entry| entry.path == workbook_id) {
            return Some(self.path.clone());
        }
        self.folders.iter().find_map(|folder| folder.find_workbook_folder(workbook_id))
    }

    /// Every folder of the tree, the root included, parents before their subfolders
    pub fn list_folders(&self) -> Vec<&WorkbookTreeFolder> {
        let mut folders = vec![self];
        for child in &self.folders {
            folders.extend(child.list_folders());
        }
        folders
    }

    /// Drop the later registrations of workbooks that the tree registers twice, the first one in tree order wins
    pub fn drop_duplicate_workbooks(&mut self) {
        fn visit(folder: &mut WorkbookTreeFolder, seen: &mut HashSet<String>) {
            for child in &mut folder.folders {
                visit(child, seen);
            }
            folder.workbooks.retain(|entry| seen.insert(entry.path.clone()));
        }
        visit(self, &mut HashSet::new());
    }

    /// Remove a workbook from every folder of the tree
    pub fn remove_workbook(&mut self, workbook_id: &str) {
        for child in &mut self.folders {
            child.remove_workbook(workbook_id);
        }
        self.workbooks.retain(|entry| entry.path != workbook_id);
    }

    /// Insert or replace the entry of a workbook. A registered workbook keeps its place, a new one is appended to the
    /// folder at `folder_path`, or to the root if there is no such folder.
    pub fn upsert_workbook(&mut self, entry: WorkbookEntry, folder_path: &[String]) {
        if let Some(current) = self.find_workbook_folder(&entry.path) {
            if let Some(folder) = self.folder_at_mut(&current) {
                for existing in folder.workbooks.iter_mut().filter(|existing| existing.path == entry.path) {
                    *existing = entry.clone();
                }
            }
            return;
        }
        let target: Vec<String> = if self.folder_at(folder_path).is_some() { folder_path.to_vec() } else { Vec::new() };
        if let Some(folder) = self.folder_at_mut(&target) {
            folder.workbooks.push(entry);
        }
    }

    /// Move a workbook to a position in a folder. The index counts the workbooks of the target folder without the
    /// moved workbook, an index past the end appends. A workbook that the tree doesn't register yet is placed as an
    /// OPFS workbook. Returns false and leaves the tree unchanged if there is no folder at the path.
    pub fn move_workbook(&mut self, workbook_id: &str, folder_path: &[String], index: usize) -> bool {
        if self.folder_at(folder_path).is_none() {
            return false;
        }
        let entry = self
            .find_workbook_folder(workbook_id)
            .and_then(|from| self.folder_at(&from))
            .and_then(|folder| folder.workbooks.iter().find(|entry| entry.path == workbook_id).cloned())
            .unwrap_or_else(|| WorkbookEntry::new(workbook_id));
        self.remove_workbook(workbook_id);
        if let Some(folder) = self.folder_at_mut(folder_path) {
            let at = index.min(folder.workbooks.len());
            folder.workbooks.insert(at, entry);
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str, file: Option<&str>, directories: Vec<TreeDirectory>) -> TreeDirectory {
        TreeDirectory { name: name.into(), folder_file: file.map(str::to_string), directories }
    }

    #[test]
    fn reads_and_edits_a_tree() {
        let root = dir(
            "",
            Some(r#"{"workbooks":[{"path":"a"},{"path":""},{"nope":1},{"path":"b","storageType":"native","nativePath":"/x"}]}"#),
            vec![dir("q10", Some(r#"{"workbooks":[{"path":"c"}]}"#), vec![]), dir("q2", Some(r#"{"workbooks":[{"path":"a"}]}"#), vec![])],
        );
        let mut tree = read_workbook_tree(Some(&root)).unwrap();
        assert_eq!(tree.folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["q2", "q10"]);
        // The first registration in tree order wins: the subfolders come first
        assert_eq!(tree.flatten().iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["a", "c", "b"]);
        assert_eq!(tree.find_workbook_folder("c"), Some(vec!["q10".to_string()]));
        assert!(tree.move_workbook("b", &["q10".into()], 0));
        assert_eq!(tree.folder_at(&["q10".into()]).unwrap().workbooks.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["b", "c"]);
        assert_eq!(tree.folder_at(&["q10".into()]).unwrap().workbooks[0].native_path.as_deref(), Some("/x"));
        assert!(!tree.move_workbook("b", &["missing".into()], 0));
        tree.upsert_workbook(WorkbookEntry::new("d"), &["missing".into()]);
        assert_eq!(tree.workbooks.last().unwrap().path, "d");
        assert!(read_workbook_tree(Some(&dir("", Some("{}"), vec![]))).unwrap_err().message.contains("workbooks must be an array"));
        assert_eq!(read_workbook_tree(None).unwrap(), WorkbookTreeFolder::default());
    }

    #[test]
    fn names_folders() {
        assert_eq!(free_folder_name(&["New Folder".into(), "new folder 2".into()]), "New folder 3");
        assert_eq!(folder_name_error("", &[]).unwrap(), "The folder needs a name");
        assert!(folder_name_error("a/b", &[]).is_some());
        assert!(folder_name_error("Q2", &["q2".into()]).is_some());
        assert_eq!(folder_name_error("q3", &["q2".into()]), None);
        assert_eq!(folder_path_key(&["a".into(), "b".into()]), r#"["a","b"]"#);
    }
}
