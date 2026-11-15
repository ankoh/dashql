//! JSON the way the TypeScript runtime read it: JSON pointers, the text of a value and the number of a value, so a
//! request carries the same text as before.

use serde_json::{Map, Number, Value};

/// The segments of a JSON pointer
pub fn json_pointer_segments(pointer: &str) -> Vec<String> {
    pointer.split('/').skip(1).map(|segment| segment.replace("~1", "/").replace("~0", "~")).collect()
}

/// Read a JSON pointer, none if the path doesn't exist
pub fn read_json_pointer<'a>(value: &'a Value, pointer: &str) -> Option<&'a Value> {
    if pointer.is_empty() {
        return Some(value);
    }
    let mut current = value;
    for segment in json_pointer_segments(pointer) {
        current = match current {
            Value::Array(items) => items.get(segment.parse::<usize>().ok()?)?,
            Value::Object(fields) => fields.get(&segment)?,
            _ => return None,
        };
    }
    Some(current)
}

/// The text of a number as JavaScript writes it: integers without a fraction
pub fn js_number_text(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_string()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
    } else if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i128)
    } else {
        format!("{n}")
    }
}

/// The text of a JSON number as JavaScript writes it
fn number_text(n: &Number) -> String {
    if n.is_i64() || n.is_u64() {
        n.to_string()
    } else {
        js_number_text(n.as_f64().unwrap_or(f64::NAN))
    }
}

/// The text of a value, as `String(value)` writes it
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_text(n),
        Value::String(s) => s.clone(),
        // An array joins its items, null items are empty
        Value::Array(items) => items
            .iter()
            .map(|item| if item.is_null() { String::new() } else { js_string(item) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// Parse a number from text as `Number(text)` does for decimal text, NaN if it isn't one. Empty text is 0.
pub fn js_number_from_str(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    // Rust reads `inf` and `nan`, JavaScript only `Infinity`
    let lower = trimmed.trim_start_matches(['+', '-']).to_ascii_lowercase();
    if lower.starts_with("inf") || lower.starts_with("nan") {
        return match trimmed.trim_start_matches('+') {
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            _ => f64::NAN,
        };
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// The number of a value, as `Number(value)` reads it
pub fn js_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => js_number_from_str(s),
        Value::Array(items) => match items.as_slice() {
            [] => 0.0,
            [item] => js_number(item),
            _ => f64::NAN,
        },
        Value::Object(_) => f64::NAN,
    }
}

/// A number as a JSON value, an integer if it is one. `JSON.stringify` writes NaN as null.
pub fn number_value(n: f64) -> Value {
    if n.is_finite() && n == n.trunc() && n.abs() <= 9_007_199_254_740_991.0 {
        Value::from(n as i64)
    } else {
        Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// Is a value truthy in JavaScript?
pub fn js_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// Is a value absent, null or empty text?
pub fn is_empty_value(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null)) || matches!(value, Some(Value::String(s)) if s.is_empty())
}

/// An object without a key, the other keys keep their order
pub fn without_key(object: &Map<String, Value>, key: &str) -> Map<String, Value> {
    object.iter().filter(|(k, _)| k.as_str() != key).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// A string as `JSON.stringify` writes it
pub fn to_json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_pointers() {
        let value = json!({ "a": [{ "b/c": 1 }], "": 2 });
        assert_eq!(read_json_pointer(&value, "/a/0/b~1c"), Some(&json!(1)));
        assert_eq!(read_json_pointer(&value, "/a/1"), None);
        assert_eq!(read_json_pointer(&value, "/a/x"), None);
        assert_eq!(read_json_pointer(&value, "/"), Some(&json!(2)));
        assert_eq!(read_json_pointer(&value, ""), Some(&value));
    }

    #[test]
    fn writes_numbers_like_javascript() {
        assert_eq!(js_number_text(12.0), "12");
        assert_eq!(js_number_text(0.5), "0.5");
        assert_eq!(js_string(&json!(1.0)), "1");
        assert_eq!(js_string(&json!([1, null, "a"])), "1,,a");
        assert_eq!(js_number(&json!(" 12 ")), 12.0);
        assert!(js_number(&json!("inf")).is_nan());
        assert_eq!(js_number(&json!("-Infinity")), f64::NEG_INFINITY);
        assert_eq!(number_value(12.0), json!(12));
    }
}
