// use crate::analyzer::node_error::NodeError;
// use crate::analyzer::node_error::NodeErrorCode;
// use crate::execution::expression_evaluator::{Evaluatable, ExpressionEvaluationContext};
// use crate::execution::scalar_value::{LogicalType, ScalarValue};
// use crate::grammar::{ASTCell, FunctionExpression};
// use std::error::Error;
//
// pub fn evaluate_scalar<'a>(
//     ctx: &mut ExpressionEvaluationContext<'a>,
//     expr: &ASTCell<&'a FunctionExpression<'a>>,
// ) -> Result<ScalarValue, Box<dyn Error + Send + Sync>> {
//     // Unpack arguments
//     let node_id = expr.get_node_id();
//     let expr = expr.get();
//     let raw_args = expr.args.get();
//
//     // Evaluate all arguments
//     let mut eval_args = Vec::with_capacity(raw_args.len());
//     for arg in raw_args.iter() {
//         let arg_expr = arg.get().value.get();
//         eval_args.push(arg_expr.evaluate(ctx)?);
//     }
//
//     // Check semantics
//     if eval_args.len() == 0 {
//         return Err(Box::new(NodeError::new(node_id, NodeErrorCode::InsufficientArguments)));
//     }
//     let template = match ScalarValue::opt_cast_as(eval_args[0], LogicalType::Varchar) {
//         Ok(Some(ScalarValue::Varchar(s))) => s,
//         Ok(_) => unreachable!(),
//         Err(e) => {
//             return Err(Box::new(NodeError::with_message(
//                 node_id,
//                 NodeErrorCode::InvalidArgumentType,
//                 e.to_string(),
//             )));
//         }
//     };
//
//     SQLValue::default()
// }
