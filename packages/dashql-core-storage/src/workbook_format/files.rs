//! The file lists of a workbook file: the scripts in feed order and the attachments, reconciled with the files that
//! exist.
//!
//! File names are compared in NFC and without case, like on a case-insensitive file system that normalizes Unicode
//! (`file_name_key`): the names of a listing, of a workbook file and of the workbook tables of an archive alike.

use std::collections::{HashMap, HashSet};

use unicode_normalization::UnicodeNormalization;

use crate::workbook_format::data::{WorkbookAttachment, WorkbookConnection, WorkbookData, WorkbookScript};
use crate::workbook_format::layout::{is_attachment_file_name, DRAFT_SCRIPT_FILE, MAX_WORKBOOK_FILES};
use dashql_core_runtime::natural::sort_naturally;
use crate::workbook_format::validation::is_valid_uuid;

/// Is a name a plain file name that can't escape its folder? A `:` would name an alternate data stream on NTFS.
pub fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.encode_utf16().count() <= 255
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0', ':'])
}

/// The key under which two file names denote the same file: in NFC and in lower case, as on a case-insensitive file
/// system that normalizes Unicode
pub fn file_name_key(name: &str) -> String {
    nfc(name).to_lowercase()
}

/// A name in NFC
pub fn nfc(name: &str) -> String {
    name.nfc().collect()
}

/// Is a name the name of a script file?
pub fn is_script_file_name(name: &str) -> bool {
    is_safe_file_name(name) && name.to_lowercase().ends_with(".sql") && file_name_key(name) != DRAFT_SCRIPT_FILE
}

/// The file lists of a workbook after the unusable entries were removed
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedWorkbookFiles {
    /// The scripts in feed order
    pub scripts: Vec<WorkbookScript>,
    /// The attachments in natural order
    pub attachments: Vec<WorkbookAttachment>,
    /// False when entries were removed
    pub valid: bool,
}

/// Remove the entries of the file lists that can't be used: names that are not plain file names, scripts without a
/// valid connection id, attachments that aren't Parquet files, duplicates and entries beyond the limit.
///
/// The lists of a workbook file are edited by hand, a bad entry therefore does not reject the workbook.
pub fn sanitize_workbook_files(workbook: &WorkbookData) -> SanitizedWorkbookFiles {
    let mut valid = !workbook.malformed_lists;
    let mut scripts = Vec::new();
    let mut script_keys = HashSet::new();
    for script in &workbook.scripts {
        if scripts.len() >= MAX_WORKBOOK_FILES {
            valid = false;
            break;
        }
        let key = file_name_key(&script.name);
        if !is_script_file_name(&script.name) || !is_valid_uuid(&script.connection_id) || script_keys.contains(&key) {
            valid = false;
            continue;
        }
        script_keys.insert(key);
        scripts.push(script.clone());
    }
    let mut attachment_names = Vec::new();
    let mut attachment_keys = HashSet::new();
    for attachment in &workbook.attachments {
        if attachment_names.len() >= MAX_WORKBOOK_FILES {
            valid = false;
            break;
        }
        let key = file_name_key(&attachment.name);
        // A workbook attaches Parquet files only
        if !is_safe_file_name(&attachment.name) || !is_attachment_file_name(&attachment.name) || attachment_keys.contains(&key) {
            valid = false;
            continue;
        }
        attachment_keys.insert(key);
        attachment_names.push(attachment.name.clone());
    }
    SanitizedWorkbookFiles { scripts, attachments: workbook_attachments(&attachment_names), valid }
}

/// The workbook with its file lists sanitized, and whether they were valid
pub fn with_sanitized_files(workbook: &WorkbookData) -> (WorkbookData, bool) {
    let files = sanitize_workbook_files(workbook);
    let next = WorkbookData { scripts: files.scripts, attachments: files.attachments, malformed_lists: false, ..workbook.clone() };
    (next, files.valid)
}

/// The scripts of a workbook reconciled with the script files
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciledWorkbookScripts {
    /// The scripts in feed order, one entry per file
    pub scripts: Vec<WorkbookScript>,
    /// Did the reconciliation change the scripts?
    pub changed: bool,
}

