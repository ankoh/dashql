//! Generate the Data 360 overlay from its sources.
//!
//! `overlay/d360/api/*.yaml` is the source, edited by hand: `overlay.yaml` holds the overlay itself and every other file
//! one family with its functions, schemas and prose. This writes two things from it, and reads nothing back from either:
//!
//! - `spec.json`, the facts that the core and the runtime read and the app bundles. A build output, not checked in.
//! - The family documents of `overlay/d360/docs/`, in full. They are checked in, so that they can be read anywhere.
//!
//!     generate_spec --api=<dir> --spec=<out.json>
//!     generate_spec --api=<dir> --docs=<dir> --write|--check

use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use yaml_rust2::{Yaml, YamlLoader};

/// What a person writes in the documents, they aren't generated
const HAND_WRITTEN: [&str; 3] = ["overview.md", "functions.md", "api_notes.md"];
const PART_OF: &str = "Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).";
const SCHEMAS_INTRO: &str = "Attribute names are keywords inside the object they belong to, so completion offers exactly these.";

/// What only the documents read, a function of the spec goes without it
const FUNCTION_PROSE: [&str; 8] = ["description", "example", "result_description", "notes", "spec_url", "reference_url", "tools", "evidence"];
/// The fields that are strings. YAML would read `1.0` or `true` as something else without a word.
const STRING_FIELDS: [&str; 19] = [
    "name", "api_name", "in", "type", "schema", "format", "family", "method", "host", "path", "spec_url", "reference_url", "evidence", "effect",
    "description", "example", "result_description", "notes", "title",
];
/// The fields that are lists of strings
const STRING_LIST_FIELDS: [&str; 3] = ["enum", "tools", "variants"];

fn arg(name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    std::env::args().find_map(|a| a.strip_prefix(&prefix).map(str::to_string))
}

fn has_flag(name: &str) -> bool {
    std::env::args().any(|a| a == format!("--{name}"))
}

/// A YAML value as JSON. A key has to be a string.
fn to_json(yaml: &Yaml) -> Result<Value, String> {
    Ok(match yaml {
        Yaml::Null => Value::Null,
        Yaml::Boolean(b) => Value::Bool(*b),
        Yaml::Integer(i) => Value::from(*i),
        Yaml::Real(text) => text.parse::<f64>().ok().and_then(serde_json::Number::from_f64).map(Value::Number).ok_or(format!("invalid number {text}"))?,
        // A block scalar ends in a line break that isn't part of the text
        Yaml::String(s) => Value::String(s.trim_end_matches('\n').to_string()),
        Yaml::Array(items) => Value::Array(items.iter().map(to_json).collect::<Result<_, _>>()?),
        Yaml::Hash(hash) => {
            let mut out = Map::new();
            for (key, value) in hash {
                let Yaml::String(key) = key else { return Err(format!("the key {key:?} isn't a string, quote it")) };
                out.insert(key.clone(), to_json(value)?);
            }
            Value::Object(out)
        }
        other => return Err(format!("unsupported value {other:?}")),
    })
}

/// Reject a value that YAML typed by itself where a string belongs, such as `enum: [1.0]`
fn check_strings(value: &Value, path: &str, problems: &mut Vec<String>) {
    match value {
        Value::Object(fields) => {
            for (key, field) in fields {
                let here = format!("{path}.{key}");
                if STRING_FIELDS.contains(&key.as_str()) && !field.is_string() {
                    problems.push(format!("{here} isn't a string, quote it: {field}"));
                }
                if STRING_LIST_FIELDS.contains(&key.as_str()) && !field.as_array().is_some_and(|l| l.iter().all(Value::is_string)) {
                    problems.push(format!("{here} isn't a list of strings, quote its items: {field}"));
                }
                check_strings(field, &here, problems);
            }
        }
        Value::Array(items) => items.iter().enumerate().for_each(|(i, item)| check_strings(item, &format!("{path}[{i}]"), problems)),
        _ => {}
    }
}

/// A family: its document and what it owns
struct Family {
    /// The name of its document
    file: String,
    title: String,
    description: Option<String>,
    functions: Vec<Value>,
    schemas: Vec<String>,
}

/// The overlay with its prose
struct Sources {
    /// The fields of the overlay itself
    overlay: Map<String, Value>,
    families: Vec<Family>,
    /// The functions of no family
    other_functions: Vec<Value>,
    schemas: BTreeMap<String, Value>,
}

