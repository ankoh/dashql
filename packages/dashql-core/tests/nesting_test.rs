//! Statements that nest as deep as the parser allows (`MAX_STACK_DEPTH` of the driver) are analyzed and formatted
//! within the stack of the module. The parse tree is flat, but the analyzer and the formatter walk parts of it
//! recursively; in the module a stack overflow traps it. The tests run on a thread with
//! half of the 1 MiB stack of the module, natively and unoptimized, whose frames are larger than those of the module.
//! Left-deep chains (`1 + 1 + ...`) aren't limited by the parser, their trees grow deeper than any nesting.

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_parser::parser::driver::{MAX_STACK_DEPTH, NESTING_TOO_DEEP};

/// The stack of the threads of the tests
const STACK_SIZE: usize = 512 * 1024;

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
            let catalog = Catalog::new();
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

/// The left-deep chains of a length: a chain builds a tree as deep as it is long, without growing the stack of the parser
fn left_deep_chains(n: usize) -> Vec<(&'static str, String)> {
    vec![
        ("additions", format!("select 1{}", " + 1".repeat(n))),
        ("concatenations", format!("select 'a'{}", " || 'a'".repeat(n))),
        ("casts", format!("select x{} from t", "::int".repeat(n))),
        ("subscripts", format!("select (x){} from t", "[1]".repeat(n))),
        ("set operations", format!("select 1{}", " union all select 1".repeat(n))),
        ("commented additions", format!("select 1{}", " -- c\n+ /* c */ 1".repeat(n))),
    ]
}

#[test]
fn left_deep_chains_beyond_the_depth_limit_are_analyzed_and_formatted() {
    std::thread::Builder::new()
        .stack_size(STACK_SIZE)
        .spawn(|| {
            let catalog = Catalog::new();
            let mut config = FormattingConfigT::default();
            config.dialect = FormattingDialect::HYPER;
            config.mode = FormattingMode::COMPACT;
            for (name, text) in left_deep_chains(2 * MAX_STACK_DEPTH) {
                assert_eq!(parse_errors(&catalog, &text), Vec::<String>::new(), "{name}");
                let mut script = Script::new(&catalog);
                script.replace_text(&text);
                script.analyze(&catalog, true).unwrap_or_else(|e| panic!("{name}: {e:?}"));
                script.format(&config, true).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn left_deep_chains_of_an_operator_format_flat() {
    std::thread::Builder::new()
        .stack_size(STACK_SIZE)
        .spawn(|| {
            let catalog = Catalog::new();
            for (name, operator) in [("plus", " + "), ("and", " and "), ("concatenation", " || ")] {
                let text = format!("select {}", vec!["x"; 2000].join(operator));
                for mode in [FormattingMode::COMPACT, FormattingMode::PRETTY] {
                    let mut config = FormattingConfigT::default();
                    config.dialect = FormattingDialect::HYPER;
                    config.mode = mode;
                    config.max_width = 40;
                    let mut script = Script::new(&catalog);
                    script.replace_text(&text);
                    let formatted = script.format(&config, true).unwrap_or_else(|e| panic!("{name}: {e:?}"));
                    // The operands are one list at one indentation, the output grows with the input
                    let deepest = formatted.lines().map(|line| line.len() - line.trim_start().len()).max();
                    assert!(deepest <= Some(4), "{name} in {mode:?} indents {deepest:?} deep");
                    assert!(formatted.len() < 2 * text.len(), "{name} in {mode:?}: {} bytes", formatted.len());
                }
            }
        })
        .unwrap()
        .join()
        .unwrap();
}
