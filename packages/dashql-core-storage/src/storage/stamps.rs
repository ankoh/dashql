//! The stamps of the workbook folders that may change outside the app (docs/design/native_file_sync.md).
//!
//! A stamp is the size and the modification time of a file. The writer records the stamp of every script and of the
//! workbook file that it writes, the restore and the checks of a folder acknowledge what the folder holds. Once a
//! folder is acknowledged, a write of the writer expects the recorded stamp on disk (`Expect`) and the host refuses it
//! with an external change when the disk differs. A folder that was never acknowledged is written without a check, a
//! folder of the storage root never is.
//!
//! Scripts are recorded by `files::file_name_key`: two names that denote the same file on a case-insensitive file
//! system or in another Unicode normalization share their stamp.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

use crate::workbook_format::files::file_name_key;
use crate::workbook_format::layout::STORAGE_WORKBOOK_FILE;

/// The size and the modification time of a file
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FileStamp {
    pub size: f64,
    pub mtime_ms: f64,
}

/// A file of a folder with its stamp
#[derive(Clone, Debug, PartialEq)]
pub struct NamedStamp {
    pub name: String,
    pub stamp: FileStamp,
}

/// The scripts, the attachments and the workbook file of a workbook folder with their stamps
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FolderListing {
    pub scripts: Vec<NamedStamp>,
    pub attachments: Vec<NamedStamp>,
    /// The workbook file, none if there is none
    pub workbook: Option<FileStamp>,
}

/// What a write expects of the file it replaces
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Expect {
    /// The folder was never acknowledged, the write is not checked
    Any,
    /// The file must not exist
    Absent,
    /// The file must have this stamp
    Stamp(FileStamp),
}

impl Expect {
    fn of(stamp: Option<FileStamp>) -> Expect {
        stamp.map_or(Expect::Absent, Expect::Stamp)
    }
}

/// What the app wrote or acknowledged of a folder
#[derive(Default)]
struct Folder {
    /// The scripts by their key, with the name and the stamp; a script without an entry is absent
    scripts: BTreeMap<String, NamedStamp>,
    workbook: Option<FileStamp>,
}

/// The stamps of the acknowledged folders by workbook. Every call borrows the state only for its own duration.
#[derive(Default)]
pub struct FolderStamps {
    folders: RefCell<HashMap<String, Folder>>,
}

impl FolderStamps {
    /// The folder holds what the app shows: later writes check the disk against these stamps
    pub fn acknowledge(&self, workbook_id: &str, listing: &FolderListing) {
        let scripts = listing.scripts.iter().map(|script| (file_name_key(&script.name), script.clone())).collect();
        self.folders.borrow_mut().insert(workbook_id.to_string(), Folder { scripts, workbook: listing.workbook });
    }

    /// Was the folder of a workbook acknowledged?
    pub fn is_acknowledged(&self, workbook_id: &str) -> bool {
        self.folders.borrow().contains_key(workbook_id)
    }

    /// Forget the stamps of a workbook, e.g. after it was deleted
    pub fn forget(&self, workbook_id: &str) {
        self.folders.borrow_mut().remove(workbook_id);
    }

    /// What a write of a script expects on disk
    pub fn expect_script(&self, workbook_id: &str, name: &str) -> Expect {
        match self.folders.borrow().get(workbook_id) {
            Some(folder) => Expect::of(folder.scripts.get(&file_name_key(name)).map(|script| script.stamp)),
            None => Expect::Any,
        }
    }

    /// What a write of the workbook file expects on disk
    pub fn expect_workbook(&self, workbook_id: &str) -> Expect {
        match self.folders.borrow().get(workbook_id) {
            Some(folder) => Expect::of(folder.workbook),
            None => Expect::Any,
        }
    }

    /// The app wrote a script, with the stamp that the host returned. A host without stamps records nothing.
    pub fn wrote_script(&self, workbook_id: &str, name: &str, stamp: Option<FileStamp>) {
        let mut folders = self.folders.borrow_mut();
        let (Some(folder), Some(stamp)) = (folders.get_mut(workbook_id), stamp) else { return };
        folder.scripts.insert(file_name_key(name), NamedStamp { name: name.to_string(), stamp });
    }

    /// The app deleted a script
    pub fn deleted_script(&self, workbook_id: &str, name: &str) {
        if let Some(folder) = self.folders.borrow_mut().get_mut(workbook_id) {
            folder.scripts.remove(&file_name_key(name));
        }
    }

    /// The app renamed a script, the file keeps its stamp
    pub fn renamed_script(&self, workbook_id: &str, from: &str, to: &str) {
        let mut folders = self.folders.borrow_mut();
        let Some(folder) = folders.get_mut(workbook_id) else { return };
        let moved = folder.scripts.remove(&file_name_key(from));
        match moved {
            Some(script) => {
                folder.scripts.insert(file_name_key(to), NamedStamp { name: to.to_string(), stamp: script.stamp });
            }
            None => {
                folder.scripts.remove(&file_name_key(to));
            }
        }
    }