fn parse_yaml(text: &str, name: &str, problems: &mut Vec<String>) -> Option<Value> {
    let documents = match YamlLoader::load_from_str(text) {
        Ok(documents) => documents,
        Err(e) => {
            problems.push(format!("{name}: {e}"));
            return None;
        }
    };
    let [document] = documents.as_slice() else {
        problems.push(format!("{name}: expected one document"));
        return None;
    };
    match to_json(document) {
        Ok(value) => {
            // The `format` of the overlay is its version, a number, unlike the `format` of an attribute
            let mut checked = value.clone();
            if let Some(fields) = checked.as_object_mut() {
                fields.remove("format");
            }
            check_strings(&checked, name, problems);
            Some(value)
        }
        Err(e) => {
            problems.push(format!("{name}: {e}"));
            None
        }
    }
}

fn functions_of(value: &mut Map<String, Value>) -> Vec<Value> {
    match value.remove("functions") {
        Some(Value::Array(functions)) => functions,
        _ => Vec::new(),
    }
}

/// Read the sources of a directory, `overlay.yaml` and a family per other file
fn read_sources(files: &[(String, String)], problems: &mut Vec<String>) -> Option<Sources> {
    let mut sources = Sources { overlay: Map::new(), families: Vec::new(), other_functions: Vec::new(), schemas: BTreeMap::new() };
    let mut found_overlay = false;
    for (name, text) in files {
        let Some(Value::Object(mut document)) = parse_yaml(text, name, problems) else { continue };
        let functions = functions_of(&mut document);
        if name == "overlay.yaml" {
            sources.overlay = document;
            sources.other_functions = functions;
            found_overlay = true;
            continue;
        }
        let mut family = Family {
            file: format!("{}.md", name.trim_end_matches(".yaml")),
            title: document.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
            description: document.get("description").and_then(Value::as_str).map(str::to_string),
            functions,
            schemas: Vec::new(),
        };
        if family.title.is_empty() {
            problems.push(format!("{name}: no title"));
        }
        if let Some(Value::Object(schemas)) = document.remove("schemas") {
            for (schema_name, schema) in schemas {
                if sources.schemas.insert(schema_name.clone(), schema).is_some() {
                    problems.push(format!("{name}: another family defines the schema {schema_name} as well"));
                }
                family.schemas.push(schema_name);
            }
        }
        sources.families.push(family);
    }
    if !found_overlay {
        problems.push("no overlay.yaml".to_string());
        return None;
    }
    sources.families.sort_by(|l, r| l.file.cmp(&r.file));
    Some(sources)
}

/// The schemas that a schema needs, itself included
fn reach(schemas: &BTreeMap<String, Value>, name: &str, out: &mut BTreeSet<String>, owner: &str, problems: &mut Vec<String>) {
    let Some(schema) = schemas.get(name) else {
        problems.push(format!("{owner}: unknown schema {name}"));
        return;
    };
    if !out.insert(name.to_string()) {
        return;
    }
    for variant in schema["variants"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        reach(schemas, variant, out, name, problems);
    }
    for attribute in schema["attributes"].as_array().into_iter().flatten() {
        if let Some(used) = attribute["schema"].as_str() {
            reach(schemas, used, out, name, problems);
        }
    }
}

fn is_union(schema: &Value) -> bool {
    schema.get("variants").is_some()
}

fn cell(text: Option<&str>) -> String {
    text.unwrap_or_default().replace('|', "\\|")
}

fn table(header: &[&str], rows: Vec<Vec<String>>) -> String {
    let mut lines = vec![format!("| {} |", header.join(" | ")), format!("|{}", "---|".repeat(header.len()))];
    lines.extend(rows.into_iter().map(|row| format!("| {} |", row.join(" | "))));
    lines.join("\n")
}

/// A schema in a type cell. A document lists every schema it reaches, so a link stays in the document.
fn link(name: &str) -> String {
    format!("[{}](#{})", name.strip_suffix("Representation").unwrap_or(name), name.to_ascii_lowercase())
}

