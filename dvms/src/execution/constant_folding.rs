use super::expression_evaluator::Evaluatable;
use super::scalar_value::ScalarValue;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use std::collections::hash_map::DefaultHasher;
use std::error::Error;
use std::hash::Hasher;
use std::ptr;

use super::expression_evaluator::ExpressionEvaluationContext;

// Check if an expression is constant
pub fn is_constant_expression<'a>(root: Expression<'a>, ctx: &ExpressionEvaluationContext<'a>) -> bool {
    let mut pending: Vec<Expression<'a>> = Vec::new();
    pending.push(root);

    while let Some(top) = pending.pop() {
        let can_eval = match top {
            Expression::Null => true,
            Expression::Boolean(_) => true,
            Expression::Uint32(_) => true,
            Expression::StringRef(_) => true,
            Expression::ColumnRef(name) => ctx.named_values.contains_key(&name),
            Expression::Array(elems) => {
                for elem in elems.iter() {
                    pending.push(elem.get());
                }
                true
            }
            Expression::FunctionCall(func) => {
                for arg in func.args.get().iter() {
                    pending.push(arg.get().value.get());
                }
                match func.name.get() {
                    FunctionName::Known(_) => false,
                    FunctionName::Unknown(name) => match name {
                        "format" => true,
                        _ => false,
                    },
                }
            }
            Expression::Case(_) => false,
            Expression::Conjunction(_) => false,
            Expression::ConstCast(_) => false,
            Expression::Disjunction(_) => false,
            Expression::Exists(_) => false,
            Expression::Indirection(_) => false,
            Expression::Nary(_) => false,
            Expression::ParameterRef(_) => false,
            Expression::SelectStatement(_) => false,
            Expression::Subquery(_) => false,
            Expression::TypeCast(_) => false,
            Expression::TypeTest(_) => false,
        };
        if !can_eval {
            return false;
        }
    }

    true
}

/// Evaluate an expression
pub fn evaluate_constant_expression<'a>(
    expr: &Expression<'a>,
    ctx: &mut ExpressionEvaluationContext<'a>,
) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>> {
    expr.evaluate(ctx)
}

impl<'a> Expression<'a> {
    pub fn get_id(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        match &self {
            Expression::Null => ptr::hash(&self, &mut hasher),
            Expression::Uint32(v) => ptr::hash(v, &mut hasher),
            Expression::Boolean(v) => ptr::hash(v, &mut hasher),
            Expression::Array(v) => ptr::hash(v, &mut hasher),
            Expression::Case(v) => ptr::hash(v, &mut hasher),
            Expression::ColumnRef(v) => ptr::hash(v, &mut hasher),
            Expression::Conjunction(v) => ptr::hash(v, &mut hasher),
            Expression::ConstCast(v) => ptr::hash(v, &mut hasher),
            Expression::Disjunction(v) => ptr::hash(v, &mut hasher),
            Expression::Exists(v) => ptr::hash(v, &mut hasher),
            Expression::FunctionCall(v) => ptr::hash(v, &mut hasher),
            Expression::Indirection(v) => ptr::hash(v, &mut hasher),
            Expression::Nary(v) => ptr::hash(v, &mut hasher),
            Expression::ParameterRef(v) => ptr::hash(v, &mut hasher),
            Expression::SelectStatement(v) => ptr::hash(v, &mut hasher),
            Expression::StringRef(v) => ptr::hash(v, &mut hasher),
            Expression::Subquery(v) => ptr::hash(v, &mut hasher),
            Expression::TypeCast(v) => ptr::hash(v, &mut hasher),
            Expression::TypeTest(v) => ptr::hash(v, &mut hasher),
        };
        hasher.finish()
    }
}
