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
    pub named_values: HashMap<NamePath<'a>, ScalarValue>,
    pub evaluated_expressions: HashMap<Expression<'a>, Rc<Option<ScalarValue>>>,
    pub current_node_id: Option<usize>,
}
/// Can be evaluated
pub trait Evaluatable<'a> {
    fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Rc<Option<ScalarValue>>, Box<dyn Error + Send + Sync>>;
}

const STRING_REF_TRIMMING: &'static [char] = &['"', ' ', '\''];
impl<'a> Evaluatable<'a> for Expression<'a> {
    fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Rc<Option<ScalarValue>>, Box<dyn Error + Send + Sync>> {
        if let Some(value) = ctx.evaluated_expressions.get(&self) {
            return Ok(value.clone());
        }
        let value = match self {
            Expression::Null => None,
            Expression::Boolean(v) => Some(ScalarValue::Boolean(*v)),
            Expression::Uint32(v) => Some(ScalarValue::Int64(*v as i64)),
            Expression::StringRef(s) => Some(ScalarValue::Varchar(s.trim_matches(STRING_REF_TRIMMING).to_string())),
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
                    "format" => Some(function_logic::format::evaluate_scalar(ctx, f)?),
                    _ => return Err(Box::new(RawError::from(format!("function not implemented: {}", func)))),
                },
            },
            _ => return Err(Box::new(RawError::from(format!("cannot evaluate: {:?}", self)))),
        };
        let value_ptr = Rc::new(value);
        ctx.evaluated_expressions.insert(self.clone(), value_ptr.clone());
        Ok(value_ptr)
    }
}
