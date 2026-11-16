//! The workbook file as the writer patches it, and the connection entries of the app manifest.
//!
//! The writer reads a workbook file as `WorkbookData`: fields the schema doesn't know are kept and written again, a
//! field of the wrong type and a malformed entry of a list are dropped when the file is written again. A patch changes
//! the fields of its task and keeps the others, a write that changes nothing is skipped (`same_file`). The connections
//! of a workbook follow its scripts, see `files::with_workbook_scripts`.

use serde_json::Value;

use crate::workbook_format::data::{WorkbookAttachment, WorkbookCloudLink, WorkbookConnection, WorkbookData};
use crate::workbook_format::files::with_workbook_scripts;

/// Do two workbook files hold the same fields? The order of their keys doesn't count.
pub fn same_file(a: &WorkbookData, b: &WorkbookData) -> bool {
    a.to_json() == b.to_json()
}

/// The workbook file with the given copies of connections, see `WriteTask::WriteWorkbookManifest`: the name, the
/// scripts, the attachments and the metadata on disk stay, the given copies win over the copies on disk. An ephemeral
/// workbook is marked as one, a new file gets its creation time.
pub fn manifest_file(
    existing: Option<&WorkbookData>,
    workbook_id: &str,
    format_version: i64,
    connections: &[WorkbookConnection],
    ephemeral: bool,
    now: &str,
) -> WorkbookData {
    let mut file = existing.cloned().unwrap_or_default();
    file.format_version = format_version;
    file.workbook_id = workbook_id.to_string();
    file.name = file.name.filter(|name| !name.is_empty());
    if file.metadata.created_at.is_none() {
        file.metadata.created_at = Some(now.to_string());
    }
    if ephemeral {
        file.metadata.ephemeral = Some(true);
    }
    let held = std::mem::take(&mut file.connections);
    let copies: Vec<WorkbookConnection> = connections.iter().cloned().chain(held).collect();
    let scripts = std::mem::take(&mut file.scripts);
    with_workbook_scripts(&file, scripts, &copies)
}

/// The workbook file with the properties that the user owns, see `WriteTask::WriteWorkbookProperties`: a name or none,
/// a workbook that is no longer ephemeral loses its marker, a link to a cloud or none.
pub fn properties_patch(existing: &WorkbookData, name: Option<&str>, ephemeral: bool, cloud: Option<&WorkbookCloudLink>) -> WorkbookData {
    let mut file = existing.clone();
    file.name = name.filter(|name| !name.is_empty()).map(str::to_string);
    if !ephemeral {
        file.metadata.ephemeral = None;
    }
    file.metadata.cloud = cloud.cloned();
    file
}

/// The workbook file of a workbook that is written as a whole, see `WriteTask::ReplaceWorkbookScripts`: the scripts,
/// the copies of the connections, the attachments and the creation time on disk stay, a new file holds the given
/// connection. The name is the given one or the one on disk.
pub fn replaced_workbook_file(
    existing: Option<&WorkbookData>,
    workbook_id: &str,
    format_version: i64,
    name: Option<&str>,
    connection: Option<&WorkbookConnection>,
    original_file_name: Option<&str>,
    now: &str,
) -> WorkbookData {
    let mut file = match existing {
        Some(existing) => existing.clone(),
        None => WorkbookData { connections: connection.into_iter().cloned().collect(), ..WorkbookData::default() },
    };
    file.format_version = format_version;
    file.workbook_id = workbook_id.to_string();
    file.name = name.filter(|name| !name.is_empty()).map(str::to_string).or(file.name.filter(|name| !name.is_empty()));
    file.metadata.original_file_name = original_file_name.map(str::to_string);
    if file.metadata.created_at.is_none() {
        file.metadata.created_at = Some(now.to_string());
    }
    let scripts = std::mem::take(&mut file.scripts);
    with_workbook_scripts(&file, scripts, &[])
}

/// The workbook file with the attachments on disk, their names in natural order
pub fn attachments_patch(existing: &WorkbookData, names: &[String]) -> WorkbookData {
    WorkbookData { attachments: names.iter().map(|name| WorkbookAttachment { name: name.clone() }).collect(), ..existing.clone() }
}

