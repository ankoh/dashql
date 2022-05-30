use super::function_logic;
use super::scalar_value::ScalarValue;
use crate::error::RawError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use crate::grammar::NamePath;
use std::collections::HashMap;
use std::error::Error;
use std::rc::Rc;

/// Context for evaluating expressions
#[derive(Default)]
pub struct ExpressionEvaluationContext<'a> {
    pub named_values: HashMap<NamePath<'a>, Rc<ScalarValue>>,
    pub evaluated_expressions: HashMap<Expression<'a>, Option<Rc<ScalarValue>>>,
    pub current_node_id: Option<usize>,
}

const STRING_REF_TRIMMING: &'static [char] = &['"', ' ', '\''];
impl<'a> Expression<'a> {
    pub fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Option<Rc<ScalarValue>>, Box<dyn Error + Send + Sync>> {
        if let Some(value) = ctx.evaluated_expressions.get(&self) {
            return Ok(value.clone());
        }
        let value = match self {
            Expression::Null => None,
            Expression::Boolean(v) => Some(Rc::new(ScalarValue::Boolean(*v))),
            Expression::Uint32(v) => Some(Rc::new(ScalarValue::Int64(*v as i64))),
            Expression::StringRef(s) => Some(Rc::new(ScalarValue::Varchar(
                s.trim_matches(STRING_REF_TRIMMING).to_string(),
            ))),
            Expression::ColumnRef(name) => ctx.named_values.get(name).cloned(),
            Expression::FunctionCall(f) => match f.name.get() {
                FunctionName::Known(known) => match known {
                    _ => {
                        return Err(Box::new(RawError::from(format!(
                            "function not implemented: {}",
                            known.variant_name().unwrap_or_default()
                        ))))
                    }
                },
                FunctionName::Unknown(func) => match func {
                    "format" => Some(Rc::new(function_logic::format::evaluate_scalar(ctx, f)?)),
                    _ => return Err(Box::new(RawError::from(format!("function not implemented: {}", func)))),
                },
            },
            _ => return Err(Box::new(RawError::from(format!("cannot evaluate: {:?}", self)))),
        };
        ctx.evaluated_expressions.insert(self.clone(), value.clone());
        Ok(value)
    }
}
