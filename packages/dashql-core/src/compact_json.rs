//! Print JSON compactly within a line width, e.g. the Vega-Lite specs of `@vis` tags.
//!
//! A value that fits in the rest of its line stays on one line, with a space after `:` and `,`. Objects
//! and arrays that don't fit put each entry on a line of its own, indented by 2 spaces, and try again
//! for every entry. Keys keep their order. Scalars are never split, so long strings can exceed the
//! width.

use serde_json::Value;

const INDENT: &str = "  ";

/// Print a value compactly, its lines are at most `width` wide if the scalars allow it
pub fn to_string_compact(value: &Value, width: usize) -> String {
    let mut out = String::new();
    write_value(&mut out, value, "", 0, width);
    out
}

/// The value on one line
fn one_line(value: &Value) -> String {
    match value {
        Value::Array(items) => format!("[{}]", items.iter().map(one_line).collect::<Vec<_>>().join(", ")),
        Value::Object(entries) => {
            let entries: Vec<String> = entries.iter().map(|(k, v)| format!("{}: {}", key(k), one_line(v))).collect();
            format!("{{{}}}", entries.join(", "))
        }
        _ => value.to_string(),
    }
}

fn key(key: &str) -> String {
    Value::String(key.to_string()).to_string()
}

/// Write a value at the indentation `indent`, `taken` is the width of its line without the value: the
/// key in front of it and the comma after it
fn write_value(out: &mut String, value: &Value, indent: &str, taken: usize, width: usize) {
    let line = one_line(value);
    let breakable = match value {
        Value::Array(items) => !items.is_empty(),
        Value::Object(entries) => !entries.is_empty(),
        _ => false,
    };
    if !breakable || indent.len() + taken + line.len() <= width {
        out.push_str(&line);
        return;
    }
    let inner = format!("{indent}{INDENT}");
    let entry = |out: &mut String, last: bool| {
        out.push('\n');
        out.push_str(&inner);
        usize::from(!last)
    };
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                let last = i + 1 == items.len();
                let comma = entry(out, last);
                write_value(out, item, &inner, comma, width);
                if !last {
                    out.push(',');
                }
            }
            out.push('\n');
            out.push_str(indent);
            out.push(']');
        }
        Value::Object(entries) => {
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                let last = i + 1 == entries.len();
                let comma = entry(out, last);
                let k = key(k);
                out.push_str(&k);
                out.push_str(": ");
                write_value(out, v, &inner, k.len() + 2 + comma, width);
                if !last {
                    out.push(',');
                }
            }
            out.push('\n');
            out.push_str(indent);
            out.push('}');
        }
        _ => unreachable!("scalars fit on one line"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compact(json: &str, width: usize) -> String {
        to_string_compact(&serde_json::from_str(json).unwrap(), width)
    }

    #[test]
    fn keeps_values_that_fit_on_one_line() {
        assert_eq!(compact(r#"{"mark":"bar","x":[1,2.5,null,true]}"#, 80), r#"{"mark": "bar", "x": [1, 2.5, null, true]}"#);
        assert_eq!(compact("[]", 0), "[]");
        assert_eq!(compact("{}", 0), "{}");
        assert_eq!(compact(r#""a\"b""#, 0), r#""a\"b""#);
    }

    #[test]
    fn breaks_what_does_not_fit() {
        let spec = r#"{"mark": {"type": "line", "point": true}, "encoding": {"x": {"field": "date", "type": "temporal"}, "y": {"field": "revenue", "aggregate": "sum"}}}"#;
        assert_eq!(
            compact(spec, 50),
            r#"{
  "mark": {"type": "line", "point": true},
  "encoding": {
    "x": {"field": "date", "type": "temporal"},
    "y": {"field": "revenue", "aggregate": "sum"}
  }
}"#
        );
        // The key and the comma count, `"x": ...,` is 46 wide
        assert_eq!(compact(r#"[{"x": {"field": "date", "type": "temporal"}}, 1]"#, 47), "[\n  {\"x\": {\"field\": \"date\", \"type\": \"temporal\"}},\n  1\n]");
        assert_eq!(
            compact(r#"[{"x": {"field": "date", "type": "temporal"}}, 1]"#, 46),
            "[\n  {\n    \"x\": {\"field\": \"date\", \"type\": \"temporal\"}\n  },\n  1\n]"
        );
    }

    #[test]
    fn keeps_the_key_order() {
        assert_eq!(compact(r#"{"b": 1, "a": 2}"#, 80), r#"{"b": 1, "a": 2}"#);
    }

    #[test]
    fn prints_what_it_reads() {
        let spec = r#"{"layer": [{"mark": "bar"}, {"mark": {"type": "text", "dy": -5}, "encoding": {"text": {"field": "a b"}}}], "width": 300}"#;
        for width in [0, 20, 40, 80] {
            let once = compact(spec, width);
            assert_eq!(serde_json::from_str::<Value>(&once).unwrap(), serde_json::from_str::<Value>(spec).unwrap());
            assert_eq!(compact(&once, width), once);
        }
    }
}
