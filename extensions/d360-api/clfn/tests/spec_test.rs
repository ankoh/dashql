//! The Data 360 client functions as the core reads it. The reference documents hold the examples and the expected names.

use dashql_buffers::analyzer::AnalyzerErrorSeverity;
use dashql_core::analyzer::analyze;
use dashql_core::catalog::Catalog;
use dashql_core::completion::Completion;
use dashql_core::cursor::{ScriptCursor, ScriptView};
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

const REFERENCE: &str = "extensions/d360-api/clfn/docs";
const SPEC: &str = "extensions/d360-api/clfn/spec/spec.json";
const SNIPPETS: &str = "extensions/d360-api/snippets";

fn spec_text() -> String {
    std::fs::read_to_string(SPEC).expect("the spec is a test input")
}

fn catalog() -> Catalog {
    let mut catalog = Catalog::new();
    assert_eq!(&*catalog.register_client_functions(&spec_text()).expect("the core reads the spec"), "cdp");
    catalog
}

/// The SQL code blocks of the reference that hold a client function call
fn documented_examples() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut paths: Vec<_> = std::fs::read_dir(REFERENCE).unwrap().map(|e| e.unwrap().path()).collect();
    paths.sort();
    for path in paths.iter().filter(|p| p.extension().is_some_and(|e| e == "md")) {
        let name = Path::new(path).file_name().unwrap().to_string_lossy().to_string();
        let text = std::fs::read_to_string(path).unwrap();
        for block in text.split("```sql\n").skip(1) {
            let block = block.split("```").next().unwrap();
            if block.contains("cdp.") && !block.contains("(...)") {
                out.push((name.clone(), block.to_string()));
            }
        }
    }
    out
}