fn type_cell(schemas: &BTreeMap<String, Value>, attribute: &Value) -> String {
    let mut prefix = "array of ".repeat(attribute["array"].as_u64().unwrap_or(0) as usize);
    if attribute["map"] == true {
        prefix += "map to ";
    }
    if let Some(schema) = attribute["schema"].as_str() {
        return match schemas.get(schema).and_then(|s| s["variants"].as_array()) {
            Some(variants) => {
                let links: Vec<String> = variants.iter().filter_map(Value::as_str).map(link).collect();
                format!("{prefix}one of {}", links.join(", "))
            }
            None => prefix + &link(schema),
        };
    }
    if let Some(values) = attribute["enum"].as_array() {
        let values: Vec<&str> = values.iter().filter_map(Value::as_str).collect();
        return format!("{prefix}enum({})", values.join(", "));
    }
    match attribute["type"].as_str() {
        None => prefix.trim_end_matches(" of ").to_string(),
        Some(base) => match attribute["format"].as_str() {
            Some(format) => format!("{prefix}{base} ({format})"),
            None => prefix + base,
        },
    }
}

fn name_cells(attribute: &Value) -> Vec<String> {
    let name = attribute["name"].as_str().unwrap_or_default();
    vec![format!("`{name}`"), format!("`{}`", attribute["api_name"].as_str().unwrap_or(name))]
}

fn required_cell(attribute: &Value) -> String {
    if attribute["required"] == true { "yes".to_string() } else { String::new() }
}

fn column_type(column: &Value) -> String {
    let base = column["type"].as_str().unwrap_or_default();
    match column["schema"].as_str() {
        Some(schema) => format!("{base} ({}{schema})", "array of ".repeat(column["array"].as_u64().unwrap_or(0) as usize)),
        None => base.to_string(),
    }
}

fn request_line(function: &Value) -> String {
    let mut parts = vec![format!("`{} {}`", function["method"].as_str().unwrap_or_default(), function["path"].as_str().unwrap_or_default())];
    if let Some(url) = function["spec_url"].as_str() {
        parts.push(format!("[spec]({url})"));
    }
    if let Some(url) = function["reference_url"].as_str() {
        parts.push(format!("[reference]({url})"));
    }
    if let Some(tools) = function["tools"].as_array() {
        let tools: Vec<String> = tools.iter().filter_map(Value::as_str).map(|t| format!("`{t}`")).collect();
        parts.push(format!("tool {}", tools.join(", ")));
    }
    if let Some(evidence) = function["evidence"].as_str() {
        parts.push(format!("evidence {evidence}"));
    }
    let host = function["host"].as_str().unwrap_or_default();
    if host != "connect" {
        parts.push(format!("host {host}"));
    }
    parts.push(if function["effect"] == "read" { "read-only" } else { "changes org state" }.to_string());
    parts.join(" · ")
}

fn function_blocks(schemas: &BTreeMap<String, Value>, function: &Value) -> Vec<String> {
    let mut blocks = vec![format!("## {}", function["name"].as_str().unwrap_or_default()), request_line(function)];
    let text = |blocks: &mut Vec<String>, field: &str| {
        if let Some(value) = function[field].as_str() {
            blocks.push(value.to_string());
        }
    };
    text(&mut blocks, "description");
    blocks.push("**Options**".to_string());
    match function["options"].as_array() {
        Some(options) if !options.is_empty() => {
            let rows = options
                .iter()
                .map(|option| {
                    let mut row = name_cells(option);
                    row.push(option["in"].as_str().unwrap_or_default().to_string());
                    row.push(type_cell(schemas, option));
                    row.push(required_cell(option));
                    row.push(cell(option["description"].as_str()));
                    row
                })
                .collect();
            blocks.push(table(&["Option", "API name", "In", "Type", "Required", "Description"], rows));
        }
        _ => blocks.push("None.".to_string()),
    }
    blocks.push(format!("```sql\n{}\n```", function["example"].as_str().unwrap_or_default()));
    blocks.push("**Result**".to_string());
    text(&mut blocks, "result_description");
    if let Some(columns) = function["columns"].as_array().filter(|c| !c.is_empty()) {
        let rows = columns
            .iter()
            .map(|column| {
                let mut row = name_cells(column);
                row.push(column_type(column));
                let description = cell(column["description"].as_str());
                row.push(if description.is_empty() { "-".to_string() } else { description });
                row
            })
            .collect();
        blocks.push(table(&["Column", "API name", "Type", "Description"], rows));
    }
    text(&mut blocks, "notes");
    blocks
}

