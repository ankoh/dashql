use std::collections::HashMap;

use crate::{
    execution::expression_evaluator::ExpressionEvaluationContext, execution::import::Import, grammar::Program,
};

pub struct TaskContext<'a> {
    pub expression_context: ExpressionEvaluationContext<'a>,
    pub imports_by_id: HashMap<usize, Import>,
}
