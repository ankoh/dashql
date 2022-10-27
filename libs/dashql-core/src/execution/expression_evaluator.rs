use super::execution_context::ExecutionContextSnapshot;
use super::function;
use super::scalar_value::ScalarValue;
use crate::error::SystemError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use std::rc::Rc;

const STRING_REF_TRIMMING: &'static [char] = &['"', ' ', '\''];

impl<'a> Expression<'a> {
    pub fn evaluate<'snap>(
        &self,
        ctx: &mut ExecutionContextSnapshot<'a, 'snap>,
    ) -> Result<Option<Rc<ScalarValue>>, SystemError> {
        if let Some(value) = ctx
            .local_state
            .cached_values
            .get(&self)
            .or(ctx.global_state.cached_values.get(&self))
        {
            return Ok(value.clone());
        }
        let value = match self {
            Expression::Null => None,
            Expression::Boolean(v) => Some(Rc::new(ScalarValue::Boolean(*v))),
            Expression::LiteralInteger(v) => Some(Rc::new(ScalarValue::Int64(v.parse().unwrap_or_default()))),
            Expression::LiteralFloat(v) => Some(Rc::new(ScalarValue::Float64(v.parse().unwrap_or_default()))),
            Expression::LiteralString(s) => Some(Rc::new(ScalarValue::Utf8(
                s.trim_matches(STRING_REF_TRIMMING).to_string(),
            ))),
            Expression::ParameterRef(p) => match ctx
                .local_state
                .parameters
                .get(p.name.get())
                .or(ctx.global_state.parameters.get(p.name.get()))
                .cloned()
            {
                Some(v) => v,
                None => return Err(SystemError::UnknownInput("".to_string())),
            },
            Expression::FunctionCall(f) => match f.name.get() {
                FunctionName::Known(known) => match known {
                    _ => return Err(SystemError::FunctionNotImplementedButKnown(known)),
                },
                FunctionName::Unknown(func) => match func {
                    "format" => Some(Rc::new(function::format::evaluate_scalar(ctx, f)?)),
                    _ => return Err(SystemError::FunctionNotImplemented(func.to_string())),
                },
            },
            _ => return Err(SystemError::ExpressionTypeNotImplemented(None)),
        };
        ctx.local_state.cached_values.insert(self.clone(), value.clone());
        Ok(value)
    }
}
