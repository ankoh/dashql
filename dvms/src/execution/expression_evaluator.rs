use super::function_logic;
use super::scalar_value::ScalarValue;
use crate::error::RawError;
use crate::grammar::Expression;
use crate::grammar::FunctionName;
use crate::grammar::NamePath;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::error::Error;
use std::hash::Hasher;
use std::ptr;

/// Context for evaluating expressions
#[derive(Default)]
pub struct ExpressionEvaluationContext<'a> {
    pub named_values: HashMap<NamePath<'a>, ScalarValue>,
    pub current_node_id: Option<usize>,
}
/// Can be evaluated
pub trait Evaluatable<'a> {
    fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>>;
}

const STRING_REF_TRIMMING: &'static [char] = &['"', ' ', '\''];
impl<'a> Evaluatable<'a> for Expression<'a> {
    fn evaluate(
        &self,
        ctx: &mut ExpressionEvaluationContext<'a>,
    ) -> Result<Option<ScalarValue>, Box<dyn Error + Send + Sync>> {
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
        Ok(value)
    }
}

impl<'a> Expression<'a> {
    pub fn get_id(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        match &self {
            Expression::Null => ptr::hash(&self, &mut hasher),
            Expression::Uint32(v) => ptr::hash(v, &mut hasher),
            Expression::Boolean(v) => ptr::hash(v, &mut hasher),
            Expression::Array(v) => ptr::hash(v, &mut hasher),
            Expression::Case(v) => ptr::hash(v, &mut hasher),
            Expression::ColumnRef(v) => ptr::hash(v, &mut hasher),
            Expression::Conjunction(v) => ptr::hash(v, &mut hasher),
            Expression::ConstCast(v) => ptr::hash(v, &mut hasher),
            Expression::Disjunction(v) => ptr::hash(v, &mut hasher),
            Expression::Exists(v) => ptr::hash(v, &mut hasher),
            Expression::FunctionCall(v) => ptr::hash(v, &mut hasher),
            Expression::Indirection(v) => ptr::hash(v, &mut hasher),
            Expression::Nary(v) => ptr::hash(v, &mut hasher),
            Expression::ParameterRef(v) => ptr::hash(v, &mut hasher),
            Expression::SelectStatement(v) => ptr::hash(v, &mut hasher),
            Expression::StringRef(v) => ptr::hash(v, &mut hasher),
            Expression::Subquery(v) => ptr::hash(v, &mut hasher),
            Expression::TypeCast(v) => ptr::hash(v, &mut hasher),
            Expression::TypeTest(v) => ptr::hash(v, &mut hasher),
        };
        hasher.finish()
    }
}
