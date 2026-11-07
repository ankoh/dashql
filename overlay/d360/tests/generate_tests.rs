//! Generate the fixtures of the Data 360 overlay: every documented call with its description by the core and the
//! request it should send, and for one read-only call per function a response with the table it should give.
//!
//! The expected request is computed here from the spec, separately from the runtime in TypeScript, so that the browser
//! test `overlay_fixtures.test.ts` compares two implementations. The responses start as assumptions, built from the
//! result columns of the spec with `source: assumed`. A response with any other source, such as `recorded`, is real data
//! that was put in by hand or by a recorder, and it's kept with its result when the fixtures are generated again.

use dashql_core::analyzer::analyze;
use dashql_core::catalog::Catalog;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

const NOT_FAMILIES: [&str; 3] = ["overview.md", "functions.md", "api_notes.md"];
/// The value of `{api_version}` in the fixtures
const API_VERSION: &str = "68.0";

fn arg(name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    std::env::args().find_map(|a| a.strip_prefix(&prefix).map(str::to_string))
}

/// `encodeURIComponent`
fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// `String(value)` of a scalar
fn scalar_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn find_attribute<'a>(attributes: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    attributes?.as_array()?.iter().find(|a| a["name"] == name)
}

/// The attribute of a name in a schema. A name means one thing in a union, so any variant can answer.
fn find_schema_attribute<'a>(spec: &'a Value, schema: &'a Value, name: &str) -> Option<&'a Value> {
    let variants = schema["variants"].as_array().into_iter().flatten();
    find_attribute(schema.get("attributes"), name).or_else(|| variants.filter_map(|v| find_attribute(spec["schemas"][v.as_str()?].get("attributes"), name)).next())
}

