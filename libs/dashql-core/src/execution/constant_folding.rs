use super::execution_context::ExecutionContextSnapshot;
use super::scalar_value::ScalarValue;
use crate::error::SystemError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use smallvec::SmallVec;
use std::rc::Rc;

// Check if an expression is constant
pub fn is_constant_expression<'ast, 'snap>(
    root: Expression<'ast>,
    ctx: &ExecutionContextSnapshot<'ast, 'snap>,
) -> bool {
    let mut pending: SmallVec<[Expression<'ast>; 6]> = SmallVec::new();
    pending.push(root);

    while let Some(top) = pending.pop() {
        let can_eval = match top {
            Expression::Null => true,
            Expression::Boolean(_) => true,
            Expression::Uint32(_) => true,
            Expression::StringRef(_) => true,
            Expression::ColumnRef(name) => {
                ctx.local_state.named_values.contains_key(&name) || ctx.global_state.named_values.contains_key(&name)
            }
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
pub fn evaluate_constant_expression<'ast, 'snap>(
    expr: Expression<'ast>,
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
) -> Result<Option<Rc<ScalarValue>>, SystemError> {
    expr.evaluate(ctx)
}
