//! Identify constant expressions.
//!
//! Literals, constant interval casts, negations, binary expressions and comparisons over constants, and
//! function calls without modifiers, FILTER and ORDER BY over constants are constant. Finish stores the roots of the
//! constant expression trees, the constant expressions that are no operand of another one.

use super::state::{literal_type, AnalysisState};
use super::types::*;
use crate::hash::HashSet;
use dashql_buffers::algebra::{BinaryExpressionFunction, ComparisonFunction, UnaryFunction};
use dashql_buffers::analyzer::SemanticNodeMarkerType;
use dashql_buffers::parser::{AttributeKey as K, ExpressionOperator as Op, IntervalType as IntervalTypeEnum, NodeType};
use dashql_parser::attrs;
use std::ops::Range;

/// The pass that identifies constant expressions
#[derive(Default)]
pub(super) struct ConstantPropagationPass {
    /// The constant expressions, stored as roots during Finish
    constants: Vec<ExprId>,
}

/// The binary expression function of an operator, UNKNOWN for operators without one
fn binary_function(op: Op) -> BinaryExpressionFunction {
    match op {
        Op::PLUS => BinaryExpressionFunction::PLUS,
        Op::MINUS => BinaryExpressionFunction::MINUS,
        Op::MULTIPLY => BinaryExpressionFunction::MULTIPLY,
        Op::DIVIDE => BinaryExpressionFunction::DIVIDE,
        Op::MODULUS => BinaryExpressionFunction::MODULUS,
        Op::XOR => BinaryExpressionFunction::XOR,
        _ => BinaryExpressionFunction::UNKNOWN,
    }
}

/// The comparison function of an operator, UNKNOWN for operators without one
fn comparison_function(op: Op) -> ComparisonFunction {
    match op {
        Op::EQUAL => ComparisonFunction::EQUAL,
        Op::NOT_EQUAL => ComparisonFunction::NOT_EQUAL,
        Op::LESS_EQUAL => ComparisonFunction::LESS_EQUAL,
        Op::LESS_THAN => ComparisonFunction::LESS_THAN,
        Op::GREATER_EQUAL => ComparisonFunction::GREATER_EQUAL,
        Op::GREATER_THAN => ComparisonFunction::GREATER_THAN,
        _ => ComparisonFunction::UNKNOWN,
    }
}

impl ConstantPropagationPass {
    /// The constant expression of a node
    fn constant_of(state: &AnalysisState, node_id: u32) -> Option<ExprId> {
        state.expression_of(node_id).filter(|&e| state.out.expression(e).is_some_and(|e| e.is_constant_expression))
    }

    fn add_constant(
        &mut self,
        state: &mut AnalysisState,
        node_id: u32,
        inner: ExpressionInner,
        marker: SemanticNodeMarkerType,
    ) {
        let Some(node) = state.node(node_id) else { return };
        let expr = state.add_expression(node_id, *node.symbol_span(), inner);
        if let Some(e) = state.out.expression_mut(expr) {
            e.is_constant_expression = true;
        }
        state.set_expression_of(node_id, expr);
        state.mark(node_id, marker);
        self.constants.push(expr);
    }

