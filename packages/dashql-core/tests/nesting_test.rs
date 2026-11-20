//! Statements that nest as deep as the parser allows (`MAX_STACK_DEPTH` of the driver) are analyzed and formatted
//! within the stack of the module. The parse tree is flat, but the analyzer, the formatter and the checks of client
//! function calls walk parts of it recursively; in the module a stack overflow traps it. The tests run on a thread with
//! half of the 1 MiB stack of the module, natively and unoptimized, whose frames are larger than those of the module.

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::analyzer::clfn_calls::MAX_VALUE_DEPTH;
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_parser::parser::driver::{MAX_STACK_DEPTH, NESTING_TOO_DEEP};

/// The stack of the threads of the tests
const STACK_SIZE: usize = 512 * 1024;

/// A namespace of client functions with an array option, a map option and a raw function
const SPEC: &str = r#"{
  "format": 1,
  "namespace": "svc",
  "functions": [
    { "name": "item_find", "method": "GET", "options": [{ "name": "ids", "type": "integer", "array": 2 }, { "name": "labels", "type": "string", "map": true }] },
    { "name": "item_raw", "raw": true }
  ]
}"#;

fn catalog() -> Catalog {
    let mut catalog = Catalog::new();
    catalog.register_client_functions(SPEC).unwrap();
    catalog
}

fn nested(open: &str, inner: &str, close: &str, depth: usize) -> String {
    format!("{}{inner}{}", open.repeat(depth), close.repeat(depth))
}

/// The statements of a nesting, by depth
fn statements() -> Vec<(&'static str, Box<dyn Fn(usize) -> String>)> {
    vec![
        ("parentheses", Box::new(|n| format!("select {}", nested("(", "1", ")", n)))),
        ("function calls", Box::new(|n| format!("select {}", nested("f(", "1", ")", n)))),
        ("subqueries", Box::new(|n| format!("select * from {}", nested("(select * from ", "x", ") t", n)))),
        ("prefix minus", Box::new(|n| format!("select {}1", "- ".repeat(n)))),
        ("not", Box::new(|n| format!("select {}true", "not ".repeat(n)))),
        ("case", Box::new(|n| format!("select {}", nested("case when true then ", "1", " end", n)))),
        (
            "arrays of a client function",
            Box::new(|n| format!("call svc.item_find(ids => {})", nested("[", "1", "]", n))),
        ),
        (
            "maps of a client function",
            Box::new(|n| format!("call svc.item_find(labels => {})", nested("(a = ", "'x'", ")", n))),
        ),
        (
            "arrays of a raw client function",
            Box::new(|n| format!("call svc.item_raw(x => {})", nested("[", "1", "]", n))),
        ),
        (
            "objects of a raw client function",
            Box::new(|n| format!("call svc.item_raw(x => {})", nested("(a = ", "1", ")", n))),
        ),
    ]
}

/// The parse errors of a text
fn parse_errors(catalog: &Catalog, text: &str) -> Vec<String> {
    let mut script = Script::new(catalog);
    script.replace_text(text);
    script.parse();
    let parsed = script.parsed.as_ref().expect("parsed script");
    parsed.errors.iter().map(|e| e.message.clone()).collect()
}

/// The deepest nesting of a statement that parses
fn deepest(catalog: &Catalog, statement: &dyn Fn(usize) -> String) -> usize {
    let (mut parses, mut fails) = (1, MAX_STACK_DEPTH + 1);
    let errors = parse_errors(catalog, &statement(parses));
    assert!(errors.is_empty(), "{}: {errors:?}", statement(parses));
    assert_eq!(parse_errors(catalog, &statement(fails)), [NESTING_TOO_DEEP]);
    while fails - parses > 1 {
        let depth = (parses + fails) / 2;
        if parse_errors(catalog, &statement(depth)).is_empty() {
            parses = depth;
        } else {
            fails = depth;
        }
    }
    parses
}

#[test]
fn statements_at_the_depth_limit_are_analyzed_and_formatted() {
    std::thread::Builder::new()
        .stack_size(STACK_SIZE)
        .spawn(|| {
            let catalog = catalog();
            let mut config = FormattingConfigT::default();
            config.dialect = FormattingDialect::HYPER;
            config.mode = FormattingMode::COMPACT;
            for (name, statement) in statements() {
                let depth = deepest(&catalog, &*statement);
                let mut script = Script::new(&catalog);
                script.replace_text(&statement(depth));
                script.analyze(&catalog, true).unwrap_or_else(|e| panic!("{name} at depth {depth}: {e:?}"));
                script.format(&config, true).unwrap_or_else(|e| panic!("{name} at depth {depth}: {e:?}"));
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn a_value_of_a_client_function_nests_at_most_64_levels() {
    let catalog = catalog();
    let errors = |depth: usize| {
        let mut script = Script::new(&catalog);
        script.replace_text(&format!("call svc.item_raw(x => {})", nested("[", "1", "]", depth)));
        script.analyze(&catalog, true).unwrap();
        let analyzed = script.analyzed.as_ref().unwrap();
        let errors: Vec<String> = analyzed.errors.iter().map(|e| e.message.clone()).collect();
        let description = analyzed.describe_client_function_call(0).expect("a description");
        (errors, description)
    };
    // 63 arrays around a number are 64 levels
    let (allowed, description) = errors(MAX_VALUE_DEPTH - 1);
    assert!(allowed.is_empty(), "{allowed:?}");
    assert!(description.to_string().contains(&format!(
        "{}1{}",
        "[".repeat(MAX_VALUE_DEPTH - 1),
        "]".repeat(MAX_VALUE_DEPTH - 1)
    )));
    let (deeper, description) = errors(MAX_VALUE_DEPTH);
    assert_eq!(deeper, [format!("a value can't nest deeper than {MAX_VALUE_DEPTH} levels")]);
    // The description leaves a null where the value nests too deep
    assert!(description.to_string().contains(&format!(
        "{}null{}",
        "[".repeat(MAX_VALUE_DEPTH),
        "]".repeat(MAX_VALUE_DEPTH)
    )));
}
