//! JSON helpers of the files of a workbook. The objects keep the order of their keys (`serde_json` with
//! `preserve_order`), like the objects of JavaScript.

use serde_json::Value;

pub use dashql_core_runtime::connections::{is_truthy, string_field, JsonObject};

/// The text of a value as `JSON.stringify(value, null, 2)` writes it
pub fn to_pretty_text(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// The text of a value as `JSON.stringify(value)` writes it
pub fn to_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// Parse a JSON text that must hold an object, None for any other text
pub fn parse_object(text: &str) -> Option<JsonObject> {
    match serde_json::from_str(text) {
        Ok(Value::Object(object)) => Some(object),
        _ => None,
    }
}