fn schema_blocks(schemas: &BTreeMap<String, Value>, name: &str) -> Vec<String> {
    let schema = &schemas[name];
    let mut blocks = vec![format!("### {name}")];
    if let Some(description) = schema["description"].as_str() {
        blocks.push(description.to_string());
    }
    if let Some(attributes) = schema["attributes"].as_array().filter(|a| !a.is_empty()) {
        let rows = attributes
            .iter()
            .map(|attribute| {
                let mut row = name_cells(attribute);
                row.push(type_cell(schemas, attribute));
                row.push(required_cell(attribute));
                row.push(cell(attribute["description"].as_str()));
                row
            })
            .collect();
        blocks.push(table(&["Attribute", "API name", "Type", "Required", "Description"], rows));
    }
    blocks
}

/// A link inside a document has to find its heading. Nobody reads a generated document to notice.
fn check_links(file: &str, text: &str, problems: &mut Vec<String>) {
    let anchor = |heading: &str| -> String {
        let kept = heading.trim_start_matches('#').trim().chars().filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' '));
        kept.map(|c| if c == ' ' { '-' } else { c.to_ascii_lowercase() }).collect()
    };
    let anchors: BTreeSet<String> = text.lines().filter(|line| line.starts_with('#')).map(anchor).collect();
    for part in text.split("](#").skip(1) {
        let target = part.split(')').next().unwrap_or_default();
        if !anchors.contains(&target.to_ascii_lowercase()) {
            problems.push(format!("{file}: the link #{target} has no heading"));
        }
    }
}

/// A family document. It lists the schemas of the family and all that its functions and schemas reach.
fn render_document(sources: &Sources, family: &Family, problems: &mut Vec<String>) -> String {
    let stem = family.file.trim_end_matches(".md");
    let generated = format!("<!-- Generated from overlay/d360/api/{stem}.yaml, edit that and run: bazel run //overlay/d360:update -->");
    let names: Vec<String> = family.functions.iter().filter_map(|f| f["name"].as_str()).map(|n| format!("[`{n}`](#{n})")).collect();
    let mut blocks = vec![generated, format!("# {}", family.title), PART_OF.to_string()];
    if let Some(description) = &family.description {
        blocks.push(description.clone());
    }
    blocks.push(format!("**Functions:** {}", names.join(", ")));
    let mut listed = BTreeSet::new();
    for name in &family.schemas {
        reach(&sources.schemas, name, &mut listed, &family.file, problems);
    }
    for function in &family.functions {
        for option in function["options"].as_array().into_iter().flatten() {
            if let Some(schema) = option["schema"].as_str() {
                reach(&sources.schemas, schema, &mut listed, function["name"].as_str().unwrap_or_default(), problems);
            }
        }
        blocks.extend(function_blocks(&sources.schemas, function));
    }
    let listed: Vec<&String> = listed.iter().filter(|n| !is_union(&sources.schemas[*n])).collect();
    if !listed.is_empty() {
        blocks.push("## Schemas".to_string());
        blocks.push(SCHEMAS_INTRO.to_string());
        for name in listed {
            blocks.extend(schema_blocks(&sources.schemas, name));
        }
    }
    let text = blocks.join("\n\n") + "\n";
    check_links(&family.file, &text, problems);
    text
}

/// An attribute or a column as the spec has it
fn fact_of_attribute(attribute: &Value) -> Value {
    let mut out = attribute.as_object().cloned().unwrap_or_default();
    out.remove("description");
    Value::Object(out)
}

fn fact_of_column(column: &Value) -> Value {
    let mut out = column.as_object().cloned().unwrap_or_default();
    for field in ["description", "schema", "array"] {
        out.remove(field);
    }
    Value::Object(out)
}

fn fact_of_function(function: &Value, family: Option<&str>) -> Value {
    let mut out = Map::new();
    for (key, value) in function.as_object().into_iter().flatten() {
        if FUNCTION_PROSE.contains(&key.as_str()) {
            continue;
        }
        let value = match key.as_str() {
            "options" => Value::Array(value.as_array().into_iter().flatten().map(fact_of_attribute).collect()),
            "columns" => Value::Array(value.as_array().into_iter().flatten().map(fact_of_column).collect()),
            _ => value.clone(),
        };
        out.insert(key.clone(), value);
        // The family is the file a function is in
        if let (Some(family), "name") = (family, key.as_str()) {
            out.insert("family".to_string(), Value::String(family.to_string()));
        }
    }
    Value::Object(out)
}