/// Reconcile the scripts of a workbook with the script files that exist.
///
/// Entries keep their order. An entry without a file is dropped, the first of several entries for a file wins and an
/// entry that names a file with a different case takes the name of the file. Files without an entry are appended in
/// natural order, they run on the connection of the script before them or, without scripts, on the given connection.
pub fn reconcile_workbook_scripts(
    scripts: &[WorkbookScript],
    file_names: &[String],
    fallback_connection_id: &str,
) -> ReconciledWorkbookScripts {
    let files_by_name: HashSet<&str> = file_names.iter().map(String::as_str).collect();
    let mut files_by_key: HashMap<String, &str> = HashMap::new();
    for name in file_names {
        files_by_key.entry(file_name_key(name)).or_insert(name.as_str());
    }
    let mut listed: HashSet<&str> = HashSet::new();
    let mut result: Vec<WorkbookScript> = Vec::new();
    let mut changed = false;
    for script in scripts {
        let name = if files_by_name.contains(script.name.as_str()) {
            Some(script.name.as_str())
        } else {
            files_by_key.get(&file_name_key(&script.name)).copied()
        };
        let Some(name) = name.filter(|name| !listed.contains(name)) else {
            changed = true;
            continue;
        };
        if name != script.name {
            changed = true;
        }
        listed.insert(name);
        result.push(WorkbookScript::new(name, script.connection_id.clone()));
    }
    let mut unlisted: Vec<&str> = file_names.iter().map(String::as_str).filter(|name| !listed.contains(name)).collect();
    sort_naturally(&mut unlisted, |name| name);
    for name in unlisted {
        if !listed.insert(name) {
            continue;
        }
        let connection_id = result.last().map(|script| script.connection_id.clone()).unwrap_or_else(|| fallback_connection_id.to_string());
        result.push(WorkbookScript::new(name, connection_id));
        changed = true;
    }
    ReconciledWorkbookScripts { scripts: result, changed }
}

/// The attachment list of a workbook for the given file names, in natural order
pub fn workbook_attachments(file_names: &[String]) -> Vec<WorkbookAttachment> {
    let mut names = file_names.to_vec();
    sort_naturally(&mut names, |name| name.as_str());
    names.into_iter().map(|name| WorkbookAttachment { name }).collect()
}

/// The ids of the connections that a workbook uses: the connections of its scripts in the order the scripts first use
/// them. A workbook without scripts uses the connection its first script will run on.
pub fn workbook_connection_ids_of(scripts: &[WorkbookScript], empty_connection_id: Option<&str>) -> Vec<String> {
    if scripts.is_empty() {
        return empty_connection_id.map(|id| vec![id.to_string()]).unwrap_or_default();
    }
    let mut seen = HashSet::new();
    scripts.iter().filter(|script| seen.insert(script.connection_id.as_str())).map(|script| script.connection_id.clone()).collect()
}

/// The workbook with a new script list.
///
/// The connections of a workbook are derived from its scripts: the workbook holds a copy of every connection that a
/// script uses, nothing else. A copy that the workbook holds wins over a given one. A connection without any copy is
/// left out, the loader then runs its scripts on the embedded database.
///
/// A workbook without scripts keeps one connection, the one its first script will run on: the first given copy, or
/// the first connection the workbook held.
pub fn with_workbook_scripts(workbook: &WorkbookData, scripts: Vec<WorkbookScript>, copies: &[WorkbookConnection]) -> WorkbookData {
    let mut known: HashMap<&str, &WorkbookConnection> = HashMap::new();
    for copy in workbook.connections.iter().chain(copies.iter()) {
        known.entry(copy.connection_id.as_str()).or_insert(copy);
    }
    let empty_connection_id = copies.first().or(workbook.connections.first()).map(|copy| copy.connection_id.as_str());
    let connections = workbook_connection_ids_of(&scripts, empty_connection_id)
        .iter()
        .filter_map(|connection_id| known.get(connection_id.as_str()).map(|copy| (*copy).clone()))
        .collect();
    WorkbookData { connections, scripts, ..workbook.clone() }
}

/// Replace the connection ids of the scripts, ids without a replacement are kept
pub fn remap_workbook_scripts(scripts: &[WorkbookScript], connection_ids: &HashMap<String, String>) -> Vec<WorkbookScript> {
    scripts
        .iter()
        .map(|script| WorkbookScript {
            name: script.name.clone(),
            connection_id: connection_ids.get(&script.connection_id).cloned().unwrap_or_else(|| script.connection_id.clone()),
        })
        .collect()
}

/// Drop the connections that an earlier connection of the list references already
pub fn dedupe_connections(connections: Vec<WorkbookConnection>) -> Vec<WorkbookConnection> {
    let mut seen = HashSet::new();
    connections.into_iter().filter(|connection| seen.insert(connection.connection_id.clone())).collect()
}

/// The workbook with a copy of a connection in place of the copies it replaces (with the same id or an id in
/// `replaced`), the scripts of a replaced connection follow it. None if nothing changed.
pub fn patch_workbook_connection(workbook: &WorkbookData, copy: &WorkbookConnection, replaced: &[String]) -> Option<WorkbookData> {
    let references = |id: &str| id == copy.connection_id || replaced.iter().any(|r| r == id);
    let connections = dedupe_connections(
        workbook.connections.iter().map(|connection| if references(&connection.connection_id) { copy.clone() } else { connection.clone() }).collect(),
    );
    let scripts = workbook
        .scripts
        .iter()
        .map(|script| {
            if replaced.contains(&script.connection_id) {
                WorkbookScript::new(script.name.clone(), copy.connection_id.clone())
            } else {
                script.clone()
            }
        })
        .collect();
    let next = WorkbookData { connections, scripts, ..workbook.clone() };
    (next.to_json() != workbook.to_json()).then_some(next)
}
