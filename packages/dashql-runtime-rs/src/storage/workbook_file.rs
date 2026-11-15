//! The parts of the workbook file and the connection entries of the app manifest that the writer patches.
//!
//! Workbook files are JSON values. The keys keep their order: a patched file lists its keys like the file it patched,
//! new keys come last. Two files are equal when the fields the writer owns are equal, in any key order.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// The fields of a workbook file that the writer owns. The other fields are left to the host, e.g. the place of a
/// workbook in a native folder.
const OWNED_FIELDS: [&str; 7] = ["formatVersion", "workbookId", "name", "connections", "scripts", "attachments", "metadata"];

/// Is a value truthy in JavaScript? The workbook files come from JavaScript and the writer reads them the same way.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// A field that is neither absent nor null
pub fn present<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|v| !v.is_null())
}

/// The items of an array field, none for anything else
pub fn items(value: &Value, key: &str) -> Vec<Value> {
    value.get(key).and_then(Value::as_array).cloned().unwrap_or_default()
}

/// The connection id of a script or of a copy of a connection
pub fn connection_id_of(value: &Value) -> Option<&str> {
    value.get("connectionId").and_then(Value::as_str)
}

/// Are the fields that the writer owns equal?
pub fn manifest_equals(a: &Value, b: &Value) -> bool {
    OWNED_FIELDS.iter().all(|field| a.get(field) == b.get(field))
}

/// The ids of the connections that the scripts use, in the order the scripts first use them. A workbook without scripts
/// uses the connection its first script will run on.
pub fn workbook_connection_ids_of(scripts: &[Value], empty_connection_id: Option<&str>) -> Vec<String> {
    if scripts.is_empty() {
        return empty_connection_id.map(str::to_string).into_iter().collect();
    }
    let mut ids: Vec<String> = Vec::new();
    for id in scripts.iter().filter_map(connection_id_of) {
        if !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
    }
    ids
}

/// The workbook with a new script list.
///
/// The workbook holds a copy of every connection that a script uses, nothing else. A copy that the workbook holds wins
/// over a given one. A connection without any copy is left out. A workbook without scripts keeps one connection: the
/// first given copy, or the first connection the workbook held.
pub fn with_workbook_scripts(workbook: &Value, scripts: Vec<Value>, copies: &[Value]) -> Value {
    let held = items(workbook, "connections");
    let mut known: HashMap<&str, &Value> = HashMap::new();
    for copy in held.iter().chain(copies.iter()) {
        if let Some(id) = connection_id_of(copy) {
            known.entry(id).or_insert(copy);
        }
    }
    let empty_connection_id = copies.first().and_then(connection_id_of).or_else(|| held.first().and_then(connection_id_of));
    let connections: Vec<Value> = workbook_connection_ids_of(&scripts, empty_connection_id)
        .iter()
        .filter_map(|id| known.get(id.as_str()).map(|copy| (*copy).clone()))
        .collect();
    let mut next = workbook.as_object().cloned().unwrap_or_default();
    next.insert("connections".to_string(), Value::Array(connections));
    next.insert("scripts".to_string(), Value::Array(scripts));
    Value::Object(next)
}

/// Drop the connections whose id an earlier connection of the list has already
pub fn dedupe_connections(connections: Vec<Value>) -> Vec<Value> {
    let mut seen: Vec<Option<String>> = Vec::new();
    let mut result = Vec::with_capacity(connections.len());
    for connection in connections {
        let id = connection_id_of(&connection).map(str::to_string);
        if seen.contains(&id) {
            continue;
        }
        seen.push(id);
        result.push(connection);
    }
    result
}