/// Insert or replace a connection entry of the app manifest, keeping its creation time. None if the entry is up to date.
///
/// The entries stay JSON values: an entry that the app can't read is kept as it is.
pub fn upsert_connection_entry(connections: Option<&[Value]>, entry: &Value) -> Option<Vec<Value>> {
    let entries = connections.unwrap_or_default();
    let id = entry.get("id");
    let index = entries.iter().position(|e| e.get("id") == id);
    let prev = index.and_then(|i| entries.get(i));
    let mut next = entry.clone();
    let present = |value: &Value| value.get("createdAt").filter(|v| !v.is_null()).cloned();
    if present(entry).is_none() {
        if let (Some(created), Some(fields)) = (prev.and_then(present), next.as_object_mut()) {
            fields.insert("createdAt".to_string(), created);
        }
    }
    if prev == Some(&next) {
        return None;
    }
    let mut result = entries.to_vec();
    match index.and_then(|i| result.get_mut(i)) {
        Some(slot) => *slot = next,
        None => result.push(next),
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbook_format::data::WorkbookScript;
    use serde_json::json;

    const NOW: &str = "2026-01-01T00:00:00.000Z";

    fn file(value: Value) -> WorkbookData {
        WorkbookData::from_json(&value)
    }

    #[test]
    fn keeps_unknown_fields_and_the_fields_of_the_host() {
        let existing = file(json!({
            "formatVersion": 11, "workbookId": "w", "nativePath": "/a", "custom": { "x": 1 }, "name": "n",
            "connections": [], "scripts": [], "attachments": [], "metadata": { "createdAt": "t", "tag": "kept" },
        }));
        let next = properties_patch(&existing, Some("m"), false, None).to_json();
        assert_eq!(next["custom"], json!({ "x": 1 }));
        assert_eq!(next["nativePath"], json!("/a"));
        assert_eq!(next["metadata"], json!({ "createdAt": "t", "tag": "kept" }));
        assert_eq!(next["name"], json!("m"));
        let manifest = manifest_file(Some(&existing), "w", 11, &[], false, NOW).to_json();
        assert_eq!(manifest["custom"], json!({ "x": 1 }));
        assert_eq!(manifest["metadata"]["createdAt"], json!("t"));
    }

    #[test]
    fn writes_a_new_manifest_with_its_creation_time_and_marker() {
        let copy = WorkbookConnection::new("c", json!({ "hyper": {} }));
        let created = manifest_file(None, "w", 11, &[copy.clone()], true, NOW);
        assert_eq!(created.connections, vec![copy]);
        assert_eq!(created.metadata.created_at.as_deref(), Some(NOW));
        assert!(created.metadata.is_ephemeral());
        let keys: Vec<String> = created.to_json().as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
        assert_eq!(keys, ["formatVersion", "workbookId", "connections", "scripts", "attachments", "metadata"]);
        // The properties remove the marker once the workbook is promoted, a write that keeps it changes nothing
        assert!(same_file(&properties_patch(&created, None, true, None), &created));
        assert!(!properties_patch(&created, None, false, None).metadata.is_ephemeral());
    }

    #[test]
    fn keeps_the_scripts_on_disk_when_a_workbook_is_written_as_a_whole() {
        let existing = file(json!({
            "formatVersion": 11, "workbookId": "w", "name": "on disk",
            "connections": [{ "connectionId": "c", "params": {} }], "scripts": [{ "name": "a.sql", "connectionId": "c" }],
            "attachments": [{ "name": "x.parquet" }], "metadata": { "createdAt": "t", "originalFileName": "old" },
        }));
        let next = replaced_workbook_file(Some(&existing), "w", 11, None, None, None, NOW);
        assert_eq!(next.name.as_deref(), Some("on disk"));
        assert_eq!(next.scripts, vec![WorkbookScript::new("a.sql", "c")]);
        assert_eq!(next.metadata.original_file_name, None);
        assert_eq!(next.attachments.len(), 1);
        let fresh = replaced_workbook_file(None, "w", 11, Some("New"), Some(&WorkbookConnection::new("c", json!({}))), Some(""), NOW);
        assert_eq!(fresh.to_json()["connections"], json!([{ "connectionId": "c", "params": {} }]));
        assert_eq!(fresh.metadata.original_file_name.as_deref(), Some(""));
    }

    #[test]
    fn upserts_connection_entries_with_their_creation_time() {
        let entries = [json!({ "id": "a", "params": 1, "createdAt": "t" })];
        let next = upsert_connection_entry(Some(&entries), &json!({ "id": "a", "params": 2 }));
        assert_eq!(next, Some(vec![json!({ "id": "a", "params": 2, "createdAt": "t" })]));
        assert_eq!(upsert_connection_entry(Some(&entries), &json!({ "id": "a", "params": 1 })), None);
        assert_eq!(upsert_connection_entry(None, &json!({ "id": "b" })), Some(vec![json!({ "id": "b" })]));
    }

    #[test]
    fn compares_files_in_any_key_order() {
        let a = file(json!({ "name": "x", "metadata": { "a": 1, "b": 2 }, "nativePath": "/a" }));
        let b = file(json!({ "nativePath": "/a", "metadata": { "b": 2, "a": 1 }, "name": "x" }));
        assert!(same_file(&a, &b));
        assert!(!same_file(&a, &file(json!({ "metadata": { "a": 1, "b": 2 }, "nativePath": "/a" }))));
    }
}
