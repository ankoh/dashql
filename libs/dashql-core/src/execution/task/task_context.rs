use crate::{execution::expression_evaluator::ExpressionEvaluationContext, grammar::Program};

pub struct TaskContext<'a> {
    program: &'a Program<'a>,
    expression_evaluation: ExpressionEvaluationContext<'a>,
}