/// Replace the copies of a connection in a workbook. The scripts and copies of the connections it replaced, e.g. that
/// were merged into it, move to the connection. None if the workbook is up to date.
pub fn patch_workbook_connection(workbook: &Value, copy: &Value, replaced: &[String]) -> Option<Value> {
    let connection_id = connection_id_of(copy).unwrap_or_default();
    let is_replaced = |id: Option<&str>| id.is_some_and(|id| replaced.iter().any(|r| r == id));
    let mut next = workbook.as_object().cloned().unwrap_or_default();
    if let Some(connections) = workbook.get("connections").and_then(Value::as_array) {
        let patched = connections
            .iter()
            .map(|connection| {
                let id = connection_id_of(connection);
                if id == Some(connection_id) || is_replaced(id) {
                    copy.clone()
                } else {
                    connection.clone()
                }
            })
            .collect();
        next.insert("connections".to_string(), Value::Array(dedupe_connections(patched)));
    }
    if let Some(scripts) = workbook.get("scripts").and_then(Value::as_array) {
        let patched = scripts
            .iter()
            .map(|script| {
                let mut script = script.clone();
                if is_replaced(connection_id_of(&script)) {
                    if let Some(fields) = script.as_object_mut() {
                        fields.insert("connectionId".to_string(), Value::String(connection_id.to_string()));
                    }
                }
                script
            })
            .collect();
        next.insert("scripts".to_string(), Value::Array(patched));
    }
    let next = Value::Object(next);
    if manifest_equals(workbook, &next) {
        None
    } else {
        Some(next)
    }
}

/// Insert or replace a connection entry of the app manifest, keeping its creation time. None if the entry is up to date.
pub fn upsert_connection_entry(connections: Option<&[Value]>, entry: &Value) -> Option<Vec<Value>> {
    let entries = connections.unwrap_or_default();
    let id = entry.get("id");
    let index = entries.iter().position(|e| e.get("id") == id);
    let prev = index.and_then(|i| entries.get(i));
    let mut next = entry.clone();
    if present(entry, "createdAt").is_none() {
        if let (Some(created), Some(fields)) = (prev.and_then(|p| present(p, "createdAt")), next.as_object_mut()) {
            fields.insert("createdAt".to_string(), created.clone());
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

/// Remove a field and keep the order of the others
pub fn remove_field(fields: &mut Map<String, Value>, key: &str) {
    fields.shift_remove(key);
}

/// A time in milliseconds since the epoch as an ISO 8601 timestamp in UTC, like `Date.toISOString`
pub fn iso_timestamp(ms: f64) -> String {
    let ms = if ms.is_finite() { ms.floor() as i64 } else { 0 };
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}

/// The date of a day since the epoch in the proleptic Gregorian calendar
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn formats_timestamps_like_javascript() {
        assert_eq!(iso_timestamp(0.0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_767_225_600_123.0), "2026-01-01T00:00:00.123Z");
        assert_eq!(iso_timestamp(951_782_400_000.0), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn keeps_the_copies_of_the_connections_that_scripts_use() {
        let workbook = json!({ "workbookId": "w", "connections": [{ "connectionId": "a", "params": 1 }], "scripts": [] });
        let scripts = vec![json!({ "name": "b.sql", "connectionId": "b" }), json!({ "name": "a.sql", "connectionId": "a" })];
        let next = with_workbook_scripts(&workbook, scripts, &[json!({ "connectionId": "b", "params": 2 }), json!({ "connectionId": "a", "params": 3 })]);
        assert_eq!(next["connections"], json!([{ "connectionId": "b", "params": 2 }, { "connectionId": "a", "params": 1 }]));
        let keys: Vec<&String> = next.as_object().map(|o| o.keys().collect()).unwrap_or_default();
        assert_eq!(keys, ["workbookId", "connections", "scripts"]);
        // Without scripts the first given copy stays
        let empty = with_workbook_scripts(&workbook, vec![], &[json!({ "connectionId": "c" })]);
        assert_eq!(empty["connections"], json!([{ "connectionId": "c" }]));
        assert_eq!(with_workbook_scripts(&workbook, vec![], &[])["connections"], workbook["connections"]);
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
    fn compares_the_owned_fields_in_any_order() {
        let a = json!({ "name": "x", "metadata": { "a": 1, "b": 2 }, "nativePath": "/a" });
        let b = json!({ "metadata": { "b": 2, "a": 1 }, "name": "x" });
        assert!(manifest_equals(&a, &b));
        assert!(!manifest_equals(&a, &json!({ "name": null, "metadata": { "a": 1, "b": 2 } })));
    }
}
