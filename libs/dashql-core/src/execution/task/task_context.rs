use crate::{execution::expression_evaluator::ExpressionEvaluationContext, grammar::Program};

pub struct TaskContext<'a> {
    pub program: &'a Program<'a>,
    pub expressions: ExpressionEvaluationContext<'a>,
}
