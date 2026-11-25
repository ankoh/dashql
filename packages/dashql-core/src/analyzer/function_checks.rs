//! Checks of function calls before a script runs: aggregate calls nested in aggregate calls, an error on every engine.
//! See `docs/design/core_analysis_catalog.md`.

use super::state::AnalysisState;
use super::types::*;
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

/// How many declarations of a name the checks look at
const RESOLVE_LIMIT: usize = 16;

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
        .resolve_function(name, RESOLVE_LIMIT)
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

/// The aggregate call that an aggregate call is nested in: the closest enclosing aggregate of the same query. A
/// subquery has an aggregation of its own and a window function aggregates after the grouping, both end the walk.
/// Scalar calls and every other expression are passed through.
fn enclosing_aggregate(state: &AnalysisState, ast_node_id: u32) -> Option<u32> {
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
            NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let Some(outer) = call_of(state, state.expression_of(at)) else { continue };
                if has_modifier(outer, FunctionCallModifier::OVER) {
                    return None;
                }
                if is_aggregate(state, outer) {
                    return Some(at);
                }
            }
            _ => {}
        }
    }
    None
}

/// Report aggregate calls that are nested in aggregate calls of the same query, `string_agg(array_agg(x), ',')`
fn check_nested_aggregates(state: &mut AnalysisState) {
    let mut nested = Vec::new();
    for expr in &state.out.expressions {
        let ExpressionInner::FunctionCall(call) = &expr.inner else { continue };
        if !is_aggregate(state, call) {
            continue;
        }
        if let Some(outer) = enclosing_aggregate(state, expr.ast_node_id) {
            let outer_name = call_of(state, state.expression_of(outer)).map(call_name).unwrap_or_default();
            let message =
                format!("aggregate function calls cannot be nested: {} is inside of {}", call_name(call), outer_name);
            nested.push((expr.ast_node_id, message));
        }
    }
    for (node, message) in nested {
        state.add_error(AnalyzerErrorType::NESTED_AGGREGATE_CALL, AnalyzerErrorSeverity::ERROR, node, message);
    }
}

pub(super) fn analyze(state: &mut AnalysisState) {
    check_nested_aggregates(state);
}

#[cfg(test)]
mod tests {
    use super::STANDARD_AGGREGATES;

    #[test]
    fn the_standard_aggregates_are_sorted() {
        assert!(STANDARD_AGGREGATES.windows(2).all(|w| w[0] < w[1]));
    }
}
