//! JSON helpers of the files of a workbook. The objects keep the order of their keys (`serde_json` with
//! `preserve_order`), like the objects of JavaScript.

use serde_json::{Map, Value};

use dashql_core::error::{Error, Result};

/// A JSON object
pub type JsonObject = Map<String, Value>;

/// The text of a value as `JSON.stringify(value, null, 2)` writes it
pub fn to_pretty_text(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// The text of a value as `JSON.stringify(value)` writes it
pub fn to_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// Parse a JSON text
pub fn parse(text: &str) -> Result<Value> {
    serde_json::from_str(text).map_err(|e| Error::invalid_argument(format!("invalid JSON: {e}")))
}

/// Parse a JSON text that must hold an object, None for any other text
pub fn parse_object(text: &str) -> Option<JsonObject> {
    match serde_json::from_str(text) {
        Ok(Value::Object(object)) => Some(object),
        _ => None,
    }
}

/// A string field of an object
pub fn string_field<'a>(object: &'a JsonObject, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

/// Is a value truthy in JavaScript?
pub fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}