/// The spec: the facts of all sources
fn spec_of(sources: &Sources) -> Value {
    let mut out = sources.overlay.clone();
    let mut schemas = Map::new();
    for (name, schema) in &sources.schemas {
        let mut fact = schema.as_object().cloned().unwrap_or_default();
        fact.remove("description");
        if let Some(Value::Array(attributes)) = fact.get("attributes") {
            let attributes = attributes.iter().map(fact_of_attribute).collect();
            fact.insert("attributes".to_string(), Value::Array(attributes));
        }
        schemas.insert(name.clone(), Value::Object(fact));
    }
    out.insert("schemas".to_string(), Value::Object(schemas));
    let mut functions: Vec<Value> = Vec::new();
    for family in &sources.families {
        functions.extend(family.functions.iter().map(|f| fact_of_function(f, Some(&family.title))));
    }
    functions.extend(sources.other_functions.iter().map(|f| fact_of_function(f, None)));
    out.insert("functions".to_string(), Value::Array(functions));
    Value::Object(out)
}

fn read_directory(directory: &Path) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = std::fs::read_dir(directory)
        .unwrap_or_else(|e| panic!("{directory:?}: {e}"))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|e| e == "yaml"))
        .map(|path| (path.file_name().unwrap().to_string_lossy().to_string(), std::fs::read_to_string(&path).unwrap()))
        .collect();
    files.sort();
    files
}

fn fail(problems: &[String]) -> ! {
    for problem in problems {
        eprintln!("problem: {problem}");
    }
    std::process::exit(1);
}

