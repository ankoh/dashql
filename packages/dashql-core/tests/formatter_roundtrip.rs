//! Formats the scripts of the parser snapshots and checks the output against the parser.
//!
//! Every script of the parser snapshots that parses without errors must be fully formattable, and its
//! formatted output must parse without errors again, to a tree with the same nodes. The output must also be stable
//! when it is formatted a second time.

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::formatter::Formatter;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use dashql_snapshots::load_category;
use std::sync::Arc;

/// Scripts that the formatter rejects on purpose
const UNFORMATTABLE: &[&str] = &[
    // DEFAULT is only formatted as a value of an INSERT
    "select somefunc(default);",
    // Empty ROW types now parse, but the formatter has no representation for them yet.
    "create table t (p row())",
];

/// Scripts whose formatted output spells a construct differently, with another tree of the same meaning
const RESPELLED: &[&str] = &[
    // Array types are written as `t[]`
    "select cast(a as text array)",
    "create table t (ps array(row(x int)), qs row(x int)[])",
    "select cast(json_parse(payload) as array(json)) as entries from event_stream",
];

/// Does the script parse without scanner and parser errors?
fn is_valid(parsed: &ParsedScript) -> bool {
    parsed.errors.is_empty() && parsed.scanned.errors.is_empty()
}

/// The node types and attribute keys of a parsed script, sorted. Formatting must keep them, so that a clause
/// that the formatter does not write fails the round trip, but it may reorder clauses.
fn shape(parsed: &ParsedScript) -> Vec<(u16, u16)> {
    let mut shape: Vec<_> = parsed.nodes.iter().map(|n| (n.node_type().0, n.attribute_key().0)).collect();
    shape.sort_unstable();
    shape
}

/// The config of the formatter runs
fn config(mode: FormattingMode) -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect::HYPER;
    config.mode = mode;
    config.max_width = 120;
    config.indentation_width = 2;
    config
}

#[test]
fn formatted_parser_snapshots_parse_again() {
    let mut failures = Vec::new();
    let mut checked = 0;
    for case in load_category("parser").unwrap() {
        let Some(input) = case.input() else { continue };
        let parsed = parse(Arc::new(scan(&input, 0, 2)));
        if !is_valid(&parsed) || UNFORMATTABLE.contains(&input.trim()) {
            continue;
        }
        for mode in [FormattingMode::INLINE, FormattingMode::COMPACT, FormattingMode::PRETTY] {
            checked += 1;
            let config = config(mode);
            let mut formatter = Formatter::new(&parsed);
            let formatted = formatter.format(&config);
            if !formatter.is_fully_formatted() {
                let nodes: Vec<_> = formatter
                    .unformattable_nodes()
                    .iter()
                    .map(|&n| format!("{:?}", parsed.nodes[n as usize].node_type().variant_name()))
                    .collect();
                failures.push(format!("{}: unformattable {nodes:?} in {input:?}", case.trial_name()));
                continue;
            }
            let reparsed = parse(Arc::new(scan(&formatted, 0, 2)));
            if !is_valid(&reparsed) {
                failures.push(format!("{}: output does not parse: {formatted:?} of {input:?}", case.trial_name()));
                continue;
            }
            if shape(&reparsed) != shape(&parsed) && !RESPELLED.contains(&input.trim()) {
                failures.push(format!("{}: output changes the tree: {formatted:?} of {input:?}", case.trial_name()));
                continue;
            }
            let again = Formatter::new(&reparsed).format(&config);
            if again != formatted {
                failures.push(format!("{}: unstable output {formatted:?} then {again:?}", case.trial_name()));
            }
        }
    }
    assert!(checked > 0, "no formatter runs");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

/// The ways of putting comments between the symbols of a script
#[derive(Clone, Copy, Debug)]
enum Injection {
    /// A block comment before every symbol
    BlockBefore,
    /// A line comment on a line of its own before every symbol
    LineBefore,
    /// A line comment after every symbol, on its line
    LineAfter,
}

/// A script with a numbered comment between its symbols, the comment `n` holds the marker `k<n>k`
fn inject_comments(input: &str, injection: Injection) -> String {
    let scanned = scan(input, 0, 2);
    let mut out = String::new();
    let mut copied = 0;
    for (n, symbol) in scanned.symbols.iter().filter(|s| s.location.length > 0).enumerate() {
        let (begin, end) = (symbol.location.offset as usize, symbol.location.end() as usize);
        let (Some(before), Some(text)) = (input.get(copied..begin), input.get(begin..end)) else { break };
        out.push_str(before);
        match injection {
            Injection::BlockBefore => out.push_str(&format!("/* k{n}k */ {text}")),
            Injection::LineBefore => out.push_str(&format!("\n-- k{n}k\n{text}")),
            Injection::LineAfter => out.push_str(&format!("{text} -- k{n}k\n")),
        }
        copied = end;
    }
    out.push_str(input.get(copied..).unwrap_or_default());
    out
}

#[test]
fn formatted_comments_stay_in_place() {
    let mut failures = Vec::new();
    let mut checked = 0;
    for case in load_category("parser").unwrap() {
        let Some(input) = case.input() else { continue };
        let parsed = parse(Arc::new(scan(&input, 0, 2)));
        if !is_valid(&parsed) || UNFORMATTABLE.contains(&input.trim()) || RESPELLED.contains(&input.trim()) {
            continue;
        }
        for injection in [Injection::BlockBefore, Injection::LineBefore, Injection::LineAfter] {
            let commented = inject_comments(&input, injection);
            let parsed_commented = parse(Arc::new(scan(&commented, 0, 2)));
            // The comments must not change the script
            if !is_valid(&parsed_commented) || shape(&parsed_commented) != shape(&parsed) {
                continue;
            }
            let markers = (0..).take_while(|n| commented.contains(&format!("k{n}k"))).count();
            for mode in [FormattingMode::COMPACT, FormattingMode::PRETTY] {
                checked += 1;
                let config = config(mode);
                let formatted = Formatter::new(&parsed_commented).format(&config);
                let name = format!("{} {injection:?} {mode:?}", case.trial_name());
                if let Some(n) = (0..markers).find(|n| formatted.matches(&format!("k{n}k")).count() != 1) {
                    failures.push(format!("{name}: comment k{n}k is not printed once in {formatted:?}"));
                    continue;
                }
                let reparsed = parse(Arc::new(scan(&formatted, 0, 2)));
                if !is_valid(&reparsed) || shape(&reparsed) != shape(&parsed) {
                    failures.push(format!("{name}: output changes the script: {formatted:?}"));
                    continue;
                }
                let again = Formatter::new(&reparsed).format(&config);
                if again != formatted {
                    failures.push(format!("{name}: unstable output {formatted:?} then {again:?}"));
                }
            }
        }
    }
    assert!(checked > 0, "no formatter runs");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}
