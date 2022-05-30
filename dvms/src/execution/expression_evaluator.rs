use super::function_logic;
use super::scalar_value::ScalarValue;
use crate::error::RawError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use crate::grammar::NamePath;
use crate::utils::by_address::ByAddress;
use std::collections::HashMap;
use std::error::Error;
use std::rc::Rc;

/// Context for evaluating expressions
pub struct ExpressionEvaluationContext<'a> {
    pub named_values: HashMap<NamePath<'a>, ScalarValue>,
    pub evaluated_expressions: HashMap<ByAddress<&'a Expression<'a>>, Rc<Option<ScalarValue>>>,
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
        if let Some(value) = ctx.evaluated_expressions.get(&ByAddress(&self)) {
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
        Ok(Rc::new(value))
    }
}