fn main() {
    let api = arg("api").expect("--api=<dir>");
    let mut problems = Vec::new();
    let Some(sources) = read_sources(&read_directory(Path::new(&api)), &mut problems) else { fail(&problems) };
    let documents: Vec<(String, String)> = sources.families.iter().map(|f| (f.file.clone(), render_document(&sources, f, &mut problems))).collect();
    if !problems.is_empty() {
        fail(&problems);
    }
    if let Some(path) = arg("spec") {
        std::fs::write(&path, format!("{}\n", serde_json::to_string(&spec_of(&sources)).unwrap())).unwrap();
    }
    let Some(docs) = arg("docs") else { return };
    let (write, check) = (has_flag("write"), has_flag("check"));
    let mut stale = Vec::new();
    for (file, text) in &documents {
        let path = Path::new(&docs).join(file);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
            stale.push(file.clone());
            if write {
                std::fs::write(&path, text).unwrap();
            }
        }
    }
    // A document that no family writes would go stale unnoticed
    for entry in std::fs::read_dir(&docs).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().to_string();
        let known = documents.iter().any(|(file, _)| *file == name) || HAND_WRITTEN.contains(&name.as_str());
        if name.ends_with(".md") && !known {
            fail(&[format!("no family writes {name}")]);
        }
    }
    if write {
        println!("{} families, {} schemas, {} documents changed", sources.families.len(), sources.schemas.len(), stale.len());
    }
    if check && !stale.is_empty() {
        eprintln!("stale, run bazel run //overlay/d360:update: {stale:?}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OVERLAY: &str = "format: 1\nnamespace: t\nfunctions:\n  - {name: request, family: Escape hatch, raw: true}\n";
    const FAMILY: &str = r#"
title: Things
description: |
  First line.

  Second paragraph.
functions:
  - name: thing_create
    method: POST
    host: connect
    path: /things
    evidence: O
    tools: [make_thing]
    effect: write
    description: Makes a thing.
    example: |
      CALL t.thing_create (kind => 'a');
    options:
      - {name: kind, api_name: thingKind, in: body, schema: Kind, description: "One | of them."}
    columns:
      - {name: id, type: JSON, schema: IdRepresentation, array: 1, description: "The id."}
    notes: |
      **Notes:** Mind this.
schemas:
  Kind: {variants: [A, B], tag: {attribute: kind, values: {"None": A}}}
  A:
    description: The first.
    attributes:
      - {name: kind, type: string, enum: ["None", other], required: true, description: "Which."}
  B: {attributes: [{name: kind, type: string}]}
"#;

    fn sources(family: &str) -> (Option<Sources>, Vec<String>) {
        let files = vec![("overlay.yaml".to_string(), OVERLAY.to_string()), ("things.yaml".to_string(), family.to_string())];
        let mut problems = Vec::new();
        (read_sources(&files, &mut problems), problems)
    }

    #[test]
    fn the_spec_holds_the_facts_only() {
        let (sources, problems) = sources(FAMILY);
        assert_eq!(problems, Vec::<String>::new());
        let spec = spec_of(&sources.unwrap());
        let function = &spec["functions"][0];
        assert_eq!(function["family"], "Things");
        for field in FUNCTION_PROSE {
            assert!(function.get(field).is_none(), "{field}");
        }
        assert!(function["options"][0].get("description").is_none());
        assert_eq!(function["options"][0]["api_name"], "thingKind");
        assert_eq!(function["columns"][0].as_object().unwrap().len(), 2);
        assert!(spec["schemas"]["A"].get("description").is_none());
        assert_eq!(spec["schemas"]["A"]["attributes"][0]["enum"][0], "None");
        assert_eq!(spec["schemas"]["Kind"]["tag"]["values"]["None"], "A");
        assert_eq!(spec["functions"][1]["family"], "Escape hatch");
    }

    #[test]
    fn a_document_is_complete() {
        let (sources, _) = sources(FAMILY);
        let sources = sources.unwrap();
        let mut problems = Vec::new();
        let text = render_document(&sources, &sources.families[0], &mut problems);
        assert_eq!(problems, Vec::<String>::new());
        assert!(text.starts_with("<!-- Generated from overlay/d360/api/things.yaml"));
        assert!(text.contains("First line.\n\nSecond paragraph.\n\n**Functions:** [`thing_create`](#thing_create)\n"));
        assert!(text.contains("`POST /things` · tool `make_thing` · evidence O · changes org state"));
        assert!(text.contains("| `kind` | `thingKind` | body | one of [A](#a), [B](#b) |  | One \\| of them. |"));
        assert!(text.contains("```sql\nCALL t.thing_create (kind => 'a');\n```"));
        assert!(text.contains("| `id` | `id` | JSON (array of IdRepresentation) | The id. |"));
        assert!(text.contains("### A\n\nThe first.\n\n| Attribute |"));
        assert!(text.contains("| `kind` | `kind` | enum(None, other) | yes | Which. |"));
        assert!(!text.contains("### Kind"));
        assert!(text.ends_with("|\n"));
    }

    #[test]
    fn yaml_can_not_change_a_type_silently() {
        for (bad, expected) in [
            ("enum: [1.0]", "enum isn't a list of strings"),
            ("enum: [true]", "enum isn't a list of strings"),
            ("name: 12", "name isn't a string"),
        ] {
            let family = format!("title: T\nschemas:\n  A:\n    attributes:\n      - {{{bad}}}\n");
            let (_, problems) = sources(&family);
            assert!(problems.iter().any(|p| p.contains(expected)), "{bad}: {problems:?}");
        }
        // A key that isn't a string
        let (_, problems) = sources("title: T\nschemas:\n  U: {variants: [A], tag: {attribute: a, values: {1.5: A}}}\n");
        assert!(problems.iter().any(|p| p.contains("isn't a string")), "{problems:?}");
    }

    #[test]
    fn a_link_needs_its_heading() {
        let mut problems = Vec::new();
        check_links("a.md", "## thing_get\n\n[ok](#thing_get), [other](other.md#x), [bad](#nope)\n", &mut problems);
        assert_eq!(problems, vec!["a.md: the link #nope has no heading".to_string()]);
    }

    #[test]
    fn a_schema_has_one_family() {
        let files = vec![
            ("overlay.yaml".to_string(), OVERLAY.to_string()),
            ("a.yaml".to_string(), "title: A\nschemas:\n  S: {attributes: []}\n".to_string()),
            ("b.yaml".to_string(), "title: B\nschemas:\n  S: {attributes: []}\n".to_string()),
        ];
        let mut problems = Vec::new();
        read_sources(&files, &mut problems);
        assert!(problems.iter().any(|p| p.contains("another family defines the schema S")), "{problems:?}");
    }

    #[test]
    fn an_unknown_schema_fails() {
        let family = "title: T\nfunctions:\n  - {name: f, method: GET, host: connect, path: /f, effect: read, options: [{name: a, in: body, schema: Nope}]}\n";
        let (sources, _) = sources(family);
        let sources = sources.unwrap();
        let mut problems = Vec::new();
        render_document(&sources, &sources.families[0], &mut problems);
        assert!(problems.iter().any(|p| p.contains("unknown schema Nope")), "{problems:?}");
    }
}
