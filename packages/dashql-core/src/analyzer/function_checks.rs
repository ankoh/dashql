//! Checks of function calls before a script runs: aggregate calls nested in aggregate calls, an error on every engine,
//! and calls of functions that the engine doesn't have, a warning where the connection reports all of its functions.
//! See `docs/design/core_analysis_catalog.md`.

use super::state::AnalysisState;
use super::types::*;
use crate::catalog::{Name, QualifiedFunctionName};
use crate::hash::HashSet;
use dashql_buffers::algebra::FunctionCallModifier;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::NodeType;

/// Aggregates of SQL and of the common engines, sorted. A catalog declares the aggregates of its engine, but a
/// connection without functions in the catalog (Trino) still has these, and a nested one fails on every engine.
const STANDARD_AGGREGATES: &[&str] = &[
    "any_value",
    "approx_count_distinct",
    "approx_distinct",
    "approx_percentile",
    "arbitrary",
    "array_agg",
    "avg",
    "bit_and",
    "bit_or",
    "bit_xor",
    "bool_and",
    "bool_or",
    "corr",
    "count",
    "count_if",
    "covar_pop",
    "covar_samp",
    "every",
    "json_agg",
    "json_arrayagg",
    "json_object_agg",
    "jsonb_agg",
    "jsonb_object_agg",
    "listagg",
    "max",
    "max_by",
    "median",
    "min",
    "min_by",
    "mode",
    "percentile_cont",
    "percentile_disc",
    "regr_avgx",
    "regr_avgy",
    "regr_count",
    "regr_intercept",
    "regr_r2",
    "regr_slope",
    "regr_sxx",
    "regr_sxy",
    "regr_syy",
    "stddev",
    "stddev_pop",
    "stddev_samp",
    "string_agg",
    "sum",
    "var_pop",
    "var_samp",
    "variance",
    "xmlagg",
];

/// Calls that are no function of a catalog, sorted: the SQL forms with the syntax of a call and the casts in the form
/// of a call, `int4(x)` for `CAST(x AS int4)`. `pg_proc` has none of them, PostgreSQL and Hyper read them in their
/// grammar. A few more names than an engine knows only spare a warning.
const SQL_FORMS: &[&str] = &[
    "bool",
    "bpchar",
    "bytea",
    "char",
    "date",
    "float4",
    "float8",
    "geography",
    "greatest",
    "grouping",
    "int2",
    "int4",
    "int8",
    "json",
    "jsonb",
    "least",
    "name",
    "oid",
    "regclass",
    "regconfig",
    "regdictionary",
    "regoper",
    "regoperator",
    "regproc",
    "regprocedure",
    "regtype",
    "text",
    "timestamptz",
    "timetz",
    "uuid",
    "varchar",
];

/// Functions of other engines, mostly Trino, and what to write instead: (function, the function of the alternative,
/// the alternative). A hint is given only when the catalog declares the function of the alternative.
const UNKNOWN_FUNCTION_HINTS: &[(&str, &str, &str)] = &[
    ("approx_distinct", "approx_count_distinct", "approx_count_distinct(…)"),
    ("approx_percentile", "percentile_cont", "percentile_cont(…) WITHIN GROUP (ORDER BY …)"),
    ("arbitrary", "any_value", "any_value(…)"),
    ("array_join", "array_to_string", "array_to_string(…)"),
    ("cardinality", "array_length", "array_length(…)"),
    ("count_if", "count", "count(*) FILTER (WHERE …)"),
    ("from_unixtime", "to_timestamp", "to_timestamp(…)"),
];

fn has_modifier(call: &FunctionCall, modifier: FunctionCallModifier) -> bool {
    call.function_call_modifiers & modifier.0 != 0
}

/// Is a call an aggregate, not a window function? A standard aggregate when the name is bare or in `pg_catalog`, an
/// ordered-set aggregate by its WITHIN GROUP, or a function that the script or the catalog declares as aggregate.
fn is_aggregate(state: &AnalysisState, call: &FunctionCall) -> bool {
    let FunctionName::Qualified(name) = &call.function_name else { return false };
    if has_modifier(call, FunctionCallModifier::OVER) {
        return false;
    }
    if has_modifier(call, FunctionCallModifier::WITHIN_GROUP) {
        return true;
    }
    let schema = name.schema_name.text();
    if (schema.is_empty() || schema == "pg_catalog")
        && STANDARD_AGGREGATES.binary_search(&name.function_name.text()).is_ok()
    {
        return true;
    }
    state
        .resolve_function(name)
        .into_iter()
        .any(|loc| state.function(loc).is_some_and(|function| function.is_aggregate))
}

/// The function call of an expression
fn call_of<'s>(state: &'s AnalysisState, expr: Option<ExprId>) -> Option<&'s FunctionCall> {
    match &state.out.expressions.get(expr? as usize)?.inner {
        ExpressionInner::FunctionCall(call) => Some(call),
        _ => None,
    }
}

