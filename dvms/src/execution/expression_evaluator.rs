use super::scalar_value::ScalarValue;
use crate::error::RawError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use crate::grammar::NamePath;
use std::collections::HashMap;
use std::error::Error;

/// Context for evaluating expressions
pub struct ExpressionEvaluationContext<'a> {
    pub node_id: Option<usize>,
    pub values: HashMap<NamePath<'a>, ScalarValue>,
}
/// Can be evaluated
pub trait Evaluatable<'a> {
    fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>>;
}

// fn unnest_result<T, E>(x: Option<Result<T, E>>) -> Result<Option<T>, E> {
//     x.map_or(Ok(None), |v| v.map(Some))
// }

const STRING_REF_TRIMMING: &'static [char] = &['"', ' ', '\''];

impl<'a> Evaluatable<'a> for Expression<'a> {
    fn evaluate(
        &self,
        _ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>> {
        let value = match self {
            Expression::Null => None,
            Expression::Boolean(v) => Some(ScalarValue::Boolean(*v)),
            Expression::Uint32(v) => Some(ScalarValue::Int64(*v as i64)),
            Expression::StringRef(s) => Some(ScalarValue::Varchar(s.trim_matches(STRING_REF_TRIMMING).to_string())),
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
                    _ => return Err(Box::new(RawError::from(format!("function not implemented: {}", func)))),
                },
            },
            _ => return Err(Box::new(RawError::from(format!("cannot evaluate: {:?}", self)))),
        };
        Ok(value)
    }
}
