use super::sql_value::LogicalType;
use super::sql_value::PhysicalData;
use super::sql_value::SQLValue;
use crate::grammar::Expression;
use crate::grammar::NamePath;
use std::collections::HashMap;
use std::error::Error;

/// Context for evaluating expressions
pub struct ExpressionEvaluationContext<'a> {
    values: HashMap<NamePath<'a>, SQLValue>,
}
/// Can be evaluated
pub trait Evaluatable<'a> {
    fn evaluate(&self, ctx: &mut ExpressionEvaluationContext<'a>) -> Result<SQLValue, Box<dyn Error + Send + Sync>>;
}

fn unnest_result<T, E>(x: Option<Result<T, E>>) -> Result<Option<T>, E> {
    x.map_or(Ok(None), |v| v.map(Some))
}

impl<'a> Evaluatable<'a> for Expression<'a> {
    fn evaluate(&self, ctx: &mut ExpressionEvaluationContext<'a>) -> Result<SQLValue, Box<dyn Error + Send + Sync>> {
        let value = match self {
            Expression::Null => SQLValue::default(),
            Expression::Boolean(v) => SQLValue {
                logical_type: LogicalType::Boolean,
                physical_data: PhysicalData::I64(*v as i64),
            },
            Expression::Uint32(v) => SQLValue {
                logical_type: LogicalType::Boolean,
                physical_data: PhysicalData::I64(*v as i64),
            },
            Expression::StringRef(s) => SQLValue {
                logical_type: LogicalType::Varchar,
                physical_data: PhysicalData::String(s.to_string()),
            },
            Expression::Array(_) => todo!(),
            Expression::Case(c) => {
                let case_exprs = c.cases.get();
                let mut cases = Vec::new();
                cases.reserve(case_exprs.len());
                for case in case_exprs.iter() {
                    let case = case.get();
                    let when = case.when.get().evaluate(ctx)?;
                    let then = case.when.get().evaluate(ctx)?;
                    cases.push((when, then));
                }
                let argument = unnest_result(c.argument.get().map(|v| v.evaluate(ctx)))?;
                if let Some(arg) = argument {}
                todo!();
            }
            Expression::Nary(_nary) => todo!(),
            Expression::ColumnRef(_) => todo!(),
            Expression::ConstCast(_) => todo!(),
            Expression::Exists(_) => todo!(),
            Expression::FunctionCall(_) => todo!(),
            Expression::Indirection(_) => todo!(),
            Expression::ParameterRef(_) => todo!(),
            Expression::SelectStatement(_) => todo!(),
            Expression::Subquery(_) => todo!(),
            Expression::TypeCast(_) => todo!(),
            Expression::TypeTest(_) => todo!(),
        };
        Ok(value)
    }
}