/// A value in the spelling of the API
fn to_api(spec: &Value, value: &Value, attribute: Option<&Value>) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(|i| to_api(spec, i, attribute)).collect()),
        Value::Object(fields) => {
            let schema = attribute.and_then(|a| a["schema"].as_str()).map(|s| &spec["schemas"][s]);
            let mut out = Map::new();
            for (name, field) in fields {
                let field_attribute = schema.and_then(|s| find_schema_attribute(spec, s, name));
                let api_name = field_attribute.and_then(|a| a["api_name"].as_str()).unwrap_or(name);
                out.insert(api_name.to_string(), to_api(spec, field, field_attribute));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// `a[b][0]=1` pairs
fn flatten(name: &str, value: &Value, out: &mut Vec<(String, String)>) {
    match value {
        Value::Null => {}
        Value::Array(items) => items.iter().enumerate().for_each(|(i, item)| flatten(&format!("{name}[{i}]"), item, out)),
        Value::Object(fields) => fields.iter().for_each(|(key, field)| flatten(&format!("{name}[{key}]"), field, out)),
        other => out.push((name.to_string(), scalar_text(other))),
    }
}

fn add_query(name: &str, value: &Value, style: Option<&str>, out: &mut Vec<(String, String)>) {
    match value {
        Value::Null => {}
        Value::Array(items) if style == Some("deep") => items.iter().enumerate().for_each(|(i, item)| flatten(&format!("{name}[{i}]"), item, out)),
        Value::Array(items) if style == Some("csv") => out.push((name.to_string(), items.iter().map(scalar_text).collect::<Vec<_>>().join(","))),
        Value::Array(items) => items.iter().for_each(|item| out.push((name.to_string(), scalar_text(item)))),
        Value::Object(_) => flatten(name, value, out),
        other => out.push((name.to_string(), scalar_text(other))),
    }
}

/// Fill in a binding: `:name` is what EXPLAIN prints
fn bound_options(description: &Value) -> Value {
    let mut options = description["options"].clone();
    for binding in description["bindings"].as_array().into_iter().flatten() {
        let text = format!(":{}", binding["param"].as_str().unwrap());
        *options.pointer_mut(binding["pointer"].as_str().unwrap()).unwrap() = Value::String(text);
    }
    options
}

fn base_path(spec: &Value, host: &str) -> Option<String> {
    Some(spec["hosts"].get(host)?["base_path"].as_str()?.replace("{api_version}", API_VERSION))
}

fn query_value(pairs: Vec<(String, String)>) -> Value {
    Value::Array(pairs.into_iter().map(|(k, v)| json!([k, v])).collect())
}

/// The request of a call, None if the documented call can't build one
fn expected_request(spec: &Value, function: &Value, options: &Value) -> Option<Value> {
    let options = options.as_object()?;
    let is_standard = |name: &str| matches!(name, "_next" | "_pages" | "_poll" | "_wait");
    if function["raw"] == true {
        let host = options.get("host").and_then(Value::as_str).or(function["host"].as_str())?;
        let path = format!("{}{}", base_path(spec, host)?, options.get("path")?.as_str()?);
        let mut query = Vec::new();
        for (name, value) in options {
            if !matches!(name.as_str(), "method" | "path" | "host" | "body") && !is_standard(name) {
                add_query(name, value, None, &mut query);
            }
        }
        let body = options.get("body");
        return Some(json!({
            "method": options.get("method")?.as_str()?.to_uppercase(),
            "host": host,
            "path": path,
            "query": query_value(query),
            "headers": if body.is_some() { json!({"Content-Type": "application/json"}) } else { json!({}) },
            "body": body.cloned().unwrap_or(Value::Null),
        }));
    }
    let declared = function["options"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let has_body = function.get("body").is_some() || declared.iter().any(|o| o["in"].as_str().is_some_and(|l| l.starts_with("body")));
    let mut path_values = BTreeMap::new();
    let mut query = Vec::new();
    let mut headers = Map::new();
    let mut fields = Map::new();
    let mut root = None;
    for (name, value) in options {
        if is_standard(name) {
            continue;
        }
        let attribute = find_attribute(function.get("options"), name);
        let api_name = attribute.and_then(|a| a["api_name"].as_str()).unwrap_or(name);
        let location = attribute.and_then(|a| a["in"].as_str()).unwrap_or(if has_body { "body" } else { "query" });
        if location == "path" {
            path_values.insert(api_name.to_string(), encode_component(&scalar_text(value)));
        } else if location == "query" {
            add_query(api_name, &to_api(spec, value, attribute), attribute.and_then(|a| a["style"].as_str()), &mut query);
        } else if location == "header" {
            headers.insert(api_name.to_string(), Value::String(scalar_text(value)));
        } else if location == "body_root" {
            root = Some(to_api(spec, value, attribute));
        } else {
            fields.insert(api_name.to_string(), to_api(spec, value, attribute));
        }
    }
    let mut path = function["path"].as_str()?.to_string();
    while let Some(begin) = path.find('{') {
        let end = begin + path[begin..].find('}')?;
        let value = path_values.get(&path[begin + 1..end])?.clone();
        path.replace_range(begin..=end, &value);
    }
    let host = function["host"].as_str()?;
    let mut body = Value::Null;
    if root.is_some() || !fields.is_empty() {
        match function["body"].as_str() {
            None | Some("json") => {
                headers.insert("Content-Type".to_string(), json!("application/json"));
                body = root.unwrap_or(Value::Object(fields));
            }
            Some(media_type) => {
                headers.insert("Content-Type".to_string(), json!(media_type));
                body = fields.values().next()?.clone();
            }
        }
    }
    Some(json!({
        "method": function["method"].as_str().unwrap_or("GET"),
        "host": host,
        "path": format!("{}{}", base_path(spec, host)?, path),
        "query": query_value(query),
        "headers": headers,
        "body": body,
    }))
}

/// A value for a column of a type
fn assumed_value(column: &Value) -> Value {
    let name = column["name"].as_str().unwrap();
    match column["type"].as_str().unwrap_or("VARCHAR") {
        "INTEGER" => json!(1),
        "BIGINT" => json!(2),
        "DOUBLE" => json!(0.5),
        "BOOLEAN" => json!(true),
        "TIMESTAMPTZ" => json!("2026-01-02T03:04:05.000Z"),
        "DATE" => json!("2026-01-02"),
        "JSON" => json!({ "assumed": name }),
        _ => json!(format!("{name}_value")),
    }
}

/// Set a pointer, creating the objects on its way
fn set_pointer(target: &mut Value, pointer: &str, value: Value) {
    let segments: Vec<&str> = pointer.split('/').skip(1).collect();
    let Some((last, parents)) = segments.split_last() else {
        *target = value;
        return;
    };
    let mut current = target;
    for segment in parents {
        current = current.as_object_mut().unwrap().entry(segment.to_string()).or_insert_with(|| json!({}));
    }
    current.as_object_mut().unwrap().insert(last.to_string(), value);
}

/// The row of an item: the columns in their spelling, the rest in `_raw`
fn expected_row(function: &Value, item: &Value, status: i64, next: &Value, meta: &Value) -> Value {
    let mut rest = item.as_object().cloned().unwrap_or_default();
    let mut row = Map::new();
    for column in function["columns"].as_array().into_iter().flatten() {
        let name = column["name"].as_str().unwrap();
        let api_name = column["api_name"].as_str().unwrap_or(name);
        let value = rest.remove(api_name).unwrap_or(Value::Null);
        // JSON columns hold text
        let value = if column["type"] == "JSON" && !value.is_null() { Value::String(value.to_string()) } else { value };
        row.insert(name.to_string(), value);
    }
    row.insert("_status".to_string(), json!(status));
    row.insert("_next".to_string(), next.clone());
    row.insert("_meta".to_string(), meta.clone());
    row.insert("_raw".to_string(), if rest.is_empty() { Value::Null } else { Value::Object(rest) });
    Value::Object(row)
}

/// A response that the spec suggests, and the table it should give
fn assumed_response(function: &Value, options: &Value) -> (Value, Value) {
    let mut item = Map::new();
    for column in function["columns"].as_array().into_iter().flatten() {
        let name = column["name"].as_str().unwrap();
        item.insert(column["api_name"].as_str().unwrap_or(name).to_string(), assumed_value(column));
    }
    // A field that the spec doesn't list lands in `_raw`
    item.insert("assumedUnlistedField".to_string(), json!(true));
    let item = Value::Object(item);
    let rows = function["rows"].as_str();
    let mut body = match rows {
        Some("") => json!([]),
        Some(_) => json!({}),
        None => item.clone(),
    };
    if let Some(pointer) = rows {
        set_pointer(&mut body, pointer, json!([item.clone()]));
    }
    let paging = &function["paging"];
    let mut next = Value::Null;
    let kind = paging["kind"].as_str();
    if matches!(kind, Some("url" | "token")) && body.is_object() {
        let value = if kind == Some("url") { json!("/assumed/next-page") } else { json!("assumed-token") };
        set_pointer(&mut body, paging["from"].as_str().unwrap(), value.clone());
        next = value;
    } else if kind == Some("offset") {
        let start = options[paging["option"].as_str().unwrap()].as_i64().or(paging["start"].as_i64()).unwrap_or(0);
        next = json!((start + 1).to_string());
    }
    let meta = match (rows, &body) {
        (Some(pointer), Value::Object(fields)) if !pointer.is_empty() => {
            let rows_field = pointer.split('/').nth(1).unwrap();
            let rest: Map<String, Value> = fields.iter().filter(|(k, _)| k.as_str() != rows_field).map(|(k, v)| (k.clone(), v.clone())).collect();
            if rest.is_empty() { Value::Null } else { Value::Object(rest) }
        }
        _ => Value::Null,
    };
    // Without rows, the body is the row, including a next value that sits in it
    let row_item = if rows.is_some() { item } else { body.clone() };
    let result = json!({ "rows": [expected_row(function, &row_item, 200, &next, &meta)] });
    (json!({ "source": "assumed", "status": 200, "headers": {}, "body": body }), result)
}

fn main() {
    let spec_path = arg("spec").expect("--spec");
    let reference = arg("reference").expect("--reference");
    let tests = arg("tests").expect("--tests");
    let check = std::env::args().any(|a| a == "--check");

    let spec_text = std::fs::read_to_string(&spec_path).unwrap();
    let spec: Value = serde_json::from_str(&spec_text).unwrap();
    let functions: BTreeMap<&str, &Value> = spec["functions"].as_array().unwrap().iter().map(|f| (f["name"].as_str().unwrap(), f)).collect();
    let mut catalog = Catalog::new();
    catalog.register_overlay(&spec_text).expect("the core reads the spec");

    let mut paths: Vec<_> = std::fs::read_dir(&reference).unwrap().map(|e| e.unwrap().path()).collect();
    paths.sort();
    let mut stale = Vec::new();
    let mut covered = BTreeSet::new();
    let mut responded = BTreeSet::new();
    let (mut total, mut kept) = (0, 0);
    for path in paths.iter().filter(|p| p.extension().is_some_and(|e| e == "md")) {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        if NOT_FAMILIES.contains(&file.as_str()) {
            continue;
        }
        let out_path = Path::new(&tests).join(file.replace(".md", ".json"));
        let previous: Value = std::fs::read_to_string(&out_path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        let find_previous = |call: &str| previous["cases"].as_array().into_iter().flatten().find(|c| c["call"] == call);

        let text = std::fs::read_to_string(path).unwrap();
        let mut cases = Vec::new();
        let mut seen = BTreeSet::new();
        for block in text.split("```sql\n").skip(1) {
            let block = block.split("```").next().unwrap();
            if !block.contains("cdp.") || block.contains("(...)") {
                continue;
            }
            let parsed = Arc::new(parse(Arc::new(scan(block, 0, catalog.allocate_entry_id()))));
            let analyzed = analyze(parsed.clone(), &catalog).expect("the analysis runs");
            for call in &analyzed.overlay_calls {
                let (Some(description), Some(name)) = (analyzed.describe_overlay_call(call.ast_statement_id), call.function.as_deref()) else { continue };
                let node = &parsed.nodes[call.ast_node_id as usize];
                let span = resolve_text_span(&parsed.scanned.text, &parsed.scanned.symbols, *node.symbol_span());
                let call_text = block[span.offset as usize..(span.offset + span.length) as usize].to_string();
                // EXPLAIN, and calls that continue another, have no request of their own
                let options = bound_options(&description);
                if call.explain || options.get("_next").is_some() || options.get("_poll").is_some() || !seen.insert(call_text.clone()) {
                    continue;
                }
                let function = functions[name];
                let Some(request) = expected_request(&spec, function, &options) else {
                    panic!("{file}: no request for {call_text}");
                };
                covered.insert(name.to_string());
                let mut case = json!({ "function": name, "call": call_text, "description": description, "request": request });
                total += 1;
                let reads = description["effect"] == "read" && function["raw"] != true;
                if let Some(old) = find_previous(&case["call"].as_str().unwrap().to_string()).filter(|o| o["response"]["source"].as_str().is_some_and(|s| s != "assumed")) {
                    case["response"] = old["response"].clone();
                    case["result"] = old["result"].clone();
                    responded.insert(name.to_string());
                    kept += 1;
                } else if reads && description.get("bindings").is_none() && !responded.contains(name) {
                    let (response, result) = assumed_response(function, &description["options"]);
                    case["response"] = response;
                    case["result"] = result;
                    responded.insert(name.to_string());
                }
                cases.push(case);
            }
        }
        let out = format!("{}\n", serde_json::to_string_pretty(&json!({ "cases": cases })).unwrap());
        if check {
            if std::fs::read_to_string(&out_path).ok().as_deref() != Some(out.as_str()) {
                stale.push(out_path.display().to_string());
            }
        } else {
            std::fs::write(&out_path, out).unwrap();
        }
    }
    let missing: Vec<&&str> = functions.keys().filter(|n| !covered.contains(**n) && functions[**n]["raw"] != true).collect();
    println!("{total} cases, {} functions with a request, {} with a response, {kept} kept", covered.len(), responded.len());
    if !missing.is_empty() {
        println!("no documented call: {missing:?}");
    }
    if !stale.is_empty() {
        eprintln!("stale, run bazel run //overlay/d360:update: {stale:?}");
        std::process::exit(1);
    }
}