    /// The app wrote the workbook file
    pub fn wrote_workbook(&self, workbook_id: &str, stamp: Option<FileStamp>) {
        let mut folders = self.folders.borrow_mut();
        if let (Some(folder), Some(stamp)) = (folders.get_mut(workbook_id), stamp) {
            folder.workbook = Some(stamp);
        }
    }

    /// The scripts whose stamps on disk differ from what the app wrote or acknowledged, by name and sorted, then the
    /// workbook file when its stamp differs. Every file differs in a folder that was never acknowledged.
    pub fn changes(&self, workbook_id: &str, listing: &FolderListing) -> Vec<String> {
        let folders = self.folders.borrow();
        let Some(folder) = folders.get(workbook_id) else {
            let mut names: Vec<String> = listing.scripts.iter().map(|script| script.name.clone()).collect();
            names.sort();
            names.extend(listing.workbook.map(|_| STORAGE_WORKBOOK_FILE.to_string()));
            return names;
        };
        let disk: BTreeMap<String, &NamedStamp> =
            listing.scripts.iter().map(|script| (file_name_key(&script.name), script)).collect();
        let mut changed: Vec<String> = Vec::new();
        for (key, script) in &disk {
            if folder.scripts.get(key).map(|known| known.stamp) != Some(script.stamp) {
                changed.push(script.name.clone());
            }
        }
        for (key, known) in &folder.scripts {
            if !disk.contains_key(key) {
                changed.push(known.name.clone());
            }
        }
        changed.sort();
        if listing.workbook != folder.workbook {
            changed.push(STORAGE_WORKBOOK_FILE.to_string());
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(size: f64) -> FileStamp {
        FileStamp { size, mtime_ms: 1.0 }
    }

    fn listing(scripts: &[(&str, f64)], workbook: Option<f64>) -> FolderListing {
        FolderListing {
            scripts: scripts
                .iter()
                .map(|(name, size)| NamedStamp { name: name.to_string(), stamp: stamp(*size) })
                .collect(),
            attachments: Vec::new(),
            workbook: workbook.map(stamp),
        }
    }

    #[test]
    fn checks_nothing_before_the_folder_is_acknowledged() {
        let stamps = FolderStamps::default();
        assert_eq!(stamps.expect_script("w", "a.sql"), Expect::Any);
        assert_eq!(
            stamps.changes("w", &listing(&[("b.sql", 1.0), ("a.sql", 1.0)], Some(1.0))),
            ["a.sql", "b.sql", "dashql-workbook.json"]
        );
        // A host without stamps records nothing
        stamps.wrote_script("w", "a.sql", Some(stamp(1.0)));
        assert!(!stamps.is_acknowledged("w"));
    }

    #[test]
    fn finds_edited_added_and_removed_scripts_against_own_writes() {
        let stamps = FolderStamps::default();
        stamps.acknowledge("w", &listing(&[("a.sql", 1.0), ("b.sql", 1.0)], Some(1.0)));
        assert!(stamps.changes("w", &listing(&[("a.sql", 1.0), ("b.sql", 1.0)], Some(1.0))).is_empty());
        stamps.wrote_script("w", "a.sql", Some(stamp(2.0)));
        stamps.wrote_workbook("w", Some(stamp(3.0)));
        assert!(stamps.changes("w", &listing(&[("a.sql", 2.0), ("b.sql", 1.0)], Some(3.0))).is_empty());
        let changed = stamps.changes("w", &listing(&[("a.sql", 5.0), ("c.sql", 1.0)], Some(1.0)));
        assert_eq!(changed, ["a.sql", "b.sql", "c.sql", "dashql-workbook.json"]);
        assert_eq!(stamps.expect_script("w", "c.sql"), Expect::Absent);
        assert_eq!(stamps.expect_script("w", "a.sql"), Expect::Stamp(stamp(2.0)));
    }

    #[test]
    fn keeps_the_stamp_of_a_renamed_script_and_compares_names_without_case() {
        let stamps = FolderStamps::default();
        stamps.acknowledge("w", &listing(&[("Query.sql", 1.0)], None));
        // A rename that only changes the case keeps the one entry of the file
        stamps.renamed_script("w", "Query.sql", "query.sql");
        assert_eq!(stamps.expect_script("w", "QUERY.sql"), Expect::Stamp(stamp(1.0)));
        assert!(stamps.changes("w", &listing(&[("query.sql", 1.0)], None)).is_empty());
        stamps.renamed_script("w", "query.sql", "b.sql");
        assert_eq!(stamps.expect_script("w", "query.sql"), Expect::Absent);
        stamps.deleted_script("w", "b.sql");
        assert_eq!(stamps.expect_script("w", "b.sql"), Expect::Absent);
        stamps.forget("w");
        assert_eq!(stamps.expect_workbook("w"), Expect::Any);
    }
}
