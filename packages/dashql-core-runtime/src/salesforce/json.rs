//! JSON the way JavaScript reads it: the text of a value and the number of a value, so the responses of Salesforce read
//! as the JavaScript of the app read them.

use serde_json::{Number, Value};

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

/// A string as `JSON.stringify` writes it
pub fn to_json_text(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_numbers_like_javascript() {
        assert_eq!(js_number_text(12.0), "12");
        assert_eq!(js_number_text(0.5), "0.5");
        assert_eq!(js_string(&json!(1.0)), "1");
        assert_eq!(js_string(&json!([1, null, "a"])), "1,,a");
        assert_eq!(js_number(&json!(" 12 ")), 12.0);
        assert!(js_number(&json!("inf")).is_nan());
        assert_eq!(js_number(&json!("-Infinity")), f64::NEG_INFINITY);
    }
}
