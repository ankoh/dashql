use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::scalar_value::ScalarValue;
use crate::fmt::dynfmt;
use crate::grammar::FunctionExpression;
use std::collections::HashMap;
use std::sync::Arc;

pub fn evaluate_scalar<'ast, 'snap>(
    ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
    expr: &'ast FunctionExpression<'ast>,
) -> Result<ScalarValue, SystemError> {
    // Get template string
    let raw_args = expr.args.get();
    if raw_args.len() == 0 {
        return Err(SystemError::InsufficientArguments);
    }
    let template_arg = raw_args[0].get();
    let template_val = template_arg.value.get().evaluate(ctx)?;
    let template_str = template_val.as_ref().map(|v| v.to_string()).unwrap_or_default();

    // Evaluate all arguments
    let mut args_unnamed = Vec::new();
    let mut args_named = HashMap::new();
    for arg in raw_args.iter().skip(1) {
        let arg = arg.get();
        let value = arg.value.get();
        let value_evaled = match value.evaluate(ctx)? {
            Some(v) => v.to_string(),
            None => "".to_string(),
        };
        if let Some(name) = arg.name.get() {
            args_named.insert(name.to_string(), value_evaled);
        } else {
            args_unnamed.push(value_evaled);
        }
    }

    // Format string
    let result = dynfmt(&template_str, &args_unnamed, &args_named)
        .map_err(|e| SystemError::FunctionEvaluationFailed(Arc::new(e)))?;
    Ok(ScalarValue::Varchar(result))
}

#[cfg(test)]
mod test {
    #[test]
    fn test_1() {}
}