/// The name of a call in a message
fn call_name(call: &FunctionCall) -> &str {
    match &call.function_name {
        FunctionName::Qualified(name) => name.function_name.text(),
        FunctionName::Known(_) => "",
    }
}

/// The aggregate call that an aggregate call is nested in: the closest enclosing one of the AST nodes of the aggregate
/// calls of the same query. A subquery has an aggregation of its own and a window function aggregates after the
/// grouping, both end the walk. Scalar calls and every other expression are passed through.
fn enclosing_aggregate(state: &AnalysisState, aggregates: &HashSet<u32>, ast_node_id: u32) -> Option<u32> {
    let mut at = ast_node_id;
    // A parent has a larger id in the post-order AST, the walk ends at a statement root, which is its own parent
    for _ in 0..state.ast.len() {
        let parent = state.node(at)?.parent();
        if parent == at {
            return None;
        }
        at = parent;
        match state.node(at)?.node_type() {
            NodeType::OBJECT_SQL_SELECT => return None,
            NodeType::OBJECT_SQL_FUNCTION_EXPRESSION if aggregates.contains(&at) => return Some(at),
            NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                if call_of(state, state.expression_of(at)).is_some_and(|c| has_modifier(c, FunctionCallModifier::OVER))
                {
                    return None;
                }
            }
            _ => {}
        }
    }
    None
}

/// Report aggregate calls that are nested in aggregate calls of the same query, `string_agg(array_agg(x), ',')`
fn check_nested_aggregates(state: &mut AnalysisState) {
    let calls = state.out.expressions.iter().filter_map(|expr| match &expr.inner {
        ExpressionInner::FunctionCall(call) if is_aggregate(state, call) => Some((expr.ast_node_id, call)),
        _ => None,
    });
    let aggregates: Vec<(u32, &FunctionCall)> = calls.collect();
    let nodes: HashSet<u32> = aggregates.iter().map(|&(node, _)| node).collect();
    let mut nested = Vec::new();
    for &(node, call) in &aggregates {
        if let Some(outer) = enclosing_aggregate(state, &nodes, node) {
            let outer_name = call_of(state, state.expression_of(outer)).map(call_name).unwrap_or_default();
            let message =
                format!("aggregate function calls cannot be nested: {} is inside of {}", call_name(call), outer_name);
            nested.push((node, message));
        }
    }
    for (node, message) in nested {
        state.add_error(AnalyzerErrorType::NESTED_AGGREGATE_CALL, AnalyzerErrorSeverity::ERROR, node, message);
    }
}

/// The message of a call of a function that the connection doesn't have, with a hint if the catalog has the
/// alternative of the function
fn unknown_function_message(state: &AnalysisState, name: &QualifiedFunctionName) -> String {
    let mut message = format!("function {} does not exist on the connection", name.debug_string());
    let hint = UNKNOWN_FUNCTION_HINTS.iter().find(|(function, ..)| *function == name.function_name.text());
    if let Some((_, alternative, text)) = hint {
        let alternative = QualifiedFunctionName {
            ast_node_id: None,
            database_name: state.empty_name(),
            schema_name: state.empty_name(),
            function_name: Name { text: (*alternative).into(), ..state.empty_name() },
        };
        if !state.resolve_function(&alternative).is_empty() {
            message.push_str(", use ");
            message.push_str(text);
        }
    }
    message
}

/// Report calls of functions that no entry declares when the connection reports all functions of its engine. A
/// catalog without that marker, e.g. of Trino or a restored one, may lack functions, so it decides nothing. Calls with
/// the syntax of keywords (`KnownFunction`) and names with a database are not checked, the functions of an engine are
/// the same in every database.
fn check_unknown_functions(state: &mut AnalysisState) {
    if !state.catalog.functions_complete() {
        return;
    }
    let mut unknown = Vec::new();
    for expr in &state.out.expressions {
        let ExpressionInner::FunctionCall(call) = &expr.inner else { continue };
        let FunctionName::Qualified(name) = &call.function_name else { continue };
        if !name.database_name.text().is_empty() {
            continue;
        }
        let schema = name.schema_name.text();
        if (schema.is_empty() || schema == "pg_catalog") && SQL_FORMS.binary_search(&name.function_name.text()).is_ok()
        {
            continue;
        }
        if !state.resolve_function(name).is_empty() {
            continue;
        }
        unknown.push((name.ast_node_id.unwrap_or(expr.ast_node_id), unknown_function_message(state, name)));
    }
    for (node, message) in unknown {
        state.add_error(AnalyzerErrorType::UNKNOWN_FUNCTION, AnalyzerErrorSeverity::WARNING, node, message);
    }
}

pub(super) fn analyze(state: &mut AnalysisState) {
    check_nested_aggregates(state);
    check_unknown_functions(state);
}

#[cfg(test)]
mod tests {
    use super::{SQL_FORMS, STANDARD_AGGREGATES};

    #[test]
    fn the_name_lists_are_sorted() {
        assert!(STANDARD_AGGREGATES.windows(2).all(|w| w[0] < w[1]));
        assert!(SQL_FORMS.windows(2).all(|w| w[0] < w[1]));
    }
}