    pub fn visit(&mut self, state: &mut AnalysisState, morsel: Range<usize>) {
        for node_id in morsel {
            let Some(node) = state.ast.get(node_id) else { break };
            let node_id = node_id as u32;
            match node.node_type() {
                // Base case, literals
                NodeType::LITERAL_FLOAT
                | NodeType::LITERAL_INTEGER
                | NodeType::LITERAL_INTERVAL
                | NodeType::LITERAL_NULL
                | NodeType::LITERAL_STRING => {
                    let raw_value = state.text_span(*node.symbol_span());
                    let inner =
                        ExpressionInner::Literal(Literal { literal_type: literal_type(node.node_type()), raw_value });
                    // The literal node types share the values of the semantic markers
                    let marker = SemanticNodeMarkerType(node.node_type().0 as u8);
                    self.add_constant(state, node_id, inner, marker);
                }
                // interval '30 days'
                NodeType::OBJECT_SQL_CONST_INTERVAL_CAST => {
                    let [value, interval] =
                        attrs!(state.children(node), [K::SQL_CONST_CAST_VALUE, K::SQL_CONST_CAST_INTERVAL]);
                    let Some(value) = value else { continue };
                    let Some(value_expr) = Self::constant_of(state, state.node_id(value)) else { continue };
                    let mut cast = ConstIntervalCast { value_expression_id: value_expr, interval: None };
                    // interval(3) '4' has the precision without an interval type
                    if let Some(precision) = interval.filter(|i| i.node_type() != NodeType::OBJECT_SQL_INTERVAL_TYPE) {
                        let precision_expression = state.expression_of(state.node_id(precision)).map(|e| e as i32);
                        cast.interval = Some(IntervalType { interval_type: IntervalTypeEnum(0), precision_expression });
                    } else if let Some(interval) = interval {
                        let [type_attr, precision] =
                            attrs!(state.children(interval), [K::SQL_INTERVAL_TYPE, K::SQL_INTERVAL_PRECISION]);
                        let interval_type =
                            IntervalTypeEnum(type_attr.map(|t| t.children_begin_or_value()).unwrap_or(0) as _);
                        let precision_expression =
                            precision.and_then(|p| state.expression_of(state.node_id(p))).map(|e| e as i32);
                        cast.interval = Some(IntervalType { interval_type, precision_expression });
                    }
                    self.add_constant(
                        state,
                        node_id,
                        ExpressionInner::ConstIntervalCast(cast),
                        SemanticNodeMarkerType::CONSTANT_EXPRESSION,
                    );
                }
                // N-ary expressions
                NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                    let [op_node, args_node] =
                        attrs!(state.children(node), [K::SQL_EXPRESSION_OPERATOR, K::SQL_EXPRESSION_ARGS]);
                    let Some(op_node) = op_node.filter(|n| n.node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR)
                    else {
                        continue;
                    };
                    // Are all arguments constant?
                    let args = args_node.map(|a| state.children(a)).unwrap_or(&[]);
                    let mut const_args = Vec::with_capacity(args.len());
                    for arg in args {
                        match Self::constant_of(state, state.node_id(arg)) {
                            Some(e) => const_args.push(e),
                            None => break,
                        }
                    }
                    if const_args.len() != args.len() {
                        continue;
                    }
                    let op = Op(op_node.children_begin_or_value() as _);
                    // -1, -(2 + 3)
                    if let ([input_expression_id], Op::NEGATE) = (const_args.as_slice(), op) {
                        let inner = ExpressionInner::UnaryExpression(UnaryExpression {
                            func: UnaryFunction::NEGATE,
                            input_expression_id: *input_expression_id,
                        });
                        self.add_constant(state, node_id, inner, SemanticNodeMarkerType::CONSTANT_EXPRESSION);
                        continue;
                    }
                    let [left_expression_id, right_expression_id] = *const_args.as_slice() else { continue };
                    let inner = match op {
                        Op::PLUS | Op::MINUS | Op::MULTIPLY | Op::DIVIDE | Op::MODULUS | Op::XOR | Op::AND | Op::OR => {
                            ExpressionInner::BinaryExpression(BinaryExpression {
                                func: binary_function(op),
                                left_expression_id,
                                right_expression_id,
                            })
                        }
                        Op::EQUAL
                        | Op::NOT_EQUAL
                        | Op::LESS_THAN
                        | Op::LESS_EQUAL
                        | Op::GREATER_THAN
                        | Op::GREATER_EQUAL => ExpressionInner::Comparison(Comparison {
                            func: comparison_function(op),
                            left_expression_id,
                            right_expression_id,
                        }),
                        _ => continue,
                    };
                    self.add_constant(state, node_id, inner, SemanticNodeMarkerType::CONSTANT_EXPRESSION);
                }
                // Function calls
                NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                    let Some(expr_id) = state.expression_of(node_id) else { continue };
                    let Some(ExpressionInner::FunctionCall(call)) = state.out.expression(expr_id).map(|e| &e.inner)
                    else {
                        continue;
                    };
                    // Skip functions with any modifiers
                    if call.function_call_modifiers != 0 {
                        continue;
                    }
                    // FILTER and ORDER BY have no modifier bit, an aggregate with either is not constant
                    let [filter, order] = attrs!(state.children(node), [K::SQL_FUNCTION_FILTER, K::SQL_FUNCTION_ORDER]);
                    if filter.is_some() || order.is_some() {
                        continue;
                    }
                    match call.arguments {
                        // Constant, but not stored as a root
                        FunctionArguments::None => {
                            if let Some(e) = state.out.expression_mut(expr_id) {
                                e.is_constant_expression = true;
                            }
                        }
                        FunctionArguments::Generic { begin, count } => {
                            let mut is_constant = true;
                            for i in begin..begin + count {
                                // A missing argument or argument expression makes the call not constant
                                let arg_expr = state
                                    .out
                                    .function_arguments
                                    .get(i as usize)
                                    .and_then(|a| state.expression_of(a.value_ast_node_id));
                                let (Some(arg_expr), Some(arg)) =
                                    (arg_expr, state.out.function_arguments.get_mut(i as usize))
                                else {
                                    is_constant = false;
                                    break;
                                };
                                arg.expression_id = Some(arg_expr);
                                is_constant &= state.out.expression(arg_expr).is_some_and(|e| e.is_constant_expression);
                            }
                            if let Some(e) = state.out.expression_mut(expr_id) {
                                e.is_constant_expression = is_constant;
                            }
                            if is_constant {
                                self.constants.push(expr_id);
                                state.mark(node_id, SemanticNodeMarkerType::CONSTANT_EXPRESSION);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    pub fn finish(&mut self, state: &mut AnalysisState) {
        // The operands of constant expressions are no roots
        let mut operands: HashSet<ExprId> = HashSet::default();
        for &expr_id in &self.constants {
            let Some(expr) = state.out.expression(expr_id) else { continue };
            match &expr.inner {
                ExpressionInner::UnaryExpression(u) => {
                    operands.insert(u.input_expression_id);
                }
                ExpressionInner::BinaryExpression(b) => {
                    operands.extend([b.left_expression_id, b.right_expression_id]);
                }
                ExpressionInner::Comparison(c) => {
                    operands.extend([c.left_expression_id, c.right_expression_id]);
                }
                ExpressionInner::ConstIntervalCast(c) => {
                    operands.insert(c.value_expression_id);
                    let precision = c.interval.as_ref().and_then(|i| i.precision_expression);
                    operands.extend(precision.map(|p| p as ExprId));
                }
                ExpressionInner::FunctionCall(call) => {
                    if let FunctionArguments::Generic { begin, count } = call.arguments {
                        let args = state.out.function_arguments.get(begin as usize..(begin + count) as usize);
                        operands.extend(args.unwrap_or_default().iter().filter_map(|a| a.expression_id));
                    }
                }
                ExpressionInner::None | ExpressionInner::ColumnRef(_) | ExpressionInner::Literal(_) => {}
            }
        }
        for &expr_id in &self.constants {
            if operands.contains(&expr_id) {
                continue;
            }
            let Some(node_id) = state.out.expression(expr_id).map(|e| e.ast_node_id) else { continue };
            let Some(node) = state.node(node_id) else { continue };
            // If object, mark as constant expression root
            if node.node_type().0 >= NodeType::OBJECT_KEYS_.0 {
                state.mark(node_id, SemanticNodeMarkerType::CONSTANT_EXPRESSION_ROOT);
            }
            state.out.constant_expressions.push(ConstantExpression { root: expr_id });
        }
    }
}
