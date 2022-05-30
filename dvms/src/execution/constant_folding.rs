use super::expression_evaluator::Evaluatable;
use super::scalar_value::ScalarValue;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use crate::grammar::Program;
use crate::grammar::Statement;
use std::error::Error;

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

pub fn evaluate_constant_expressions<'a>(
    program: &Program<'a>,
    ctx: &mut ExpressionEvaluationContext<'a>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut pending: Vec<usize> = Vec::new();
    for stmt in program.statements.iter() {
        match &stmt {
            Statement::Viz(v) => {}
            Statement::Select(_) => todo!(),
            Statement::Input(_) => todo!(),
            Statement::Fetch(_) => todo!(),
            Statement::Load(_) => todo!(),
            Statement::Create(_) => todo!(),
            Statement::CreateAs(_) => todo!(),
            Statement::CreateView(_) => todo!(),
            Statement::Set(_) => todo!(),
        }
    }
    Ok(())
}