#[test]
fn documented_examples_pass_the_checks() {
    let catalog = catalog();
    let mut failures = Vec::new();
    let mut calls = 0;
    let examples = documented_examples();
    for (file, example) in &examples {
        let entry_id = catalog.allocate_entry_id();
        let parsed = Arc::new(parse(Arc::new(scan(example, 0, entry_id))));
        for error in &parsed.errors {
            failures.push(format!("{file}: {}: {}", error.message, first_line(example)));
        }
        let analyzed = analyze(parsed.clone(), &catalog).expect("the analysis runs");
        calls += analyzed.client_function_calls.len();
        for error in analyzed.errors.iter().filter(|e| e.severity == AnalyzerErrorSeverity::ERROR) {
            failures.push(format!("{file}: {}: {}", error.message, first_line(example)));
        }
        for call in &analyzed.client_function_calls {
            assert!(analyzed.describe_client_function_call(call.ast_statement_id).is_some(), "{file}: {}", first_line(example));
        }
    }
    println!("{} blocks, {calls} calls", examples.len());
    assert!(calls > 600, "only {calls} calls");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

fn first_line(text: &str) -> &str {
    text.lines().find(|l| l.contains("cdp.")).unwrap_or("")
}

/// The candidates at the end of a text
fn complete(catalog: &Catalog, text: &str) -> BTreeSet<String> {
    let entry_id = catalog.allocate_entry_id();
    let scanned = Arc::new(scan(text, 0, entry_id));
    let parsed = Arc::new(parse(scanned.clone()));
    let analyzed = Arc::new(analyze(parsed.clone(), catalog).expect("the analysis runs"));
    let view = ScriptView { scanned: Some(&scanned), parsed: Some(&parsed), analyzed: Some(&analyzed), catalog };
    let cursor = ScriptCursor::place(view, text.len());
    Completion::compute(&cursor, 100_000).top_candidates.iter().map(|c| c.completion_text.to_string()).collect()
}

/// How a name of the spec is inserted
fn inserted(name: &str) -> String {
    let plain = name.bytes().enumerate().all(|(i, c)| c.is_ascii_alphabetic() || c == b'_' || (i > 0 && c.is_ascii_digit()));
    if plain { name.to_string() } else { format!("\"{name}\"") }
}

fn names(attributes: Option<&Value>) -> BTreeSet<String> {
    attributes.and_then(Value::as_array).into_iter().flatten().map(|a| inserted(a["name"].as_str().unwrap())).collect()
}

#[test]
fn completion_offers_every_function() {
    let spec: Value = serde_json::from_str(&spec_text()).unwrap();
    let expected: BTreeSet<String> = spec["functions"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(complete(&catalog(), "call cdp."), expected);
}

#[test]
fn completion_offers_the_options_of_every_function() {
    let spec: Value = serde_json::from_str(&spec_text()).unwrap();
    let catalog = catalog();
    let functions = spec["functions"].as_array().unwrap();
    for function in functions {
        let name = function["name"].as_str().unwrap();
        let mut expected = names(function.get("options"));
        // The standard options
        if function.get("paging").is_some() {
            expected.insert("_next".to_string());
            if function["effect"] == "read" {
                expected.insert("_pages".to_string());
            }
        }
        assert_eq!(complete(&catalog, &format!("call cdp.{name} (")), expected, "{name}");
    }
}

#[test]
fn completion_offers_the_attributes_of_every_object_option() {
    let spec: Value = serde_json::from_str(&spec_text()).unwrap();
    let catalog = catalog();
    let mut checked = 0;
    for function in spec["functions"].as_array().unwrap() {
        let name = function["name"].as_str().unwrap();
        for option in function["options"].as_array().into_iter().flatten() {
            let Some(schema) = option["schema"].as_str() else { continue };
            let option_name = inserted(option["name"].as_str().unwrap());
            let schema = &spec["schemas"][schema];
            let mut expected = names(schema.get("attributes"));
            // Nothing selects a variant yet, so a union offers what any variant takes
            for variant in schema["variants"].as_array().into_iter().flatten() {
                expected.extend(names(spec["schemas"][variant.as_str().unwrap()].get("attributes")));
            }
            let actual = complete(&catalog, &format!("call cdp.{name} ({option_name} => ("));
            assert_eq!(actual, expected, "{name}.{option_name}");
            checked += 1;
        }
    }
    println!("{checked} object options");
    assert!(checked > 200, "only {checked} object options");
}

/// The errors and warnings of a script
fn messages(catalog: &Catalog, text: &str) -> Vec<String> {
    let entry_id = catalog.allocate_entry_id();
    let parsed = Arc::new(parse(Arc::new(scan(text, 0, entry_id))));
    assert!(parsed.errors.is_empty(), "{text}: {:?}", parsed.errors);
    analyze(parsed, catalog).expect("the analysis runs").errors.iter().map(|e| e.message.clone()).collect()
}

/// A union is no merged schema: the tag or the attributes of an object select a variant
#[test]
fn unions_check_one_variant() {
    let catalog = catalog();
    let check = |call: &str, expected: &[&str]| assert_eq!(messages(&catalog, &format!("call cdp.{call};")), expected, "{call}");
    let route = |fields: &str| format!("private_network_route_create (name => 'n', label => 'l', description => 'd', route => ({fields}))");

    // The tag selects the variant
    check(&route("type = 'Redshift', service_name = 's'"), &[]);
    check(&route("type = 'Snowflake', service_name = 's', account_url = 'u'"), &[]);
    check(&route("type = 'Redshift', service_name = 's', account_url = 'u'"), &["no attribute account_url when type is 'Redshift'"]);
    check(&route("type = 'Snowflake', service_name = 's'"), &["needs the attribute account_url"]);
    check(&route("type = 'AmazonMsk', service_name = 's', account_url = 'u'"), &["no attribute account_url when type is 'AmazonMsk'", "needs the attribute broker_endpoints"]);
    // A value without a variant selects nothing, and a parameter isn't known yet
    check(&route("type = 'SnowflakeInternalStage', service_name = 's'"), &[]);
    check(&route("type = :type, service_name = 's', account_url = 'u'"), &[]);
    // The attributes of different variants never go together
    check(&route("type = :type, service_name = 's', account_url = 'u', broker_endpoints = ['b']"), &["broker_endpoints does not fit the attributes before it"]);

    // The case of a value doesn't matter, the examples of the spec write DCSQL for DcSql
    let definition = |fields: &str| format!("transform_validate (name => 'n', label => 'l', type => 'BATCH', definition => ({fields}))");
    check(&definition("type = 'SQL', version = '1', expression = 'e'"), &[]);
    check(&definition("type = 'SQL', version = '1', manifest = :manifest"), &["no attribute manifest when type is 'SQL'"]);
    check(&definition("type = 'DCSQL', version = '1', expression = 'e'"), &["no attribute expression when type is 'DCSQL'"]);
    check(&definition("type = 'SqlHidden', version = '1', expression = 'e'"), &[]);

    // Without a tag the attributes decide
    let target = |fields: &str| format!("dataaction_target_create (api_name => 'n', label => 'l', type => 't', config => ({fields}))");
    check(&target("api_contract = 'a', org_id = 'o', org_label = 'l'"), &[]);
    check(&target("api_contract = 'a', content_key = 'k'"), &[]);
    check(&target("org_id = 'o', content_key = 'k'"), &["content_key does not fit the attributes before it"]);
    check(&target("api_contract = 'a', nope = 1"), &["no attribute nope here"]);
}

/// A tag can only select by a value that a variant of its union allows
#[test]
fn tags_select_by_values_of_their_enums() {
    let spec: Value = serde_json::from_str(&spec_text()).unwrap();
    let schemas = spec["schemas"].as_object().unwrap();
    let mut tags = 0;
    for (name, schema) in schemas {
        let Some(tag) = schema.get("tag") else { continue };
        let attribute = tag["attribute"].as_str().unwrap();
        let mut allowed = BTreeSet::new();
        for variant in schema["variants"].as_array().unwrap() {
            let attributes = schemas[variant.as_str().unwrap()]["attributes"].as_array().unwrap();
            let found = attributes.iter().find(|a| a["name"] == attribute).unwrap();
            allowed.extend(found["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()));
        }
        for value in tag["values"].as_object().unwrap().keys() {
            assert!(allowed.contains(value.as_str()), "{name}: the tag value {value} is in no enum of {attribute}");
        }
        tags += 1;
    }
    assert_eq!(tags, 5);
}

#[test]
fn unions_narrow_completion() {
    let catalog = catalog();
    let route = "call cdp.private_network_route_create (route => (";
    let names = |text: &str| complete(&catalog, text);
    let set = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<BTreeSet<_>>();
    assert_eq!(names(route), set(&["account_url", "broker_endpoints", "service_name", "type"]));
    assert_eq!(names(&format!("{route}type = 'Redshift',")), set(&["service_name"]));
    assert_eq!(names(&format!("{route}type = 'snowflake',")), set(&["account_url", "service_name"]));
    assert_eq!(names(&format!("{route}broker_endpoints = ['b'],")), set(&["service_name", "type"]));
}

/// The snippets are workflows, their steps build on each other. They can't run alone, but each of them has to pass the
/// checks, keep to the rules of the snippet browser, and say where a value from an earlier step comes from.
#[test]
fn snippets_pass_the_checks() {
    let catalog = catalog();
    let (mut steps, mut workflows) = (0, 0);
    for category in std::fs::read_dir(SNIPPETS).expect("the snippets are a test input") {
        let mut calls = 0;
        let mut paths: Vec<_> = std::fs::read_dir(category.unwrap().path()).unwrap().map(|f| f.unwrap().path()).collect();
        paths.sort();
        for (i, path) in paths.iter().enumerate() {
            let stem = path.file_stem().unwrap().to_string_lossy().to_string();
            assert!(stem.starts_with(&format!("{:02}-", i + 1)), "{path:?} is out of order");
            assert!(stem.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'), "{path:?} has an invalid name");
            let text = std::fs::read_to_string(path).unwrap();
            let description = text.split("*/").next().unwrap();
            assert!(text.starts_with("/**") && description.contains(&format!("Step {} of", i + 1)), "{path:?} doesn't say which step it is");
            let entry_id = catalog.allocate_entry_id();
            let parsed = Arc::new(parse(Arc::new(scan(&text, 0, entry_id))));
            assert!(parsed.errors.is_empty(), "{path:?}: {:?}", parsed.errors);
            // The browser takes no comments besides the description
            assert_eq!(parsed.scanned.comments.len(), 1, "{path:?} has comments after its description");
            let analyzed = analyze(parsed.clone(), &catalog).expect("the analysis runs");
            let messages: Vec<&str> = analyzed.errors.iter().map(|e| e.message.as_str()).collect();
            assert!(messages.is_empty(), "{path:?}: {messages:?}");
            for parameter in &analyzed.parameters {
                let name = parameter.name.as_deref().unwrap();
                assert!(description.contains(&format!("`:{name}`")), "{path:?} doesn't say where :{name} comes from");
            }
            calls += analyzed.client_function_calls.len();
            steps += 1;
        }
        assert!(calls > 0, "a workflow without a call");
        workflows += 1;
    }
    println!("{workflows} workflows, {steps} steps");
    assert!(steps > 0);
}

#[test]
fn every_function_describes_a_request() {
    let spec: Value = serde_json::from_str(&spec_text()).unwrap();
    for function in spec["functions"].as_array().unwrap() {
        let name = function["name"].as_str().unwrap();
        if function["raw"] == true {
            continue;
        }
        let path = function["path"].as_str().unwrap_or_else(|| panic!("{name} has no path"));
        assert!(spec["hosts"].get(function["host"].as_str().unwrap()).is_some(), "{name}");
        // Every placeholder has an option, so a request can be built
        let placeholders: Vec<&str> = path.split('{').skip(1).map(|p| p.split('}').next().unwrap()).collect();
        for placeholder in placeholders {
            let fills = |o: &Value| o["in"] == "path" && o.get("api_name").unwrap_or(&o["name"]) == placeholder;
            let found = function["options"].as_array().into_iter().flatten().any(fills);
            assert!(found, "{name}: no option fills {{{placeholder}}}");
        }
    }
}
